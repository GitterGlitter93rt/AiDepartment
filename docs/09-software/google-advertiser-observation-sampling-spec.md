# Your AI Department — Google Advertiser Observation Sampling Specification

**Status:** Architecture authority  
**Purpose:** Handle the fact that Google paid results vary by query, geography, device, time, campaign schedule and auction conditions without multiplying search costs blindly.

---

# 1. PRINCIPLE

A Google paid observation answers:

> This advertiser was visible for this query/context at this observed time.

It does NOT answer:

- the advertiser always runs;
- the advertiser never runs when absent;
- daily budget;
- ad schedule;
- impression share.

The Market Miner uses sampling to improve advertiser discovery, not to reconstruct the advertiser's Google Ads account.

---

# 2. OBSERVATION CONTEXT

Every paid SERP observation stores:

- query
- query family
- provider
- country/language
- requested geography
- provider-resolved geography
- device
- observed/requested timestamp
- local market time
- paid result type
- position where available
- advertiser/landing identity.

Without context, later evidence cannot be interpreted correctly.

---

# 3. DEFAULT DEVICE

V1 default:

- mobile-first or the provider/device configuration that best reflects target service customer behavior after benchmark.

Why benchmark:

Home-service customer journeys are heavily phone/mobile oriented, but YAD should measure provider result differences rather than hard-code an unsupported assumption forever.

Run a limited desktop comparison during provider benchmark.

Do not double every production query across both devices by default unless incremental advertiser yield justifies it.

---

# 4. DEVICE DIVERSITY TEST

For a test subset:

- mobile
- desktop

Compare:

- advertiser overlap
- unique advertisers
- LSA/local paid structure
- landing destinations
- cost.

If incremental valid advertiser yield is trivial, choose one default device for bulk mining.

If material, use selective dual-device sampling for high-value queries/markets.

---

# 5. TIME-OF-DAY SAMPLING

Ads may be scheduled or budget-limited.

Do not run every query hourly.

Use staged sampling.

## Standard first pass

One representative local business/customer-search period.

## Secondary sample

For high-yield/high-priority query families or inventory shortfall, repeat in a distinct local time window.

## After-hours sample

For vertical/query families where after-hours paid demand is strategically important, e.g.:

- emergency HVAC
- emergency plumber
- restoration
- garage door

sample at an approved evening/after-hours window as research only.

The research query itself does not contact the business.

---

# 6. SUGGESTED LOCAL TIME WINDOWS

Configurable, initial testing buckets:

- morning: 08:00–11:00
- afternoon: 13:00–17:00
- evening: 18:00–21:00

These are sampling buckets, NOT contact/calling windows.

Do not confuse Market Miner search timing with telemarketing compliance timing.

---

# 7. DAY-OF-WEEK

For first benchmark, compare at least:

- weekday
- weekend sample for urgent-service vertical if useful.

Do not turn V1 into continuous 7-day ad monitoring unless downstream value justifies it.

---

# 8. INDEPENDENT OBSERVATION WINDOW

To prevent duplicate API results from artificially strengthening advertiser evidence, define observation window buckets.

Example:

Same advertiser + same query + same cell + same device within a short configured window counts as one effective strength observation even if provider retry returned duplicates.

A genuinely separate evening/day-later sample can count as independent evidence.

---

# 9. FRESH CURRENT STATUS

One confirmed paid observation within TTL is sufficient for:

`active_google_search_ad = yes`

under current architecture.

Additional observations improve AdvertiserEvidenceStrength and service/geography context.

They do not add more than +4 canonical Google points.

---

# 10. NON-OBSERVATION

If advertiser appears morning but not evening:

- current Google advertiser evidence remains valid until TTL;
- do not infer schedule/budget without more data;
- record both observations/absence sample if absence tracking is useful.

If never observed in sampled queries:

- `not_observed_in_sample`
- active status remains unknown unless another approved source confirms.

---

# 11. INVENTORY SHORTFALL SAMPLING

If advertiser-first campaign lacks target inventory:

Before expanding to dozens of low-value synonyms, planner can compare expected marginal value of:

- new geography cells;
- second time window;
- second device;
- new query family;
- Transparency/gap-fill source.

Choose based on historical yield/cost.

---

# 12. EMERGENCY AD AFTER-HOURS HOOK

If fresh observation specifically occurred during evening for `emergency AC repair`:

Safe fact:

> YAD observed a sponsored emergency AC ad in that market during the evening window.

Still NOT safe:

- they intentionally run 24/7 campaigns;
- ad budget continues all night;
- after-hours calls are missed.

The business's website 24/7 claim is separate evidence.

---

# 13. CAMPAIGN SCHEDULER

Search tasks can be scheduled by local market time.

Store timezone on SearchCell.

Scheduler resolves local bucket to actual execution time.

Do not use server UTC/hour as market meaning.

---

# 14. PROVIDER CACHING

Some SERP providers may cache or have data freshness semantics.

Provider benchmark must document:

- live vs queue behavior
- requested execution vs returned observation time
- cache implications.

Do not label result “seen at 8 PM” if provider returned an older cached SERP without disclosure.

---

# 15. COST CAP

Set maximum samples per query/cell within TTL.

Example initial policy:

- core first pass: one device/time
- high-value queries: up to two time windows when needed
- emergency after-hours: selective evening sample
- device comparison: benchmark/testing, not universal.

Exact limits configurable by campaign/provider economics.

---

# 16. ANALYTICS

Track incremental unique advertiser yield by:

- second time window
- after-hours sample
- desktop vs mobile
- weekend sample.

If secondary sampling produces very few new Tier B+ prospects, reduce it.

If it materially finds high-quality advertisers missed in first pass, retain for that vertical/market.

---

# 17. FIXTURE A — MORNING ONLY

Advertiser seen morning, not evening.

Expected:

- current advertiser yes while morning evidence fresh
- no schedule inference
- advertiser strength includes one independent window.

---

# 18. FIXTURE B — EVENING EMERGENCY AD

Advertiser seen evening for emergency AC and website confirms 24/7.

Expected:

- current Google ad yes
- emergency service yes
- strong after-hours-related hypothesis
- no missed-call assertion.

---

# 19. FIXTURE C — DUPLICATE PROVIDER RETRIES

Three identical cached results same timestamp/context.

Expected:

- one effective sampling observation
- no strength inflation.

---

# 20. FIXTURE D — MOBILE UNIQUE LSA

Mobile returns valid local sponsored/LSA advertiser not present in limited desktop sample.

Expected:

- provider/device benchmark notes incremental yield
- planner may choose mobile as default/high-priority source
- Account dedupes normally if later found elsewhere.

---

# 21. ACCEPTANCE

Before scaling Google mining:

- every observation includes time/device/geography
- duplicate provider/cached results do not inflate strength
- non-observation never becomes false negative
- secondary sampling has measurable cost/yield
- selected default device/time strategy documented from benchmark, not assumption.
