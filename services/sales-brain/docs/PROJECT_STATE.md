# Current State — Sales Brain

Updated: 2026-09-16 (documentation audit; no code changed)

- **Repository:** Your AI Department — `https://github.com/GitterGlitter93rt/AiDepartment.git`
- **Service path:** `services/sales-brain`
- **This worktree:** `/home/roothecks/YAD-Sales-Brain-collector-fix`
- **Branch:** `fix/dataforseo-standard-collector`
- **HEAD:** `d856bce` — *fix(miner): a paid task is on the ledger before we wait, and collected after* (2026-09-15), identical to `feature/outbound-sales-brain`
- **Working tree:** clean at audit time

The task database is `brain/TODO.md` at the repository root and the approved
decision log is `brain/DECISIONS.md`. This file summarises what those two say
plus what the code shows; where they disagree, they are authoritative.

---

## Where the work lives

| Worktree | Branch | State on 2026-09-16 |
|---|---|---|
| `/home/roothecks/YAD-Sales-Brain` | `feature/outbound-sales-brain` (locked) | **Live.** An agent session was working here, and the API and worker were running from `services/sales-brain/dist/bin/`. |
| `/home/roothecks/YAD-Sales-Brain-enrichment` | `feature/sales-brain-rep-enrichment` | **Live.** Full suite running. Newest work: `523d8da` (2026-09-16). |
| `/home/roothecks/YAD-Sales-Brain-collector-fix` | `fix/dataforseo-standard-collector` | Idle, same HEAD as the main line. |
| `/home/roothecks/YAD-Sales-Brain-readmodel-fix` | `fix/sales-brain-discovery-coverage-identity` (`ef4d343`) | Idle |
| `/home/roothecks/YAD-Sales-Brain-p0-entity-resolution` | `fix/sales-brain-p0-entity-resolution` (`c9f9bb6`) | Idle |
| `/home/roothecks/YAD-Sales-Brain-marathon` | `offline-marathon-20260909` (`8245bd9`) | Idle |
| `/home/roothecks/YAD-Sales-Brain-baseline-check` | detached `ef4d343` | Idle |

**Check for a live session before working in any of them.** The suites share one
test database, so a second run corrupts both.

## What is working

Completed with their gates met, per `brain/TODO.md`:

- `SB-T0` EdgeXpert environment and canonical database (PostgreSQL in Docker).
- `SB-T1` canonical Account data foundation — 35 tables and one search projection.
- `SB-T2` rep portal — Overview, Find Prospects, Markets, My Prospects, Account detail.
- `SB-T3` list import — normalize → identity resolve → suppression → upsert.
- `SB-T4` `PUBLIC_ONLY` decision-maker resolver (first-party research, no Apollo).
- `SB-T5` Market Miner connected to inventory; discovery behind an adapter.
- `SB-T6` secure internal deployment — systemd user services with linger, verified backup.
- `SB-T7` strategy-call booking, provider-neutral, Cal.com authoritative with a Microsoft Graph adapter.
- `SB-T8` cold-call brain; orchestration owns terminal state.
- `SB-EMAIL` Smartlead preparation — canonical email state, eligibility gate, reply handling.
- `SB-H1…H8` hardening: bounded transcripts and idempotent voice setup, a credential-free latency/interruption benchmark, 90 adversarial roleplay cases, the hook/opener experiment engine with attribution, a 21-page CRM audit, provider-contract hardening, a 20-class offline release dry-run matrix, and the voice-service deployment handoff.
- `SB-S1…S5` scale: deterministic 25k/100k synthetic datasets, a 46-case query benchmark, 18 genuinely parallel concurrency tests, 33 import/dedupe torture cases, 14 worker crash-recovery tests.

The suite stands at **1311/1311** on the main line, and identical in reverse
file order (`npm run test:isolation`) — order-dependence is treated as a defect.

## Current development state

Two threads are open.

**`SB-QA1` — live portal bug hunt (GitHub Issue #2).** The owner's operator
walk-through on the EdgeXpert found defects that were each *true of the code and
false of what the screen said*. The campaign covers startup/recovery,
authorization, search, mining, ownership, follow-ups, opportunities and
meetings, the pilot control plane, imports and merges, analytics truth, security
and input handling, and performance. Every defect gets a reproducible case and a
regression test before its fix.

**`SB-QA2`/`SB-QA3` — miner, search and worker hardening (Issue #3).** The
durable execution ledger for the overnight campaign. Defects found that green
tests did not:

- a provider search id used as a business identity, collapsing every company in
  one search into the first;
- a paid ad's headline becoming the company name;
- one `PENDING` provider answer retiring a saved market permanently;
- the daily ceiling refusing to collect searches already paid for;
- Find Prospects claiming aged research on a market nobody had researched;
- `create table if not exists` racing itself on a fresh install's first boot;
- five pieces of configuration written and never read, `retention_class` latest.

The newest work, on `feature/sales-brain-rep-enrichment`, is first-party
enrichment from official sources: Texas Comptroller (API, because the scraping
path is the one robots forbids), Florida DBPR (session-bearing POST, so read the
file), TX TDLR parser repair, a snapshot refresh lifecycle with two dates that
must not be conflated, structured service areas that are never the address, and
"who to ask for" stated apart from what the record calls them.

## Known issues / risks

- **`MINER_LIVE_CANARY_READY` is not met.** The remaining canary gates need a
  real DataForSEO credential **and** the owner's source-governance sign-off
  (`SB-B3`). Until then the adapter reports itself unconfigured and buys nothing.
- **Retention periods (`INPUT-006`) are unset** — an owner decision, not a code
  gap.
- **Unknowns kept as unknowns, deliberately:** the Meta ad-library signal needs
  a real ad-library source (not inferred from SERP presence, a Facebook link or
  a pixel), and `storm_hail_market_signal` needs a weather or event feed. Both
  stay `UNKNOWN` rather than false, and no writer was fabricated to satisfy a
  reachability count. Do not "fix" these by inferring them.
- **Five branches carry unmerged work.** `feature/outbound-sales-brain` is 513
  commits ahead of `origin/main`, and the website sprint line has diverged
  separately — see the repository-root `docs/PROJECT_STATE.md`.
- **The shared test database** means two concurrent suites corrupt each other.
- **The running API and worker on this machine serve real data.** Restarting
  them is an operational act, not a development one.

## Production state

There is one environment: this machine (the MSI EdgeXpert). Observed on
2026-09-16:

- `node dist/bin/api.js` and `node dist/bin/worker.js` running with cwd
  `/home/roothecks/YAD-Sales-Brain/services/sales-brain`.
- PostgreSQL via `deploy/docker-compose.yml`; services managed by
  `deploy/stack.sh` as systemd **user** services, which require
  `loginctl enable-linger` or they stop at logout and the queue quietly stops
  being served.
- Backups: `deploy/backup.sh` with `verify-backup.sh`, restore drill in
  `RUNBOOK-backup-restore.md`.

**NEEDS VERIFICATION:** which commit the running `dist/` was built from (ask
`npm run manifest`), whether the portal is exposed beyond loopback
(`SALES_PORTAL_BIND`), and the current backup schedule on the host.

## Important recent commits

| Commit | Date | Description |
|---|---|---|
| `523d8da` | 2026-09-16 | Choosing a database and allowing loopback fixtures are separate decisions |
| `d856bce` / `45a5d01` | 2026-09-15 | A paid task is on the ledger before we wait, and collected after |
| `63d97ad` | 2026-09-15 | An API key must not follow a redirect off-host |
| `54447e8` | 2026-09-15 | Who to ask for, said apart from what the record calls them |
| `d933836` | 2026-09-15 | Service area: where they will travel, structured, never the address |
| `f8c2cef` | 2026-09-15 | A snapshot refresh lifecycle, and two dates that must not be conflated |
| `78f99c7` | 2026-09-15 | TX Comptroller: use the API; the scraping path is the one robots forbids |
| `ef4d343` | 2026-09-14 | One run's finished history is not another run's |
| `122e78a` | 2026-09-14 | A market is a vertical and a place, and PENDING means now |
| `c9f9bb6` | 2026-09-13 | The hash binds the collection intent; one plan binds to one job |
| `cba7e4d` | 2026-09-12 | The plan a person confirms is the plan the worker executes |
| `9b51778` | 2026-09-12 | Resolution is not optional, and a refused row is still evidence |
| `cc392b9` | 2026-09-11 | A search result is not a business, and a service is not a market |
| `2cdcfe6` | 2026-09-10 | A signal cannot be wired into the score unless the score may read it |
| `bca82a1` | 2026-09-10 | The daily ceiling was a precondition of the run, not of the call |
| `df0b4cc` | 2026-09-10 | A background job could wait for ever behind work that keeps arriving |

## Handoff notes

1. Read `AGENTS.md` and `brain/TODO.md` at the repository root first; use the
   `SB-*` task id in your notes and commits.
2. Read `CLAUDE.md` beside this file for the safety rules. The two that matter
   most: never spend provider money, never arm an outbound channel.
3. `npm run doctor` and `npm run manifest` before believing anything about the
   running system.
4. A defect gets a reproducible case and a regression test *before* its fix.
   That is the house rule for both open campaigns.
5. Do not resolve an `UNKNOWN` by inference. The whole system is built so that
   "nobody looked" and "we looked and found nothing" are different states.
6. Do not run the suite if another one is running.
