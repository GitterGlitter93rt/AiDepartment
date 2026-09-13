# Your AI Department — Google SERP / Advertiser Normalization Specification

**Status:** Architecture authority  
**Purpose:** Convert provider-specific Google search responses into provider-neutral paid-ad, Local Services, local, organic, and identity observations for the Market Miner.  
**Implementation owner:** Claude Code

---

# 1. WHY THIS LAYER MATTERS

DataForSEO, SerpApi, or another provider may represent the same Google result differently.

The rest of YAD must not depend directly on vendor response shapes.

Provider adapter outputs must normalize into canonical observations before:

- advertiser evidence
- dedupe
- identity resolution
- query yield analysis
- scoring
- Call Pack generation.

---

# 2. RESULT TYPES

Canonical:

- `PAID_SEARCH_TEXT`
- `PAID_LOCAL`
- `LOCAL_SERVICES_AD`
- `SHOPPING_OR_IRRELEVANT_PAID`
- `LOCAL_ORGANIC`
- `ORGANIC`
- `MAPS_LOCAL`
- `KNOWLEDGE_OR_ENTITY`
- `OTHER`

Only eligible paid business result types contribute to current Google advertiser evidence.

---

# 3. SEARCH OBSERVATION CONTEXT

Every normalized result inherits:

- search_task_id
- provider
- provider_response_id
- engine
- requested_query
- query_family
- requested_location
- resolved_location if provider returns it
- market/search cell
- language
- device
- observed_at
- result_position/block position
- result_type

No ad claim may lose its query/geography/time context.

---

# 4. PAID OBSERVATION OBJECT

`PaidSearchObservation`

- observation_id
- search_task_id
- result_type
- advertiser_name_observed
- headline(s)
- description(s) where allowed/needed
- display_url
- observed_click_url
- resolved_final_url optional
- root_domain optional
- phone optional
- service_area optional
- rating/review metadata optional if provider terms allow
- offer/service classification
- ad_position
- current_observation = true
- identity_resolution_status
- source_retention_class
- raw_provider_reference

Store minimal normalized evidence needed for YAD purpose and source policy.

---

# 5. LOCAL SERVICES ADS

LSA observations may include:

- business name
- phone
- rating/reviews
- service category
- service area
- hours/status
- Google guarantee/screened labels where returned.

Do not treat LSA badge/status as a YAD credential or broad quality guarantee.

LSA is strong evidence of current paid acquisition at observation time.

It still does not reveal spend, profitability, or lead quality.

---

# 6. PAID LOCAL / MAP RESULTS

Some providers expose sponsored local/map businesses separately.

Normalize as paid only when provider/result clearly indicates sponsored/advertised status.

Do not classify ordinary Google local pack results as paid.

---

# 7. TEXT AD IDENTITY

Text ad may expose:

- advertiser/display name
- display domain
- click/redirect URL
- destination domain after safe redirect resolution.

Identity resolution should favor:

1. final first-party landing domain
2. independently verified website/company relationship
3. phone/address/business identity
4. advertiser label

Do not merge based only on similar ad headline.

---

# 8. SAFE REDIRECT RESOLUTION

Redirect resolution must obey crawler/SSRF policy.

Record:

- original URL
- each safe public redirect host as needed
- final URL
- redirect failure reason

Do not access:

- localhost
- private RFC1918 ranges
- link-local
- cloud metadata
- internal DNS/private endpoints
- unsupported schemes.

---

# 9. LEAD-GEN / AGGREGATOR ADS

Examples:

- “Find top local roofers”
- generic legal directory
- comparison marketplace.

Normalize paid observation to the aggregator itself unless an underlying contractor/firm is explicitly and independently attributable.

Do not give contractor Google +4 because an aggregator bought the ad.

Aggregator may be excluded from target campaign later by noise layer.

---

# 10. DUPLICATE ADS IN ONE SERP

One advertiser may occupy multiple ad units.

Store individual observations if analytically useful, but identity grouping should know they may represent one advertiser in one search.

For fit score:

Google paid signal = yes once.

For advertiser strength:

multiple placements may be a supporting observation but should not be over-weighted as independent auctions without care.

---

# 11. DUPLICATE ADS ACROSS QUERIES

Same advertiser in:

- emergency AC
- AC repair
- AC replacement

becomes three SearchObservations tied to one Account after identity resolution.

This strengthens advertiser-evidence breadth.

It does not create three prospects or +12 Google score.

---

# 12. SERVICE / OFFER CLASSIFICATION

Normalize ad context into:

- service family
- offer family
- urgency
- financing/promotion signal
- campaign landing-page context.

Use active vertical profile vocabulary.

If classification unclear:

`unknown`.

Do not hallucinate service from business name.

---

# 13. LAW PRACTICE AREA

Law paid observations require practice-area context.

Example:

query = `divorce lawyer Orlando`

observed landing page = family-law page

Normalize:

`practice_area = family_law/divorce`

The Account may practice other areas, but this ad observation belongs to family-law context.

---

# 14. HAIL MARKET CONTEXT

PDR/Hail observation stores:

- market
- hail/storm service
- current observation time
- landing page market context.

Old observation does not automatically apply to future storm.

---

# 15. ORGANIC RESULT USE

Organic/local results may help:

- resolve website
- discover businesses in non-ad gap-fill mode
- verify identity.

They do not create paid-ad evidence.

---

# 16. AD STATUS AGGREGATION

Account-level current Google ad state is derived from eligible fresh observations.

Possible:

- `CONFIRMED_CURRENT`
- `HISTORICAL_ONLY`
- `UNKNOWN_CURRENT`
- `CONFLICTED`

Avoid `NO_ADS` unless a source/method legitimately establishes a negative state, which ordinary sampled SERP absence usually does not.

---

# 17. ADVERTISER STRENGTH FEATURES

May derive:

- number of fresh distinct query families
- high-intent vs generic query mix
- LSA present
- paid search present
- number of geography cells
- repeated observation windows
- service-specific landing pages.

These features rank advertiser evidence only.

They do not estimate spend.

---

# 18. PROVIDER DIFFERENCE TESTS

Same synthetic Google page represented in DataForSEO-like and SerpApi-like fixtures should normalize to equivalent canonical observations.

Provider-specific metadata remains available separately.

---

# 19. RAW RESPONSE RETENTION

Raw provider response retention follows source terms/retention policy.

Normalized internal facts should store only what YAD is permitted/needs.

Every normalized field keeps provider/source lineage.

---

# 20. ERROR HANDLING

Unknown/changed provider result type:

- capture as `OTHER`/unparsed
- log parser version/error
- do not silently mark as organic or paid
- allow adapter update.

Provider schema changes should trigger tests/alerts.

---

# 21. ACCEPTANCE TESTS

1. Standard sponsored text ad -> PAID_SEARCH_TEXT.
2. LSA -> LOCAL_SERVICES_AD.
3. ordinary local pack -> LOCAL_ORGANIC, no paid evidence.
4. provider A/B representations of same ad -> equivalent canonical output.
5. aggregator ad -> aggregator identity, no guessed contractor.
6. redirect to actual contractor site -> safe resolution + identity evidence.
7. redirect to private IP -> blocked, no fetch.
8. same advertiser in 4 queries -> one Account + 4 observations.
9. law PI vs divorce ad -> correct practice-area observation.
10. historical observation outside TTL -> not current ad claim.
11. unknown provider item type -> OTHER + parser alert.
12. 5 ad observations -> Google Module 4C still +4 once.

---

# 22. CORE RULE

A paid-search observation is evidence that a specific advertiser appeared in a specific search context at a specific time. Everything more ambitious than that must be derived cautiously and audibly.
