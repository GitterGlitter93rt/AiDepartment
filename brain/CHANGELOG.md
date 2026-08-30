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
