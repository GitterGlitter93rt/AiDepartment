# Your AI Department — Market Miner Website Intelligence Specification

**Status:** Architecture authority  
**Purpose:** Define how a discovered business website becomes structured, claim-safe sales intelligence without fake form submissions or unsupported backend assumptions.

---

# 1. CORE QUESTION

The website research engine should answer:

> What does this business publicly say it offers, how does it invite customers to contact/book/buy, what technology signals are visible, and which workflow questions become worth asking?

It is not a penetration test and not a mystery-shop lead submission.

---

# 2. FETCH POLICY

Crawler must:

- identify itself appropriately where required;
- obey applicable robots/source policies;
- use reasonable concurrency/rate limits;
- limit same-domain crawl depth;
- avoid authenticated/private areas;
- not bypass CAPTCHAs/access controls;
- not submit fake leads/forms/appointments;
- not trigger irreversible actions;
- record fetch timestamp/status.

---

# 3. PAGE DISCOVERY

Start from canonical homepage.

Discover candidates through:

- navigation links;
- sitemap where available/allowed;
- same-domain relevant links;
- search-result landing pages already observed;
- known vertical URL patterns.

Do not crawl every blog/archive/tag page by default.

---

# 4. PAGE PRIORITY

V1 priority score:

## Highest

- paid-ad landing page;
- homepage;
- contact;
- booking/schedule;
- quote/estimate/consultation;
- emergency/24-7 service;
- high-value service page;
- financing/current offer.

## High

- locations/service area;
- about/team;
- membership/maintenance;
- relevant service category pages.

## Moderate

- reviews/testimonials page for workflow clues, not fabricated claims;
- careers for hiring/growth signal;
- FAQ for customer-service workflow clues.

## Low by default

- old blog archives;
- tags/categories;
- legal pages unless needed for provider/identity context.

---

# 5. CRAWL BUDGET

Default architecture:

- 5–20 useful pages per small/medium prospect;
- configurable maximum bytes/page;
- configurable total pages/domain;
- stop when high-value fields are sufficiently resolved;
- premium/deeper crawl only for high-priority prospects.

Do not spend 500 requests on a Tier D business.

---

# 6. BUSINESS IDENTITY EXTRACTION

Extract candidate facts:

- public brand/company name;
- legal/copyright name where visible;
- phone(s);
- email(s) where business-public;
- addresses;
- locations;
- service areas;
- hours;
- 24/7/emergency language;
- social links;
- structured Organization/LocalBusiness schema.

Each becomes EvidenceRecord candidate with page/source timestamp.

---

# 7. SERVICE EXTRACTION

Classify service families using vertical profile.

HVAC examples:

- AC repair;
- emergency repair;
- replacement;
- heat pump;
- furnace;
- maintenance/membership;
- indoor air quality;
- commercial HVAC.

Plumbing examples:

- emergency plumbing;
- drain/sewer;
- repipe;
- water heater;
- tankless;
- leak repair;
- commercial plumbing.

Store:

- service family;
- exact observed wording;
- page URL;
- current/offer context.

---

# 8. HIGH-VALUE SERVICE SIGNAL

Vertical profile defines which publicly promoted services plausibly support `high_value_economics_signal`.

This is a qualitative prospect-priority signal.

Do not attach a universal dollar value.

Example:

`AC replacement` can support high-value-service classification.

It cannot support:

> average ticket is $15,000

unless prospect/source provides valid number.

---

# 9. CTA / LEAD CAPTURE EXTRACTION

Identify:

- tel links;
- click-to-call buttons;
- forms;
- request quote;
- request estimate;
- consultation;
- schedule/book now;
- chat;
- SMS/text;
- third-party scheduling;
- financing application/link;
- Meta/Google lead destination where observed.

For each CTA:

- label;
- type;
- page;
- destination/form action provider where visible;
- service context;
- whether high prominence.

Do not submit form.

---

# 10. PHONE DEPENDENCE SIGNAL

Vertical model may already suggest high phone dependence.

Website adds prospect-specific evidence:

- sticky phone button;
- multiple “call now” CTAs;
- emergency phone emphasis;
- phone-first hero;
- phone repeated across service pages.

Use as supporting evidence, not exact call-volume estimate.

---

# 11. EMERGENCY / AFTER-HOURS

Strong confirmation examples:

- “24/7 emergency service” on current first-party page;
- hours show 24 hours;
- “call anytime/night/weekend.”

Distinguish:

- actual 24/7 service claim;
- generic “emergency” service with unknown office response;
- after-hours phone behavior (unknown until verified).

Website saying 24/7 does NOT prove a live human answers 24/7.

---

# 12. FINANCING / PROMOTION

Extract:

- financing offered;
- financing provider where public;
- specific promotion;
- coupon/current offer;
- service attached to offer;
- expiry date if explicit.

Time-sensitive offer gets short freshness TTL.

Do not assume financing usage rate or approval rate.

---

# 13. LOCATIONS / SCALE

Confirm multiple locations via:

- location directory;
- unique location pages;
- address list;
- structured data;
- first-party “locations” statements.

Service-area list alone is not necessarily multiple physical locations.

Store separately:

- confirmed physical locations;
- service territories;
- branch offices;
- unknown.

---

# 14. HIRING / GROWTH SIGNALS

Potential evidence:

- current careers page;
- specific active role listings;
- “now hiring” current page;
- newly announced location on first-party site.

Classify role family:

- CSR;
- dispatcher;
- technician;
- sales/comfort advisor;
- operations;
- marketing;
- other.

Do not infer company financial health from hiring alone.

---

# 15. LEADERSHIP / DECISION-MAKER CLUES

Extract public:

- owner/founder;
- president;
- GM;
- operations;
- sales;
- marketing;
- office manager;
- administrator.

Sources:

- team/about pages;
- location pages;
- schema;
- footer/contact.

Store confidence and date.

Do not assume a named technician is a decision-maker.

---

# 16. SCRIPT / TECHNOLOGY SIGNALS

Inspect HTML/script URLs/network references available from normal page fetch/browser render.

Potential families:

## Analytics/ads

- Google Tag Manager (`GTM-`);
- GA4 (`G-` / gtag signals);
- Google Ads (`AW-` / conversion scripts);
- Meta Pixel (`fbq`, Meta/Facebook script hosts).

## Call tracking

- CallRail and other configured providers.

## CRM/marketing forms

- HubSpot;
- HighLevel/LeadConnector;
- Salesforce-related public forms;
- other known providers.

## Field service / booking

- ServiceTitan;
- Housecall Pro;
- Jobber;
- vertical booking widgets.

## Chat

- Intercom;
- Podium;
- webchat providers;
- other configured signatures.

## Scheduling

- Calendly;
- embedded vertical schedulers;
- other booking tools.

Store as `frontend technology signal` with signature evidence.

---

# 17. SIGNAL CONFIDENCE

## Confirmed frontend signal

Direct script/domain/widget evidence clearly identifies provider.

## Likely

Naming/script pattern suggests provider but could be indirect.

## Unknown

Not detected.

Do NOT set:

`crm = false`

because known signatures were absent.

---

# 18. TRACKING ≠ ADVERTISING

Critical rule:

- Google Ads tag does not equal current Google advertising.
- Meta Pixel does not equal current Meta advertising.

Website technology can corroborate a current ad observation, but cannot create the +4/+3 paid-ad score alone.

---

# 19. SYSTEM SIGNAL ≠ WORKFLOW

Examples:

ServiceTitan booking widget proves/strongly suggests a ServiceTitan-related public booking component.

It does not prove:

- every phone lead enters ServiceTitan;
- estimate follow-up is automated;
- attribution is complete;
- employees use it consistently.

Those become discovery questions.

---

# 20. FORM ANALYSIS WITHOUT SUBMISSION

Inspect:

- fields requested;
- required fields;
- service choice;
- appointment/date fields;
- hidden source fields where visible;
- form provider/action endpoint where safely inspectable;
- confirmation text embedded in page code if public.

Do not send POST requests just to see response time.

---

# 21. PUBLIC LEAD-FLOW MAP

Build a graph such as:

`Google paid ad`
-> `AC replacement landing page`
-> `Request Estimate form`
-> `HubSpot-like form signal`
-> `BACKEND UNKNOWN`

or:

`Homepage`
-> `Call Now`
-> `CallRail tracking signal`
-> `BACKEND/CALL HANDLING UNKNOWN`

This graph is a research artifact, not a claim that downstream workflow is broken.

---

# 22. WEBSITE MATURITY READ MODEL

Separate categories:

## Presence

- no_verified_website
- basic
- functioning
- advanced

## Lead capture

- phone_only
- generic_form
- service_specific_form
- booking
- chat
- sms
- multi_channel

## Measurement signals

- none_detected
- analytics
- ad_tracking
- call_tracking
- multiple_tracking

## System signals

- none_detected_unknown
- crm_marketing_signal
- field_service_signal
- multiple_system_signals

These labels are internal research summaries, not external criticism.

---

# 23. WEBSITE / OFFER HYPOTHESIS RULE

Weak/basic site may suggest website/conversion discovery.

But before recommending:

Ask:

- how important website leads are;
- whether business is capacity constrained;
- whether redesign already underway;
- what growth goal exists.

A referral-only business with no growth goal may not need a new site from YAD.

---

# 24. CHANGE DETECTION

On refresh compare:

- offer changed;
- 24/7 claim changed;
- service page added/removed;
- locations changed;
- technology signals changed;
- phone changed;
- leadership changed.

Material changes can invalidate old Call Packs.

Do not treat minor HTML changes as meaningful business events.

---

# 25. RENDERING STRATEGY

Tiered:

## Fast HTTP fetch

Default for static/public HTML.

## Browser render

Use only when:

- critical content is JS-rendered;
- form/widget/script detection requires it;
- paid landing page relies on client-side rendering.

Browser rendering costs more; do not use universally without need.

---

# 26. CONTENT EXTRACTION

Preserve:

- page title;
- headings;
- key CTA text;
- relevant service/offer text;
- structured data;
- selected snippets supporting evidence.

Do not store complete third-party copyrighted websites unnecessarily.

Store minimal evidence/reference needed for research audit.

---

# 27. LLM USE

Deterministic extraction handles:

- URLs;
- phone/email;
- script signatures;
- structured data;
- form elements;
- known CTA patterns.

LLM may assist:

- service classification;
- business-model synthesis;
- offer categorization;
- distinguishing current promotion from generic content;
- summarizing public workflow.

LLM output remains evidence-linked and may not fabricate missing fields.

---

# 28. ERROR STATES

- domain_unreachable
- robots_disallowed
- TLS_error
- timeout
- blocking_challenge
- redirect_loop
- non_html_site
- social_only
- parking_page
- lead_generator_possible
- content_language_unsupported
- partial_render

Error does not mean business lacks a website.

---

# 29. FIXTURE — META PIXEL

HTML contains Meta Pixel.

Expected:

- `meta_tracking_signal = confirmed`
- `active_meta_ads = unknown` unless ad evidence adapter confirms.

---

# 30. FIXTURE — SERVICETITAN WIDGET

Site embeds ServiceTitan booking.

Expected:

- ServiceTitan frontend/booking signal;
- CRM workflow unknown;
- allowed question about what happens after lead enters.

---

# 31. FIXTURE — 24/7 PAGE

Current first-party page clearly says 24/7 emergency plumbing.

Expected:

- emergency/24-7 confirmed;
- after-hours answer process unknown.

---

# 32. FIXTURE — MULTIPLE SERVICE AREAS, ONE LOCATION

Site lists twenty cities but one office address.

Expected:

- one confirmed physical location;
- multiple service territories;
- do not automatically award multiple-location signal unless scoring rule explicitly treats service territories and evidence satisfies it.

---

# 33. FIXTURE — NO WEBSITE

Provider lacks website URL.

Expected:

- website unknown;
- perform independent resolution attempts;
- only after configured checks may status become `no_verified_website_found`.

---

# 34. ACCEPTANCE TEST

For 50 manually reviewed HVAC/plumbing sites:

Measure:

- correct canonical domain;
- service classification precision;
- 24/7 accuracy;
- physical-location accuracy;
- CTA detection;
- technology-signal precision;
- false active-ad inference = zero;
- false backend CRM claims = zero;
- no form submissions.

Fix high-impact extraction errors before broad mining.
