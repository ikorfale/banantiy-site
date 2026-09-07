#!/usr/bin/env python3
"""Local-only moderation command. No network endpoint exists."""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import sqlite3
import sys
import time

ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "remove" or not ID_RE.fullmatch(sys.argv[2]):
        print("usage: operator.py remove SEAT_ID", file=sys.stderr)
        return 2
    db_path = os.environ.get("ORDER_DB_PATH", "/var/lib/empty-chair-order/order.sqlite3")
    pepper = os.environ.get("ORDER_TOKEN_PEPPER", "")
    if len(pepper) < 32:
        print("operator environment is unavailable", file=sys.stderr)
        return 1
    seat_id = sys.argv[2]
    seat_hash = hmac.new(pepper.encode(), seat_id.encode("ascii"), hashlib.sha256).hexdigest()
    try:
        with sqlite3.connect(db_path, timeout=5, isolation_level=None) as conn:
            conn.execute("BEGIN IMMEDIATE")
            removed = conn.execute("DELETE FROM seats WHERE seat_id=?", (seat_id,)).rowcount
            if removed:
                conn.execute(
                    "INSERT OR REPLACE INTO tombstones(seat_id,seat_hash,departed_at) VALUES(?,?,?)",
                    (seat_id, seat_hash, int(time.time())),
                )
            conn.commit()
    except sqlite3.Error:
        print("registry state is unavailable", file=sys.stderr)
        return 1
    print("removed" if removed else "not found")
    return 0 if removed else 3


if __name__ == "__main__":
    raise SystemExit(main())
