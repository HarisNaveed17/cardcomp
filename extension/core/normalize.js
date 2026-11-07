// Turn raw API objects into the small shapes the app uses (and caches).

import { BANK_CATEGORY_ID } from './config.js';
import { daysOf, roundPct, slugify } from './parse.js';

const trim = s => String(s ?? '').trim();

export function normalizeBank(b) {
  const categoryIds = (b.categories || []).map(c => c.categoryId);
  return {
    id: b.id,
    sourceEntityId: b.sourceEntityId,
    name: trim(b.name),
    isBank: categoryIds.includes(BANK_CATEGORY_ID),
  };
}

// Banks first, then other issuers (telcos, wallets, insurers), each by name.
export const sortBanks = banks =>
  [...banks].sort((a, b) => b.isBank - a.isBank || a.name.localeCompare(b.name));

const CARD_TYPE_ORDER = { CREDIT: 0, DEBIT: 1 };

export function normalizeCard(c) {
  const name = trim(c.typeName);
  return {
    typeId: c.typeId,
    associationId: c.associationId,
    name,
    slug: slugify(name),
    cardType: c.cardType || 'NONE',
    bankId: c.entityId,
    bankName: trim(c.entityName),
    sourceEntityId: c.sourceEntityId,
  };
}

export const sortCards = cards =>
  [...cards].sort(
    (a, b) =>
      (CARD_TYPE_ORDER[a.cardType] ?? 2) - (CARD_TYPE_ORDER[b.cardType] ?? 2) ||
      a.name.localeCompare(b.name),
  );

export function normalizeCategory(c) {
  const name = trim(c.name);
  return { id: c.id, name, slug: slugify(name), dealCount: c.dealCount ?? 0 };
}

export function normalizePlace(e) {
  const stats = e.stats || {};
  const branch = e.nearestBranch;
  const branchName = branch ? trim(branch.name) : null;
  return {
    id: e.id,
    name: trim(e.name),
    slug: e.slug || null,
    maxDiscount: roundPct(stats.maxDiscount),
    discountFlag: stats.discountFlag || null, // null | "Up to" | "Flat"
    branches: stats.branches ?? null,
    // The `online` field is true for many shops with branches. Online-only stores
    // have a fake nearest branch named "<City> Online" instead.
    onlineOnly: !!branchName && /\bonline$/i.test(branchName),
    nearestBranch: branchName,
  };
}

function normalizeDealCard(a) {
  return { typeId: a.typeId, name: trim(a.name) };
}

export function normalizeDeal(d) {
  const title = trim(d.title);
  return {
    id: d.dealId,
    title,
    pct: roundPct(d.percentageValue),
    start: d.startDate || null,
    end: d.endDate || null,
    days: daysOf(title),
    description: String(d.description || ''),
    bankName: trim(d.sourceEntityName),
    bankSourceId: d.sourceEntityId,
    placeId: d.targetEntityId,
    branches: Object.values(d.targetBranches || {}).map(trim),
    cards: (d.associations || []).map(normalizeDealCard),
  };
}
