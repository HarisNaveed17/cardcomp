// How the user's own data (starred places and typed annual fees) is laid out in chrome.storage.sync.
// No browser APIs here, so it is unit-tested.
//
// chrome.storage.sync allows 8 KB per item and 100 KB in total, so starred places are stored as compact
// rows, one key per city, split into chunks: `sync:v1:mine:{city}:{chunk}` → [[id, name, visits, bill], …].
// Fee overrides are one key: `sync:v1:fees` → { typeId: fee }.

export const SYNC_PREFIX = 'sync:v1:';
const PLACES_PER_ITEM = 50; // about 4 KB with long place names

/** The synced part of the app state as storage items. */
export function toSyncItems({ myPlaces, feeOverrides }) {
  const items = { [`${SYNC_PREFIX}fees`]: feeOverrides };
  for (const [city, places] of Object.entries(myPlaces)) {
    const rows = Object.values(places).map(p => [p.id, p.name, p.visits, p.bill]);
    for (let i = 0; i < rows.length; i += PLACES_PER_ITEM) {
      items[`${SYNC_PREFIX}mine:${city}:${i / PLACES_PER_ITEM}`] = rows.slice(i, i + PLACES_PER_ITEM);
    }
  }
  return items;
}

/** Storage items (any keys) → { myPlaces, feeOverrides }, or null when nothing was ever synced. */
export function fromSyncItems(items) {
  const keys = Object.keys(items).filter(k => k.startsWith(SYNC_PREFIX));
  if (!keys.length) return null;
  const synced = { myPlaces: {}, feeOverrides: {} };
  for (const key of keys) {
    const [kind, city] = key.slice(SYNC_PREFIX.length).split(':');
    if (kind === 'fees') synced.feeOverrides = { ...items[key] };
    if (kind === 'mine') {
      const places = (synced.myPlaces[city] ||= {});
      for (const [id, name, visits, bill] of items[key]) places[id] = { id, name, visits, bill };
    }
  }
  return synced;
}

/** The writes that turn the synced items `prev` into `next`: { set: {key: value}, remove: [key] }. */
export function syncDiff(prev, next) {
  const set = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(prev[k]) !== JSON.stringify(v)));
  const remove = Object.keys(prev).filter(k => k.startsWith(SYNC_PREFIX) && !Object.hasOwn(next, k));
  return { set, remove };
}

export const isEmptyDiff = diff => !diff.remove.length && !Object.keys(diff.set).length;

/**
 * Data from this device and from sync, joined the first time this device syncs: the union of starred
 * places and of fees. Where both have the same place or fee, sync wins.
 */
export function mergeSynced(local, synced) {
  const myPlaces = {};
  for (const city of new Set([...Object.keys(local.myPlaces), ...Object.keys(synced.myPlaces)])) {
    myPlaces[city] = { ...local.myPlaces[city], ...synced.myPlaces[city] };
  }
  return { myPlaces, feeOverrides: { ...local.feeOverrides, ...synced.feeOverrides } };
}

/** The cities whose starred places a change to these keys touches, and whether fees changed. */
export function changedParts(keys) {
  const cities = new Set();
  let fees = false;
  for (const key of keys) {
    if (!key.startsWith(SYNC_PREFIX)) continue;
    const [kind, city] = key.slice(SYNC_PREFIX.length).split(':');
    if (kind === 'fees') fees = true;
    if (kind === 'mine') cities.add(city);
  }
  return { cities, fees };
}
