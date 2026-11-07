// The extension page: state, events and rendering. All data logic is in core/.

import { ApiError, cacheKeys, createClient } from './core/api.js';
import { CITIES, MAX_CARDS } from './core/config.js';
import { buildRows, capForCard, cardDeals, evaluate, filterRows, sortRows, VIEWS, yearlyValue } from './core/compare.js';
import { toCsv } from './core/csv.js';
import { isTestDeal } from './core/parse.js';
import * as fmt from './core/format.js';
import { chromeCache, loadState, saveState, syncStore } from './platform/chrome-storage.js';
import { changedParts, fromSyncItems, isEmptyDiff, mergeSynced, SYNC_PREFIX, syncDiff, toSyncItems } from './platform/sync-format.js';
import { $, download, h } from './dom.js';
import { hideProgress, showProgress } from './progress.js';

const PAGE_SIZE = 25;
const DEFAULT_VISITS = 12;
const SEARCH_DEBOUNCE_MS = 300;
const COMPARE_DELAY_MS = 300; // let the setup settle before loading places
const MIN_SLOTS = 2;
const SYNC_DELAY_MS = 1500; // chrome.storage.sync allows 120 writes a minute

const api = createClient({ cache: chromeCache });

const newSlot = () => ({ bankId: null, cardType: 'CREDIT', card: null, have: false });

// Saved between sessions.
let state = {
  step: 'city', // 'city' | 'category' | 'cards'
  city: null,
  categoryId: undefined, // undefined = not picked yet, null = all categories
  slots: [newSlot(), newSlot()], // card pickers; card is a normalized card (core/normalize.js)
  bill: null,
  view: 'all',
  sort: 'pct', // 'pct' | 'cap' | 'name'
  sortTypeId: null, // rank by this card's offer; null = the best offer at each place
  myPlaces: {}, // city → { [placeId]: { id, name, visits, bill } }
  feeOverrides: {}, // typeId → annual fee entered by the user
  syncJoined: false, // myPlaces and feeOverrides on this device were merged into chrome.storage.sync
  syncDirty: false, // myPlaces or feeOverrides changed here and are not in chrome.storage.sync yet
};

// Lost on reload.
const session = {
  banks: [],
  categories: [],
  cityLoading: false,
  bankCards: new Map(), // bankId → cards in state.city, or 'loading'
  fees: {}, // typeId → entry from data/fees.json
  compared: null, // { cards, city, category } of the last finished compare
  compareSig: null, // what the last started compare was for
  compareSeq: 0,
  compareTimer: null,
  compareJobs: null, // placesJob()s of the running compare
  places: new Map(), // places cache key → job from placesJob()
  rows: [],
  rowById: new Map(),
  shown: { rows: [], visible: [] }, // the table's rows in display order, and the page on screen, as last rendered
  deals: new Map(), // placeId → deals, for state.city
  dealsLoading: new Set(),
  capsPaused: false, // prefetchDeals() stopped on an error; the Retry button restarts it
  nameFilter: '',
  page: 0,
  expanded: new Set(),
  slotUi: new WeakMap(), // slot → { mounted, revealed, editing }
  search: { timer: null, seq: 0, place: null },
};

const saveLocal = () => saveState(state).catch(err => console.warn('Could not save settings', err));

// Starred places and fees are also mirrored in chrome.storage.sync, so they follow the user to other devices.
const synced = {
  ready: false, // false until joinSync() ran, or when sync storage failed: this device then keeps its data locally
  items: {}, // what chrome.storage.sync holds (our keys only), as of our last read or write
  timer: null,
};

function persist() {
  if (synced.ready && !isEmptyDiff(syncDiff(synced.items, toSyncItems(state)))) {
    state.syncDirty = true;
    clearTimeout(synced.timer);
    synced.timer = setTimeout(pushSynced, SYNC_DELAY_MS);
  }
  saveLocal();
}

async function pushSynced() {
  const prev = synced.items;
  const next = toSyncItems(state);
  synced.items = next; // before the write, so onSyncChange() recognizes the echo of it
  try {
    await syncStore.write(syncDiff(prev, next));
  } catch (err) {
    synced.items = prev; // the next persist() retries
    return showError(Object.assign(new Error(`Could not sync starred places and fees to your other devices: ${err.message}`), { userFacing: true }));
  }
  if (isEmptyDiff(syncDiff(synced.items, toSyncItems(state)))) state.syncDirty = false; // else a newer push is scheduled
  saveLocal();
}

// Called once at startup. Sync is the source of truth, except the first time this device syncs
// (both sides are merged) and when this device has changes it could not write yet (they win).
async function joinSync() {
  const items = await syncStore.read();
  synced.items = Object.fromEntries(Object.entries(items).filter(([k]) => k.startsWith(SYNC_PREFIX)));
  const remote = fromSyncItems(items);
  if (remote && !state.syncJoined) Object.assign(state, mergeSynced(state, remote));
  else if (remote && !state.syncDirty) Object.assign(state, remote);
  state.syncJoined = true;
  synced.ready = true;
  syncStore.onChange(onSyncChange);
  persist(); // writes this device's data when sync lacks it
}

// Starred places or fees changed on another device.
function onSyncChange(changes) {
  const keys = Object.keys(changes).filter(k => k.startsWith(SYNC_PREFIX)
    && JSON.stringify(changes[k].newValue) !== JSON.stringify(synced.items[k]));
  if (!keys.length) return; // the echo of our own write
  for (const k of keys) {
    if (changes[k].newValue === undefined) delete synced.items[k];
    else synced.items[k] = changes[k].newValue;
  }
  const remote = fromSyncItems(synced.items) || { myPlaces: {}, feeOverrides: {} };
  const { cities, fees } = changedParts(keys);
  for (const city of cities) state.myPlaces[city] = remote.myPlaces[city] || {};
  if (fees) state.feeOverrides = remote.feeOverrides;
  saveLocal();
  if (!cities.has(state.city) && !fees) return;
  renderSlots();
  renderTable();
  renderMine();
  renderPlaceResult();
  if (!$('#tab-mine').hidden) loadDeals(Object.keys(myPlaces()).map(Number));
}

// ---------- helpers ----------

function setStatus(text) {
  const el = $('#status');
  el.textContent = text || '';
  el.hidden = !text;
}

function showError(err) {
  const el = $('#error');
  if (!err) {
    el.hidden = true;
    return;
  }
  console.error(err);
  el.textContent = err instanceof ApiError || err.userFacing ? err.message : `Something went wrong: ${err.message}`;
  el.hidden = false;
}

function feeOf(typeId) {
  if (Object.hasOwn(state.feeOverrides, typeId)) return state.feeOverrides[typeId];
  return session.fees[typeId]?.annualFee ?? null;
}

const selectedCards = () => state.slots.map(s => s.card).filter(Boolean);
const haveTypeIds = () => state.slots.filter(s => s.card && s.have).map(s => s.card.typeId);
// yearlyValue() compares against one card: the first one the user has.
const baseTypeId = () => haveTypeIds()[0] ?? null;
const currentCategory = () => session.categories.find(c => c.id === state.categoryId) || null;

const myPlaces = () => (state.myPlaces[state.city] ||= {});
const isMine = id => Object.hasOwn(myPlaces(), id);

function toggleMine(place) {
  const mine = myPlaces();
  if (mine[place.id]) delete mine[place.id];
  else {
    mine[place.id] = { id: place.id, name: place.name, visits: DEFAULT_VISITS, bill: null };
    loadDeals([place.id]);
  }
  persist();
  renderTable();
  renderMine(true);
  renderPlaceResult();
}

// A <select> whose value is set after its options exist.
function selectEl(props, options, value) {
  const el = h('select', props, options);
  el.value = value ?? '';
  return el;
}

// Re-render without losing keyboard focus or a half-typed value: elements that should
// keep focus carry a data-focus key that is stable across renders.
function keepFocus(render) {
  const el = document.activeElement;
  const key = el?.dataset?.focus;
  const value = el?.tagName === 'INPUT' ? el.value : null;
  render();
  if (!key || el.isConnected) return;
  const next = document.querySelector(`[data-focus="${key}"]`);
  if (!next) return;
  if (value != null) next.value = value;
  next.focus();
}

function cardHeader(card) {
  return h('div', { class: 'mini-head' },
    h('span', { class: 'bank' }, card.bankName),
    h('span', { title: card.name }, card.name));
}

function bestLabel(best, cards) {
  if (!best.typeIds.length) return h('span', { class: 'muted' }, '—');
  const names = best.typeIds.map(id => cards.find(c => c.typeId === id)?.name);
  if (best.tie) return h('span', { class: 'tie', title: names.join(' = ') }, 'Tie');
  return h('span', { class: 'winner', title: names[0] }, names[0]);
}

const capText = cap => (cap?.status === 'parsed' ? `max ${fmt.rs(cap.value)}` : fmt.cap(cap));

// One card's offer in a table cell.
function offerCell(offer, { win, tie, bill }) {
  if (!offer?.covered) {
    const next = offer?.upcoming?.[0];
    return h('td', { class: 'offer none' },
      next ? h('span', { class: 'small muted' }, `${fmt.pct(next.pct)} from ${fmt.date(next.deal.start)}`) : h('span', { class: 'dash' }, '—'));
  }
  return h('td', { class: `offer${win ? ' win' : ''}${tie ? ' tie-cell' : ''}` },
    h('div', { class: 'pct' }, offer.flag === 'Up to' ? h('span', { class: 'upto' }, 'up to ') : null, fmt.pct(offer.pct)),
    h('div', { class: 'cap' }, capText(offer.cap)),
    offer.days ? h('span', { class: 'badge' }, fmt.days(offer.days)) : null,
    offer.status === 'ending-soon' ? h('span', { class: 'badge warn' }, `ends ${fmt.date(offer.deal.end)}`) : null,
    bill > 0 && offer.saving != null ? h('div', { class: 'saves' }, `saves ${fmt.rs(offer.saving)}`) : null);
}

// ---------- data loading ----------

async function loadCityData() {
  const city = state.city;
  if (!city) return;
  session.cityLoading = true;
  renderQuestion();
  try {
    setStatus(`Loading banks and categories for ${city}…`);
    const categories = await api.getCategories(city);
    if (city !== state.city) return;
    session.categories = categories;
    renderQuestion();
    const banks = await api.getBanks(city);
    if (city !== state.city) return;
    session.banks = banks;
    showError(null);
  } catch (err) {
    if (city === state.city) showError(err);
  } finally {
    if (city === state.city) {
      session.cityLoading = false;
      setStatus('');
    }
  }
  if (city !== state.city) return;
  renderQuestion();
  renderHeader();
  renderSlots();
  renderTable();
  for (const id of new Set(state.slots.map(s => s.bankId).filter(Boolean))) loadBankCards(id);
  scheduleCompare();
}

async function loadBankCards(bankId) {
  const known = session.bankCards.get(bankId);
  if (known) return; // loaded or loading
  const city = state.city;
  session.bankCards.set(bankId, 'loading');
  renderSlotsWithBank(bankId);
  try {
    const cards = await api.getCards(bankId, city);
    if (city !== state.city) return;
    session.bankCards.set(bankId, cards);
    showError(null);
  } catch (err) {
    session.bankCards.delete(bankId);
    showError(err);
  }
  renderSlotsWithBank(bankId);
}

/**
 * Load one card's places, or join the load already running, so that overlapping
 * compares (the user is still picking cards) never fetch the same list twice.
 */
function placesJob(card, city, category) {
  const key = cacheKeys.places(card.typeId, city, category?.id);
  let job = session.places.get(key);
  if (job) return job;
  job = { card, loaded: 0, total: null, done: false };
  job.promise = api.getPlaces(card, city, category, ({ loaded, total }) => {
    Object.assign(job, { loaded, total });
    onPlacesProgress();
  });
  job.promise.then(
    () => {
      job.done = true;
      onPlacesProgress();
    },
    () => {
      // The compare that awaits this job reports the error; the next one tries again.
      if (session.places.get(key) === job) session.places.delete(key);
    });
  session.places.set(key, job);
  return job;
}

function onPlacesProgress() {
  const jobs = session.compareJobs;
  if (!jobs) return;
  const part = j => (j.done ? 1 : j.total ? j.loaded / j.total : 0);
  const fraction = jobs.reduce((sum, j) => sum + part(j), 0) / jobs.length;
  const current = jobs.find(j => !j.done);
  showProgress(current
    ? (current.total ? `Loading ${current.card.name}: ${current.loaded} of ${current.total}` : `Loading ${current.card.name}…`)
    : 'Lining up the table…', fraction);
}

const compareSig = (cards, city, category) => [city, category?.id ?? '', ...cards.map(c => c.typeId)].join('|');

// Compare runs by itself whenever the chosen cards, city or category change.
function scheduleCompare() {
  clearTimeout(session.compareTimer);
  session.compareTimer = setTimeout(() => compare(), COMPARE_DELAY_MS);
}

async function compare({ force = false } = {}) {
  const city = state.city;
  if (!city) return;
  if (state.categoryId != null && !session.categories.length) return; // loadCityData calls back
  const cards = selectedCards();
  const category = currentCategory();
  const sig = compareSig(cards, city, category);
  if (!force && sig === session.compareSig) return;
  session.compareSig = sig;
  const seq = ++session.compareSeq; // a newer compare makes this one stale

  if (!cards.length) {
    session.compareJobs = null;
    hideProgress();
    $('#refresh').disabled = false;
    session.compared = null;
    session.rows = [];
    session.rowById = new Map();
    renderCompareTab();
    renderSlotFooters();
    return;
  }

  $('#refresh').disabled = true;
  const jobs = cards.map(card => placesJob(card, city, category));
  session.compareJobs = jobs;
  onPlacesProgress();
  renderTable();
  try {
    const results = await Promise.all(jobs.map(j => j.promise));
    if (seq !== session.compareSeq) return;
    session.compared = { cards, city, category };
    session.rows = buildRows(cards, new Map(cards.map((card, i) => [card.typeId, results[i]])));
    session.rowById = new Map(session.rows.map(r => [r.place.id, r]));
    session.page = 0;
    session.expanded.clear();
    showError(null);
  } catch (err) {
    if (seq !== session.compareSeq) return;
    session.compareSig = null; // allow a retry with the same setup
    showError(err);
  } finally {
    if (seq === session.compareSeq) {
      session.compareJobs = null;
      hideProgress();
      $('#refresh').disabled = false;
    }
  }
  if (seq !== session.compareSeq) return;
  renderCompareTab();
  renderSlotFooters();
  renderMine();
  if (session.compared) prefetchDeals();
}

/** Load deals (caps, days, dates) for places, one request at a time. */
async function loadDeals(placeIds) {
  const todo = [...new Set(placeIds)].filter(id => !session.deals.has(id) && !session.dealsLoading.has(id));
  if (!todo.length) return;
  const city = state.city;
  todo.forEach(id => session.dealsLoading.add(id));
  renderTable();
  try {
    for (let i = 0; i < todo.length; i++) {
      if (todo.length > 1) setStatus(`Loading caps and days: ${i + 1} of ${todo.length}`);
      const deals = await api.getDeals(todo[i], city);
      if (city !== state.city) return;
      session.deals.set(todo[i], deals);
      session.dealsLoading.delete(todo[i]);
      renderTable();
      renderMine();
      renderPlaceResult();
    }
    showError(null);
  } catch (err) {
    showError(err);
  } finally {
    todo.forEach(id => session.dealsLoading.delete(id));
    if (todo.length > 1) setStatus('');
    renderTable();
  }
}

/**
 * Load deals (caps, days, dates) for every place in the comparison, like the percentages,
 * one request at a time. The next place is picked on every step: the page on screen first,
 * then the table's order. A newer compare or city stops it; an error pauses it until Retry.
 */
async function prefetchDeals() {
  const seq = session.compareSeq;
  const city = state.city;
  const live = () => seq === session.compareSeq && city === state.city;
  const need = r => !session.deals.has(r.place.id) && !session.dealsLoading.has(r.place.id);
  session.capsPaused = false;
  renderTable();
  while (live()) {
    const { rows, visible } = session.shown;
    const next = visible.find(need) || rows.find(need) || session.rows.find(need);
    if (!next) break;
    const id = next.place.id;
    const total = session.rows.length;
    const done = session.rows.filter(r => session.deals.has(r.place.id)).length;
    showProgress(`Loading caps: ${done} of ${total} places`, done / total);
    session.dealsLoading.add(id);
    try {
      const deals = await api.getDeals(id, city);
      if (city === state.city) session.deals.set(id, deals);
    } catch (err) {
      if (live()) {
        session.capsPaused = true;
        showError(err);
      }
      break;
    } finally {
      session.dealsLoading.delete(id);
    }
    if (!live()) return;
    renderTable();
    renderMine();
    renderPlaceResult();
  }
  if (!live()) return;
  hideProgress();
  if (!session.capsPaused) showError(null);
  renderTable();
}

async function refresh() {
  if (session.compareJobs) return;
  const city = state.city;
  const typeIds = new Set(selectedCards().map(c => String(c.typeId)));
  const placeIds = new Set([...session.deals.keys(), ...Object.keys(myPlaces()).map(Number)].map(String));
  await chromeCache.clear(key => {
    const [kind, id, keyCity] = key.split(':');
    if (kind === 'places') return typeIds.has(id) && keyCity === city;
    if (kind === 'deals') return placeIds.has(id) && keyCity === city;
    return false;
  });
  session.deals.clear();
  session.places.clear();
  await compare({ force: true });
  loadDeals(Object.keys(myPlaces()).map(Number));
  if (session.search.place) loadDeals([session.search.place.id]);
}

// ---------- steps ----------

function goStep(step) {
  state.step = step;
  persist();
  renderStep();
}

function renderStep() {
  const asking = state.step !== 'cards';
  $('#questions').hidden = !asking;
  $('#cards-step').hidden = asking;
  if (asking) {
    $('#question').replaceChildren();
    return renderQuestion();
  }
  renderHeader();
  renderSlots();
  renderCompareTab();
  renderMine(true);
  renderPlaceResult();
}

function pickCity(name) {
  const changed = name !== state.city;
  state.city = name;
  state.step = 'category';
  persist();
  if (changed) {
    session.banks = [];
    session.categories = [];
    session.bankCards.clear();
    session.deals.clear();
    session.search.place = null;
    $('#search').value = '';
    $('#search-results').hidden = true;
    loadCityData();
  }
  renderStep();
}

function pickCategory(id) {
  state.categoryId = id;
  goStep('cards');
  scheduleCompare();
}

function chip(label, on, onclick) {
  return h('button', { type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick }, label);
}

function renderQuestion() {
  const box = $('#question');
  if (state.step === 'city') {
    const chipBox = h('div', { class: 'chips' }, Object.keys(CITIES).map(name => chip(name, name === state.city, () => pickCity(name))));
    const existing = box.querySelector('.question[data-step="city"]');
    if (existing) return existing.querySelector('.chips').replaceWith(chipBox);
    box.replaceChildren(h('div', { class: 'question pop', 'data-step': 'city' },
      h('div', { class: 'eyebrow' }, 'Question 1 of 2'),
      h('h1', { class: 'title' }, 'Which city do you shop in?'),
      h('p', {}, 'Deals differ by city. You can change this later.'),
      chipBox));
    return;
  }
  if (state.step !== 'category') return;
  const picked = state.categoryId !== undefined;
  const chips = [{ id: null, name: 'All categories' }, ...session.categories]
    .map(c => chip(c.name, picked && (state.categoryId ?? null) === c.id, () => pickCategory(c.id)));
  let note = null;
  if (!session.categories.length) {
    note = session.cityLoading
      ? h('span', { class: 'chips-note' }, 'Loading categories…')
      : h('button', { type: 'button', class: 'chip', onclick: loadCityData }, 'Try loading categories again');
  }
  // Keep the card (and its entrance animation) when only the chips change; renderStep starts afresh.
  const existing = box.querySelector('.question[data-step="category"]');
  const chipBox = h('div', { class: 'chips' }, chips, note);
  if (existing) return existing.querySelector('.chips').replaceWith(chipBox);
  box.replaceChildren(h('div', { class: 'question pop', 'data-step': 'category' },
    h('div', { class: 'question-top' },
      h('div', { class: 'eyebrow' }, 'Question 2 of 2'),
      h('button', { type: 'button', class: 'back', onclick: () => goStep('city') }, `← ${state.city}`)),
    h('h1', { class: 'title' }, 'What do you spend on most?'),
    h('p', {}, 'We’ll compare deals in this category.'),
    chipBox));
}

function renderHeader() {
  $('#pill-city b').textContent = state.city || '';
  $('#pill-category b').textContent = currentCategory()?.name ?? (state.categoryId == null ? 'All categories' : '…');
}

// ---------- card slots ----------

function uiOf(slot) {
  let ui = session.slotUi.get(slot);
  if (!ui) session.slotUi.set(slot, (ui = { mounted: false, revealed: null, editing: false }));
  return ui;
}

const matchesType = (card, type) => (type === 'NONE' ? !['CREDIT', 'DEBIT'].includes(card.cardType) : card.cardType === type);

function renderSlots() {
  if (state.step !== 'cards') return;
  keepFocus(() => {
    $('#slots').replaceChildren(
      ...state.slots.map((slot, i) => slotView(slot, i)),
      state.slots.length < MAX_CARDS
        ? h('button', { type: 'button', class: 'add-slot', 'aria-label': 'Add another card', onclick: addSlot },
          h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'),
          `Add card (${state.slots.length + 1} of ${MAX_CARDS})`)
        : null);
  });
}

function renderSlotAt(i) {
  if (state.step !== 'cards') return;
  keepFocus(() => $('#slots').children[i]?.replaceWith(slotView(state.slots[i], i)));
}

function renderSlotsWithBank(bankId) {
  state.slots.forEach((s, i) => s.bankId === bankId && renderSlotAt(i));
}

function slotView(slot, i) {
  const ui = uiOf(slot);
  const animate = !ui.mounted;
  ui.mounted = true;
  const list = session.bankCards.get(slot.bankId);
  const loaded = Array.isArray(list);
  // Until the bank's cards load, the saved card is the only option.
  const cards = loaded ? list : slot.card ? [slot.card] : [];
  const types = ['CREDIT', 'DEBIT', ...(cards.some(c => matchesType(c, 'NONE')) ? ['NONE'] : [])];
  const options = cards.filter(c => matchesType(c, slot.cardType));
  const used = new Set(state.slots.filter(s => s !== slot && s.card).map(s => s.card.typeId));

  let placeholder = 'Pick a card';
  if (!slot.bankId) placeholder = 'Pick a bank first';
  else if (list === 'loading' && !options.length) placeholder = 'Loading cards…';
  else if (loaded && !options.length) placeholder = `No ${fmt.cardType(slot.cardType).toLowerCase()} cards`;

  const bankOption = b => h('option', { value: b.id }, b.name);
  const banks = session.banks.filter(b => b.isBank);
  const others = session.banks.filter(b => !b.isBank);
  const savedBank = slot.bankId && !session.banks.some(b => b.id === slot.bankId) && slot.card
    ? h('option', { value: slot.bankId }, slot.card.bankName) : null;

  return h('div', { class: `slot${animate ? ' pop' : ''}`, style: animate && i < 2 ? `animation-delay:${i * 0.12}s` : null },
    h('div', { class: 'slot-head' },
      h('div', { class: 'slot-title' }, `Card ${i + 1}`),
      state.slots.length > MIN_SLOTS
        ? h('button', { type: 'button', class: 'round-x', 'aria-label': `Remove card ${i + 1}`, onclick: () => removeSlot(i) }, '×')
        : null),
    h('label', { class: 'slot-field' }, 'Bank',
      selectEl({ 'data-focus': `s${i}-bank`, onchange: e => setBank(i, Number(e.target.value) || null) }, [
        h('option', { value: '' }, session.banks.length || savedBank ? 'Pick a bank' : session.cityLoading ? 'Loading banks…' : 'No banks loaded'),
        savedBank,
        banks.length ? h('optgroup', { label: 'Banks' }, banks.map(bankOption)) : null,
        others.length ? h('optgroup', { label: 'Other issuers' }, others.map(bankOption)) : null,
      ], slot.bankId)),
    h('div', { class: 'slot-field' }, 'Card type',
      h('div', { class: 'segment', role: 'group', 'aria-label': 'Card type' }, types.map(t =>
        h('button', { type: 'button', 'data-focus': `s${i}-type-${t}`, 'aria-pressed': String(slot.cardType === t), onclick: () => setType(i, t) }, fmt.cardType(t))))),
    h('label', { class: 'slot-field' }, 'Card',
      selectEl({ 'data-focus': `s${i}-card`, disabled: !options.length, onchange: e => setCard(i, Number(e.target.value) || null) }, [
        h('option', { value: '' }, placeholder),
        options.map(c => h('option', { value: c.typeId, disabled: used.has(c.typeId) }, c.name)),
      ], slot.card?.typeId)),
    h('button', { type: 'button', class: 'toggle', 'data-focus': `s${i}-have`, 'aria-pressed': String(slot.have), onclick: () => toggleHave(i) },
      h('span', { class: 'track', 'aria-hidden': 'true' }),
      'I already have this card'),
    slot.card ? infoPanel(slot, i, ui) : null);
}

function infoPanel(slot, i, ui) {
  const card = slot.card;
  const reveal = ui.revealed !== card.typeId;
  ui.revealed = card.typeId;
  const info = session.fees[card.typeId];
  const overridden = Object.hasOwn(state.feeOverrides, card.typeId);
  const fee = feeOf(card.typeId);
  const editing = ui.editing;
  const badge = fee == null ? ['Unknown', ''] : overridden ? ['Your value', ''] : info?.verified ? ['Verified', ' verified'] : ['Unverified', ''];

  let feeBlock;
  if (fee != null && !editing) {
    const sourceName = info?.sourceName || (info?.source ? 'source' : null);
    const source = overridden ? 'Typed by you'
      : [sourceName && info?.source ? h('a', { href: info.source, target: '_blank', rel: 'noopener' }, sourceName) : sourceName, info?.effective]
        .filter(Boolean).flatMap((x, k) => (k ? [' · ', x] : [x]));
    feeBlock = h('div', {},
      h('div', { class: 'fee-amount' }, fmt.rs(fee)),
      h('div', { class: 'fee-sub' },
        h('span', {}, source),
        h('button', { type: 'button', class: 'link-btn', onclick: () => editFee(i) }, 'Edit'),
        overridden ? h('button', { type: 'button', class: 'link-btn', onclick: () => setFee(card.typeId, null) }, 'Reset') : null));
  } else {
    // Saved on Enter or when the field loses focus, not on every keystroke.
    const commit = input => {
      if (input.dataset.done) return;
      input.dataset.done = '1';
      const raw = input.value.trim();
      const wasEditing = ui.editing;
      ui.editing = false;
      if (raw !== '') setFee(card.typeId, Math.max(0, Number(raw)));
      else if (wasEditing) renderSlotAt(state.slots.indexOf(slot));
    };
    feeBlock = h('div', { class: 'fee-edit' },
      h('div', { class: 'fee-edit-prompt' }, editing ? 'Enter the annual fee.' : 'Fee not known yet. Enter it if you know it.'),
      h('div', { class: 'fee-edit-row' },
        h('input', {
          type: 'number', min: 0, step: 500, placeholder: 'Rs', class: 'fee-input', value: fee ?? '',
          'aria-label': `Annual fee for ${card.name} in rupees`, 'data-focus': `s${i}-fee`,
          onkeydown: e => {
            if (e.key === 'Enter') commit(e.target);
            if (e.key === 'Escape' && ui.editing) {
              e.target.dataset.done = '1';
              ui.editing = false;
              renderSlotAt(state.slots.indexOf(slot));
            }
          },
          onblur: e => commit(e.target),
        }),
        h('span', {}, 'Press Enter to save')));
  }

  return h('div', { class: `info${reveal ? ' reveal' : ''}` },
    h('div', { class: 'info-row' },
      h('div', { class: 'info-label' }, 'Annual fee'),
      h('span', { class: `fee-badge${badge[1]}` }, badge[0])),
    feeBlock,
    info?.reversal ? h('div', { class: 'info-section' },
      h('div', { class: 'info-label' }, 'Fee reversal'),
      h('div', { class: 'info-text' }, info.reversal)) : null,
    info?.note ? h('div', { class: 'info-note' }, info.note) : null,
    slotFooter(card));
}

// "N of M places · best X%" for one card, from the last compare.
function slotFooter(card) {
  const c = session.compared;
  let body;
  if (c && c.cards.some(x => x.typeId === card.typeId)) {
    const pcts = session.rows.map(r => r.listed[card.typeId]?.pct).filter(p => p != null);
    body = [
      h('div', {}, h('strong', {}, pcts.length), ` of ${session.rows.length} places`),
      h('div', {}, `best ${pcts.length ? fmt.pct(Math.max(...pcts)) : '—'}`),
    ];
  } else {
    body = [h('div', {}, session.compareJobs ? 'Loading places…' : 'Places not loaded')];
  }
  return h('div', { class: 'info-foot', 'data-type': card.typeId }, body);
}

// Update only the footers, so a finished compare doesn't close an open dropdown.
function renderSlotFooters() {
  for (const el of document.querySelectorAll('#slots .info-foot')) {
    const card = selectedCards().find(c => String(c.typeId) === el.dataset.type);
    if (card) el.replaceWith(slotFooter(card));
  }
}

function onCardsChanged() {
  persist();
  renderSlots();
  scheduleCompare();
  renderMine();
  renderPlaceResult();
}

function setBank(i, bankId) {
  const slot = state.slots[i];
  if (slot.bankId === bankId) return;
  slot.bankId = bankId;
  slot.card = null;
  if (bankId) loadBankCards(bankId);
  onCardsChanged();
}

function setType(i, type) {
  const slot = state.slots[i];
  if (slot.cardType === type) return;
  slot.cardType = type;
  if (slot.card && !matchesType(slot.card, type)) {
    slot.card = null;
    return onCardsChanged();
  }
  persist();
  renderSlotAt(i);
}

function setCard(i, typeId) {
  const slot = state.slots[i];
  const list = session.bankCards.get(slot.bankId);
  const pool = Array.isArray(list) ? list : slot.card ? [slot.card] : [];
  slot.card = pool.find(c => c.typeId === typeId) || null;
  uiOf(slot).editing = false;
  onCardsChanged();
}

function toggleHave(i) {
  state.slots[i].have = !state.slots[i].have;
  persist();
  renderSlotAt(i);
  renderViews();
  renderTable();
  renderMine();
}

function addSlot() {
  if (state.slots.length >= MAX_CARDS) return;
  state.slots.push(newSlot());
  persist();
  renderSlots();
}

function removeSlot(i) {
  const [slot] = state.slots.splice(i, 1);
  if (slot.card) onCardsChanged();
  else {
    persist();
    renderSlots();
  }
}

function editFee(i) {
  uiOf(state.slots[i]).editing = true;
  renderSlotAt(i);
  const input = $('#slots').children[i]?.querySelector('.fee-input');
  input?.focus();
  input?.select();
}

function setFee(typeId, value) {
  if (value == null) delete state.feeOverrides[typeId];
  else state.feeOverrides[typeId] = value;
  persist();
  state.slots.forEach((s, i) => s.card?.typeId === typeId && renderSlotAt(i));
  renderTable();
  renderMine();
}

// ---------- compare tab ----------

function renderCompareTab() {
  renderViews();
  renderSortControls();
  renderTable();
}

function renderViews() {
  const cards = session.compared?.cards || [];
  const have = haveTypeIds().filter(id => cards.some(c => c.typeId === id));
  const options = [['all', VIEWS.all]];
  if (cards.length > 1) {
    options.push(['common', VIEWS.common], ['unique', VIEWS.unique], ...cards.map(c => [`only:${c.typeId}`, `Only ${c.name} has a deal`]));
  }
  if (have.length && have.length < cards.length) options.push(['gain', VIEWS.gain]);
  const view = options.some(([v]) => v === state.view) ? state.view : 'all';
  $('#view').replaceChildren(...options.map(([value, label]) => h('option', { value }, label)));
  $('#view').value = view;
}

function sortTarget(cards) {
  return cards.some(c => c.typeId === state.sortTypeId) ? state.sortTypeId : null;
}

function renderSortControls() {
  const cards = session.compared?.cards || [];
  const sort = $('#sort');
  sort.replaceChildren(
    h('option', { value: 'pct' }, state.bill > 0 ? 'Most saved on your bill' : 'Highest discount %'),
    h('option', { value: 'cap' }, 'Highest max cap'),
    h('option', { value: 'name' }, 'Place name'));
  sort.value = state.sort;
  $('#sort-card-wrap').hidden = state.sort === 'name' || cards.length < 2;
  const target = sortTarget(cards);
  $('#sort-card').replaceChildren(
    h('option', { value: 'any' }, 'Any card (best offer)'),
    ...cards.map(c => h('option', { value: c.typeId }, c.name)));
  $('#sort-card').value = target ?? 'any';
}

function currentRows() {
  if (!session.compared) return [];
  const { cards } = session.compared;
  const bill = state.bill;
  const view = $('#view').value || 'all';
  let rows = session.rows.map(r => ({ ...r, ...evaluate(cards, r.listed, session.deals.get(r.place.id), bill) }));
  rows = filterRows(rows, view, cards, { haveTypeIds: haveTypeIds(), bill });
  const q = session.nameFilter.trim().toLowerCase();
  if (q) rows = rows.filter(r => r.place.name.toLowerCase().includes(q));
  return sortRows(rows, cards, { sort: state.sort, targetTypeId: sortTarget(cards), bill });
}

function renderTable() {
  const table = $('#table');
  const compared = session.compared;
  const category = currentCategory();
  $('#table-title').textContent = `${category?.name ?? (state.categoryId == null ? 'All places' : 'Places')} in ${state.city ?? ''}`;
  const message = text => {
    session.shown = { rows: [], visible: [] };
    table.replaceChildren(h('tbody', {}, h('tr', {}, h('td', { class: 'empty' }, text))));
    $('#table-controls').hidden = true;
    $('#table-count').textContent = '';
    $('#summary').textContent = '';
    $('#pager').replaceChildren();
    $('#load-caps').hidden = true;
    $('#export').disabled = true;
  };
  if (!selectedCards().length) return message('Pick a card above and its deals show up here.');
  if (!compared) return message(session.compareJobs || session.cityLoading ? 'Loading places…' : 'Places not loaded yet.');

  const { cards } = compared;
  const bill = state.bill;
  const have = new Set(haveTypeIds());
  const target = state.sort === 'name' ? null : sortTarget(cards);
  const rows = currentRows();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  session.page = Math.min(session.page, pages - 1);
  const visible = rows.slice(session.page * PAGE_SIZE, (session.page + 1) * PAGE_SIZE);
  session.shown = { rows, visible };
  const total = session.rows.length;

  $('#table-controls').hidden = false;
  $('#table-count').textContent = `${rows.length < total ? `${rows.length} of ` : ''}${total} places`;
  $('#summary').textContent = bill > 0
    ? `Savings on a ${fmt.rs(bill)} bill, caps included once loaded.`
    : 'Enter a typical bill to rank by rupees saved, caps included.';

  const sortedBy = state.sort === 'cap' ? ' · sorted by cap ↓' : bill > 0 ? ' · sorted by saving ↓' : ' · sorted by % ↓';
  const head = h('thead', {}, h('tr', {},
    h('th', {}, 'Place'),
    cards.map(c => h('th', { class: `card-col${c.typeId === target ? ' sorted' : ''}` },
      h('div', { class: 'card-head' },
        h('div', { class: 'bank' }, c.bankName, c.typeId === target ? sortedBy : ''),
        h('div', { class: 'name' }, c.name, have.has(c.typeId) ? h('span', { class: 'have-pill' }, 'You have it') : null)))),
    h('th', {}, 'Best')));

  const fees = cards.map(c => feeOf(c.typeId));
  const priced = cards.filter((c, i) => fees[i] != null);
  let lowest = '';
  if (priced.length > 1) {
    const min = Math.min(...priced.map(c => feeOf(c.typeId)));
    const cheapest = priced.filter(c => feeOf(c.typeId) === min);
    lowest = cheapest.length > 1 ? 'Lowest: Tie' : `Lowest: ${cheapest[0].name}`;
  }
  const body = h('tbody', {},
    h('tr', { class: 'fee-row' },
      h('td', { class: 'label' }, 'Annual fee'),
      fees.map(f => h('td', { class: 'fee' }, f == null ? 'Unknown' : fmt.rs(f))),
      h('td', { class: 'lowest' }, lowest)));
  if (!visible.length) {
    const q = session.nameFilter.trim();
    body.append(h('tr', {}, h('td', { class: 'empty', colspan: cards.length + 2 },
      q ? `No places match “${q}”.` : 'No places match this filter.')));
  }
  const multi = cards.length > 1;
  for (const row of visible) {
    const id = row.place.id;
    const open = session.expanded.has(id);
    body.append(h('tr', { class: open ? 'open' : null },
      h('td', {}, h('div', { class: 'place-cell' },
        starButton(row.place),
        h('div', {},
          h('button', { type: 'button', class: 'place-name', 'aria-expanded': String(open), onclick: () => toggleRow(id) }, row.place.name),
          row.place.onlineOnly ? h('div', {}, h('span', { class: 'badge' }, 'Online only')) : null,
          session.dealsLoading.has(id) ? h('div', { class: 'small muted' }, 'loading…') : null))),
      cards.map(c => offerCell(row.offers[c.typeId], {
        win: multi && row.best.typeIds.includes(c.typeId) && !row.best.tie,
        tie: multi && row.best.tie && row.best.typeIds.includes(c.typeId),
        bill,
      })),
      h('td', { class: 'best-cell' }, bestLabel(row.best, cards))));
    if (open) body.append(h('tr', { class: 'detail' }, h('td', { colspan: cards.length + 2 }, dealDetails(id, cards))));
  }
  table.replaceChildren(head, body);

  $('#pager').replaceChildren(...(pages > 1 ? [
    h('button', { type: 'button', class: 'ghost', disabled: session.page === 0, onclick: () => { session.page--; renderTable(); } }, '‹ Previous'),
    h('span', {}, `${session.page * PAGE_SIZE + 1}–${session.page * PAGE_SIZE + visible.length} of ${rows.length}`),
    h('button', { type: 'button', class: 'ghost', disabled: session.page >= pages - 1, onclick: () => { session.page++; renderTable(); } }, 'Next ›'),
  ] : []));

  // Caps load by themselves (prefetchDeals); this button only shows after an error paused that.
  const capsButton = $('#load-caps');
  capsButton.hidden = !session.capsPaused;
  capsButton.textContent = 'Retry loading caps';
  capsButton.onclick = () => prefetchDeals();
  $('#export').disabled = !rows.length;
}

// Link to the place's own page at the data source: branches, menu, reviews and every deal.
function placeLink(place, text = 'Place details ↗') {
  return h('a', {
    class: 'source-link', href: fmt.placeUrl(state.city, place), target: '_blank', rel: 'noopener',
    title: `${place.name}: branches, menu, reviews and every deal`,
  }, text);
}

function starButton(place) {
  const on = isMine(place.id);
  return h('button', {
    type: 'button', class: `star${on ? ' on' : ''}`, 'aria-pressed': String(on),
    'aria-label': on ? `Remove ${place.name} from my places` : `Add ${place.name} to my places`,
    title: on ? 'Remove from my places' : 'I go here',
    onclick: () => toggleMine(place),
  }, on ? '★' : '☆');
}

function toggleRow(id) {
  if (session.expanded.has(id)) session.expanded.delete(id);
  else {
    session.expanded.add(id);
    loadDeals([id]);
  }
  renderTable();
}

// All deals for the selected cards at one place.
function dealDetails(placeId, cards) {
  const deals = session.deals.get(placeId);
  if (!deals) return h('p', { class: 'muted' }, session.dealsLoading.has(placeId) ? 'Loading deals…' : 'Deals not loaded.');
  const place = session.rowById.get(placeId)?.place;
  return h('div', {},
    h('div', { class: 'details' }, cards.map(card => {
      const options = cardDeals(card, deals, state.bill).filter(o => o.status !== 'expired');
      return h('div', { class: 'detail-card' },
        h('h3', {}, card.name),
        options.length ? options.map(o => dealBlock(o)) : h('p', { class: 'muted' }, 'No current deal for this card here.'));
    })),
    place ? h('p', { class: 'small source-line' }, 'All deals, branches and the menu: ', placeLink(place, `${place.name} ↗`)) : null);
}

function dealBlock(o) {
  const d = o.deal;
  const statusBadge = {
    'ending-soon': h('span', { class: 'badge warn' }, 'ends soon'),
    upcoming: h('span', { class: 'badge' }, `starts ${fmt.date(d.start)}`),
  }[o.status];
  return h('div', { class: 'deal' },
    h('div', {}, h('strong', {}, d.title), ' ', statusBadge || null),
    h('div', { class: 'small' }, [fmt.cap(o.cap), fmt.days(d.days), `valid ${fmt.date(d.start)} to ${fmt.date(d.end)}`].join(' · ')),
    o.cap.line ? h('div', { class: 'small muted' }, `“${o.cap.line.replace(/^\*\s*/, '')}”`) : null,
    d.branches.length ? h('div', { class: 'small muted' }, `${d.branches.length} branch${d.branches.length === 1 ? '' : 'es'}: ${d.branches.join(', ')}`) : null,
    h('details', {}, h('summary', { class: 'small' }, 'Full terms'), h('pre', { class: 'terms' }, d.description)));
}

function exportCsv() {
  const { cards, city, category } = session.compared;
  const bill = state.bill;
  const header = ['Place', 'Online only'];
  for (const c of cards) header.push(`${c.name} %`, `${c.name} cap`, `${c.name} days`, `${c.name} ends`, ...(bill > 0 ? [`${c.name} saving`] : []));
  header.push('Best', 'Place page');
  const lines = currentRows().map(r => {
    const line = [r.place.name, r.place.onlineOnly ? 'yes' : ''];
    for (const c of cards) {
      const o = r.offers[c.typeId];
      if (!o.covered) line.push('', '', '', '', ...(bill > 0 ? [''] : []));
      else line.push(o.pct, o.cap.status === 'parsed' ? o.cap.value : fmt.cap(o.cap), o.days ? fmt.days(o.days) : 'Every day', o.deal?.end?.slice(0, 10) ?? '', ...(bill > 0 ? [o.saving == null ? '' : Math.round(o.saving)] : []));
    }
    line.push(r.best.tie ? 'Tie' : cards.find(c => c.typeId === r.best.typeIds[0])?.name ?? '', fmt.placeUrl(city, r.place));
    return line;
  });
  const name = `card-compare-${city}${category ? '-' + category.slug : ''}-${new Date().toISOString().slice(0, 10)}.csv`.toLowerCase();
  download(name, toCsv([header, ...lines]));
}

// ---------- my places tab ----------

function myEntries(cards) {
  return Object.values(myPlaces()).map(p => {
    const bill = p.bill ?? state.bill;
    const deals = session.deals.get(p.id);
    const listed = session.rowById.get(p.id)?.listed;
    return { place: p, bill, visits: p.visits, ...evaluate(cards, listed, deals, bill) };
  });
}

function renderMine(forceList = false) {
  if (!state.city || state.step !== 'cards') return;
  $('#mine-city').textContent = state.city;
  renderValue();
  const list = $('#mine-list');
  if (!forceList && list.contains(document.activeElement)) return; // don't steal focus while typing
  renderMineList();
}

function renderValue() {
  const box = $('#value');
  const cards = selectedCards();
  const entries = myEntries(cards);
  if (!cards.length) return box.replaceChildren(h('p', { class: 'muted' }, 'Pick cards above to see their yearly value.'));
  if (!entries.length) return box.replaceChildren(h('p', { class: 'muted' }, 'No places yet. Star the places you go to.'));
  const priced = entries.filter(e => e.bill > 0);
  if (!priced.length) return box.replaceChildren(h('p', { class: 'warn' }, 'Enter a typical bill (Bill Rs, in the Compare places tab), or a bill for each place below.'));

  const fees = Object.fromEntries(cards.map(c => [c.typeId, feeOf(c.typeId)]));
  const baseId = baseTypeId();
  const value = yearlyValue(cards, priced, fees, baseId);
  const base = cards.find(c => c.typeId === baseId);
  const head = h('tr', {},
    h('th', {}, 'Card'), h('th', { class: 'num' }, 'Annual fee'), h('th', { class: 'num' }, 'Savings / year'),
    h('th', { class: 'num' }, 'Net / year'), h('th', { class: 'num', title: 'Yearly spend at these places needed for the savings to cover the fee' }, 'Break-even spend'),
    base ? h('th', { class: 'num' }, `Extra if added to ${base.name}`) : null,
    h('th', {}, 'Notes'));
  const rows = value.perCard.map(v => {
    const card = cards.find(c => c.typeId === v.typeId);
    const win = value.ranking.typeIds.includes(v.typeId);
    const notes = [];
    if (v.fee == null) notes.push('Fee unknown: not ranked.');
    if (v.capIssues) notes.push(`Cap not known at ${v.capIssues} place${v.capIssues === 1 ? '' : 's'}: savings may be lower.`);
    if (v.dayLimited) notes.push(`Only on some days at ${v.dayLimited} place${v.dayLimited === 1 ? '' : 's'}.`);
    if (!v.placesCovered) notes.push('No deal at your places.');
    return h('tr', { class: win ? 'win' : null },
      h('td', {}, card.name, win ? h('span', { class: 'badge good' }, value.ranking.tie ? 'Tie' : 'Best value') : null),
      h('td', { class: 'num' }, v.fee == null ? 'Fee unknown' : fmt.rs(v.fee)),
      h('td', { class: 'num' }, fmt.rs(v.savings)),
      h('td', { class: `num ${v.net < 0 ? 'neg' : ''}` }, v.net == null ? '—' : fmt.rs(v.net)),
      h('td', { class: 'num' }, v.breakEven == null ? '—' : fmt.rs(v.breakEven)),
      base ? h('td', { class: 'num' }, v.marginal
        ? (v.marginal.net == null ? `+${fmt.rs(v.marginal.gain)} (fee unknown)` : `+${fmt.rs(v.marginal.gain)} − fee = ${fmt.rs(v.marginal.net)}`)
        : h('span', { class: 'muted' }, 'you have this')) : null,
      h('td', { class: 'small' }, notes.join(' ')));
  });
  if (cards.length > 1) {
    rows.push(h('tr', { class: 'combined' },
      h('td', {}, `Carry all ${cards.length} cards, use the best one at each place`),
      h('td', { class: 'num' }, value.combined.fees == null ? 'Some fees unknown' : fmt.rs(value.combined.fees)),
      h('td', { class: 'num' }, fmt.rs(value.combined.savings)),
      h('td', { class: 'num' }, value.combined.net == null ? '—' : fmt.rs(value.combined.net)),
      h('td', {}), base ? h('td', {}) : null, h('td', {})));
  }
  const skipped = entries.length - priced.length;
  box.replaceChildren(
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid value' }, h('thead', {}, head), h('tbody', {}, rows))),
    h('p', { class: 'hint' },
      `Based on ${fmt.rs(value.spend)} a year at ${priced.length} place${priced.length === 1 ? '' : 's'}. `,
      'Assumes each visit falls on a valid day and the deals stay the same for a year. Fees exclude tax (FED).',
      skipped ? ` ${skipped} place${skipped === 1 ? ' has' : 's have'} no bill and ${skipped === 1 ? 'is' : 'are'} left out.` : ''));
}

function renderMineList() {
  const list = $('#mine-list');
  const cards = selectedCards();
  const entries = myEntries(cards);
  if (!entries.length) return list.replaceChildren();
  const update = (p, field) => e => {
    const raw = e.target.value.trim();
    p[field] = field === 'visits' ? Math.max(0, Number(raw) || 0) : raw === '' ? null : Math.max(0, Number(raw));
    persist();
    renderMine(true);
  };
  list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Place'), h('th', {}, 'Visits / year'), h('th', {}, 'Bill (Rs)'),
      cards.map(c => h('th', {}, cardHeader(c))), h('th', {}, 'Best'), h('th', {}))),
    h('tbody', {}, entries.map(e => h('tr', {},
      h('td', {}, e.place.name, session.dealsLoading.has(e.place.id) ? h('span', { class: 'small muted' }, ' loading…') : null,
        h('div', { class: 'small' }, placeLink(e.place))),
      h('td', {}, h('input', { type: 'number', min: 0, max: 365, class: 'narrow', value: e.place.visits, 'aria-label': `Visits a year to ${e.place.name}`, onchange: update(e.place, 'visits') })),
      h('td', {}, h('input', { type: 'number', min: 0, step: 500, class: 'narrow', value: e.place.bill ?? '', placeholder: state.bill ?? 'bill', 'aria-label': `Usual bill at ${e.place.name}`, onchange: update(e.place, 'bill') })),
      cards.map(c => offerCell(e.offers[c.typeId], {
        win: e.best.typeIds.includes(c.typeId) && !e.best.tie,
        tie: e.best.tie && e.best.typeIds.includes(c.typeId),
        bill: e.bill,
      })),
      h('td', {}, bestLabel(e.best, cards)),
      h('td', {}, h('button', { type: 'button', class: 'icon-x', 'aria-label': `Remove ${e.place.name}`, onclick: () => toggleMine(e.place) }, '×'))))))));
}

// ---------- check one place tab ----------

function onSearchInput() {
  clearTimeout(session.search.timer);
  const query = $('#search').value.trim();
  const results = $('#search-results');
  if (query.length < 2) {
    results.hidden = true;
    return;
  }
  session.search.timer = setTimeout(async () => {
    const seq = ++session.search.seq;
    try {
      const found = await api.searchPlaces(query, state.city);
      if (seq !== session.search.seq) return;
      results.replaceChildren(...(found.length
        ? found.map(p => h('li', {}, h('button', { type: 'button', onclick: () => choosePlace(p) }, p.name)))
        : [h('li', { class: 'muted' }, `No places found in ${state.city}.`)]));
      results.hidden = false;
      showError(null);
    } catch (err) {
      showError(err);
    }
  }, SEARCH_DEBOUNCE_MS);
}

function choosePlace(place) {
  session.search.place = place;
  $('#search-results').hidden = true;
  $('#search').value = place.name;
  loadDeals([place.id]);
  renderPlaceResult();
}

function renderPlaceResult() {
  const box = $('#place-result');
  const place = session.search.place;
  if (!place) return box.replaceChildren();
  const deals = session.deals.get(place.id);
  const on = isMine(place.id);
  const title = h('div', { class: 'place-title' },
    h('h2', {}, place.name),
    h('button', { type: 'button', class: 'ghost-sm', onclick: () => toggleMine(place) }, on ? '★ In my places' : '☆ Add to my places'),
    placeLink(place));
  if (!deals) return box.replaceChildren(title, h('p', { class: 'muted' }, 'Loading deals…'));

  const bill = state.bill;
  const cards = selectedCards();
  const { offers, best } = evaluate(cards, undefined, deals, bill);
  const yours = cards.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Your cards'), h('th', {}, 'Offer'), h('th', {}, 'Valid until'))),
      h('tbody', {}, cards.map(c => {
        const o = offers[c.typeId];
        return h('tr', {},
          h('td', {}, cardHeader(c)),
          offerCell(o, { win: best.typeIds.includes(c.typeId) && !best.tie, tie: best.tie && best.typeIds.includes(c.typeId), bill }),
          h('td', {}, o.covered ? fmt.date(o.deal.end) : ''));
      }))))
    : h('p', { class: 'muted' }, 'Pick cards above to compare them here.');

  // Every other current deal at this place, best % first: useful for "which card should I get?"
  const mineIds = new Set(cards.map(c => c.typeId));
  const all = deals
    .filter(d => !isTestDeal(d) && !d.cards.every(c => mineIds.has(c.typeId)))
    .filter(d => d.end == null || Date.parse(d.end) >= Date.now())
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const dealCaps = d => {
    const caps = d.cards.map(c => [c.name, fmt.cap(capForCard(d, c))]);
    if (new Set(caps.map(([, cap]) => cap)).size === 1) return caps[0][1];
    return caps.map(([name, cap]) => h('div', {}, `${name}: ${cap}`));
  };
  const allTable = all.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Bank'), h('th', {}, 'Cards'), h('th', {}, 'Offer'), h('th', {}, 'Cap'), h('th', {}, 'Ends'))),
      h('tbody', {}, all.map(d => h('tr', {},
        h('td', {}, d.bankName),
        h('td', { class: 'small' }, d.cards.map(c => c.name).join(', ')),
        h('td', {}, d.title),
        h('td', { class: 'small' }, dealCaps(d)),
        h('td', { class: 'small' }, fmt.date(d.end)))))))
    : h('p', { class: 'muted' }, 'No other deals here.');

  box.replaceChildren(title, yours, h('h2', {}, `Other cards with deals here (${all.length})`), allTable);
}

// ---------- tabs and events ----------

function showTab(name) {
  for (const btn of document.querySelectorAll('[role=tab]')) btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  for (const tab of ['compare', 'mine', 'place']) $(`#tab-${tab}`).hidden = tab !== name;
  if (name === 'mine') {
    loadDeals(Object.keys(myPlaces()).map(Number));
    renderMine(true);
  }
  if (name === 'place') $('#search').focus();
}

function bind() {
  $('#pill-city').addEventListener('click', () => goStep('city'));
  $('#pill-category').addEventListener('click', () => goStep('category'));
  $('#bill').addEventListener('input', e => {
    const v = Number(e.target.value);
    state.bill = e.target.value.trim() !== '' && v > 0 ? v : null;
    persist();
    renderSortControls();
    renderTable();
    renderMine();
    renderPlaceResult();
  });
  $('#view').addEventListener('change', e => {
    state.view = e.target.value;
    persist();
    session.page = 0;
    renderTable();
  });
  $('#sort').addEventListener('change', e => {
    state.sort = e.target.value;
    persist();
    renderSortControls();
    renderTable();
  });
  $('#sort-card').addEventListener('change', e => {
    state.sortTypeId = e.target.value === 'any' ? null : Number(e.target.value);
    persist();
    renderTable();
  });
  $('#name-filter').addEventListener('input', e => {
    session.nameFilter = e.target.value;
    session.page = 0;
    renderTable();
  });
  $('#export').addEventListener('click', exportCsv);
  $('#refresh').addEventListener('click', refresh);
  $('#search').addEventListener('input', onSearchInput);
  for (const btn of document.querySelectorAll('[role=tab]')) btn.addEventListener('click', () => showTab(btn.dataset.tab));
}

// Settings saved by the first version (a card list and one "I already have" card) become slots.
function migrate(saved) {
  const { cards, baseTypeId: oldBase, ...rest } = saved;
  const next = { ...state, ...rest };
  if (!saved.slots && Array.isArray(cards)) {
    next.slots = cards.slice(0, MAX_CARDS).map(card => ({ bankId: card.bankId ?? null, cardType: card.cardType, card, have: card.typeId === oldBase }));
  }
  if (!saved.step) next.step = 'cards'; // first-version users already chose a city
  if (!Array.isArray(next.slots)) next.slots = [];
  while (next.slots.length < MIN_SLOTS) next.slots.push(newSlot());
  return next;
}

async function init() {
  chromeCache.prune().catch(() => {});
  const saved = await loadState().catch(() => null);
  if (saved) state = migrate(saved);
  await joinSync().catch(err => console.warn('Sync storage unavailable; starred places stay on this device', err));
  if (state.city && !CITIES[state.city]) state.city = null;
  if (!state.city) state.step = 'city';
  session.fees = await fetch('data/fees.json').then(r => r.json()).then(j => j.cards || {}).catch(() => ({}));

  bind();
  $('#bill').value = state.bill ?? '';
  session.cityLoading = !!state.city;
  renderStep();
  await loadCityData();
}

init();
