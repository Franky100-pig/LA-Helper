"""Regression tests for the local web server's request guards.

These exist because two bugs slipped through while the body-reading logic was
duplicated per route:

* ``/api/format`` had no size cap at all (only ``/api/compute`` did), so a huge
  declared ``Content-Length`` would be buffered in full before parsing;
* a negative ``Content-Length`` made ``rfile.read(-1)`` block until EOF, which
  pinned a worker thread forever — repeated requests could starve the server.

Both routes now share ``Handler._read_json_body``, so the limits cannot drift
apart again. These tests talk to a real socket so the guards are exercised
end-to-end, not just at the function level.
"""
import importlib.util
import socket
import sys
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# web/app.py is not a package module (no __init__.py in web/), so load it by path.
_SPEC = importlib.util.spec_from_file_location("la_web_app", ROOT / "web" / "app.py")
web_app = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(web_app)


@pytest.fixture(scope="module")
def server():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), web_app.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield httpd, httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def raw_post(server, path, content_length, body=b"", timeout=5.0):
    """Send a hand-rolled request. Returns (status_line, elapsed_seconds).

    Deliberately declares ``content_length`` without necessarily sending that
    many bytes: the guards must reject on the *declared* size, before reading.
    """
    _, port = server
    sock = socket.create_connection(("127.0.0.1", port), timeout=timeout)
    head = (
        f"POST {path} HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        f"Content-Type: application/json\r\n"
        f"Content-Length: {content_length}\r\n"
        f"Connection: close\r\n\r\n"
    ).encode()
    start = time.time()
    try:
        sock.sendall(head + body)
        data = b""
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            data += chunk
    except socket.timeout:
        raise AssertionError(
            f"server hung on {path} with Content-Length: {content_length}"
        )
    finally:
        sock.close()
    elapsed = time.time() - start
    return data.split(b"\r\n")[0].decode(errors="replace"), elapsed


@pytest.mark.parametrize("path", ["/api/compute", "/api/format"])
def test_oversized_body_is_rejected(server, path):
    """Both routes must cap the body — /api/format used to have no cap."""
    status, _ = raw_post(server, path, web_app.MAX_BODY + 1)
    assert "413" in status, status


@pytest.mark.parametrize("path", ["/api/compute", "/api/format"])
def test_negative_content_length_is_rejected_not_hung(server, path):
    """Content-Length: -1 used to make rfile.read(-1) block until EOF."""
    status, elapsed = raw_post(server, path, -1, timeout=5.0)
    assert "400" in status, status
    assert elapsed < 3.0, f"took {elapsed:.1f}s — looks like it blocked"


def test_normal_compute_still_works(server):
    body = b'{"op":"det","A":[["1","2"],["3","4"]]}'
    status, _ = raw_post(server, "/api/compute", len(body), body)
    assert "200" in status, status


def test_host_header_is_checked(server):
    _, port = server
    sock = socket.create_connection(("127.0.0.1", port), timeout=5.0)
    sock.sendall(
        f"GET / HTTP/1.1\r\nHost: evil.example.com\r\nConnection: close\r\n\r\n".encode()
    )
    data = b""
    while True:
        chunk = sock.recv(65536)
        if not chunk:
            break
        data += chunk
    sock.close()
    assert "403" in data.split(b"\r\n")[0].decode(errors="replace")
