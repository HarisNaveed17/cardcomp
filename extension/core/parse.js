// Parsers for Peekaboo's free-text fields. No browser APIs.

// "HBL Gold CreditCard" → "hbl-gold-creditcard"
export const slugify = text =>
  String(text || '')
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// maxDiscount arrives with float noise (1.2999999523162842).
export const roundPct = value =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

const CAP_LINE = /cap|max|whichever is lower/i;
const AMOUNT_PATTERNS = [
  /\b(?:PKR|Rs\.?)\s*(\d[\d,]*)/i, // "PKR 6,000", "Rs. 5000" (currency first: the line also holds the %)
  /\bcap(?:ped|ping)?\s*(?:to|of|is)?\s*:?\s*(\d[\d,]*)/i, // "Discount Cap: 3000/-"
  /\bmax(?:imum)?\.?\s+discount\s*(?:cap)?\s*(?:of|is)?\s*:?\s*(\d[\d,]{2,})/i, // "(Max Discount 3000)"
  /(\d[\d,]{2,})\s*\/-/, // any "3000/-"
];

// Peekaboo has live deals titled like "20% off (TEST)".
export const isTestDeal = deal => /\(test\)/i.test(deal.title || '');

function amountIn(line) {
  for (const re of AMOUNT_PATTERNS) {
    const m = line.match(re);
    if (m) {
      const value = Number(m[1].replace(/,/g, ''));
      if (value > 0) return value;
    }
  }
  return null;
}

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Which of `names` appear in `line`. Longer names are matched first and blanked
// out, so "Visa Platinum Debit Card" does not also match inside a longer name.
function namesIn(line, names) {
  let text = norm(line);
  const found = new Set();
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const n = norm(name);
    if (n && text.includes(n)) {
      found.add(name);
      text = text.split(n).join(' \u0000 ');
    }
  }
  return found;
}

/**
 * The per-transaction cap for one card, from a deal's description.
 *
 * Returns one of:
 *   { status: 'parsed', value, line }  a cap was found
 *   { status: 'none' }                 the description states no cap
 *   { status: 'unknown', line }        a cap is mentioned but could not be read
 *
 * Some deals state a different cap per card ("Cap PKR 5,000 on Visa Signature…",
 * "Cap PKR 3,000 on Visa Platinum Debit Card"). Pass the card's name and all the
 * deal's card names so the right line is picked. A cap line that names no card
 * applies to every card the deal covers.
 */
export function capOf(description, cardName = null, allCardNames = []) {
  const lines = String(description || '').split('\n');
  const capLines = lines.filter(l => CAP_LINE.test(l));
  if (!capLines.length) return { status: 'none' };

  const parsed = capLines
    .map(line => ({ line: line.trim(), value: amountIn(line) }))
    .filter(c => c.value != null);
  if (!parsed.length) return { status: 'unknown', line: capLines[0].trim() };

  const names = allCardNames.length ? allCardNames : cardName ? [cardName] : [];
  if (parsed.length > 1 && cardName && names.length) {
    const withNames = parsed.map(c => ({ ...c, names: namesIn(c.line, names) }));
    const own = withNames.find(c => c.names.has(cardName));
    if (own) return { status: 'parsed', value: own.value, line: own.line };
    const general = withNames.find(c => c.names.size === 0);
    if (general) return { status: 'parsed', value: general.value, line: general.line };
    return { status: 'unknown', line: parsed[0].line };
  }
  return { status: 'parsed', value: parsed[0].value, line: parsed[0].line };
}

// Day index as in Date#getDay(): 0 = Sunday.
const DAY_PATTERNS = [
  [1, /\bmon(day)?s?\b/i],
  [2, /\btues?(day)?s?\b/i],
  [3, /\bwed(nesday)?s?\b/i],
  [4, /\bthu(rs?)?(day)?s?\b/i],
  [5, /\bfri(day)?s?\b/i],
  [6, /\bsat(urday)?s?\b/i],
  [0, /\bsun(day)?s?\b/i],
];

/**
 * Valid weekdays from a deal title. null = every day.
 * "50% off on Every Tuesday" → [2]; "30% off Everyday" → null.
 */
export function daysOf(title) {
  const text = String(title || '');
  const days = new Set();
  for (const [day, re] of DAY_PATTERNS) if (re.test(text)) days.add(day);
  if (/\bweekends?\b/i.test(text)) [6, 0].forEach(d => days.add(d));
  if (/\bweekdays?\b/i.test(text)) [1, 2, 3, 4, 5].forEach(d => days.add(d));
  if (!days.size || days.size === 7) return null;
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
}
