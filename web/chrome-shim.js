// Emulates the chrome.storage APIs the page uses, so app.html also runs as a plain website
// (cardcomp.hnaveed.me) and on localhost (`npm run dev`). Classic script: it must run before app.js.
//
// local: IndexedDB. The deals cache outgrows localStorage's ~5 MB: a cold compare caches the
//   full terms of every deal at ~190 places.
// sync:  localStorage. Starred places and typed fees are small. There is no cross-device sync on
//   the web, but other tabs' changes arrive as storage events, the same way another device's
//   changes arrive through chrome.storage.onChanged in the extension.
(() => {
  if (window.chrome?.storage) return; // running as the extension

  const DB_NAME = 'cardcomp';
  const STORE = 'local';
  let dbPromise;
  const db = () => (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const done = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const t = (await db()).transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = t.onabort = () => reject(t.error);
    });
    return result;
  };

  const local = {
    async get(keys) {
      if (keys == null) {
        return tx('readonly', async s => {
          const [ks, vs] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
          return Object.fromEntries(ks.map((k, i) => [k, vs[i]]));
        });
      }
      const ks = [].concat(keys);
      return tx('readonly', async s => {
        const vs = await Promise.all(ks.map(k => done(s.get(k))));
        return Object.fromEntries(ks.map((k, i) => [k, vs[i]]).filter(([, v]) => v !== undefined));
      });
    },
    set: obj => tx('readwrite', s => { for (const [k, v] of Object.entries(obj)) s.put(v, k); }),
    remove: keys => tx('readwrite', s => { for (const k of [].concat(keys)) s.delete(k); }),
  };

  const P = 'sync:';
  const sync = {
    async get(keys) {
      const all = Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith(P)).map(k => [k.slice(P.length), JSON.parse(localStorage.getItem(k))]));
      if (keys == null) return all;
      return Object.fromEntries([].concat(keys).filter(k => k in all).map(k => [k, all[k]]));
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) localStorage.setItem(P + k, JSON.stringify(v)); },
    async remove(keys) { for (const k of [].concat(keys)) localStorage.removeItem(P + k); },
  };

  const onChanged = { addListener(fn) {
    addEventListener('storage', e => {
      if (!e.key?.startsWith(P)) return;
      const parse = v => (v == null ? undefined : JSON.parse(v));
      fn({ [e.key.slice(P.length)]: { oldValue: parse(e.oldValue), newValue: parse(e.newValue) } }, 'sync');
    });
  } };

  window.chrome = { ...window.chrome, storage: { local, sync, onChanged } };
})();
