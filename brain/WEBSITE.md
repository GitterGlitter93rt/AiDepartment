# Website, Funnels, Tracking, and Deployment

**Snapshot date:** 2026-08-30  
**Repository head inspected:** 648da9d8b9aa62c1a9bfc38a533bac8452e0ab0f (Aug. 14 Sprint 8 merge)

## Current architecture

- Custom Astro website; do not revert to the older WordPress/GeneratePress plan for V1.
- TypeScript, Astro ^7.2.0, Node >=22.12.0.
- astro.config.mjs uses static output, https://youraidepartment.ai as the canonical site, and trailing-slash URLs.
- Intended production host: SiteGround VPS/cloud environment.
- Global layout: src/layouts/BaseLayout.astro.
- Central site/navigation/CTA configuration: src/lib/site.ts.
- Core pages, service pages, nine industry pages, resources, an assessment, and assessment results are present on main.

## Confirmed implementation gaps

Repository search on 2026-08-30 found no implementation references for:

- gtag
- dataLayer
- fbq
- Google Tag Manager
- short assessment / long assessment naming

Therefore, the repo should currently be treated as having no implemented GTM, GA4, or Meta Pixel layer and no implemented two-assessment routing. Verify the deployed site separately in case production has uncommitted/manual tags.

## Known specification/code conflicts to resolve

1. Canonical scheduling docs approve Calendly, but the current src/lib/site.ts comment still says no scheduling provider has been selected and routes the secondary CTA to /contact/.
2. Current site-wide primary CTA and /ai-assessment/ code assume a single assessment.
3. The older assessment overview describes a 35–45 question, 7–10 minute public assessment, while the canonical implementation spec and code contain up to 64 conditional questions. The new short/long architecture should resolve this instead of hiding it.
4. src/lib/site.ts contains an old comment saying only / is live even though many routes now exist.
5. Production/staging deployment and the deployed commit have not been confirmed in this brain.

## Tracking architecture direction

The implementation target is one vendor-neutral event contract emitted by the site and assessment applications, with GTM translating those events to GA4, Meta, and any future approved destinations.

Provisional event vocabulary—finalize after ASM-001:

| Event | Trigger | Sensitive-data rule |
|---|---|---|
| funnel_view | Tracked funnel/landing page viewed | Page/funnel identifiers only |
| cta_click | Meaningful primary/secondary CTA clicked | No form values |
| short_assessment_start | First intentional short-assessment action | No answers |
| short_assessment_complete | Short completion gate reached | No raw answers |
| long_assessment_start | First intentional long-assessment action | No answers |
| long_assessment_complete | Long deterministic result successfully created/submitted | No raw answers or private scores in third-party analytics |
| lead_submit | Server-accepted lead submission | Never send email/phone/name as analytics parameters |
| strategy_call_click | User enters approved booking flow | Destination/placement only |
| booked_call | Verified scheduling success/webhook/thank-you state | Use a non-sensitive event ID for deduplication |

Do not treat these names as final until the assessment routes and conversion definitions are approved. Do not send free-text answers, contact fields, private Commercial Opportunity Score, sensitive business inputs, or report contents to GA4/Meta.

## Attribution requirements

- Preserve approved UTMs and click identifiers through the funnel and lead handoff.
- Centralize environment/config values; never hard-code secrets.
- Prevent duplicate browser events on client navigation, back/forward, refresh, retries, and form resubmission.
- Use stable event IDs if browser/server deduplication is later implemented.
- Separate a click from an accepted lead and a booked call.
- Define a qualified-lead event only after the qualification rule and destination are approved.
- Confirm consent behavior before advertising tags fire where required.

## Verification checklist

- GTM Preview/Tag Assistant shows one intended container and correct triggers.
- GA4 DebugView shows the approved sequence and parameters.
- Meta Pixel Helper and Events Manager show the approved events without duplicates or prohibited data.
- One controlled test lead preserves campaign attribution through the destination system.
- Assessment refresh/resume/back behavior does not create false starts or completions.
- Booking success is measured from a reliable confirmation, not merely a calendar-button click.
- Staging does not pollute production analytics or become indexed.

## Canonical references

- CLAUDE.md
- docs/02-website/website-build-spec.md
- docs/02-website/technical-seo-spec.md
- docs/02-website/scheduling-and-booking.md
- docs/04-assessment/consent-and-data.md
- brain/AI-ASSESSMENTS.md
