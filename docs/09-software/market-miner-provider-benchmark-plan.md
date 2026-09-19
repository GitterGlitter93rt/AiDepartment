# Your AI Department — Market Miner Provider Benchmark Plan

**Status:** Architecture / procurement test plan  
**Purpose:** Select real discovery/ad-intelligence providers using measured accuracy, coverage, latency, cost, and operational reliability instead of committing the architecture to one vendor based on documentation alone.

---

# 1. PRINCIPLE

Provider choice is an implementation decision that should be benchmarked against YAD's actual use case:

> Find active local-business advertisers for high-intent service keywords in specific U.S. geographies, then resolve them to real businesses for research and sales prioritization.

Cheapest request price is not automatically cheapest usable prospect.

Best metric eventually:

`provider cost per correctly resolved Tier A/B prospect`

and later:

`provider-attributed cost per qualified meeting`.

---

# 2. INITIAL PROVIDERS TO BENCHMARK

Subject to revalidation at implementation time:

## DataForSEO

Candidate primary bulk SERP/ad source.

Test:

- paid Google search result extraction;
- advanced/full SERP structures;
- Local Services/local paid result support;
- Ads Transparency/advertiser data where useful;
- queue vs live modes;
- location precision.

## SerpApi

Candidate fallback/validation/local sponsored/LSA source.

Test:

- Google Ads parsing;
- Local Services/local ads objects;
- location precision;
- response convenience/consistency.

## Google Places API

Not a paid-ad detector benchmark.

Test only for:

- gap-fill business discovery;
- identity/location resolution;
- provider-native Place ID mapping;
- cost/coverage under retention constraints.

## Optional additional provider

Claude may propose a licensed SERP/business-data provider if it can document:

- official API;
- applicable terms;
- pricing;
- clear advantage.

Do not add random scraper services without review.

---

# 3. BENCHMARK TERRITORY

Primary:

- Jacksonville, Florida
- St. Augustine, Florida

Vertical:

- HVAC

Secondary validation after first pass:

- Plumbing in same geography.

Why:

- both are Sales Manual priority verticals;
- strong high-intent Google-search behavior;
- urgent service and high-ticket query families;
- enough local market variation to test geography/dedupe.

---

# 4. GOLD QUERY SET — HVAC

Use same timestamp window where possible.

Core:

- HVAC contractor Jacksonville FL
- HVAC contractor St Augustine FL

Urgent:

- AC repair Jacksonville FL
- emergency AC repair Jacksonville FL
- emergency HVAC Jacksonville FL
- AC repair St Augustine FL
- emergency AC repair St Augustine FL

High-ticket:

- AC replacement Jacksonville FL
- HVAC replacement Jacksonville FL
- heat pump installation Jacksonville FL
- AC replacement St Augustine FL

Offer:

- HVAC financing Jacksonville FL

Then repeat a limited subset using selected geography localization/ZCTA mechanisms.

---

# 5. GOLD QUERY SET — PLUMBING

- plumber Jacksonville FL
- emergency plumber Jacksonville FL
- drain cleaning Jacksonville FL
- sewer repair Jacksonville FL
- water heater repair Jacksonville FL
- repipe Jacksonville FL
- plumber St Augustine FL
- emergency plumber St Augustine FL

Use only after HVAC adapter test is stable.

---

# 6. CAPTURED BENCHMARK FIELDS

For every provider/query:

- provider;
- endpoint/mode;
- query;
- requested geography;
- provider-resolved geography;
- timestamp;
- request duration;
- billed units/cost;
- paid result count;
- LSA/local paid result count;
- advertiser names;
- domains;
- phones if provided;
- landing URLs;
- result position/order;
- raw provider result reference;
- parse errors.

---

# 7. MANUAL GOLD REVIEW

For a bounded sample, a human reviewer checks:

- Is result actually sponsored/paid?
- Is advertiser identity correct?
- Does landing domain belong to the business or aggregator?
- Is service/offer correctly extracted?
- Is geography consistent with requested market?
- Is LSA correctly distinguished from ordinary local/organic result?

Do not use one provider as automatic ground truth for another.

---

# 8. ACCURACY METRICS

## Paid-result precision

`correct_paid_results / parsed_paid_results`

## Business-resolution precision

`correctly_resolved_businesses / attempted_business_resolutions`

## Aggregator false-assignment rate

`incorrect contractor assignments from aggregator/lead-gen results / aggregator-like results`

Target should approach zero.

## Geography correctness

`responses with intended localization / sampled responses`

## Field completeness

Percentage with:

- advertiser name;
- domain/landing URL;
- phone;
- ad text/service clues.

---

# 9. COVERAGE / RECALL PROXY

True complete advertiser recall is unknowable from sampled Google auctions.

Use practical overlap/yield measures instead:

- unique advertisers per provider;
- advertisers found by both;
- advertisers unique to provider A;
- advertisers unique to provider B;
- repeated observations across queries;
- manual validation of unique results.

A provider finding more advertisers is only better if the incremental advertisers are real and relevant.

---

# 10. LOCAL SERVICES ADS TEST

Specifically test whether provider:

- returns LSA/local sponsored block;
- labels it distinctly;
- provides business identity;
- provides phone/service area where visible;
- preserves requested geography.

This matters strongly for HVAC/plumbing.

If one provider is materially better for LSA, it may become a specialized secondary adapter even if another wins bulk text-ad cost.

---

# 11. LOCATION TEST

Run same query with:

- Jacksonville city;
- St. Augustine city;
- selected ZCTA/localization;
- coordinate/radius if provider supports.

Compare advertiser variation.

Fail provider/configuration if it silently ignores intended geography in a way that makes evidence misleading.

---

# 12. QUEUE VS LIVE TEST

For providers with modes:

## Queue/batch

Measure:

- completion time distribution;
- failure/retry;
- cost;
- throughput.

## Live

Measure:

- latency;
- cost;
- marginal coverage/field difference.

Likely architecture:

- cheap queue for bulk mining;
- targeted live refresh immediately before high-priority contact when freshness justifies it.

But benchmark before locking.

---

# 13. COST METRICS

At provider level:

- cost per search task;
- cost per valid paid observation;
- cost per unique advertiser;
- cost per correctly resolved account;
- cost per final Tier A/B account after website research.

Example:

Provider A costs $1 for 1,000 tasks but yields 35 valid Tier A/B accounts.

Provider B costs $8 but yields 80.

Compare cost/Tier B+ and data quality, not sticker price alone.

---

# 14. OPERATIONAL METRICS

- rate-limit behavior;
- authentication stability;
- schema consistency;
- documented version changes;
- queue reliability;
- support/documentation quality;
- error clarity;
- retry/idempotency support;
- webhook/callback support where relevant.

A cheap provider with unstable result schema can cost more engineering time than it saves.

---

# 15. STORAGE / TERMS REVIEW

Before production use, record for each provider:

- API terms reviewed date;
- fields allowed to retain;
- raw payload retention constraints;
- attribution requirements;
- derived-data restrictions;
- rate limits;
- prohibited uses;
- account/license limits.

Architecture should store only what current terms permit.

This review is a Gate 4 prerequisite.

---

# 16. PROVIDER SCORECARD

Score each 1–5:

- paid-result precision
- advertiser identity resolution
- LSA support
- geography control
- field completeness
- bulk cost efficiency
- live refresh usefulness
- API reliability
- schema usability
- terms/retention fit
- documentation/support

Weighting suggestion for V1:

- precision: 20%
- geography: 15%
- cost/Tier B+: 20%
- advertiser resolution: 15%
- LSA: 10%
- reliability: 10%
- terms/retention: 10%

Weights are configurable and internal.

---

# 17. SELECTION OUTCOMES

Possible result is not necessarily one winner.

Example architecture:

- DataForSEO = primary bulk paid SERP;
- SerpApi = targeted LSA/fallback/debug;
- Google Places = gap-fill identity/discovery;
- website = canonical durable intelligence;
- Apollo = contacts.

The provider abstraction exists so this can change without rewriting Market Miner.

---

# 18. BENCHMARK REPORT FORMAT

Claude reports:

1. provider/version/endpoint;
2. test date;
3. queries/geographies;
4. task count;
5. total cost;
6. unique valid advertisers;
7. invalid/aggregator results;
8. LSA support;
9. overlap between providers;
10. cost/unique advertiser;
11. downstream Tier A/B count after research;
12. cost/Tier A/B;
13. operational issues;
14. terms/retention notes;
15. recommended routing strategy.

No provider should be selected based solely on a demo response.

---

# 19. PASS CONDITION

Before Market Miner scales beyond test territory:

- at least one paid-SERP provider passes precision/geography/manual audit;
- provider spend is measurable/bounded;
- dedupe/identity works on outputs;
- provider failure degrades to unknown, not false negative;
- terms/retention review recorded;
- routing choice documented.
