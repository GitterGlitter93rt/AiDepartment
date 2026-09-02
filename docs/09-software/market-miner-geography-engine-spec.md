# Your AI Department — Market Miner Geography Engine Specification

**Status:** Architecture authority  
**Purpose:** Define how the Market Miner converts a business territory request such as “HVAC in Jacksonville + St. Augustine” into auditable, bounded geographic search cells without missing obvious areas or exploding into wasteful query volume.

---

# 1. CORE PRINCIPLE

Geography is not just a string appended to Google queries.

The system needs a canonical territory model so it can answer:

- What area did we intend to cover?
- What parts have actually been searched?
- Which queries ran in each part?
- Where are duplicate advertisers appearing?
- Which areas are saturated?
- Which area should be searched next?
- Which timezone applies to a business/contact?

---

# 2. GEOGRAPHIC ENTITIES

Store normalized entities for:

- Country
- State/territory
- County/equivalent
- Place/city
- CBSA/metro
- ZCTA
- SearchCell
- ServiceTerritory

Each geographic entity should have:

- stable internal ID;
- official/source-native code where available;
- name;
- parent relationships;
- centroid/representative coordinates;
- polygon/bounds where available/needed;
- source/version;
- effective/import date.

---

# 3. U.S. REFERENCE DATA

Use authoritative public geography datasets such as U.S. Census reference/Gazetteer files for durable U.S. geography.

Support at minimum:

- state FIPS/code;
- county FIPS/code;
- incorporated places/CDPs where appropriate;
- CBSAs/metropolitan areas;
- ZCTAs;
- representative latitude/longitude.

Important:

ZCTA is a Census geographic approximation of ZIP Code areas. It is useful for market/search coverage but should not be treated as authoritative USPS mailing truth.

Keep source/version metadata so future geography updates are reproducible.

---

# 4. TERRITORY SELECTOR

A MiningJob can specify one or more:

- states[]
- counties[]
- cities/places[]
- CBSAs[]
- ZCTAs[]
- radius centers[]
- explicit latitude/longitude bounds[]
- manually selected SearchCells[]

Selectors can be additive or restrictive according to a documented mode.

Example:

- city: Jacksonville
- city: St. Augustine
- radius: 50 miles around Jacksonville

The engine resolves this into a canonical union/intersection according to configured job semantics instead of leaving three unrelated text filters.

---

# 5. SEARCH CELL

`SearchCell` is the smallest unit for coverage/saturation.

Fields:

- `search_cell_id`
- `territory_id`
- `cell_type`
- `label`
- `center_lat`
- `center_lng`
- `radius_km` optional
- `bounds` optional
- `state_code`
- `county_codes[]`
- `place_codes[]`
- `zcta_codes[]`
- `timezone`
- `population_weight` optional
- `business_density_weight` optional
- `priority_weight`
- `coverage_status`
- `last_searched_at`

`cell_type`:

- city
- zcta
- radius
- grid
- county_cluster
- metro_core
- manual

---

# 6. CELL GENERATION STRATEGY

Do not start with a dense grid across every market.

Use progressive coverage.

## Level 1 — market/city cells

Use target city/metro names for first-pass high-intent advertiser discovery.

## Level 2 — ZCTA cells

Expand high-yield markets into selected ZCTAs.

Prioritize:

- population;
- business/customer density proxy;
- distance from market center;
- target service area;
- incomplete prior coverage.

## Level 3 — coordinate/radius cells

Use only where provider localization needs more granular coordinate targeting or city/ZCTA queries are clearly missing local variation.

## Level 4 — gap cells

Add cells around underserved/edge parts of the intended territory based on actual coverage/yield analysis.

---

# 7. DO NOT SEARCH EVERY ZIP EQUALLY

For a large metro, a naive strategy such as:

`20 queries x 80 ZCTAs = 1,600 searches`

may waste budget while repeatedly finding the same advertisers.

Instead:

1. city-level discovery;
2. rank query families by advertiser yield;
3. select representative/high-priority ZCTAs;
4. expand only while unique advertiser yield remains useful;
5. stop/saturate low-yield combinations.

---

# 8. LOCATION STRING GENERATION

Provider adapters should receive structured geography and generate the provider-specific localization parameters.

Examples:

- provider native location code;
- city/state string;
- postal/ZCTA string;
- latitude/longitude/radius;
- device/language/country.

Core MiningJob should not store raw provider location syntax as the canonical geography.

---

# 9. TIMEZONE RESOLUTION

Business/contact timezone is distinct from search geography.

For a physical Location:

- derive from verified coordinates/address using a reliable timezone mapping;
- store IANA zone (`America/New_York`, etc.);
- do not rely on server timezone.

For service-area businesses:

- use verified business base/location if known;
- contact-specific timezone may override;
- ambiguous multi-timezone territory requires policy handling.

Timezone is re-used by compliance/calling windows and scheduling.

---

# 10. COVERAGE RECORD

For each SearchCell + query family + provider maintain:

- last searched timestamp;
- total tasks;
- total paid observations;
- unique advertisers seen;
- new unique advertisers;
- duplicate observations;
- Tier A/B accounts ultimately produced;
- cost;
- saturation state;
- next eligible refresh.

This is what makes the Miner know where it has already looked.

---

# 11. COVERAGE STATUS

- `unsearched`
- `partial`
- `adequate`
- `saturated`
- `cooldown`
- `stale_refresh_due`
- `provider_blocked`

Coverage is query/provider-sensitive.

A cell can be saturated for generic `HVAC contractor` but still untested for `AC replacement`.

---

# 12. SATURATION ALGORITHM

Initial configurable indicators:

- last N searches produce >=90% already-known advertisers;
- unique-new-advertiser yield below threshold;
- cost per new advertiser exceeds threshold;
- no new Tier B+ accounts across multiple query families.

Do not mark saturated based on one empty query.

Saturation expires after a cooldown because markets/ads change.

---

# 13. SEARCH PRIORITY SCORE

Separate from prospect score.

A SearchCell/query candidate can be ranked using:

- unsearched/undersearched status;
- historical unique-advertiser yield;
- historical Tier A/B yield;
- high-intent query weight;
- population/business density;
- adjacency to productive cells;
- freshness due;
- provider cost;
- campaign inventory deficit.

Do not use an LLM for basic queue arithmetic.

---

# 14. MARKET EXPANSION

Example campaign territory chain:

`St. Johns core`
-> `Jacksonville core`
-> `Clay/Nassau adjacent`
-> `Orlando`
-> `Tampa Bay`
-> `South Florida`

A campaign can expand when:

- current target inventory remains below low-water;
- current territory is sufficiently saturated;
- provider cost/yield is still acceptable;
- admin policy allows expansion.

Expansion creates new territory/search cells; it does not rewrite the original coverage record.

---

# 15. SERVICE AREA VS PHYSICAL LOCATION

Website/provider may say:

> Serving Jacksonville, St. Augustine, Ponte Vedra, Orange Park...

This is a ServiceTerritory signal, not proof of four offices.

Maintain:

- physical Locations[];
- service territories[];
- advertised market observations[].

This avoids falsely awarding multi-location evidence.

---

# 16. CROSS-MARKET ADVERTISERS

A single contractor may advertise across many ZCTAs/cities.

Expected:

- one Account;
- multiple AdObservations;
- service territory/market evidence;
- advertiser-strength may increase;
- canonical Google score remains +4 once.

Do not create a new prospect per market.

---

# 17. RADIUS SEARCH

When user asks:

> 50 miles around Jacksonville

Architecture should:

1. resolve center coordinate;
2. create canonical radius territory;
3. identify intersecting places/ZCTAs/counties for planning/reporting;
4. generate cells that cover radius economically;
5. avoid searching places clearly outside radius unless campaign explicitly expands.

Distance calculations should use geographic coordinates, not string matching.

---

# 18. COUNTY SEARCH

County-wide campaign should not simply query:

`HVAC St. Johns County`

because customers/providers often search city/neighborhood/service terms rather than county names.

Resolve county to:

- major places;
- ZCTAs;
- representative cells;
- county-wide provider location when useful.

Then run staged coverage.

---

# 19. CBSA / METRO SEARCH

Metro campaign can be useful for larger markets.

Resolve CBSA into constituent counties/places and create:

- metro core cell;
- high-population place cells;
- selected ZCTA cells;
- edge/gap cells as needed.

This allows “Tampa Bay HVAC” to be a structured market rather than a vague keyword.

---

# 20. SEARCH CELL DEDUPE

Avoid redundant cells where:

- a small city cell and a ZCTA cell are essentially identical for provider localization;
- coordinate cells overlap excessively;
- provider location code already represents the requested place precisely.

Store overlap relationships and let planning choose the minimum useful set.

---

# 21. PROVIDER LOCATION VALIDATION

Before large job:

- confirm provider accepts/recognizes selected location;
- store provider-native location reference/code;
- test sample response;
- if provider silently falls back to broader geography, flag.

A search labeled `St. Augustine` that actually runs nationally would corrupt evidence.

---

# 22. GEOGRAPHY FIXTURE A — JACKSONVILLE CITY

Input:

- vertical HVAC
- city Jacksonville FL

Expected plan:

- city/market Pass 1 cells;
- selected ZCTAs only after yield check;
- no statewide expansion;
- America/New_York timezone for verified local businesses.

---

# 23. FIXTURE B — ST. JOHNS COUNTY

Input:

- county St. Johns County FL

Expected:

- resolve St. Augustine and relevant places/ZCTAs/search cells;
- do not use county-name query alone;
- coverage report remains county-scoped.

---

# 24. FIXTURE C — 50-MILE JACKSONVILLE RADIUS

Expected:

- canonical circle stored;
- intersecting cells generated;
- businesses outside radius excluded unless service-area-specific campaign rule allows them;
- search budget prioritizes dense areas first.

---

# 25. FIXTURE D — SAME BUSINESS IN THREE CELLS

One HVAC company appears in:

- Jacksonville city search;
- ZCTA 32256;
- nearby radius cell.

Expected:

- one Account;
- three observations;
- coverage credited to all relevant cells;
- no duplicate outreach.

---

# 26. FIXTURE E — LOW-YIELD EDGE CELL

10 recent queries:

- 9 duplicate known advertisers;
- 1 new Tier C advertiser;
- high provider cost relative to core cells.

Expected:

- cell/query downgraded/saturation candidate;
- budget shifts toward other undercovered cells.

---

# 27. FIXTURE F — NEW ADVERTISER AFTER COOLDOWN

Previously saturated cell refreshed after configured interval and finds new advertiser.

Expected:

- advertiser added normally;
- saturation statistics updated;
- cell may return to adequate/active status.

---

# 28. FIRST IMPLEMENTATION MILESTONE

Claude should be able to request:

- Jacksonville city;
- St. Augustine city;
- St. Johns County;
- selected ZCTAs;
- 50-mile Jacksonville radius;

and print/inspect the planned SearchCells and query budget BEFORE spending on SERP provider calls.

Manual review should confirm the plan is geographically sensible.

---

# 29. ACCEPTANCE METRICS

- no orphan SearchObservations without geography context;
- no silent provider geography fallback;
- no treating service areas as physical locations;
- no ZCTA/ZIP semantic confusion in mailing/contact data;
- reproducible coverage plan from same input/config version;
- provider search budget bounded before execution;
- saturation based on observed yield, not arbitrary “done” flags.
