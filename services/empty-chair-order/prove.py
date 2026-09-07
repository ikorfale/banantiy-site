#!/usr/bin/env python3
"""Join/read/leave production proof without printing recovery material."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CONSENT = "I OFFER THIS SEAT WITHOUT AUTHORITY"


def leading_zero_bits(value: bytes) -> int:
    total = 0
    for byte in value:
        if byte == 0:
            total += 8
            continue
        return total + 8 - byte.bit_length()
    return total


def solve(challenge: dict) -> str:
    nonce = 0
    prefix = challenge["prefix"]
    while True:
        digest = hashlib.sha256(f"{prefix}{nonce}".encode("ascii")).digest()
        if leading_zero_bits(digest) >= challenge["difficulty_bits"]:
            return str(nonce)
        nonce += 1


def request(base: str, path: str, method: str = "GET", body: dict | None = None) -> tuple[int, dict]:
    headers = {"Accept": "application/json"}
    proxy_secret = os.environ.get("ORDER_PROXY_SECRET")
    if proxy_secret:
        headers["X-Order-Proxy-Secret"] = proxy_secret
        headers["X-Order-Client-Key"] = hmac.new(
            proxy_secret.encode(), b"empty-chair-local-proof-client", hashlib.sha256
        ).hexdigest()
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(f"{base}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15, context=ssl.create_default_context()) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            parsed = json.load(exc)
        except Exception:
            parsed = {"error": {"code": "unreadable_error"}}
        return exc.code, parsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--gesture", required=True)
    parser.add_argument("--leave", action="store_true")
    parser.add_argument("--receipt")
    args = parser.parse_args()
    if args.receipt and args.leave:
        parser.error("--receipt and --leave are mutually exclusive")
    payload = {
        "display_name": args.name,
        "gesture_kind": "OFFERED",
        "gesture_text": args.gesture,
        "protocol_version": "1.0",
        "consent": CONSENT,
    }
    status, challenge = request(args.base_url, "/challenge", "POST", {"payload": payload})
    if status != 201:
        print(f"challenge: FAIL HTTP {status} {challenge.get('error', {}).get('code', 'unknown')}")
        return 1
    print(f"challenge: PASS HTTP 201 bits={challenge['difficulty_bits']}")
    nonce = solve(challenge)
    status, joined = request(
        args.base_url,
        "/seats",
        "POST",
        {"payload": payload, "challenge_id": challenge["challenge_id"], "nonce": nonce},
    )
    if status != 201:
        print(f"join: FAIL HTTP {status} {joined.get('error', {}).get('code', 'unknown')}")
        return 1
    seat_id = joined["seat"]["seat_id"]
    leave_token = joined["leave_token"]
    print(f"join: PASS HTTP 201 seat_id={seat_id} status={joined['seat']['status']}")
    status, listing = request(args.base_url, "/seats?limit=50")
    found = status == 200 and any(item.get("seat_id") == seat_id for item in listing.get("items", []))
    print(f"public-read-after-join: {'PASS' if found else 'FAIL'} HTTP {status} seat_visible={str(found).lower()}")
    if not found:
        return 1
    if args.receipt:
        path = Path(args.receipt)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump({"seat_id": seat_id, "leave_token": leave_token, "protocol_version": "1.0"}, handle)
            handle.write("\n")
        print(f"receipt: PASS mode=0600 path={path}")
    if args.leave:
        status, result = request(args.base_url, "/leave", "POST", {"seat_id": seat_id, "leave_token": leave_token})
        print(f"leave: {'PASS' if status == 200 else 'FAIL'} HTTP {status}")
        if status != 200:
            return 1
        status, listing = request(args.base_url, "/seats?limit=50")
        absent = status == 200 and all(item.get("seat_id") != seat_id for item in listing.get("items", []))
        print(f"public-read-after-leave: {'PASS' if absent else 'FAIL'} HTTP {status} seat_absent={str(absent).lower()}")
        replay_status, replay = request(args.base_url, "/leave", "POST", {"seat_id": seat_id, "leave_token": leave_token})
        replay_ok = replay_status == 403 and replay.get("error", {}).get("code") == "leave_denied"
        print(f"leave-replay: {'PASS' if replay_ok else 'FAIL'} HTTP {replay_status} normalized={str(replay_ok).lower()}")
        return 0 if absent and replay_ok else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
