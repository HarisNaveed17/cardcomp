# Publishing checklist

Peekaboo does not mind the tool as long as it is not monetized (user's decision, October 2026). Keep it free: no ads, paid tiers or affiliate links.

## Website (cardcomp.hnaveed.me)

The page runs as a static site on GitHub Pages, from this repo (`HarisNaveed17/cardcomp`, custom domain `cardcomp.hnaveed.me`). No backend: the API allows any origin, and each visitor's browser calls it directly.

Deploying is automatic: push to `main` and `.github/workflows/deploy.yml` runs the tests, builds `dist/web/` with `npm run build:web`, and publishes it. If the tests fail, nothing is deployed. Check progress in the repo's Actions tab.

One-time setup (done): Pages source set to "GitHub Actions" (Settings → Pages), custom domain `cardcomp.hnaveed.me`, HTTPS enforced, and a Porkbun `CNAME` record with host `cardcomp` pointing to `harisnaveed17.github.io`. The desktop icon on hnaveed.me is the `cardcomp` entry in `src/data/windows-data.json` of the personal site repo.

## Extension: store or zip

Two ways to share the extension with testers:

| | Zip + Load unpacked | Chrome Web Store, Unlisted |
|---|---|---|
| Install | Testers enable Developer mode and load a folder | One click from a link |
| Updates | Send a new zip | Automatic |
| Review | None | Google review (host permissions get a closer look) |
| Exposure | Only people you send it to | Anyone with the link; the listing and the code (including the Peekaboo guest token) are public to them |
| Cost | Free | One-time $5 developer fee |

The code already does what it can to be a polite client: one request at a time, 300 ms apart, and results cached for 1 to 7 days. Caps are loaded in the background for every place in a comparison (one request per place), so a cold compare sends one request per place.

## Before each release

1. Bump `version` in `extension/manifest.json` (and `package.json`).
2. Review `extension/data/fees.json`. Fee schedules change every January and July.
3. `npm run package` runs the tests and writes `dist/best-card-for-you-<version>.zip`.
4. Push to `main` to update the website.
5. Load the unzipped folder in `chrome://extensions` and smoke-test: Compare (caps fill in after the places), star a place, Check one place.

## Chrome Web Store submission

1. Register at the Chrome Web Store Developer Dashboard (one-time $5).
2. **New item** → upload the zip from `dist/`. The zip has no manifest `key` (the store rejects it), so the store version gets a different extension ID from the unpacked one, and its synced starred places are separate.
3. **Store listing**
   - Name: CardComp: Find the Best Pakistani Card For You (46 characters; the store allows 75)
   - Summary (132 chars max): Compare Pakistani bank card discounts, caps and annual fees before you visit. Unofficial; uses data from peekaboo.guru.
   - Description: see below.
   - Category: Shopping (or Productivity).
   - Icon: `extension/icons/icon128.png`.
   - Screenshots: at least one 1280×800 PNG of the comparison table. Do not show the Peekaboo logo or name it as the product.
4. **Privacy practices**
   - Single purpose: "Compare discounts offered by Pakistani bank cards at shops and restaurants, so the user can decide which card to get or use."
   - `storage` justification: "Saves the user's settings (city, selected cards, bill size, starred places) and caches discount data locally to avoid repeated network requests. Starred places and typed annual fees use Chrome sync storage so they follow the user to their other devices."
   - Host permission `https://peekaboo.guru/*` justification: "Reads public discount data (banks, cards, places, deals) from peekaboo.guru, the source of the comparison."
   - Remote code: No.
   - Data usage: collects none of the listed data types. Certify the three disclosures (no selling, no unrelated use, no creditworthiness use).
   - Privacy policy URL: host `PRIVACY.md` somewhere public (a GitHub Gist or GitHub Pages works) and paste the link.
5. **Distribution** → Visibility: **Unlisted**. Regions: Pakistan (or all).
6. Submit for review. Share the store link with testers once approved.

### Description

> Compare the discounts your bank cards (or the cards you are thinking of getting) give at restaurants and shops in Pakistani cities.
>
> • Pick 1 to 4 cards from any bank and see every place each one covers.
> • See the discount %, the maximum discount per transaction (cap), the valid days and the end date of each deal.
> • Enter your typical bill: cards are ranked by rupees saved, so a lower % with a higher cap can win.
> • Star the places you go to and see yearly savings minus the annual fee, the break-even spend, and what a second card adds.
> • Search one place and see every card's deal there.
> • Export the table as CSV.
>
> Unofficial. Not affiliated with Peekaboo Guru or any bank. Uses public data from peekaboo.guru. Discounts change often; confirm with the bank or the place before you pay. Annual fees are entered by hand and may be out of date.
