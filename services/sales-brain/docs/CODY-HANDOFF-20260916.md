# Sales Brain — session handoff, 2026-09-16

Written at the end of the Michael/Claude session, immediately before switching Claude
accounts. **Nothing is deployed in this session.** Production is untouched and healthy.

The one thing to read first: **two full test suites are still running in detached
Docker containers.** They survive session and profile switches. Do not rerun them
until you have looked at their results.

```bash
ls -la /home/roothecks/.yad-sprint-work/R1-reverse.done \
       /home/roothecks/.yad-sprint-work/R2-combined.done
grep -E '^# (tests|pass|fail)' /home/roothecks/.yad-sprint-work/R1-reverse.tap
grep -E '^# (tests|pass|fail)' /home/roothecks/.yad-sprint-work/R2-combined.tap
grep -E '^not ok ' /home/roothecks/.yad-sprint-work/R*.tap
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'R1-reverse|R2-combined'
```

`*.done` contains `exit=N`. Require `exit=0` **and** `# fail 0`.

---

## PRODUCTION (read-only baseline, 2026-09-16 ~20:00 EDT)

| Item | Value |
|---|---|
| Worktree | `/home/roothecks/YAD-Sales-Brain` (git worktree, **locked**) |
| Branch | `feature/outbound-sales-brain` |
| HEAD | `d856bcec74ba1be7a9ba3986a711fc440178fd06` |
| Tree | `afba88ad0364d589a160918da211dffd7d52cdde` |
| Dirty | 0 |
| Units | `yad-sales-api.service`, `yad-sales-worker.service` (systemd **--user**) |
| Both active since | 2026-09-16 13:28:50 EDT |
| `/healthz` | 200 `{"status":"ok","database":"ok","outboundDialEnabled":false}` |
| Worker heartbeat | current (8s old at baseline) |
| Schema | 52 migrations, latest `052_search_plan_preview.sql`, 78 public tables |
| Accounts | 320 (all live, none merged) |
| Users | `michael@youraidepartment.ai` ADMIN active; `cameron@youraidepartment.ai` **SALES_REP active** |
| saved_markets | 0 rows |
| provider_tasks | COLLECTED 44, ABANDONED 5 (the 5 quarantined — untouched) |
| jobs | 412 SUCCEEDED, **0 queued, 0 running** |
| DataForSEO balance | **$50.745** (pre-deploy baseline; must not move on deploy) |
| Postgres | Docker container `yad-sales-postgres`, volume `yad_sales_pgdata` |
| Backup taken | `~/yad-sales-backups/yad_sales_20260917T000152Z.sql.gz` (964K, 77 tables, verified) |

Human sales activity across all 320 Accounts: **0**. Every activity row is
system-generated (`DISCOVERED`/`RESEARCHED`/`SCORE_CHANGED`/`CONTACT_ENRICHED`/
`SOURCE_OBSERVED`). No Account has ever been called, emailed, visited or noted by a
person. That makes later remediation much safer — but remediation is **not** this
release.

---

## WHAT IS READY TO SHIP (nothing deployed yet)

### Release 1 — provider collection priority

- Branch `fix/provider-collection-visibility`
- SHA `32abae6d0fedb73d165d15d57f4097fd4a9ee03a`
- Tree `c4234dc12cf7e61918f375de50eb4a92964d28ee`
- Worktree `/home/roothecks/YAD-Sales-Brain-collect`, clean, pushed

Touches exactly three files: `src/workers/enqueue.ts`,
`src/workers/providerTaskSweeper.ts`, `tests/collectionPriority.test.ts`.

Behaviour: collecting a provider answer **already paid for** is queued at priority
`PROVIDER_COLLECTION_PRIORITY = 30`, ahead of `contact_research` (40) and
`account_research` (50), while an ordinary `market_mine` stays at 80. Measured in
production before the fix: five collect-only jobs created in one sweep started at
19:40, 19:47, 19:50, 19:52 and 19:54 — the last waited **16m23s**, because each
collection queues an account_research job per new company and those outranked the
collections still waiting. Priority is derived inside the claiming transaction and
set at insert; a queued pre-fix collection is promoted with `least()` so promotion can
never make a job less urgent. It changes ordering only — it can never buy anything.

Qualification: targeted 263/263, forward **2101/2101**, check PASS, build PASS,
`npm audit --omit=dev` 0 vulnerabilities.
**Reverse/isolation against tree `c4234dc` was missing** and is what `R1-reverse` is
running now. (`final-isolation2.tap`, 2095/2095, is from 17:39 and predates the 17:56
freeze — it qualifies an *older* tree. Do not count it.)

### Release 2 — rep portal readiness (contains Release 1)

- Branch `fix/rep-portal-readiness`
- **FINAL_RELEASE_2_SHA = `3e4a2820afdaf2ef3b1490bad99e849bb08372ef`**
- **FINAL_RELEASE_2_TREE = `ba981392969e60cc93dabcb7f25389163aef1740`**
- Worktree `/home/roothecks/YAD-Sales-Brain-rep`, clean, pushed

`3e4a282` = `ea4b390` (rep work) + a clean cherry-pick of Release 1. The three
Release 1 files were byte-verified identical to `32abae6d`. `check` PASS, `build`
PASS, `npm audit --omit=dev` **0 vulnerabilities**.

What it contains, rep-facing:

- **Markets inventory** — Available Inventory derived from Account provenance joined
  to `prospect_inventory`; legacy/unverified cards rendered dashed with **no Browse
  button**. Page renders with 0 saved markets.
- **City search P0** — `/api/mining/plan` forwarded `geography.value` and dropped
  `geography.state`, so "Orlando, FL" was sent to the planner as bare "Orlando" and
  came back "Which Orlando? Add the state". Fixed with a canonical `geographyInput()`
  rejoin helper in `src/miner/geography.ts`.
- **Research-state truth** — `FetchFailureReason` (tls/dns/timeout/refused/http/fetch)
  separated from `blockedReason`; a non-ok HTTP response is now always recorded as a
  blocked page; the crawl stops on every failure reason **except** `http_error` (a 404
  on `/about` should not end the crawl). `researchCompleteness` caps at `THIN` when a
  run fetched 0 pages and blocked > 0, instead of reporting `GOOD`.
- **Vertical relevance** — the miner used to stamp `job.payload.vertical_profile_id`
  onto every Account it created, so "U-Haul Locations in Miami, FL 33127" (organic,
  position 51, no provider category) became an HVAC prospect *because of the question
  we asked*. Now a trade is only asserted from evidence about the business.
- **Junk / non-business gate** — the classifier already existed and promotion ignored
  it. Only `BUSINESS_LISTING` and `OFFICIAL_SITE` may become an Account; `UNKNOWN` is
  refused too. Refusals are written back to `discovery_candidates` with reasons.
- **Canonical naming** — the Account takes the resolver's defensible name instead of
  the provider's page title: "Southern Air", not
  "Southern Air | AC Repair & Installation in Orlando FL | Call Now".
- **Email classification** — `donations@`, `investor_relations@`, `credit_department@`,
  `trucksales@` etc. were all labelled "Personal work email". Shape may now describe a
  mailbox; only evidence (`attributedToPersonName`) may make it a person.
- **Endpoint ranking** — the drawer ordered by `endpoint_role` alone, so a
  DISCONNECTED direct line outranked a confirmed main line and a suppressed endpoint
  sat mid-list. Now usability, then role, then how well the value is evidenced;
  `CALL_TRACKING_NUMBER` ranks below the company's own lines.
- **Advertising semantics** — "—" meant both "nobody looked" and "we hold evidence and
  they do not advertise". `prospect_inventory` builds these with `bool_or`, and
  `bool_or` over no rows is NULL, so the two were always distinguishable and nothing
  read it. Now renders **Not checked** vs **None seen** vs actual channels.
- **Company search** — `like '%term%'` on name/domain only. "Del Aire" could not find
  "Del-Air Heating & Air Conditioning". Now punctuation-insensitive **plus** per-word
  prefix matching in either direction, plus phone (digits-only) and email lookup via
  `contact_endpoints`.
- **SALES_REP RBAC** — proved at the HTTP boundary: a rep browses markets and searches,
  and is refused `/api/mining/plan` and `/api/mining/jobs` with 403 **before** body
  validation, with nothing written on the way to the refusal.

---

## DEPLOY PLAN — EXACT STEPS, NOT YET EXECUTED

### Critical constraint discovered

`services/sales-brain/deploy/assert-runtime.sh` pins `EXPECTED_BRANCH=feature/outbound-sales-brain`
and the services refuse to start from any other branch. **Deploying means
fast-forwarding that branch — never checking out a release branch.**

Verified fast-forward paths:

- `d856bce` → `32abae6d` — **YES**, clean fast-forward.
- `d856bce` → `3e4a282` — **YES**, clean fast-forward.
- `32abae6d` → `3e4a282` — **NO.** The cherry-pick made a new SHA, so once production
  is at Release 1, `--ff-only` to `3e4a282` will refuse.

**Fix for that, no force push and no history rewrite:** after Release 1 is live, in
`/home/roothecks/YAD-Sales-Brain-rep` run `git merge 32abae6d`. The content is already
identical, so the merge produces the **same tree `ba98139`** — meaning the R2-combined
qualification still applies — while recording `32abae6d` as a real ancestor so the
production fast-forward is legal. Verify with
`git rev-parse HEAD^{tree}` = `ba981392969e60cc93dabcb7f25389163aef1740`, then push
(fast-forward) and use that merge SHA as the deployed Release 2 SHA.

### Phase 1 — Release 1

1. Confirm `R1-reverse.done` is `exit=0` and `# fail 0`.
2. Backup: `cd /home/roothecks/YAD-Sales-Brain/services/sales-brain && bash deploy/backup.sh`
3. `cd /home/roothecks/YAD-Sales-Brain && git merge --ff-only 32abae6d`
4. `cd services/sales-brain && npm run build`
5. `systemctl --user restart yad-sales-worker.service` then
   `systemctl --user restart yad-sales-api.service` (worker first, then API)
6. Validate: `/healthz` 200; worker heartbeat current; `PROVIDER_COLLECTION_PRIORITY`
   30 / contact_research 40 / account_research 50 / market_mine 80; **no
   deployment-generated `task_post`**; DataForSEO balance still `$50.745`.

No migration expected — the test DB and production both sit at 52 migrations / 78
tables. Do **not** restart Docker, Postgres, Cloudflare or BodyShop Automate. A short
API restart is authorized; active portal sessions are not a blocker.

### Phase 2 — Release 2

1. Confirm `R2-combined.done` is `exit=0` and `# fail 0` (tree `ba98139`).
2. Do the `git merge 32abae6d` ancestry fix above; confirm the tree is unchanged.
3. Backup again. Confirm production is at Release 1.
4. `git merge --ff-only <merge SHA>`, `npm run build`, restart worker then API.
5. Live validation, **without buying any provider search**:
   - HVAC + "Orlando, FL" and "Miami, FL" reach a valid city preview; bare "Orlando"
     still asks for the state. **Do not click the final paid confirmation.**
   - Markets renders Available Inventory with 0 saved markets; legacy inventory stays
     visually separated and unbrowsable.
   - Company search: "Del Aire" / "Del-Air" where matching data exists.
   - No department/general mailbox renders as "Personal work email".
   - Advertising shows Not checked / None seen / real channels.
   - Vertical integrity: inspect existing records and read models. **Do not create a
     paid test search to prove it.**
   - Cameron still SALES_REP, active, server-side restrictions intact. No impersonation.

---

## WHAT MUST NOT BE DONE IN THIS RELEASE

- **Do not mass-clean the existing 320 Accounts.** Do not delete U-Haul, do not
  rewrite old verticals, do not rewrite old canonical names, do not rewrite historic
  endpoint classifications. Prevention ships now; remediation is a separate, later
  piece of work.
- No new provider, no Stage D, no CEO-email searches, no multi-vertical schema, no
  mining redesign, no automated outbound.
- `RESEARCH_ALLOW_PRIVATE_ADDRESSES` is **test-harness only** and must never be set in
  production.
- Never print the Cloudflare tunnel token or dump container command lines containing
  it.

---

## KNOWN PRODUCTION DATA DEBT

- Accounts whose vertical came only from an organic ranking (~170 at the 283-Account
  audit) and from `local_result` (~51). The new code stops this happening; the
  existing rows are unchanged.
- 66 legacy Roofing Accounts, shown but honestly labelled.
- ~17 Accounts with no domain, likely junk.
- Canonical names taken from SEO page titles on older rows.
- Endpoint role classifications persisted before the email fix.
- 5 quarantined `provider_tasks` (ABANDONED) — deliberately untouched:
  `09111841-…`, `09111745-…ae17`, `09111744-…d590`, `09111744-…8f16`, `09111743-…aa98`.
- **0 Accounts have human sales activity**, which is what makes remediation safe later.

---

## GIT STATE AT HANDOFF

| Worktree | Branch | Local SHA | Remote | Dirty |
|---|---|---|---|---|
| `YAD-Sales-Brain` (locked, production) | `feature/outbound-sales-brain` | `d856bce` | in sync | 0 |
| `YAD-Sales-Brain-rep` | `fix/rep-portal-readiness` | `3e4a282` | in sync | 0 |
| `YAD-Sales-Brain-collect` | `fix/provider-collection-visibility` | `32abae6d` | in sync | 0 |
| `YAD-Sales-Brain-enrichment` | `feature/sales-brain-rep-enrichment` | `523d8da` | in sync | 0 |

All useful work is pushed. Other worktrees (`-baseline-check`, `-collector-fix`,
`-marathon`, `-p0-entity-resolution`, `-readmodel-fix`, `AiDepartment-portal-test`)
are older and were left alone deliberately — do not delete them for tidiness.

The enrichment branch `523d8da` is qualified and pushed but **not deployed** and not
part of this release train.

---

## NEXT PRIORITIES AFTER THE TWO DEPLOYS

1. Existing-Account remediation preview/reprocessor (read-only preview first).
2. Mining page reorganisation (tabs, two status columns, provider truth) — the one
   Release 2 item deliberately left out, because it is operator-facing rather than
   rep-facing and starting it would have reopened the freeze.
3. First-party physical location enrichment.
4. Sunbright/DBPR/public-record relationship graph.
5. Stage-D Google/DataForSEO decision-maker research.
6. Named CEO/owner email research.
7. 100-Account contact-enrichment experiment.
8. Multi-vertical data model — recorded as **SB-VERT1, P1 debt** in `brain/TODO.md`.
   `accounts.primary_vertical_profile_id` is the only storage, so a company that
   genuinely does plumbing *and* HVAC can only be recorded as one. Do not report
   multi-vertical as solved until storage **and** the Find/Markets read models can
   represent and retrieve both.
9. Enrichment branch integration/deployment.

---

## STANDING RULES (carried forward, non-negotiable)

- Query geography ≠ physical location.
- Query vertical ≠ business vertical.
- SERP title ≠ company name.
- Company-domain email ≠ named person.
- License qualifier ≠ owner.
- Registered agent ≠ owner.
- A Google search result ≠ a verified fact.
- Raw evidence must survive.
- Rep-visible facts require defensible evidence.

---

## OUTSTANDING SECURITY ACTION

**The Cloudflare tunnel token was exposed earlier in this project** (printed via a
container command line) and **has not been rotated.** This is not a coding task and
should be done deliberately, outside a sprint.

---

## HOW TO RERUN A SUITE (isolated, mandatory pattern)

Never run DB-backed qualification against production Postgres. Use a temporary Docker
network plus `postgres:16-alpine` with generated credentials and **no published
ports**, `DATAFORSEO_ENABLED=false`, outbound/Twilio/Smartlead unset. Mount the
worktree, the shared `node_modules`
(`/home/roothecks/YAD-Sales-Brain/services/sales-brain/node_modules`, which is what the
per-worktree symlink points at) and `/home/roothecks/AiDepartment/.git` read-only —
without the gitdir, `backupValidator`'s runtime-guard test fails for want of a branch
name, which is an environment artifact and not a product failure.

Two traps found the hard way:

- Expand `tests/*.test.ts` **inside** the container (`sh -c '…'`). Expanded on the
  host it globs against the wrong worktree.
- `TaskStop` does not necessarily kill the `docker run` container it started. An
  orphaned runner survived, reconnected to a recreated Postgres of the same name and
  produced `deadlock detected` (40P01) across an entire "authoritative" run. Those
  were contention, not product failures. Always
  `docker ps | grep node:22` before trusting a suite result.
