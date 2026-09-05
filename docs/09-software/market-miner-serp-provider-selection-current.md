# Market Miner — Current SERP Provider Selection

**Status:** Current implementation preference, provider-neutral architecture retained  
**Date:** 2026-09-03  
**Purpose:** Give Claude a concrete first provider to implement/benchmark for advertiser-first Market Miner discovery instead of leaving the entire discovery layer credential-blocked.

---

# 1. CURRENT DECISION

Use **DataForSEO as the first provider to integrate and benchmark** for Google advertiser-first Market Miner discovery.

Keep the provider interface swappable. Do not hard-code YAD business logic to DataForSEO response shapes.

SerpApi or another approved structured provider remains a fallback/validation candidate if the benchmark reveals quality, locality, coverage or operational gaps.

---

# 2. WHY THIS PROVIDER FIRST

Current DataForSEO documentation exposes structured Google SERP endpoints that can return paid + organic results and dedicated Google Ads Search / Google Ads Advertisers data, with explicit location parameters and Live/Standard execution modes.

That maps well to YAD's initial needs:

- search `service + geography`;
- capture paid/sponsored advertiser observations;
- distinguish observed paid result from organic result;
- support location-specific requests;
- run lower-cost queued bulk jobs for 24/7 market replenishment;
- use Live mode only for small on-demand validation/search experiences when needed.

Provider claims are still evidence observations, not proof of spend, profitability or lead quality.

---

# 3. IMPLEMENTATION SHAPE

Add provider adapter behind existing Market Miner interface, conceptually:

`DataForSeoSerpAdapter`

Responsibilities:

- normalize provider authentication/config;
- send approved query matrix items;
- map location/geography parameters;
- normalize paid/organic result types;
- preserve provider result IDs/check URLs where permitted/useful;
- emit `SearchObservation` records;
- report provider cost/usage metadata to `ProviderUsage`;
- never directly create duplicate Accounts without entity resolution;
- never convert a paid-result observation directly into a permanent current-ad claim without freshness/evidence rules.

---

# 4. MODE POLICY

Default background Market Miner:

- use Standard/queued provider mode where it meets refresh SLA;
- schedule asynchronously;
- respect provider and YAD budgets;
- persist normalized observations/results;
- allow retries through durable job system.

On-demand `Research More` / validation:

- Live mode may be used when manager/rep needs a fresh bounded result and provider budget permits;
- UI must not block existing inventory while the request runs.

Do not use Live mode for every 24/7 bulk query by default.

---

# 5. AUTH / CONFIG

Server-side only:

- DATAFORSEO_LOGIN
- DATAFORSEO_PASSWORD
- provider base URL/config
- mode/priority defaults
- per-market/query budget controls
- enabled flag

Never place provider credentials in frontend JS/HTML.

---

# 6. NORMALIZATION REQUIREMENTS

Normalize provider output into YAD records such as:

- query
- location
- device if relevant
- observed_at
- result_type: paid | organic | lsa | other where supportable
- advertiser/domain/business clues
- displayed URL / landing URL as available
- rank/position
- provider source/ref
- raw confidence/source metadata
- freshness TTL

Provider-specific raw fields may be stored under controlled diagnostics if permitted, but product logic uses normalized fields.

---

# 7. GOOGLE ADS TRANSPARENCY / ADVERTISER DATA

Dedicated Ads Search / Advertisers endpoints may be useful for:

- corroborating advertiser identity;
- observing creative/ad presence;
- advertiser-first research beyond one local search-result snapshot.

Treat this as separate evidence from a current local paid-search observation.

Do not collapse:

- `advertiser exists in transparency data`

into

- `this company is currently bidding on this exact local high-intent query`.

Both can contribute to Advertiser Evidence Strength, but they are different claims.

---

# 8. BENCHMARK BEFORE SCALE

Run a bounded Jacksonville/St. Augustine HVAC benchmark against manually inspectable queries.

Measure:

- paid-result precision;
- company/domain identity match rate;
- geography relevance;
- duplicate rate before/after entity resolution;
- local service/LSA handling where available;
- freshness;
- error/timeout rate;
- cost per usable unique advertiser Account;
- throughput using Standard vs Live modes.

Do not invent target percentages before results exist.

---

# 9. COST GOVERNANCE

Provider pricing is configuration/operations data, not Sales AI prompt data.

Track actual provider-reported/request-derived cost in `ProviderUsage` where available.

Manager budget controls should support:

- daily/monthly cap;
- per-market cap;
- per-query-mode cap;
- stop/pause when cap reached;
- no unlimited user-triggered `Research More`.

---

# 10. SOURCE GOVERNANCE

Before production scale, complete the existing source-governance review for the provider and chosen endpoints:

- current terms/licensing;
- data retention/storage rights;
- acceptable use;
- attribution requirements if any;
- rate limits;
- credential handling;
- incident/retry behavior.

Provider selection does not waive source governance.

---

# 11. ACCEPTANCE

A provider integration is ready for initial Market Miner use when:

- credentials stay server-side;
- one bounded query returns normalized paid/organic observations;
- location targeting works;
- cost/usage is recorded;
- entity resolution prevents duplicate Account creation;
- fresh paid evidence can contribute to current advertiser strength;
- stale evidence ages correctly;
- provider outage does not erase existing inventory;
- research jobs retry/fail visibly;
- no provider response can bypass Account/DNC/ownership history.

---

# 12. CORE RULE

**Use DataForSEO first because it maps cleanly to YAD's structured advertiser-first discovery problem, but keep the Market Miner provider-neutral and benchmark truth/quality before expanding spend.**
