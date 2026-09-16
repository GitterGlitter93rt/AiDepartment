# Sales Brain — operating guide for Claude

Verified 2026-09-16 against this source tree (`d856bce`). This file is the short
guide; `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md` and `docs/DECISIONS.md`
beside it carry the detail.

**Repository context.** This service lives inside the Your AI Department
repository, on the Sales Brain branch line (`feature/outbound-sales-brain` and
its `fix/*` branches). The repository root `CLAUDE.md`, `AGENTS.md` and `brain/`
still apply and outrank this file:

- `AGENTS.md` — read `brain/README.md` and `brain/TODO.md` before substantial work.
- `brain/TODO.md` — the task database, with completion gates. `SB-*` tasks are this service.
- `brain/DECISIONS.md` — the approved decision log.
- `docs/00-company/launch-decisions.md` — the locked commercial model.

---

## What this is

An outbound sales system for Your AI Department: it finds businesses in a
market, decides what is actually known about each one, works out who to speak
to, and supports a human rep making the call — then books the meeting and keeps
the record honest.

It is **not** a chatbot, a dialler, or a lead list. Most of the code exists to
stop the system from claiming to know things it does not.

## Architecture in one paragraph

Three processes: PostgreSQL, a Fastify API that also serves the server-rendered
sales portal, and a worker that runs the queues. TypeScript throughout, no ORM
(plain `pg` and 52 ordered SQL migrations), no frontend framework (HTML is
generated in `src/web`). Every paid provider sits behind an adapter with a spend
ceiling, and every outbound channel sits behind a flag that is off by default.

## Important paths

| Path | What it is |
|---|---|
| `src/bin/` | 31 CLI entry points — `api`, `worker`, `migrate`, `doctor`, `miner-canary`, `manifest`, `support-bundle`, `exposure-preflight`, `coverage`, … |
| `src/api/` | Routes, read models, portal session handling |
| `src/web/` | Server-rendered portal pages (`overview`, `find`, `lists`, `account`, `waveB/C/D`) |
| `src/workers/` | `runner`, `marketMiner`, `marketScheduler`, `contactResearch`, `providerTaskSweeper`, `researchReconcile`, `enqueue`, `redaction` |
| `src/miner/` | DataForSEO adapter, search plan and preview, spend ceilings, canary, coverage plan, listings ingest, provider tasks |
| `src/domain/` | Accounts, merge, ownership, duplicate review, contact confidence, research completeness, REP_READY, signal registry, vertical profiles, opportunities, hypotheses, roles, auth |
| `src/resolver/` | Entity resolution — one canonical Account whatever order the evidence arrives in |
| `src/callbrain/` | Call preparation and grading: call pack, openers, objections, qualification, state machine, untrusted-text handling |
| `src/voice/` | Dial controller, callback routing, internal pilot, audio scenarios |
| `src/probe/` | Lead-response measurement (five outcomes, not two) |
| `src/compliance/` | DNC registry, channel eligibility, line-type screening |
| `src/release/` | Gates, doctor, build manifest, exposure preflight, canary packet, dry-run matrix, support bundle |
| `src/scoring/` | Deterministic scoring with a recorded policy version |
| `migrations/` | 52 ordered SQL files, `001_foundation.sql` … `052_search_plan_preview.sql` |
| `tests/` | 138 suites |
| `deploy/` | `stack.sh`, `docker-compose.yml`, `backup.sh`/`restore.sh` + verifiers, systemd units, two runbooks |

## Development commands

Node `>=22.12.0`. From `services/sales-brain/`:

```bash
npm install
npm run migrate        # apply SQL migrations to DATABASE_URL
npm run api            # tsx src/bin/api.ts
npm run worker         # tsx src/bin/worker.ts
npm test               # LOG_LEVEL=silent tsx --test --test-concurrency=1 tests/*.test.ts
npm run test:isolation # the same suites in reverse order — catches order-dependent state
npm run check          # tsc --noEmit
npm run build          # node scripts/build.mjs -> dist/
npm run doctor         # what is happening now
npm run manifest       # what is running: build identity, schema state, profile hashes
npm run preflight      # exposure preflight — what could reach a real person
npm run miner:canary   # a market search an operator can read before it costs anything
./deploy/stack.sh status
```

`npm test` takes a long time and needs PostgreSQL. **The suites share one test
database** — do not start a second run while another is going.

## Environment

Names only; values live in an untracked `.env` (see `.env.example`).

`NODE_ENV`, `DATABASE_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_PORT`, `SALES_PORTAL_PORT`, `SALES_PORTAL_BIND`, `SESSION_SECRET`,
`SESSION_COOKIE_SECURE`, `CONTACT_ENRICHMENT_MODE`, `APOLLO_API_KEY`,
`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `BOOKING_PROVIDER`,
`CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_WEBHOOK_SECRET`,
`MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`,
`BOOKING_CALENDAR_UPN`, `BOOKING_TIMEZONE`, `OUTBOUND_DIAL_ENABLED`,
`OUTBOUND_EMAIL_ENABLED`, `LOG_LEVEL`, `SEED_PASSWORD`, `SCALE_DATABASE_URL`.

A flag is read one way everywhere (`flag()` in `src/config.ts`) and an
unrecognised value **throws** rather than defaulting — two dialects once meant
`OUTBOUND_DIAL_ENABLED=1` armed dialling while the release manifest reported it
disabled.

There is one environment: this machine. No cloud staging, no cloud production.

## External integrations

| Provider | Purpose | Costs money |
|---|---|---|
| DataForSEO | Market mining / search results | **Yes, per task** |
| Apollo | Optional paid contact enrichment; blank key = disabled | **Yes** |
| Cal.com | Booking authority; webhook `/api/webhooks/calcom` | No |
| Microsoft Graph | Calendar/mail booking fallback (`BOOKING_PROVIDER`) | No |
| Smartlead | Email sequencing; webhook `/api/webhooks/smartlead` | Account-dependent |
| PostgreSQL | Everything durable | No |

## Safety rules — read before running anything

1. **Never spend provider money casually.** DataForSEO and Apollo bill per
   request. `npm run miner:canary` is dry by default; the live path requires the
   ceiling to be stated twice and goes through the ordinary queue.
2. **Never flip `OUTBOUND_DIAL_ENABLED` or `OUTBOUND_EMAIL_ENABLED`.** They are
   the two switches that can reach a real person. The pilot gate is explicit and
   it is not yours to give.
3. **Never place a call, send an email, or submit a form to a real business.**
   The probe subsystem exists to measure lead response; it has fixtures.
4. **Never bypass DNC or channel eligibility.** `src/compliance/` decides what
   may be contacted, and line-type screening exists because a mobile is not a
   landline in law.
5. **Never start a test run while another is running** — one shared database.
6. **Never put lead data, contact exports, transcripts or customer lists into
   Git**, docs, or `brain/`. Support bundles and canary packets are built to be
   handed over; check them before sharing.
7. **Never claim a run was verified because a process exited.** `doctor`,
   `manifest` and the gates in `src/release/` exist for that.
8. Do not restart the running API or worker on this machine without asking —
   see `docs/PROJECT_STATE.md` § Production state.

## Conventions that carry meaning

- **Epistemic honesty is the product.** "We looked and found nothing" must never
  read as "nobody looked" — six states exist for that reason. A found business
  is not a researched one (`REP_READY`). A spending ceiling of ours is not a
  failure of the market.
- **Evidence has provenance.** A score records the policy that produced it; a
  research run records the vertical profile that produced its evidence; a
  discovery row records its source.
- **A shared word or a shared Facebook page is not one company.** Entity
  resolution is `src/resolver/`, and a refused row is still evidence.
- Commit subjects state the defect in product terms, e.g. *"a paid task is on
  the ledger before we wait, and collected after"*.
- Tests come with the fix, and torture/adversarial suites are normal here
  (`importTorture`, `workerTorture`, `poisonJobs`, `injectionCorpus`,
  `salesAiAdversarial`).
