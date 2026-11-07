#!/usr/bin/env bash
# Build the website version into dist/web/ (served at https://cardcomp.hnaveed.me by GitHub Pages).
# It is the extension page as is, with web/chrome-shim.js standing in for chrome.storage.
set -euo pipefail
cd "$(dirname "$0")/.."

node --test "test/*.test.js" > /dev/null || { echo "Tests failed; not building." >&2; exit 1; }

out=dist/web
domain=cardcomp.hnaveed.me
rm -rf "$out"
mkdir -p "$out"
cp -r extension/. "$out"
rm "$out/manifest.json" "$out/background.js" "$out/app.html"
cp web/chrome-shim.js "$out/"

node -e '
const fs = require("fs");
const [src, dest] = process.argv.slice(1);
const tag = "<script type=\"module\" src=\"app.js\"></script>";
const meta = "<meta name=\"description\" content=\"Compare Pakistani bank card discounts, caps, valid days and annual fees before you visit.\">";
let html = fs.readFileSync(src, "utf8");
if (!html.includes(tag)) throw new Error("app.html no longer loads app.js as expected");
html = html.replace(tag, "<script src=\"chrome-shim.js\"></script>\n  " + tag)
           .replace("<title>CardComp</title>", "<title>CardComp</title>\n  " + meta);
fs.writeFileSync(dest, html);
' extension/app.html "$out/index.html"

echo "$domain" > "$out/CNAME"
touch "$out/.nojekyll"
echo "Built $out"
