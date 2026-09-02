# Your AI Department — Module 4C Score Signal Recognition Policy

**Status:** Normative architecture authority  
**Purpose:** Define how evidence qualifies for each canonical Module 4C point rule so scoring remains deterministic/explainable rather than an LLM opinion.

---

# 1. PRINCIPLE

The canonical score is arithmetic over recognized evidence signals.

Correct:

`Evidence -> deterministic recognizer -> score component -> points`

Wrong:

`Ask LLM to rate this company 0–18`.

LLMs may classify site/service text into canonical claim categories, but the score recognizer validates claim/evidence requirements and awards points deterministically.

---

# 2. OUTPUT PER RULE

For each rule return:

- rule ID
- qualified: true/false
- points awarded
- EvidenceRecord IDs
- recognition reason code
- recognizer version.

Unknown/no qualifying evidence = 0 points.

Zero does not mean the opposite fact is true.

---

# 3. +4 GOOGLE PAID SEARCH

Award when current valid EvidenceRecord exists for:

- `active_google_search_ad = yes` with confirmed confidence/fresh state;
- or qualifying Google Local Services paid observation treated under same Google paid rule.

Do not award from:

- Google Ads tag
- GTM
- GA4
- organic result
- one historical stale observation
- provider “likely advertiser” without approved current evidence.

Award once per Account.

---

# 4. +3 META ACTIVE ADS

Award when:

- `active_meta_ad = yes`
- confirmed
- current under TTL
- source is approved for target commercial-ad class/region.

Do not award from Meta Pixel alone.

Award once.

---

# 5. +1 MULTI-CHANNEL PAID

Derived only when >=2 distinct paid channels independently qualify as current confirmed.

Examples:

- Google + Meta -> yes
- Google Search + Google LSA -> still one Google channel, no multi-channel bonus
- Google + Meta Pixel only -> no.

Award once.

---

# 6. +2 HIGH-VALUE ECONOMICS

Purpose:

Recognize businesses where one customer/job/case/treatment/contract/recurring relationship can carry enough value for process leakage to matter.

Qualifying paths:

## Path A — Confirmed high-value service

Vertical profile identifies service family as `high_value` and first-party/ad evidence confirms company offers/promotes it.

HVAC examples:

- AC replacement
- HVAC installation
- heat pump installation/replacement
- significant commercial projects.

Plumbing examples:

- repipe
- sewer replacement
- water heater installation/replacement where profile marks high-value
- major plumbing projects.

## Path B — Prospect/system economics

Prospect/system supplies customer/job/case/contract value that meets vertical/company-defined meaningful threshold.

## Path C — Recurring-account economics

Vertical profile identifies meaningful recurring account economics and business evidence confirms that business model/service.

Do NOT award merely because every business technically sells something.

Do NOT insert universal average ticket.

---

# 7. +2 LEAD / INTAKE / ESTIMATE VOLUME OPERATIONALLY IMPORTANT

This rule recognizes that acquisition/intake flow is a material operating process, not that YAD knows the exact monthly volume.

Qualifying paths:

## Path A — Prospect/system volume

Prospect/system confirms recurring monthly lead/call/intake/estimate volume above a vertical-configured meaningful threshold or explicitly says volume creates operational workload.

## Path B — Strong public lead-flow evidence

Vertical profile marks customer acquisition/intake as central and at least TWO independent scale/demand signals exist, for example:

- fresh active paid acquisition
- multiple physical locations/service territories
- prominent multiple lead-capture paths
- active CSR/intake/dispatcher/sales hiring
- repeated strong advertiser evidence across high-intent services
- material appointment/estimate/intake workflow.

A single phone number on a site is insufficient.

For advertiser-first HVAC/Plumbing, fresh paid acquisition + a prominent service lead path can satisfy this rule when vertical profile explicitly marks paid lead/intake volume as operationally important, subject to fixture tests.

Store recognition reason; do not claim an exact lead count.

---

# 8. +1 EMERGENCY / AFTER-HOURS / 24-7

Award when current confirmed evidence supports:

- 24/7 service
- after-hours service
- emergency service model that materially extends ordinary hours according to profile.

Sources:

- first-party website
- current ad/landing page
- prospect statement.

Do not infer live human answering.

---

# 9. +1 APPOINTMENT / ESTIMATE / CONSULTATION / INTAKE-HEAVY

Award when vertical profile says the buying process materially relies on one of these handoffs AND business evidence confirms relevant service/CTA/workflow.

Examples:

HVAC replacement:

- request estimate/quote
- schedule service
- comfort-advisor/installation process.

Plumbing:

- service scheduling
- larger project/repipe/sewer estimate.

Law:

- consultation/intake.

Dental/med spa:

- appointment/consultation.

Do not award to every website just because it has a generic contact page if the profile/customer journey does not support an intake-heavy purchase process.

---

# 10. +1 MULTIPLE LOCATIONS OR SERVICE TERRITORIES

Award once if either:

## Physical locations

>=2 confirmed meaningful operating locations/branches.

OR

## Distinct service territories

Business genuinely operates across multiple defined service territories/markets and vertical profile recognizes that as operational complexity.

Do not award because footer lists 25 nearby suburbs within one normal service radius.

Do not award twice for locations + territories.

Franchise ambiguity goes to review before treating as one multi-location Account.

---

# 11. +1 VISIBLE GROWTH / HIRING / EXPANSION

Award on fresh confirmed public evidence such as:

- current hiring for operational/sales/office/technician roles
- new location announcement
- explicit expansion into new market
- active current careers page with relevant open roles.

Do not award merely because website says “we are growing.”

Do not infer financial health.

TTL should be relatively short for job listings.

---

# 12. +1 STRONG PHONE DEPENDENCE

Qualifying paths:

## Path A — Prospect/system confirmation

Prospect states phone is a major lead/customer channel.

## Path B — Vertical + first-party evidence

Vertical profile marks phone as a primary/urgent customer path AND website/ads show strong phone CTA/customer journey.

Examples:

- click-to-call prominent
- emergency call CTA
- multiple service pages drive phone calls
- LSA phone lead surface.

Do not award solely because every business has a phone number.

---

# 13. +1 PROMINENT FORM / BOOKING / QUOTE / CONSULTATION CTA

Award when first-party/current landing evidence confirms a meaningful lead-capture CTA:

- request service
- request quote
- request estimate
- book appointment
- consultation
- online scheduling
- material lead form.

Award once regardless of how many CTA types.

Generic newsletter signup does not qualify.

---

# 14. EVIDENCE STACKING

One EvidenceRecord can support more than one conceptual rule only when genuinely appropriate.

Example:

Current Google emergency AC ad:

- supports +4 Google paid
- can contribute one of multiple signals to lead-volume operational importance
- may support emergency service only if the ad explicitly says emergency/24-7 and claim registry permits.

But do not overcount a single weak observation into every score rule.

Recognizer reasons make this auditable.

---

# 15. LLM CLASSIFICATION BOUNDARY

LLM may classify:

> “Whole-home repiping” -> `repipe`, profile high-value.

It may not directly output:

> “award high-value +2.”

Code checks:

- classified service
- evidence source
- vertical profile metadata
- currentness

then awards.

---

# 16. PROSPECT CORRECTION

If a score signal was public and prospect contradicts it during call:

- preserve pre-call score snapshot for that call
- update current evidence state
- generate new score snapshot after call if material.

Do not rewrite historical Call Pack as though caller knew correction before call.

---

# 17. SCORE VERSIONING

Recognizer version stored with score.

If recognition policy changes materially:

- new scoring version
- rerun fixtures
- optionally rescore current inventory
- preserve historical scores.

Do not silently change old score semantics.

---

# 18. FIXTURE — GOOGLE + QUOTE ONLY

HVAC:

- Google ad confirmed
- generic AC repair
- quote/request-service form
- no high-value replacement evidence
- no emergency
- phone CTA prominent.

Possible qualified rules:

- Google +4
- lead volume operational importance +2 if advertiser-first HVAC profile recognition rule satisfied
- intake/estimate +1 if service flow qualifies
- phone +1
- CTA +1

High-value +2 must remain 0 unless high-value service/business economics evidence exists.

Exact expected fixture should be added after profile fields finalized.

---

# 19. FIXTURE — THREE LOCATION HVAC

- no paid ads
- replacement service
- three confirmed branches
- online booking
- phone-first
- hiring CSR.

Qualifies:

- high value +2
- lead-volume operational importance if public scale signals meet Path B +2
- intake +1
- multiple locations +1
- growth +1
- phone +1
- CTA +1.

No ad points.

---

# 20. FIXTURE — FOOTER CITY SPAM

One physical location.

Footer lists 40 nearby cities for SEO.

Expected:

- multiple physical locations = false
- service territories require meaningful market grouping evidence; not automatically 40 territories
- no +1 solely from footer city count.

---

# 21. FIXTURE — HIRING PAGE OLD

Job page last/current evidence outside hiring TTL and no current listing confirmation.

Expected:

- historical hiring evidence preserved
- growth/hiring current rule not awarded until refreshed.

---

# 22. ACCEPTANCE

- every point from deterministic recognizer
- every point has EvidenceRecord IDs/reason
- qualitative rules have explicit paths
- score fixture arithmetic 100%
- no LLM-direct total/tier
- no hidden bonus points
- zero never rendered as negative fact.
