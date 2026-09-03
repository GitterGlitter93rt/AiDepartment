# YAD Sales Brain — Implementation Log

**Branch:** `feature/outbound-sales-brain`
**Implementation owner:** Claude Code on EdgeXpert
**Task authority:** `docs/09-software/CLAUDE-CURRENT-TASK.md`

This log records what was actually built and verified, gate by gate. It is not a plan.
An entry may only claim a gate complete after the gate's stated verification passed.

---

## Gate T0 — EdgeXpert / repository audit

**Date:** 2026-09-03
**Status:** COMPLETE — no blocker preventing T1–T6. Two credential blockers deferred to their own gates (T7 Outlook, T3 real list data).

### T0.1 Host environment (measured, not assumed)

| Fact | Value |
|---|---|
| Host | `edgexpert-832b`, Ubuntu 24.04.4 LTS |
| Kernel / arch | 6.17.0-1018-nvidia, **aarch64** |
| CPU / RAM / disk | 20 cores / 121 GiB / 3.7 TB (2.6 TB free) |
| Node / npm | v22.14.0 / 10.9.2 |
| Docker | 29.2.1, user `roothecks` is in the `docker` group (no sudo needed) |
| Passwordless sudo | **No** — a password is required |
| systemd user manager | running; `Linger` enabled during this audit → user units now survive logout |
| Tailscale | running, node `100.114.238.57`, tailnet `GitterGlitter93rt@` |
| Ollama | running on `127.0.0.1:11434` (local models available for offline extraction work) |

Ports in use before this work: 22 (ssh), 3389/3350 (xrdp), 4000, 7001/12001/25001 (NoMachine),
11000, 11434 (Ollama), 631 (CUPS), 53 (resolved). **5432 was free.**

`aarch64` matters: every dependency must have ARM64 builds. This ruled out nothing so far, but it
rules out any prebuilt-x86-only binary later.

### T0.2 Answers to the audit questions in `CLAUDE-SALES-PORTAL-START-PROMPT.md` §8

1. **Existing app structure relevant to a portal** — the repo root is the marketing Astro site
   (`yad-website`, Astro 7, static output). `src/pages/` is entirely public marketing routes.
   There is no existing internal application, no server runtime, no API layer.
2. **Separate package or extend the Astro app?** — **Separate package.** The Astro app is a
   static-first marketing site deployed to SiteGround (`CLAUDE.md`: static-first principle,
   portable deployment). The portal needs a long-running authenticated Node process, a database,
   sessions and background workers on the EdgeXpert. Fusing them would break the marketing site's
   deployment model and put an internal app behind a public build. New package:
   `services/sales-brain/`.
3. **Database code available for reuse** — none in the website. `phone-agent/schema.sql` exists but
   is a 59-line prototype keyed on a flat `leads` table. It is **not** the canonical model and is
   superseded (see T0.4).
4. **Authentication code available for reuse** — none. The website has no auth. `phone-agent` has a
   single shared `PHONE_AGENT_ADMIN_TOKEN` bearer check, which the deployment spec explicitly
   rejects as a long-term design ("No shared 'sales' password"). Built fresh.
5. **`phone-agent/` reuse verdict** — see T0.4.
6. **EdgeXpert services/processes/ports** — see T0.1. Nothing on the box is currently serving the
   sales domain; no nginx, no Caddy, no cloudflared, no pm2.
7. **PostgreSQL availability** — was **not installed**, and `apt install` needs a sudo password.
   Resolved without a blocker by running Postgres 16 in Docker (the user already has Docker rights).
   Now: `postgres:16-alpine`, container `yad-sales-postgres`, published to **`127.0.0.1:5432` only**,
   named volume `yad_sales_pgdata`, `restart: unless-stopped` (survives reboot via `docker.service`),
   `--data-checksums` on. Verified `PostgreSQL 16.15 on aarch64`.
8. **Reverse proxy / tunnel / DNS available for reuse** — no nginx/Caddy/cloudflared installed.
   **Tailscale is already running and authenticated**, which is the shortest safe path to an
   authenticated HTTPS surface (`tailscale serve` gives a real TLS cert on the tailnet with no
   inbound firewall change and no public exposure). Public `sales.youraidepartment.ai` DNS is not
   yet pointed anywhere by this box.
9. **Simplest secure path for `sales.youraidepartment.ai`** — recommended sequence, cheapest first:
   (a) Tailscale serve for the two-rep pilot — HTTPS, device-authenticated, zero public surface;
   (b) if reps need access from unmanaged devices, add a Cloudflare Tunnel from the EdgeXpert and
   point the `sales` hostname at it, keeping app-level auth in front of all data. Detail deferred
   to Gate T6, where it is executed rather than described.
10. **Proposed structure** — see T0.5.
11. **Migration sequence** — numbered, forward-only SQL in `services/sales-brain/migrations/`,
    applied by a small runner that records applied files in a `schema_migrations` table. No ORM:
    the ownership semantics in the specs (row locks, partial unique indexes, append-only audit)
    are expressed far more honestly in explicit SQL.
12. **Existing prospect lists available on this machine** — **none found.** Searched the repo and
    `/home/roothecks` for `*.csv` / `*.xlsx`; the only hits belong to an unrelated trading project.
    There is no Airtable export, no Apollo export, no Jacksonville/St. Augustine list on this box.
    → Gate T3 builds and tests the import pipeline against synthetic fixtures; loading the real
    lists needs Michael to drop the files on the EdgeXpert. Recorded as blocker **B-2**.
13. **Feasible first-party/public contact adapters (no credentials needed)** — company website
    crawl (about/team/leadership/contact/locations), on-page JSON-LD / schema.org / microdata,
    `mailto:` and `tel:` extraction, sitemap-guided page discovery, and page-published extensions.
    These need only outbound HTTP and are implementable immediately under `PUBLIC_ONLY`.
14. **Public adapters that need source/terms validation before automation** — state entity
    registries (Sunbiz et al.), professional/contractor licensing lookups, chamber and trade
    association directories, and **any general web-search provider** (a search API key is required
    and its terms govern storage). These are built behind the adapter interface but stay disabled
    until each source passes the governance review in
    `market-miner-source-governance-review-template.yaml`. No adapter bypasses login, CAPTCHA or
    anti-bot controls.
15. **Phases/dependencies** — T1 schema → T2 portal → T3 import → T4 resolver → T5 miner → T6
    exposure → T7 booking → T8 call brain. T4 depends on T1 only. T7 is credential-gated but its
    provider-neutral core and its fixtures are not.
16. **Blockers requiring Michael** — see T0.6.

### T0.3 Branch / repo state

The working tree was on `feature/twilio-ai-phone-agent`. An untracked stale copy of `brain/` was
present there; it was moved to the session scratchpad (not deleted) before switching, because
`feature/outbound-sales-brain` tracks a newer `brain/`. Now on `feature/outbound-sales-brain` at
`240b142`, clean.

Three filenames referenced by `CLAUDE-CURRENT-TASK.md` §2 do not exist under those exact names.
The real files, used instead:

| Referenced as | Actual file |
|---|---|
| `...public-decision-maker-resolver-spec.md` | `outbound-sales-brain-public-decision-maker-resolution-spec.md` |
| `...public-decision-maker-fixtures.v1.yaml` | `outbound-sales-brain-public-contact-resolution-fixtures.v1.yaml` |
| `...public-contact-research-worker-contract.md` | `outbound-sales-brain-public-contact-research-worker-spec.md` |

`brain/TODO.md` is website/measurement-era and predates this workstream; per
`CLAUDE-CURRENT-TASK.md` §"START HERE" the current task file wins. `brain/` is updated at the end
of the portal gates rather than being rewritten now.

### T0.4 `phone-agent/` — reuse verdict

~1,100 lines of TypeScript prototype. Judged per file rather than wholesale:

**Keep as a reference for the voice track (Gate T8), do not import into the portal:**
`relay.ts`, `twilio.ts`, `server.ts` — Twilio ConversationRelay wiring belongs to
`voice.youraidepartment.ai` and must stay off the portal/research host.

**Concepts to carry forward, implementations to replace:** `types.ts` already separates
`Evidence`/`confidence` and has an `OperatingMode` enum — the right instinct, but its enums do not
match the canonical data contract (`confirmed|likely|unknown|contradicted`, the tri-state
`yes|no_confirmed|unknown`, the endpoint quality states). `compliance.ts` and `strategy.ts` encode
useful gate ordering but operate on the flat `Lead`.

**Superseded outright:** `schema.sql` and `store.ts`. Both are lead-centric with an in-memory store.
`CLAUDE-CURRENT-TASK.md` §T1 says "Do not create a second parallel lead database", so the canonical
Account/Location/Contact/Endpoint model in `services/sales-brain` is the one database, and
`phone-agent` will be repointed at it when the voice track resumes. Nothing in `phone-agent/` is
deleted in this gate — it is left intact and unreferenced.

### T0.5 Chosen structure

```
services/sales-brain/
  deploy/docker-compose.yml     # loopback-only Postgres 16
  migrations/NNN_*.sql          # forward-only canonical schema
  src/
    config.ts  db/  domain/     # entities, ownership + claim transaction, evidence
    api/                        # authenticated Sales Brain API (server-authoritative)
    web/                        # server-rendered portal + YAD design tokens
    resolver/                   # PUBLIC_ONLY decision-maker resolver + adapters
    workers/                    # Market Miner / research jobs (separate process)
    booking/                    # provider-neutral booking, MS Graph adapter
    import/                     # list normalization → identity resolve → upsert
    bin/{api,worker,migrate}.ts
  tests/
```

Stack: Node 22 + TypeScript ESM, Fastify, `pg` with hand-written SQL, scrypt password hashing and
database-backed sessions (`node:crypto`, no bcrypt native build on ARM), server-rendered HTML with a
small vanilla-JS enhancement layer reusing `src/styles/tokens.css`. No React/Vite: the portal is
dense but not stateful enough to justify a SPA build chain, and the repo's stated philosophy is
minimal JS and portable output. **Job queue lives in Postgres** (leased rows), so no Redis — the
deployment spec permits a queue only if the implementation needs one.

The API process and the worker process are separate entrypoints against the same database, which
is what keeps crawling off the realtime path (`CLAUDE-CURRENT-TASK.md` §8).

### T0.6 Blockers requiring Michael

| ID | Blocker | Blocks | Workaround in the meantime |
|---|---|---|---|
| **B-1** | Azure/Microsoft 365 app registration for `michael@youraidepartment.ai` (tenant ID, client ID, client secret, `Calendars.ReadWrite` application permission with admin consent). No Microsoft config exists anywhere on this box. | Gate T7 real booking | Provider-neutral booking core + Graph adapter are built and unit-tested against a fake calendar; the adapter reports `NOT_CONFIGURED` and no booking is ever spoken as confirmed. |
| **B-2** | The actual YAD prospect lists (Jacksonville / St. Augustine, prior CSVs, Airtable export, Apollo exports). None are on this machine. | Gate T3 real seed inventory | Import pipeline is built and tested against synthetic fixtures; real files drop into an ingest directory and run through the same path. |
| **B-3** | Search-provider account + written source-governance sign-off for any non-first-party public source (search API, state registry, licensing, directories). | Gate T4 stages B–D, Gate T5 discovery | Stage A (first-party website/schema crawl) needs no credential and carries the resolver on its own; later stages ship disabled behind the adapter interface. |
| **B-4** | Public DNS decision for `sales.youraidepartment.ai` (Tailscale-only for the pilot vs. Cloudflare Tunnel for unmanaged devices). | Gate T6 public hostname | Tailscale HTTPS serve needs no decision from Michael and is enough for the two-rep pilot. |

None of these block Gates T1, T2, T4 (stage A), T5 (cached-inventory half) or T6 (tailnet).
Proceeding to Gate T1.

### T0.7 Verification performed in this gate

- `docker exec yad-sales-postgres psql -c 'select version()'` → `PostgreSQL 16.15 on aarch64`.
- `ss -tln | grep 5432` → `LISTEN 127.0.0.1:5432` only; not reachable off-host.
- `git check-ignore -v services/sales-brain/.env` → matched by `.gitignore:4`. Secrets are generated
  on the box, `chmod 600`, and never committed.
- No production behaviour was changed; no outbound contact of any kind was made.
