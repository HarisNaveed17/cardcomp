import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestOf, buildRows, dealStatus, evaluate, filterRows, offerFor, savingFor, sortRows, yearlyValue,
} from '../extension/core/compare.js';
import { toCsv } from '../extension/core/csv.js';
import { normalizeDeal } from '../extension/core/normalize.js';
import { fixture, NOW } from './helpers.js';

const card = (typeId, name) => ({ typeId, name });
const A = card(1, 'Card A');
const B = card(2, 'Card B');
const C = card(3, 'Card C');
const parsed = value => ({ status: 'parsed', value });

const rinas = fixture('deals-rinas-kitchenette.json').deals.map(normalizeDeal);

test('savingFor: min(pct × bill, cap); no cap when unknown', () => {
  assert.equal(savingFor(30, parsed(2000), 15000), 2000);
  assert.equal(savingFor(20, parsed(6000), 15000), 3000);
  assert.equal(savingFor(20, { status: 'unknown' }, 15000), 3000);
  assert.equal(savingFor(20, parsed(6000), null), null);
});

test('a higher % with a lower cap loses on a big bill', () => {
  const offers = {
    1: { covered: true, pct: 30, cap: parsed(2000), saving: savingFor(30, parsed(2000), 15000) },
    2: { covered: true, pct: 20, cap: parsed(6000), saving: savingFor(20, parsed(6000), 15000) },
  };
  assert.deepEqual(bestOf([A, B], offers, 15000), { typeIds: [2], tie: false });
  // On a small bill, the 30% card wins.
  offers[1].saving = savingFor(30, parsed(2000), 5000);
  offers[2].saving = savingFor(20, parsed(6000), 5000);
  assert.deepEqual(bestOf([A, B], offers, 5000), { typeIds: [1], tie: false });
});

test('equal best values are a tie, not a win for the first card', () => {
  const offers = {
    1: { covered: true, pct: 25, cap: { status: 'not-loaded' } },
    2: { covered: true, pct: 25, cap: { status: 'not-loaded' } },
    3: { covered: true, pct: 10, cap: { status: 'not-loaded' } },
  };
  assert.deepEqual(bestOf([A, B, C], offers), { typeIds: [1, 2], tie: true });
  // Both capped at the same amount on a big bill: tie.
  const capped = {
    1: { covered: true, pct: 40, saving: 5000 },
    2: { covered: true, pct: 30, saving: 5000 },
  };
  assert.deepEqual(bestOf([A, B], capped, 50000), { typeIds: [1, 2], tie: true });
});

test('same % without a bill: the bigger known cap wins', () => {
  const offers = {
    1: { covered: true, pct: 25, cap: parsed(3000) },
    2: { covered: true, pct: 25, cap: parsed(5000) },
  };
  assert.deepEqual(bestOf([A, B], offers), { typeIds: [2], tie: false });
});

test('dealStatus: expired, upcoming, ending soon', () => {
  const d = (start, end) => ({ start, end });
  assert.equal(dealStatus(d('2026-01-01T00:00:00', '2026-10-01T23:59:00'), NOW), 'expired');
  assert.equal(dealStatus(d('2026-11-01T00:00:00', '2027-10-01T23:59:00'), NOW), 'upcoming');
  assert.equal(dealStatus(d('2026-01-01T00:00:00', '2026-10-31T23:59:00'), NOW), 'ending-soon');
  assert.equal(dealStatus(d('2026-01-01T00:00:00', '2027-10-01T23:59:00'), NOW), 'active');
});

test('offerFor before deals load uses the listed %', () => {
  const o = offerFor(A, { pct: 40, flag: null }, undefined, 5000, NOW);
  assert.equal(o.covered, true);
  assert.equal(o.loaded, false);
  assert.equal(o.cap.status, 'not-loaded');
  assert.equal(o.saving, 2000);
  assert.equal(offerFor(A, undefined, undefined, 5000, NOW).covered, false);
});

test('offerFor at Rinas Kitchenette uses the card\'s own deal and cap', () => {
  const askariWorld = card(636, 'Askari World Credit Card');
  const o = offerFor(askariWorld, undefined, rinas, 10000, NOW);
  assert.equal(o.pct, 40);
  assert.deepEqual([o.cap.status, o.cap.value], ['parsed', 10000]);
  assert.equal(o.saving, 4000);

  const mcbPlatDebit = card(862, 'Visa Platinum Debit Card');
  const m = offerFor(mcbPlatDebit, undefined, rinas, 20000, NOW);
  assert.equal(m.pct, 30);
  assert.equal(m.cap.value, 3000, 'per-card cap, not the first cap in the text');
  assert.equal(m.saving, 3000);

  const bopTuesday = offerFor(card(1837, 'Mastercard World Credit Card'), undefined, rinas, 5000, NOW);
  assert.deepEqual(bopTuesday.days, [2]);
});

test('offerFor: deals that ended are not used', () => {
  const deals = [
    { id: 1, pct: 50, start: '2026-01-01T00:00:00', end: '2026-09-30T23:59:00', days: null, description: '', cards: [{ typeId: 1, name: 'Card A' }] },
    { id: 2, pct: 20, start: '2026-01-01T00:00:00', end: '2027-09-30T23:59:00', days: null, description: '* Discount Cap PKR 1,000/-', cards: [{ typeId: 1, name: 'Card A' }] },
  ];
  const o = offerFor(A, { pct: 50 }, deals, 10000, NOW);
  assert.equal(o.pct, 20);
  assert.equal(o.saving, 1000);
  const none = offerFor(A, { pct: 50 }, deals.slice(0, 1), 10000, NOW);
  assert.equal(none.covered, false);
});

test('offerFor: with two deals for one card, the bigger saving wins', () => {
  const deals = [
    { id: 1, pct: 50, start: null, end: null, days: [2], description: '* Discount Cap PKR 1,000/-', cards: [{ typeId: 1, name: 'Card A' }] },
    { id: 2, pct: 20, start: null, end: null, days: null, description: '* Discount Cap PKR 5,000/-', cards: [{ typeId: 1, name: 'Card A' }] },
  ];
  assert.equal(offerFor(A, null, deals, 20000, NOW).deal.id, 2);
  assert.equal(offerFor(A, null, deals, 1000, NOW).deal.id, 1);
  assert.equal(offerFor(A, null, deals, 1000, NOW).flag, 'Up to');
});

test('offerFor ignores deals titled "(TEST)"', () => {
  const deals = [{ id: 1, title: '20% off (TEST)', pct: 20, start: null, end: null, days: null, description: '', cards: [{ typeId: 1, name: 'Card A' }] }];
  assert.equal(offerFor(A, null, deals, 1000, NOW).covered, false);
});

test('buildRows joins on merchant id; filterRows gives the views', () => {
  const place = (id, pct) => ({ id, name: `P${id}`, maxDiscount: pct, discountFlag: null });
  const placesByCard = new Map([
    [1, [place(10, 20), place(11, 30), place(12, 10)]],
    [2, [place(10, 25), place(13, 15), place(12, 10)]],
  ]);
  const rows = buildRows([A, B], placesByCard);
  assert.deepEqual(rows.map(r => r.place.id), [10, 11, 12, 13]);
  assert.deepEqual(rows[0].listed, { 1: { pct: 20, flag: null }, 2: { pct: 25, flag: null } });

  const evaluated = rows.map(r => ({ ...r, ...evaluate([A, B], r.listed, undefined, null, NOW) }));
  const ids = view => filterRows(evaluated, view, [A, B], { baseTypeId: 1 }).map(r => r.place.id);
  assert.deepEqual(ids('all'), [10, 11, 12, 13]);
  assert.deepEqual(ids('common'), [10, 12]);
  assert.deepEqual(ids('unique'), [11, 13]);
  assert.deepEqual(ids('only:1'), [11]);
  assert.deepEqual(ids('only:2'), [13]);
  assert.deepEqual(ids('gain'), [10, 13], 'B is better at 10, only B at 13; a tie at 12 is no gain');
  assert.deepEqual(evaluated.find(r => r.place.id === 12).best, { typeIds: [1, 2], tie: true });
});

test('filterRows gain: a card I don\'t have beats the best of the cards I have', () => {
  const o = pct => (pct == null ? { covered: false } : { covered: true, pct, cap: { status: 'not-loaded' } });
  const row = (id, a, b, c) => ({ place: { id }, offers: { 1: o(a), 2: o(b), 3: o(c) } });
  const rows = [row(1, 20, 30, 25), row(2, 20, 10, 25), row(3, null, 15, 10), row(4, 30, 30, 30)];
  const ids = have => filterRows(rows, 'gain', [A, B, C], { haveTypeIds: have }).map(r => r.place.id);
  assert.deepEqual(ids([1]), [1, 2, 3]);
  assert.deepEqual(ids([1, 2]), [2], 'C beats the best of A and B only at place 2');
  assert.deepEqual(ids([]), [1, 2, 3, 4], 'no cards held: nothing to filter on');
});

test('sortRows: by %, by cap with unknown caps after known ones, per target card', () => {
  const o = (pct, cap) => (pct == null ? { covered: false } : { covered: true, pct, cap, saving: null });
  const row = (name, a, b) => ({ place: { name }, offers: { 1: a, 2: b } });
  const rows = [
    row('Delta', o(20, parsed(5000)), o(40, parsed(1000))),
    row('Alpha', o(30, { status: 'unknown' }), o(null)),
    row('Charlie', o(null), o(25, parsed(3000))),
    row('Bravo', o(20, parsed(2000)), o(10, { status: 'none' })),
  ];
  const names = opts => sortRows(rows, [A, B], opts).map(r => r.place.name);
  assert.deepEqual(names({ sort: 'pct' }), ['Delta', 'Alpha', 'Charlie', 'Bravo']);
  assert.deepEqual(names({ sort: 'pct', targetTypeId: 1 }), ['Alpha', 'Delta', 'Bravo', 'Charlie'], 'tie at 20%: bigger cap first; no deal last');
  assert.deepEqual(names({ sort: 'cap' }), ['Bravo', 'Delta', 'Charlie', 'Alpha'], 'no cap stated counts as unlimited');
  assert.deepEqual(names({ sort: 'cap', targetTypeId: 1 }), ['Delta', 'Bravo', 'Alpha', 'Charlie']);
  assert.deepEqual(names({ sort: 'name' }), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(names({ sort: 'pct', targetTypeId: 99 }), names({ sort: 'pct' }), 'unknown target falls back to any card');
});

test('yearlyValue: savings − fee, unknown fee left out of the ranking', () => {
  const entry = (bill, visits, a, b, c) => ({
    bill, visits,
    offers: {
      1: a == null ? { covered: false } : { covered: true, saving: a, cap: parsed(1), days: null },
      2: b == null ? { covered: false } : { covered: true, saving: b, cap: { status: 'unknown' }, days: [2] },
      3: c == null ? { covered: false } : { covered: true, saving: c, cap: parsed(1), days: null },
    },
  });
  const entries = [entry(5000, 12, 1000, 1500, 500), entry(10000, 4, null, 2000, 2000)];
  const v = yearlyValue([A, B, C], entries, { 1: 5000, 2: 20000, 3: null }, 1);

  assert.equal(v.spend, 5000 * 12 + 10000 * 4);
  const [a, b, c] = v.perCard;
  assert.equal(a.savings, 12000);
  assert.equal(a.net, 7000);
  assert.equal(a.breakEven, 5000 / (12000 / 100000));
  assert.equal(b.savings, 26000);
  assert.equal(b.net, 6000);
  assert.equal(b.capIssues, 2);
  assert.equal(b.dayLimited, 2);
  assert.equal(c.net, null);
  assert.equal(c.breakEven, null);
  assert.deepEqual(v.ranking, { typeIds: [1], tie: false });

  // Adding B to A: +500 × 12 at the first place, +2000 × 4 at the second.
  assert.deepEqual(b.marginal, { gain: 14000, net: -6000 });
  assert.equal(a.marginal, null);

  assert.equal(v.combined.savings, 12 * 1500 + 4 * 2000);
  assert.equal(v.combined.fees, null, 'unknown when any fee is unknown');
});

test('yearlyValue: equal nets are a tie', () => {
  const entries = [{ bill: 1000, visits: 10, offers: { 1: { covered: true, saving: 200 }, 2: { covered: true, saving: 300 } } }];
  const v = yearlyValue([A, B], entries, { 1: 0, 2: 1000 });
  assert.deepEqual(v.ranking, { typeIds: [1, 2], tie: true });
});

test('toCsv quotes and defuses formulas', () => {
  assert.equal(toCsv([['a', 'b,c', 'say "hi"'], ['=SUM(A1)', 3]]), 'a,"b,c","say ""hi"""\r\n\'=SUM(A1),3\r\n');
});
