#!/usr/bin/env python3
"""Run the private IELTS study interface on this computer."""

import argparse
import base64
import binascii
from collections import deque
import getpass
import hashlib
import hmac
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import math
import os
from pathlib import Path
import sys
from threading import Lock
import time


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
FAILURE_LIMIT = 5
WINDOW_SECONDS = 60
ROUTES = {
    "/": ("public/index.html", "text/html; charset=utf-8"),
    "/index.html": ("public/index.html", "text/html; charset=utf-8"),
    "/app.js": ("public/app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("public/styles.css", "text/css; charset=utf-8"),
    "/api/db.json": ("data/db.json", "application/json; charset=utf-8"),
}


class StudyServer(ThreadingHTTPServer):
    def __init__(self, port, username, password):
        self.username_digest = hashlib.sha256(username.encode("utf-8")).digest()
        self.password_digest = hashlib.sha256(password.encode("utf-8")).digest()
        self.failures = deque()
        self.auth_lock = Lock()
        super().__init__((HOST, port), StudyHandler)

    def authenticate(self, authorization):
        """Return (authenticated, retry_after_seconds)."""
        if not authorization:
            return False, 0

        with self.auth_lock:
            now = time.monotonic()
            while self.failures and self.failures[0] <= now - WINDOW_SECONDS:
                self.failures.popleft()
            if len(self.failures) >= FAILURE_LIMIT:
                return False, math.ceil(self.failures[0] + WINDOW_SECONDS - now)
            if self.matches(authorization):
                return True, 0
            self.failures.append(now)
            return False, 0

    def matches(self, authorization):
        if len(authorization) != 1:
            return False
        scheme, _, encoded = authorization[0].partition(" ")
        if scheme.lower() != "basic":
            return False
        try:
            username, separator, password = base64.b64decode(encoded, validate=True).partition(b":")
        except (binascii.Error, ValueError):
            return False
        if not separator:
            return False
        username_matches = hmac.compare_digest(hashlib.sha256(username).digest(), self.username_digest)
        password_matches = hmac.compare_digest(hashlib.sha256(password).digest(), self.password_digest)
        return username_matches and password_matches


class StudyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve()

    def do_HEAD(self):
        self.serve()

    def log_message(self, format, *args):
        # Avoid recording request targets or headers from local clients.
        pass

    def respond(self, status, body=b"", content_type="text/plain; charset=utf-8", **headers):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "img-src 'self' data:; media-src https:; form-action 'none'; "
            "frame-ancestors 'none'; base-uri 'none'",
        )
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def serve(self):
        port = self.server.server_port
        hosts = {f"{HOST}:{port}", f"localhost:{port}"}
        if port == 80:
            hosts.update({HOST, "localhost"})
        host = self.headers.get_all("Host", [])
        if len(host) != 1 or host[0].lower() not in hosts:
            self.respond(HTTPStatus.MISDIRECTED_REQUEST, b"Invalid local host")
            return
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.respond(HTTPStatus.FORBIDDEN, b"Cross-site request blocked")
            return

        route = ROUTES.get(self.path.partition("?")[0])
        if route is None:
            self.respond(HTTPStatus.NOT_FOUND, b"Not found")
            return

        authenticated, retry_after = self.server.authenticate(self.headers.get_all("Authorization"))
        if retry_after:
            self.respond(
                HTTPStatus.TOO_MANY_REQUESTS,
                b"Too many login attempts",
                **{"Retry-After": str(retry_after)},
            )
            return
        if not authenticated:
            self.respond(
                HTTPStatus.UNAUTHORIZED,
                b"Authentication required",
                **{"WWW-Authenticate": 'Basic realm="IELTS Study", charset="UTF-8"'},
            )
            return

        path, content_type = route
        try:
            body = (ROOT / path).read_bytes()
        except OSError:
            self.respond(HTTPStatus.SERVICE_UNAVAILABLE, b"Study file unavailable")
            return
        self.respond(HTTPStatus.OK, body, content_type)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000, help="Local port (default: 8000)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")

    username = os.environ.get("IELTS_USERNAME")
    password = os.environ.get("IELTS_PASSWORD")
    if username is None and password is None and sys.stdin.isatty():
        try:
            username = input("IELTS username: ")
            password = getpass.getpass("IELTS password: ")
        except (EOFError, KeyboardInterrupt):
            return 1
    if not username or ":" in username or not password:
        parser.error("Provide IELTS_USERNAME (no colon) and IELTS_PASSWORD, or run in a terminal")

    try:
        server = StudyServer(args.port, username, password)
    except OSError as exc:
        parser.exit(1, f"Could not start local server: {exc}\n")
    del password
    with server:
        print(f"IELTS Study: http://{HOST}:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
