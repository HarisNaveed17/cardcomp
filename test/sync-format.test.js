import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedParts, fromSyncItems, isEmptyDiff, mergeSynced, SYNC_PREFIX, syncDiff, toSyncItems,
} from '../extension/platform/sync-format.js';

const place = (id, extra = {}) => ({ id, name: `Place ${id}`, visits: 12, bill: null, ...extra });
const placesOf = (...ps) => Object.fromEntries(ps.map(p => [p.id, p]));

test('sync: round trip of starred places and fees', () => {
  const settings = {
    myPlaces: { Islamabad: placesOf(place(1432, { bill: 4000 }), place(11566)), Lahore: placesOf(place(10, { visits: 3 })) },
    feeOverrides: { 806: 14000 },
  };
  assert.deepEqual(fromSyncItems(toSyncItems(settings)), settings);
});

test('sync: nothing synced yet is null, not empty settings', () => {
  assert.equal(fromSyncItems({}), null);
  assert.equal(fromSyncItems({ 'state:v1': {}, 'cache:v1:banks:Islamabad': {} }), null);
});

test('sync: a long list is split into chunks under the per-item quota', () => {
  const ids = Array.from({ length: 120 }, (_, i) => 1000 + i);
  const myPlaces = { Islamabad: placesOf(...ids.map(id => place(id, { name: 'A fairly long restaurant name, F-7 Markaz' }))) };
  const items = toSyncItems({ myPlaces, feeOverrides: {} });
  const chunks = Object.keys(items).filter(k => k.includes('mine:'));
  assert.equal(chunks.length, 3);
  for (const key of chunks) assert.ok(key.length + JSON.stringify(items[key]).length < 8192, key);
  assert.deepEqual(Object.keys(fromSyncItems(items).myPlaces.Islamabad).map(Number), ids);
});

test('sync: diff writes only changed keys and removes emptied cities', () => {
  const before = toSyncItems({ myPlaces: { Islamabad: placesOf(place(1)), Lahore: placesOf(place(2)) }, feeOverrides: {} });
  const after = toSyncItems({ myPlaces: { Islamabad: placesOf(place(1, { visits: 24 })), Lahore: {} }, feeOverrides: {} });
  const diff = syncDiff(before, after);
  assert.deepEqual(Object.keys(diff.set), [`${SYNC_PREFIX}mine:Islamabad:0`]);
  assert.deepEqual(diff.remove, [`${SYNC_PREFIX}mine:Lahore:0`]);
  assert.ok(isEmptyDiff(syncDiff(after, after)));
});

test('sync: first join keeps places from both sides; sync wins on the same place', () => {
  const local = { myPlaces: { Islamabad: placesOf(place(1, { visits: 5 }), place(2)) }, feeOverrides: { 806: 1, 807: 2 } };
  const synced = { myPlaces: { Islamabad: placesOf(place(1, { visits: 50 })), Lahore: placesOf(place(3)) }, feeOverrides: { 806: 9 } };
  assert.deepEqual(mergeSynced(local, synced), {
    myPlaces: { Islamabad: placesOf(place(1, { visits: 50 }), place(2)), Lahore: placesOf(place(3)) },
    feeOverrides: { 806: 9, 807: 2 },
  });
});

test('sync: changed keys map to cities and fees; other keys are ignored', () => {
  const parts = changedParts([`${SYNC_PREFIX}mine:Lahore:1`, `${SYNC_PREFIX}fees`, 'state:v1']);
  assert.deepEqual([...parts.cities], ['Lahore']);
  assert.equal(parts.fees, true);
});
