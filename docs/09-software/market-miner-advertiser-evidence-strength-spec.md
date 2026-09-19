# Your AI Department — Advertiser Evidence Strength & Paid-Demand Ranking Specification

**Status:** Architecture authority  
**Purpose:** Rank confirmed advertisers relative to one another without corrupting the canonical Module 4C YAD fit score or pretending ad visibility reveals spend, profitability, lead volume, or campaign quality.

---

# 1. WHY THIS EXISTS

Module 4C correctly awards:

- +4 for confirmed Google paid-search signal;
- +3 for confirmed Meta signal;
- +1 for multi-channel.

But two HVAC companies can both receive the same +4 while one appears repeatedly across urgent/high-ticket searches and another appears once for a generic brand-like query.

YAD needs a separate internal ranking signal:

`AdvertiserEvidenceStrength`

This affects queue priority/research depth — not canonical YAD score.

---

# 2. WHAT IT IS NOT

Advertiser Evidence Strength is NOT:

- estimated monthly spend;
- impression share;
- budget;
- ROAS;
- profitability;
- campaign sophistication;
- lead volume;
- “how aggressive” the advertiser is in financial terms.

Safe interpretation:

> How much fresh, relevant public evidence do we have that this company is actively competing for paid customer demand in the target market/services we care about?

---

# 3. OUTPUT

Fields:

- account ID
- channel
- advertiser status
- evidence-strength band
- evidence components
- distinct query families
- distinct search cells/markets
- LSA/local sponsored evidence
- transparency corroboration
- last seen
- first seen in current observation window
- advertised service families
- freshness
- explanation.

Bands:

- `very_strong`
- `strong`
- `moderate`
- `thin`
- `stale`
- `unknown`

Prefer bands + evidence tuple rather than fake dollar-like precision.

---

# 4. GOOGLE EVIDENCE COMPONENTS

Possible components:

## Fresh paid observation

At least one direct current sponsored result.

## Distinct query families

Examples:

- urgent service
- high-ticket replacement/project
- financing
- core category

Several observations inside one family are less informative than presence across distinct customer-intent families.

## Distinct geography cells

Observed in:

- Jacksonville city
- St. Augustine
- selected ZCTA

This can indicate broader target-market presence, but not spend level.

## Local Services Ad

LSA/local sponsored evidence can receive queue-priority significance because the advertiser is participating in a highly service-intent local format.

Do not assume LSA lead price/spend.

## Transparency corroboration

Supports advertiser identity/current/historical advertising evidence according to source freshness.

## Repeated time windows

Seen across separate refresh windows can strengthen current advertiser confidence.

One burst of repeated queries in five minutes is not the same as sustained observation over weeks.

---

# 5. QUERY INTENT WEIGHT

Vertical profile query families carry intent weight.

HVAC example:

Higher relevance:

- emergency AC repair
- AC repair
- AC replacement
- heat pump installation

Lower/less specific:

- heating and cooling
- HVAC company

A sponsored result for `AC replacement Jacksonville` may be more strategically useful than one generic category observation because it reveals the specific service the company is promoting.

This does NOT change +4 canonical ad score.

---

# 6. SERVICE-RELEVANCE ALIGNMENT

Compare observed ad service with YAD opportunity model.

Examples:

## Emergency service ad

Supports investigation of:

- answer/after-hours
- speed-to-lead
- routing
- attribution.

## Replacement/financing ad

Supports:

- lead response
- unsold estimate follow-up
- financing follow-up
- attribution.

## Maintenance ad

May support:

- memberships
- recurring service
- reactivation.

Queue can favor advertisers whose promoted service creates a strong measurable workflow hypothesis.

---

# 7. RECOMMENDED DETERMINISTIC TUPLE

Rather than one opaque number, rank Google advertisers by a tuple such as:

1. fresh current paid evidence (yes/no)
2. LSA/local sponsored present (yes/no)
3. number of distinct high-intent query families observed
4. highest query intent weight
5. number of relevant geography cells observed
6. cross-platform paid corroboration (yes/no)
7. transparency corroboration (yes/no)
8. observation freshness

Tie-break only after canonical YAD Tier/score and campaign objectives according to queue policy.

---

# 8. OPTIONAL NUMERIC IMPLEMENTATION

If code needs a sortable numeric field, use a documented normalized score generated from the tuple, but ALWAYS retain components/explanation.

Example internal weights, subject to implementation testing:

- fresh Google paid evidence: required baseline
- LSA/local sponsored: +3
- each distinct relevant query family: +2, capped
- highest high-intent family: +2
- multiple relevant geography cells: +1–2 capped
- Meta cross-channel: +2
- Transparency corroboration: +1
- repeated independent observation window: +1

Do not label this `ad_spend_score`.

Name:

`advertiser_evidence_strength_score`

Never expose as estimated dollars.

---

# 9. STALENESS

Current-ad strength decays with age.

Initial policy:

- <=48h: fresh current evidence
- older: historical/stale according to configured TTL

Historical observations remain useful for account history and refresh priority but cannot support “I noticed you're currently advertising” after current TTL without refresh.

---

# 10. ABSENCE

A company not seen in current sampled queries:

`advertiser_status = unknown/not_observed_in_sample`

not:

`not advertising`.

Advertiser strength cannot go negative because of non-observation alone.

---

# 11. CROSS-CHANNEL

Google + Meta can increase paid-demand confidence/priority because multiple channels are confirmed.

But:

- Meta must be independently confirmed;
- Meta Pixel alone does not count;
- cross-channel does not imply successful marketing.

---

# 12. SAME COMPANY / MANY QUERIES

Example:

ABC Air appears for:

- AC repair Jacksonville
- emergency AC repair Jacksonville
- AC replacement Jacksonville
- heat pump installation Jacksonville
- AC repair 32256

Expected:

- one Account
- five AdObservations
- Google Module 4C points = +4 once
- advertiser strength = stronger because multiple relevant intent families/geography observed.

---

# 13. SAME QUERY / MANY TIMES

Ten identical observations from retry/duplicate provider requests in one minute should NOT make advertiser ten times stronger.

Deduplicate/normalize observation windows.

Strength should favor independent useful evidence, not API duplication.

---

# 14. LSA + SEARCH AD

If same business has:

- LSA/local sponsored evidence
- ordinary paid Search ad evidence

record both formats.

This may be a high-priority advertiser because the company is visibly participating in multiple paid Google demand surfaces.

Still no spend inference.

---

# 15. BRANDED QUERY

A paid result seen only for the company's own brand name may be weaker for YAD prospect targeting than high-intent non-brand service queries.

If provider/query strategy includes brand observations, mark:

- branded vs non-branded query where determinable from query/account name.

Do not discard branded advertising, but rank service-intent evidence higher for prospecting relevance.

---

# 16. COMPETITOR-LIKE / AGGREGATOR ADS

If result advertiser is:

- directory
- aggregator
- lead marketplace
- manufacturer/dealer locator

then advertiser strength applies to that advertiser entity, not automatically to local contractors listed downstream.

Identity resolution must happen first.

---

# 17. QUEUE USE

Recommended queue hierarchy remains:

1. compliance/contact gates
2. Tier A before B
3. canonical score
4. advertiser-first campaign preference
5. advertiser evidence strength
6. research completeness/freshness
7. service/hypothesis relevance
8. decision-maker availability
9. contact history.

This keeps YAD score canonical while still prioritizing the businesses most visibly buying demand.

---

# 18. RESEARCH DEPTH USE

Strong advertiser evidence can justify deeper research spend:

- contact enrichment
- Meta check
- transparency check
- premium website render
- immediate ad refresh before call.

Thin advertiser evidence may receive standard research first.

---

# 19. HUMAN UI

Show plain explanation:

**Google advertiser evidence: Very strong**

- seen today for emergency AC repair
- seen today for AC replacement
- Local Services result also observed
- Jacksonville + one local search cell

Do NOT show:

`Estimated spend: $$$$`

unless YAD later integrates a legitimate spend data source and clearly labels its methodology.

---

# 20. ANALYTICS

Track outcomes by evidence strength:

- decision-maker reach
- qualified conversation
- meeting
- opportunity
- close.

Question to test:

> Do prospects with very strong current Google advertiser evidence outperform merely “confirmed advertiser” prospects?

Do not assume until data exists.

---

# 21. FIXTURE A — ONE GENERIC AD

One fresh sponsored result for `HVAC contractor Jacksonville`.

Expected:

- Google ad confirmed
- Module 4C +4
- advertiser strength: thin/moderate depending configured band
- no spend inference.

---

# 22. FIXTURE B — URGENT + REPLACEMENT + LSA

Fresh:

- emergency AC repair sponsored
- AC replacement sponsored
- Local Services result

Expected:

- Module 4C +4
- advertiser strength very strong
- primary hook selected based on best prospect/vertical evidence, not automatically same for every advertiser.

---

# 23. FIXTURE C — STALE HISTORY

Business had five observations 30 days ago; none refreshed.

Expected:

- historical advertiser evidence preserved
- current status stale/unknown
- advertiser strength stale
- refresh before current-ad opener.

---

# 24. FIXTURE D — DUPLICATE API RESULTS

Same paid result returned three times due task retry.

Expected:

- one effective observation for strength window
- no artificial boost.

---

# 25. FIXTURE E — GOOGLE + META

Fresh Google high-intent and independently confirmed Meta ads.

Expected:

- Google +4
- Meta +3
- multi-channel +1
- cross-channel component in advertiser strength
- no ROAS/spend claim.
