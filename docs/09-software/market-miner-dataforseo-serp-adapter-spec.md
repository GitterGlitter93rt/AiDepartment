# Your AI Department — Market Miner DataForSEO SERP Adapter Specification

**Status:** Initial provider implementation authority  
**Date:** 2026-09-03  
**Provider:** DataForSEO  
**Purpose:** Define the first concrete Google SERP provider adapter for advertiser-first Market Miner discovery while preserving the provider-neutral Market Miner architecture.

---

# 1. PRODUCT DECISION

Use DataForSEO as the **first provider adapter to implement/benchmark** for structured Google SERP discovery.

This is not a permanent vendor lock.

The canonical Market Miner continues to depend on provider-neutral interfaces.

Provider choice is evaluated by:

- advertiser evidence quality;
- business identity resolution quality;
- location fidelity;
- SERP feature coverage;
- operational reliability;
- latency where relevant;
- cost per usable researched Account.

---

# 2. OFFICIAL SOURCES REVIEWED

Current provider documentation reviewed:

- `https://dataforseo.com/help-center/getting-started-with-google-search-engine-api-documentation`
- `https://docs.dataforseo.com/v3/serp/google/organic/task_post/`
- `https://docs.dataforseo.com/v3/serp-google-overview/`
- `https://docs.dataforseo.com/v3/serp-se-type-live-advanced/`
- `https://dataforseo.com/help-center/supported-serp-features`
- `https://dataforseo.com/help-center/countries-and-locations-serp-api`
- `https://docs.dataforseo.com/v3/serp-se-locations/`
- `https://docs.dataforseo.com/v3/serp/google/ads_search/live/advanced`

Provider documentation wins if endpoint details change.

---

# 3. MODE SELECTION

DataForSEO supports two broad delivery modes for Google SERP data:

- **Standard** — queued task POST + later GET or provider callback/postback;
- **Live** — immediate response in a single request.

YAD default:

## Market Miner background/autopilot

Use `STANDARD` mode by default.

Reason:

- bulk/queued workload;
- lower-cost provider path;
- no rep waiting on result;
- worker/job architecture already exists.

## On-demand manager `Research More` / validation

May use `LIVE` when:

- result freshness is needed immediately;
- task count is small;
- spend controls permit;
- provider health is good.

Do not use Live across all background queries merely because it is simpler to code.

---

# 4. GOOGLE ENDPOINT FAMILY

Initial discovery source:

Google Organic SERP `advanced` function because provider docs state it returns structured SERP items including paid results and SERP features.

Canonical provider request shape includes:

- keyword/query;
- location;
- language;
- device;
- optional depth;
- provider task tag/id when supported;
- Standard priority where applicable.

Use provider `regular` function only if benchmark proves it supplies all fields YAD requires at lower cost/complexity.

Do not use raw HTML parsing as the default when structured advanced items already supply needed evidence.

---

# 5. LOCATION FIDELITY

DataForSEO Google SERP supports location targeting compatible with Google geographical targeting and also coordinate-based location inputs according to current docs.

YAD geography engine resolves canonical geography before provider request.

Possible request modes:

- location code;
- location name;
- coordinates where supported/appropriate.

Store:

```text
provider_location_code
provider_location_name
requested_geo_id
requested_zip_city_county_state
coordinates_if_used
```

Do not equate national United States results with Jacksonville/ZIP-level results.

The provider locations endpoint can be cached as reference data and refreshed periodically.

---

# 6. LANGUAGE / DEVICE

Initial U.S. market default:

- `language_code = en`;
- `device = desktop` for baseline discovery.

Do not assume desktop and mobile SERPs are identical.

Later benchmark mobile selectively if:

- advertiser evidence materially differs;
- vertical behavior suggests mobile-specific paid placement;
- added cost provides measurable prospect value.

Do not double every query desktop+mobile by default before evidence justifies it.

---

# 7. DEPTH / COST CONTROL

Provider documentation notes billing scales with requested result depth.

YAD initial advertiser discovery should request only the depth necessary to capture high-intent paid/local-service presence and enough organic/local context for identity resolution.

Default principle:

`smallest depth that reliably captures required evidence`.

Provider adapter must estimate/log:

- requested depth;
- provider cost returned;
- query purpose;
- Market/Campaign;
- usable Accounts produced.

Do not increase depth globally to improve recall without cost/quality review.

---

# 8. NORMALIZED ITEM TYPES

Provider may return structured items such as:

- `paid`;
- `organic`;
- `local_services`;
- `local_pack`;
- map/local results;
- other SERP features.

Normalize provider-specific item type into YAD source observation types.

Examples:

```text
GOOGLE_PAID_SEARCH
GOOGLE_LOCAL_SERVICES
GOOGLE_ORGANIC
GOOGLE_LOCAL_PACK
GOOGLE_OTHER_SERP_FEATURE
```

Only paid/LSA-equivalent evidence contributes the applicable paid-ad Module 4C signals.

Organic/local presence is useful for identity/discovery but is **not** proof of paid advertising.

---

# 9. ADVERTISER EVIDENCE

For each claim-safe paid observation capture:

- provider;
- query;
- geography;
- device;
- timestamp;
- provider item type;
- displayed business/domain/URL/text where legally/storage-policy permitted;
- position/rank where useful;
- evidence strength;
- raw provider task/reference;
- freshness TTL.

Observation is not yet canonical Account identity.

Entity resolution must map the observation to one Account before scoring.

Do not state:

- spend;
- campaign budget;
- ROAS;
- lead volume;
- profitability;

from a paid SERP observation.

---

# 10. GOOGLE ADS TRANSPARENCY / ADS SEARCH

DataForSEO also exposes a Google Ads Search endpoint based on Google Ads Transparency data according to current docs.

Treat this as a **secondary evidence/validation adapter**, not a replacement for live high-intent SERP observation.

Potential uses:

- validate advertiser identity;
- inspect broader ad activity/history where permitted;
- supplement current campaign evidence.

Do not infer that historical Transparency data means a company is bidding on a specific YAD query today.

---

# 11. STANDARD TASK WORKFLOW

Canonical background flow:

```text
MarketQueryPlan
-> DataForSEO task_post batch
-> store provider task IDs + expected retrieval time
-> job transitions WAITING_PROVIDER
-> provider result retrieval or configured callback/postback
-> validate provider status
-> normalize observations
-> entity resolve
-> durable evidence
-> score/research
```

Standard POST can batch tasks according to provider limits.

YAD should batch logically by:

- campaign/market;
- priority;
- provider mode;
- compatible configuration.

Do not mix unrelated experiments into one opaque batch if it harms attribution.

---

# 12. LIVE WORKFLOW

On-demand flow:

```text
manager Research More / provider validation
-> spend/permission check
-> single Live task
-> structured result
-> normalize observations
-> persist
-> existing page refreshes progressively
```

Existing inventory remains usable while Live request runs.

Live provider failure must not blank the market page.

---

# 13. PROVIDER STATUS / ERRORS

DataForSEO responses include provider task status metadata.

Adapter normalizes into:

- `SUCCESS`;
- `RETRYABLE_PROVIDER_ERROR`;
- `INVALID_REQUEST`;
- `AUTH_FAILURE`;
- `RATE_LIMITED`;
- `NO_RESULTS`;
- `UNKNOWN_PROVIDER_ERROR`.

Persist provider status code/message for admin diagnostics, not ordinary rep UI.

Retry policy belongs to worker/provider adapter, not the LLM.

---

# 14. AUTHENTICATION / SECRETS

Provider credentials:

- server-side only;
- secret-managed/env-configured;
- never committed;
- never returned to portal;
- never placed in Call Pack/prompt.

Settings UI may show:

- configured yes/no;
- account/provider health;
- last success;
- spend summary where implemented.

Never display raw password/token after entry.

---

# 15. PROVIDER USAGE ACCOUNTING

Each task or batch should link to `ProviderUsage`/equivalent:

```text
provider = dataforseo
endpoint_family
mode = STANDARD | LIVE
priority
query_count
depth
market_id
campaign_id
requested_at
completed_at
provider_cost
status
accounts_discovered
paid_observations
usable_accounts_after_dedupe
```

Key derived metrics:

- cost/query;
- cost/paid observation;
- cost/unique Account;
- cost/Tier B+ Account;
- cost/contactable Account;
- cost/usable named decision-maker Account later.

Raw cheap SERPs are not automatically good value.

---

# 16. QUERY DEDUPE / CACHE

Before provider spend:

Compute canonical query fingerprint from:

- provider/search engine;
- query;
- geography;
- language;
- device;
- depth/mode elements that affect result semantics.

If sufficiently fresh equivalent observation already exists:

- reuse according to Market Miner freshness policy;
- do not spend again merely because another rep clicked Search.

`Research More` may explicitly authorize refresh when stale/coverage-thin.

---

# 17. PROVIDER CALLBACK / POSTBACK

DataForSEO Standard mode supports polling and provider notification/postback patterns according to current docs.

YAD V1 can choose:

- worker polling; or
- authenticated public provider callback/postback if the provider mechanism and public webhook gateway are configured.

Do not introduce public callback complexity if simple worker polling meets the required throughput/cost.

If callback is used, route it through the provider-neutral public webhook ingress architecture rather than exposing worker/admin APIs.

---

# 18. PROSPECT FACTORY INTEGRATION

DataForSEO returns observations, not final sales records.

Never skip canonical pipeline:

`SERP item`
-> `SourceIdentity candidate`
-> `Account entity resolution`
-> `website/business validation`
-> `evidence ledger`
-> `Module 4C score`
-> `research completeness`
-> `contact research`
-> `Call Pack`.

Provider does not own:

- Account identity;
- Tier;
- decision-maker truth;
- phone directness;
- opportunity hypothesis truth.

---

# 19. FIRST BENCHMARK — JACKSONVILLE / ST. AUGUSTINE HVAC

Use the canonical acceptance market first.

Test a controlled query matrix around high-intent HVAC terms such as current Market Miner query authority specifies.

Compare:

- Standard advanced;
- limited Live advanced validation sample;
- optionally SerpApi/other approved provider later.

Record:

- paid/LSA observations;
- unique businesses;
- entity-resolution success;
- false positives;
- duplicate rate;
- Tier distribution;
- website resolution;
- provider cost;
- latency.

Do not weaken Tier B+ target to create a round number.

---

# 20. ACCEPTANCE TESTS

1. paid item -> GOOGLE_PAID_SEARCH observation;
2. organic item -> never scored as paid ad;
3. local_services item -> mapped separately;
4. duplicate business across queries -> one Account, many observations;
5. same query fresh cache -> no second provider spend;
6. different ZIP/location -> distinct query fingerprint;
7. provider auth failure -> no destructive inventory effect;
8. no results -> valid no-result outcome, not system failure;
9. raw provider spend recorded;
10. provider secret absent from logs/API response;
11. stale observation does not remain current advertiser forever;
12. background Standard task survives worker restart;
13. Live Research More failure leaves existing inventory visible;
14. paid item cannot create spend/ROI claim;
15. response item identity mismatch routes to entity-resolution review rather than wrong Account.

---

# 21. CORE RULE

**DataForSEO is a structured observation provider. Use Standard mode for economical background discovery, Live mode selectively for immediacy, preserve location/query provenance and provider cost, and always pass results through YAD's canonical identity/evidence/scoring pipeline before a business becomes a prospect.**
