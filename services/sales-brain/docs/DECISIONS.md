# Decision record — Sales Brain

Technical decisions provable from this service's code, migrations and commits,
compiled 2026-09-16.

**`brain/DECISIONS.md` at the repository root is the approved company-level
decision log and outranks this file.** What follows is the engineering layer:
decisions that are visible in the source and that a fresh agent will otherwise
re-litigate.

---

## UNKNOWN DATE (by migration `001`) — Plain SQL and plain Postgres

**Decision:** `pg` plus ordered `.sql` migrations. No ORM, no query builder, no
migration framework.

**Evidence:** `migrations/001_foundation.sql` … `052_search_plan_preview.sql`;
`src/db/`; `src/bin/migrate.ts`.

**Implications:** the schema is readable as text and reviewable in a diff; there
is no generated layer between a claim and the table that holds it.

## UNKNOWN DATE — The portal is server-rendered HTML

**Decision:** No frontend framework. Pages are generated in `src/web` and served
by the same Fastify process as the API.

**Evidence:** `src/web/{layout,components,format,html}.ts`, `src/web/pages/`;
`package.json` has no frontend dependency.

**Implications:** one process to run, one place a page's data comes from, and
read models (`src/api/readModels.ts`) rather than client-side assembly.

## 2026-09-10 — Queue health is a fact, not an inference

**Decision:** The worker writes a heartbeat; `deploy/stack.sh status` reads that
heartbeat from the database, and the verdict exits non-zero when no worker is
serving the queue.

**Evidence:** `migrations/030_job_outcome_and_worker_heartbeat.sql`;
`deploy/RUNBOOK-stack.md`; commits `ade431f`, `df0b4cc`, `80a15e2`.

**Reason, from the runbook:** the portal once ran with the API up and no worker.
A market search was accepted, a job was written, and it sat in the queue for
ever — while Research Health stayed green, because health was inferred from the
absence of stranded jobs, and a job nobody has picked up has no expired lease.

## 2026-09-10 — A spend ceiling is a precondition of the call, not of the run

**Decision:** The daily ceiling is evaluated per provider call. A ceiling must
not refuse to *collect* searches that were already paid for, and a search we
refused to buy is not counted as a search we submitted.

**Evidence:** commits `bca82a1`, `ffa8c27`; `src/miner/spend.ts`;
`src/miner/providerTasks.ts`.

## 2026-09-15 — A paid task is on the ledger before we wait

**Decision:** Write the provider task to the ledger *before* waiting on the
provider, and record collection after.

**Evidence:** commit `d856bce` (and `45a5d01` on the enrichment branch);
`src/miner/providerTasks.ts`; `migrations/035_provider_tasks.sql`.

**Implications:** money spent is always recoverable from the ledger, even if the
process dies mid-wait.

## 2026-09-10 — A signal cannot score unless the score may read it

**Decision:** A signal must be declared in the registry and readable by the
scoring policy before it can affect a score; every score records the policy that
produced it.

**Evidence:** commits `2cdcfe6`, `4b97128`; `src/domain/signalRegistry.ts`;
`src/scoring/model.ts`; `migrations/040_score_recompute.sql`.

## 2026-09-11 → 2026-09-14 — A search result is not a business; a market is a vertical **and** a place

**Decision:** Search results are evidence, not entities. A market is the pair
(vertical, place), and a service is not a market.

**Evidence:** commits `cc392b9`, `122e78a`, `ef4d343`;
`src/miner/searchTaxonomy.ts`, `src/miner/geography.ts`;
`migrations/037_market_scheduling.sql`, `050_market_disabled_outcome.sql`.

**Defects this prevents:** a provider search id used as a business identity
(collapsing every company in one search into the first); a paid ad's headline
becoming a company name; one `PENDING` provider answer retiring a saved market
permanently.

## 2026-09-12 → 2026-09-13 — The plan a person confirms is the plan the worker executes

**Decision:** A confirmed search plan is bound by hash to the job that executes
it — one plan, one job, one intent per search.

**Evidence:** commits `cba7e4d`, `c9f9bb6`, `0e0dc49`;
`src/miner/searchPlan.ts`, `planPreview.ts`;
`migrations/052_search_plan_preview.sql`.

## 2026-09-12 — Resolution is not optional, and a refused row is still evidence

**Decision:** Every discovered row goes through entity resolution; a row that is
refused is recorded rather than dropped.

**Evidence:** commit `9b51778`; `src/resolver/`;
`migrations/051_entity_resolution.sql`, `036_source_observed.sql`.

**Related:** a shared word or a shared Facebook page is not one company — the
canonical identity hardening in `SB-QA3` item D/E.

## UNKNOWN DATE (by `SB-QA3`) — Six epistemic states, and found ≠ researched

**Decision:** Coverage and research carry explicit epistemic states so that "we
looked and found nothing" never reads as "nobody looked", and a `REP_READY`
contract separates a business that was *found* from one that was *researched*.

**Evidence:** `brain/TODO.md` `SB-QA3` items B and C; `src/domain/repReady.ts`,
`researchCompleteness.ts`, `entityStatus.ts`; `tests/researchEpistemics.test.ts`.

**Implications:** an `UNKNOWN` is a legitimate terminal answer. The Meta
ad-library signal and `storm_hail_market_signal` stay `UNKNOWN` rather than
false because neither has a real source yet, and no writer was fabricated to
satisfy a reachability count.

## UNKNOWN DATE — Paid enrichment is opt-in and mode-gated

**Decision:** Contact resolution runs `PUBLIC_ONLY` by default;
`CONTACT_ENRICHMENT_MODE` (`PUBLIC_ONLY` | `PUBLIC_THEN_PAID` |
`PAID_ALLOWED_FOR_TIER_A` | `IMPORT_ONLY`) decides whether a paid lookup is
allowed at all, and a blank `APOLLO_API_KEY` disables Apollo entirely.

**Evidence:** `.env.example`; `src/workers/contactResearch.ts`;
`brain/TODO.md` `SB-T4`.

## UNKNOWN DATE — DataForSEO needs a credential **and** a governance signature

**Decision:** The adapter is live only when it is enabled, credentialed *and*
the source-governance review is signed. Any one missing means no traffic, and
the adapter says which.

**Evidence:** `src/miner/dataForSeoAdapter.ts` (`config.enabled && config.login
&& config.password && config.governanceReviewed`); `brain/TODO.md` `SB-B3`.

**Implications:** `MINER_LIVE_CANARY_READY` is not met, and a credentialled
canary against a real market with the ceiling verified live is the gate.

## UNKNOWN DATE — One dialect for flags, and an unknown value throws

**Decision:** `flag()` in `src/config.ts` is the only way a boolean environment
variable is read, and an unrecognised value raises rather than defaulting to
false.

**Evidence:** the comment block in `src/config.ts`.

**Reason, verbatim:** two dialects both read `OUTBOUND_DIAL_ENABLED`, so `=1`
armed outbound dialling while the release manifest and the exposure preflight
each reported it disabled — "true of the code and false of the screen, on the
one flag where that gap can put a call on a real phone".

## UNKNOWN DATE — Outbound channels are off by default and gated by the pilot

**Decision:** `OUTBOUND_DIAL_ENABLED` and `OUTBOUND_EMAIL_ENABLED` default off
and are never flipped without the explicit pilot gate.
`src/release/exposurePreflight.ts` reports what can currently reach a person.

**Evidence:** `.env.example` ("Never flip without the explicit pilot gate");
`npm run preflight`; `src/voice/internalPilot.ts`.

## UNKNOWN DATE — Eligibility, DNC and line type gate every contact

**Decision:** Contactability is decided by `src/compliance/` — the DNC registry,
channel eligibility, and line-type screening — not by whether a number exists.

**Evidence:** `migrations/010_channel_eligibility.sql`,
`018_line_type_screening.sql`, `022_dnc_registry.sql`, `023_dnc_integration_row.sql`;
`tests/dncProvider.test.ts`, `eligibility.test.ts`, `lineType.test.ts`.

## 2026-09-15 — Official sources are used the way each one permits

**Decision:** Use a public API where one exists and the scraping path is
disallowed (Texas Comptroller); read the file where the search is a
session-bearing POST (Florida DBPR); fix the parser rather than accept empty
results (TX TDLR). A crawler never follows a redirect off-host while carrying an
API key.

**Evidence:** commits `78f99c7`, `ccc982f`, `5c1b218`, `63d97ad`, `4bca894`
(all on `feature/sales-brain-rep-enrichment`).

## 2026-09-15 — Two dates that must not be conflated

**Decision:** A snapshot's refresh lifecycle distinguishes when a fact was
observed from when the record was refreshed; a service area is structured and is
never the street address; "who to ask for" is stated apart from what the record
calls the business.

**Evidence:** commits `f8c2cef`, `d933836`, `54447e8`;
`tests/snapshotLifecycle.test.ts`, `serviceArea.test.ts`.

## UNKNOWN DATE — Untrusted website text is fenced before it reaches a prompt

**Decision:** External text enters prompts through one verified path, and the
adversarial corpus is part of the suite.

**Evidence:** `src/callbrain/untrusted.ts`; `tests/injectionCorpus.test.ts`,
`salesAiAdversarial.test.ts`, `salesAiHardening.test.ts`;
`brain/TODO.md` `SB-QA3` item Q.

## UNKNOWN DATE — Test order is not allowed to matter

**Decision:** `npm run test:isolation` runs the same suites in reverse file
order, and a difference is a defect.

**Evidence:** `package.json` (`test:isolation`); `brain/TODO.md` `SB-QA2`
("suite 1311/1311 and identical in reverse file order").

## UNKNOWN DATE — Release identity is recorded, not assumed

**Decision:** The build records what it is — build identity, schema state,
vertical-profile content hashes and the scoring fingerprint — separately from
what state it is in.

**Evidence:** `src/release/manifest.ts` and its header comment;
`migrations/041_build_identity.sql`; `npm run manifest` vs `npm run doctor`.
