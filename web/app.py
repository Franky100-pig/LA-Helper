"""LA Helper local web server.

Run:  python web/app.py
This starts a local HTTP server and opens http://localhost:8000 in your browser.
Only the Python standard library is used for the server; SymPy does the math.
"""
import os
import sys
import json
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core.engine import compute  # noqa: E402

HOST = "127.0.0.1"
PORT = 8000


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, content_type="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_file(self, name, ctype):
        fp = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
        try:
            with open(fp, "r", encoding="utf-8") as f:
                self._send(200, f.read(), ctype)
        except FileNotFoundError:
            self._send(404, {"error": name + " not found"})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._serve_file("index.html", "text/html")
        elif path == "/app.js":
            self._serve_file("app.js", "application/javascript")
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] == "/api/compute":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            try:
                req = json.loads(raw.decode("utf-8"))
            except Exception:
                self._send(400, {"ok": False, "error": "bad JSON"})
                return
            result = compute(req.get("op"), req.get("A"),
                            req.get("B"), bool(req.get("showSteps", True)))
            self._send(200, result)
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *args):
        pass


def main():
    server = HTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print(f"LA Helper running at {url}  (Ctrl+C to stop)")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
