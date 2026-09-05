# YAD Sales Portal — Operations Runbook

**Host:** EdgeXpert (`edgexpert-832b`)
**Package:** `services/sales-brain`
**Status:** running under systemd, loopback-only, awaiting the HTTPS decision in §3.

---

## 1. What is running

| Unit | Purpose | Restart |
|---|---|---|
| `yad-sales-api.service` | portal + API on `127.0.0.1:8080` | always; enabled at boot |
| `yad-sales-worker.service` | Market Miner + contact research | always; enabled at boot, `Nice=10`, idle I/O |
| `yad-sales-backup.timer` | nightly `pg_dump` at 02:30 | persistent |
| `yad-sales-postgres` (Docker) | canonical database on `127.0.0.1:5432` | `unless-stopped` |

User services, with **linger enabled**, so they survive logout and reboot without needing root.
The worker is niced and set to idle I/O so background crawling can never starve the portal.

```bash
systemctl --user status yad-sales-api yad-sales-worker
journalctl --user -u yad-sales-api -f          # or tail services/sales-brain/logs/api.log
```

## 2. Everyday commands

```bash
cd services/sales-brain

npm run build            # compile to dist/ and copy assets
npm test                 # full suite (needs the yad_sales_test database)
npm run migrate          # apply pending migrations (also runs on API start)
npm run sync-verticals   # reload vertical profiles from docs/09-software/

./deploy/preflight.sh    # pre-rollout check — run this before letting reps in
./deploy/backup.sh       # manual backup
./deploy/restore.sh <file.sql.gz>   # restore into yad_sales_restore (safe by default)

systemctl --user restart yad-sales-api yad-sales-worker
```

After changing code: `npm run build && systemctl --user restart yad-sales-api yad-sales-worker`.
The units run `dist/`, not the TypeScript sources, so an unbuilt change will not take effect.

## 3. Exposing `sales.youraidepartment.ai` — the remaining decision

The portal is deliberately bound to **loopback only** today. Nothing outside this machine can
reach it. Three paths, cheapest first:

### Option A — Tailscale HTTPS (recommended for the two-rep pilot)

Needs two things this implementation could not do itself:

1. **Enable HTTPS certificates for the tailnet.** Tailscale admin console → DNS → *HTTPS
   Certificates* → Enable. Currently `tailscale status --json` reports `CertDomains: None`, which
   is why `tailscale serve` produces no config.
2. **Grant the operator role once**, so serve does not need root each time:
   ```bash
   sudo tailscale set --operator=$USER
   ```
   Currently `tailscale cert` returns `Access denied: cert access denied`.

Then:
```bash
tailscale serve --bg 8080
tailscale serve status          # confirms https://edgexpert-832b.tail07fc21.ts.net
```
and set `SESSION_COOKIE_SECURE=true` in `.env`, then restart the API.

Reps reach it at the tailnet hostname from any device signed into the tailnet. No inbound firewall
change, no public surface, device-level authentication in front of the application's own.

### Option B — Tailscale without certificates (works right now, no Michael action)

Bind the portal to the tailnet address instead of loopback:
```bash
sed -i 's/^SALES_PORTAL_BIND=.*/SALES_PORTAL_BIND=100.114.238.57/' .env
systemctl --user restart yad-sales-api
```
Reps use `http://100.114.238.57:8080`. Traffic is WireGuard-encrypted end to end and only tailnet
devices can connect, but the browser shows "not secure" and the session cookie cannot be `Secure`.
Acceptable for a short internal pilot; not where this should stay.

### Option C — Cloudflare Tunnel, for unmanaged devices

Needed only if reps must reach the portal from devices that will not join the tailnet. Requires a
Cloudflare account credential and a DNS record for `sales.youraidepartment.ai`. `cloudflared` is
not installed on this box.

**Do not** bind to `0.0.0.0` as a shortcut. `preflight.sh` fails the check if you do.

## 4. Backups

Nightly at 02:30 to `~/yad-sales-backups`, gzipped, mode 600, 14-day retention.

The backup script **verifies what it wrote**: it checks the archive decompresses and that
`accounts`, `contacts`, `contact_endpoints`, `suppressions`, `ownership_events` and `follow_ups`
are all present, and refuses to rotate old backups if not. A backup nobody has restored is a
hypothesis; this one has been restored (see the implementation log for Gate T6).

`restore.sh` restores into `yad_sales_restore` by default and requires `--force-live` plus typing
the database name to overwrite production, because a mistaken restore destroys every rep's
ownership and every DNC record.

**Not yet done:** backups live on the same disk as the database. Copying them off-box is worth
doing before reps depend on this operationally.

## 5. Failure behaviour

| Failure | Effect | Recovery |
|---|---|---|
| API crashes | systemd restarts within 5s | none needed; state is committed server-side |
| Worker crashes | systemd restarts within 10s; in-flight job lease expires and is retried | none |
| Postgres container stops | API health reports `degraded`, returns 503 | `docker compose -f deploy/docker-compose.yml up -d` |
| EdgeXpert reboots | Docker and both units come back automatically | verify with `preflight.sh` |
| EdgeXpert loses internet | portal unreachable; no state is corrupted; workers resume | none |
| A research source blocks us | that host's crawl stops; existing inventory stays usable | never worked around |

An unavailable provider is never converted into a negative fact about a business.

## 6. Adding a user

```bash
cd services/sales-brain
npx tsx -e "
import { createUser } from './src/domain/auth.js';
import { closePool } from './src/db/pool.js';
await createUser({ email: 'brent@youraidepartment.ai', displayName: 'Brent',
                   role: 'SALES_REP', password: process.env.NEW_USER_PASSWORD });
await closePool();
"
```
Roles: `SALES_REP`, `SALES_MANAGER`, `RESEARCH_OPS`, `ADMIN`. Reps may add DNC but never lift it;
only `ADMIN` can. Pass the password via an environment variable so it does not land in shell history.

**Before rep rollout:** delete or re-password the development users seeded by `npm run seed`
(`admin@`, `manager@`, `rep1@`, `rep2@youraidepartment.ai`) — they share a known default password.

## 7. What is deliberately off

- **Autonomous outbound dialling** — `OUTBOUND_DIAL_ENABLED=false`. `preflight.sh` fails if it is
  ever true. It must not change without the explicit pilot gate.
- **Outbound email** — `OUTBOUND_EMAIL_ENABLED=false`.
- **Paid contact enrichment** — `CONTACT_ENRICHMENT_MODE=PUBLIC_ONLY`, no Apollo key.
- **Discovery adapters** — none registered; an adapter runs only when it is both credentialed and
  governance-reviewed. Market Miner refreshes existing inventory in the meantime.
