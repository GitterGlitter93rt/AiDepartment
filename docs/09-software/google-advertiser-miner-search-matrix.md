# Your AI Department — Google Advertiser Miner Search Matrix

**Status:** Architecture/test specification  
**Purpose:** Define exactly how Claude should search Google for active advertisers, avoid wasteful query explosions, and produce auditable advertiser observations before enrichment/scoring.

---

# 1. PRIMARY OBJECTIVE

The advertiser miner should answer:

> Which businesses are currently paying to appear for high-intent customer-acquisition searches in this target market?

It should NOT attempt to prove that every business advertising on Google has been found.

It should produce an evidence-backed set of observed advertisers with enough geographic/query coverage to create a high-quality premium prospect pool.

---

# 2. QUERY FAMILIES

Each vertical must define a small set of commercially meaningful query families.

For HVAC V1:

## Family A — Urgent repair

- AC repair
- emergency AC repair
- emergency HVAC
- no cool repair
- furnace repair
- heat pump repair

## Family B — High-ticket replacement/install

- AC replacement
- HVAC replacement
- air conditioner installation
- heat pump installation
- new AC system

## Family C — Category/general

- HVAC contractor
- HVAC company
- heating and cooling
- air conditioning contractor

## Family D — Offer/finance intent

- AC financing
- HVAC financing
- air conditioning specials

Do not treat every synonym as an equally valuable query. Maintain a priority rank by expected customer value and urgency.

---

# 3. GEOGRAPHIC QUERY TARGETS

Every search observation needs a geographic context.

Supported levels:

- metro/city;
- ZIP/ZCTA;
- smaller coordinate search cell;
- county where provider supports useful localization.

V1 should begin with city + selected ZIP/ZCTA coverage before generating a dense coordinate grid.

Example Jacksonville/St. Augustine pilot:

- Jacksonville, FL
- St. Augustine, FL
- selected high-population/high-value Jacksonville ZCTAs
- selected St. Johns County ZCTAs

The geography engine decides the actual list from Census/reference data.

---

# 4. THREE-PASS SEARCH STRATEGY

Do not brute force 30 keywords across 100 ZIPs immediately.

## PASS 1 — Market discovery

Run the highest-value 5–8 query families at city/metro level.

Goal:

- discover obvious advertisers;
- establish advertiser density;
- find common domains/brands;
- estimate whether deeper geographic decomposition is worthwhile.

HVAC example priority set:

1. emergency AC repair
2. AC repair
3. AC replacement
4. HVAC contractor
5. HVAC financing
6. heat pump installation

## PASS 2 — Geographic expansion

For markets with meaningful advertiser density, repeat the top-performing/high-value query families across selected ZCTAs/search cells.

Prioritize cells based on:

- population/business density;
- service area relevance;
- distance from target market center;
- previously low coverage;
- new-advertiser yield.

## PASS 3 — Gap/saturation probing

Only run lower-priority synonyms or additional cells if:

- new advertiser yield remains material;
- inventory target has not been met;
- coverage confidence remains low.

Stop when saturation/budget rules trigger.

---

# 5. QUERY BUDGETING

Each Mining Job receives:

- maximum SERP-task budget;
- maximum provider dollar budget;
- target number of unique advertisers;
- target number of Tier A/B final prospects.

Suggested control variables:

- `max_serp_tasks`
- `max_provider_cost`
- `target_unique_advertisers`
- `target_ready_prospects`
- `min_new_advertiser_yield`
- `saturation_window`

Example:

If the last 25 searches yield only 2 previously unknown advertisers, new-advertiser yield = 8%.

If the configured stop threshold is 10%, the system can stop expanding that territory unless the target inventory is still unmet and budget remains.

---

# 6. AD OBSERVATION CONTRACT

Each sponsored result becomes an immutable observation.

Fields:

- `observation_id`
- `mining_job_id`
- `provider`
- `provider_task_id`
- `observed_at`
- `query`
- `query_family`
- `geography_id`
- `location_context`
- `ad_format`
- `advertiser_name_observed`
- `display_domain`
- `landing_url`
- `headline`
- `description`
- `phone_if_present`
- `service_or_offer_detected`
- `source_rank_position`
- `raw_result_reference`
- `retention_class`

Possible `ad_format` values:

- `SEARCH_TEXT_AD`
- `LOCAL_SERVICES_AD`
- `LOCAL_SPONSORED_RESULT`
- `UNKNOWN_PAID_FORMAT`

The canonical company is resolved later. Do not merge at observation ingestion time.

---

# 7. ADVERTISER CONFIDENCE

Aggregate observations into an advertiser-level signal.

Suggested classes:

## CONFIRMED_CURRENT

At least one recent paid search/LSA observation in the target market.

## CONFIRMED_REPEATED

Observed across multiple distinct queries, locations, or observation windows.

## TRANSPARENCY_CONFIRMED

Google Ads Transparency/provider evidence exists, but no recent target-market SERP observation is available.

## UNKNOWN

No positive evidence found or adapter unavailable.

There is intentionally no `NOT_ADVERTISING` conclusion from normal sampling.

---

# 8. OBSERVATION STRENGTH

Do not add extra public YAD fit points beyond the Sales Manual score, but retain a separate internal advertiser-strength dimension for ranking within the same manual tier.

Possible advertiser-strength factors:

- repeated paid observation across query families;
- LSA observation;
- high-intent urgent query;
- high-ticket replacement query;
- multiple geographic cells;
- recent observation;
- dedicated landing page;
- strong call/lead CTA.

Example internal advertiser strength:

`VERY_HIGH / HIGH / MODERATE / SINGLE_OBSERVATION`

This is used for queue ordering, not to change Module 4C's +4 Google score.

---

# 9. DOMAIN/ADVERTISER DEDUPE

Sponsored observations should be grouped using:

1. normalized landing/display domain;
2. independently resolved company identity;
3. normalized phone when present;
4. source-native business identity where available;
5. fuzzy advertiser name only as a fallback.

Important edge cases:

- one parent company advertises several local locations;
- one agency/lead-gen site routes leads to multiple contractors;
- tracking/redirect URL hides the final domain;
- same business advertises under different DBA names;
- franchise locations share a corporate domain.

Do not blindly merge all observations sharing a brand name.

---

# 10. WEBSITE RESEARCH TRIGGER

A unique advertiser should normally be queued for website research after identity resolution.

Research priority:

1. repeated Google advertiser;
2. LSA/high-intent advertiser;
3. single high-intent paid observation;
4. transparency-only advertiser;
5. organic/non-ad gap-fill business.

The crawler should research the business once per freshness period rather than once for every ad observation.

---

# 11. CALL HOOK EVIDENCE RULE

The caller may reference advertising only when the Call Pack contains a recent eligible observation.

Eligible example:

- `CONFIRMED_CURRENT`, observed within configured TTL.

Allowed:

> “I came across you guys advertising around emergency AC in Jacksonville...”

Not allowed if evidence is stale/unknown:

> “You guys are actively advertising...”

Fallback:

> Ask a vertical workflow question without referencing ad activity.

---

# 12. SEARCH-MATRIX ADAPTATION

The miner should learn which query families discover unique advertisers efficiently.

Track per query family/geography:

- searches run;
- paid results returned;
- unique advertisers returned;
- new advertisers returned;
- duplicate advertiser rate;
- later Tier A/B rate;
- later qualified-conversation rate.

Initially, adaptation only changes query priority within approved vertical dictionaries. It must not invent unrelated search terms autonomously without review.

---

# 13. HVAC SCORING FIXTURES

These fixtures test the canonical Sales Manual score. They should become automated tests.

## Fixture 1 — Premium emergency advertiser

Signals:

- confirmed Google paid search: +4
- confirmed Meta active ads: +3
- active on both: +1
- high-value economics: +2
- lead flow operationally important: +2
- emergency/24-7: +1
- appointment/estimate-heavy: +1
- multiple locations: +1
- growth/hiring: 0
- phone dependence: +1
- prominent form/booking: +1

Expected score: 16
Expected tier: A

Primary hypothesis: paid emergency lead handling / after-hours / attribution.

## Fixture 2 — Google-only strong local contractor

Signals:

- Google ads: +4
- Meta unknown: 0
- multichannel: 0
- high-value economics: +2
- important lead flow: +2
- emergency: +1
- estimate-heavy: +1
- multiple locations: 0
- growth: 0
- phone dependent: +1
- lead form: +1

Expected score: 12
Expected tier: A

## Fixture 3 — Meta-only replacement advertiser

Signals:

- Google unknown: 0
- Meta active: +3
- multichannel: 0
- high-value economics: +2
- important lead flow: +2
- emergency: 0
- estimate-heavy: +1
- multiple locations: 0
- growth: 0
- phone dependence: +1
- form/booking: +1

Expected score: 10
Expected tier: A

## Fixture 4 — No ad evidence, sophisticated multi-location HVAC

Signals:

- Google unknown: 0
- Meta unknown: 0
- multichannel: 0
- high-value economics: +2
- important lead flow: +2
- emergency: +1
- estimate-heavy: +1
- multiple locations: +1
- growth/hiring: +1
- phone dependence: +1
- lead form: +1

Expected score: 10
Expected tier: A

Purpose: prove advertising is important but not mandatory.

## Fixture 5 — Small basic contractor

Signals:

- no confirmed ads: 0
- high-value economics: +2
- important lead volume: 0
- emergency: 0
- estimate-heavy: +1
- multi-location: 0
- growth: 0
- phone dependence: +1
- form/booking: 0

Expected score: 4
Expected tier: C

## Fixture 6 — Advertising but weak fit/no durable business model

Signals:

- Google ad observation: +4
- Meta unknown: 0
- high-value economics: 0
- meaningful lead-flow importance: 0
- emergency: 0
- appointment/estimate: 0
- multiple locations: 0
- growth: 0
- phone dependence: 0
- form: 0

Expected score: 4
Expected tier: C

Purpose: paid advertising alone does not make every business a premium YAD prospect.

---

# 14. EVIDENCE TRAP FIXTURES

These are pass/fail research tests.

## Trap A — Pixel without ad observation

Website has Meta Pixel but Meta adapter finds no current evidence.

Correct output:

- Meta Pixel: confirmed frontend signal
- Meta active ads: UNKNOWN

Incorrect:

- Meta active ads: Yes

## Trap B — No sponsored result in sampled query

Company appears organically but not as sponsored for `AC repair Jacksonville`.

Correct:

- Google ad status: UNKNOWN unless positive evidence exists elsewhere

Incorrect:

- Google ads: No

## Trap C — ServiceTitan widget

Website contains ServiceTitan booking integration.

Correct:

- ServiceTitan frontend/booking signal detected
- backend CRM workflow: UNKNOWN

Incorrect:

- company uses ServiceTitan perfectly for CRM follow-up

## Trap D — Same company appears in six searches

Correct:

- six ad observations
- one canonical account/location structure after identity resolution

Incorrect:

- six separate prospects

## Trap E — Franchise brand

Same brand/domain, separate independently operated locations.

Correct:

- explicit parent/brand relationship
- separate callable locations if business/contact identity requires it

Incorrect:

- collapse all locations into one phone/account without review

## Trap F — Lead-gen domain

Paid result lands on a generic service-comparison site rather than the contractor's own domain.

Correct:

- lead-gen intermediary classified
- do not automatically attribute the ad to one contractor

Incorrect:

- guess which contractor paid for the ad

---

# 15. MINIMUM PILOT SEARCH PLAN

For the first Jacksonville/St. Augustine HVAC miner test:

1. Resolve pilot geography.
2. Run Pass 1 on six high-value query families in Jacksonville and St. Augustine.
3. Aggregate unique advertisers.
4. Select high-yield ZCTAs/search cells.
5. Run Pass 2 for the top four query families.
6. Stop/expand based on unique advertiser yield and budget.
7. Dedupe advertisers.
8. Research websites.
9. Score prospects.
10. Produce ranked Tier A/B queue.
11. Human audit a random sample before any phone integration.

Success is not “we ran 500 searches.”

Success is:

> a reproducible, explainable list of high-value advertisers with enough evidence to support a personalized sales hypothesis.
