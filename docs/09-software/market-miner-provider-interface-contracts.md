# Your AI Department — Market Miner Provider Interface Contracts

**Status:** Architecture authority  
**Purpose:** Define stable provider-neutral contracts so Claude can benchmark/swap SERP, Places, contact, Meta, telecom and other external vendors without leaking vendor-specific response shapes throughout the application.

---

# 1. PRINCIPLE

The core domain consumes normalized provider results.

Provider adapter responsibilities:

1. validate provider configuration;
2. map YAD request to provider request;
3. call provider;
4. record provider request/task/cost metadata;
5. validate provider response;
6. map into normalized observations;
7. preserve provider-native reference;
8. apply source retention policy.

Provider adapter does NOT:

- calculate canonical YAD score;
- create sales claims directly;
- decide campaign fit;
- merge Accounts blindly;
- make calls.

---

# 2. COMMON PROVIDER METADATA

Every adapter exposes:

```text
ProviderDescriptor
- provider_id
- provider_type
- adapter_version
- capabilities[]
- supported_countries[]
- pricing_model_reference
- terms_reviewed_at
- retention_policy_id
- health_state
```

Do not hard-code provider names into score rules.

---

# 3. COMMON REQUEST CONTEXT

```text
ProviderRequestContext
- request_id
- mining_job_id optional
- research_run_id optional
- account_id optional
- campaign_id optional
- budget_scope_id
- correlation_id
- requested_at
- actor/service
```

This supports cost attribution and tracing.

---

# 4. PAID SERP PROVIDER

Conceptual interface:

```text
submitPaidSearch(request) -> ProviderTask | PaidSearchResult
collectPaidSearch(provider_task_id) -> PaidSearchResult
```

Request:

```text
PaidSearchRequest
- query
- country
- language
- geography
- device
- requested_time_context optional
- result_depth
- mode: queue | live
```

Normalized result:

```text
PaidSearchResult
- provider_task_id
- requested_context
- resolved_context
- observed_at
- provider_generated_at
- cache_freshness_metadata optional
- paid_results[]
- local_services_results[]
- provider_cost
- raw_retention_reference optional
```

---

# 5. PAID RESULT

```text
PaidResultObservation
- provider_native_result_id optional
- result_type: search_ad | local_services_ad | local_sponsored | other_paid
- advertiser_name
- display_domain optional
- landing_url optional
- landing_domain optional
- phone optional
- headline/title optional
- description optional
- service_area optional
- position optional
- ad_label/provider_type evidence
- provider_reference
```

Unknown result types are not assumed paid.

---

# 6. SERP GEOGRAPHY

Provider adapter must return both:

- requested geography
- provider-resolved geography.

If provider silently resolves to materially different area:

- set warning/error
- do not treat observation as valid evidence for requested market until reviewed.

---

# 7. BUSINESS DISCOVERY PROVIDER

```text
searchBusinesses(request) -> BusinessDiscoveryPage
```

Request:

- category/query
- geography
- page/cursor
- field requirements.

Result candidates:

- source ID
- observed name
- website/domain where supplied
- phone where supplied
- address/geography
- category
- source reference
- provider retention class.

These are discovery candidates, not canonical Accounts.

---

# 8. GOOGLE PLACES-LIKE ADAPTER

Special rule:

- durable Place/source ID where current terms allow;
- fields stored/cached only under reviewed Google/provider policy;
- independently reacquire durable prospect facts from first-party/licensed sources.

The interface should allow provider-specific retention metadata per field/result.

---

# 9. ADVERTISER TRANSPARENCY PROVIDER

```text
lookupAdvertiser(request) -> AdvertiserEvidenceResult
```

Request:

- business/domain/advertiser identifier
- geography optional
- date range/currentness.

Result:

- advertiser identity evidence
- observed ad creatives/services where permitted
- dates/currentness
- source reference
- retention class.

No spend inference.

---

# 10. META AD EVIDENCE PROVIDER

```text
findMetaAds(request) -> MetaAdEvidenceResult
```

Capabilities may be unavailable for the desired ad class/region.

Adapter must support:

- `unsupported`
- `not_configured`
- `no_observation`
- `confirmed_observation`

Only confirmed approved-source observation supports active Meta score.

Do not convert unsupported/not-configured/no-result into `no_confirmed`.

---

# 11. CONTACT ENRICHMENT PROVIDER

```text
findContacts(request) -> ContactCandidate[]
```

Request:

- canonical domain/account identity
- target role categories
- location optional
- maximum results/credit budget.

Candidate:

- provider person ID
- name
- title
- department/seniority
- business email
- direct phone
- location
- provider confidence/freshness
- license/retention metadata.

Core contact resolver decides canonical Contact.

---

# 12. TELECOM LOOKUP PROVIDER

```text
lookupPhone(request) -> PhoneLookupResult
```

Fields where provider supports:

- normalized number
- validity
- line type
- carrier
- country
- provider reference/cost.

No policy decision inside adapter.

Compliance engine consumes normalized result.

---

# 13. WEBSITE FETCH PROVIDER

Internal/default can be native HTTP/browser implementation, but preserve interface:

```text
fetchPage(request) -> PageFetchResult
renderPage(request) -> RenderedPageResult
```

Request:

- URL
- max bytes
- timeout
- user agent/policy
- render mode.

Result:

- final URL
- status
- headers subset
- HTML/text according retention policy
- redirects
- fetch timestamp
- error class.

Extraction is separate from fetch.

---

# 14. LLM PROVIDER

Use provider-neutral model gateway:

```text
completeStructured(task) -> validated structured output
streamConversation(session) -> token/events
```

Task metadata:

- purpose
- model class
- schema
- prompt/compiler version
- timeout
- max output
- cost budget.

Core application should not rely on Anthropic/OpenAI raw response types everywhere.

---

# 15. BOOKING PROVIDER

```text
getAvailability(request) -> Slot[]
createBooking(request, idempotency_key) -> BookingResult
```

Success requires provider confirmation/booking ID.

Calendar provider may be Calendly/integration current at implementation time.

---

# 16. EMAIL/SMS PROVIDER

Interfaces expose:

- send
- status lookup where needed
- idempotency/provider message ID
- failure classification.

Channel policy enforced before adapter.

---

# 17. CRM PROVIDER

```text
upsertAccount
upsertContact
appendActivity
upsertOpportunity
createTask
```

Use YAD canonical IDs/idempotency mapping.

External CRM is a projection/integration, not the only canonical source for suppression/research history unless explicitly redesigned later.

---

# 18. PROVIDER ERROR MODEL

Normalize:

- rate_limited
- auth_failed
- invalid_request
- unsupported
- timeout
- provider_5xx
- quota_exhausted
- not_found
- schema_changed
- unknown_provider_error.

Each includes retryability and provider raw code/reference.

Do not make worker parse provider-specific strings globally.

---

# 19. PROVIDER HEALTH

Track:

- recent success rate
- latency
- rate-limit state
- auth/config state
- budget state
- parser/schema error rate.

Routing engine can avoid degraded provider.

Provider outage should not create false negative research.

---

# 20. PROVIDER COST

Adapter returns ProviderUsage for every billable operation where cost can be known/estimated.

Fields:

- operation
- units
- price basis/version
- estimated/actual
- amount/currency.

If provider bills asynchronously/monthly, reconcile later without deleting original estimate.

---

# 21. RETENTION POLICY

Every normalized field/result can reference:

- durable
- licensed
- transient
- identifier_only
- do_not_store_raw.

Adapter cannot decide to store prohibited raw data for “debugging convenience.”

---

# 22. FAKE ADAPTERS

Every provider interface needs deterministic fake implementation used by normal tests.

Fake returns:

- success
- delay
- rate limit
- failure
- schema edge cases
- duplicate results
- geography mismatch.

This lets orchestration tests run without money/network.

---

# 23. CONTRACT TESTS

Every real adapter runs shared contract tests:

- validates required config
- maps request context
- emits normalized error
- emits usage/cost
- preserves provider reference
- respects retention classification
- handles timeout
- handles rate-limit
- no core-domain score logic hidden inside adapter.

---

# 24. VERSIONING

Adapter version changes when:

- provider API endpoint changes
- parsing logic changes materially
- result mapping changes
- retention interpretation changes.

SearchObservation/ProviderUsage stores adapter version for incident analysis.

---

# 25. ACCEPTANCE

Claude may choose libraries/SDKs, but Market Miner implementation passes only if:

- providers can be swapped through stable interfaces;
- provider-specific raw shapes do not leak into score/Call Pack;
- failure becomes partial/unknown, not fabricated negative;
- cost/source/version are traceable;
- normal tests use fakes.
