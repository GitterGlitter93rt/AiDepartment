# Production Tracking — GTM, GA4, Google Ads, Meta, and Funnel Events

**Snapshot date:** 2026-08-30  
**Evidence:** GTM screenshots supplied by Michael, live production HTML/JavaScript, and the sprint12-industry-content-expansion branch  
**Status:** GTM and GA4 base installation confirmed; funnel conversion coverage is incomplete

## Confirmed production identifiers

| System | Identifier | Status |
|---|---|---|
| Google Tag Manager | GTM-5G8Q7KKZ | Confirmed in GTM and live on every inspected production route |
| GA4 web stream | G-GLSRPH43L4 | Confirmed as the GA4 destination in GTM |
| Google tag | GT-5TQWWPV2 | Shown with the GA4 destination in the GTM overview |
| Google Ads | AW-1839535359 | Confirmed as a GTM destination |
| Meta Dataset / Pixel | Unknown | Not shown in the supplied GTM workspace and not yet recorded elsewhere |

Do not store account passwords, API credentials, customer identifiers, or private event payloads in this file.

## Confirmed sitewide implementation

The live site loads GTM once through the shared Astro BaseLayout, including the required body noscript iframe. GA4 is routed through GTM rather than through a second hard-coded gtag.js install.

Because the GA4 Google tag fires on Initialization — All Pages, ordinary page_view events already cover the new funnel routes. Do not create duplicate hard-coded page_view events merely because the routes are new. Use the page path in GA4 funnel exploration:

- /ai-assessment/ — assessment chooser
- /free-ai-assessment/ — free 15-question assessment
- /comprehensive-ai-business-audit/ — paid $495 audit offer and Cal.com booking CTA
- /booking-confirmed/ — browser return/confirmation route
- /ai-assessment/full/ — internal 64-question engine; noindex and not a public free alternative to the paid audit

## Existing GTM tags and triggers visible in the supplied screenshots

| GTM tag | Trigger / event |
|---|---|
| Conversion Linker | Initialization — All Pages |
| GA4 - Google Tag | Initialization — All Pages |
| GA4 - AI Assessment Start | ai_assessment_start |
| GA4 - AI Assessment Complete | ai_assessment_complete |
| GA4 - Contact Form Submit | contact_form_submit |
| GA4 - Enterprise Booking Click | booking_click_enterprise |
| GA4 - Executive Advisory Click | booking_click_executive_advisory |
| GA4 - Strategy Booking Click | booking_click_strategy |
| GA4 - Training Booking Click | booking_click_training |
| GA4 - Resource CTA Click | resource_cta_click |
| Google Ads - Contact Lead | contact_form_submit |

The screenshots do not reveal whether each GA4 tag forwards all event parameters. Inspect that in GTM before assuming parameter coverage is complete.

## Live vendor-neutral dataLayer contract

| Event | Meaning | Non-PII parameters emitted |
|---|---|---|
| ai_assessment_start | User intentionally starts either assessment engine | assessment_type; assessment_version for the short flow |
| ai_assessment_complete | Assessment questions were completed and a result was calculated | assessment_type; assessment_version for the short flow |
| ai_assessment_lead_submit | Short-assessment lead/result delivery succeeded | assessment_type; assessment_version; lead_id; score_band |
| booking_click_strategy | User clicked toward the strategy-call scheduler | link_url |
| booking_click_enterprise | User clicked toward enterprise scheduling | link_url |
| booking_click_training | User clicked toward training scheduling | link_url |
| booking_click_executive_advisory | User clicked toward executive advisory scheduling | link_url |
| booking_click_comprehensive_audit | User clicked the $495 comprehensive-audit Cal.com CTA | link_url |
| booking_confirmed | Confirmation page received a booking UID and had not already fired for it in the session | booking_source; optional booking_type |
| contact_form_submit | Contact form submission event used by GA4 and Google Ads | Confirm current tag parameters before launch |
| resource_cta_click | Meaningful resource CTA click | link_url; link_text |

Assessment identifiers currently used by production:

- Short/free: assessment_type = free_opportunity; assessment_version = short_v1.
- Comprehensive engine: assessment_type = comprehensive_audit.
- score_band is coarse only: low, medium, or high.
- No name, email, phone, company, answers, or free text should be sent to analytics.

## Confirmed GTM coverage gaps

The supplied GTM screenshots do not show triggers/tags for three events that the live site already emits:

1. ai_assessment_lead_submit
2. booking_click_comprehensive_audit
3. booking_confirmed

Do not add paid_audit_request_submit for the current production funnel. That event exists in an older GitHub branch implementation that used an on-site request form, while production now sends the $495 audit CTA to Cal.com.

## Required GTM additions

Create these Custom Event triggers:

- CE - ai_assessment_lead_submit
- CE - booking_click_comprehensive_audit
- CE - booking_confirmed

Create matching GA4 Event tags:

- GA4 - AI Assessment Lead Submit
- GA4 - Comprehensive Audit Booking Click
- GA4 - Booking Confirmed

Add Data Layer Variables as needed:

- DLV - assessment_type
- DLV - assessment_version
- DLV - lead_id
- DLV - score_band
- DLV - link_url
- DLV - booking_source
- DLV - booking_type

Forward only the relevant parameters on each GA4 tag. Never forward contact fields or assessment answers.

Recommended GA4 key events:

- ai_assessment_lead_submit — yes
- booking_confirmed — yes after the real Cal.com redirect is verified
- booking_click_comprehensive_audit — useful micro-conversion, but not equivalent to a paid booking
- ai_assessment_complete — useful funnel milestone, not necessarily a delivered lead

## Booking-confirmation limitation

The current booking_confirmed event is browser-side. It fires only when the confirmation page receives an accepted booking UID query parameter and suppresses duplicate firing for the same ID within the session. It is a useful behavioral signal but is not a server-verified booking record.

The repository documents a future signed Cal.com webhook design. Until that is implemented, do not claim browser confirmation is equivalent to durable server-side booking/payment verification.

## Verification gate before paid traffic

1. Open GTM Preview/Tag Assistant on /free-ai-assessment/.
2. Verify exactly one ai_assessment_start on Get My Score.
3. Complete a controlled test assessment and verify one ai_assessment_complete followed by one ai_assessment_lead_submit only after delivery succeeds.
4. Click the $495 audit CTA and verify booking_click_comprehensive_audit.
5. Complete a real test Cal.com booking and verify the return URL contains the booking UID contract and emits one booking_confirmed.
6. Confirm the three GA4 events and parameters in GA4 DebugView.
7. Refresh, navigate back, retry a form, and repeat a booking return to confirm no false duplicate conversions.
8. Confirm attribution query fields reach Cal.com and that no PII or assessment answers appear in GTM/GA4.
9. Publish the GTM workspace only after the preview sequence passes.
