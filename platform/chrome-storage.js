// chrome.storage.local adapters: the API cache (same interface as core/memory-cache.js)
// and the user's saved settings.

const CACHE_PREFIX = 'cache:v1:'; // bump when the cached shapes change
const STATE_KEY = 'state:v1';

const local = () => chrome.storage.local;

export const chromeCache = {
  async get(key) {
    const k = CACHE_PREFIX + key;
    const entry = (await local().get(k))[k];
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      await local().remove(k);
      return undefined;
    }
    return entry.value;
  },
  async set(key, value, ttlMs) {
    await local().set({ [CACHE_PREFIX + key]: { value, expires: Date.now() + ttlMs } });
  },
  // Remove cached entries whose key (without prefix) matches.
  async clear(match = () => true) {
    const all = await local().get(null);
    const keys = Object.keys(all).filter(k => k.startsWith('cache:') && (!k.startsWith(CACHE_PREFIX) || match(k.slice(CACHE_PREFIX.length))));
    if (keys.length) await local().remove(keys);
  },
  // Drop expired entries and entries from older cache versions.
  async prune() {
    const all = await local().get(null);
    const now = Date.now();
    const keys = Object.entries(all)
      .filter(([k, v]) => k.startsWith('cache:') && (!k.startsWith(CACHE_PREFIX) || !(v?.expires > now)))
      .map(([k]) => k);
    if (keys.length) await local().remove(keys);
  },
};

export async function loadState() {
  return (await local().get(STATE_KEY))[STATE_KEY] || null;
}

export async function saveState(state) {
  await local().set({ [STATE_KEY]: state });
}

// Starred places and typed fees, mirrored in chrome.storage.sync so they follow the user's Chrome
// profile to other devices (layout in sync-format.js). Without Chrome sign-in, sync storage still
// works and simply stays on this device.
export const syncStore = {
  read: () => chrome.storage.sync.get(null),
  async write({ set, remove }) {
    if (remove.length) await chrome.storage.sync.remove(remove);
    if (Object.keys(set).length) await chrome.storage.sync.set(set);
  },
  // listener(changes): changes = { key: { oldValue, newValue } }, for changes from any device.
  onChange(listener) {
    chrome.storage.onChanged.addListener((changes, area) => area === 'sync' && listener(changes));
  },
};
