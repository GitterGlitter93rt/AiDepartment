# Your AI Department — Market Miner Campaign / Discovery Modes Specification

**Status:** Architecture authority  
**Purpose:** Define distinct ways YAD can ask Market Miner to build a prospect list without mixing the meaning of “advertiser,” “local business,” “no website,” “imported list,” or “reactivation.”

---

# 1. PRINCIPLE

A mining mode is a search strategy and eligibility rule.

It does NOT change canonical Module 4C scoring.

Examples:

- `advertiser_only` controls which prospects enter the campaign.
- Tier score still determines YAD fit among those prospects.

Do not silently change mode to hit a requested count.

---

# 2. MODE: `advertiser_only`

Purpose:

Build a list only from businesses with qualifying fresh confirmed paid-ad evidence in approved channels.

Typical use:

> HVAC Jacksonville — active Google advertisers only.

Required:

- fresh confirmed paid Google/Meta evidence according to campaign definition;
- identity resolved;
- vertical fit;
- minimum tier if configured.

If target asks for 100 but only 57 qualify:

return 57 + shortfall/coverage report.

Never fill remaining 43 with unknown/non-ad businesses.

---

# 3. MODE: `advertiser_first`

Purpose:

Prioritize fresh confirmed advertisers, then optionally gap-fill with strong non-advertiser prospects when campaign explicitly permits.

Ordering:

1. Tier A advertiser
2. Tier B advertiser
3. Tier A non-ad/unknown-ad
4. Tier B non-ad/unknown-ad

Within bands use canonical score, advertiser strength and queue rules.

UI/report must label gap-filled prospects so sales/analytics can compare cohorts.

---

# 4. MODE: `local_market_full`

Purpose:

Build the best YAD-fit business list in a territory regardless of paid-ad status.

Discovery sources:

- paid SERP
- Places/local/business discovery
- public/licensed directories
- imports.

Useful for:

- general field sales routes
- markets with low paid-ad density
- employee-capacity/CRM/operations opportunities.

Paid advertising remains a strong score/rank signal but not eligibility requirement.

---

# 5. MODE: `no_verified_website`

Purpose:

Find businesses that appear operational/relevant but for which YAD cannot verify a current business website after the defined resolution process.

Useful for website prospecting.

Eligibility:

- real target business identity resolved sufficiently;
- active/operating evidence where available;
- vertical/category relevant;
- independent website resolution process completed;
- `no_verified_website_found` confirmed under claim registry.

Do not classify “source result omitted website” as no website.

---

# 6. MODE: `weak_web_presence`

Purpose:

Find businesses with a website but observable weak conversion foundation.

Possible signals:

- no mobile-friendly lead path
- phone-only site
- generic contact form only
- broken/unreachable key pages
- no clear service CTA
- old/thin web presence.

This is not a “website quality insult” score.

A human/strategy layer still asks whether website/customer acquisition matters to business.

---

# 7. MODE: `multi_location_operations`

Purpose:

Find multi-location/service-territory businesses where routing, reporting, capacity and attribution may have leverage.

Eligibility:

- meaningful multiple locations/service territories confirmed;
- target vertical;
- minimum canonical tier.

Ad activity optional.

Primary hypotheses often:

- routing consistency
- reporting
- attribution
- capacity
- CRM adoption.

---

# 8. MODE: `import_enrich_score`

Purpose:

Take an external list such as Apollo/CSV/CRM export and run it through canonical YAD pipeline.

Flow:

`import -> dedupe -> suppression/history match -> research -> score -> Call Pack -> queue`.

No external row bypasses canonical identity/history.

Useful for comparing generic Apollo list with Google advertiser-mined list.

---

# 9. MODE: `field_route`

Purpose:

Build geographically efficient human walk-in prospect routes.

Inputs:

- rep start/end area
- geography/radius
- verticals
- Tier threshold
- scheduled appointments/follow-ups.

Output can mix:

- scheduled meetings
- Tier A walk-ins
- Tier B walk-ins
- follow-up stops.

Uses same Account/history/evidence as phone campaign.

Routing optimization is downstream; no separate lead database.

---

# 10. MODE: `reactivation`

Not internet mining.

Purpose:

Work existing YAD prospect/customer CRM data where compliant/appropriate.

Eligibility based on:

- prior relationship/contact history
- current opportunity state
- approved reactivation policy
- suppression/channel permission.

Do not mix with cold-market acquisition metrics without labeling cohort.

---

# 11. MODE: `research_only_market_map`

Purpose:

Map a market without putting any Account into sales queue.

Output:

- businesses
- advertiser landscape
- query yield
- system/website patterns
- Tier distribution
- provider cost.

Useful for market-selection analysis or provider tests.

No contact eligibility evaluation needed beyond exclusions/suppression awareness.

---

# 12. MODE CONFIG

Each MiningJob stores:

- discovery_mode
- verticals
- territory
- paid_channel requirements
- minimum tier
- gap_fill_allowed
- target inventory
- research depth
- contact enrichment depth
- budget
- exclusion sets.

Mode cannot silently mutate while job runs.

Change creates config version/event.

---

# 13. MODE + TIER

Examples:

## Advertiser only + Tier B+

Requires both:

- ad eligibility
- score >=6.

## No verified website

May use a different minimum tier or offer-focused selection, but score remains Module 4C.

A no-website small business could be Tier C yet still be a valid website-sales campaign if campaign specifically targets that offer.

Do not pretend Tier C became A because campaign wants websites.

---

# 14. OFFER-SPECIFIC CAMPAIGN VS FIT SCORE

Some campaigns are intentionally narrow.

Example:

`No Website St. Augustine Local Businesses`

Eligibility can use:

- website absent
- operating business
- chosen vertical/category
- contactability.

Canonical YAD Tier still displayed for prioritization.

This keeps scoring honest while allowing tactical campaigns.

---

# 15. MODE REPORTING

Every dashboard/report states mode clearly.

Examples:

**Advertiser Only**
- 72 qualifying
- 72 advertisers.

**Advertiser First + Gap Fill**
- 64 advertisers
- 36 non-ad Tier A/B gap fill.

Do not combine them into “100 advertisers.”

---

# 16. MODE ANALYTICS

Track outcomes by:

- discovery mode
- source
- cohort
- tier
- hook.

This lets YAD compare:

- advertiser-first
- no-website
- generic Apollo
- multi-location
- field route.

---

# 17. SHORTFALL RULE

When a mode's eligibility produces fewer prospects than target:

1. report current inventory;
2. report territory/query coverage;
3. recommend allowed expansion options;
4. wait for config/automatic expansion policy.

Never weaken mode implicitly.

---

# 18. EXCLUSION RULES APPLY TO ALL MODES

- existing customer when campaign excludes
- active opportunity when duplicate sales contact unwanted
- DNC/suppression
- wrong category
- bad identity
- internal/test business
- provider/source restricted use.

---

# 19. FIRST SUPPORTED MODES

Recommended implementation order:

1. `advertiser_first`
2. `advertiser_only`
3. `import_enrich_score`
4. `local_market_full`
5. `no_verified_website`
6. `field_route` later.

Do not build every mode before Jacksonville HVAC Gate 7 works.

---

# 20. ACCEPTANCE FIXTURES

## Advertiser-only shortfall

Target 100; 57 fresh eligible advertisers.

Expected: 57, no silent gap-fill.

## Advertiser-first gap-fill

64 advertisers + 36 strong non-ad Tier A/B.

Expected: 100 with cohort labels if gap-fill enabled.

## No-website

Source omits URL but domain resolution not attempted.

Expected: not eligible yet.

After independent checks find no current domain:

eligible as `no_verified_website`.

## Import

Apollo Account already exists as Google advertiser.

Expected: one Account, sources merged, history retained.
