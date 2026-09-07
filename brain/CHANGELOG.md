# Operational Brain Changelog

## 2026-09-07 — Failures that told nobody: one file for support, and seven quiet fail-opens

Offline work on `feature/outbound-sales-brain`. Nothing deployed, no call
placed, no prospect contacted, no provider credential used.

**One file to hand over.** Five operator reports already existed --
doctor, manifest, coverage, retention, preflight -- and an operator with
a broken system should not have to know which to run. But concatenating
them was not the point. The first thing anybody asks is "what was the
error", and not one of the five carried error text: they report counts,
and a count cannot say that a provider rejected a credential or that a
page returned HTML where JSON was expected. `npm run support` is one
file that carries the build, the state, the diagnoses, the row counts
and the recent errors.

Error text is also exactly where a secret leaks, so most of the tests
for it are about what it must not contain: a database driver's exception
carries the connection string, and a provider client puts the
Authorization header in its message. Both are redacted, along with the
service login -- half a credential, and often a person's email address.
The shell's own user name is deliberately *not* redacted, because it
appears in every file path an error quotes and blanking it would turn a
stack trace into nonsense. No company name, phone number, email address
or page content appears anywhere in the bundle. It is about the machine.

**Then the last audit, done by reading rather than running.** Every
finding below is a path where the system already behaved wrongly and
every test stayed green, because the wrong behaviour was to say nothing.

- **A spend ceiling written the way a person writes money was not a
  ceiling.** `DISCOVERY_DAILY_BUDGET_USD=$20` read through `Number()` is
  NaN, every comparison against NaN is false, and `!(NaN > 0)` is true
  -- so the guard reported the ceiling as *unset* and a 24/7 miner would
  spend the night against a limit somebody believed they had typed in.
- **The same coercion sat under the DNC snapshot staleness block and a
  webhook's replay window.** One typo could remove a money limit, a
  compliance limit or a replay defence, and each of them by staying
  quiet. Twenty-six numeric settings now go through one reader that
  refuses a value that is not a number, naming the variable and what it
  was set to. Unset still means the default; that part was deliberate.
- **Two dialects of "true", on the one flag that can ring a real
  phone.** `config` accepted `true`, `1` and `yes`; nine other places
  compared against the string `'true'`. Both read
  `OUTBOUND_DIAL_ENABLED`, so `=1` armed outbound dialling while the
  release manifest and the exposure preflight each reported it disabled.
  True of the code and false of the screen. One reader now, and a value
  neither a yes nor a no stops the process instead of being guessed at.
- **A retention plan dropped tables it could not read.** The plan is the
  artefact an operator approves, and a table that quietly vanished from
  the list is one nobody decided about. Named now, as unreadable rather
  than as empty.
- **A migration count nobody could read was reported as zero.** Zero
  shipped against forty-four applied reads as "the database is ahead of
  the build", which sends support after a migration that was never the
  problem.
- **A provider validation that ran no checks said OK.** Nothing reaches
  it today, which is exactly how it would have survived to the first
  validator that returns early.
- **A canary that could not read today's spend dropped the daily
  ceiling** instead of refusing. The comment said "reporting only"; two
  lines down the value decided a refusal.
- **A research run whose scoring failed reported COMPLETED.** The only
  trace was a console line on a box where nobody reads worker logs. It
  reports PARTIAL with a redacted reason now, on the job itself, where
  the doctor and the support bundle can see it.

**And one the audit found by running the tool it had just fixed.** The
doctor told an operator "the worker back-fills these on its sweep" for a
researched company with no score, and nothing did. Two sweeps exist --
one for companies with no research at all, one for scores under an older
ruleset -- and a company researched and then not scored fell between
them and stayed there, unranked, so no rep ever saw it. That gap is the
ordinary outcome of a scoring fault rather than an exotic one: scoring
runs after the research transaction commits on purpose, so that a
scoring fault cannot roll back a crawl.

The same finding had a second half. The doctor counted *every* Account
without a tier and described them as researched companies with no score.
On this box that was six companies nothing had ever looked at, paired
with an unrelated "1 has fresh research" -- an operator sent to fix a
scoring step that had never run for them. The finding now counts the
companies its advice applies to, and correctly disappeared.

The recurring shape, for the fourteenth time in this campaign:
configuration written down deliberately and never read by the runtime --
or, here, read in a way that could not fail. A guard that cannot fail
loudly is not a guard.

## 2026-09-05 — Production scale: eleven defects between 25,000 accounts and a rep's Monday morning

A scale, concurrency and data-integrity pass. Nothing deployed, no call
placed, no prospect contacted, no credential used.

Built first: a deterministic synthetic generator (25,000 and 100,000
accounts, 1.5M rows, 72 seconds), a query benchmark over the real read
models, and a demo fixture a person can walk. Everything generated is
unreachable by construction -- `.invalid` domains, 555 numbers,
SYNTHETIC_FIXTURE provenance -- and the generator refuses to run against
a database whose name does not say it is a scale target.

Defects found and fixed:

- **The claim ceiling did nothing under concurrency.** Eight
  simultaneous claims against a ceiling of three each locked a different
  Account row, each counted zero, and all eight succeeded. Bulk claim
  runs one transaction per Account by design, so a rep selecting two
  hundred rows took two hundred. Fixed by locking the rep's own row.
- **A promised callback could be left with nobody to keep it.** Release
  counts open callbacks in its transaction; recording one happens in
  another; and the ownership check read the Account without locking it.
  One race in twelve through the product path left an OPEN
  prospect-requested callback on an Account with no owner.
- **The analytics funnel could never report a connection.**
  contact_attempts.disposition was never written, and the funnel counts
  connections from that column. Fifty decision-makers reached, zero
  reported.
- **Contactable counted companies under DNC.** Account-scope suppression
  does not flip the endpoint rows, so a suppressed company sat at the
  top of the funnel.
- **A misaligned CSV row created a phantom company.** An unquoted comma
  shifts every column; the reject gate tested presence rather than
  usability, so all three garbage values passed and then failed
  normalisation. The Account landed with a name and no way to reach it,
  counted as created.
- **Confirming an import twice ran it twice.** The import runs inline in
  the request and a ten-thousand row list takes longer than a proxy
  timeout, so the rep presses again; the guard only checked CONFIRMED,
  which is set at the end.
- **A failed import blocked its own retry**, under a unique index on the
  file hash that a failed batch still held.
- **A `%` searched for everything.** LIKE metacharacters were unescaped:
  `%%` matched every Account and took ten times as long as a real term.
- **A ZIP found nothing.** postal_code was not searched at all.
- **The merge lock I added created a deadlock.** Completing a follow-up
  locked the child row first while a do-not-contact locked the Account
  first; the pair met head-on. Found by the offline dry-run matrix, not
  by a unit test.
- **The operations panel's "waiting on a reply" counted discovery as a
  reply**, because any activity satisfied it.

Performance, measured before and after: Find Prospects 1781 ms -> 161 ms
at 25k and 485 -> 65 at 100k; the audit page 505 -> 20 ms; the
Overview's recently-claimed 133 -> 3.4 ms. PostgreSQL was JIT-compiling
every page -- 148 ms of compilation on a query that then ran in 154 --
so JIT is off as a startup option. Six indexes, each because a measured
query was slow, each re-measured after.

Built: account merge with a tombstone that redirects, no unmerge and an
honest reason why; a lexical index over the Sales Manual scoring
precision@1 60% and recall@5 95% against a 21-query evaluation set; a
backup/restore drill that compares nine content checksums rather than
row counts; a storage projection from measurement (737 MB at 100k
accounts); and an operations panel answering the fourteen questions an
operator has on a Monday morning.


## 2026-09-04 — Release hardening: eight defects found in finished code

An adversarial pass over work that already had passing tests. Nothing was deployed,
no call was placed, no webhook changed and no switch was armed.

Defects found and fixed:

- **An oversized WebSocket frame killed the voice process.** `ws` raised "Max payload
  size exceeded" with no error handler attached, so on the deployed service one bad
  frame would have ended every call in progress, not just the offending one.
- **DataForSEO Standard mode could never return a result.** The adapter posted to
  `task_post` and normalised the acknowledgement as though it contained results. In
  the mode it defaults to, the provider answers with a task id; the results have to
  be collected afterwards. It would have found nothing on the day the credential
  arrived, while recording every run as OK.
- **A screened line type never reached the policy that reads it.** Twilio Lookup
  results were cached in `line_type_screen_results`, and channel eligibility reads
  `contact_endpoints.line_type`, which nothing wrote. A number identified as a
  personal mobile kept being evaluated as unknown, so the personal-mobile rule could
  not fire for anyone.
- **A correct phone number was rendered struck through.** The account page struck out
  any endpoint that was not currently callable, including a confirmed-current main
  line merely awaiting an eligibility check. Struck through reads as "this number is
  wrong", which invites a rep to correct a number that was right.
- **Contradicted evidence rendered as an ordinary signal.** A claim our own sources
  disagree with appeared as a neutral badge beside confirmed facts, so "Decision
  Maker Name" read as something known. It now renders as contradicted, with the
  instruction not to state it.
- **A booking the provider never confirmed appeared on no tab.** Upcoming means
  confirmed, and the attention tab covered no-shows and cancellations. A booking
  stuck in PENDING — provider timeout, webhook never delivered — was invisible to
  everyone while the prospect may have been told an invite was coming.
- **Unscored was styled as tier D.** Not-yet-researched was coloured as
  judged-and-found-poor, which is backwards: an unresearched advertiser is the one
  worth looking at.
- **The audit page could not answer who took an Account.** Ownership is recorded in
  its own append-only ledger; the review surface read only `audit_log`. The two are
  now unioned for reading, without duplicating either write.

Added: a signed Smartlead webhook transport (HMAC over the raw bytes, timestamp
inside the signed material, provider event id for idempotency); the hook experiment
report on /analytics with explicit insufficient-evidence behaviour; breadcrumbs on
the account page; `rollback.sh` and `OPERATOR.md` for the outbound voice deployment;
and a Vultr-console key bootstrap that never generates or prints a private key.

Still blocked: SB-B8, SSH access to the voice VPS. Everything else in that path is
written, reviewed and tested offline.


## 2026-08-30 — Production tracking audited and Facebook identity started

- Confirmed production Google Tag Manager container GTM-5G8Q7KKZ and GA4 stream G-GLSRPH43L4 from the supplied GTM workspace screenshots and live site.
- Recorded Google tag GT-5TQWWPV2 and Google Ads AW-1839535359.
- Verified the live chooser, free 15-question assessment, $495 comprehensive audit, and booking-confirmation route.
- Recovered the assessment dataLayer code from the sprint12 branch and verified the newer production JavaScript.
- Confirmed that ordinary GA4 page views already cover the new routes through the sitewide Google tag.
- Identified three missing GTM/GA4 listeners: ai_assessment_lead_submit, booking_click_comprehensive_audit, and booking_confirmed.
- Recorded that paid_audit_request_submit belongs to an older, non-production form flow and should not be added to current GTM.
- Detected a source-control drift: production includes fixes and Cal.com behavior not present at the known GitHub heads.
- Created and stored Facebook profile and cover Concept 01 under assets/social/.
- Michael rejected Concept 01; recovered the earlier #2 YAD/YAI/Y Facebook and brand-kit assets from 2026-08-29 and made those the active design source.
- Michael selected the Gradient Y Facebook Page Setup Branding Guide direction; prepared exact 1024 × 1024 profile and 1702 × 630 cover uploads plus final Page copy under `assets/social/facebook-page/`.
- Added brain/TRACKING.md as the production measurement source of truth and corrected the roadmap/website assumptions.

## 2026-08-30 — Shared project brain established

- Created the versioned operational brain and made brain/TODO.md the execution source of truth.
- Recorded the current business and Astro/SiteGround architecture.
- Explicitly marked the early WordPress/GeneratePress V1 direction as superseded.
- Recorded the concept of separate short and long AI assessments and the then-unresolved routing/specification decisions.
- Audited the older Aug. 14 main head for tracking references; none existed at that head.
- Seeded launch priorities for assessment reconciliation, funnel routing, GTM, GA4, Meta Pixel, event design, attribution, creative, and campaign planning.
- Added EdgeXpert, AI Ad Brain, and cross-agent working context.
- Added start/end update protocols so Claude Code, GLM/OX, Codex, and humans maintain the same state.

## 2026-09-03 — Outbound Sales Brain / internal sales portal

Built the canonical prospect foundation and the internal sales portal on the EdgeXpert, working
through gates T0–T8 of `docs/09-software/CLAUDE-CURRENT-TASK.md`. Full detail, including every
defect found and how each gate was verified, is in `docs/09-software/IMPLEMENTATION-LOG.md`.

- **One canonical Account model** in `services/sales-brain` — 36 tables, not a second lead database
  beside `phone-agent/`. Ownership, suppression, evidence immutability and booking confirmation are
  enforced by database constraints and triggers, so a later application bug cannot route around them.
- **Rep portal** at Overview / Find Prospects / Markets / My Prospects / Account detail / Follow-Ups
  / Team, server-rendered on the existing YAD design tokens. Claim is atomic: eight simultaneous
  claimers produce one owner and one audit event.
- **Public-first decision-maker resolver** — Apollo is not required. All 13 canonical fixtures pass,
  and routing follows problem ownership rather than seniority.
- **Strategy-call booking** that cannot claim a meeting is confirmed without a provider event id.
- **Cold-call brain** built from Module 4A doctrine, exercised entirely as text roleplay. No dialling.
- **Smartlead preparation** so email replies land in the same Account memory as phone and field.

152 automated tests pass. `deploy/preflight.sh` reports 18 passed, 1 warning, 0 failures.

Nothing has contacted a real prospect. `OUTBOUND_DIAL_ENABLED` and `OUTBOUND_EMAIL_ENABLED` are
both false, and the preflight check fails if either changes.

Five things now need Michael, tracked as SB-B1 to SB-B5 in `brain/TODO.md`: an Azure app
registration for calendar booking, the real prospect lists, source-governance sign-off plus a search
provider, HTTPS for `sales.youraidepartment.ai`, and a Smartlead key.

## 2026-09-05 — Overnight miner hardening (GitHub Issue #3)

Thirteen commits on `feature/outbound-sales-brain`. Suite 1311/1311, and identical in reverse file
order. Typecheck, build and `npm audit --omit=dev` clean throughout. Migrations 040 and 041.

Six defects that passing tests did not show, each found by asking a question the existing tests did
not ask:

- **Every company in one search collapsed into one Account.** The adapter fell back to the provider's
  *search task* id when a SERP row carried no id of its own, and account resolution matches provider
  identity before domain or phone. A twenty-result market search would have produced one prospect,
  reporting the other nineteen as "already in inventory". Invisible to every existing fixture,
  because they all set `advertiser_id` — a field real SERP rows do not carry.
- **One PENDING provider answer retired a saved market for ever.** The scheduler skipped markets with
  an outstanding task; collection happens inside the job it was refusing to queue. Found only by a
  thirty-day simulated rehearsal.
- **A paid ad's headline was becoming the company name** in the rep's list.
- **The daily spend ceiling refused to collect searches already paid for**, and only protected
  providers honest enough to record their own spending.
- **Find Prospects claimed aged research on a market nobody had researched**, and told the rep to
  treat as historical the advertising signals we had never looked for.
- **`create table if not exists` races itself**, so on a fresh install — a first SiteGround boot —
  the API and worker migrating together could leave one process dead with an error naming an
  internal PostgreSQL catalogue index.

Built alongside them: score policy versioning with a resumable recompute and full lineage from
score to rule to evidence to provider; a realistic provider replay through the real registry and
global fetch; an eighty-company golden market; a thirty-day shadow rehearsal; registration parity
as an enforced invariant; build identity on the worker heartbeat so version skew is visible;
`npm run preflight` and `npm run growth`, both of which refuse to answer what they cannot check.

Five pieces of configuration were found written down carefully and never read by anything — the
search taxonomy, the signal-to-score map, the business-model fields, the observation provenance
columns, and `retention_class`. The pattern is worth naming: this codebase writes down more than it
consults.

Still not `MINER_LIVE_CANARY_READY`. Nothing was deployed, no live provider was called, no prospect
was contacted, and `OUTBOUND_DIAL_ENABLED` remains false.

