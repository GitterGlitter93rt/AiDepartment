# Your AI Department — Contact Endpoint Quality & Channel Readiness Specification

**Status:** Architecture authority  
**Purpose:** Define what YAD means by a usable phone number or email address, preserve source/freshness, prevent guessed data from being presented as verified, and keep endpoint quality separate from prospect fit and role confidence.  
**Implementation owner:** Claude Code

---

# 1. CORE PRINCIPLE

Three questions must remain separate:

1. **Is this company a good prospect?** — fit/Module 4C score.
2. **Is this person/role the right stakeholder?** — contact/role confidence.
3. **Is this phone/email endpoint usable?** — endpoint quality.

A Tier A Account can have no usable email.

A perfectly deliverable email can belong to the wrong person.

Do not blend these into one confidence number.

---

# 2. ENDPOINT RECORD

Each phone/email endpoint should retain:

- `endpoint_id`
- `account_id`
- `contact_id` optional
- `endpoint_type`
- normalized value
- display value
- endpoint role/type
- source provider/type
- source reference
- observed/verified at
- source assertion
- YAD verification method if any
- quality state
- confidence class
- freshness state
- last successful use optional
- last failed use optional
- failure reason optional
- suppression state
- policy/channel eligibility result

Never overwrite source provenance with a generic `verified=true` flag.

---

# 3. PHONE ENDPOINT TYPES

Suggested phone semantic types:

- `MAIN_BUSINESS_LINE`
- `DIRECT_BUSINESS_LINE`
- `LOCATION_BUSINESS_LINE`
- `EXTENSION`
- `MOBILE_ASSERTED_BUSINESS`
- `MOBILE_UNKNOWN_USE`
- `TOLL_FREE_BUSINESS`
- `CALL_TRACKING_NUMBER`
- `UNKNOWN_PHONE_TYPE`

Line purpose/type and contact permission are separate.

A public mobile number is not automatically approved for every outreach mode.

---

# 4. PHONE QUALITY STATES

Recommended normalized states:

- `CURRENT_BUSINESS_CONFIRMED`
- `DIRECT_BUSINESS_CONFIRMED`
- `PROVIDER_ASSERTED_CURRENT`
- `PUBLIC_OBSERVED_UNVERIFIED`
- `STALE`
- `UNKNOWN`
- `WRONG_NUMBER`
- `DISCONNECTED`
- `REASSIGNED_NUMBER_RISK`
- `SUPPRESSED`

`CONFIRMED` must mean YAD has evidence appropriate to that label, such as a fresh official business website/current business listing or an actual recent successful business-contact event.

Provider claims remain provider claims.

---

# 5. PHONE SOURCE HIERARCHY

Examples of stronger evidence, depending on context:

1. current official company website/location page;
2. current official business listing/profile with identity match;
3. prospect/gatekeeper confirmation;
4. approved licensed contact provider;
5. other public professional/business source;
6. older import;
7. inferred/ambiguous source.

This hierarchy guides confidence but does not automatically authorize outreach.

---

# 6. CALL-TRACKING NUMBERS

If website uses CallRail or similar dynamic/static tracking:

- record it as a business contact endpoint if currently displayed and identity is clear;
- label tracking nature when detected;
- do not assume it reaches a specific person;
- do not infer CRM usage or ad spend merely from tracking technology.

---

# 7. WRONG NUMBER FEEDBACK

Rep disposition `WRONG_NUMBER` must immediately:

- downgrade/disable endpoint;
- preserve historical source;
- stop automatic reuse;
- trigger targeted refresh if Account remains valuable;
- not disqualify Account automatically.

If corrected number is supplied by business/gatekeeper, store it as a new endpoint with explicit source.

---

# 8. DISCONNECTED / REASSIGNED RISK

Provider/telephony signals may indicate disconnected or reassigned risk.

Do not convert weak provider signal into absolute fact unless semantics support it.

High-risk endpoints should be removed from ordinary call-ready queue pending refresh/policy.

---

# 9. EMAIL ENDPOINT TYPES

Suggested email semantic types:

- `DIRECT_PERSON_EMAIL`
- `ROLE_EMAIL`
- `GENERAL_BUSINESS_EMAIL`
- `LOCATION_EMAIL`
- `UNKNOWN_EMAIL_TYPE`

Examples:

- `john@company.com` -> direct person if identity is supported;
- `sales@company.com` -> role email;
- `info@company.com` -> general business email.

Do not pretend `info@` belongs to the owner.

---

# 10. EMAIL QUALITY STATES

Recommended states:

- `YAD_CONFIRMED_DELIVERABLE`
- `PROVIDER_VERIFIED`
- `DOMAIN_VALID_UNVERIFIED`
- `PUBLIC_OBSERVED_CURRENT`
- `GUESSED_UNVERIFIED`
- `STALE`
- `UNKNOWN`
- `HARD_BOUNCE`
- `SOFT_BOUNCE_REVIEW`
- `MAILBOX_FULL_OR_TEMPORARY`
- `SUPPRESSED`

Provider verification is labeled `PROVIDER_VERIFIED`, not silently upgraded to YAD-confirmed certainty.

---

# 11. EMAIL VERIFICATION LAYERS

Keep these distinct:

- syntax valid;
- domain resolves;
- MX/mail infrastructure present;
- provider says deliverable;
- address observed publicly;
- actual YAD send delivered/no hard bounce;
- actual reply received.

No single layer should be described as stronger than it actually is.

---

# 12. GUESSED EMAILS

Pattern inference such as:

`first.last@company.com`

may be stored only as `GUESSED_UNVERIFIED` if product policy allows storing it.

It must not:

- display as verified;
- be automatically exported to Smartlead unless approved email policy explicitly permits that quality class;
- be used to claim YAD found the person's email publicly.

Prefer verification/enrichment before outreach.

---

# 13. HARD BOUNCE

On hard bounce:

- endpoint becomes `HARD_BOUNCE`;
- stop further sends to that endpoint;
- preserve Account and Contact;
- attempt approved alternative enrichment if Account still valuable;
- retain bounce event for source-quality analytics.

Do not repeatedly recycle hard-bounced addresses through new campaigns.

---

# 14. SOFT BOUNCE

Soft bounce does not immediately prove permanent invalidity.

Track reason/time and apply configured retry/review behavior.

Do not count a soft bounce as successful delivery.

---

# 15. REPLY AS STRONG EVIDENCE

A genuine reply strongly confirms mailbox reachability and Contact relationship for that interaction.

It does not prove every imported title/company detail is still correct.

Prospect corrections supersede stale role data.

---

# 16. FRESHNESS

Endpoint freshness depends on source/type.

Implementation should use configurable TTL/review windows rather than one hard-coded global age.

Examples:

- official website business line may age more slowly;
- named decision-maker direct email may need more frequent role refresh;
- actual recent reply/call confirmation is high-value current evidence.

Stale does not mean false. It means refresh before high-confidence use where required.

---

# 17. CONTACT ROLE CONFIDENCE

Store separately from endpoint quality:

- `CONFIRMED_CURRENT_ROLE`
- `LIKELY_CURRENT_ROLE`
- `HISTORICAL_ROLE`
- `ROLE_ONLY_TARGET`
- `UNKNOWN_ROLE`

Example:

A direct email may be provider-verified but the person's title may be six months old.

UI should show both facts.

---

# 18. CALL READY DETERMINATION

`call_ready` is a deterministic result over:

- endpoint quality;
- endpoint type;
- source/freshness;
- Account/Contact suppression;
- line/contact policy;
- campaign policy;
- relationship/cadence state.

Endpoint quality alone never grants permission to call.

---

# 19. EMAIL READY DETERMINATION

`email_ready` is a deterministic result over:

- email quality;
- role/contact relevance;
- suppression/unsubscribe;
- campaign policy;
- source/license policy;
- cross-channel relationship state;
- personalization evidence freshness if the email references current observations.

---

# 20. BOTH READY

`both_ready` means at least one eligible phone and one eligible email endpoint exist for the intended Account/contact strategy.

It does not require both endpoints to belong to exactly the same named person if the campaign allows role/general routing, but the rep UI must make the distinction obvious.

---

# 21. REP UI LABELS

Use plain labels such as:

- `Official business line — seen on website 2 days ago`
- `Direct line — provider-asserted`
- `Owner email — provider verified; role last checked 18 days ago`
- `General email — current website`
- `Email guessed — not outreach ready`
- `Wrong number — do not use`

Avoid a vague green checkmark with no semantics.

---

# 22. MANAGER FILTERS

Manager list builder can filter by:

- any call-ready endpoint;
- official/current business line required;
- named decision-maker phone required;
- any email-ready endpoint;
- named decision-maker email required;
- phone + email;
- contact quality minimum;
- freshness maximum.

If the filter materially reduces supply, show the shortfall instead of silently weakening it.

---

# 23. PROVIDER BENCHMARKING

Track by provider/source:

- fill rate;
- current role accuracy from rep feedback;
- hard-bounce rate;
- wrong-number rate;
- decision-maker reach;
- cost per usable endpoint;
- downstream qualified conversation/meeting rate where appropriate.

Do not optimize only for cheapest records.

---

# 24. CORRECTION LOOP

Rep/gatekeeper/prospect feedback should create structured corrections:

- phone wrong;
- email bounced;
- person left;
- title changed;
- use main line instead;
- correct person is X;
- email provided directly.

Corrections update endpoint/contact state while preserving provenance.

---

# 25. SENSITIVE DATA MINIMIZATION

The Prospect Factory is intended for business prospecting.

Do not enrich/store unrelated sensitive personal details merely because a source exposes them.

Store the minimum business contact data necessary for the approved workflow.

---

# 26. ACCEPTANCE TESTS

1. Official website phone today -> current business line; call readiness still waits on policy/suppression.
2. Apollo/provider email marked verified -> display `provider verified`, not YAD-guaranteed.
3. Guessed email with MX domain -> remains unverified and blocked if campaign requires verified.
4. Hard bounce -> email stops; phone remains usable if independently eligible.
5. Wrong number -> endpoint blocked; Account remains prospect.
6. Named person leaves company -> role/contact confidence downgraded; generic company line can remain current.
7. General `info@` address -> never labeled owner email.
8. CallRail number -> business/tracking endpoint, not named direct line.
9. DNC endpoint -> suppressed regardless of excellent endpoint quality.
10. Manager asks for 100 named-decision-maker email-ready prospects but only 41 qualify -> return 41 ready + shortage details, never silently include guessed emails.

---

# 27. CORE RULE

A clean-looking phone number or email address is not the same as a verified stakeholder or an authorized outreach channel. YAD must show exactly what it knows, how it knows it, and whether the endpoint is actually ready for the requested workflow.