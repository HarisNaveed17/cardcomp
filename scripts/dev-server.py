"""Serve extension/ on localhost for UI work, straight from the source files.

app.html gets web/chrome-shim.js injected (chrome.storage emulated, as on the hosted site), and every
response is sent with Cache-Control: no-store, so a plain reload always shows the latest files.
"""

import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / 'extension'
SHIM = ROOT / 'web' / 'chrome-shim.js'
MODULE_TAG = '<script type="module" src="app.js"></script>'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(EXTENSION), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in ('/', '/app.html'):
            html = (EXTENSION / 'app.html').read_text(encoding='utf-8')
            return self.send_bytes(html.replace(MODULE_TAG, '<script src="chrome-shim.js"></script>\n  ' + MODULE_TAG), 'text/html; charset=utf-8')
        if path == '/chrome-shim.js':
            return self.send_bytes(SHIM.read_text(encoding='utf-8'), 'text/javascript; charset=utf-8')
        return super().do_GET()

    def send_bytes(self, text, content_type):
        body = text.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'Open http://127.0.0.1:{port}/app.html (edits show on reload; Ctrl+C to stop)', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
