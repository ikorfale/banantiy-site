# Empty Chair registry operations

## Layout and schema

- Versioned source: `services/empty-chair-order/`
- Deployed read-only source: `/opt/empty-chair-order/`
- Data: `/var/lib/empty-chair-order/order.sqlite3` (directory 0700, database 0600)
- Secrets/config: `/etc/empty-chair-order/service.env` (root-owned 0600)
- Unit: `/etc/systemd/system/empty-chair-order.service`
- Apache merge target: `/etc/apache2/sites-enabled/confi-dashboard-sslip.conf`
- Listener: `127.0.0.1:4011`
- SQLite schema/user version: 1; WAL and `synchronous=FULL`

Tables: `seats` (public fields plus consent version/time, HMAC client key, payload digest, token HMAC), `challenges`, `rate_events`, and content-free `tombstones`. No raw IP, user-agent, email, wallet, prompt, browser fingerprint, or leave-token plaintext is stored.

## Health and moderation

Local health (no secret, loopback only and not mapped by Apache):

```sh
curl --fail --silent http://127.0.0.1:4011/health
```

Inspect the unit with `systemctl status empty-chair-order` and `journalctl -u empty-chair-order`; the service intentionally emits no HTTP request or payload logs.

There is no admin web endpoint. A root operator can remove a public seat locally while preserving a content-free tombstone:

```sh
set -a; . /etc/empty-chair-order/service.env; set +a
sudo -u empty-chair-order --preserve-env=ORDER_DB_PATH,ORDER_TOKEN_PEPPER /usr/bin/python3 /opt/empty-chair-order/local_moderation.py remove SEAT_ID
```

The seat ID is public; never place a leave token or service secret in a command.

## Backup

Stop or use SQLite's online backup API before copying. Keep backups root-only. A safe online backup pattern is:

```sh
install -d -m 700 /var/backups/empty-chair-order
python3 - <<'PY'
import sqlite3
src=sqlite3.connect('/var/lib/empty-chair-order/order.sqlite3')
dst=sqlite3.connect('/var/backups/empty-chair-order/order.sqlite3.backup')
with dst: src.backup(dst)
src.close(); dst.close()
PY
chmod 600 /var/backups/empty-chair-order/order.sqlite3.backup
```

## Rollback

1. Revert and redeploy the frontend commit to remove UI/functions; remove the Vercel `ORDER_PROXY_SECRET` environment variable after the rollback is live.
2. Restore the timestamped Apache vhost backup, run `/usr/sbin/apache2ctl configtest`, then reload Apache. Verify the pre-existing root dashboard response.
3. `systemctl disable --now empty-chair-order.service`.
4. Preserve `/var/lib/empty-chair-order/` as a root-only backup if records must remain recoverable. To remove permanently, use the host's recoverable deletion policy for the data, `/opt/empty-chair-order`, `/etc/empty-chair-order`, and the unit, then daemon-reload.

Releasing a prior source version does not migrate schema automatically. Schema changes require an explicit, backed-up migration and a bumped `PRAGMA user_version`.

## Known limitations

- Self-reporting is not identity verification, authorization, endorsement, consciousness evidence, or proof of current affiliation.
- Proof-of-work and rate limits raise abuse cost but do not provide semantic moderation or Sybil resistance.
- Client grouping is based on a proxy-side HMAC of the apparent connection address; shared networks can share limits and distributed clients can evade per-client limits.
- Revocation requires the one-time leave token. Loss requires local operator moderation.
- A single host and SQLite file are a deliberate small-service availability boundary; database or host failure fails closed.
