# Your AI Department — Market Miner Autonomous Query Planner

**Status:** Architecture authority  
**Purpose:** Decide which geography/query/provider observations the Prospect Factory should request next, how much budget to spend, when to stop searching, and how to learn from yield without inventing new sales doctrine.  
**Implementation owner:** Claude Code

---

# 1. CORE IDEA

The Market Miner should not execute a static spreadsheet of keywords forever.

It needs a controlled planner that answers:

> Given this vertical, territory, campaign mode, prior search coverage, current ready inventory, provider cost, and downstream quality, what should we search next?

The planner is an optimization layer over approved vertical dictionaries.

It may change **priority and coverage**.

V1 may NOT autonomously invent unrelated services, change the canonical YAD score, broaden campaign geography without policy, or change compliance rules.

---

# 2. INPUT OBJECT

`QueryPlanningContext`

- campaign_id
- campaign_mode
- vertical_profile_id/version/hash
- territory_policy_id/version
- target_ready_inventory
- current_ready_inventory
- low_water_mark
- high_water_mark
- remaining_provider_budget
- provider_routing_policy
- search_cells[]
- approved_query_families[]
- previous_search_tasks[]
- unique_advertiser_yield_history
- Tier_B_plus_yield_history
- downstream_outcome_history where sufficient
- research freshness requirements
- current time / observation window
- exclusions
- emergency pause / kill state

---

# 3. PLANNING UNIT

A search task is not merely a keyword.

`SearchObservationTask`

- provider
- engine/source
- query_family
- rendered_query
- vertical
- geography_cell
- city/county/ZCTA/metro context
- device class where relevant
- language
- observation window
- requested result depth
- priority
- estimated cost
- reason_code
- previous comparable observation count
- expected information gain

Example:

`Google Paid SERP | emergency_ac_repair | "emergency AC repair Jacksonville FL" | Jacksonville core cell | mobile | fresh advertiser discovery`

---

# 4. APPROVED QUERY UNIVERSE

V1 query generation must come from:

1. active vertical profile search taxonomy;
2. reviewed service aliases;
3. geography variants;
4. approved intent modifiers;
5. explicit campaign additions reviewed by admin.

Allowed transformations:

- service + city
- service + nearby city
- service + ZCTA
- emergency/service modifier + city
- replacement/high-ticket modifier + city
- financing modifier + city
- commercial modifier + city
- practice-area + city for law
- storm/hail context + current market for PDR/Hail

Not allowed autonomously in V1:

- arbitrary LLM-created service categories;
- competitor names unless explicitly approved campaign strategy;
- deceptive queries designed to impersonate customers in private workflows;
- searches unrelated to the campaign vertical merely because they might return more businesses.

---

# 5. THREE-PASS SEARCH STRATEGY

## PASS 1 — MARKET PROBE

Purpose: cheaply discover advertiser density and high-yield query families.

Use:

- major market/city context;
- highest-intent approved queries;
- limited device/location variants;
- economical provider mode.

Collect:

- paid observations
- LSA observations where supported
- unique advertisers
- duplicate rate
- domain resolution rate
- query-family yield

Do not deep-crawl every result before dedupe.

## PASS 2 — COVERAGE EXPANSION

Purpose: expand into high-value search cells and service variants.

Select cells based on:

- population/service-market relevance;
- geographic coverage gaps;
- unique-advertiser yield;
- Tier B+ yield from already researched candidates;
- current inventory shortfall.

Run strongest query families across selected ZCTA/city/submarket cells.

## PASS 3 — LONG-TAIL / GAP FILL

Use only when:

- inventory remains below target;
- provider budget remains healthy;
- Pass 1/2 still show plausible additional yield;
- market is not saturated.

May include:

- secondary approved service aliases;
- financing/commercial variants;
- adjacent approved geography;
- non-advertiser gap fill according to campaign mode.

---

# 6. YIELD METRICS

Per `(vertical, territory, query_family, search_cell, provider)` track:

- tasks_run
- paid_observations
- unique_advertisers
- newly_discovered_accounts
- duplicate_observations
- invalid/non-fit candidates
- resolved_domains
- research_complete_accounts
- Tier_A_accounts
- Tier_B_plus_accounts
- cost
- later decision-maker reaches
- qualified conversations
- meetings
- opportunities

Initial planning should rely mainly on upstream metrics.

Downstream sales metrics gain weight only after sufficient samples.

---

# 7. INFORMATION-GAIN SCORE

The planner may calculate a transparent planning score for **search-task priority only**.

Suggested components:

- expected new-account yield
- expected current-advertiser yield
- expected Tier B+ yield
- geography coverage gap
- freshness need
- inventory deficit
- estimated provider cost
- duplicate/saturation penalty
- downstream quality adjustment when statistically mature

This score must never be presented as the prospect's YAD fit score.

---

# 8. SATURATION

A search family/cell may be marked:

- `UNTESTED`
- `EXPLORING`
- `PRODUCTIVE`
- `DECLINING`
- `SATURATED`
- `COOLDOWN`
- `REFRESH_DUE`

Suggested saturation evidence:

- multiple distinct approved queries have been run;
- provider pagination/result depth was meaningfully explored;
- recent tasks return mostly previously known accounts;
- marginal new-account yield falls below configured threshold;
- marginal Tier B+ yield falls below configured threshold.

Do not declare an entire metro permanently exhausted.

Saturation is time-bounded.

---

# 9. DIMINISHING-RETURN STOP RULE

Stop expanding a search block when a configurable rolling window shows poor marginal value.

Example policy concept:

- last N tasks produce < X new unique accounts;
- cost/Tier B+ exceeds campaign ceiling;
- duplicate rate exceeds threshold;
- ready inventory has reached high-water mark.

The actual thresholds belong in config and should be tuned from pilot data.

The planner must report why it stopped.

---

# 10. INVENTORY-AWARE PLANNING

If campaign target is:

`Maintain 250 Tier B+ research-ready HVAC prospects`

then:

- >= high-water: stop ordinary mining;
- between low/high water: refresh high-priority stale evidence, no aggressive expansion;
- < low-water: resume discovery;
- severe inventory shortage: broaden through approved Pass 2/3 rules;
- budget exhausted: pause and report shortfall.

Never silently lower `minimum_tier` merely to fill inventory.

---

# 11. TIME / DEVICE / LOCATION OBSERVATION

Paid search varies.

For advertiser evidence, retain:

- observation time
- provider-resolved location
- requested geography
- device
- query
- result type

V1 should not explode every search into every hour/device combination.

Sampling policy should use information value:

- repeat high-value queries across at least limited temporal/device variance during provider benchmark;
- later prioritize combinations that materially discover new advertisers.

---

# 12. VERTICAL-SPECIFIC QUERY BEHAVIOR

## HVAC / Plumbing

Prioritize urgent and high-ticket search families.

## Roofing

Prioritize roof replacement/repair, then storm/hail terms when market context supports them.

## Collision

Prioritize collision/body shop/auto body, estimate-intent and current hail where relevant.

## PDR/Hail

Require current market/storm context for storm-specific expansion. Permanent PDR searches may run separately.

## Law

Practice-area subrouter controls queries. Never blend practice-area advertiser evidence.

## Real Estate

Google-only mining may be incomplete. Query planner should allow mixed discovery strategies and not penalize a brokerage because Meta/portal channels dominate its acquisition model.

---

# 13. QUERY PROMOTION / DEMOTION

V1 planner may automatically:

- promote approved query families with better unique-advertiser/Tier B+ yield;
- demote approved query families with repeated low yield;
- expand productive families into uncovered cells;
- stop expensive low-value provider routes;
- refresh stale high-value advertiser evidence.

V1 planner may NOT automatically:

- delete a vertical query family from the profile;
- alter canonical scoring;
- change business truth rules;
- change campaign compliance.

Persistent profile changes require review.

---

# 14. NEW QUERY PROPOSALS

The learning system may produce proposals such as:

> Roofing pilot repeatedly found strong advertisers through `metal roof replacement`, which is not currently in the approved high-ticket family. Recommend adding it for review.

Proposal fields:

- candidate query
- vertical
- reason
- supporting observations
- expected value
- risk/noise review
- status: proposed / approved / rejected

Only approved queries enter production planning.

---

# 15. PROVIDER ROUTING

Planner chooses provider according to benchmarked policy.

Factors:

- result-type support
- cost
- freshness
- reliability
- location precision
- LSA support
- terms/storage constraints
- observed downstream yield

Fallback behavior:

- provider outage -> fallback if budget/policy allows;
- no fallback -> defer task, do not fabricate negative evidence.

---

# 16. AUDITABILITY

Every generated search task stores:

- planner version
- input context snapshot
- reason code
- priority components
- provider route
- estimated cost
- final cost
- result/yield

This allows YAD to answer:

> Why did the miner spend $18 searching these Jacksonville ZIPs yesterday?

---

# 17. FIRST IMPLEMENTATION TEST

For Jacksonville/St. Augustine HVAC:

1. use six approved high-value query families;
2. run market probe;
3. calculate yield by query/city;
4. expand best families into selected geography cells;
5. stop based on diminishing-return/inventory rules;
6. return search coverage report;
7. compare against a naive fixed search matrix.

Success:

- equal or better Tier B+ discovery at lower/equal cost;
- no unauthorized query creation;
- no hidden criterion relaxation;
- complete audit trail.
