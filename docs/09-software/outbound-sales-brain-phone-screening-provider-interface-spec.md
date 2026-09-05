# Your AI Department — Phone Screening Provider Interface & Orchestration Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Implementation owner:** Claude Code  
**Architecture owner:** ChatGPT

---

# 1. PURPOSE

Define a provider-neutral screening layer that can evaluate a canonical `PhoneEndpoint` against the registries, internal suppression records, provider/carrier requirements, and channel-specific policy inputs required before YAD exposes a phone action to a human rep or sends an outbound request to Twilio.

This layer belongs to the Prospect Factory / Sales Brain, not to Twilio handlers.

The system must support changing screening vendors or adding state-specific adapters without rewriting the Sales Portal or realtime voice service.

---

# 2. CORE RULE

Screening is not lead generation.

Do not use screening data to:

- rank prospect attractiveness;
- personalize outreach;
- infer demographics;
- enrich sales copy;
- change Module 4C fit score.

Screening answers only whether a particular phone action can proceed under the current policy context.

---

# 3. ARCHITECTURE

```text
Canonical PhoneEndpoint
        |
        v
Phone Screening Orchestrator
        |
        +--> Internal YAD Suppression Adapter
        +--> Applicable Registry Adapter(s)
        +--> State/Local Policy Adapter(s) where configured
        +--> Line Type / Number Intelligence Adapter
        +--> Provider/Carrier Policy Adapter where applicable
        |
        v
Normalized RegistryScreenResult(s)
        |
        v
Deterministic Channel Eligibility Engine
        |
        +--> HUMAN_MANUAL_CALL
        +--> AUTONOMOUS_AI_VOICE
        +--> SMS when implemented
```

The orchestrator gathers normalized screening evidence. The policy engine makes the final channel decision.

Do not let any third-party vendor response become the final sales decision by itself unless the configured policy explicitly defines that result as blocking.

---

# 4. PROVIDER INTERFACE

Conceptual interface:

```text
PhoneScreeningProvider
- provider_id
- provider_version
- capabilities()
- screen(request) -> PhoneScreeningProviderResult
- health()
```

`capabilities()` should declare what the adapter can actually answer, for example:

- national_registry
- state_registry
- internal_suppression
- line_type
- reassigned_number_risk
- business_number_classification
- provider_policy_screen
- timezone_hint

Never assume one provider covers all policy needs.

---

# 5. SCREEN REQUEST

`PhoneScreeningRequest`

Required:

- `screening_request_id`
- `phone_id`
- normalized `e164`
- `account_id`
- `contact_id` optional
- destination country
- destination state/territory when known
- business location/timezone context when known
- endpoint type
- endpoint source/freshness
- intended channel
- intended communication technology
- contact basis
- campaign ID
- policy version
- requested_at

Optional:

- provider/telephony destination context
- known line type
- prior screening IDs still within TTL
- current relationship state
- requested callback evidence

Do not send unnecessary prospect research or sales notes to a screening provider.

---

# 6. NORMALIZED PROVIDER RESULT

`PhoneScreeningProviderResult`

Fields:

- `provider_result_id`
- `provider_id`
- `provider_version`
- `phone_id`
- `source_class`
- `screen_type`
- `status`
- `normalized_result`
- `reason_code`
- `checked_at`
- `valid_until` or `refresh_by`
- `jurisdiction_scope`
- `source_reference` where appropriate
- `raw_retention_class`
- `error_class` optional
- `provider_request_reference` optional

Normalized `status`:

- `MATCH`
- `NO_MATCH`
- `NOT_APPLICABLE`
- `UNKNOWN`
- `ERROR_RETRYABLE`
- `ERROR_BLOCKING`

Important:

`ERROR_*` and `UNKNOWN` must never be converted to `NO_MATCH`.

---

# 7. SOURCE CLASSES

Initial source classes:

- `YAD_INTERNAL_DNC`
- `YAD_ACCOUNT_SUPPRESSION`
- `FEDERAL_REGISTRY`
- `STATE_REGISTRY`
- `LOCAL_OR_SPECIAL_REGISTRY`
- `LINE_TYPE_PROVIDER`
- `REASSIGNED_NUMBER_PROVIDER`
- `CARRIER_PROVIDER_POLICY`
- `MANUAL_POLICY_REVIEW`

The architecture must support more than one result per phone number.

Final channel eligibility applies the highest applicable restriction.

---

# 8. INTERNAL SUPPRESSION FIRST

Before any paid/external lookup:

1. normalize phone;
2. check exact phone suppression;
3. check Contact suppression;
4. check Account-wide suppression;
5. check campaign/global exclusions.

If an applicable durable YAD DNC already blocks the intended call:

- stop further screening when no additional audit need exists;
- do not spend provider credits merely to reconfirm a number YAD already must not call.

---

# 9. SCREENING TIMING

Do not automatically screen every number at discovery time.

Recommended stages:

## Discovery

Store endpoint and source only.

## Sales-ready promotion

Run lower-cost number-quality/line-type checks when required by campaign policy.

## Human manual call preflight

Re-evaluate current internal suppression and required human-call screening before exposing the call action.

## Autonomous AI voice preflight

Require current screening and policy result immediately before the Twilio request according to configured TTL and policy version.

This keeps screening cost aligned with prospects that are actually going to be contacted.

---

# 10. CACHING / TTL

Screening results may be cached only according to source-specific policy.

Each result must carry:

- checked_at
- valid_until / refresh_by
- policy version
- provider version.

A cached result may be reused only when:

- same normalized endpoint;
- source/result still within TTL;
- applicable jurisdiction unchanged;
- policy version permits reuse;
- no newer suppression or prospect instruction exists.

A new YAD DNC invalidates downstream positive eligibility immediately regardless of external screening TTL.

---

# 11. COST CONTROL

Track:

- screening provider calls;
- cost per lookup;
- cache hit rate;
- duplicate lookup avoidance;
- screenings per actual human call attempt;
- screenings per AI call attempt;
- screening errors;
- cost per eligible endpoint.

Do not repeatedly rescreen a number because a rep reloads a page.

Use idempotency keys around active preflight windows.

---

# 12. PROVIDER FAILURE

If screening vendor is unavailable:

## Autonomous AI voice

Fail closed when the missing screen is required by current policy.

Return:

`REVIEW_REQUIRED` or `BLOCK`

with reason such as:

- `required_registry_screen_unavailable`
- `screening_provider_error`
- `screening_result_stale`

Do not call Twilio.

## Human manual call

Apply the current reviewed human-call policy.

If that policy requires the unavailable screen, return `REVIEW_REQUIRED`/`BLOCK`.

Do not silently treat the human channel as exempt merely because it is manual.

---

# 13. PROVIDER ABSTRACTION

Claude should not hard-code the Sales Portal against one commercial DNC vendor.

Provider-specific modules map into the normalized contract.

Example conceptual directory:

```text
phone-screening/
  orchestrator
  types
  adapters/
    internal-suppression
    registry-provider-a
    registry-provider-b
    line-type-provider
  policy-evaluator
  cache
  audit
```

Actual module naming may follow the repository's implementation conventions.

---

# 14. SECURITY / DATA MINIMIZATION

- provider credentials server-side only;
- never expose screening provider keys to browser;
- minimize raw registry/provider payload retention;
- encrypt/protect screening audit where appropriate;
- rep UI receives only action-level result/reason language;
- Sales AI never receives raw registry membership data;
- logs should use internal phone ID/redacted endpoint where practical.

---

# 15. REP UI TRANSLATION

Provider details are normally hidden from reps.

Translate final decision into operational labels:

- `Human Call Allowed`
- `AI Voice Allowed`
- `Email Only`
- `Review Required`
- `Do Not Call`

Optional manager/admin detail:

- evaluated at
- policy version
- reason category
- refresh required

Do not show a giant list of raw registry responses in the ordinary sales view.

---

# 16. TWILIO BOUNDARY

Twilio outbound service accepts a request only with:

- phone_id;
- account_id;
- campaign_id;
- current `AUTONOMOUS_AI_VOICE = ALLOW` decision ID;
- policy version;
- Call Pack ID/version;
- no active suppression.

The voice service should revalidate the decision or call the central eligibility endpoint immediately before initiating the provider call.

It must not independently recreate DNC logic from scattered local config.

---

# 17. MANUAL CALL BOUNDARY

Sales Portal exposes the manual call action only after server-side human-call preflight.

On ALLOW:

- create pre-call ContactAttempt/event;
- bind eligibility decision ID;
- return the permitted display/dial endpoint;
- UI may open `tel:` on the rep device.

On BLOCK/REVIEW:

- do not expose active call action through the normal workflow;
- provide reason-safe UI;
- route review when appropriate.

---

# 18. REDISCOVERY / DEDUPE

If the same phone arrives from:

- Google;
- website crawl;
- Airtable import;
- Apollo;
- gatekeeper correction;
- another saved market,

resolve to the existing canonical PhoneEndpoint where identity supports it.

Existing DNC/screening history remains attached.

A new source does not reset eligibility.

---

# 19. REQUIRED FIXTURES

At minimum:

1. Internal DNC hit stops external paid lookup and blocks human + AI according to scope.
2. External registry MATCH blocks the affected channel under configured policy.
3. External registry NO_MATCH does not by itself authorize AI voice; remaining policy inputs still evaluated.
4. Provider ERROR does not become NO_MATCH.
5. Stale cached result triggers refresh before required call.
6. Same endpoint rediscovered from import reuses canonical screening/suppression history.
7. Two simultaneous preflight requests deduplicate provider lookup where possible.
8. Human ALLOW and AI REVIEW_REQUIRED can coexist for one endpoint.
9. Human policy requiring unavailable registry screen returns REVIEW/BLOCK rather than silent allow.
10. Twilio rejects a request without a current ALLOW decision.
11. Rep portal does not expose suppressed phone action.
12. New YAD DNC invalidates previously cached ALLOW immediately.

---

# 20. IMPLEMENTATION CHECKPOINT

Claude should report:

- provider(s) available in current environment;
- whether federal/state registry access credentials exist;
- adapter interfaces implemented;
- internal suppression lookup behavior;
- cache/TTL model;
- normalized result storage;
- human preflight behavior;
- AI/Twilio preflight behavior;
- fixture results;
- external dependency blockers;
- per-lookup cost configuration if known from the selected provider.

Do not invent provider capabilities or credentials.

---

# 21. CORE RULE

**Screen only when useful, normalize every source, fail safely on required unknowns, and make the central Sales Brain — not Twilio, not the rep's phone, and not a vendor — the authority for phone-channel eligibility.**