// Comparison logic: join places across cards, pick each card's offer at a place,
// pick the better card, and estimate yearly value. No browser APIs.

import { ENDING_SOON_DAYS } from './config.js';
import { capOf, isTestDeal } from './parse.js';

const DAY_MS = 24 * 3600e3;
const RUPEE_EPSILON = 0.5;
const PCT_EPSILON = 0.05;

// 'expired' | 'upcoming' | 'ending-soon' | 'active'
export function dealStatus(deal, now = Date.now()) {
  const start = deal.start ? Date.parse(deal.start) : -Infinity;
  const end = deal.end ? Date.parse(deal.end) : Infinity;
  if (end < now) return 'expired';
  if (start > now) return 'upcoming';
  if (end - now <= ENDING_SOON_DAYS * DAY_MS) return 'ending-soon';
  return 'active';
}

const isUsable = status => status === 'active' || status === 'ending-soon';

/** Saving on one bill: min(pct × bill, cap). Without a parsed cap, pct × bill. */
export function savingFor(pct, cap, bill) {
  if (pct == null || !(bill > 0)) return null;
  const raw = (pct / 100) * bill;
  return cap?.status === 'parsed' ? Math.min(raw, cap.value) : raw;
}

export function capForCard(deal, card) {
  const own = deal.cards.find(c => c.typeId === card.typeId);
  return capOf(deal.description, own?.name ?? card.name, deal.cards.map(c => c.name));
}

// How generous a cap is, for tie-breaks. Only meaningful when the cap is known.
const capKnown = cap => cap?.status === 'parsed' || cap?.status === 'none';
const capSize = cap => (cap.status === 'none' ? Infinity : cap.value);

function compareCaps(a, b) {
  if (!capKnown(a) || !capKnown(b)) return 0;
  const x = capSize(a);
  const y = capSize(b);
  return x === y ? 0 : x > y ? 1 : -1;
}

// > 0 when offer `a` is better than `b`. With a bill: by saving. Without: by %, then cap.
export function compareOffers(a, b, bill) {
  if (bill > 0) {
    const d = (a.saving ?? -1) - (b.saving ?? -1);
    return Math.abs(d) < RUPEE_EPSILON ? 0 : Math.sign(d);
  }
  const d = (a.pct ?? -1) - (b.pct ?? -1);
  if (Math.abs(d) >= PCT_EPSILON) return Math.sign(d);
  return compareCaps(a.cap, b.cap);
}

// Order a card's deals at one place: best first. Every-day deals beat day-limited ones on a tie.
function compareOptions(a, b, bill) {
  return (
    compareOffers(b, a, bill) ||
    (b.pct ?? -1) - (a.pct ?? -1) ||
    compareCaps(b.cap, a.cap) ||
    (a.days ? 1 : 0) - (b.days ? 1 : 0)
  );
}

/** Every deal at a place that applies to `card`, with its cap and status. */
export function cardDeals(card, deals, bill = null, now = Date.now()) {
  return deals
    .filter(d => !isTestDeal(d) && d.cards.some(c => c.typeId === card.typeId))
    .map(deal => {
      const cap = capForCard(deal, card);
      return { deal, cap, pct: deal.pct, days: deal.days, status: dealStatus(deal, now), saving: savingFor(deal.pct, cap, bill) };
    });
}

/**
 * One card's offer at one place.
 *   listed: { pct, flag } from the card's place list (endpoint 4), or undefined.
 *   deals:  every deal at the place (endpoint 5), or undefined while not loaded.
 * Once deals are loaded they are the source of truth, because they carry caps,
 * days and dates. Before that, the listed % is used and the cap is 'not-loaded'.
 */
export function offerFor(card, listed, deals, bill = null, now = Date.now()) {
  if (!deals) {
    if (!listed || listed.pct == null) return { covered: false, loaded: false };
    const cap = { status: 'not-loaded' };
    return {
      covered: true, loaded: false, pct: listed.pct, flag: listed.flag ?? null, cap,
      days: null, saving: savingFor(listed.pct, cap, bill), deal: null, status: null, others: [],
    };
  }
  const options = cardDeals(card, deals, bill, now);
  const usable = options.filter(o => isUsable(o.status)).sort((a, b) => compareOptions(a, b, bill));
  const upcoming = options.filter(o => o.status === 'upcoming');
  if (!usable.length) return { covered: false, loaded: true, upcoming };
  const [best, ...others] = usable;
  return {
    covered: true, loaded: true, pct: best.pct, flag: others.length ? 'Up to' : null, cap: best.cap,
    days: best.days, saving: best.saving, deal: best.deal, status: best.status, others, upcoming,
  };
}

/** The best card(s) at one place. More than one card = a tie. */
export function bestOf(cards, offers, bill = null) {
  const covered = cards.filter(c => {
    const o = offers[c.typeId];
    return o?.covered && (bill > 0 ? o.saving != null : o.pct != null);
  });
  if (!covered.length) return { typeIds: [], tie: false };
  const top = covered.reduce((a, c) => (compareOffers(offers[c.typeId], offers[a.typeId], bill) > 0 ? c : a));
  const typeIds = covered
    .filter(c => compareOffers(offers[c.typeId], offers[top.typeId], bill) === 0)
    .map(c => c.typeId);
  return { typeIds, tie: typeIds.length > 1 };
}

/** Union of every selected card's places, keyed by merchant id. */
export function buildRows(cards, placesByCard) {
  const rows = new Map();
  for (const card of cards) {
    for (const place of placesByCard.get(card.typeId) || []) {
      let row = rows.get(place.id);
      if (!row) rows.set(place.id, (row = { place, listed: {} }));
      row.listed[card.typeId] = { pct: place.maxDiscount, flag: place.discountFlag };
    }
  }
  return [...rows.values()];
}

/** Offers for every selected card at one place, plus the winner. */
export function evaluate(cards, listed, deals, bill = null, now = Date.now()) {
  const offers = {};
  for (const card of cards) offers[card.typeId] = offerFor(card, listed?.[card.typeId], deals, bill, now);
  return { offers, best: bestOf(cards, offers, bill) };
}

export const VIEWS = {
  all: 'All places',
  common: 'Every card has a deal',
  unique: 'Only one card has a deal',
  gain: 'Another card beats mine',
};

// The better of several offers (the best of the cards the user already has).
function bestOffer(offers, bill) {
  return offers.filter(o => o?.covered).reduce((a, o) => (!a || compareOffers(o, a, bill) > 0 ? o : a), null);
}

/**
 * Filter evaluated rows ({ offers, best, ... }) by view:
 * 'all' | 'common' | 'unique' | 'only:<typeId>' | 'gain'.
 * 'gain' needs the cards the user already has (haveTypeIds, or a single baseTypeId):
 * places where a card they don't have beats the best of the ones they do.
 */
export function filterRows(rows, view, cards, { haveTypeIds = null, baseTypeId = null, bill = null } = {}) {
  const have = haveTypeIds ?? (baseTypeId != null ? [baseTypeId] : []);
  const coveredBy = r => cards.filter(c => r.offers[c.typeId]?.covered).map(c => c.typeId);
  if (view === 'common') return rows.filter(r => coveredBy(r).length === cards.length);
  if (view === 'unique') return rows.filter(r => coveredBy(r).length === 1);
  if (view.startsWith('only:')) {
    const id = Number(view.slice(5));
    return rows.filter(r => {
      const ids = coveredBy(r);
      return ids.length === 1 && ids[0] === id;
    });
  }
  if (view === 'gain' && have.length) {
    return rows.filter(r => {
      const mine = bestOffer(have.map(id => r.offers[id]), bill);
      return cards.some(c => {
        if (have.includes(c.typeId)) return false;
        const o = r.offers[c.typeId];
        if (!o?.covered) return false;
        return !mine || compareOffers(o, mine, bill) > 0;
      });
    });
  }
  return rows;
}

// Sort keys for one offer. Uncovered offers sort last.
const pctKey = (o, bill) => (!o?.covered ? -Infinity : ((bill > 0 ? o.saving : o.pct) ?? -1));
// [tier, size]: known caps (largest first; "no cap stated" counts as unlimited),
// then covered with the cap not known, then no deal.
const capKey = o => (!o?.covered ? [0, 0] : capKnown(o.cap) ? [2, capSize(o.cap)] : [1, 0]);
const maxCapKey = keys => keys.reduce((a, k) => (k[0] > a[0] || (k[0] === a[0] && k[1] > a[1]) ? k : a), [0, 0]);

/**
 * Sort evaluated rows. Columns never move; only rows do.
 *   sort: 'pct' (saving when a bill is set) | 'cap' | 'name'
 *   targetTypeId: rank by this card's offer, or null for the best offer at each place.
 * Ties fall back to the other key (cap or pct), then the place name.
 */
export function sortRows(rows, cards, { sort = 'pct', targetTypeId = null, bill = null } = {}) {
  const ids = targetTypeId != null && cards.some(c => c.typeId === targetTypeId) ? [targetTypeId] : cards.map(c => c.typeId);
  const pctOf = r => Math.max(-Infinity, ...ids.map(id => pctKey(r.offers[id], bill)));
  const capOf = r => maxCapKey(ids.map(id => capKey(r.offers[id])));
  const byName = (a, b) => a.place.name.localeCompare(b.place.name);
  const byPct = (a, b) => {
    const x = pctOf(a), y = pctOf(b);
    return x === y ? 0 : y > x ? 1 : -1;
  };
  const byCap = (a, b) => {
    const [ta, va] = capOf(a), [tb, vb] = capOf(b);
    return tb - ta || (va === vb ? 0 : vb > va ? 1 : -1);
  };
  const order = sort === 'name' ? [byName] : sort === 'cap' ? [byCap, byPct, byName] : [byPct, byCap, byName];
  return [...rows].sort((a, b) => {
    for (const f of order) {
      const d = f(a, b);
      if (d) return d;
    }
    return 0;
  });
}

/**
 * Yearly value per card at the user's places.
 *   entries: [{ offers, visits, bill }], with offers computed at that entry's bill.
 *   fees:    { [typeId]: number | null }
 * Net = savings − annual fee. Cards with an unknown fee get net null and are left
 * out of the ranking. Break-even spend = fee ÷ effective discount rate.
 */
export function yearlyValue(cards, entries, fees, baseTypeId = null) {
  const spend = entries.reduce((sum, e) => sum + e.visits * e.bill, 0);
  const savingAt = (e, typeId) => (e.offers[typeId]?.covered ? e.offers[typeId].saving ?? 0 : 0);

  const perCard = cards.map(card => {
    const id = card.typeId;
    const fee = fees[id] ?? null;
    const savings = entries.reduce((sum, e) => sum + e.visits * savingAt(e, id), 0);
    const covered = entries.filter(e => e.offers[id]?.covered);
    const rate = spend > 0 ? savings / spend : 0;
    let marginal = null;
    if (baseTypeId != null && id !== baseTypeId) {
      const gain = entries.reduce((sum, e) => sum + e.visits * Math.max(0, savingAt(e, id) - savingAt(e, baseTypeId)), 0);
      marginal = { gain, net: fee == null ? null : gain - fee };
    }
    return {
      typeId: id,
      fee,
      savings,
      net: fee == null ? null : savings - fee,
      breakEven: fee == null ? null : rate > 0 ? fee / rate : Infinity,
      placesCovered: covered.length,
      capIssues: covered.filter(e => !['parsed', 'none'].includes(e.offers[id].cap?.status)).length,
      dayLimited: covered.filter(e => e.offers[id].days).length,
      marginal,
    };
  });

  const ranked = perCard.filter(c => c.net != null);
  let ranking = { typeIds: [], tie: false };
  if (ranked.length) {
    const top = Math.max(...ranked.map(c => c.net));
    const typeIds = ranked.filter(c => Math.abs(c.net - top) < RUPEE_EPSILON).map(c => c.typeId);
    ranking = { typeIds, tie: typeIds.length > 1 };
  }

  const combinedSavings = entries.reduce((sum, e) => sum + e.visits * Math.max(0, ...cards.map(c => savingAt(e, c.typeId))), 0);
  const allFeesKnown = perCard.every(c => c.fee != null);
  const totalFees = allFeesKnown ? perCard.reduce((sum, c) => sum + c.fee, 0) : null;

  return {
    spend,
    perCard,
    ranking,
    combined: { savings: combinedSavings, fees: totalFees, net: totalFees == null ? null : combinedSavings - totalFees },
  };
}
