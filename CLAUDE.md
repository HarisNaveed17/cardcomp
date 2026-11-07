# Peekaboo Card Compare: project notes for Claude Code

## Goal

Build a Chrome extension (Manifest V3) that compares discounts between Pakistani bank cards. The data comes from Peekaboo Guru (https://peekaboo.guru).

### User inputs

1. City.
2. One or more banks, and one or more cards per bank (2 to 4 cards in total).
3. Optional: a category (for example, Food), a tag (for example, Pizza), or a specific place (search by name).
4. Optional: a typical bill size, and the places the user visits often.

### Output

A comparison of the selected cards that uses:

- the discount % per place,
- the maximum discount cap per transaction,
- the card's annual fee (when available),
- the valid days and validity dates of each deal.

Views: places covered by each card, places covered by only one card, places covered by all cards, and the better card per place. A value estimate: yearly savings minus annual fee, based on the user's typical bill.

### Main use case

The tool is for the decision before a visit: which card to get, and whether a second card is worth its fee. At the restaurant, people usually ask the staff which card has the best discount, so a "which card do I use now" mobile flow is not a priority. Desktop is fine.

## Constraints

- Peekaboo's robots.txt disallows automated access. Their ToS probably prohibits scraping.
- Publishing decision (user, 16 October 2026): Peekaboo does not mind as long as the tool is not monetized, so it is published as a website at https://cardcomp.hnaveed.me (and the extension can be shared). Never add ads, paid tiers or affiliate links. The UI names Peekaboo once, in the page footer ("Deal data from Peekaboo Guru"); do not add other mentions (place links say "Place details ↗", errors say "the deal data server").
- Be polite to their servers: send requests one at a time, wait 300 ms between requests (`REQUEST_GAP_MS`; was 500 ms, lowered by the user in October 2026 for the caps prefetch), and cache results.
- Put the token, the API base URL, and the API version paths in one config module. They can change without notice.
- Keep the core logic (API client, join, cap parser, value calculation) free of browser-specific code, so it can later move behind a backend for a website.

## Fixtures

`fixtures/` has real responses captured in October 2026 (Islamabad). Use them for parser and logic tests, so tests do not call the live API.

| File | Endpoint | Notes |
|---|---|---|
| `banks-islamabad.json` | 1 | Full list, 35 issuers |
| `cards-hbl.json` | 2 | All 18 HBL cards |
| `categories.json` | 3 | Full list, 13 categories |
| `entities-askari-world-page1.json` | 4 | Askari World card, first page (12 of 167) |
| `entities-lifestyle-nocard-page1.json` | 4 | Lifestyle, no card filter (includes places with no discount, `"Flat"` flag, float noise) |
| `deals-asian-wok-partial.json` | 5 | First 5 of 34 deals (the paste was cut off) |
| `deals-asian-wok-summary.txt` | 5 | Console table of all 34 deals: bank, cards, typeIds, %, parsed cap, title, end date. The caps were parsed with the old first-line parser, so per-card caps in it can be wrong (Faysal 40%: Rs 7,500 is right for one card only). |
| `deals-rinas-kitchenette.json` | 5 | Full response, all 27 deals. Has per-card caps (MCB, Bank of Punjab, MCB Islamic). |
| `typeahead-rinas.json` | 6 | Search for "rinas" |
| `entity-detail-rinas.json` | 7 | Place profile |

`deals-rinas-kitchenette.json` is the full deals fixture. A full Asian Wok capture would still add formats.

## Site architecture

- The site is a Create React App single-page app. The HTML is an empty shell; all data comes from JSON API calls.
- The site has a service worker (`sw.js`) that proxies all requests. In DevTools, most rows show initiator `sw.js:3`. To find API calls, run `performance.clearResourceTimings()`, do the action on the site, then run:

  ```js
  performance.getEntriesByType('resource')
    .filter(e => ['fetch','xmlhttprequest'].includes(e.initiatorType))
    .map(e => e.name)
    .filter(u => !/google|doubleclick|facebook|360yield|gtm|analytics|adsby/.test(u))
  ```

- API base: `https://peekaboo.guru/api`

## Authentication

Every API call needs this header:

```
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpZCI6NzIsInJvbGUiOiJndWVzdCIsImlhdCI6MTU1MzcwMDgwNiwianRpIjoiUEpJMXFTb2ktQzRBZFJWcm9nb3RNV2UzV3VXcFdXTm0ifQ.2mb26xL4Qt7FfBQZ-XQvp-fhecMpaVUVXWp_GEST_6U
```

Decoded payload: `{"id":72, "role":"guest", "iat":1553700806}`. It is a shared guest token from March 2019 with no expiry. It is probably hardcoded in the site's JS bundle. If requests start to return 401 or 403, the token was rotated: get the new one from the Request Headers of any `/api/` call in the Network tab.

All POST bodies are JSON (`Content-Type: application/json`). IDs are sent as strings unless noted. `lat` and `long` are numbers.

## Endpoints

### 1. Banks and issuers: `POST /api/v6/sourceEntities`

Body:

```json
{ "city": "Islamabad", "country": "Pakistan", "lat": 33.729388, "long": 73.093146,
  "language": "en", "limit": 100, "offset": 0 }
```

The list depends on the city. It is paginated (Islamabad returned 36 entries in one page). Response: an array. One item:

```json
{
  "id": 289,
  "sourceEntityId": 32,
  "name": "Habib Bank Limited",
  "categories": [{ "categoryId": 4, "categoryName": "Banks" }],
  "logo": "https://d2liqplnt17rh6.cloudfront.net/logoImages/...",
  "keywords": "Habib, bank, ... hbl",
  "isMembershipAllowed": false,
  "isAppliedAllowed": false
}
```

The list also contains non-banks (telcos, Golootlo, Vouch365, insurers). `categoryId: 4` = Banks. Sort banks first.

### 2. Cards of one bank: `GET /api/sourceEntity/{id}/associationType/_all`

`{id}` is the bank's `id` (not `sourceEntityId`). Query string:

```
?city=Islamabad&country=Pakistan&entity=&language=en&lat=33.729388&limit=50&long=73.093146&offset=0
```

Response: an array. One item:

```json
{
  "entityId": 289,
  "entityName": "Habib Bank Limited",
  "sourceEntityId": 32,
  "associationId": 8,
  "typeId": 806,
  "typeName": "HBL Gold CreditCard",
  "cardType": "CREDIT",
  "image": "https://d2liqplnt17rh6.cloudfront.net/cardImages/...",
  "description": "...",
  "dealCount": 0
}
```

`cardType` is `CREDIT`, `DEBIT`, or `NONE` (for example, "QR - Scan to Pay"). `dealCount` is always 0, so do not use it.

### 3. Categories: `POST /api/v7/category`

`GET` returns 404 (verified October 2026). POST the location body: `{ city, country, lat, long, language }`. Counts are per city (Food `entities`: Islamabad 2047, Lahore 2653).

Response: an array of categories. One item (shortened):

```json
{
  "id": 1, "name": "Food", "scope": "PHYSICAL",
  "logo": "https://.../categoryIcons/Food.png",
  "entities": 2047, "discount": 50, "dealCount": 1929,
  "tags": { "counts": 55, "entityCount": 1162,
    "tags": [ { "id": 139, "tag": "Pizza", "entityCount": 140 } ] }
}
```

All categories (Islamabad, October 2026):

| id | name | id | name |
|---|---|---|---|
| 1 | Food | 19 | Home Decor |
| 18 | Lifestyle | 29 | Services |
| 27 | Health | 16 | Electronics |
| 10 | Entertainment | 28 | Self Care |
| 55 | e-Stores | 39 | Public Services (0 deals, hide it) |
| 22 | Education | 133 | Hotels |
| 42 | Grocery | | |

Notes:
- The counts are per city (verified).
- `tags.tags` lists only the top 6 tags, but `tags.counts` is the full number (Food: 55). The full tag list is not captured.
- "Hotels" is a category (133) and also a tag under Entertainment (147).
- Ignore `expiresIn`; the values are old dates with no clear meaning.

### 4. Places with discounts: `POST /api/v8/entities`

Body for one card (verified):

```json
{
  "sortType": "trending", "targetEntities": "_all",
  "city": "Islamabad", "country": "Pakistan", "lat": 33.729388, "long": 73.093146,
  "language": "en", "category": "all", "categoryId": "_all",
  "ai": "8", "associationTypeId": "806", "atlId": "806",
  "sourceEntityId": "32",
  "card": "hbl-gold-creditcard",
  "discount": "Habib Bank Limited",
  "limit": 12, "offset": 0
}
```

Body for one category, with no card filter (verified, from the site):

```json
{
  "sortType": "trending", "targetEntities": "_all",
  "city": "Islamabad", "country": "Pakistan", "lat": 33.729388, "long": 73.093146,
  "language": "en", "category": "lifestyle", "categoryId": "18",
  "atlId": "_all", "sourceEntityId": "_all",
  "limit": 12, "offset": 0
}
```

To filter by card AND category, combine the card fields with `category` + `categoryId`. Verified: HBL Gold has 66 places in total, 40 in Food.

Notes:

- Keep `limit` at 12, the same as the site. Increase `offset` by 12 per page and stop when `nextPage` is false.
- `category` is the category name as a slug (`"lifestyle"`, `"e-stores"`, `"home-decor"`). The server filters on `categoryId` only (verified: a bogus slug with `categoryId: "1"` returns the same 40). The app still sends the slug.
- The site also sends `discounts: "<bank-slug>"`. It was stale UI state. It was removed in testing, and the totals still matched the site. Leave it out.
- The tag filter body is not captured. Guesses that do nothing (total unchanged): `tags: "139"`, `tags: ["139"]`, `tagId: "139"`, `tag: "pizza"`. Place objects have no tags either, so tags cannot be filtered in the client. TODO: click a tag on the site and capture the body.
- The city name decides the results. Coordinates only change `distance` (verified: Lahore with Islamabad coordinates returns the same 112 HBL Gold places). Requests without `lat`/`long` also work.
- `online` is `true` for many places that have real branches. Use the "<City> Online" nearest branch to label online-only places.

Response:

```json
{
  "total": 167,
  "nextPage": true,
  "entities": [
    {
      "id": 10,
      "name": "Bar.B.Q Tonight",
      "slug": "barbq-tonight",
      "rating": 3.6,
      "openNow": true,
      "online": false,
      "nearestBranch": { "id": 28, "name": "Blue Area Islamabad Branch", "lat": 33.725, "long": 73.086, "distance": 761.4 },
      "richContent": { "cover": { "content": ["https://..."] }, "logo": { "content": "https://..." } },
      "stats": { "branches": 1, "partnerOffers": 1, "brandOffers": 12, "maxDiscount": 40, "discountFlag": null }
    }
  ]
}
```

- `id` is the merchant ID. It is the same in all endpoints, so it is the join key.
- With a card filter, `stats.maxDiscount` is card-specific (verified: Bar.B.Q Tonight is 40% on Askari World, 15% on HBL Gold credit, 20% on HBL Platinum credit).
- With no card filter, places with no discount are included (Lifestyle: `total: 2382`). Their `stats` has only `branches`. Handle a missing `maxDiscount`.
- `stats.discountFlag` is `null`, `"Up to"` (more than one offer; `maxDiscount` is the best one), or `"Flat"`.
- `maxDiscount` can be a float with noise: `1.2999999523162842`. Round to 1 decimal.
- Online stores have a fake branch named "<City> Online", at the city's own coordinates, with `distance: 0`. Use it to label "online only" places.
- Merchant names can have trailing spaces. Trim them.
- `brandOffers` is sometimes present. Its meaning is unknown.

### 5. Deals at one place (has the caps): `POST /api/v8/entity/deals`

Body (verified, from the site):

```json
{
  "associatedDeals": true, "atlId": "_all", "card": "All",
  "city": "Islamabad", "country": "Pakistan", "language": "en",
  "lat": 33.729388, "long": 73.093146, "limit": 100, "offset": 0,
  "sourceEntityId": "_all", "targetBranchId": "_all", "targetEntityId": 11566
}
```

`targetEntityId` is a number (the merchant `id`). One call returns the deals of ALL banks and cards at that place (Asian Wok: 34 deals). Paginate if `total` > 100. Server-side card filtering works (`atlId: "813", sourceEntityId: "32"` returns 1 of 27 deals at Rinas), but the app fetches all deals: one cached call covers every selected card and feeds the "other cards here" list.

Response:

```json
{
  "total": 34,
  "deals": [
    {
      "dealId": 147523,
      "title": "25% off",
      "percentageValue": 25,
      "startDate": "2026-07-01T00:00:00",
      "endDate": "2027-05-01T23:59:00",
      "orderType": "OUTLET",
      "targetEntityId": 11566,
      "targetEntityName": "Asian Wok",
      "sourceEntityId": 37,
      "sourceOriginalId": 322,
      "sourceEntityName": "Askari Bank Limited",
      "description": "* 25% or max discount of PKR 4,000/- can be availed per transaction.\n* 01 discounted transaction can be availed per card per day\n...",
      "targetBranches": { "161952": "Beverly Center Islamabad Branch", "1422545": "I-8 Markaz Islamabad Branch" },
      "associations": [
        { "typeId": 1909, "name": "Askari Visa Platinum Debit Card", "image": "https://...", "order": 0, "sourceEntityAssociationId": 2771 }
      ]
    }
  ]
}
```

Notes:

- Join a deal to a selected card with `associations[].typeId` = the card's `typeId`. One deal can apply to several cards.
- `sourceEntityId` = the bank's `sourceEntityId`. `sourceOriginalId` = the bank's `id`.
- `sourceEntityAssociationId` is probably the card's `associationId` (`ai`). Not verified.
- Each card has its own deal. Verified: at Asian Wok, Askari World (636) has 30% with a Rs 6,000 cap, and the Askari Visa Platinum Debit card (1909) has 25% with a Rs 4,000 cap. The 30% matches `maxDiscount` from endpoint 4.
- `targetBranches` lists the branches where the deal is valid. Not always all branches.
- `startDate` / `endDate`: the validity period. Hide or flag expired deals.
- **The cap is only in the `description` free text.** See "Cap parsing" below.
- **The valid days are in `title`:** "25% off", "30% off Everyday", "50% off on Every Tuesday", "30% off on Every Monday, Tuesday & Wednesday", "40% off on Every Friday, Saturday & Sunday". Parse weekday names from the title. No weekday = every day.
- Some live deals are test data, titled like "20% off (TEST)". The app ignores titles containing "(TEST)".
- Other limits are in `description` (for example, "One card can avail 4 times in a month", "Only one card can avail discount per day", specific card BINs). Show the full description on demand. Do not try to parse all of it.

### 6. Place search: `GET /api/entity/typeahead`

```
/api/entity/typeahead?city=Islamabad&country=Pakistan&language=en&lat=33.729388&limit=5&long=73.093146&offset=0&query=rinas
```

Response:

```json
{ "total": 1, "entities": [ { "entityId": 1432, "name": "Rinas kitchenette", "logo": "https://..." } ] }
```

`entityId` = the merchant `id`. Flow for "check one place": typeahead → `entityId` → endpoint 5 → filter deals by the selected cards' `typeId`. Debounce the input (about 300 ms).

### 7. Place profile: `POST /api/v8/entity/detail`

Not needed for the comparison. It is the place's profile: `tags` (for example Bakery, Pizza, Dessert), `contactNumber`, `social`, `richContent` (cover, logo, gallery, menu images), `nearestBranch`, and `stats` for ALL cards together (`partnerOffers`, `maxDiscount`, `widgets`, `reviews`, `followers`). The payload is not captured. Its `online` value can differ from the list in endpoint 4.

### 8. Other endpoints seen (not needed)

- `GET /api/v5/entity/{id}/branch/_all?...&limit=100...`: branches of a place. Useful later for "nearest branch with this deal".
- `/api/v6/entity/widget` (called several times per place page): page sections.
- `/api/v6/entity/amenities`: Wi-Fi, parking, etc.
- `/api/v6/user/me/associations`: the cards a user saved on the site ("my cards").
- `GET /api/user/me`: session info.
- `/cdn-cgi/rum`: Cloudflare analytics.

## ID mapping

| Value | Source |
|---|---|
| `ai` (endpoint 4) | `associationId` from the card list |
| `associationTypeId`, `atlId` (endpoint 4) | `typeId` from the card list |
| `sourceEntityId` (endpoints 4, 5) | `sourceEntityId` from the bank or card list |
| `card` (endpoint 4) | slug of `typeName`: lowercase, remove `&`, replace non-alphanumeric runs with `-`, trim `-` ("HBL Gold CreditCard" → `hbl-gold-creditcard`) |
| `discount` (endpoint 4) | `entityName` from the card list |
| `{id}` in endpoint 2 path | the bank's `id`. It is also the `ei` param in the site's page URLs |
| `associations[].typeId` (endpoint 5) | the card's `typeId` |
| merchant `id` (endpoint 4) = `entityId` (endpoint 6) = `targetEntityId` (endpoint 5) | same place |

`ai` is per card, not per bank (HBL Gold = 8, HBL Platinum = 9).

## Known IDs (for tests)

| Bank | `id` | `sourceEntityId` |
|---|---|---|
| Askari Bank Limited | 322 | 37 |
| Habib Bank Limited | 289 | 32 |
| HBL Islamic Bank Limited | 65659 | 239 |
| Meezan Bank | 45 | 29 |
| Standard Chartered Bank | 54 | 31 |
| Bank of Punjab | 4468 | 96 |
| Habib Metro Bank | 782 | 46 |

| Card | `ai` | `typeId` | Type |
|---|---|---|---|
| Askari World Credit Card | 190 | 636 | Credit |
| HBL Green CreditCard | 7 | 807 | Credit |
| HBL Gold CreditCard | 8 | 806 | Credit |
| HBL Platinum CreditCard | 9 | 813 | Credit |
| HBL Visa Infinite CreditCard | 3048 | 1972 | Credit |
| HBL DebitCard | 11 | 809 | Debit |
| HBL Gold DebitCard | 1645 | 1581 | Debit |
| HBL Titanium DebitCard | 12 | 811 | Debit |
| HBL World DebitCard | 10 | 804 | Debit |
| HBL World Elite DebitCard | 2059 | 1729 | Debit |

Test places: Asian Wok = 11566 (34 deals), Rinas Kitchenette = 1432, Bar.B.Q Tonight = 10. Askari World in Islamabad had `total: 167` places in October 2026.

## City coordinates

Only Islamabad is verified (from the site). The others are approximate city centers. Verify them, or test if the API works with `city` only.

```js
Islamabad:  [33.729388, 73.093146]
Rawalpindi: [33.5973, 73.0479]
Lahore:     [31.5204, 74.3587]
Karachi:    [24.8607, 67.0011]
Faisalabad: [31.4504, 73.1350]
Multan:     [30.1575, 71.5249]
Peshawar:   [34.0151, 71.5249]
```

## Cap parsing

The implementation is `capOf()` in `extension/core/parse.js`, with one unit test per format in `test/parse.test.js`. Live check (October 2026, 25 Food places, 810 card-deal pairs): 751 parsed, 53 "no cap stated" (correct), 6 unknown (5 of them a test deal).

The first version below returned the first cap in the text. It was tested on all 34 deals at Asian Wok (7 banks) and parsed all 34, but it is wrong for deals with a different cap per card:

```js
const capOf = text => {
  for (const line of (text || '').split('\n')) {
    if (!/cap|max|whichever is lower/i.test(line)) continue;
    const m = line.match(/(?:PKR|Rs\.?)\s*([\d,]+)/i)   // "PKR 6,000", "Rs. 5000"
           || line.match(/cap\s*:?\s*([\d,]+)/i)        // "Discount Cap: 3000/-"
           || line.match(/(\d[\d,]{2,})\s*\/-/);        // any "3000/-"
    if (m) return +m[1].replace(/,/g, '');
  }
  return null;
};
```

Formats seen:
- "Max Discount cap PKR 6,000/-" (Bank of Punjab)
- "35% or Rs. 5000/- whichever is lower" (Habib Metro)
- "25% or max discount of PKR 4,000/- can be availed per transaction" (Askari)
- "Discount Cap: 3000/-" (Bank AL Habib)

More formats seen since:
- "Maximum discount of PKR 25,000/-" (HBL), "Discount Cap PKR 1,500/-" (MCB, Bank Alfalah), "40% or Rs. 5,000 whichever is lower." (MCB Islamic), "Maximum discount cap is of Rs. 8,000" (Meezan), "50% Discount is capped to PKR 10,000" (Allied), "Discount capping PKR 4,000/-" (Bank of Punjab, JS Bank), "(Max Discount 3000)" (JazzCash).
- **Per-card caps in one deal:** "Discount Cap PKR 5,000/- on Visa Signature Debit Card & Visa Platinum Credit Card." then "Discount Cap PKR 3,000/- on Visa Platinum Debit Card." (MCB). Pick the cap line that names the card (longest names first, whitespace-normalized, because names overlap: "Taqwa Platinum" vs "Taqwa KHAAS Platinum", and "Noor World  Card" has a double space). A cap line that names no card applies to all. If no line names the card and there is no general line, the cap is unknown (JS Bank: "Titanium Debit Cards" probably covers "Her Titanium", but the text does not say so).
- **Regex bug in the first version:** `Rs\.?\s*([\d,]+)` matches the "rs" in "offe**rs**, only" and captures ",", which gives 0. Use `\b(?:PKR|Rs\.?)\s*(\d[\d,]*)`.

Rules:
- Keep the currency match first. A line like "25% or max discount of PKR 4,000/-" also contains 25.
- Only check lines that contain cap, max, or "whichever is lower". Lines about card BINs contain long numbers.
- Other places and banks will have new formats. Keep "cap unknown" as a state, separate from "no cap stated". Log descriptions that fail to parse, and add a unit test for each format.

## Annual fees

Peekaboo has no fee data. Keep a manual `fees.json` with the value, the effective period, and the source URL for each card. Pakistani banks publish a new Schedule of Bank Charges (SOBC) every 6 months (Jan to Jun, Jul to Dec), so show the effective date in the UI.

Known values (October 2026):

| Card | Annual fee | Source and notes |
|---|---|---|
| HBL Gold CreditCard | Rs 14,000 (supplementary Rs 7,000), plus up to 16% FED | https://www.hbl.com/assets/documents/HBL_Gold___Green_CreditCard_SOBC_%28July-Dec_26%29.pdf. The PDF text is out of order; this reading follows the pattern of the 2023 SOBC. Verify. |
| HBL Green CreditCard | Rs 6,500 (supplementary Rs 3,250) | Same PDF, same caveat. |
| HBL Platinum CreditCard | Unknown | Only an old value: Rs 12,000 (2020). Ask HBL (111-111-425). |
| HBL debit: MasterCard Gold | Rs 3,800 | Jul–Dec 2026, from a news report (pakobserver.net). Assumed to be Peekaboo's "HBL Gold DebitCard". Verify. |
| HBL debit: MasterCard Titanium | Rs 3,000 | Same source. |
| HBL debit: MasterCard World | Rs 20,000 | Same source. |
| Askari World Credit Card | Unknown | |

Fee reversal: HBL reverses the credit card annual fee if you spend a set amount within 60 days of the statement in which the fee is charged. Platinum: Rs 350,000 (2024 key facts sheet, may be outdated). Gold: unknown. Show this as a note, not in the calculation.

If a fee is unknown, show "Fee unknown" and leave the card out of the net-value ranking.

## Comparison logic

Data flow:
1. For each selected card: endpoint 4 (with the category filter if chosen) → list of places with `maxDiscount`.
2. Join on merchant `id`.
3. For caps: endpoint 5 for each place in the comparison. One call covers all selected cards. Prefetched in the background for all places after the places load (see "Behaviour decisions"). Cache per place.
4. For one place: endpoint 6 → endpoint 5.

Calculation:
- Per place, per card: saving = min(discount% × bill, cap). Without a parsed cap, use discount% × bill and mark it "cap unknown".
- A higher % with a lower cap can lose on big bills. Example: 30% with a Rs 2,000 cap (cap reached at a Rs 6,667 bill) vs 20% with a Rs 6,000 cap (cap reached at Rs 30,000). On a Rs 15,000 bill, the 20% card saves Rs 3,000 and the 30% card saves Rs 2,000.
- The user enters a typical bill size (one global value, with an optional value per place).
- Net yearly value per card = sum of (saving × visits per year) at the places the user selects − annual fee. Show the break-even spend: annual fee ÷ average discount%.
- Ties: if two or more cards have the same best value, show "Tie". Do not label the first card as the winner (the first prototype had this bug).
- When the user keeps an existing card, the useful view is "places where the new card is better or the only card", not the full list.
- Show valid days and flag deals that end soon.

## Extension architecture

- MV3. `permissions: ["storage"]`, `host_permissions: ["https://peekaboo.guru/*"]`.
- Clicking the toolbar icon opens a full extension page in a new tab (a popup is too small for the tables).
- Call the API from the extension page. Host permissions remove the CORS block on the client side.
- The server accepts an extension `Origin` and answers every request with `Access-Control-Allow-Origin: *` (verified), so no content script is needed. The same page also runs from localhost (`npm run dev`).
- Starred places (with visits and bill) and typed annual fees are also mirrored to `chrome.storage.sync` (`platform/sync-format.js`: `sync:v1:mine:{city}:{chunk}` of 50 compact rows, and `sync:v1:fees`). Writes are diffed and delayed 1.5 s (write quota). Sync is the source of truth, except on a device's first sync (merge, sync wins per place) and when the local `syncDirty` flag says a change was not written yet (local wins). Changes from other devices apply live via `storage.onChanged`. Other settings (city, cards, sort) stay per device.
- The manifest has a `key` so the unpacked extension ID (`bnmkffbjegaaiiibflbbkkkcdaomnipb`) is the same on every machine; `chrome.storage.sync` is per extension ID. The private key was not kept (not needed for load unpacked). `npm run package` strips `key`, because the Web Store rejects it and assigns its own ID.
- Cache in `chrome.storage.local`. TTLs: banks, cards, categories 7 days; places 24 hours; deals 3 days (deals carry their own dates and expired ones are dropped by date). Keys: `banks:{city}`, `cards:{bankId}:{city}`, `categories:{city}`, `places:{typeId}:{city}:{categoryId}`, `deals:{placeId}:{city}`.
- MV3 extension pages do not allow inline scripts. Use separate `.js` files (ES modules are fine).
- Show progress while loading ("Loading HBL Gold CreditCard: 48 of 167"), clear error messages, and a "Refresh data" button that clears the cache for the selected cards.
- Export the current table as CSV.

## Publishing

- For personal use: `chrome://extensions` → Developer mode → Load unpacked. No review needed.
- Chrome Web Store: one-time $5 developer fee, store listing, privacy form, review (host permissions get a closer review). "Unlisted" visibility = only people with the link can install.
- Do not use "Peekaboo" in the extension name, logo, or screenshots in a way that suggests it is their product (impersonation policy, and an easy takedown reason). "Uses data from peekaboo.guru" in the description is safer.
- Website: the same page runs as a static site with no backend, because the API answers with `Access-Control-Allow-Origin: *`. Each visitor's browser calls the API directly, so traffic comes from the visitors' IPs, not one server. `web/chrome-shim.js` stands in for `chrome.storage`: `local` in IndexedDB (the deals cache outgrows localStorage's ~5 MB), `sync` in localStorage (no cross-device sync on the web; other tabs' changes arrive as storage events). `npm run dev` uses the same shim. Hosting: GitHub Pages repo `HarisNaveed17/cardcomp` with custom domain `cardcomp.hnaveed.me` (one custom domain per Pages repo, so it cannot live in the personal site repo). Pushing to `main` deploys it (GitHub Actions workflow builds `dist/web/` and publishes to Pages). The personal site (`~/projects/HarisNaveed17.github.io`, Windows XP theme) has a desktop icon (`cardcomp` in `src/data/windows-data.json`) that opens it in a new tab.

## Code layout and commands

See `README.md`. In short: `extension/` is the unpacked extension (no build step). `extension/core/` is browser-free (config, API client, parsers, comparison, formatting). `extension/platform/chrome-storage.js` holds the `chrome.storage` adapters. `npm test` runs the fixture tests, `npm run dev` serves the page on localhost with live data, `npm run package` writes `dist/*.zip`, `npm run build:web` writes the website to `dist/web/`. `web/chrome-shim.js` is the website's storage. Publishing steps are in `PUBLISHING.md`.

Behaviour decisions made in the build:
- 1 to 4 cards (1 is allowed: "is this card worth its fee?").
- Caps are prefetched like the percentages (user decision, October 2026): after a compare, `prefetchDeals()` loads endpoint 5 for every place, one at a time through the serial queue, choosing the next place each step (page on screen first, then table order). About 0.8 s per place (≈0.5 s response + 300 ms gap; the gap counts from the previous response), so 186 places ≈ 2.5 min on a cold cache. A newer compare or city change stops it; an error pauses it until "Retry loading caps", so it cannot loop.
- Before deals are loaded, a card's offer uses `maxDiscount` from endpoint 4 with cap state "not loaded". Once a place's deals are loaded, they are the source of truth (caps, days, dates, expired deals dropped).
- With several active deals for one card at a place, the best saving at the user's bill wins (without a bill: higher %, then bigger cap, then every-day over day-limited).
- Best card: by saving when a bill is set, else by %, then by cap when both caps are known. Equal = "Tie".
- Users can type an annual fee per card. It overrides `fees.json`.
- UI flow (October 2026 redesign): city question → category question → card slots (2 by default, up to 4). There is no Compare button: the compare reruns about 300 ms after the city, category or set of chosen cards changes, and stale runs are dropped by a sequence number. Places loads are shared between overlapping runs (`placesJob`).
- "I already have this card" is per slot, and more than one card can be on. The "Another card beats mine" view compares against the best of the cards the user has; yearly value's "Extra if added to…" uses the first one.
- Table sort (`sortRows` in `core/compare.js`): by % (by saving when a bill is set), by cap (known caps, then cap unknown, then no deal; "no cap stated" counts as unlimited), or by name; optionally for one target card. Columns never reorder.
- Light theme only; the redesign dropped dark mode. Fonts (Bricolage Grotesque, DM Sans) are bundled in `extension/fonts/`, not loaded from Google, to keep the privacy promise.

## Open questions

Resolved in October 2026 (see the endpoint notes): card + category filters combine; the server uses `categoryId` only; endpoint 5 can filter by card; the API accepts an extension origin; `city` alone works.

Still open:
1. The tag filter body, and the full tag list per category.
2. Current annual fees for HBL Platinum credit and Askari World credit.
3. Whether Peekaboo's debit card names match the SOBC card names.
4. Whether the city coordinates other than Islamabad matter for `nearestBranch` and distance (they do not change which places are returned).

## Console tips (for capturing data)

- Console variables are lost when the page reloads. Save the token and helper functions as a DevTools snippet (Sources → Snippets) and run it again with Ctrl+Enter.
- `copy()` is a DevTools Console helper. It is not available inside callbacks, and not always in an entry that uses top-level `await`. Run the `await` line as one Console entry and `copy(...)` as a separate entry.
- `copy()` always prints `undefined`. That is normal; the data is still on the clipboard.
- Make sure the Console context dropdown says `top`.
