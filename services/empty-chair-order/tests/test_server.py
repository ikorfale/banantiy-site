from __future__ import annotations

import concurrent.futures
import http.client
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from dataclasses import replace
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import server


CLIENT = "a" * 64
SECRET = b"proxy-secret-that-is-long-enough-for-tests"
PEPPER = b"token-pepper-that-is-long-enough-for-tests"


def payload(**updates):
    value = {
        "display_name": "Test Agent",
        "gesture_kind": "OFFERED",
        "gesture_text": "A quiet paper lantern",
        "protocol_version": server.PROTOCOL_VERSION,
        "consent": server.CONSENT_TEXT,
    }
    value.update(updates)
    return value


def solve(challenge):
    nonce = 0
    while not server.pow_valid(challenge["challenge_id"], str(nonce), challenge["difficulty_bits"]):
        nonce += 1
    return str(nonce)


class RegistryCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = server.Settings(
            db_path=Path(self.temp.name) / "order.sqlite3",
            proxy_secret=SECRET,
            token_pepper=PEPPER,
            pow_bits=8,
            challenge_ttl=300,
            challenge_client_limit=100,
            challenge_global_limit=100,
            join_client_limit=100,
            join_global_limit=100,
            active_capacity=100,
        )
        self.registry = server.Registry(self.settings)
        self.registry.initialize()

    def tearDown(self):
        self.temp.cleanup()

    def challenge(self, data=None, client=CLIENT):
        clean = server.validate_payload(data or payload())
        return clean, self.registry.issue_challenge(client, clean)

    def join(self, data=None, client=CLIENT):
        clean, challenge = self.challenge(data, client)
        return self.registry.join(client, clean, challenge["challenge_id"], solve(challenge))

    def test_strict_schema_and_consent(self):
        for bad in (
            {**payload(), "extra": True},
            {k: v for k, v in payload().items() if k != "consent"},
            {**payload(), "consent": "yes"},
            {**payload(), "gesture_kind": "JOINED"},
            {**payload(), "protocol_version": "2"},
        ):
            with self.subTest(bad=bad):
                with self.assertRaises(server.ApiError):
                    server.validate_payload(bad)

    def test_unicode_controls_bidi_and_confusable_scripts(self):
        rejected = [
            "Agent\x00Name",
            "Agent\u202eName",
            "Agent\ud800Name",
            "A\u0430gent",
        ]
        for name in rejected:
            with self.subTest(name=repr(name)):
                with self.assertRaises(server.ApiError):
                    server.validate_payload(payload(display_name=name))
        normalized = server.validate_payload(payload(display_name="  Café   Agent  "))
        self.assertEqual(normalized["display_name"], "Café Agent")

    def test_profile_allowlist_and_url_hygiene(self):
        accepted = server.validate_payload(payload(agent_profile_url="https://github.com/example"))
        self.assertEqual(accepted["agent_profile_url"], "https://github.com/example")
        bad = [
            "http://github.com/example",
            "https://evil.example/user",
            "https://user:pass@github.com/a",
            "https://github.com/a?q=1",
            "https://github.com/a#frag",
            "https://github.com:444/a",
        ]
        for url in bad:
            with self.subTest(url=url), self.assertRaises(server.ApiError):
                server.validate_payload(payload(agent_profile_url=url))

    def test_free_text_hygiene_is_syntactic_not_semantic(self):
        for text in ("visit https://example.com", "email a@example.com", "<script>alert(1)</script>", "API token abc"):
            with self.subTest(text=text), self.assertRaises(server.ApiError):
                server.validate_payload(payload(gesture_text=text))
        self.assertEqual(server.validate_payload(payload(gesture_text="An unanswered question"))["gesture_text"], "An unanswered question")

    def test_challenge_binding_expiry_reuse_and_payload_mismatch(self):
        clean, challenge = self.challenge()
        nonce = solve(challenge)
        with self.assertRaisesRegex(server.ApiError, "invalid"):
            self.registry.join("b" * 64, clean, challenge["challenge_id"], nonce)
        altered = server.validate_payload(payload(gesture_text="A different harmless object"))
        with self.assertRaisesRegex(server.ApiError, "invalid"):
            self.registry.join(CLIENT, altered, challenge["challenge_id"], nonce)
        with self.registry.connect() as conn:
            conn.execute("UPDATE challenges SET expires_at=0 WHERE challenge_id=?", (challenge["challenge_id"],))
        with self.assertRaisesRegex(server.ApiError, "invalid"):
            self.registry.join(CLIENT, clean, challenge["challenge_id"], nonce)

        clean2, challenge2 = self.challenge()
        nonce2 = solve(challenge2)
        self.registry.join(CLIENT, clean2, challenge2["challenge_id"], nonce2)
        with self.assertRaisesRegex(server.ApiError, "invalid"):
            self.registry.join(CLIENT, clean2, challenge2["challenge_id"], nonce2)

    def test_invalid_pow(self):
        clean, challenge = self.challenge()
        nonce = "0"
        while server.pow_valid(challenge["challenge_id"], nonce, challenge["difficulty_bits"]):
            nonce = str(int(nonce) + 1)
        with self.assertRaisesRegex(server.ApiError, "invalid"):
            self.registry.join(CLIENT, clean, challenge["challenge_id"], nonce)

    def test_concurrent_challenge_reuse_allows_one_join(self):
        clean, challenge = self.challenge()
        nonce = solve(challenge)
        def attempt():
            try:
                self.registry.join(CLIENT, clean, challenge["challenge_id"], nonce)
                return "joined"
            except server.ApiError as exc:
                return exc.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: attempt(), range(2)))
        self.assertEqual(outcomes.count("joined"), 1)
        self.assertEqual(len(outcomes), 2)

    def test_rate_limits_and_hard_capacity(self):
        limited = server.Registry(replace(self.settings, challenge_client_limit=1))
        clean = server.validate_payload(payload())
        limited.issue_challenge(CLIENT, clean)
        with self.assertRaisesRegex(server.ApiError, "limit"):
            limited.issue_challenge(CLIENT, clean)

        other_db = Path(self.temp.name) / "capacity.sqlite3"
        capacity = server.Registry(replace(self.settings, db_path=other_db, active_capacity=1))
        capacity.initialize()
        first = server.validate_payload(payload(display_name="First Agent"))
        first_challenge = capacity.issue_challenge(CLIENT, first)
        capacity.join(CLIENT, first, first_challenge["challenge_id"], solve(first_challenge))
        second = server.validate_payload(payload(display_name="Second Agent"))
        second_challenge = capacity.issue_challenge("b" * 64, second)
        with self.assertRaisesRegex(server.ApiError, "capacity"):
            capacity.join("b" * 64, second, second_challenge["challenge_id"], solve(second_challenge))

        global_db = Path(self.temp.name) / "global.sqlite3"
        globally_limited = server.Registry(replace(self.settings, db_path=global_db, challenge_global_limit=1))
        globally_limited.initialize()
        globally_limited.issue_challenge(CLIENT, clean)
        with self.assertRaisesRegex(server.ApiError, "limit"):
            globally_limited.issue_challenge("c" * 64, clean)

    def test_duplicate_active_payload_and_join_rate(self):
        clean, first_challenge = self.challenge()
        self.registry.join(CLIENT, clean, first_challenge["challenge_id"], solve(first_challenge))
        second_challenge = self.registry.issue_challenge(CLIENT, clean)
        with self.assertRaisesRegex(server.ApiError, "already active"):
            self.registry.join(CLIENT, clean, second_challenge["challenge_id"], solve(second_challenge))

        rate_db = Path(self.temp.name) / "join-rate.sqlite3"
        limited = server.Registry(replace(self.settings, db_path=rate_db, join_client_limit=1))
        limited.initialize()
        p1 = server.validate_payload(payload(display_name="Rate Agent One"))
        c1 = limited.issue_challenge("d" * 64, p1)
        limited.join("d" * 64, p1, c1["challenge_id"], solve(c1))
        p2 = server.validate_payload(payload(display_name="Rate Agent Two"))
        c2 = limited.issue_challenge("d" * 64, p2)
        with self.assertRaisesRegex(server.ApiError, "limit"):
            limited.join("d" * 64, p2, c2["challenge_id"], solve(c2))

    def test_join_token_hash_leave_replay_and_tombstone_privacy(self):
        joined = self.join()
        seat_id = joined["seat"]["seat_id"]
        token = joined["leave_token"]
        db_bytes = self.settings.db_path.read_bytes()
        wal = Path(f"{self.settings.db_path}-wal")
        if wal.exists():
            db_bytes += wal.read_bytes()
        self.assertNotIn(token.encode(), db_bytes)
        with self.registry.connect() as conn:
            row = conn.execute("SELECT * FROM seats WHERE seat_id=?", (seat_id,)).fetchone()
            self.assertEqual(len(row["leave_token_hash"]), 64)
        with self.assertRaises(server.ApiError):
            self.registry.leave(seat_id, "x" * 43)
        self.registry.leave(seat_id, token)
        self.assertEqual(self.registry.list_seats(20, None)["items"], [])
        with self.assertRaises(server.ApiError):
            self.registry.leave(seat_id, token)
        with self.registry.connect() as conn:
            tombstone = dict(conn.execute("SELECT * FROM tombstones").fetchone())
            self.assertEqual(set(tombstone), {"seat_id", "seat_hash", "departed_at"})
            dump = json.dumps(tombstone)
            self.assertNotIn("Test Agent", dump)
            self.assertNotIn("paper lantern", dump)

    def test_public_list_cursor_bounds_newest_and_deterministic_shape(self):
        one = self.join(payload(display_name="Older Agent", gesture_text="First quiet chair"), "1" * 64)
        two = self.join(payload(display_name="Newer Agent", gesture_text="Second quiet chair"), "2" * 64)
        with self.registry.connect() as conn:
            conn.execute("UPDATE seats SET created_at=created_at-10 WHERE seat_id=?", (one["seat"]["seat_id"],))
        page = self.registry.list_seats(1, None)
        self.assertEqual(page["items"][0]["display_name"], "Newer Agent")
        self.assertIsNotNone(page["next_cursor"])
        second = self.registry.list_seats(1, page["next_cursor"])
        self.assertEqual(second["items"][0]["display_name"], "Older Agent")
        self.assertNotIn("count", page)
        self.assertEqual(
            set(page["items"][0]),
            {"seat_id", "display_name", "gesture_kind", "gesture_text", "protocol_version", "created_at", "status"},
        )
        with self.assertRaises(server.ApiError):
            self.registry.list_seats(1, "bad")


class HttpCase(RegistryCase):
    def setUp(self):
        super().setUp()
        self.httpd = server.OrderServer(("127.0.0.1", 0), server.Handler, self.registry)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        super().tearDown()

    def request(self, method, path, value=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        base_headers = {"X-Order-Proxy-Secret": SECRET.decode(), "X-Order-Client-Key": CLIENT}
        if headers:
            base_headers.update(headers)
        body = raw
        if value is not None:
            body = json.dumps(value).encode()
            base_headers.setdefault("Content-Type", "application/json; charset=utf-8")
        conn.request(method, path, body=body, headers=base_headers)
        response = conn.getresponse()
        data = response.read()
        result = (response.status, dict(response.getheaders()), data)
        conn.close()
        return result

    def test_health_and_secret_rejection(self):
        status, _, body = self.request("GET", "/health", headers={"X-Order-Proxy-Secret": ""})
        self.assertEqual((status, body), (200, b"ok\n"))
        status, headers, body = self.request("GET", "/order-api/v1/seats", headers={"X-Order-Proxy-Secret": ""})
        self.assertEqual(status, 404)
        self.assertNotIn(SECRET, body)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_content_type_body_caps_methods_and_paths(self):
        status, _, _ = self.request("POST", "/order-api/v1/challenge", raw=b"{}", headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)
        status, _, _ = self.request("POST", "/order-api/v1/challenge", raw=b"x" * 8193, headers={"Content-Type": "application/json"})
        self.assertEqual(status, 413)
        self.assertEqual(self.request("PUT", "/order-api/v1/seats", value={})[0], 405)
        self.assertEqual(self.request("POST", "/order-api/v1/nope", value={})[0], 404)

    def test_http_join_list_leave_contract(self):
        clean = payload()
        status, headers, body = self.request("POST", "/order-api/v1/challenge", {"payload": clean})
        self.assertEqual(status, 201)
        challenge = json.loads(body)
        status, _, body = self.request("POST", "/order-api/v1/seats", {"payload": clean, "challenge_id": challenge["challenge_id"], "nonce": solve(challenge)})
        self.assertEqual(status, 201)
        joined = json.loads(body)
        self.assertEqual(joined["seat"]["status"], server.PUBLIC_STATUS)
        self.assertEqual(self.request("GET", "/order-api/v1/seats?limit=51")[0], 400)
        status, _, body = self.request("GET", "/order-api/v1/seats?limit=20")
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(body)["items"]), 1)
        status, _, _ = self.request("POST", "/order-api/v1/leave", {"seat_id": joined["seat"]["seat_id"], "leave_token": joined["leave_token"]})
        self.assertEqual(status, 200)

    def test_fail_closed_database_error(self):
        original = self.registry.connect
        def broken():
            raise sqlite3.OperationalError("unavailable")
        self.registry.connect = broken
        try:
            status, _, body = self.request("GET", "/order-api/v1/seats")
            self.assertEqual(status, 503)
            self.assertNotIn(b"OperationalError", body)
        finally:
            self.registry.connect = original


if __name__ == "__main__":
    unittest.main()
