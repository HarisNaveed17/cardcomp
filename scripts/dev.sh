#!/usr/bin/env bash
# Serve the extension page on http://127.0.0.1:8765/app.html with chrome.storage emulated by
# web/chrome-shim.js (the same as the hosted site), for UI work without reloading the extension.
# The API answers with Access-Control-Allow-Origin: *, so live data works from localhost too.
# Files are served live with Cache-Control: no-store: edit, then reload the page.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 scripts/dev-server.py "${PORT:-8765}"
