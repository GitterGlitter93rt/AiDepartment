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

---

## Gate T1 — Canonical sales data foundation

**Date:** 2026-09-03
**Status:** COMPLETE — all six required acceptance data tests pass.

### What was built

One canonical schema in `services/sales-brain`, not a second lead database. 35 tables and one
search projection, applied by a forward-only migration runner that checksums each file so an
already-applied migration cannot be silently edited.

| Migration | Contents |
|---|---|
| `001_foundation.sql` | users (4 roles), sessions, `audit_log`, `vertical_profiles`, shared `updated_at` trigger |
| `002_accounts.sql` | Account, Location, Domain, Contact, unified phone/email Endpoint, SourceIdentity, merge history |
| `003_evidence.sql` | ResearchRun, EvidenceRecord, SearchObservation, ProspectStatement |
| `004_ownership.sql` | ownership events, activity timeline, follow-ups, suppression |
| `005_markets_jobs.sql` | Saved Markets, market membership, search context, Postgres job queue, MiningJob, ProviderUsage |
| `006_scoring.sql` | CanonicalScore, ResearchCompleteness, opportunity/offer hypotheses, CallPack, KnowledgeSnapshot |
| `007_import_booking.sql` | import batches/rows, `meeting_bookings` |
| `008_read_model.sql` | `prospect_inventory` view |

### Invariants pushed into the database rather than left to application code

These are the ones the hard-fail lists turn on, so they are enforced where a future bug cannot
route around them:

- **Ownership consistency** — a CHECK constraint on `accounts` makes an owner exist exactly when
  `ownership_state` says one should. `UNCLAIMED` with an owner is unrepresentable.
- **Suppression cannot leak** — a trigger on `suppressions` recomputes `accounts.is_suppressed`
  and drops a newly suppressed Account out of `UNCLAIMED`. A new discovery source cannot reset it.
- **Evidence is append-only** — a trigger rejects any UPDATE that changes a claim, its confidence,
  its source or `can_state_as_fact`. Contradiction creates a new record pointing at the old one.
- **Ownership history is append-only** — UPDATE and DELETE on `ownership_events` both raise.
- **Call Packs are immutable** — UPDATE raises; material research change means a new pack.
- **A booking cannot be recorded confirmed without provider proof** — a CHECK on `meeting_bookings`
  requires `provider_event_id` and `confirmed_at` before `status = 'CONFIRMED'`.
- **Import cannot trigger outreach** — `import_batches.outreach_on_import` is CHECKed to false.

### Claim atomicity

`claimAccount` opens a transaction, takes `select ... for update` on the Account row, then
evaluates suppression, client/opportunity protection, existing ownership and the anti-hoarding
ceiling against a state no other transaction can change before commit. Bulk claim runs one
transaction per Account so unrelated successes survive a conflict and no statement locks the table.

### Files added

```
services/sales-brain/
  package.json  tsconfig.json  .env.example  deploy/docker-compose.yml
  migrations/001..008_*.sql
  src/config.ts
  src/db/{pool.ts,migrate.ts}
  src/domain/{normalize.ts,auth.ts,accounts.ts,ownership.ts,activities.ts,search.ts,verticals.ts}
  src/bin/{migrate.ts,sync-verticals.ts,seed.ts}
  tests/{setup.ts,helpers.ts,normalize.test.ts,ownership.test.ts}
```

### Repository fix made along the way

`docs/09-software/vertical-profiles/hvac.v1.yaml:503` did not parse. The
`primary_hook_template` value contains `first: phones, ...`; YAML read the embedded `": "` as a
nested mapping and every parser rejected the file. Quoted the scalar — no semantic change. Scanned
every `docs/**/*.yaml` for the same latent shape (a value that parses into an unintended nested
map rather than erroring); no other instance exists.

### Tests run

```
$ npx tsx --test tests/normalize.test.ts      6 pass, 0 fail
$ npx tsx --test tests/ownership.test.ts     15 pass, 0 fail
```

The ownership suite is the acceptance list from `rep-ownership-data-model.md` §20 and the mandatory
concurrency test from `rep-portal-api-contract.v1.md` §22:

| Test | Result |
|---|---|
| Duplicate discovery (website + import, differently punctuated name) → one Account | pass, matched on `phone_and_name` |
| Domain match resolves identity across a renamed record | pass |
| **Two reps claim simultaneously → exactly one owner, one audit event** | pass |
| **Eight reps claim simultaneously → exactly one owner** | pass |
| Bulk claim: 2 conflicts do not roll back 3 successes | pass |
| DNC survives rediscovery; not claimable; absent from unclaimed inventory | pass |
| Client Account is not generic cold inventory | pass |
| Cross-vertical rediscovery keeps the original owner | pass |
| Wrong number kills the endpoint, not the Account, and stays dead on re-crawl | pass |
| Requested callback blocks release | pass |
| Release returns an unprotected Account to inventory | pass |
| Non-owner cannot disposition, release or reassign | pass |
| Manager reassignment is audited and preserves prior owner | pass |
| `ownership_events` rejects UPDATE | pass |
| Claim ceiling enforced inside the transaction | pass |

A normalizer bug surfaced while writing the tests: `A.B.C. Air` tokenized to `a b c air` and did
not match `ABC Air`, so the same company would have been created twice. Initialism runs now
collapse before comparison.

### Data loaded

- 13 vertical profiles synced from `docs/09-software/vertical-profiles/` (HVAC and Plumbing are the
  wave-1 proof profiles).
- 48 **synthetic** Accounts across 6 verticals and 6 Jacksonville/St. Augustine ZIPs, 4 saved
  markets, 4 development users. Every seeded company is fictional, every number is in the
  `555-01xx` fiction range, every domain is under `example.com`. Nothing in the seed may be dialled
  or emailed.

### Performance

`explain analyze` on a realistic rep query (unclaimed + HVAC + ZIP 32256 + sorted, limit 50)
against the projection: **0.53 ms execution**. No further indexing added — the ownership data model
says to benchmark before over-indexing, and there is nothing here to fix yet.

### Blockers

None new. B-1 through B-4 from Gate T0 stand.

### Next gate

T2 — rep portal.

---

## Gate T2 — Rep portal

**Date:** 2026-09-03
**Status:** COMPLETE — the hero workflow runs end to end and every hard-fail case is refused
server-side. 33/33 tests pass.

### What was built

A server-rendered portal and JSON API in one Fastify process, styled with the YAD design tokens
mirrored from `src/styles/tokens.css`. No React, no build step, no external CDN: the whole client
bundle is one 296-line vanilla file that only adds selection, in-place claiming and the drawer.
Every page and every primary action works without it.

| Route | Purpose |
|---|---|
| `/login`, `/logout` | scrypt + database-backed sessions; cookie holds a token, database stores only its SHA-256 |
| `/` | Overview — KPIs, follow-ups due, recently claimed, markets |
| `/find` | **Find Prospects** — search hero, filter chips, table + mobile cards, bulk claim |
| `/markets` | Saved Market cards with derived counts |
| `/my-prospects` | the rep's book, 9 filters, 5 sorts |
| `/accounts/:id` + `/accounts/:id/panel` | Account detail as a full page and as the drawer body |
| `/follow-ups` | overdue and upcoming, with one-click complete |
| `/team`, `/team/:id` | manager ownership view and audited reassignment |
| `/healthz` | 3 fields, no data |
| `/api/*` | the contract in `rep-portal-api-contract.v1.md` |

### Judgement calls worth recording

**Server-rendered, not a SPA.** The portal is dense but barely stateful. A build chain would add
dependency surface on an internal box for no user-visible gain, and the repo's stated philosophy is
minimal JS and portable output. The drawer fetches an HTML fragment rather than JSON + a client
renderer, so account detail has exactly one implementation shared by the page and the drawer.

**Claim is never optimistic.** `portal.js` disables the button and waits for the server. A lost
race immediately renders the real owner. Phantom ownership is impossible because the client is
never the source of truth.

**Absence renders as absence.** `adBadges` emits nothing when no advertising evidence exists — not
a "No ads" chip. Stale evidence gets a visibly different dashed badge and, on the account page, an
extra explicit prohibition line.

**A main line is never dressed up as a direct line.** When the best route to a named person is the
company's main number, the contact block renders `Main line — ask for Dana Fielder` in amber
instead of implying a direct line. A role-only target renders as `Target role: Operations` with
`Named person not verified`.

### Verification

**Manual, against the running server on `127.0.0.1:8080`:**

| Check | Result |
|---|---|
| Anonymous `/`, `/my-prospects` | 302 → `/login` |
| Anonymous `/api/me`, `/api/accounts/:id/claim` | 401 JSON |
| Three sign-ins (rep1, rep2, manager) | 302 + `auth.login` audit rows |
| `Find Prospects: HVAC + 32256` | 200, 2 researched prospects, tier badges rendered |
| **rep1 + rep2 claim the same account simultaneously over HTTP** | rep2 won; rep1 got `ALREADY_CLAIMED` naming "Rep Two"; DB shows one owner, one CLAIMED event |
| rep1 posts a disposition at rep2's account | 403 `NOT_OWNER`, no activity written |
| rep1 attempts release / reassign of rep2's account | refused; reassign 403 |
| Prospect-requested callback | persisted; verbatim statement stored as `prospect_verified` |
| Release with a callback open | refused, `PROTECTED_RELATIONSHIP: CALLBACK_REQUESTED` |
| DNC | account `SUPPRESSED`, owner cleared, follow-ups cancelled, **0 rows in unclaimed inventory**, rep2's claim refused `SUPPRESSED` |
| Manager reassign | succeeded; ownership history shows CLAIMED → REASSIGNED with prior owner and reason |
| Ad evidence expired | current badge count 1 → 0, stale badge appears, extra prohibition line added, projection stops reporting a current advertiser |
| All 7 pages, both roles | 200; `/team` is 403 for a rep |

**Automated (`tests/portal.test.ts`, 12 new tests, HTTP level via `app.inject`):**
anonymous refusal on every surface; sign-in does not reveal whether an address exists (unknown
address, wrong password and disabled account all produce a byte-identical error); revoked session
dies immediately; HTTP claim race; ownership bypass refused with no activity written; manager-only
reassign, and reassign without a reason refused so the audit trail stays meaningful; DNC removes
the account from everyone's inventory; the Find page shows another rep's account but renders no
claim affordance for it; an injected sort key falls back instead of reaching SQL; bulk claim
reports per-account results; health exposes exactly 3 fields; security headers present and no
secret appears in any response body.

```
$ npm test
# tests 33   # pass 33   # fail 0
```

Two real defects surfaced during this gate and were fixed: the `auth.login` audit insert reused one
parameter for a `uuid` and a `text` column, which made every sign-in 500 after setting the cookie;
and running the test files concurrently let them truncate each other's database, so the suite now
runs `--test-concurrency=1`.

### Not verified

**Screenshots could not be produced on this box.** Headless Firefox fails with
`RenderCompositorSWGL failed mapping default framebuffer` — the NVIDIA DGX graphics stack offers no
usable framebuffer and Xvfb is not installed. Software-rendering flags did not help. UI verification
was therefore structural (composition, no external resource references, no hard-coded hex outside
the token layer, mobile card fallback present) plus reading the rendered HTML. Michael can view the
real thing directly once Gate T6 exposes it; installing `xvfb` would restore screenshot capability
but needs the sudo password.

### Files added

```
services/sales-brain/src/
  api/{server.ts,portal.ts,routes.ts,queries.ts}
  web/{html.ts,format.ts,layout.ts,components.ts}
  web/pages/{overview.ts,find.ts,account.ts,lists.ts}
  web/assets/{portal.css,portal.js}
  domain/accountDetail.ts
  workers/enqueue.ts
  bin/api.ts
tests/portal.test.ts
```

### Next gate

T3 — seed inventory import.

---

## Gate T3 — Seed inventory import

**Date:** 2026-09-03
**Status:** COMPLETE for the pipeline. Loading the real YAD lists is blocked on **B-2** — none are on
this machine. 45/45 tests pass.

### What was built

`normalize → identity resolve → suppression check → Account/Contact upsert → ownership check →
inventory`, exactly as `CLAUDE-CURRENT-TASK.md` §T3 specifies, with no second lead table.

- **`src/import/csv.ts`** — RFC 4180 parser handling BOM, CRLF, quoted commas, escaped quotes,
  embedded newlines and blank lines, plus tab/semicolon delimiter detection. Written rather than
  pulled in: a list import must not silently mangle a row, and it reports the real source line
  number on every rejection.
- **`src/import/mapping.ts`** — header inference across 16 canonical fields. Each field binds to at
  most one column and each column to at most one field, ordered by specificity so `Direct Phone` is
  never swallowed by the generic phone matcher. Split first/last name columns combine. Unmapped
  headers stay in the raw payload; no database columns are invented from spreadsheet headers.
- **`src/import/importer.ts`** — batch + per-row provenance, dedupe through the canonical resolver,
  suppression check, and the list-quality report from spec §15.
- **`src/bin/import.ts`** — `npm run import -- --file <csv> --source <name> [--vertical hvac] [--dry-run]`.

### Honesty rules enforced at import

- An imported **title** becomes an evidence record with `confidence = unknown` and
  `can_state_as_fact = false`; the Contact keeps `UNKNOWN_ROLE` / `UNCERTAIN`. A spreadsheet saying
  someone is the Owner does not make it a fact YAD may state.
- An imported **direct phone** is stored `PROVIDER_ASSERTED_CURRENT` / `DIRECT_PROVIDER_ASSERTED`,
  never `CONFIRMED`.
- **Source industry is a hint.** It sets a vertical only when that profile is loaded and active;
  otherwise the raw label is kept and the report says how many hints were dropped. A coarse
  taxonomy neither rejects a good prospect nor silently mislabels one.
- The **raw row is preserved verbatim** alongside the normalized form, so a bad mapping can be
  re-examined without re-uploading the file.
- Re-uploading a byte-identical file is refused by SHA-256 rather than double-imported.

### Verified against a deliberately messy synthetic list

9 data rows containing: a legal-suffix name variant, the same company twice with one shared Apollo
ID, quoted fields with commas and escaped quotes, a `Florida` vs `FL` state spelling, a ZIP+4, a
missing website, a missing phone, a 7-digit phone, an entirely empty row and a one-character name.

```
rows 9 · new accounts 5 · matched 2 · rejected 2 · unique accounts 6 · duplicate rate 14.3%
match rules: created 5 · source_identity 1 · phone_and_name 1
rejected: line 7 "(no company) — no company name or website"
          line 10 "X — company name too short to identify a business"
```

The most useful result: **row 1 matched an Account the miner had already discovered**
(`discovered_via = seed:synthetic`) on `phone_and_name`, and the duplicate row matched the same
Account on its Apollo ID. The list did not fork a company the system already knew. Afterwards that
Account carries two phone endpoints with different, honest labels rather than one conflated number:

```
(904) 555-0101  MAIN_BUSINESS_LINE      PUBLIC_OBSERVED_UNVERIFIED   (from discovery)
(904) 555-9101  DIRECT_BUSINESS_LINE    PROVIDER_ASSERTED_CURRENT    (from the list)
```

### Tests added (`tests/import.test.ts`, 12)

CSV shapes real exports have; delimiter detection; one-to-one column binding with unknown headers
left unmapped; industry hints returning null rather than guessing; duplicates resolving to one
Account; a list merging into a previously-discovered Account with endpoint labels preserved;
imported titles never stated as fact; **a new list cannot resurrect a DNC** (rows flagged
`SUPPRESSED`, account stays suppressed, never re-enters claimable inventory); an import not
resetting ownership or contact history; identical-file re-upload refused; dry run writing nothing;
and import never starting outreach — asserted both by the absence of contact activities and by the
schema CHECK rejecting `outreach_on_import = true`.

### Three real defects found and fixed

1. **`client.query` was detached from its `this`** in the row recorder (`client?.query ?? query`),
   so every real import threw inside the transaction after creating the batch. Only the dry run
   worked, which is exactly the shape of bug that ships unnoticed.
2. **A failed batch was left stuck in `RUNNING`** with zero counts. It now records `FAILED`, the
   rows it did commit, and the error.
3. **An unknown vertical crashed the import on a foreign key.** Found by the tests, and a genuine
   production risk: any list whose industry mapped to an unloaded profile would have aborted. The
   importer now validates against loaded profiles and degrades to the raw label.

### Blocker

**B-2 stands.** The real Jacksonville / St. Augustine lists, prior CSVs, the Airtable export and any
Apollo exports are not on this machine. When Michael drops them anywhere on the EdgeXpert:

```
cd services/sales-brain
npm run import -- --file /path/to/list.csv --source "airtable-brent-2026-08" --dry-run
npm run import -- --file /path/to/list.csv --source "airtable-brent-2026-08"
```

Run the dry run first: it prints the inferred column mapping and the rejection reasons without
writing, which is the moment to catch a mis-mapped header.

### Next gate

T4 — public decision-maker resolver.

---

## Gate T4 — Public decision-maker resolver

**Date:** 2026-09-03
**Status:** COMPLETE for Stage A (`PUBLIC_ONLY`, no credential required). Stages B–D ship behind
adapters and stay disabled pending **B-3**. All 13 canonical fixtures pass. 85/85 tests pass.

### What was built

```
src/resolver/
  types.ts               source classes, relationship classes, the two output objects
  roles.ts               title → relationship, hypothesis and vertical routing ladders
  reconcile.ts           observations → DecisionMakerIdentity + ContactPath   (pure)
  fetcher.ts             robots.txt-aware, rate-limited, wall-detecting HTTP
  adapters/firstParty.ts Stage A: JSON-LD, team pages, tel:/mailto:, extensions
  persist.ts             writes contacts, endpoints and evidence
src/workers/
  runner.ts              leased Postgres job queue
  contactResearch.ts     the waterfall for one account
src/bin/{worker,demo-research}.ts
```

The reconciler is deliberately **pure** — no network, no database — which is what makes the
honesty rules testable rather than aspirational.

### The separation that drives the design

`DecisionMakerIdentity` (who owns the problem) and `ContactPath` (how we may legitimately reach
them) are separate objects with separate confidence dimensions. `employer_match`, `role_match`,
`currentness` and `relationship_to_person` are stored independently and are never collapsed into a
single percentage. A confirmed Operations Director reachable only through the front desk is a
complete, useful record.

### Routing by problem ownership, not prestige

`targetRoleLadder(vertical, hypothesis)` puts the hypothesis ladder first and appends the vertical
default. Demonstrated live below: for an `after_hours` hypothesis the Director of Operations
resolves as `PRIMARY_PROCESS_OWNER` at priority 10 and the Owner lands third at 62.

### Hard rules enforced, each with a test

| Registry rule | Enforcement |
|---|---|
| `no_registered_agent_promotion` | `NON_DECISION_RELATIONSHIPS` excludes them before scoring; the exclusion is written as evidence, not silently dropped |
| `no_mainline_as_direct` | a phone becomes `DIRECT_CONFIRMED` only when the source **explicitly** presents it as personal; proximity on a page is not enough |
| `no_guessed_email_as_verified` | `DERIVED_PATTERN` → `GUESSED_UNVERIFIED`, and a guess can never produce `NAMED_EMAIL_READY` |
| `public_only_default` | `CONTACT_ENRICHMENT_MODE=PUBLIC_ONLY`; the paid stage records itself as skipped |
| `prospect_correction_precedence` | gatekeeper source outranks all others; a person marked departed is retired, and a later re-crawl cannot resurrect them |
| `no_sensitive_personal_enrichment` | a people-search style number is dropped with a note, never stored |

Licence qualifiers and officers are `EVIDENCE_ONLY_RELATIONSHIPS`: they corroborate identity but
carry a scoring penalty that keeps them off the top of the routing on their own.

### Crawling conduct

`fetcher.ts` reads and honours robots.txt (including `Allow` overrides and `Crawl-delay`), serializes
requests per host, caps response size, and treats a 401/403/429 or a CAPTCHA/interstitial as a
**wall that ends the crawl for that host** — never as something to retry or route around. Tested
against live local servers returning each condition.

### Fixture results — all 13 from `outbound-sales-brain-public-contact-resolution-fixtures.v1.yaml`

Every fixture's `hard_fail_if` clause is asserted as an explicit negative, not merely implied by a
passing positive. Extra cases were added where a fixture had an obvious near-miss: a qualifier with
no corroboration, a number sitting next to a name, and the same two people flipping when the
hypothesis changes.

### Live end-to-end

A local fixture site (schema.org markup, a team page, a main line, one explicitly published direct
line, an extension, `info@` and a personal address) was crawled by the real worker through the job
queue:

```
pri  person         title                    role_match             role_confidence
 10  Jordan Quill   Director of Operations   PRIMARY_PROCESS_OWNER  LIKELY_CURRENT_ROLE
 31  Morgan Ober    Office Manager           STRONG_STAKEHOLDER     LIKELY_CURRENT_ROLE
 62  Casey Nash     Owner                    VALID_FALLBACK         LIKELY_CURRENT_ROLE

(904) 555-0188  DIRECT_BUSINESS_LINE    DIRECT_CONFIRMED  → attached to Jordan Quill
(904) 555-0177  MAIN_BUSINESS_LINE      COMPANY_ROUTE     → account level, no person
info@…          GENERAL_BUSINESS_EMAIL  ROLE_INBOX        → account level, no person
```

and the portal renders `Direct line — published by the business` for the first, with the company
endpoints in a separate block headed *Not tied to a named person*.

`role_confidence` is `LIKELY_CURRENT_ROLE`, not `CONFIRMED`: one source class supports these people.
`CONFIRMED` requires corroboration from a second independent source. That distinction is the point.

### Five real defects found and fixed

1. **The live run invented a person.** `"Office Manager"` at the end of a team card, followed by
   `"Marsh Point Air was founded by…"`, produced a contact named *Marsh Point Air, Office Manager* —
   ranked above a real person. Two fixes: a bare newline is no longer a valid *title→name*
   separator (it stays valid for *name→title*, which is how cards are laid out), and the company's
   own name can never become a person. This is the exact failure the fixtures call a hard fail, and
   only the live run surfaced it.
2. **`stripTags` flattened element boundaries**, so `<h3>Dana Fielder</h3><p>Owner</p>` became an
   unparseable three-word run. Block tags now become newlines.
3. **A `NAME` could begin with a title**, yielding people like *"Owner Riley Marsh"*.
4. **The `i` flag defeated the uppercase requirement** in every name pattern, so
   *"Call Jane Smith directly at…"* captured *"Jane Smith directly"*.
5. **The job runner burned a retry on every poll.** It set `RUNNING` and incremented `attempts`
   *before* checking whether the job was due, so a backed-off job would exhaust its retries without
   ever running. Due-ness is now part of the atomic claim.

Two smaller ones: `Crawl-delay: 0` was treated as unset (18s of needless waiting per crawl), and the
worker rebuilt `https://<hostname>`, discarding the scheme, port and path actually observed.

### Blocker

**B-3 stands.** Stages B–D (state registries, licence records, directories, search) are wired as
adapters and each records itself as skipped with its reason. They need a provider credential and a
written source-governance review per
`market-miner-source-governance-review-template.yaml` before running automatically. Stage A carries
the resolver without them, which was the point of the public-first design.

### Next gate

T5 — Market Miner inventory connection.
