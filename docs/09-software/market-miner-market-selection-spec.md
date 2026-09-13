# Your AI Department — Market Miner Market Selection & Expansion Specification

**Status:** Architecture authority for post-pilot scaling  
**Purpose:** Rank which city/metro/territory YAD should mine next without changing individual prospect scoring or blindly expanding nationwide.

---

# 1. PRINCIPLE

There are three separate rankings:

1. **Market priority** — which geography to mine/work.
2. **Prospect fit score** — Module 4C Tier A-D.
3. **Queue priority** — who to contact next within a campaign.

Do not collapse them.

---

# 2. WHY MARKET SELECTION MATTERS

After one city is saturated, choices may include:

- more query/time/device sampling in same city;
- adjacent counties;
- Orlando;
- Tampa;
- South Florida;
- another state.

The correct next market should be data-driven once YAD has enough observations.

---

# 3. MARKET ENTITY

`MarketProfile`:

- market ID
- market type: city / CBSA / county cluster / state segment
- vertical
- geography entities/search cells
- population/business-density context
- search coverage
- provider cost history
- advertiser counts
- Tier distribution
- Human Assist/outreach outcomes
- saturation
- last refreshed
- market priority snapshot.

---

# 4. PRE-OUTCOME MARKET SIGNALS

Before YAD has calls in a market, rank using:

- target-vertical business discovery density
- fresh unique Google advertisers
- LSA/local sponsored density
- distinct high-intent advertiser families
- Tier A/B yield from research sample
- cost per Tier B+
- multi-location/growth signal density
- geography coverage confidence
- market saturation level.

Do not infer market profitability from population alone.

---

# 5. POST-OUTCOME MARKET SIGNALS

Once human/approved outreach occurs:

- decision-maker reach rate
- qualified conversation rate
- meeting rate
- opportunity rate
- DNC/complaint rate
- average research correction rate
- cost/qualified conversation
- cost/meeting
- cost/opportunity.

These should eventually outrank raw advertiser count.

---

# 6. MARKET PRIORITY SCORE

Use separate transparent internal score/tuple.

Example components:

- current Tier B+ inventory yield
- advertiser density
- cost efficiency
- undercoverage opportunity
- downstream conversion quality
- rep/service capacity
- saturation penalty.

Do not call this YAD prospect score.

Store components/reasons.

---

# 7. EARLY-STAGE TUPLE

Before enough sales outcomes:

Rank markets by:

1. Tier B+ accounts per 100 search tasks or per dollar
2. fresh advertiser count/density
3. provider accuracy/data quality
4. unsaturated search coverage
5. operational proximity/rep focus if relevant.

This avoids optimizing on tiny meeting samples too early.

---

# 8. MATURE TUPLE

After adequate sample:

1. cost per qualified opportunity
2. opportunity/decision-maker rate
3. meeting/qualified rate
4. Tier B+ replenishment yield
5. provider/research cost
6. saturation.

Do not use win-rate alone when sample very small.

---

# 9. MARKET SAMPLE REQUIREMENT

Before a market gets a stable outcome-based ranking, require minimum sample such as:

- enough completed decision-maker conversations
- enough qualified conversations
- sufficient time window.

Exact N configured after real data.

Until then label:

`thin_sample`.

---

# 10. TERRITORY EXPANSION TYPES

## Adjacent expansion

Nearby city/county/cells.

## Same-state metro expansion

Jacksonville -> Orlando -> Tampa -> South Florida, for example.

## Regional expansion

Florida -> Southeast markets.

## Vertical expansion

Same geography, HVAC -> Plumbing.

Market-selection engine can compare horizontal geography vs vertical expansion opportunities.

---

# 11. REP / OPERATIONS CAPACITY

A market with huge lead supply should not automatically expand if YAD cannot work the queue.

Inputs:

- Human Assist rep capacity
- active follow-up load
- strategy-call availability
- delivery/sales bandwidth.

Inventory controller should not create millions of stale prospects unnecessarily.

---

# 12. FRESHNESS

A market's advertiser landscape changes.

Market score uses current window.

Historical data remains for trend but does not imply present inventory.

---

# 13. SEASONALITY

Vertical profile can identify seasonality.

HVAC example:

- hot-season AC demand may change paid competition/urgency.

Plumbing may be steadier with event/weather effects.

Do not hard-code seasonality multipliers into canonical prospect score.

Market planner may schedule refresh/exploration by season after data supports it.

---

# 14. WEATHER / EVENT SIGNALS — FUTURE

Potential later inputs for appropriate verticals:

- extreme heat/cold for HVAC
- hail/storms for roofing/PDR/restoration
- seasonal service demand.

These are Market/Campaign opportunity signals, not automatic permission to claim a prospect has pain.

Not required for Market Miner V1.

---

# 15. MARKET SATURATION

Market saturated when:

- high-value cells/query families repeatedly produce mostly known Accounts
- ready inventory not replenishing efficiently
- cost per new Tier B+ rises materially
- remaining coverage is low-value/edge.

Saturation expires/refreshed periodically.

---

# 16. EXPANSION TRIGGER

Possible trigger:

- current market ready inventory below low-water
- core territory >= configured coverage/saturation
- current provider quality good
- campaign budget available
- expansion policy permits.

Then choose next market from priority list.

---

# 17. MANUAL APPROVAL LEVELS

V1:

- system recommends next market
- manager approves new city/metro/state.

Later:

- pre-approved expansion chain can auto-open next market under budget.

Never autonomously open new states for voice campaigns when compliance policy differs/unreviewed.

Research-only expansion has lower risk but still budget/source controls.

---

# 18. STATE POLICY GATE

For research-only mining:

new state generally requires source/geography support only.

For Human Assist/outreach:

follow approved human sales policy.

For autonomous voice:

state must be approved in compliance policy before campaign can expand to calls.

Market priority cannot bypass policy.

---

# 19. MARKET COMPARISON UI

Show:

- market
- vertical
- search coverage
- fresh advertisers
- Tier A/B
- cost/Tier B+
- decision-maker/qualified/meeting metrics
- saturation
- sample warning
- recommended action.

Example:

`Jacksonville HVAC — high saturation, strong outcomes — maintain/refresh`

`Orlando HVAC — low coverage, high advertiser yield — explore next`

`Tampa HVAC — not yet sampled`.

---

# 20. QUERY MIX PER MARKET

Do not assume query yield identical across cities.

Each market tracks:

- urgent query yield
- high-ticket query yield
- financing query yield
- generic category yield.

Market expansion starts with profile defaults, then learns local yield.

---

# 21. PROVIDER DIFFERENCES PER MARKET

SERP provider performance may vary by localization/result format.

Track provider accuracy/cost/yield by market.

Routing can change without changing MarketProfile identity.

---

# 22. FIRST FLORIDA EXPLORATION EXAMPLE

After Jacksonville/St. Augustine Gate 7/Human Assist:

candidate research-only samples:

- Orlando HVAC
- Tampa Bay HVAC
- South Florida HVAC
- Jacksonville/St. Augustine Plumbing.

Run bounded small sample in each.

Compare:

- unique advertiser yield
- Tier B+ yield
- provider cost
- data quality.

Then choose next larger cohort.

This is an example, not a fixed permanent expansion order.

---

# 23. TEST FIXTURE A — HIGH POPULATION, LOW YIELD

Market A:

- large population
- many search tasks
- few unique Tier B+ advertisers
- high duplicate rate.

Market B:

- smaller population
- high Tier B+ advertiser yield/cost efficiency.

Expected:

Market B can rank higher despite population.

---

# 24. FIXTURE B — GREAT MEETING RATE, THIN SAMPLE

3 decision-maker calls, 2 meetings.

Expected:

- thin_sample warning
- do not conclude 67% stable meeting rate
- use exploration/basic signals.

---

# 25. FIXTURE C — STRONG MARKET BUT COMPLIANCE UNREVIEWED FOR AUTONOMOUS

Market ranks highest.

Expected:

- research recommendation allowed
- autonomous voice expansion blocked until policy approval.

---

# 26. ACCEPTANCE

- market score separate from prospect score
- thin sample flagged
- population not sole driver
- saturation/cost considered
- state compliance gate respected for voice
- system can recommend next market with explainable reasons.
