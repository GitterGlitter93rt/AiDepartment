# Your AI Department — DNC / Phone Compliance Provider Benchmark Plan

**Status:** Implementation benchmark authority  
**Date:** 2026-09-03  
**Implementation owner:** Claude Code  
**Architecture owner:** ChatGPT  

---

# 1. PURPOSE

Select the fastest trustworthy production path for phone screening while preserving YAD's provider-neutral architecture.

This benchmark compares:

- direct FTC National DNC ingestion;
- an established commercial compliance API;
- any already-configured provider discovered in the EdgeXpert/voice environment.

The benchmark is not intended to select the cheapest API in isolation.

It should answer:

> Which source can give YAD a current, auditable, operationally reliable screening result for the exact pilot market and channel with the least implementation risk and acceptable cost?

Read first:

- `outbound-sales-brain-dnc-provider-selection-current.md`
- `outbound-sales-brain-phone-screening-provider-interface-spec.md`
- `outbound-sales-brain-global-phone-channel-eligibility-dnc-spec.md`
- `TOMORROW-OUTBOUND-PILOT-PREFLIGHT-CURRENT.md`

---

# 2. CANDIDATE CLASSES

## A — Direct FTC National DNC

Potential shape:

```text
FTC organization/SAN
-> subscribed area codes
-> Full List bootstrap
-> Change List synchronization
-> protected local lookup
-> RegistryScreenResult
```

This is the National Registry source only. It may require supplemental adapters for:

- state-specific DNC;
- line type/wireless;
- reassigned-number data;
- calling-hour/holiday rules;
- carrier/provider-specific policy inputs.

## B — Commercial compliance platform

Examples currently identified for evaluation only:

- PossibleNOW / DNCSolution;
- Contact Center Compliance / DNC.com;
- other approved provider already used by YAD;
- another provider Claude can validate from current official documentation/contract.

Do not assume marketing-site capability equals contracted API capability.

## C — Lightweight/rapid API candidate

A smaller provider may be acceptable for an experiment only after checking:

- legal/contract basis;
- source provenance;
- update SLA;
- reliability;
- data security;
- API semantics;
- auditability;
- state coverage;
- pricing;
- support.

Never promote a rapid proof API to production merely because signup is easy.

---

# 3. PASS/FAIL REQUIREMENTS

A production candidate must pass all applicable hard requirements.

## Source legitimacy

- provider can state what authoritative/contracted data source underlies the result;
- terms permit YAD's intended use;
- YAD can retain the minimum normalized result/audit information needed;
- no prohibited resale/redistribution architecture is required.

## Result semantics

Must distinguish at least:

- match/block-type result;
- no match where the source truly supports that conclusion;
- not applicable;
- unknown;
- retryable error;
- blocking error.

A provider that returns ambiguous `success: true` without usable screening semantics is not sufficient.

## Freshness

- documented update/synchronization schedule;
- result timestamp;
- TTL/refresh strategy;
- YAD can detect stale/unavailable state.

## Availability

- production authentication method understood;
- reasonable uptime/support path;
- rate limits known;
- retries/idempotency possible;
- error behavior testable.

## Audit

- request/result can be correlated to YAD PhoneEndpoint and ChannelEligibilityDecision;
- provider reference/receipt where available;
- policy version retained separately.

## Security

- credentials stay server-side;
- no rep-browser direct provider calls;
- no requirement to expose raw registry membership to sales reps/Sales AI;
- data minimization compatible with YAD privacy architecture.

---

# 4. BENCHMARK DIMENSIONS

Score each candidate from 1–5 only after capturing factual notes.

Suggested weighting:

| Dimension | Weight |
|---|---:|
| Source/contract confidence | 20% |
| National + required state coverage | 15% |
| Result/error semantics | 12% |
| Freshness/update SLA | 10% |
| Integration/setup speed | 10% |
| Runtime latency/reliability | 8% |
| Auditability | 8% |
| Security/data governance | 7% |
| Supplemental number intelligence | 5% |
| Cost/economics | 5% |

Do not let cost override a weak source or ambiguous result.

The weighted score is a decision aid, not a substitute for hard fails.

---

# 5. DATA TO CAPTURE PER PROVIDER

`ProviderBenchmarkRecord`

- provider_id
- provider_name
- provider_class
- tested_at
- tested_by
- docs/contract version/date
- authentication model
- credential readiness
- setup steps
- onboarding lead time
- national_dnc_coverage
- state_dnc_coverage[]
- line_type_support
- reassigned_number_support
- calling_window_support
- holiday_emergency_rule_support
- internal_dnc_support
- query mode: single/batch/file
- max batch size
- rate limits
- p50 latency
- p95 latency
- timeout behavior
- error classes observed
- result timestamp/freshness fields
- update SLA
- audit/reference ID
- data retention terms summary
- pricing model
- estimated pilot cost
- estimated 1k/10k/100k screen cost where calculable
- support/escalation
- hard_fail_reasons[]
- weighted_score optional
- recommendation
- unresolved_questions[]

Do not place API keys, SAN credentials, passwords, or account secrets in this record.

---

# 6. TEST DATA POLICY

Provider benchmark must not require a batch of real unreviewed prospects.

Use:

1. provider-documented test/sandbox numbers where available;
2. YAD-controlled numbers when appropriate;
3. synthetic invalid-format/error cases;
4. a tiny legally/operationally approved validation set only if necessary.

Do not call any number during the screening benchmark.

This benchmark tests screening responses, not outreach.

---

# 7. REQUIRED SEMANTIC TESTS

For each provider/adaptor, prove or explicitly mark unsupported:

## Valid formatted endpoint

Input accepted and result normalized.

## Invalid number

Provider returns deterministic invalid/error result rather than false no-match.

## Timeout

YAD returns `ERROR_RETRYABLE`/policy-safe state, never `NO_MATCH`.

## Authentication failure

YAD does not silently degrade to allowed.

## Rate limit

Retry/backoff behavior understood.

## Stale cached result

YAD refreshes when policy requires.

## Internal DNC already active

External paid provider should be skipped when no additional screening is operationally required.

## Conflicting applicable source results

Highest applicable restriction wins; conflict is auditable/reviewable.

## Provider unavailable before AI call

If current policy requires that provider/source, `AUTONOMOUS_AI_VOICE` must not be ALLOW.

---

# 8. DIRECT FTC BENCHMARK

If valid YAD Registry access exists, test:

- organization/SAN access confirmed without exposing secret values;
- Jacksonville/St. Augustine relevant subscribed area codes;
- Full List download method;
- Change List download method;
- file format(s);
- source timestamp;
- ingestion time;
- protected local lookup latency;
- incremental A/D application;
- snapshot age alert;
- restart recovery;
- failure behavior if change sync fails;
- storage footprint;
- backup/restore behavior;
- deletion/change correctness;
- source access/usage constraints.

Direct FTC candidate should report separately what it **does not** cover.

Do not call it a full phone compliance engine merely because National DNC matching works.

---

# 9. COMMERCIAL API BENCHMARK

For each commercial candidate:

- confirm official API documentation exists;
- confirm the exact contracted endpoint/capability YAD would use;
- map response fields into normalized YAD result;
- test timeout/auth/rate-limit/error paths;
- verify whether response distinguishes federal/state/internal/line-type/etc.;
- record whether each result is current point-in-time or cached;
- record provider audit ID/reference;
- capture pricing only from current authoritative quote/docs/dashboard when available;
- identify minimum contract/commitment/onboarding requirement.

If current pricing is unavailable, mark `TO_VERIFY`; do not invent a per-lookup rate.

---

# 10. PILOT-SPECIFIC DECISION

Tomorrow's first possible real AI pilot is narrow:

- geography: Jacksonville/St. Augustine area;
- vertical: HVAC;
- tiny reviewed cohort;
- concurrency 1;
- exact current endpoint preflight.

Benchmark recommendations may therefore be:

## `DIRECT_FTC_PILOT_READY`

Valid current official source and required supporting policy inputs exist for the pilot class.

## `COMMERCIAL_PROVIDER_PILOT_READY`

Reviewed provider credential + tested semantics are operational.

## `HYBRID_PILOT_READY`

Direct National DNC plus supplemental reviewed adapters satisfy current pilot inputs.

## `INTERNAL_TEST_ONLY`

Required authoritative/provider screen is unavailable or unverified.

The recommendation for tomorrow does not permanently lock the long-term provider architecture.

---

# 11. COST MODEL

Track costs at the point they matter:

- one-time/setup/subscription cost;
- area-code/subscription cost where applicable;
- per-query or credit cost;
- minimum monthly spend;
- supplemental line-type/RND/state costs;
- engineering/operations burden;
- cost per actual call-ready endpoint;
- avoided duplicate lookups through cache.

Do not compare a full-service compliance platform's raw price directly to National-DNC-only local lookup without noting capability differences.

---

# 12. FINAL RECOMMENDATION FORMAT

Claude returns:

```text
Recommended pilot path:
Long-term preferred architecture:
Why:
Hard fails eliminated:
Coverage:
Credential readiness:
Observed latency:
Cost model:
Missing capabilities:
Operational burden:
Rollback/fallback:
Tomorrow release effect:
```

If two providers are close, prefer the one with clearer semantics, source confidence and auditability over superficial feature count.

---

# 13. STOP CONDITIONS

Do not select a provider when:

- source provenance is unclear;
- terms do not support intended use;
- provider turns errors into apparent clean results;
- required state coverage is falsely implied;
- update SLA is unknown for a time-sensitive registry result;
- credentials would have to live in browser/client code;
- audit correlation is impossible;
- provider requires YAD to expose or reuse registry data for marketing/targeting;
- the only evidence of capability is sales copy with no usable technical/contract confirmation.

---

# 14. CORE RULE

**Benchmark the screening source as compliance infrastructure: source, semantics, freshness, reliability and auditability first; setup speed and price second.**