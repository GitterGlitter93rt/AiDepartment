# Operational Brain Changelog

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
