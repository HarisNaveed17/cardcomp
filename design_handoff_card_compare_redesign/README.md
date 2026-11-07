# Handoff: Card Compare redesign (orange/purple, question flow, auto-revealing card pickers)

## Overview
Redesign of the extension page `extension/app.html` / `app.js` / `app.css` in the `best-card-for-you` repo. Replaces the left setup sidebar + "Compare" button with:
1. A centered, two-step question flow (City → Category) on purple cards over an orange page.
2. A row of purple card-picker cards (2 by default, up to 4 via a "+" button). Picking a card instantly reveals its fee info — no "Add card" or "Compare" button.
3. The results table (still a table), with search, a "Show" filter, "Sort by" and a "for <card>" sort target.

Scope of this pass: setup flow + Compare-places table only. The "My places & yearly value" and "Check one place" tabs, star ☆, bill input, CSV export, caps loading, row expansion/deal details and pager are **unchanged in behaviour and not yet restyled** — keep them working; restyle with the tokens below.

## About the design files
`Card Compare.dc.html` is a **design reference built in HTML** (a self-running prototype using a small templating runtime). Do not ship it. Recreate it inside the existing extension: plain ES modules, `dom.js`'s `h()` helper, `app.css`, no build step, no dependencies. The prototype uses **mock data** (hard-coded banks/cards and hash-generated offers); the real app must keep using `core/api.js`, `core/compare.js`, `data/fees.json` and `chrome-storage.js`.

Open it directly in Chrome to click through. (It needs `support.js` from the design tool to run; if it doesn't open standalone, use this README + the source as the spec.)

## Fidelity
**High-fidelity.** Colors, type, radii, spacing and copy are final. Recreate closely.

## Flow / state machine
`step: 'city' | 'category' | 'cards'`
- `city` → user taps a city chip → `state.city = name`, `step = 'category'`.
- `category` → taps a category chip (first chip is "All categories" = `categoryId: null`) → `step = 'cards'`. "← {city}" link returns to `city`.
- `cards` → header pills "City {city}" / "Category {name}" jump back to that step. Selected cards are kept.
- First run starts at `city`. If saved state already has a city + category, start at `cards` (suggested).

### Auto-compare (replaces Compare button)
Whenever the set of *complete* slots (bank + card chosen), city or category changes, run the existing `compare()` logic automatically (debounce ~300 ms; cancel/ignore stale runs with a sequence number). Show progress in the table area ("Loading HBL Gold CreditCard: 24 of 60"). Remove `#compare`, `#add-card`, `#stale`.

## Screens

### 1. Question card (steps `city` and `category`)
- Page: full-viewport, background `#FF8A3D`-ish (`oklch(0.76 0.17 52)`), content column centered both axes, padding 48px 20px, gap 28px.
- Brand row above the card: `icons/icon48.png` 36×36 radius 10 + "Best Card For You" (Bricolage Grotesque 800, 22px, ls −0.01em, nowrap, color ink).
- Card: max-width 640, width 100%, bg purple, white text, radius 28, padding 36/36/32, shadow `0 24px 60px -20px oklch(0.3 0.18 295 / .6)`. Entrance animation `pop` (below).
  - Eyebrow: "Question 1 of 2" / "Question 2 of 2" — 13px 600, uppercase, ls .08em, color orange-light, nowrap. Step 2 has right-aligned "← {city}" (14px 500, lilac-text, hover white).
  - Title (Bricolage 700, 36px, lh 1.1, ls −0.02em, margin 10px 0 6px): "Which city do you shop in?" / "What do you spend on most?"
  - Sub (15px, lilac-text, mb 24): "Deals differ by city. You can change this later." / "We'll compare deals in this category."
  - Chips: flex-wrap gap 10. Each: DM Sans 600 16px, padding 12×20, radius 999, border 2px. Idle: bg `rgba(255,255,255,.08)`, border `rgba(255,255,255,.22)`, white. Selected and hover: bg/border orange-light, text ink. Transition .15s.
  - Cities from `CITIES` in `core/config.js`. Categories from `api.getCategories(city)` prefixed with "All categories".

### 2. Cards step — header
Flex space-between, wrap, gap 16, padding 18×28. Left: icon 32×32 r9 + brand (Bricolage 800 20px nowrap). Right: two pills (DM Sans 600 14, padding 8×14, radius 999, bg purple, white, hover purple-dark) each containing a label span ("City" / "Category", orange-light, 500) + value.

### 3. Cards step — main
Column, align center, gap 36, padding 8px 20px 48px.
- Heading block centered, max 640: title "Which cards are you weighing up?" (same title style as question card, ink on orange) + "Pick a bank and card. Add up to 4." (16px).
- **Slot row**: flex-wrap, justify center, align flex-start, gap 20, max-width 1360.

#### Card slot (purple card)
Width 300, bg purple, radius 24, padding 22/22/20, shadow `0 20px 50px -22px oklch(0.3 0.18 295 / .7)`, flex column gap 14, `pop` animation (slots 1 and 2 staggered 0s / .12s).
- Header row (gap 8, min-height 30): "Card N" (Bricolage 700 18, nowrap). When >2 slots, a 30×30 round "×" button (bg `rgba(255,255,255,.12)`, hover .24) removes the slot.
- Field label style: 13px 500 lilac-text, column gap 6.
- **Bank** `<select>`: DM Sans 500 15, white text, bg `rgba(255,255,255,.1)`, border 1.5px `rgba(255,255,255,.22)`, radius 12, padding 10×12, `color-scheme: dark`. First option "Pick a bank". Banks from `api.getBanks(city)` (keep the Banks / Other issuers optgroups).
- **Card type** segmented: container grid 2 cols, gap 4, padding 4, bg `rgba(255,255,255,.1)`, radius 12. Buttons "Credit" / "Debit" (600 14, padding 8, radius 9). Active: bg orange-light, ink text; idle transparent, white. Default Credit. Switching type clears the chosen card if it doesn't match. (Cards with `cardType` NONE: show under a third option only if any exist — or omit; product call.)
- **Card** `<select>`: same style; disabled + opacity .55 until a bank is chosen; placeholder "Pick a bank first" / "Pick a card". Options = `session.bankCards` filtered by type; a card already chosen in another slot is `disabled`. Note each slot needs its own bank-cards list (fetch per slot, cached by api).
- **"I already have this card"** toggle: 40×24 track radius 999 (on: orange-light; off: `rgba(255,255,255,.2)`), 18px white knob at left 3px / 19px, transition .2s; label 14px 500 white. Multiple slots may be "have". Replaces the `#base` select — `baseTypeId` becomes a set `haveTypeIds` (the "gain" view and yearly value's "Extra if added to…" should use it; if `yearlyValue` needs a single base, use the first).
- **Info panel** (appears as soon as a card is picked; `reveal` animation): bg `oklch(0.3 0.16 295)`, radius 16, padding 16, column gap 12.
  - Row: "ANNUAL FEE" (12px 600 uppercase ls .06em lilac-text) + badge right (11px 600, padding 2×8, radius 999): "Verified" (orange-light bg, ink) when `fees.json` `verified: true`; "Unverified" (bg `rgba(255,255,255,.14)`, white); "Unknown" when fee null.
  - Known fee: amount "Rs 14,000" (Bricolage 800 30, lh 1, orange-light) + sub row (12px lilac-text, gap 10, wrap): source text (`effective` + source; "Your value" if user override) · **Edit** link · **Reset** link (only for overrides). Links: 600 12px, orange-light, underlined.
  - Unknown fee or editing: prompt "Fee not known yet. Enter it if you know it." (or "Enter the annual fee." when editing) + number input (140px wide, same field style, radius 10, padding 8×10, prefilled with current value, autofocus when editing) + hint "Press Enter to save". **Commit on Enter or blur, not on each keystroke.** Esc cancels edit. Empty input = cancel. Writes `state.feeOverrides[typeId]`; Reset deletes it.
  - "FEE REVERSAL" section (top border `rgba(255,255,255,.14)`, pt 12) only if the card has a reversal rule: 14px white text. **Data:** add a `reversal` string field to `fees.json` entries (currently the reversal text lives inside `note` — split it out, e.g. 806: "Spend Rs 200,000 within 60 days of the statement that charges the fee, then call 111-111-425 to request it. Discretionary."). Askari 636: "No fee waiver offered."
  - Note (12px lilac-text) = remaining `note` text.
  - Footer (top border, pt 12, space-between): "**N** of M places" (N in orange-light 700) + "best X%" (12px lilac-text). N = places the card covers in the current compare.
- **"+" add button** (to the right of the slots, `align-self: center`, only while < 4 slots): 64×64 purple circle, white "+" 36px, shadow `0 12px 28px -12px oklch(0.3 0.18 295/.8)`, hover scale 1.08; label below "Add card (3 of 4)" 600 14 ink. Adds an empty slot.

### 4. Results table
Container: max-width 1200, bg `#fffdfb`, radius 24, overflow hidden, shadow `0 24px 60px -28px oklch(0.3 0.18 295/.6)`.
- Toolbar (padding 20/24/14, space-between, wrap): title "{Category|All places} in {city}" (Bricolage 700 22) and controls (gap 14, wrap):
  - **Show** select: All places · Every card has a deal (≥2 cards) · Only one card has a deal (≥2 cards) · Another card beats mine (only if some-but-not-all cards are "have"). Map to `VIEWS` in `core/compare.js` (`all`, `common`, `unique`, `gain`); the per-card "Only X" views can be kept as extra options.
  - **Sort by** select: Highest discount % (default) · Highest max cap · Place name.
  - **for** select (shown only when sort ≠ name and ≥2 cards): "Any card (best offer)" (default) + each card. 
  - **Search** input "Search places" (220px, radius 999) — same as existing `#name-filter`.
  - Count text 13px: "N places" or "n of N places" when filtered.
  - Control style: DM Sans 600 14, ink text, bg `oklch(0.97 0.01 295)`, border 1.5px `oklch(0.88 0.04 295)`, radius 999, padding 7×12; labels 13px 600 `oklch(0.45 0.08 295)`.
- Empty (no complete card): "Pick a card above and its deals show up here." centered, padding 40/24/48.
- `<table>` min-width 560, horizontal scroll wrapper.
  - Head row bg purple, white. "Place" (13px 600, padding 12×24). Per-card th (min 150, padding 12×16): bank (12px 500 lilac-text) + name (14px 700) + "You have it" pill (11px 600, orange-light bg, ink) if have. Sort-target column: bg purple-dark, inset bottom 3px orange-light, and bank line suffixed " · sorted by % ↓" / " · sorted by cap ↓". "Best" th.
  - First body row "Annual fee" (bg `oklch(0.96 0.03 65)`): fee per card ("Rs 3,800" / "Unknown", 700 15); last cell "Lowest: {card}" when ≥2 fees known.
  - Place rows: top border `oklch(0.92 0.02 295)`; padding 14px (compact: 8px). Place name 600. Offer cell: % (Bricolage 700 20, purple) · "max Rs 2,000" / "cap unknown" (12px muted) · day badge (11px 600, bg `oklch(0.93 0.03 295)`, purple) e.g. "Tue only". No deal: "—" `oklch(0.7 0.04 295)`. Winner cell (≥2 cards, highest %): bg `oklch(0.94 0.06 65)`, % color `oklch(0.5 0.16 45)`. Best column: winner card name (700 14 purple) or "Tie" or "—". Keep the existing offer cell content too (`up to`, ending-soon badge, "saves Rs X" with a bill).
  - No matches row: "No places match "{q}"." or "No places match this filter."
- Footer disclaimer below table: 12px, centered, max 900, existing copy from app.html footer.

## Sorting rules (important)
Columns never reorder; only rows sort.
- Target = chosen card, or "any" = best across cards.
- **% sort**: key = target card's pct (any: max pct). Tie-break: cap, then name. Target card has no deal → bottom.
- **Cap sort**: key = target card's cap value (any: max known cap). Order: known caps desc → covered-but-cap-unknown → no deal. Tie-break: pct, then name.
- With a bill entered, existing behaviour ranks by rupees saved — keep that as the % sort's key or add "Most saved" option.
- If the chosen sort card is removed, fall back to "any".

## Animations
- `pop`: from `opacity 0; translateY(24px) scale(.94)` to none; 0.5s `cubic-bezier(.2,.9,.3,1.15)` both. Question cards and card slots on mount.
- `reveal`: from `opacity 0; translateY(-6px)`; 0.35s ease. Info panel.
- Respect `prefers-reduced-motion` (disable both).

## Persistence (chrome.storage via saveState)
Add: `step` (optional), `slots: [{bankId, cardType, typeId, have}]` (replaces `cards` + `baseTypeId`; keep migrating old `cards` → slots), `sort`, `sortTypeId`, `view`. Existing `feeOverrides`, `categoryId`, `city`, `myPlaces`, `bill` stay.

## Design tokens
- Orange page bg: `oklch(0.76 0.17 52)` (≈ #F48A3A)
- Purple card: `oklch(0.38 0.19 295)` (≈ #5A2DB0)
- Purple dark (hover/info panel): `oklch(0.32 0.18 295)` / `oklch(0.30 0.16 295)`
- Orange light accent: `oklch(0.82 0.15 60)` (≈ #F9A957); eyebrow variant `oklch(0.85 0.13 62)`
- Ink (text on orange/white): `oklch(0.25 0.12 295)`
- Lilac text on purple: `oklch(0.88 0.04 295)` / `oklch(0.85 0.04 295)`
- Muted on white: `oklch(0.45 0.08 295)`; borders on white `oklch(0.92 0.02 295)` / `oklch(0.88 0.04 295)`
- Table surface `#fffdfb`; fee row `oklch(0.96 0.03 65)`; winner cell `oklch(0.94 0.06 65)`; winner % `oklch(0.5 0.16 45)`
- On-purple field bg `rgba(255,255,255,.1)`, border `rgba(255,255,255,.22)`
- Radii: 28 question card · 24 slot/table · 16 info panel · 12 fields · 10 fee input · 9 segment · 999 pills
- Fonts (Google Fonts): **Bricolage Grotesque** 500/700/800 (titles, numbers) and **DM Sans** 400–700 (UI). Body 15px/1.45. For an extension, bundle the woff2 files locally under `extension/fonts/` (MV3 CSP blocks remote CSS by default) and declare `@font-face` in `app.css`.
- Dark mode: the current app has a dark theme; this design is light-only. Product decision — either drop dark mode or derive one (purple page, darker cards).

## Assets
- `icons/icon48.png` (existing extension icon). No other images.

## Screenshots
`screenshots/1-city-question.png`, `2-category-question.png`, `3-card-slots-with-info.png`, `4-results-table.png`. Captured with a DOM renderer: the selects show their placeholder instead of the chosen bank/card, and some pills/headers wrap where the live page does not — trust the source/README for those.

## Files
- `Card Compare.dc.html` — the prototype (template + logic class at the bottom). Mock data: `BANKS`, `PLACES`, `offer()` — **replace with real API data**.
- Target files in repo: `extension/app.html`, `extension/app.js`, `extension/app.css`, `extension/data/fees.json` (add `reversal`).

## Suggested Claude Code prompt
> Implement the redesign in `design_handoff_card_compare_redesign/README.md` in `extension/`. Use `Card Compare.dc.html` as the visual reference. Keep all core/ logic and tests passing (`npm test`). Keep the My places and Check one place tabs working.
