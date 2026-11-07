import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createClient } from '../extension/core/api.js';
import { REQUEST_GAP_MS } from '../extension/core/config.js';
import { createMemoryCache } from '../extension/core/memory-cache.js';
import { normalizeCard } from '../extension/core/normalize.js';
import { fixture } from './helpers.js';

// A fake server: routes by path, records requests, and runs on a fake clock.
function fakeServer(routes) {
  const requests = [];
  let clock = 0;
  const sleeps = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, at: clock, headers: init.headers });
    const handler = routes[u.pathname];
    if (!handler) return { ok: false, status: 404, json: async () => ({}) };
    const [status, data] = handler({ body, query: Object.fromEntries(u.searchParams) });
    return { ok: status < 400, status, json: async () => data };
  };
  const client = createClient({
    fetch,
    cache: createMemoryCache(() => clock),
    now: () => clock,
    sleep: async ms => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { client, requests, sleeps, tick: ms => (clock += ms) };
}

const askariWorld = normalizeCard({
  entityId: 322, entityName: 'Askari Bank Limited', sourceEntityId: 37, associationId: 190,
  typeId: 636, typeName: 'Askari World Credit Card', cardType: 'CREDIT',
});

test('getBanks posts the full body, sends the token, and caches per city', async () => {
  const { client, requests } = fakeServer({ '/api/v6/sourceEntities': () => [200, fixture('banks-islamabad.json')] });
  const banks = await client.getBanks('Islamabad');
  assert.ok(banks.length > 30);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, {
    city: 'Islamabad', country: 'Pakistan', lat: 33.729388, long: 73.093146, language: 'en', limit: 100, offset: 0,
  });
  assert.match(requests[0].headers.Authorization, /^Bearer eyJ/);

  await client.getBanks('Islamabad');
  assert.equal(requests.length, 1, 'second call is a cache hit');
  await client.getBanks('Lahore');
  assert.equal(requests.length, 2, 'cache is per city');
  assert.equal(requests[1].body.city, 'Lahore');
});

test('getCards uses the bank id in the path', async () => {
  const { client, requests } = fakeServer({ '/api/sourceEntity/289/associationType/_all': () => [200, fixture('cards-hbl.json')] });
  const cards = await client.getCards(289, 'Islamabad');
  assert.equal(cards.length, 18);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].query.city, 'Islamabad');
  assert.equal(requests[0].query.limit, '100');
});

test('getCategories posts the city and drops categories with no deals', async () => {
  const { client, requests } = fakeServer({ '/api/v7/category': () => [200, fixture('categories.json')] });
  const cats = await client.getCategories('Islamabad');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].body.city, 'Islamabad');
  assert.equal(cats.length, 12);
  assert.ok(!cats.some(c => c.name === 'Public Services'));
});

test('getPlaces pages by 12 until nextPage is false, with card and category fields', async () => {
  const page1 = fixture('entities-askari-world-page1.json');
  const page2 = { total: 14, nextPage: false, entities: [{ id: 99901, name: 'Extra ', stats: { maxDiscount: 15 } }, { id: 99902, name: 'Extra 2', stats: {} }] };
  const { client, requests, sleeps } = fakeServer({
    '/api/v8/entities': ({ body }) => [200, body.offset === 0 ? { ...page1, total: 14 } : page2],
  });
  const progress = [];
  const places = await client.getPlaces(askariWorld, 'Islamabad', { id: 1, slug: 'food' }, p => progress.push(p));

  assert.equal(places.length, 14);
  assert.deepEqual(requests.map(r => r.body.offset), [0, 12]);
  assert.deepEqual(progress, [{ loaded: 12, total: 14 }, { loaded: 14, total: 14 }]);
  const body = requests[0].body;
  assert.equal(body.ai, '190');
  assert.equal(body.associationTypeId, '636');
  assert.equal(body.atlId, '636');
  assert.equal(body.sourceEntityId, '37');
  assert.equal(body.card, 'askari-world-credit-card');
  assert.equal(body.discount, 'Askari Bank Limited');
  assert.equal(body.category, 'food');
  assert.equal(body.categoryId, '1');
  assert.equal(body.limit, 12);
  assert.ok(!('discounts' in body));
  assert.deepEqual(sleeps, [REQUEST_GAP_MS], 'waits REQUEST_GAP_MS between requests');
});

test('getPlaces without a category sends "all"/"_all"', async () => {
  const { client, requests } = fakeServer({ '/api/v8/entities': () => [200, { total: 0, nextPage: false, entities: [] }] });
  await client.getPlaces(askariWorld, 'Islamabad');
  assert.equal(requests[0].body.category, 'all');
  assert.equal(requests[0].body.categoryId, '_all');
});

test('getDeals sends the place id as a number', async () => {
  const { client, requests } = fakeServer({ '/api/v8/entity/deals': () => [200, fixture('deals-rinas-kitchenette.json')] });
  const deals = await client.getDeals(1432, 'Islamabad');
  assert.equal(deals.length, 27);
  assert.equal(requests[0].body.targetEntityId, 1432);
  assert.equal(requests[0].body.atlId, '_all');
});

test('requests run one at a time, REQUEST_GAP_MS apart, even when started together', async () => {
  const { client, requests } = fakeServer({ '/api/v8/entity/deals': () => [200, { total: 0, deals: [] }] });
  await Promise.all([1, 2, 3].map(id => client.getDeals(id, 'Islamabad')));
  assert.deepEqual(requests.map(r => r.at), [0, REQUEST_GAP_MS, 2 * REQUEST_GAP_MS]);
});

test('401 is reported as a token problem, and the queue keeps working after it', async () => {
  let fail = true;
  const { client } = fakeServer({ '/api/v7/category': () => (fail ? [401, {}] : [200, []]) });
  await assert.rejects(client.getCategories('Islamabad'), err => err instanceof ApiError && err.kind === 'auth');
  fail = false;
  assert.deepEqual(await client.getCategories('Islamabad'), []);
});

test('unexpected response shapes are reported clearly', async () => {
  const { client } = fakeServer({ '/api/v8/entities': () => [200, { error: 'nope' }] });
  await assert.rejects(client.getPlaces(askariWorld, 'Islamabad'), err => err.kind === 'format');
});

test('searchPlaces maps entityId to id', async () => {
  const { client, requests } = fakeServer({ '/api/entity/typeahead': () => [200, fixture('typeahead-rinas.json')] });
  assert.deepEqual(await client.searchPlaces('rinas', 'Islamabad'), [{ id: 1432, name: 'Rinas kitchenette' }]);
  assert.equal(requests[0].query.query, 'rinas');
});
