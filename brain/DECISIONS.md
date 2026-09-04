# Your AI Department — Decision Log

**Last reviewed:** 2026-08-30

This file records material decisions that agents must not casually reverse. Detailed canonical specifications remain authoritative. A proposal is not a decision until Michael approves it.

## Approved decisions

| ID | Date | Decision | Source / implication |
|---|---|---|---|
| DEC-001 | 2026-07 | YourAIDepartment.ai is the authority domain; HireAnAIDepartment.com is a campaign/redirect domain, not a competing duplicate site. | docs/00-company/launch-decisions.md |
| DEC-002 | 2026-07/08 | V1 is custom coded with Astro/TypeScript, static-first, and deployable to SiteGround. The older WordPress/GeneratePress direction is superseded for V1. | CLAUDE.md; docs/02-website/website-build-spec.md; current code |
| DEC-003 | 2026-07 | The free AI Department Assessment is the primary public diagnostic; Executive AI Strategy, AI Implementation, AI Growth Systems, and Managed AI Department form the core commercial ladder. | docs/00-company/launch-decisions.md |
| DEC-004 | 2026-07 | Deterministic rules control assessment scores, flags, recommendation eligibility, and ROI prerequisites. AI may explain established results but may not invent or override them. | docs/04-assessment/implementation-spec.md |
| DEC-005 | 2026-08 | Calendly is the approved V1 scheduler. Stripe is approved for the $750 Executive AI Advisory Session. Exact URLs/embedding and several policies remain unresolved. | Scheduling addendum in docs/00-company/launch-decisions.md and docs/02-website/scheduling-and-booking.md |
| DEC-006 | 2026-08-30 | The assessment architecture now needs two experiences: a short, lower-friction assessment and a long, deeper diagnostic assessment. | Michael's project direction. Scope is approved; detailed routing remains open under ASM-001. |
| DEC-007 | 2026-08-30 | The GitHub AiDepartment repository is the durable shared project brain for ChatGPT/Codex, Claude Code, GLM/OX, and human collaborators. Chat threads and machine-local model memory are supporting context, not the task database. | brain/README.md and agent instructions |
| DEC-008 | 2026-08-30 | brain/TODO.md is the execution source of truth. A separate ChatGPT roadmap thread may display or discuss it, but does not replace it. | Operational decision |

## Approved source-of-truth order

1. docs/00-company/launch-decisions.md
2. Approved internal strategy under docs/00-company/
3. Assessment specifications under docs/04-assessment/
4. Product definitions under docs/03-products/
5. Public website specifications/copy under docs/02-website/
6. Operational state and approved newer decisions in brain/
7. Older planning/research and chat history

When a newer approved decision in this log changes an older canonical document—such as the short/long assessment split—the task is to reconcile the canonical document, not to leave two permanent truths.

## Proposed or unresolved — not approved implementation decisions

- Whether /ai-assessment/ becomes the short assessment, remains the long assessment, or becomes a chooser/landing route.
- Exact short-assessment questions, scoring, lead gate, result depth, and handoff.
- Exact long-assessment route and whether the existing assessment_v1 becomes an explicitly named long version.
- GTM container/account structure, consent platform, Meta CAPI architecture, CRM, and lead backend.
- First paid campaign vertical, geography, budget, audience, creative mix, and optimization event.
- Production deployment workflow and deployed commit.

Do not turn any item in this section into production behavior without approval and documentation.

## 2026-09-03 — Outbound Sales Brain implementation decisions

Decisions taken during gates T0–T8 that a future agent should not silently reverse. Each follows
from an approved specification; where a specification left a choice open, the reasoning is recorded.

### The sales portal is a separate package, not part of the Astro site

`services/sales-brain` is its own Node package. The marketing site is static-first and deploys to
SiteGround; the portal needs a long-running authenticated process, a database and background workers
on the EdgeXpert. Fusing them would break the marketing site's deployment model and put an internal
application behind a public build.
**Authority:** `CLAUDE.md` static-first principle; `CLAUDE-SALES-PORTAL-START-PROMPT.md` §8.2.

### PostgreSQL runs in Docker, not from apt

The EdgeXpert has no passwordless sudo, but the user is in the `docker` group. Postgres 16 runs as a
container bound to `127.0.0.1:5432` with a named volume and `restart: unless-stopped`. This was a
constraint of the machine, not a preference.

### Server-rendered HTML, not a SPA

The portal is dense but barely stateful. A React/Vite chain would add dependency surface on an
internal box for no user-visible gain. One 296-line vanilla file adds selection, claiming and the
drawer; every page and primary action works without it.

### Invariants live in the database, not only in application code

Ownership consistency, suppression propagation, evidence and ownership-history immutability, Call
Pack immutability, and the rule that a booking cannot be `CONFIRMED` without a provider event id are
all enforced by constraints and triggers. The hard-fail lists in the specs describe outcomes too
serious to depend on a code path staying correct.

### Systemd *user* services with linger, not system units

No passwordless sudo means no system units. User services with linger survive logout and reboot.
Revisit only if root access becomes routinely available.

### A discovery adapter must be BOTH credentialed AND governance-reviewed

`availableDiscoveryAdapters()` requires both. A configured but unreviewed source cannot run by
accident. This is stricter than "has an API key" on purpose.
**Authority:** `market-miner-source-governance-review-template.yaml`.

### An unreadable calendar offers zero slots

When availability cannot be read, the booking service returns no times and honest words, rather than
falling back to a default schedule. An offered time that has not been verified becomes a broken
promise made on a live call.

### An email unsubscribe is email-scoped by default

It does not silently become an account-wide phone DNC. Widening the scope is an explicit policy
decision, not a model's reading of a reply.
**Authority:** `outbound-sales-brain-smartlead-sync-spec.md` §8.

### `phone-agent/` was left intact and unreferenced

Its Twilio relay belongs to `voice.youraidepartment.ai`. Its flat `leads` schema and in-memory store
are superseded by the canonical model rather than forked into a second lead database. Nothing was
deleted; the voice track will be repointed at the canonical database when it resumes.

### Repository fix: `hvac.v1.yaml` did not parse

`primary_hook_template` contained an unquoted `": "`, which YAML read as a nested mapping. Quoting
the scalar changed no semantics. Every other `docs/**/*.yaml` was swept for the same shape.

### A rate is never shown without the population it came from

Analytics prints "50% (1 of 2)", not "50%". The same percentage off two calls and off
two hundred are different facts, and a table showing only the percentage makes them
look identical. Below the minimum-attempt floor the opener comparison names no
leader, prints no ranking and gives no ordering that could be read as one. Promotion
readiness is a separate, stricter question from comparability, because reading a
report is not the same as acting on it.

### Endpoint quality and permission to dial are separate axes, including visually

Struck-through means the value itself is wrong: a wrong number, a disconnection, a
hard bounce. A correct number that is merely waiting on an eligibility check is shown
plainly, with the block said by a badge, a note and a missing action. Defacing a
correct number invites a rep to "fix" it, which corrupts the data we were protecting.

### Not-yet-known is never styled as judged-and-found-poor

Unscored gets its own treatment rather than tier D's, and a claim our own sources
contradict gets its own rather than a neutral one. An unresearched advertiser is the
prospect worth looking at, and a contradicted owner name is the one thing that will
end a call in the first sentence.

### A booking that is not confirmed must be visible somewhere

"Confirmed only when the provider confirms" is half a rule. The other half is that a
booking stuck waiting on the provider appears on the attention tab once it is past
the in-flight window, because we may already have told the prospect an invite was
coming. Silently invisible is worse than either state.

### Ownership stays in its own ledger, and the audit view reads both

Claims, releases and reassignments are written to `ownership_events`, not duplicated
into `audit_log`. The audit page and the account history union the two for reading, so
"who took this Account" is answerable without a second write path that could drift
from the first.

### A queued provider task is not a result

An adapter that posts a task must collect it. DataForSEO Standard mode answers with a
task id; treating that acknowledgement as an empty result set is indistinguishable
from a market with no advertisers in it, and records the run as a success. The poll is
bounded by configuration and its outcome — collected, still queued, or errored — is
recorded either way.

### A provider webhook is authenticated by signature over the raw bytes

Not by knowing the URL, and not over a re-serialised object: re-serialising changes
key order and whitespace, so the check then fails legitimate requests, and the first
response to that is to turn the check off. The timestamp is inside the signed material
and outside a tolerance window a captured request is refused, so a valid signature is
not a permanent credential. An unverified payload never reaches ingestion.

### A screening result that no policy reads is not a control

Twilio Lookup writes its answer onto the endpoint that channel eligibility actually
reads, only on success. A failed lookup writes nothing rather than overwriting a type
we had already established, because an outage must never become a line type.
