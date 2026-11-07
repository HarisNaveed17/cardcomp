// Display formatting shared by the UI and CSV export. No browser APIs.

import { SITE_BASE, SITE_PAGES } from './config.js';
import { slugify } from './parse.js';

// The place's page on peekaboo.guru. Search results have no slug, so build one from the name.
export const placeUrl = (city, place) =>
  SITE_BASE + SITE_PAGES.place(slugify(city), place.id, place.slug || slugify(place.name) || 'place');

export const rs = n =>
  n == null ? '—' : n === Infinity ? 'never' : 'Rs ' + Math.round(n).toLocaleString('en-US');

export const pct = n => (n == null ? '—' : `${n}%`);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const days = list => (list ? list.map(d => DAY_NAMES[d]).join(', ') + ' only' : 'Every day');

export const date = iso =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function cap(c) {
  switch (c?.status) {
    case 'parsed': return `cap ${rs(c.value)}`;
    case 'none': return 'no cap stated';
    case 'unknown': return 'cap unknown';
    case 'not-loaded': return 'cap not loaded';
    default: return '';
  }
}

export const cardType = t => ({ CREDIT: 'Credit', DEBIT: 'Debit' })[t] || 'Other';
