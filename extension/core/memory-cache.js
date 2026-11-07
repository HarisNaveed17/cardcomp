// In-memory cache with the same interface as platform/chrome-cache.js.

export function createMemoryCache(now = Date.now) {
  const store = new Map();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    async set(key, value, ttlMs) {
      store.set(key, { value, expires: now() + ttlMs });
    },
    async clear(match = () => true) {
      for (const key of [...store.keys()]) if (match(key)) store.delete(key);
    },
  };
}
