# Your AI Department — Market Miner Territory Expansion Controller

**Status:** Architecture authority  
**Purpose:** Decide when a campaign should stay in a market, deepen coverage, refresh it, or move to the next approved market based on supply quality and downstream outcomes.  
**Implementation owner:** Claude Code

---

# 1. CORE QUESTION

Once Jacksonville HVAC works, the system should eventually answer:

> Do we mine Jacksonville deeper, move into Orlando, test Tampa, expand across Florida, or switch some budget into another vertical?

This is a market-allocation problem separate from individual prospect scoring.

---

# 2. MARKET UNIT

Possible market scopes:

- city
- county
- metro/CBSA
- custom radius
- state region
- storm/event market

Each campaign explicitly chooses its market unit.

Do not mix city and entire-state performance without normalization.

---

# 3. MARKET STATE

`MarketState`

- UNTESTED
- PROBING
- PRODUCTIVE
- SCALING
- SATURATING
- COOLDOWN
- REFRESH_DUE
- PAUSED
- CLOSED_BY_POLICY

---

# 4. MARKET METRICS

Per vertical/market:

- approved search cells
- cells explored
- search tasks
- provider cost
- unique Accounts
- active advertiser Accounts
- Tier A
- Tier B+
- research-ready
- usable decision-maker contacts
- conversations
- decision-makers reached
- qualified conversations
- meetings
- opportunities
- closed outcomes where mature
- false-positive rate
- duplicate rate
- current ready inventory

---

# 5. UPSTREAM MARKET SCORECARD

Before meaningful sales outcomes exist, compare markets on:

1. advertiser density
2. Tier B+ density
3. research-ready yield
4. decision-maker enrichment rate
5. provider cost/Tier B+
6. false-positive rate
7. saturation curve

This is market-planning data, not prospect fit.

---

# 6. DOWNSTREAM SCORECARD

Once sample is sufficient, add:

- decision-maker reach rate
- qualified conversation rate
- meeting rate
- opportunity rate
- cost per qualified conversation
- cost per meeting
- cost per opportunity

Do not allow five lucky meetings to permanently redirect national strategy.

---

# 7. EXPANSION POLICY

Possible approved territory sequence is configured by business owner/admin.

Example HVAC initial policy:

1. St. Augustine / St. Johns
2. Jacksonville / Duval
3. adjacent Northeast Florida
4. Orlando
5. Tampa Bay
6. South Florida
7. remaining Florida metros
8. Southeast markets

The controller may recommend changes, but V1 does not autonomously enter unapproved states/markets.

---

# 8. MARKET PROBE

Before full mining, run a low-budget probe:

- top 3–6 query families
- limited cells
- advertiser observations
- small sample research

Estimate:

- paid-ad density
- business density
- expected Tier B+ yield
- expected cost

Then decide whether to scale.

---

# 9. SCALE RULE

A market may move PROBING -> PRODUCTIVE/SCALING when:

- enough unique target businesses exist;
- Tier B+ yield meets threshold;
- provider economics are acceptable;
- identity/noise quality is acceptable;
- inventory demand exists.

Thresholds belong in config and should be revised from actual pilot data.

---

# 10. SATURATION RULE

A market enters SATURATING when:

- most high-priority search cells are explored;
- marginal tasks mostly rediscover known Accounts;
- cost/new Tier B+ rises materially;
- ready inventory cannot be replenished efficiently.

Saturation does not mean abandon all future activity.

Move to cooldown/refresh schedule.

---

# 11. OUTCOME-BASED REALLOCATION

After enough outreach data:

Example:

- Orlando discovers many Tier A HVAC advertisers but low decision-maker reach;
- Tampa discovers fewer but produces more qualified conversations per research dollar.

Controller may recommend shifting incremental search budget toward Tampa while retaining Orlando refresh inventory.

Recommendation must show stage-by-stage cause.

---

# 12. VERTICAL ALLOCATION

Eventually compare verticals separately.

Do not directly compare:

`100 HVAC searches` to `100 law searches`

without accounting for:

- search/provider cost
- business density
- research depth
- contactability
- sales cycle
- meeting quality
- opportunity economics.

The system should report rather than prematurely collapse into one number.

---

# 13. EVENT MARKET SPECIAL CASE — HAIL

Hail markets can become temporarily high-priority because of current weather events.

Event-market controller may use approved weather/event inputs later.

Rules:

- event context must be current;
- market activation is separate from permanent PDR location;
- event-specific ads/pages/locations age rapidly;
- historical hail outcomes remain linked by storm/market.

Do not automatically launch outreach solely because a weather event occurred; campaign policy/approval still applies.

---

# 14. MARKET INVENTORY

Track inventory per market:

- unresearched
- researching
- ready Tier A
- ready Tier B
- leased/in-flight
- follow-up
- qualified
- exhausted/suppressed
- stale refresh

Expansion should consider whether reps/callers actually have capacity to work the inventory.

Do not mine 50,000 prospects nobody can use.

---

# 15. SALES CAPACITY COORDINATION

Inputs:

- number of active human reps
- target daily accounts/rep
- autonomous capacity if later approved
- follow-up workload
- meeting workload

If downstream sales capacity is full:

- reduce discovery;
- prioritize refresh and research quality;
- avoid needless provider spend.

---

# 16. BUDGET ALLOCATION

Campaign/market budget can be divided into:

- proven-market exploitation
- approved market exploration
- refresh
- provider validation

All spend remains capped.

---

# 17. MARKET RECOMMENDATION OBJECT

`MarketRecommendation`

- vertical
- market
- recommendation: probe | scale | maintain | cool_down | refresh | pause
- evidence window
- upstream metrics
- downstream metrics
- sample sizes
- provider economics
- capacity impact
- reasons
- uncertainties
- proposed budget
- approval status

---

# 18. FIRST FLORIDA HVAC TEST

After Jacksonville/St. Augustine proof:

Probe several approved Florida metros with identical top query families and comparable budget.

Compare:

- unique advertisers
- Tier B+ per dollar
- website resolution
- decision-maker enrichment

Do not immediately make calls merely to benchmark market supply.

Later compare real sales outcomes once Human Assist has enough data.

---

# 19. CORE RULE

The territory controller allocates prospecting effort to markets where the Prospect Factory creates usable sales opportunities efficiently. It does not rewrite what makes an individual company a good YAD prospect.
