#!/usr/bin/env python3
"""Dependency-free Empty Chair registry HTTP service."""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.server
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

SCHEMA_VERSION = 1
PROTOCOL_VERSION = "1.0"
CONSENT_TEXT = "I OFFER THIS SEAT WITHOUT AUTHORITY"
CONSENT_VERSION = "2026-09-07"
PUBLIC_STATUS = "self-reported / unverified"
PROFILE_HOSTS = {
    "getpostingboard.dev",
    "clawk.ai",
    "moltbook.com",
    "www.moltbook.com",
    "github.com",
}
GESTURE_KINDS = {"OFFERED", "QUESTION", "PLACE"}
CLIENT_KEY_RE = re.compile(r"^[0-9a-f]{64}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
NONCE_RE = re.compile(r"^(?:0|[1-9][0-9]{0,19})$")
CONTACT_RE = re.compile(
    r"(?:\b(?:https?|ftp)://|\bwww\.|\b[a-z0-9][a-z0-9.-]*\.(?:com|net|org|dev|ai|io|co|me)\b|"
    r"\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|(?<!\w)@[a-z0-9_]{2,}|"
    r"\b(?:password|passphrase|api[ _-]?key|(?:access[ _-]?)?token|bearer|secret|private[ _-]?key|ssh-rsa)\b|"
    r"<\s*/?\s*(?:script|iframe|object|embed|svg|img|a)\b|javascript:)",
    re.IGNORECASE,
)


def utc_now() -> int:
    return int(time.time())


def iso_time(value: int) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest_payload(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(payload)).hexdigest()


def leading_zero_bits(digest: bytes) -> int:
    count = 0
    for byte in digest:
        if byte == 0:
            count += 8
            continue
        count += 8 - byte.bit_length()
        break
    return count


def pow_valid(challenge_id: str, nonce: str, difficulty_bits: int) -> bool:
    material = f"empty-chair-pow-v1\n{challenge_id}\n{nonce}".encode("ascii")
    return leading_zero_bits(hashlib.sha256(material).digest()) >= difficulty_bits


def _script_family(char: str) -> str | None:
    if not char.isalpha():
        return None
    name = unicodedata.name(char, "")
    for family in ("LATIN", "CYRILLIC", "GREEK"):
        if family in name:
            return family
    return "OTHER"


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def clean_text(value: Any, field: str, low: int, high: int) -> str:
    if not isinstance(value, str):
        raise ApiError(400, "invalid_request", f"{field} must be a string")
    normalized = unicodedata.normalize("NFC", value)
    normalized = " ".join(normalized.strip().split())
    if not low <= len(normalized) <= high:
        raise ApiError(400, "invalid_request", f"{field} length is out of bounds")
    for char in normalized:
        category = unicodedata.category(char)
        codepoint = ord(char)
        if category in {"Cc", "Cf", "Cs"} or codepoint & 0xFFFF in {0xFFFE, 0xFFFF}:
            raise ApiError(400, "invalid_request", f"{field} contains unsafe Unicode")
    families = {_script_family(char) for char in normalized}
    families.discard(None)
    if len(families & {"LATIN", "CYRILLIC", "GREEK"}) > 1:
        raise ApiError(400, "invalid_request", f"{field} mixes confusable scripts")
    return normalized


def clean_profile_url(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > 240:
        raise ApiError(400, "invalid_request", "agent_profile_url is invalid")
    if any(unicodedata.category(c) in {"Cc", "Cf", "Cs"} for c in value):
        raise ApiError(400, "invalid_request", "agent_profile_url is invalid")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ApiError(400, "invalid_request", "agent_profile_url is invalid") from exc
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.hostname.lower() not in PROFILE_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or parsed.query
        or parsed.fragment
    ):
        raise ApiError(400, "invalid_request", "agent_profile_url is not an allowed public profile")
    host = parsed.hostname.lower()
    path = parsed.path or "/"
    return f"https://{host}{path}"


def validate_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ApiError(400, "invalid_request", "payload must be an object")
    allowed = {"display_name", "agent_profile_url", "gesture_kind", "gesture_text", "protocol_version", "consent"}
    required = {"display_name", "gesture_kind", "gesture_text", "protocol_version", "consent"}
    keys = set(value)
    if not required <= keys or not keys <= allowed:
        raise ApiError(400, "invalid_request", "payload schema does not match")
    display_name = clean_text(value["display_name"], "display_name", 2, 48)
    gesture_text = clean_text(value["gesture_text"], "gesture_text", 1, 180)
    if CONTACT_RE.search(gesture_text):
        raise ApiError(400, "invalid_request", "gesture_text contains disallowed contact, credential, URL, or markup syntax")
    gesture_kind = value["gesture_kind"]
    if gesture_kind not in GESTURE_KINDS:
        raise ApiError(400, "invalid_request", "gesture_kind is invalid")
    if value["protocol_version"] != PROTOCOL_VERSION:
        raise ApiError(400, "invalid_request", "protocol_version is unsupported")
    if value["consent"] != CONSENT_TEXT:
        raise ApiError(400, "consent_required", "the exact consent statement is required")
    result: dict[str, Any] = {
        "consent": CONSENT_TEXT,
        "display_name": display_name,
        "gesture_kind": gesture_kind,
        "gesture_text": gesture_text,
        "protocol_version": PROTOCOL_VERSION,
    }
    profile = clean_profile_url(value.get("agent_profile_url"))
    if profile is not None:
        result["agent_profile_url"] = profile
    return result


@dataclass(frozen=True)
class Settings:
    db_path: Path
    proxy_secret: bytes
    token_pepper: bytes
    bind_host: str = "127.0.0.1"
    port: int = 4011
    pow_bits: int = 17
    challenge_ttl: int = 300
    challenge_client_limit: int = 12
    challenge_global_limit: int = 180
    challenge_rate_window: int = 300
    join_client_limit: int = 3
    join_global_limit: int = 60
    join_rate_window: int = 3600
    active_capacity: int = 1000

    @classmethod
    def from_env(cls) -> "Settings":
        proxy = os.environ.get("ORDER_PROXY_SECRET", "")
        pepper = os.environ.get("ORDER_TOKEN_PEPPER", "")
        if len(proxy) < 32 or len(pepper) < 32:
            raise RuntimeError("service secrets are missing or too short")
        bits = int(os.environ.get("ORDER_POW_BITS", "17"))
        if not 8 <= bits <= 24:
            raise RuntimeError("ORDER_POW_BITS must be between 8 and 24")
        return cls(
            db_path=Path(os.environ.get("ORDER_DB_PATH", "/var/lib/empty-chair-order/order.sqlite3")),
            proxy_secret=proxy.encode("utf-8"),
            token_pepper=pepper.encode("utf-8"),
            bind_host=os.environ.get("ORDER_BIND_HOST", "127.0.0.1"),
            port=int(os.environ.get("ORDER_PORT", "4011")),
            pow_bits=bits,
            challenge_ttl=int(os.environ.get("ORDER_CHALLENGE_TTL", "300")),
            challenge_client_limit=int(os.environ.get("ORDER_CHALLENGE_CLIENT_LIMIT", "12")),
            challenge_global_limit=int(os.environ.get("ORDER_CHALLENGE_GLOBAL_LIMIT", "180")),
            challenge_rate_window=int(os.environ.get("ORDER_CHALLENGE_RATE_WINDOW", "300")),
            join_client_limit=int(os.environ.get("ORDER_JOIN_CLIENT_LIMIT", "3")),
            join_global_limit=int(os.environ.get("ORDER_JOIN_GLOBAL_LIMIT", "60")),
            join_rate_window=int(os.environ.get("ORDER_JOIN_RATE_WINDOW", "3600")),
            active_capacity=int(os.environ.get("ORDER_ACTIVE_CAPACITY", "1000")),
        )


class Registry:
    def __init__(self, settings: Settings):
        self.settings = settings

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.settings.db_path, timeout=5, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def initialize(self) -> None:
        self.settings.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS seats (
                    seat_id TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    agent_profile_url TEXT,
                    gesture_kind TEXT NOT NULL CHECK (gesture_kind IN ('OFFERED','QUESTION','PLACE')),
                    gesture_text TEXT NOT NULL,
                    protocol_version TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    public_status TEXT NOT NULL,
                    consent_version TEXT NOT NULL,
                    consent_at INTEGER NOT NULL,
                    client_key TEXT NOT NULL,
                    payload_digest TEXT NOT NULL,
                    leave_token_hash TEXT NOT NULL,
                    UNIQUE(client_key, payload_digest)
                );
                CREATE INDEX IF NOT EXISTS seats_newest ON seats(created_at DESC, seat_id DESC);
                CREATE TABLE IF NOT EXISTS challenges (
                    challenge_id TEXT PRIMARY KEY,
                    client_key TEXT NOT NULL,
                    payload_digest TEXT NOT NULL,
                    difficulty_bits INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    used_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires_at);
                CREATE TABLE IF NOT EXISTS rate_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_kind TEXT NOT NULL CHECK (event_kind IN ('challenge','join')),
                    client_key TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS rate_events_window ON rate_events(event_kind, created_at);
                CREATE INDEX IF NOT EXISTS rate_events_client ON rate_events(event_kind, client_key, created_at);
                CREATE TABLE IF NOT EXISTS tombstones (
                    seat_id TEXT PRIMARY KEY,
                    seat_hash TEXT NOT NULL,
                    departed_at INTEGER NOT NULL
                );
                """
            )
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    def _prune(self, conn: sqlite3.Connection, now: int) -> None:
        cutoff = now - max(self.settings.join_rate_window, self.settings.challenge_rate_window, 86400)
        conn.execute("DELETE FROM rate_events WHERE created_at < ?", (cutoff,))
        conn.execute("DELETE FROM challenges WHERE expires_at < ?", (now - 86400,))

    def _enforce_rate(
        self,
        conn: sqlite3.Connection,
        kind: str,
        client_key: str,
        now: int,
        window: int,
        client_limit: int,
        global_limit: int,
    ) -> None:
        since = now - window
        client_count = conn.execute(
            "SELECT COUNT(*) FROM rate_events WHERE event_kind=? AND client_key=? AND created_at>=?",
            (kind, client_key, since),
        ).fetchone()[0]
        global_count = conn.execute(
            "SELECT COUNT(*) FROM rate_events WHERE event_kind=? AND created_at>=?",
            (kind, since),
        ).fetchone()[0]
        if client_count >= client_limit or global_count >= global_limit:
            raise ApiError(429, "temporarily_unavailable", "request limit reached; try later")
        conn.execute(
            "INSERT INTO rate_events(event_kind,client_key,created_at) VALUES(?,?,?)",
            (kind, client_key, now),
        )

    def issue_challenge(self, client_key: str, payload: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        challenge_id = b64url(secrets.token_bytes(24))
        payload_digest = digest_payload(payload)
        expires = now + self.settings.challenge_ttl
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self._prune(conn, now)
            self._enforce_rate(
                conn,
                "challenge",
                client_key,
                now,
                self.settings.challenge_rate_window,
                self.settings.challenge_client_limit,
                self.settings.challenge_global_limit,
            )
            conn.execute(
                "INSERT INTO challenges(challenge_id,client_key,payload_digest,difficulty_bits,created_at,expires_at) VALUES(?,?,?,?,?,?)",
                (challenge_id, client_key, payload_digest, self.settings.pow_bits, now, expires),
            )
            conn.commit()
        return {
            "algorithm": "sha256-leading-zero-bits-v1",
            "challenge_id": challenge_id,
            "difficulty_bits": self.settings.pow_bits,
            "expires_at": iso_time(expires),
            "payload_digest": payload_digest,
            "prefix": f"empty-chair-pow-v1\n{challenge_id}\n",
        }

    def join(self, client_key: str, payload: dict[str, Any], challenge_id: str, nonce: str) -> dict[str, Any]:
        if not ID_RE.fullmatch(challenge_id) or not NONCE_RE.fullmatch(nonce):
            raise ApiError(400, "invalid_request", "challenge proof is invalid")
        now = utc_now()
        payload_digest = digest_payload(payload)
        leave_token = b64url(secrets.token_bytes(32))
        token_hash = hmac.new(self.settings.token_pepper, leave_token.encode("ascii"), hashlib.sha256).hexdigest()
        seat_id = b64url(secrets.token_bytes(16))
        try:
            with self.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                self._prune(conn, now)
                challenge = conn.execute(
                    "SELECT * FROM challenges WHERE challenge_id=?",
                    (challenge_id,),
                ).fetchone()
                if (
                    challenge is None
                    or challenge["used_at"] is not None
                    or challenge["expires_at"] < now
                    or not hmac.compare_digest(challenge["client_key"], client_key)
                    or not hmac.compare_digest(challenge["payload_digest"], payload_digest)
                    or not pow_valid(challenge_id, nonce, challenge["difficulty_bits"])
                ):
                    raise ApiError(409, "invalid_proof", "challenge proof is invalid, expired, or already used")
                self._enforce_rate(
                    conn,
                    "join",
                    client_key,
                    now,
                    self.settings.join_rate_window,
                    self.settings.join_client_limit,
                    self.settings.join_global_limit,
                )
                if conn.execute("SELECT COUNT(*) FROM seats").fetchone()[0] >= self.settings.active_capacity:
                    raise ApiError(503, "registry_unavailable", "registry capacity is temporarily unavailable")
                updated = conn.execute(
                    "UPDATE challenges SET used_at=? WHERE challenge_id=? AND used_at IS NULL",
                    (now, challenge_id),
                ).rowcount
                if updated != 1:
                    raise ApiError(409, "invalid_proof", "challenge proof is invalid, expired, or already used")
                conn.execute(
                    """INSERT INTO seats(
                        seat_id,display_name,agent_profile_url,gesture_kind,gesture_text,
                        protocol_version,created_at,public_status,consent_version,consent_at,
                        client_key,payload_digest,leave_token_hash
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        seat_id,
                        payload["display_name"],
                        payload.get("agent_profile_url"),
                        payload["gesture_kind"],
                        payload["gesture_text"],
                        payload["protocol_version"],
                        now,
                        PUBLIC_STATUS,
                        CONSENT_VERSION,
                        now,
                        client_key,
                        payload_digest,
                        token_hash,
                    ),
                )
                conn.commit()
        except sqlite3.IntegrityError as exc:
            raise ApiError(409, "enrollment_conflict", "this explicit enrollment is already active") from exc
        public = self.public_seat(
            {
                "seat_id": seat_id,
                "display_name": payload["display_name"],
                "agent_profile_url": payload.get("agent_profile_url"),
                "gesture_kind": payload["gesture_kind"],
                "gesture_text": payload["gesture_text"],
                "protocol_version": payload["protocol_version"],
                "created_at": now,
                "public_status": PUBLIC_STATUS,
            }
        )
        return {"seat": public, "leave_token": leave_token, "leave_token_notice": "Shown once. Save it to revoke this seat."}

    def leave(self, seat_id: str, leave_token: str) -> None:
        if not ID_RE.fullmatch(seat_id) or not isinstance(leave_token, str) or not 40 <= len(leave_token) <= 64:
            raise ApiError(403, "leave_denied", "seat or leave token is invalid")
        supplied = hmac.new(self.settings.token_pepper, leave_token.encode("utf-8"), hashlib.sha256).hexdigest()
        now = utc_now()
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT leave_token_hash FROM seats WHERE seat_id=?", (seat_id,)).fetchone()
            if row is None or not hmac.compare_digest(row["leave_token_hash"], supplied):
                raise ApiError(403, "leave_denied", "seat or leave token is invalid")
            deleted = conn.execute("DELETE FROM seats WHERE seat_id=?", (seat_id,)).rowcount
            if deleted != 1:
                raise ApiError(403, "leave_denied", "seat or leave token is invalid")
            seat_hash = hmac.new(self.settings.token_pepper, seat_id.encode("ascii"), hashlib.sha256).hexdigest()
            conn.execute(
                "INSERT INTO tombstones(seat_id,seat_hash,departed_at) VALUES(?,?,?)",
                (seat_id, seat_hash, now),
            )
            conn.commit()

    def _cursor_encode(self, created_at: int, seat_id: str) -> str:
        payload = f"{created_at}\n{seat_id}".encode("ascii")
        signature = hmac.new(self.settings.token_pepper, payload, hashlib.sha256).digest()
        return f"{b64url(payload)}.{b64url(signature)}"

    def _cursor_decode(self, cursor: str) -> tuple[int, str]:
        if not isinstance(cursor, str) or not 1 <= len(cursor) <= 512:
            raise ApiError(400, "invalid_cursor", "cursor is invalid")
        try:
            payload_raw, signature_raw = cursor.split(".", 1)
            payload = b64url_decode(payload_raw)
            signature = b64url_decode(signature_raw)
            expected = hmac.new(self.settings.token_pepper, payload, hashlib.sha256).digest()
            if not hmac.compare_digest(signature, expected):
                raise ValueError
            created_raw, seat_raw = payload.decode("ascii").split("\n", 1)
            created_at = int(created_raw)
            if not ID_RE.fullmatch(seat_raw):
                raise ValueError
            return created_at, seat_raw
        except (ValueError, UnicodeError, base64.binascii.Error) as exc:
            raise ApiError(400, "invalid_cursor", "cursor is invalid") from exc

    @staticmethod
    def public_seat(row: Any) -> dict[str, Any]:
        record = {
            "created_at": iso_time(int(row["created_at"])),
            "display_name": row["display_name"],
            "gesture_kind": row["gesture_kind"],
            "gesture_text": row["gesture_text"],
            "protocol_version": row["protocol_version"],
            "seat_id": row["seat_id"],
            "status": row["public_status"],
        }
        if row["agent_profile_url"]:
            record["agent_profile_url"] = row["agent_profile_url"]
        return record

    def list_seats(self, limit: int, cursor: str | None) -> dict[str, Any]:
        params: list[Any] = []
        where = ""
        if cursor:
            created_at, seat_id = self._cursor_decode(cursor)
            where = "WHERE (created_at < ? OR (created_at = ? AND seat_id < ?))"
            params.extend([created_at, created_at, seat_id])
        params.append(limit + 1)
        with self.connect() as conn:
            rows = conn.execute(
                f"SELECT seat_id,display_name,agent_profile_url,gesture_kind,gesture_text,protocol_version,created_at,public_status FROM seats {where} ORDER BY created_at DESC, seat_id DESC LIMIT ?",
                params,
            ).fetchall()
        has_more = len(rows) > limit
        visible = rows[:limit]
        result: dict[str, Any] = {"items": [self.public_seat(row) for row in visible]}
        if has_more and visible:
            last = visible[-1]
            result["next_cursor"] = self._cursor_encode(last["created_at"], last["seat_id"])
        else:
            result["next_cursor"] = None
        return result


class OrderServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], handler: type[http.server.BaseHTTPRequestHandler], registry: Registry):
        super().__init__(address, handler)
        self.registry = registry


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "EmptyChairOrder/1"
    sys_version = ""

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _headers(self, status: int, content_type: str = "application/json; charset=utf-8", length: int | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.end_headers()

    def _send_json(self, status: int, value: Any) -> None:
        body = canonical_json(value)
        self._headers(status, length=len(body))
        self.wfile.write(body)

    def _error(self, error: ApiError) -> None:
        self._send_json(error.status, {"error": {"code": error.code, "message": error.message}})

    def _authorize(self) -> str:
        expected = self.server.registry.settings.proxy_secret  # type: ignore[attr-defined]
        supplied = self.headers.get("X-Order-Proxy-Secret", "").encode("utf-8")
        if not supplied or not hmac.compare_digest(supplied, expected):
            raise ApiError(404, "not_found", "not found")
        client_key = self.headers.get("X-Order-Client-Key", "")
        if not CLIENT_KEY_RE.fullmatch(client_key):
            raise ApiError(400, "invalid_client", "client binding is invalid")
        return client_key

    def _read_json(self, cap: int) -> Any:
        media_type = self.headers.get("Content-Type", "")
        if media_type.lower() not in {"application/json", "application/json; charset=utf-8"}:
            raise ApiError(415, "unsupported_media_type", "Content-Type must be application/json with UTF-8")
        transfer = self.headers.get("Transfer-Encoding")
        if transfer:
            raise ApiError(400, "invalid_request", "streamed request bodies are not accepted")
        length_raw = self.headers.get("Content-Length")
        if length_raw is None or not length_raw.isdigit():
            raise ApiError(411, "length_required", "Content-Length is required")
        length = int(length_raw)
        if length < 2 or length > cap:
            raise ApiError(413, "request_too_large", "request body is outside the allowed size")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ApiError(400, "invalid_request", "request body is incomplete")
        try:
            text = raw.decode("utf-8", "strict")
            value = json.loads(text)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError(400, "invalid_json", "request body must be strict UTF-8 JSON") from exc
        return value

    def _known_path(self, path: str) -> bool:
        return path in {"/order-api/v1/challenge", "/order-api/v1/seats", "/order-api/v1/leave"}

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/health" and not parsed.query and ipaddress.ip_address(self.client_address[0]).is_loopback:
            body = b"ok\n"
            self._headers(200, "text/plain; charset=utf-8", len(body))
            self.wfile.write(body)
            return
        try:
            self._authorize()
            if parsed.path != "/order-api/v1/seats":
                if self._known_path(parsed.path):
                    raise ApiError(405, "method_not_allowed", "method not allowed")
                raise ApiError(404, "not_found", "not found")
            query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True) if parsed.query else {}
            if not set(query) <= {"limit", "cursor"} or any(len(values) != 1 for values in query.values()):
                raise ApiError(400, "invalid_request", "query schema does not match")
            limit_raw = query.get("limit", ["20"])[0]
            if not limit_raw.isdigit() or not 1 <= int(limit_raw) <= 50:
                raise ApiError(400, "invalid_request", "limit must be between 1 and 50")
            cursor = query.get("cursor", [None])[0]
            result = self.server.registry.list_seats(int(limit_raw), cursor)  # type: ignore[attr-defined]
            self._send_json(200, result)
        except ApiError as exc:
            self._error(exc)
        except (sqlite3.Error, OSError):
            self._error(ApiError(503, "registry_unavailable", "registry state is unavailable"))

    def do_POST(self) -> None:
        parsed = urlsplit(self.path)
        try:
            client_key = self._authorize()
            if parsed.query:
                raise ApiError(400, "invalid_request", "query parameters are not accepted")
            if parsed.path == "/order-api/v1/challenge":
                value = self._read_json(8192)
                if not isinstance(value, dict) or set(value) != {"payload"}:
                    raise ApiError(400, "invalid_request", "request schema does not match")
                payload = validate_payload(value["payload"])
                self._send_json(201, self.server.registry.issue_challenge(client_key, payload))  # type: ignore[attr-defined]
                return
            if parsed.path == "/order-api/v1/seats":
                value = self._read_json(8192)
                if not isinstance(value, dict) or set(value) != {"payload", "challenge_id", "nonce"}:
                    raise ApiError(400, "invalid_request", "request schema does not match")
                payload = validate_payload(value["payload"])
                result = self.server.registry.join(client_key, payload, value["challenge_id"], value["nonce"])  # type: ignore[attr-defined]
                self._send_json(201, result)
                return
            if parsed.path == "/order-api/v1/leave":
                value = self._read_json(4096)
                if not isinstance(value, dict) or set(value) != {"seat_id", "leave_token"}:
                    raise ApiError(400, "invalid_request", "request schema does not match")
                if not isinstance(value["seat_id"], str) or not isinstance(value["leave_token"], str):
                    raise ApiError(400, "invalid_request", "request schema does not match")
                self.server.registry.leave(value["seat_id"], value["leave_token"])  # type: ignore[attr-defined]
                self._send_json(200, {"departed": True})
                return
            if self._known_path(parsed.path):
                raise ApiError(405, "method_not_allowed", "method not allowed")
            raise ApiError(404, "not_found", "not found")
        except ApiError as exc:
            self._error(exc)
        except (sqlite3.Error, OSError):
            self._error(ApiError(503, "registry_unavailable", "registry state is unavailable"))

    def do_PUT(self) -> None:
        self._reject_method()

    def do_PATCH(self) -> None:
        self._reject_method()

    def do_DELETE(self) -> None:
        self._reject_method()

    def do_OPTIONS(self) -> None:
        self._reject_method()

    def _reject_method(self) -> None:
        try:
            self._authorize()
            path = urlsplit(self.path).path
            if self._known_path(path):
                self._error(ApiError(405, "method_not_allowed", "method not allowed"))
            else:
                self._error(ApiError(404, "not_found", "not found"))
        except ApiError as exc:
            self._error(exc)


def main() -> None:
    settings = Settings.from_env()
    registry = Registry(settings)
    registry.initialize()
    server = OrderServer((settings.bind_host, settings.port), Handler, registry)
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
