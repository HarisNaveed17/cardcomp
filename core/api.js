// Peekaboo API client. No browser APIs: `fetch`, the cache and the clock are injected,
// so the same client can run in the extension, in Node tests, or behind a backend.
//
// Every network request goes through one serial queue with REQUEST_GAP_MS between
// requests. Cache hits skip the queue.

import {
  API_BASE, COUNTRY, LANGUAGE, CITIES, LIST_PAGE_SIZE, PATHS, PLACES_PAGE_SIZE,
  REQUEST_GAP_MS, TOKEN, TTL,
} from './config.js';
import {
  normalizeBank, normalizeCard, normalizeCategory, normalizeDeal, normalizePlace,
  sortBanks, sortCards,
} from './normalize.js';

export class ApiError extends Error {
  // kind: 'auth' (token rejected), 'http', 'network', 'format'
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const cacheKeys = {
  banks: city => `banks:${city}`,
  cards: (bankId, city) => `cards:${bankId}:${city}`,
  categories: city => `categories:${city}`,
  places: (typeId, city, categoryId) => `places:${typeId}:${city}:${categoryId || '_all'}`,
  deals: (placeId, city) => `deals:${placeId}:${city}`,
};

function location(city) {
  const coords = CITIES[city];
  if (!coords) throw new Error(`Unknown city: ${city}`);
  return { city, country: COUNTRY, lat: coords[0], long: coords[1], language: LANGUAGE };
}

export function createClient({
  fetch = globalThis.fetch,
  cache = null,
  sleep = defaultSleep,
  now = Date.now,
  gapMs = REQUEST_GAP_MS,
  onRequest = null, // (method, path, body) => void, for tests and logging
} = {}) {
  let lastRequestAt = -Infinity;
  let queue = Promise.resolve();

  async function send(method, path, { query, body } = {}) {
    const wait = lastRequestAt + gapMs - now();
    if (wait > 0) await sleep(wait);
    const url = API_BASE + path + (query ? '?' + new URLSearchParams(query) : '');
    onRequest?.(method, path, body ?? query);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError('network', `Could not reach the deal data server (${err.message}).`);
    } finally {
      lastRequestAt = now();
    }
    if (res.status === 401 || res.status === 403) {
      throw new ApiError('auth', `The deal data server rejected the access token (HTTP ${res.status}). The guest token in core/config.js has probably been rotated.`, res.status);
    }
    if (!res.ok) throw new ApiError('http', `The deal data server returned HTTP ${res.status} for ${path}.`, res.status);
    try {
      return await res.json();
    } catch {
      throw new ApiError('format', `The deal data server returned something that is not JSON for ${path}.`, res.status);
    }
  }

  function request(method, path, options) {
    const result = queue.then(() => send(method, path, options));
    queue = result.catch(() => {});
    return result;
  }

  async function cached(key, ttl, load) {
    if (cache) {
      const hit = await cache.get(key);
      if (hit !== undefined) return hit;
    }
    const value = await load();
    if (cache) {
      try {
        await cache.set(key, value, ttl);
      } catch (err) {
        console.warn('Cache write failed', key, err); // e.g. storage quota; the data is still usable
      }
    }
    return value;
  }

  const expectArray = (data, what) => {
    if (!Array.isArray(data)) throw new ApiError('format', `Unexpected ${what} response from the deal data server.`);
    return data;
  };

  async function getBanks(city) {
    return cached(cacheKeys.banks(city), TTL.banks, async () => {
      const all = [];
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const page = expectArray(
          await request('POST', PATHS.banks, { body: { ...location(city), limit: LIST_PAGE_SIZE, offset } }),
          'bank list',
        );
        all.push(...page);
        if (page.length < LIST_PAGE_SIZE) break;
      }
      return sortBanks(all.map(normalizeBank));
    });
  }

  async function getCards(bankId, city) {
    return cached(cacheKeys.cards(bankId, city), TTL.cards, async () => {
      const { lat, long, ...loc } = location(city);
      const query = { ...loc, entity: '', lat, long, limit: LIST_PAGE_SIZE, offset: 0 };
      const data = expectArray(await request('GET', PATHS.cards(bankId), { query }), 'card list');
      return sortCards(data.map(normalizeCard));
    });
  }

  async function getCategories(city) {
    return cached(cacheKeys.categories(city), TTL.categories, async () => {
      const data = expectArray(await request('POST', PATHS.categories, { body: location(city) }), 'category list');
      return data.map(normalizeCategory).filter(c => c.dealCount > 0);
    });
  }

  /**
   * All places where `card` has a discount, optionally in one category.
   * onProgress({ loaded, total }) is called after each page.
   */
  async function getPlaces(card, city, category = null, onProgress = null) {
    const key = cacheKeys.places(card.typeId, city, category?.id);
    return cached(key, TTL.places, async () => {
      const base = {
        sortType: 'trending',
        targetEntities: '_all',
        ...location(city),
        // The server filters on categoryId; the slug is sent because the site sends it.
        category: category ? category.slug : 'all',
        categoryId: category ? String(category.id) : '_all',
        ai: String(card.associationId),
        associationTypeId: String(card.typeId),
        atlId: String(card.typeId),
        sourceEntityId: String(card.sourceEntityId),
        card: card.slug,
        discount: card.bankName,
        limit: PLACES_PAGE_SIZE,
      };
      const places = [];
      const seen = new Set();
      for (let offset = 0; ; offset += PLACES_PAGE_SIZE) {
        const data = await request('POST', PATHS.places, { body: { ...base, offset } });
        if (!data || !Array.isArray(data.entities)) throw new ApiError('format', 'Unexpected place list response from the deal data server.');
        for (const e of data.entities) {
          if (seen.has(e.id)) continue; // "trending" order can shift between pages
          seen.add(e.id);
          places.push(normalizePlace(e));
        }
        onProgress?.({ loaded: places.length, total: data.total ?? places.length });
        if (!data.nextPage || !data.entities.length) break;
      }
      return places;
    });
  }

  /** Every deal at one place, for all banks and cards (one call covers all selected cards). */
  async function getDeals(placeId, city) {
    return cached(cacheKeys.deals(placeId, city), TTL.deals, async () => {
      const deals = [];
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const data = await request('POST', PATHS.deals, {
          body: {
            associatedDeals: true,
            atlId: '_all',
            card: 'All',
            ...location(city),
            limit: LIST_PAGE_SIZE,
            offset,
            sourceEntityId: '_all',
            targetBranchId: '_all',
            targetEntityId: Number(placeId),
          },
        });
        if (!data || !Array.isArray(data.deals)) throw new ApiError('format', 'Unexpected deals response from the deal data server.');
        deals.push(...data.deals.map(normalizeDeal));
        if (data.deals.length < LIST_PAGE_SIZE || deals.length >= (data.total ?? 0)) break;
      }
      return deals;
    });
  }

  /** Place search by name. Not cached. */
  async function searchPlaces(query, city, limit = 8) {
    const { lat, long, ...loc } = location(city);
    const data = await request('GET', PATHS.search, {
      query: { ...loc, lat, long, limit, offset: 0, query },
    });
    return (data?.entities || []).map(e => ({ id: e.entityId, name: String(e.name || '').trim() }));
  }

  return { getBanks, getCards, getCategories, getPlaces, getDeals, searchPlaces };
}
