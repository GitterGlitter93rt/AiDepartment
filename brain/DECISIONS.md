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
