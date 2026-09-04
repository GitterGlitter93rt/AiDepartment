# Your AI Department — Twilio Lookup Line Type Adapter Specification

**Status:** Initial line-type provider implementation authority  
**Date:** 2026-09-03  
**Provider:** Twilio Lookup v2 — Line Type Intelligence  
**Purpose:** Supply normalized telecom line-type evidence to the existing phone-screening orchestrator without treating carrier metadata as final contact permission.

---

# 1. PRODUCT DECISION

Use Twilio Lookup v2 Line Type Intelligence as the **first line-type adapter to implement/benchmark** because YAD already uses Twilio for telephony and the current Lookup API exposes the endpoint classes the compliance engine needs.

This does not make Twilio Lookup the DNC/compliance provider.

Correct architecture:

```text
PhoneEndpoint
-> Internal suppression
-> Basic validation
-> Twilio Line Type Intelligence where required
-> DNC/state/compliance provider(s)
-> reviewed policy
-> HUMAN_MANUAL_CALL decision
-> AUTONOMOUS_AI_VOICE decision
```

Line type is one input, never the final permission decision.

---

# 2. OFFICIAL SOURCES REVIEWED

Current Twilio documentation reviewed:

- `https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence`
- `https://www.twilio.com/docs/lookup/quickstart`
- `https://www.twilio.com/docs/lookup/v2-api`
- `https://www.twilio.com/docs/lookup/v2-api/line-type-override`
- current Lookup pricing page.

Twilio documentation/pricing should be revalidated before production spend.

---

# 3. API

Current Lookup v2 request shape:

```text
GET /v2/PhoneNumbers/{PhoneNumber}?Fields=line_type_intelligence
```

Authentication:

- server-side Twilio API key/secret or approved server auth;
- never browser exposed;
- never placed in Call Pack.

Basic Lookup can validate/normalize number before paid Line Type Intelligence lookup.

---

# 4. CURRENT PROVIDER TYPES

Twilio currently documents possible `type` values including:

- `landline`
- `mobile`
- `fixedVoip`
- `nonFixedVoip`
- `personal`
- `tollFree`
- `premium`
- `sharedCost`
- `uan`
- `voicemail`
- `pager`
- `unknown`

Normalize into YAD enum without throwing away the provider original value.

Suggested YAD type:

```text
LANDLINE
MOBILE
FIXED_VOIP
NON_FIXED_VOIP
PERSONAL
TOLL_FREE
PREMIUM
SHARED_COST
UNIVERSAL_ACCESS
VOICEMAIL
PAGER
UNKNOWN
```

Store carrier name/code only when provider returns it and retention policy allows.

---

# 5. DO NOT CONFUSE LINE TYPE WITH PERSON OWNERSHIP

A `mobile` result means mobile telecom service.

It does NOT prove:

- owner personally uses the number;
- number belongs to the named Contact;
- number is a private personal line;
- number is a business mobile;
- consent exists.

Likewise `landline` does not prove:

- business line;
- correct company;
- current stakeholder.

Keep separate:

- endpoint provenance;
- company/person mapping;
- line type;
- business-use evidence;
- called-party class;
- final policy decision.

---

# 6. SCREENING STAGE / COST CONTROL

Do not run paid Line Type Intelligence on every discovered number.

Recommended flow:

## Discovery

- normalize E.164 locally / basic validation as needed;
- preserve source.

## Promotion to sales-ready

Run Line Type Intelligence when:

- Account meets campaign quality threshold;
- phone action may realistically occur;
- result is required for contact/channel policy.

## Immediate call preflight

Reuse within provider/policy TTL when valid.

Refresh only when:

- stale under policy;
- provider/version changed materially;
- endpoint correction occurred;
- policy requires current lookup.

Current published provider pricing is low per request but still nonzero; software should use configurable provider cost rather than hard-code current price.

Track cache hit rate and cost per eligible endpoint.

---

# 7. NORMALIZED PROVIDER RESULT

Map into existing `PhoneScreeningProviderResult`:

```text
provider_id = TWILIO_LOOKUP_V2
source_class = LINE_TYPE_PROVIDER
screen_type = LINE_TYPE
status
normalized_result
provider_original_type
carrier_name optional
mobile_country_code optional
mobile_network_code optional
error_code optional
checked_at
refresh_by
provider_request_reference
```

Provider lookup success with `type=unknown` becomes:

- provider status success;
- normalized line type `UNKNOWN`;

not `ERROR`, and definitely not `LANDLINE`.

Provider error remains error.

---

# 8. POLICY INPUT — NOT POLICY OUTCOME

Examples only; final values come from reviewed policy.

Potential interpretation:

## MOBILE / PERSONAL

May cause `AUTONOMOUS_AI_VOICE = REVIEW_REQUIRED/BLOCK` absent current affirmative consent/exemption policy.

Human-call decision remains separate.

## LANDLINE / FIXED_VOIP

May satisfy a line-type prerequisite for a particular reviewed B2B policy class, but does not independently authorize AI voice.

## NON_FIXED_VOIP

May require additional review because destination/business context can be more ambiguous.

## TOLL_FREE

Often business-context signal, but still requires correct company + channel policy.

## UNKNOWN

Cannot be silently treated as safer class.

This adapter supplies facts; the policy pack decides.

---

# 9. BASIC VALIDATION BEFORE PAID LOOKUP

Use free/basic Lookup or equivalent canonical validation when useful to catch:

- invalid number;
- malformed input;
- unexpected country;
- normalization mismatch.

Do not pay for line-type lookup on a number already invalidated by canonical normalization/basic validation.

Twilio Lookup response provides canonical E.164/national formatting; compare with YAD normalized endpoint and flag unexpected mismatch.

---

# 10. OVERRIDES

Twilio supports Line Type Overrides.

Do **not** automatically write provider overrides because a prospect or rep says something inconsistent.

Preferred YAD behavior:

- store YAD-side correction/evidence first;
- flag provider disagreement;
- manager/admin may optionally submit provider override only with appropriate evidence/review.

Preserve:

- original provider result;
- YAD correction;
- override action/reason;
- actor;
- date.

Do not use override to force a number into a more permissive compliance category.

---

# 11. CACHING

Cache key:

`provider + normalized_e164 + data_package + provider_region/version`.

Result must include:

- checked_at;
- refresh_by per configured policy;
- provider version/API package;
- policy version that consumed it.

A new DNC request invalidates call permission immediately but does not require paid line-type rescreen.

---

# 12. ERROR BEHAVIOR

Normalize:

- invalid number;
- provider auth failure;
- rate limit;
- unsupported coverage;
- provider timeout;
- provider field error;
- unknown type.

For AI call preflight, if current policy requires line type and provider result is missing/stale/error:

`AUTONOMOUS_AI_VOICE != ALLOW`.

Do not convert provider outage into `landline` or `business` by inference.

---

# 13. PROVIDER USAGE ACCOUNTING

Track:

```text
provider = TWILIO_LOOKUP
package = LINE_TYPE_INTELLIGENCE
requests
cache_hits
provider_cost
valid_numbers
line_type_distribution
errors
eligible_human_endpoints_after_policy
eligible_ai_endpoints_after_policy
```

Do not use line-type distribution as demographic marketing intelligence.

---

# 14. PORTAL UI

Ordinary rep does not need carrier details.

Useful Account Detail / phone drawer labels might include:

- `Business line`
- `Mobile line`
- `VoIP line`
- `Line type unknown`

only if UX terminology matches actual evidence and does not overstate business/person ownership.

Channel status remains separate:

- Human Call Allowed
- AI Voice Review Required
- Do Not Call

Manager diagnostic can show:

- provider;
- line type;
- checked at;
- refresh status.

---

# 15. TEST FIXTURES

1. `landline` -> normalized LANDLINE, no automatic ALLOW.
2. `mobile` -> MOBILE; exact Contact ownership remains separate.
3. `fixedVoip` -> FIXED_VOIP.
4. `nonFixedVoip` -> NON_FIXED_VOIP.
5. `personal` -> PERSONAL.
6. `tollFree` -> TOLL_FREE.
7. `unknown` -> UNKNOWN, never landline fallback.
8. provider error -> ERROR, never NO_MATCH/safe.
9. invalid Basic Lookup -> skip paid line-type call.
10. fresh cache -> no duplicate provider spend.
11. Account/Contact correction does not rewrite provider result history.
12. Twilio credentials never appear in browser/log fixture output.
13. mobile + reviewed AI policy lacking consent basis -> AI remains non-ALLOW.
14. human channel can independently resolve differently from AI channel.
15. line-type result alone cannot satisfy DNC/state/provider screening gate.

---

# 16. CORE RULE

**Twilio Lookup can tell YAD what kind of telephone service an endpoint uses. It cannot tell YAD who owns the phone, whether the prospect consented, or whether an AI cold call is legal. Use it as a late-stage, cached screening fact inside the deterministic policy engine — not as a permission shortcut.**
