# Your AI Department — Paid Demand Funnel Audit Specification

**Status:** Architecture authority  
**Purpose:** Map the observable path from a current paid search/social advertisement through landing page, CTA, tracking, lead capture, and visible next-step signals without submitting fake inquiries or pretending to know backend behavior.  
**Implementation owner:** Claude Code

---

# 1. CORE QUESTION

For an advertiser, YAD should know:

> What service/offer are they paying to promote, where does the click land, what action is the visitor asked to take, what tracking/lead-capture infrastructure is visible, and what business-process question does that make relevant?

This is a **public funnel audit**, not a hidden backend audit.

---

# 2. FUNNEL OBSERVATION

`PaidDemandFunnelObservation`

- account_id
- ad_observation_id
- platform
- query / ad context
- advertised service
- advertised offer
- landing_url
- final_url
- landing_domain
- page_type
- CTA types[]
- phone(s)
- form(s)
- booking/chat/SMS signals
- tracking signals[]
- call_tracking signal
- CRM/frontend signals[]
- location/market context
- message_match assessment
- visible friction observations[]
- unknown_backend_steps[]
- observed_at
- evidence_ids[]

---

# 3. PAGE TYPE

Classify:

- dedicated landing page
- service page
- homepage
- location page
- lead aggregator
- booking page
- call-only result
- LSA/direct lead flow
- other/unknown.

Dedicated page is not automatically “better.”

---

# 4. MESSAGE MATCH

Compare ad/query intent to landing page.

Examples:

Query:
`emergency AC repair Jacksonville`

Good observable match:

- emergency AC content
- Jacksonville/service-area relevance
- clear phone/booking CTA.

Potential mismatch:

- generic homepage focused mostly on commercial maintenance.

Do not claim mismatch causes lost leads without conversion data.

Use:

> “I noticed the ad is emergency-AC specific but the landing page is broader. Do you track conversion separately for that traffic?”

---

# 5. CTA INVENTORY

Detect:

- click-to-call
- form
- estimate request
- consultation request
- booking
- chat
- text/SMS
- lead form
- email
- directions/location.

Record placement/context where useful.

Do not submit any CTA during normal research.

---

# 6. PHONE FLOW SIGNALS

Observe:

- phone number
- click-to-call
- different number on landing page vs site
- CallRail/other tracking signal
- LSA direct call
- office hours/24-7 text.

Do not infer:

- who answers
- missed-call rate
- routing
- CRM record creation.

Those become questions.

---

# 7. FORM FLOW SIGNALS

Analyze form structure without submission.

Fields may include:

- name
- phone
- email
- service
- ZIP
- preferred time
- message
- vehicle/matter/project context.

Record:

- form provider/front-end signal
- required-field count
- service specificity
- consent/disclaimer visibility where relevant
- confirmation behavior unknown unless visible without submitting.

Do not call a long form “bad” automatically; some workflows require qualification.

---

# 8. BOOKING

Detect:

- Calendly-like scheduling
- CRM/field-service booking
- custom scheduler
- appointment CTA.

Without submitting:

- do not claim actual availability
- do not create fake appointments
- do not infer backend CRM workflow.

Question:

> “When somebody books online, does that automatically create the same CRM/source record as a phone lead?”

---

# 9. CHAT / AI SIGNAL

Detect public chat/widget provider.

Do not immediately conclude:

- AI-powered
- good/bad
- integrated
- 24/7.

If widget explicitly describes functionality, store that public claim.

Otherwise signal only.

---

# 10. TRACKING / ATTRIBUTION SIGNALS

Observe front-end:

- GTM
- GA4
- Google Ads conversion tags
- Meta Pixel
- CallRail/call tracking
- other approved analytics signatures.

These show instrumentation signals, not proof of revenue attribution.

Good question:

> “I can see tracking on the front end. Can you currently connect the original campaign through to booked/sold revenue?”

Not:

> “Your tracking is broken.”

---

# 11. MULTI-LOCATION

If landing page/service page targets one location but company has several:

Audit:

- local number
- location CTA
- service-area content
- shared form
- central vs local routing unknown.

Potential question:

> “Do leads from each market stay tied to the location and campaign all the way through the sale?”

---

# 12. OFFER EXTRACTION

Detect visible offers:

- free inspection
- free consultation
- financing
- discount/promotional offer
- same-day/emergency
- deductible/other offer where appropriate and lawful
- membership/promo.

Store exact public language with source.

Do not interpret legality/value without appropriate context.

---

# 13. VERTICAL-SPECIFIC FUNNEL PATHS

## HVAC/Plumbing/Electrical/Garage Door/Restoration

Ad -> call/form/booking -> office/dispatch unknown.

## Roofing/GC

Ad -> inspection/consultation -> proposal path unknown.

## Collision

Ad -> estimate/call/photo/appointment -> repair scheduling unknown.

## Law

Ad -> call/form/consultation -> intake/human review unknown.

## Dental/Med Spa

Ad -> new-patient/consultation/booking -> clinical workflow unknown.

## Real Estate

Ad -> buyer/seller/home-value/listing inquiry -> agent/ISA/nurture unknown.

---

# 14. OBSERVABLE FRICTION CATEGORIES

Use cautious labels:

- service_message_mismatch_possible
- no_clear_primary_CTA
- phone_only
- form_only
- several_competing_CTAs
- generic_landing_page
- no_location_context
- no_visible_immediate_acknowledgment_signal
- no_visible_booking
- mobile_layout_requires_visual_review
- tracking_signal_absent_or_unknown
- tracking_present_backend_unknown.

These are audit observations, not conversion verdicts.

---

# 15. PUBLIC FUNNEL MATURITY

Optional descriptive levels, not fit score:

- SIMPLE_PHONE
- BASIC_FORM
- MULTI_CHANNEL_CAPTURE
- BOOKING_ENABLED
- TRACKING_RICH
- SOPHISTICATED_PUBLIC_FUNNEL
- UNKNOWN

Never equate sophisticated public funnel with good internal follow-up.

---

# 16. FUNNEL-TO-HYPOTHESIS MAP

Examples:

Current paid search + phone CTA + 24/7
-> after-hours/missed-call question.

Current Meta + lead form/consultation
-> speed-to-lead / follow-up.

Paid roofing + inspection form + financing
-> paid response + proposal/financing follow-up.

Paid law + consultation form
-> intake response + source-to-retained-client attribution.

Tracking-rich multi-location site
-> attribution/location consistency question.

---

# 17. NO FAKE SUBMISSION RULE

Normal research must never:

- submit quote form
- schedule appointment
- initiate legal intake
- create patient inquiry
- request repair estimate
- send chat message pretending to be a customer.

Controlled testing of YAD-owned/demo properties is separate.

---

# 18. SCREENSHOT / VISUAL REVIEW

If implementation later uses visual browser/screenshot capability:

- store only where provider/site policy and retention allow;
- use for internal human audit;
- do not assume automated screenshot interpretation is always correct.

Core structured extraction should not depend solely on screenshots.

---

# 19. FUNNEL AUDIT CARD FOR REP

Show:

**Observed ad:** Emergency AC repair

**Landing:** dedicated service page

**CTA:** call + form

**Signals:** CallRail, GTM, Google Ads tag, ServiceTitan booking signal

**Unknown:** after-hours routing, form SLA, CRM source retention, outcome attribution

**Best question:** “When one of those paid calls/forms comes in after hours, what happens next—and can you trace it through the booked job?”

This is far more useful than simply “they run ads.”

---

# 20. ACCEPTANCE TESTS

1. Emergency AC ad -> generic homepage -> possible message mismatch, no claim of poor conversion.
2. Roofing replacement ad -> inspection landing page + financing -> proposal/response hypothesis.
3. Law PI ad -> family law landing page due redirect error -> identity/context conflict review.
4. Meta Pixel only -> tracking signal, not Meta active ads.
5. CallRail detected -> call-tracking signal, not attribution proof.
6. Booking widget -> booking signal, backend unknown.
7. Long qualification form -> observe fields, do not automatically label bad.
8. Aggregator landing page -> aggregator classification.
9. Multi-location landing -> location-routing question.
10. No fake form submission in all tests.

---

# 21. CORE RULE

The paid-demand funnel audit tells YAD what the business publicly built to convert demand and, equally important, where the public evidence ends. The gap between those two is where good discovery questions begin.
