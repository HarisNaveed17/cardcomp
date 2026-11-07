#!/usr/bin/env bash
# Run the tests, then zip extension/ into dist/ for the Chrome Web Store or for testers.
set -euo pipefail
cd "$(dirname "$0")/.."

node --test "test/*.test.js" > /dev/null || { echo "Tests failed; not packaging." >&2; exit 1; }

version=$(node -p "require('./extension/manifest.json').version")
out="dist/best-card-for-you-${version}.zip"
mkdir -p dist
rm -f "$out"
# The manifest "key" pins the extension ID for load-unpacked installs (so chrome.storage.sync matches
# across devices). The Chrome Web Store rejects it and assigns its own ID, so the zip leaves it out.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -r extension/. "$stage"
node -e 'const fs = require("fs"); const p = process.argv[1]; const m = JSON.parse(fs.readFileSync(p)); delete m.key; fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");' "$stage/manifest.json"
(cd "$stage" && zip -qr "$OLDPWD/$out" . -x '.*' -x '*/.*')
echo "Wrote $out"
