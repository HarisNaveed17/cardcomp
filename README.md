# CardComp: Find the Best Pakistani Card For You

Compares Pakistani bank card discounts before you visit a place: discount %, the maximum discount per transaction (cap), valid days, end dates and annual fees. It answers "which card should I get?" and "is a second card worth its fee?".

Live at https://cardcomp.hnaveed.me. The same page also ships as a Chrome extension. Unofficial, not affiliated with any bank.

## Install (testers)

1. Unzip `best-card-for-you-<version>.zip` into a folder you will keep.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Pin the extension and click its icon. The comparison page opens in a new tab.

## How to use it

1. Pick your city, then add 1 to 4 cards (pick a bank, then a card).
2. Optional: pick a category (for example Food) and enter your typical bill.
3. Press **Compare**. The first load of a card takes a few seconds per card. Results are cached for a day.
4. **Compare places**: every place any of your cards covers, the best card per place, and filters such as "only one card covers" or "where another card beats the card I have". Click a place to see each card's deals and full terms. Caps, valid days and dates then load in the background for every place, the page on screen first (one request per place, about 0.8 s each, cached for 3 days); **Retry loading caps** appears if a request failed.
5. Star ☆ the places you go to. Starred places, their visits and bills, and annual fees you type sync to your other computers when Chrome sync is on (install from a clone of the repo, which keeps the extension ID the same; the tester zip gets a different ID per folder). **My places & yearly value** shows yearly savings minus the annual fee for each card, the break-even spend, and how much a new card adds to the card you already have.
6. **Check one place**: search a place by name to see your cards' offers and every other card's deal there.

Things to know:

- With a bill entered, cards are ranked by rupees saved (caps included). A 30% card with a Rs 2,000 cap loses to a 20% card with a Rs 6,000 cap on a Rs 15,000 bill.
- "cap unknown" means the terms mention a cap the tool could not read. Check **Full terms**.
- Annual fees are entered by hand and many are unknown. You can type a fee into a card. A card with an unknown fee is left out of the value ranking.
- Savings assume each visit falls on a valid day. Day-limited deals (for example "Tue only") are marked.

## Development

Plain JavaScript ES modules, no build step and no dependencies. Needs Node 20+ (tests) and Python 3 with Pillow (icons only).

```sh
npm test          # unit tests against fixtures/ (no network)
npm run dev       # serve the page on http://127.0.0.1:8765/app.html with live data
npm run package   # run tests, then zip extension/ into dist/
npm run build:web # run tests, then build the website into dist/web/
npm run icons     # redraw extension/icons/
```

Layout:

- `extension/core/`: browser-free logic. `config.js` (token, API paths, cities), `api.js` (client with a serial queue, 300 ms between requests, and a cache), `parse.js` (cap and weekday parsers), `normalize.js`, `compare.js` (join, best card, ties, yearly value), `format.js`, `csv.js`.
- `extension/platform/chrome-storage.js`: cache and settings in `chrome.storage.local`; starred places and typed fees also in `chrome.storage.sync`. `sync-format.js` is the sync layout (chunked per city, under the 8 KB per-item quota).
- `extension/app.html`, `app.js`, `app.css`, `dom.js`: the page.
- `web/chrome-shim.js`: `chrome.storage` for the website and `npm run dev` (IndexedDB for the cache and settings, localStorage for starred places and fees).
- `extension/data/fees.json`: annual fees by card `typeId`, entered by hand.
- `test/`: `node:test` suites using `fixtures/`.

See `CLAUDE.md` for the API notes and `PUBLISHING.md` before sharing the extension.
