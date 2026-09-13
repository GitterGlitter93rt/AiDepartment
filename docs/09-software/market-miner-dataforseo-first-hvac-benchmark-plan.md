# Your AI Department — First DataForSEO HVAC Benchmark Plan

**Status:** Initial live-provider benchmark authority  
**Date:** 2026-09-03  
**Market:** Jacksonville + St. Augustine, Florida  
**Vertical:** HVAC  
**Mode:** Research-only / Human Assist supply  
**Autonomous outreach:** OFF

---

# 1. PURPOSE

Prove that DataForSEO can economically produce the structured Google advertiser observations needed by the existing Market Miner acceptance pack.

This benchmark is not intended to spend the provider balance or brute-force the territory.

Questions:

1. Do structured paid/LSA items map cleanly into YAD observations?
2. Does localization produce useful Jacksonville/St. Augustine advertiser diversity?
3. Which HVAC query families yield new advertisers most efficiently?
4. How quickly does dedupe/saturation occur?
5. What is the actual provider cost per unique advertiser and Tier B+ researched Account?
6. Is Standard mode sufficient for autopilot, with Live needed only for validation/on-demand refresh?

---

# 2. CURRENT PROVIDER PRICE REFERENCE — DO NOT HARD-CODE

As reviewed September 3, 2026, DataForSEO publicly lists approximately:

- Google Organic / advertiser SERP Standard normal: `$0.0006` per first/base SERP request/page unit;
- Priority: `$0.0012`;
- Live: `$0.002`;
- free signup trial credit: `$1`;
- minimum paid top-up: `$50`;
- funded balance does not expire under current published terms.

Additional pages/parameters can change cost.

Software must use provider-returned/current pricing/cost accounting rather than these memo values.

Revalidate immediately before funding/production use.

---

# 3. MONEY DECISION

## Benchmark provider-spend ceiling

Set:

`max_provider_cost_usd = 2.00`

for the **entire first Jacksonville + St. Augustine HVAC benchmark**.

Expected actual SERP charges should be substantially below this if one-page/low-depth tasks are sufficient.

The $2 ceiling intentionally leaves room for:

- deeper pages when justified;
- limited Live validation;
- a few configuration mistakes/retries;
- location experiments.

If the worker predicts crossing $2:

- stop new provider tasks;
- preserve completed results;
- print yield/cost report;
- require manager approval to continue.

## Account funding

Do not interpret DataForSEO's current `$50 minimum top-up` as a $50 benchmark spend authorization.

If current $1 free credit is available, the benchmark should initially run inside that free credit.

If account funding is necessary:

- Michael may deposit the current provider minimum;
- YAD software still enforces the benchmark's `$2 max provider cost`;
- unused provider balance remains for later Market Miner work.

Do not enable auto-recharge for the first benchmark.

---

# 4. PHASE 0 — ADAPTER SMOKE TEST

Use provider sandbox/trial/live credential as appropriate.

Run **4–6 total requests maximum** covering:

- Jacksonville `emergency AC repair`;
- Jacksonville `AC replacement`;
- St. Augustine `AC repair`;
- St. Augustine `HVAC contractor`;
- optional one Live equivalent of a Standard query;
- optional location-code validation.

Verify before expanding:

- auth;
- location;
- language;
- paid item shape;
- `local_services` shape if present;
- organic item shape;
- provider task/status;
- cost capture;
- normalized observations;
- raw provider secrets absent from logs.

If parsing is wrong, stop here. Do not generate 100 bad tasks.

---

# 5. PHASE 1 — CITY-LEVEL DISCOVERY

Use the existing canonical Pass 1 query set from the HVAC search matrix:

1. `emergency AC repair`
2. `AC repair`
3. `AC replacement`
4. `HVAC contractor`
5. `heat pump installation`
6. `HVAC financing`

Geographies:

- Jacksonville, FL
- St. Augustine, FL

Total baseline:

`6 queries x 2 city contexts = 12 Standard tasks`

Default:

- Standard normal;
- desktop;
- English;
- shallowest depth that returns required paid/LSA/identity context.

At current reference base pricing, 12 first-page Standard tasks are only a fraction of a cent; actual provider cost is recorded from runtime/provider accounting.

Outputs:

- paid observations;
- LSA observations;
- unique observed advertiser names/domains;
- duplicates across queries;
- provider cost/query;
- new advertiser yield/query family.

---

# 6. PHASE 1 DECISION

After 12 city tasks, calculate:

```text
unique_advertisers
paid_observations
new_advertisers_per_query
query_family_yield
jacksonville_vs_st_augustine_density
duplicate_rate
```

If essentially no useful paid observations:

- verify location/request semantics;
- run limited Live/manual comparison;
- do not immediately expand ZCTAs.

If density is meaningful:

continue to geographic expansion.

---

# 7. PHASE 2 — SELECTED ZCTA / SEARCH-CELL EXPANSION

Do **not** hard-code an arbitrary fixed list in this plan.

Geography engine first resolves prioritized Duval/St. Johns ZCTAs/search cells based on current geography authority.

Initial expansion cap:

`max_search_cells = 20`

Use only the **top four** city-level query families by combined:

- customer-intent value;
- unique-advertiser yield;
- low duplicate rate.

Expected maximum initial tasks:

`20 cells x 4 query families = 80 Standard tasks`

But use adaptive stop before 80 when saturation appears.

Priority example, not hard-coded:

- emergency AC repair;
- AC repair;
- AC replacement;
- HVAC contractor or another city-level winner.

Do not run all 18+ HVAC synonyms in every cell.

---

# 8. SATURATION STOP

Use existing Market Miner rule.

Track a rolling window such as last 20–25 tasks:

```text
new_advertiser_yield = previously_unknown_advertisers / tasks
```

Default first-benchmark stop signal:

- new advertiser yield below approximately 10% over the configured saturation window;
- AND no high-value under-covered geography remains;
- OR enough advertiser pool exists to continue research toward ready inventory;
- OR provider cost ceiling approaches.

This threshold remains config/experiment data, not permanent doctrine.

Report exact numerator/denominator.

---

# 9. PHASE 3 — GAP / SYNONYM PROBE

Only if:

- ready inventory target remains materially short;
- recent new-advertiser yield remains useful;
- provider cost budget remains;
- prior phases indicate specific gaps.

Maximum additional Standard tasks for first benchmark:

`100`

Potential additional query families come only from the approved HVAC matrix, e.g.:

- emergency HVAC;
- no cool repair;
- HVAC replacement;
- air conditioner installation;
- new AC system;
- heat pump repair;
- AC financing.

Do not automatically use all of them.

Select based on measured Phase 1/2 gaps.

---

# 10. LIVE VALIDATION SAMPLE

Live mode is not the background default.

Use at most:

`20 Live tasks`

for controlled comparisons such as:

- same keyword/location Standard vs Live;
- immediate manager refresh behavior;
- location discrepancies;
- current-ad freshness verification.

At current public base pricing, 20 Live requests are still only a few cents, but cost must come from provider accounting.

Do not turn Live mode on for the whole miner after one successful request.

---

# 11. ABSOLUTE TASK CEILINGS — FIRST BENCHMARK

Unless manager explicitly expands:

```text
phase_0_smoke_max = 6
phase_1_city = 12
phase_2_zcta_max = 80
phase_3_gap_max = 100
live_validation_max = 20
absolute_total_task_max = 218
max_provider_cost_usd = 2.00
```

Task ceiling and dollar ceiling both apply.

Whichever hits first stops new tasks.

Because current base rates are very low, **quality/saturation should normally stop the benchmark long before money does**.

---

# 12. OBSERVATION NORMALIZATION ACCEPTANCE

For sample results manually verify:

- `paid` -> GOOGLE_PAID_SEARCH;
- `local_services` -> GOOGLE_LOCAL_SERVICES;
- `organic` never becomes paid;
- paid landing/display domain retained correctly;
- query/location/timestamp provenance attached;
- provider task ID attached;
- paid observation does not create spend/ROI claim.

At least 20 observations/results should be manually inspected if enough exist.

---

# 13. ENTITY-RESOLUTION BENCHMARK

After observations:

Measure:

- unique provider advertiser labels;
- unique domains;
- canonical Accounts created/matched;
- aliases merged;
- unresolved identities;
- lead-gen/aggregator suspects;
- franchise/multi-location ambiguities.

Manual audit at least 20 ready/high-value Accounts when available.

Do not count raw ad rows as businesses.

---

# 14. WEBSITE / SCORE BENCHMARK

For canonical advertisers continue normal pipeline:

- website validation;
- first-party research;
- Module 4C score;
- Tier;
- research completeness;
- public contact resolution;
- hypothesis + hook;
- Human Assist readiness.

Report funnel:

```text
provider tasks
-> paid/LSA observations
-> unique observed advertisers
-> canonical HVAC Accounts
-> website-resolved Accounts
-> Tier A/B
-> good/complete research
-> contact-ready
-> READY_HUMAN_ASSIST
```

---

# 15. ECONOMIC REPORT

Required:

```text
provider_cost_total
cost_per_task
cost_per_paid_observation
cost_per_unique_observed_advertiser
cost_per_canonical_account
cost_per_tier_B_plus
cost_per_ready_human_assist_account
```

Also report cost by:

- query family;
- city/ZCTA/cell;
- Standard vs Live.

A provider can be cheap per SERP and still bad if identity/advertiser quality is poor.

---

# 16. QUERY-YIELD TABLE

Minimum columns:

```text
query_family
geography
tasks
provider_cost
paid_observations
lsa_observations
unique_advertisers
new_advertisers
duplicate_rate
tier_B_plus_after_research
ready_human_assist
new_advertiser_yield
saturation_status
```

This becomes input to future query-priority decisions.

---

# 17. PASS / FAIL

## PASS — provider adapter

- structured paid/LSA data reliable enough for canonical observation contract;
- location works;
- provider costs captured;
- no secret leak;
- retries/cache work;
- Standard queued mode survives worker lifecycle.

## PASS — Market Miner proof

- canonical Accounts resolve with acceptable precision;
- paid evidence manually validates;
- Module 4C/research pipeline works;
- useful Tier B+ Human Assist inventory emerges;
- query yield/saturation is explainable.

## FAIL / REVIEW

- organic repeatedly classified paid;
- locality unreliable;
- aggregators repeatedly assigned to wrong businesses;
- duplicate identity rate unmanageable;
- provider responses/cost cannot be reconciled;
- results materially worse than alternative provider benchmark.

---

# 18. NO OUTREACH

This benchmark is research-only.

It must not:

- auto-call;
- auto-email;
- add to Smartlead without separate action;
- submit prospect forms;
- create fake customer interactions.

Ready Accounts become inventory only.

---

# 19. CORE RULE

**The first DataForSEO benchmark should spend pennies, not dollars, to prove the entire advertiser-to-Account pipeline. Use the six canonical city queries first, expand geography only when yield justifies it, stop on saturation, and judge the provider by cost per trustworthy Tier B+ researched Account rather than raw SERP volume.**
