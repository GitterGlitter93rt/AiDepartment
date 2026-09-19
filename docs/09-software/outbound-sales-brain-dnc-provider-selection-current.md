# Your AI Department — DNC Provider / Data Source Selection — CURRENT

**Status:** Current provider-selection architecture note  
**Date:** 2026-09-03  
**Implementation owner:** Claude Code  
**Architecture owner:** ChatGPT  
**Note:** Engineering/policy architecture, not legal advice.

---

# 1. PURPOSE

Choose a practical source for National/state Do Not Call screening without hard-coding YAD to a single vendor and without confusing public FTC complaint data with the actual National Do Not Call Registry.

The output of this decision feeds:

`outbound-sales-brain-phone-screening-provider-interface-spec.md`

and the global `ChannelEligibilityDecision` engine.

---

# 2. CRITICAL DISTINCTION — FTC COMPLAINT API IS NOT REGISTRY MEMBERSHIP

The FTC publishes a developer API for **reported unwanted-call complaints**.

That dataset contains phone numbers consumers reported as originating unwanted calls. It is not the seller/telemarketer National Do Not Call Registry membership dataset.

Do **not** use the FTC complaint API to decide whether a destination phone number is on the National DNC Registry.

Official FTC references:

- https://www.ftc.gov/developer/api/v0/endpoints/do-not-call-dnc-reported-calls-data-api
- https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data

---

# 3. OFFICIAL NATIONAL DNC ACCESS MODEL

The actual National Registry seller/telemarketer access model uses:

- organization registration/profile;
- annual subscription;
- Subscription Account Number (`SAN`);
- area-code subscriptions;
- Full Lists;
- Change Lists;
- small interactive number lookups;
- optional automated Web-service access for Change Lists.

FTC guidance states:

- the first five area codes are free;
- FY2026 additional area codes are $82 each, up to the annual maximum;
- sellers/telemarketers subject to the Registry requirements synchronize at least every 31 days;
- Full Lists are updated daily;
- Change Lists represent additions/deletions;
- Flat Text and XML formats are available;
- small interactive lookups support 1–10 numbers;
- SOAP-based Web service access is available for automated Change List downloads, with WSDL/details provided by the Registry Help Desk.

Current official references:

- https://www.ftc.gov/business-guidance/resources/qa-telemarketers-sellers-about-dnc-provisions-tsr-0
- https://www.ftc.gov/business-guidance/resources/complying-telemarketing-sales-rule
- https://www.ftc.gov/news-events/news/press-releases/2025/08/telemarketer-fees-access-ftcs-national-do-not-call-registry-increase-2026

FY2027 begins October 1, 2026. FTC has announced $85 per additional area code for FY2027, with the first five still free under the announced structure.

Reference:

- https://search.ftc.gov/news-events/news/press-releases/2026/08/ftc-announces-2027-telemarketer-fees-access-national-do-not-call-registry

Do not hard-code fee amounts into software.

---

# 4. DIRECT FTC OPTION

## Advantages

- official National Registry source;
- full local control of matching/audit;
- low marginal query latency after local ingestion;
- first five area-code subscriptions are currently free under FTC fee structure;
- Jacksonville/St. Augustine pilot geography can potentially stay within a small number of area codes;
- daily Full/Change data supports fresh local cache.

## Limitations

- requires valid organization registration/SAN and certification;
- National Registry only does not solve every state-specific/line-type/calling-window/provider-policy need;
- browser interactive lookup is not appropriate as the production automation architecture;
- SOAP change-list automation requires Registry-specific setup/WSDL;
- YAD must securely ingest/store/use the Registry only for permitted DNC-prevention purposes;
- list synchronization/retention/audit become YAD operational responsibilities.

## Suggested direct architecture

```text
FTC subscription/SAN
-> scheduled Full List bootstrap
-> daily Change List ingestion where configured
-> normalized local NationalDncSet
-> point-of-action local lookup
-> RegistryScreenResult
-> ChannelEligibilityDecision
```

Do not expose the local NationalDncSet to reps, Sales AI, analytics, or prospect ranking.

---

# 5. LOCAL NATIONAL DNC DATA MODEL

If direct FTC integration is used, do not store the Registry as normal prospect records.

Use a protected purpose-limited lookup structure.

Conceptual:

```text
NationalDncSnapshot
- snapshot_id
- source = FTC_NATIONAL_DNC
- subscription_reference / SAN reference stored securely or indirectly
- subscribed_area_codes
- source_generated_at / downloaded_at
- full_or_change
- applied_at
- record_count
- checksum
- next_required_sync_at
- status
```

Phone membership should be queryable without exposing the raw dataset to ordinary application surfaces.

Potential implementation:

- protected table / partition;
- hashed/indexed representation only if compatible with update/delete operations and policy requirements;
- encrypted disk/database controls;
- restricted service account;
- no generic export endpoint.

Claude should choose the storage representation after inspecting expected list size and current PostgreSQL environment.

---

# 6. CHANGE LIST INGESTION

FTC documentation describes Change List records that indicate:

- telephone number;
- timestamp;
- `A` for Added;
- `D` for Deleted.

Apply changes idempotently.

Requirements:

- never drop current snapshot before new snapshot/change batch validates;
- validate file/source/checksum where available;
- transactionally apply add/delete changes;
- retain ingestion audit without retaining unnecessary raw files indefinitely;
- alert if sync age exceeds policy threshold;
- do not silently continue AI outbound when required DNC data becomes stale.

---

# 7. COMMERCIAL COMPLIANCE API OPTION

A commercial provider can simplify:

- real-time point-of-dial checks;
- National DNC;
- state DNC lists;
- wireless/line-type data;
- reassigned-number data;
- calling-hour/holiday/emergency rules;
- internal DNC orchestration;
- audit/reporting.

Potential providers found during architecture research include:

## PossibleNOW / DNCSolution

Public materials describe an API-first DNC/compliance product supporting National/state DNC, wireless status, calling curfews and additional enterprise compliance capabilities depending on plan.

References:

- https://www.possiblenow.com/products/dncsolution/
- https://developer.possiblenow.com/agreements

Treat pricing/onboarding/current API semantics as `TO_VERIFY` before implementation.

## Contact Center Compliance / DNC.com

Public materials describe REST/API and bulk/real-time scrubbing against federal/state/internal DNC plus additional number/compliance services.

References:

- https://www.dnc.com/dncscrub/
- https://contactcentercompliance.mintlify.app/introduction

Treat pricing/onboarding/current response semantics as `TO_VERIFY` before implementation.

## theDNCproject.org

Public documentation advertises a REST API for National DNC, selected state DNC and litigator checks with JSON batch requests.

Reference:

- https://thedncproject.org/api-documentation

This may be operationally fast to evaluate, but YAD must verify:

- legal/contract basis for registry access;
- data provenance;
- update SLA;
- state coverage;
- production reliability;
- security/privacy;
- indemnity/terms;
- actual pricing;
- whether its result semantics satisfy YAD/Twilio policy needs.

Do not treat marketing claims such as `100% accurate` as architecture truth.

---

# 8. CURRENT RECOMMENDATION

Implement the normalized provider interface now and avoid locking the code to any one source.

Recommended sequence:

## Step A — immediately

Implement:

- internal YAD DNC adapter;
- provider interface;
- normalized RegistryScreenResult;
- cache/TTL;
- current human vs AI eligibility;
- mock/fixture provider for deterministic tests.

This work does not require choosing the production provider first.

## Step B — inspect available credentials tonight/tomorrow

Claude should determine whether YAD already has:

- FTC telemarketer/seller organization profile;
- SAN;
- subscribed area codes;
- DNC file-download access;
- any existing DNC vendor credentials.

Do not ask Michael unless the actual environment/account audit cannot resolve it.

## Step C — preferred production direction

Use one of these reviewed paths:

### Direct FTC + supplemental providers

Best if YAD wants source control and can operate the registry sync itself.

National DNC can be local/official, while separate providers handle line type/state/RND/other policy inputs.

### Established commercial compliance API

Best if YAD wants one point-of-action service covering more compliance dimensions and can obtain acceptable pricing/onboarding quickly.

The normalized adapter allows replacement later.

---

# 9. TOMORROW PILOT DECISION

For the **real AI cold-call pilot**, the code being ready is not enough.

If current policy/Twilio usage requires a DNC screen and YAD has neither:

- valid direct FTC Registry access/current data; nor
- a reviewed commercial screening provider/credential,

then the correct release classification is:

`INTERNAL_AI_TEST_ONLY`

until the required screening source is operational.

Human Assist remains separately evaluated under the `HUMAN_MANUAL_CALL` policy.

Do not convert missing DNC access into a fabricated `NO_MATCH`.

---

# 10. AREA-CODE STRATEGY

Because the initial real market is Jacksonville/St. Augustine, avoid paying for nationwide Registry coverage before the product proves itself unless operational/legal needs justify it.

Manager/market configuration should identify the destination area codes relevant to approved pilot territories.

The current FTC structure provides the first five area-code subscriptions free, which may be sufficient for a narrow regional proof if the organization's Registry access is properly established.

Do not infer destination state solely from area code when the actual policy needs a verified contact/business location; number portability exists.

---

# 11. TWILIO POLICY BOUNDARY

Twilio's current Voice Services Policy states that users placing telemarketing/advertising voice calls must not call numbers on applicable DNC lists/registries and that the caller is responsible for cross-checking the numbers.

Twilio Help Center also states Twilio does not maintain the user's DNC list or refuse the call automatically on the user's behalf.

References:

- https://www.twilio.com/en-us/legal/service-country-specific-terms/voice-sip
- https://help.twilio.com/articles/223183688

Architecture implication:

`Twilio accepted the API request` is not a compliance-screen result.

YAD must block the request before Twilio when the central decision is not ALLOW.

---

# 12. SOURCE-OF-TRUTH PRECEDENCE

For phone action screening:

1. active YAD explicit DNC/suppression — immediate block according to scope;
2. current authoritative/applicable Registry/provider screen required by policy;
3. reviewed state/provider rule inputs;
4. line/contact basis/calling-window inputs;
5. final deterministic ChannelEligibilityDecision.

A National DNC `NO_MATCH` is only one input.

It does not automatically mean an AI telemarketing call is allowed.

---

# 13. PROVIDER BENCHMARK FIELDS

For any commercial DNC provider test, capture:

- provider name/version;
- endpoint/batch semantics;
- National DNC coverage;
- state coverage;
- line-type coverage;
- RND coverage;
- calling-window/holiday/emergency coverage;
- update SLA;
- response latency p50/p95;
- error semantics;
- retry/idempotency behavior;
- audit receipt/reference;
- rate limits;
- pricing model;
- data retention/license restrictions;
- credential setup time;
- support/escalation;
- security posture;
- test fixture agreement vs expected results.

Do not select solely on price.

---

# 14. REQUIRED CLAUDE CHECKPOINT

Report:

1. Is there an existing FTC Registry organization/SAN?
2. Which area codes are currently subscribed?
3. Is there any DNC Full/Change list already available locally?
4. Is any commercial DNC provider credential already present?
5. Which adapter can be made production-usable fastest?
6. What is the exact missing external setup, if any?
7. Does `HUMAN_MANUAL_CALL` currently have enough policy/data to operate?
8. Does `AUTONOMOUS_AI_VOICE` currently have enough policy/data to operate?
9. What is tomorrow's release classification?

Do not paste SAN/password/API keys into GitHub or reports.

---

# 15. CORE RULE

**Build the provider abstraction first; use authoritative/reviewed DNC data second; never confuse complaint data with Registry membership; and never let missing screening data turn into permission to dial.**