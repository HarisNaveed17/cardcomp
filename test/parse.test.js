import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capOf, daysOf, roundPct, slugify } from '../extension/core/parse.js';
import { fixture } from './helpers.js';

test('slugify matches the site card slugs', () => {
  assert.equal(slugify('HBL Gold CreditCard'), 'hbl-gold-creditcard');
  assert.equal(slugify('Askari World Credit Card'), 'askari-world-credit-card');
  assert.equal(slugify('QR - Scan to Pay'), 'qr-scan-to-pay');
  assert.equal(slugify('Food & Drinks'), 'food-drinks');
  assert.equal(slugify('e-Stores'), 'e-stores');
  assert.equal(slugify('Home Decor'), 'home-decor');
});

test('roundPct removes float noise and handles missing values', () => {
  assert.equal(roundPct(1.2999999523162842), 1.3);
  assert.equal(roundPct(40), 40);
  assert.equal(roundPct(undefined), null);
  assert.equal(roundPct(null), null);
});

test('capOf: one test per cap format seen', () => {
  const cases = [
    ['* Max Discount cap PKR 6,000/-', 6000], // Bank of Punjab
    ['* 35% or Rs. 5000/- whichever is lower', 5000], // Habib Metro
    ['* 25% or max discount of PKR 4,000/- can be availed per transaction.', 4000], // Askari
    ['* Discount Cap: 3000/-', 3000], // Bank AL Habib
    ['* Maximum discount of PKR 25,000/- can be availed per transaction.', 25000], // HBL
    ['* Discount Cap PKR 1,500/-', 1500], // MCB, Bank Alfalah
    ['* 40% or Rs. 5,000 whichever is lower.', 5000], // MCB Islamic
    ['* Maximum discount cap is of Rs. 8,000 per transaction.', 8000], // Meezan
    ['* 50% Discount is capped to PKR 10,000 per transaction', 10000], // Allied
    ['* Discount capping PKR 4,000/- on Mastercard World Debit Card', 4000], // Bank of Punjab
    ['- Flat 20% off I Entire Bill (Max Discount 3000)', 3000], // JazzCash (Mobilink)
  ];
  for (const [text, value] of cases) {
    assert.deepEqual(capOf(text), { status: 'parsed', value, line: text }, text);
  }
});

test('capOf: the % before the amount is not read as the cap', () => {
  assert.equal(capOf('* 25% or max discount of PKR 4,000/- per transaction').value, 4000);
});

test('capOf: ignores card BIN lines', () => {
  const text = '* Valid on BINs 4567890, 5123456\n* Max Discount cap PKR 6,000/-';
  assert.equal(capOf(text).value, 6000);
});

test('capOf: "rs" inside a word is not a currency', () => {
  // The original regex matched "offe|rs, only" and read the cap as 0.
  const text =
    '* To prevent misuse of discount offers, only (1) one transaction per card per day. Additionally, a maximum of three (3) transactions per month.';
  assert.equal(capOf(text).status, 'unknown');
});

test('capOf: "no cap stated" and "cap unknown" are different states', () => {
  assert.deepEqual(capOf('* Valid for dine-in only.\n* Not valid on public holidays.'), { status: 'none' });
  assert.deepEqual(capOf(''), { status: 'none' });
  assert.equal(capOf('* Maximum discount as per bank policy').status, 'unknown');
});

test('capOf: picks the line that names the card when caps differ per card', () => {
  const mcb =
    '* Discount Cap PKR 5,000/- on Visa Signature Debit Card & Visa Platinum Credit Card.\n' +
    '* Discount Cap PKR 3,000/- on Visa Platinum Debit Card.';
  const mcbCards = ['Visa Signature Debit Card', 'Visa Platinum Credit Card', 'Visa Platinum Debit Card'];
  assert.equal(capOf(mcb, 'Visa Signature Debit Card', mcbCards).value, 5000);
  assert.equal(capOf(mcb, 'Visa Platinum Credit Card', mcbCards).value, 5000);
  assert.equal(capOf(mcb, 'Visa Platinum Debit Card', mcbCards).value, 3000);

  // One card name contains part of another: "Taqwa Platinum" vs "Taqwa KHAAS Platinum".
  const bop =
    '* 30% or Rs. 4,000 whichever is lower on Mastercard Platinum Credit Card\n' +
    '* 30% or Rs. 3,000 whichever is lower on Mastercard Taqwa KHAAS Platinum Islamic Debit Card';
  const bopCards = ['Mastercard Platinum Credit Card', 'Mastercard Taqwa KHAAS Platinum Islamic Debit Card'];
  assert.equal(capOf(bop, bopCards[0], bopCards).value, 4000);
  assert.equal(capOf(bop, bopCards[1], bopCards).value, 3000);
});

test('capOf: a card the cap lines do not name exactly is "unknown", not a guess', () => {
  // JS Bank: "Titanium Debit Cards" probably covers "Her Titanium", but the text does not say so.
  const text =
    '* Discount Capping PKR 4,000/- on Visa Gold Credit Card.\n' +
    '* Discount Capping PKR 3,000/- on Mastercard Titanium Debit Cards.\n' +
    '* A maximum of 3 transactions per card per Monthly billing will qualify for the discount.';
  const cards = ['Mastercard Her Titanium Debit Card', 'Mastercard Titanium Debit Card', 'Visa Gold Credit Card'];
  assert.equal(capOf(text, cards[0], cards).status, 'unknown');
  assert.equal(capOf(text, cards[1], cards).value, 3000);
  assert.equal(capOf(text, cards[2], cards).value, 4000);
});

test('capOf: "a maximum of 3 transactions" is not a cap', () => {
  assert.equal(capOf('* A maximum of 3 transactions per card per month.').status, 'unknown');
});

test('capOf: a general cap line applies when the card is not named', () => {
  const text = '* Discount Cap PKR 2,000/-\n* Discount Cap PKR 5,000/- on Visa Infinite Card';
  const cards = ['Visa Gold Card', 'Visa Infinite Card'];
  assert.equal(capOf(text, 'Visa Gold Card', cards).value, 2000);
  assert.equal(capOf(text, 'Visa Infinite Card', cards).value, 5000);
});

test('capOf: every card of every fixture deal gets a parsed cap', () => {
  const deals = [
    ...fixture('deals-rinas-kitchenette.json').deals,
    ...fixture('deals-asian-wok-partial.json').deals,
  ];
  for (const d of deals) {
    const names = d.associations.map(a => a.name);
    for (const name of names) {
      const cap = capOf(d.description, name, names);
      assert.equal(cap.status, 'parsed', `${d.sourceEntityName} ${d.title} ${name}`);
    }
  }
});

test('capOf: per-card caps at Rinas Kitchenette', () => {
  const deals = fixture('deals-rinas-kitchenette.json').deals;
  const capFor = typeId => {
    const d = deals.find(x => x.associations.some(a => a.typeId === typeId));
    const names = d.associations.map(a => a.name);
    return capOf(d.description, d.associations.find(a => a.typeId === typeId).name, names).value;
  };
  const expected = {
    862: 3000, 863: 5000, 1879: 5000, // MCB 30%
    1835: 4000, 1900: 3000, // Bank of Punjab 30%
    1834: 2000, 1899: 3000, // Bank of Punjab 20%
    1876: 1500, 1877: 1000, 1875: 1000, // MCB Islamic 15% (Wed–Fri)
    636: 10000, 1972: 25000, 813: 15000,
  };
  for (const [typeId, value] of Object.entries(expected)) assert.equal(capFor(Number(typeId)), value, typeId);
});

test('capOf: Asian Wok caps match the console summary', () => {
  const caps = fixture('deals-asian-wok-partial.json').deals.map(d => capOf(d.description).value);
  assert.deepEqual(caps, [6000, 4000, 4000, 5000, 4000]);
});

test('daysOf reads weekdays from the title (Monday first, null = every day)', () => {
  assert.equal(daysOf('25% off'), null);
  assert.equal(daysOf('30% off Everyday'), null);
  assert.deepEqual(daysOf('50% off on Every Tuesday'), [2]);
  assert.deepEqual(daysOf('30% off on Every Monday, Tuesday & Wednesday'), [1, 2, 3]);
  assert.deepEqual(daysOf('40% off on Every Friday, Saturday & Sunday'), [5, 6, 0]);
  assert.deepEqual(daysOf('30% off on Every Wednesday, Thursday & Friday'), [3, 4, 5]);
  assert.deepEqual(daysOf('20% off on Weekends'), [6, 0]);
  assert.deepEqual(daysOf('15% off Mon-Thu'), [1, 4]); // ranges are not expanded; the UI shows the title too
});
