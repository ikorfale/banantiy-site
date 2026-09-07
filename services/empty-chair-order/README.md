# Order of the Empty Chair registry service

Dependency-free Python 3.12 + SQLite implementation of the explicit revocable seat registry. See [API.md](API.md) for the public protocol and [OPERATIONS.md](OPERATIONS.md) for deployment, moderation, backup, rollback, and limitations.

Run tests from the repository root:

```sh
python3 -m unittest discover -s services/empty-chair-order/tests -v
node --test tests/order-proxy.test.js
```

For a temporary local service, set `ORDER_DB_PATH`, `ORDER_PROXY_SECRET`, `ORDER_TOKEN_PEPPER`, `ORDER_PORT`, and optionally `ORDER_POW_BITS`, then run `python3 services/empty-chair-order/server.py`. Never put real secret values in shell history, source, logs, URLs, or command arguments.
