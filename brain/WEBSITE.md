# Website, Funnels, Tracking, and Deployment

**Snapshot date:** 2026-08-30  
**Main head before this update:** be9ff47c9c7fefda9c6d86fc6b31b25cf8249c2e  
**New-funnel branch inspected:** sprint12-industry-content-expansion at 989ee8a9a0b94b39a5bb46a7c5bdedfb3b34629f  
**Production checked:** 2026-08-30

## Current architecture

- Custom Astro website; do not revert to the older WordPress/GeneratePress plan for V1.
- TypeScript, Astro ^7.2.0, Node >=22.12.0.
- Static output with https://youraidepartment.ai as the canonical domain and trailing-slash URLs.
- Production is served through Cloudflare in front of SiteGround.
- Global layout: src/layouts/BaseLayout.astro.
- Central scheduling, site, attribution, and analytics helpers live under src/lib/ and src/components/.
- GTM loads once through BaseLayout and routes GA4/Google Ads measurement.

## Confirmed live assessment and audit architecture

| Route | Role | Current state |
|---|---|---|
| /ai-assessment/ | Public chooser | Live; routes visitors to the free short assessment or the $495 audit |
| /free-ai-assessment/ | Short top-of-funnel assessment | Live; 15 questions, about 3–4 minutes, contact gate, score/results |
| /comprehensive-ai-business-audit/ | Paid long-form audit offer | Live; $495, Cal.com booking/payment CTA, personalized audit/report/review |
| /ai-assessment/full/ | Underlying 64-question engine | Present in the funnel branch; internal/noindex, not a public free substitute |
| /booking-confirmed/ | Cal.com return signal | Live; emits booking_confirmed only when the booking UID contract is present |

The short assessment emits a shared assessment event family distinguished by assessment_type and assessment_version. See brain/TRACKING.md.

## Production/source synchronization warning

The exact live build is not fully represented by either current main or the inspected funnel branch:

- Current main contains the newly added operational brain but is based on the older Aug. 14 Sprint 8 website source.
- The sprint12-industry-content-expansion branch contains the new assessment/audit architecture and tracking foundation.
- Production contains later fixes/changes not present at that branch head, including the corrected quick-assessment start handler, a Cal.com-based $495 audit page, and booking_click_comprehensive_audit tracking.
- The inspected branch still contains an older on-site audit-request form and paid_audit_request_submit event.

Therefore, do not overwrite the assessment/audit pages from current main or the older branch. First commit and push the exact deployed source from the EdgeXpert/deployment workspace, then reconcile the operational brain into that source line.

## Tracking state

Confirmed:

- GTM-5G8Q7KKZ is sitewide.
- GA4 G-GLSRPH43L4 is configured through GTM.
- Google tag GT-5TQWWPV2 and Google Ads AW-1839535359 are shown in GTM.
- Baseline page views cover the new routes.
- The site emits start, complete, lead-delivery, booking-click, and booking-confirmation events.

Incomplete:

- GTM lacks visible listeners/tags for ai_assessment_lead_submit, booking_click_comprehensive_audit, and booking_confirmed.
- Meta Dataset/Pixel is not yet identified or installed in the supplied workspace.
- GTM Preview, GA4 DebugView, attribution, and duplicate-event QA still need an end-to-end controlled test.
- Server-verified Cal.com webhook tracking is documented but not implemented.

Exact details and the test plan are in brain/TRACKING.md.

## Known conflicts to resolve

1. The GitHub default branch is behind the deployed website source.
2. Some canonical scheduling documents refer to Calendly while production now uses Cal.com.
3. Older assessment documents assume one public assessment; production now has a short free assessment and a paid comprehensive audit path.
4. The long 64-question engine must remain protected/internal until its paid-customer authorization flow is explicit.
5. Meta tracking and consent behavior remain unresolved.

## Verification checklist

- Commit the exact deployed source and identify its commit SHA.
- Reconcile main, the sprint12 branch, and production without losing deployed fixes.
- Run the full tests and production build.
- GTM Preview/Tag Assistant shows one intended container and correct triggers.
- GA4 DebugView shows the approved event sequence and parameters.
- Meta Pixel Helper and Events Manager show approved events after Pixel installation, without duplicates or prohibited data.
- One controlled test lead preserves campaign attribution through the destination system.
- Assessment refresh/resume/back behavior does not create false starts or completions.
- A real test Cal.com booking returns through the confirmed URL contract.
- Staging does not pollute production analytics or become indexed.

## Canonical references

- CLAUDE.md
- brain/TRACKING.md
- brain/AI-ASSESSMENTS.md
- docs/02-website/website-build-spec.md
- docs/02-website/technical-seo-spec.md
- docs/02-website/scheduling-and-booking.md
- docs/04-assessment/consent-and-data.md
- docs/cal-booking-webhook.md on the funnel branch
