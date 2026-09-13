"""LA Helper local web server.

Run:  python web/app.py [--port 8000] [--no-browser]
This starts a local HTTP server and opens http://127.0.0.1:<port> in your browser.
Only the Python standard library is used for the server; SymPy does the math.
"""
import argparse
import os
import sys
import json
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core.engine import compute  # noqa: E402

HOST = "127.0.0.1"
PORT = 8000
MAX_BODY = 64 * 1024          # a 16x16 grid of numbers is a few KB; 64KB is plenty
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
WEB_DIR = os.path.dirname(os.path.abspath(__file__))


class Handler(BaseHTTPRequestHandler):
    server_version = "LAHelper/1.0"
    protocol_version = "HTTP/1.1"

    def _send(self, code, body, content_type="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _bad_host(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        return host not in ALLOWED_HOSTS

    def _serve_file(self, name, ctype):
        fp = os.path.join(WEB_DIR, name)
        try:
            with open(fp, "r", encoding="utf-8") as f:
                self._send(200, f.read(), ctype)
        except FileNotFoundError:
            self._send(404, {"error": name + " not found"})

    def do_GET(self):
        if self._bad_host():
            self._send(403, {"error": "forbidden host"})
            return
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._serve_file("index.html", "text/html")
        elif path == "/app.js":
            self._serve_file("app.js", "application/javascript")
        elif path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self._send(404, {"error": "not found"})

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if self._bad_host():
            self._send(403, {"error": "forbidden host"})
            return
        if self.path.split("?")[0] != "/api/compute":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self._send(400, {"ok": False, "error": "bad Content-Length"})
            return
        if length > MAX_BODY:
            self._send(413, {"ok": False, "error": f"请求体过大（>{MAX_BODY} 字节）"})
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send(400, {"ok": False, "error": "bad JSON"})
            return
        if not isinstance(req, dict):
            self._send(400, {"ok": False, "error": "bad request"})
            return
        result = compute(req.get("op"), req.get("A"),
                         req.get("B"), bool(req.get("showSteps", True)))
        self._send(200, result)

    def log_message(self, fmt, *args):
        if "--verbose" in sys.argv:
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser(description="LA Helper local server")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    port = args.port
    for attempt in range(10):
        try:
            server = ThreadingHTTPServer((HOST, port), Handler)
            break
        except OSError:
            print(f"端口 {port} 被占用，尝试 {port + 1} …")
            port += 1
    else:
        print("找不到可用端口（尝试了 10 个）。")
        return

    url = f"http://{HOST}:{port}/"
    print(f"LA Helper running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
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
