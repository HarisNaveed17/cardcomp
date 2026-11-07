import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBank, normalizeCard, normalizeCategory, normalizeDeal, normalizePlace, sortBanks, sortCards,
} from '../extension/core/normalize.js';
import { placeUrl } from '../extension/core/format.js';
import { fixture } from './helpers.js';

test('banks: banks first, then other issuers', () => {
  const banks = sortBanks(fixture('banks-islamabad.json').map(normalizeBank));
  const firstOther = banks.findIndex(b => !b.isBank);
  assert.ok(firstOther > 0);
  assert.ok(banks.slice(firstOther).every(b => !b.isBank));
  for (const name of ['Golootlo', 'Jazz', 'Telenor', 'Vouch365']) {
    assert.equal(banks.find(b => b.name === name).isBank, false, name);
  }
  assert.deepEqual(banks.find(b => b.name === 'Habib Bank Limited'), {
    id: 289, sourceEntityId: 32, name: 'Habib Bank Limited', isBank: true,
  });
});

test('cards: credit first, with ids and slug for the places request', () => {
  const cards = sortCards(fixture('cards-hbl.json').map(normalizeCard));
  assert.equal(cards.length, 18);
  const order = cards.map(c => c.cardType);
  assert.deepEqual(order, [...order].sort((a, b) => ({ CREDIT: 0, DEBIT: 1 }[a] ?? 2) - ({ CREDIT: 0, DEBIT: 1 }[b] ?? 2)));
  const gold = cards.find(c => c.typeId === 806);
  assert.deepEqual(gold, {
    typeId: 806, associationId: 8, name: 'HBL Gold CreditCard', slug: 'hbl-gold-creditcard',
    cardType: 'CREDIT', bankId: 289, bankName: 'Habib Bank Limited', sourceEntityId: 32,
  });
});

test('categories keep the deal count', () => {
  const cats = fixture('categories.json').map(normalizeCategory);
  assert.equal(cats.length, 13);
  assert.deepEqual(cats.find(c => c.id === 55), { id: 55, name: 'e-Stores', slug: 'e-stores', dealCount: 100 });
  assert.equal(cats.find(c => c.id === 39).dealCount, 0);
});

test('places: trimmed names, rounded %, online-only label, missing discount', () => {
  const places = fixture('entities-lifestyle-nocard-page1.json').entities.map(normalizePlace);
  const byName = name => places.find(p => p.name === name);

  assert.ok(places.every(p => p.name === p.name.trim()));
  assert.equal(byName('Ideas by Gul Ahmed').maxDiscount, 1.3);
  assert.equal(byName('Khaadi Pakistan').discountFlag, 'Flat');
  assert.equal(byName('Nike').discountFlag, 'Up to');
  assert.equal(byName('The Shirts Bar').maxDiscount, null);
  assert.equal(byName('The Shirts Bar').onlineOnly, true);
  assert.equal(byName('Optica').onlineOnly, false); // `online: true`, but has a real branch
});

test('places with a card filter carry that card\'s discount', () => {
  const data = fixture('entities-askari-world-page1.json');
  assert.equal(data.total, 167);
  const bbq = normalizePlace(data.entities.find(e => e.id === 10));
  assert.equal(bbq.name, 'Bar.B.Q Tonight');
  assert.equal(bbq.maxDiscount, 40);
});

test('deals: days from the title, cards from associations', () => {
  const deals = fixture('deals-rinas-kitchenette.json').deals.map(normalizeDeal);
  assert.equal(deals.length, 27);
  const bop = deals.find(d => d.title === '50% off on Every Tuesday');
  assert.deepEqual(bop.days, [2]);
  assert.deepEqual(bop.cards, [{ typeId: 1837, name: 'Mastercard World Credit Card' }]);
  assert.equal(bop.placeId, 1432);
  const hbl = deals.find(d => d.cards.some(c => c.typeId === 813));
  assert.equal(hbl.pct, 25);
  assert.equal(hbl.days, null);
  assert.equal(hbl.end, '2026-12-31T23:59:00');
});

test('places: link to the place page on peekaboo.guru', () => {
  const places = fixture('entities-askari-world-page1.json').entities.map(normalizePlace);
  const wok = places.find(p => p.id === 11566);
  assert.equal(placeUrl('Islamabad', wok), 'https://peekaboo.guru/islamabad/detail/11566/asian-wok');
  // Search results and saved places have no slug: build one from the name (the site ignores it).
  const { entityId: id, name } = fixture('typeahead-rinas.json').entities[0];
  assert.equal(placeUrl('Islamabad', { id, name }), 'https://peekaboo.guru/islamabad/detail/1432/rinas-kitchenette');
});
