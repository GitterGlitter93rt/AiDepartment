# Operational Brain Changelog

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
