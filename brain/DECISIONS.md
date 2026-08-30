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
