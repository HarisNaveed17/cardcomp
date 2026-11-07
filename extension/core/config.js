// Everything Peekaboo can change without notice lives in this file.
// If requests start failing with 401/403, the guest token was rotated: copy the new
// one from the Authorization header of any /api/ request in DevTools → Network.

export const API_BASE = 'https://peekaboo.guru/api';

export const TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpZCI6NzIsInJvbGUiOiJndWVzdCIsImlhdCI6MTU1MzcwMDgwNiwianRpIjoiUEpJMXFTb2ktQzRBZFJWcm9nb3RNV2UzV3VXcFdXTm0ifQ.2mb26xL4Qt7FfBQZ-XQvp-fhecMpaVUVXWp_GEST_6U';

export const PATHS = {
  banks: '/v6/sourceEntities', // POST
  cards: bankId => `/sourceEntity/${bankId}/associationType/_all`, // GET
  categories: '/v7/category', // POST (GET returns 404)
  places: '/v8/entities', // POST
  deals: '/v8/entity/deals', // POST
  search: '/entity/typeahead', // GET
};

// Public pages on peekaboo.guru, for links back to the source. The slug is cosmetic:
// the site looks the place up by id (verified October 2026: /islamabad/detail/1432/x
// opens Rinas Kitchenette).
export const SITE_BASE = 'https://peekaboo.guru';
export const SITE_PAGES = {
  place: (citySlug, placeId, placeSlug) => `/${citySlug}/detail/${placeId}/${placeSlug}`,
};

export const COUNTRY = 'Pakistan';
export const LANGUAGE = 'en';

// The API filters by city name. Coordinates only affect `distance`, so approximate
// city centres are fine (verified October 2026: Lahore with Islamabad coordinates
// returns the same places as Lahore with Lahore coordinates).
export const CITIES = {
  Islamabad: [33.729388, 73.093146],
  Rawalpindi: [33.5973, 73.0479],
  Lahore: [31.5204, 74.3587],
  Karachi: [24.8607, 67.0011],
  Faisalabad: [31.4504, 73.135],
  Multan: [30.1575, 71.5249],
  Peshawar: [34.0151, 71.5249],
};

export const BANK_CATEGORY_ID = 4;

export const REQUEST_GAP_MS = 300;
export const PLACES_PAGE_SIZE = 12; // same as the site
export const LIST_PAGE_SIZE = 100;

const HOUR = 3600e3;
const DAY = 24 * HOUR;
export const TTL = {
  banks: 7 * DAY,
  cards: 7 * DAY,
  categories: 7 * DAY,
  places: DAY,
  deals: 3 * DAY, // deals carry their own dates, and expired ones are dropped by date, so a few days is safe
};

export const MAX_CARDS = 4;
export const ENDING_SOON_DAYS = 30;
