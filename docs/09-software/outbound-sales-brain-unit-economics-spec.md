# Your AI Department — Prospect Factory / Outbound Sales Unit Economics Specification

**Status:** Architecture authority  
**Purpose:** Measure whether the prospect-mining/research/contact system is economically worthwhile and where costs should be optimized without chasing cheap activity that produces poor meetings.

---

# 1. PRINCIPLE

Optimize for business outcomes, not cheapest API request.

The important progression is:

`Cost per search`
-> `Cost per unique Account`
-> `Cost per Tier B+ prospect`
-> `Cost per decision-maker reached`
-> `Cost per qualified conversation`
-> `Cost per meeting`
-> `Cost per opportunity`
-> `Customer acquisition cost`
-> `Collected revenue / gross margin`

Each denominator answers a different question.

---

# 2. COST CATEGORIES

## Discovery

- paid SERP API
- Places/business discovery
- public/business data provider.

## Research

- website crawling/browser rendering
- contact enrichment
- Meta/ad transparency enrichment
- LLM tokens/inference
- technology provider if added.

## Outreach

- Twilio voice minutes
- ConversationRelay/media cost
- STT
- TTS
- realtime LLM
- SMS/email
- call lookup/line type.

## Human

Optional management accounting:

- rep labor
- manager QA/coaching
- manual research/review.

## Infrastructure

- server/database/queue/object storage
- monitoring
- shared SaaS subscriptions allocated reasonably.

---

# 3. PROVIDER USAGE RECORD

Every billable operation stores:

- provider
- operation
- campaign
- account/research/call if applicable
- unit count
- currency
- estimated/actual cost
- billed status if known
- timestamp.

Do not calculate provider costs later solely from total monthly invoice if usage-level attribution is possible.

---

# 4. SHARED FIXED COSTS

Separate:

- variable usage cost
- fixed monthly platform cost
- human overhead.

Example:

A $99/month provider subscription should not be charged entirely to the first prospect of the month.

Allocate for management reporting using documented method:

- per request
- per campaign share
- per active account
- or report fixed cost separately.

---

# 5. MARKET MINER METRICS

`cost_per_search_task = search_cost / tasks`

`cost_per_paid_observation = discovery_cost / valid_paid_observations`

`cost_per_unique_advertiser = discovery_cost / unique_valid_advertisers`

`cost_per_research_complete_account = discovery_plus_research_cost / research_complete_accounts`

`cost_per_tier_b_plus = discovery_plus_research_cost / tier_b_plus_accounts`

These are core Gate 7 metrics.

---

# 6. CONTACT ENRICHMENT ECONOMICS

`contact_enrichment_cost_per_account`

`cost_per_useful_decision_maker_contact`

`cost_per_decision_maker_reached`

A contact provider can be expensive per record but valuable if reach rates improve.

Do not optimize contact cost without downstream outcome.

---

# 7. HUMAN ASSIST ECONOMICS

Optional once reps use system:

- research minutes saved per prospect
- calls/hour
- decision-maker conversations/hour
- qualified conversations/hour
- meetings/hour.

Compare:

- old manual research list workflow
- Market Miner Human Assist.

One of the first ROI cases for YAD internally may simply be rep productivity + better targeting.

---

# 8. VOICE UNIT COST

Per Call:

- telecom duration cost
- ConversationRelay/media feature cost
- STT
- TTS
- LLM
- lookup
- action messages.

Metrics:

- cost/attempt
- cost/answered call
- cost/conversation minute
- cost/decision-maker conversation
- cost/qualified conversation
- cost/meeting.

Do not celebrate low cost/minute if poor voice quality destroys conversion.

---

# 9. END-TO-END CAMPAIGN COST

Campaign variable cost:

`discovery + research + enrichment + telecom + AI + messages`

Optional fully loaded:

`variable + allocated fixed infrastructure + human labor`

Report both when useful.

---

# 10. RESEARCH DEPTH ECONOMICS

Compare:

## Basic research

- cheaper
- lower contact specificity.

## Sales-ready research

- website/ad/system/contact.

## Premium refresh

- immediate current ad/contact refresh.

Measure whether deeper research improves qualified conversation/meeting enough to justify cost.

Do not assume maximum research is always best.

---

# 11. ADVERTISER-FIRST ECONOMICS

Compare cohorts:

- Google advertiser Tier B+
- LSA advertiser Tier B+
- multi-channel advertiser Tier B+
- generic non-advertiser Tier B+
- Apollo generic list after same score/research.

Metrics:

- cost/Tier B+
- contact rate
- qualified conversation
- meeting
- opportunity
- close.

This tests Michael's core hypothesis that businesses already paying for demand are better YAD targets.

---

# 12. QUERY ECONOMICS

For each query family:

- provider tasks/cost
- unique new advertisers
- Tier B+ produced
- meeting outcomes later.

Example:

`emergency AC repair`

may cost more/less than

`HVAC contractor`

but could yield better operational pain/decision-maker conversations.

Shift query budget based on downstream value, not only advertiser count.

---

# 13. TERRITORY ECONOMICS

Per city/metro/cell:

- discovery cost
- unique accounts
- Tier B+
- qualified conversations
- meetings
- opportunities.

Use to decide when to expand geographic campaigns.

Do not assume larger city is automatically better.

---

# 14. COST OF DUPLICATES

Track provider/research waste from duplicate Account rediscovery.

`duplicate_discovery_cost`

`duplicate_enrichment_cost_avoided`

Entity resolution should reduce downstream expensive repeat work.

---

# 15. COST OF STALE RESEARCH

Refresh only fields needed.

Measure:

- ad-refresh cost
- full-research cost
- percentage of refreshes materially changing Call Pack.

If most 24h refreshes never change anything, TTL may be too aggressive; if stale-ad corrections frequent, TTL too long.

Adjust based on data, not guess.

---

# 16. COST OF BAD DATA

Bad research creates hidden costs:

- wasted calls
- brand damage
- lower trust
- rep time
- compliance risk.

Track:

- wrong business/category
- wrong domain
- wrong contact
- stale hook
- duplicate outreach.

Do not choose cheap provider solely because raw records cost less if correction rate is high.

---

# 17. MEETING QUALITY

Not every meeting equal.

Eventually classify:

- unqualified meeting
- qualified workflow issue
- measurable business case
- real opportunity.

Measure cost per qualified meeting/opportunity, not calendar bookings alone.

---

# 18. REVENUE ATTRIBUTION

Closed YAD customer should retain:

- original source
- mining job/campaign
- ad/query evidence cohort
- first hook
- sales path
- opportunity
- collected revenue.

This lets YAD learn which prospect source truly produces business.

Do not attribute entire customer to last call if source/campaign chain matters.

---

# 19. MARGIN

For YAD internal program, later include:

- implementation delivery cost
- fulfillment labor/vendor cost
- gross margin.

A campaign generating high revenue but low-margin, difficult clients may not be the best ICP.

This is later-stage data.

---

# 20. BUDGET SETTINGS

Campaign can configure:

- daily discovery budget
- research/account cap
- contact enrichment cap
- voice/day cap
- total campaign cap.

Circuit breakers pause additional spend when thresholds reached.

---

# 21. BUDGET OPTIMIZER — V1

V1 does not autonomously reallocate large budgets.

It can recommend:

> Emergency AC queries produced 2.4x more Tier A accounts per dollar than generic HVAC queries this week.

Human approves material strategy changes.

---

# 22. FUTURE OPTIMIZER

After enough data, possible constrained allocation:

- multi-armed bandit/query budget
- territory expansion priority
- research depth selection.

Guardrails:

- minimum exploration
- spend caps
- no compliance/truth experimentation
- human override.

Not V1 requirement.

---

# 23. EXAMPLE ACCOUNT COST ROLLUP

For one Account:

- three paid SERP task shares: $X
- website crawl/browser: $Y
- Claude synthesis: $Z
- Apollo contact: $A
- ad refresh before call: $B

`research_cost = X+Y+Z+A+B`

Then later:

- human/AI attempt cost
- meeting/outcome.

Do not hard-code dollar examples until provider costs measured.

---

# 24. FIRST MARKET REPORT

Jacksonville/St. Augustine HVAC Gate 7 report must include at least:

- total provider spend
- searches
- unique advertisers
- unique Accounts
- research complete
- Tier A/B
- cost/unique advertiser
- cost/Tier B+
- top/low-yield queries
- duplicate waste.

No voice cost yet.

---

# 25. FIRST HUMAN ASSIST REPORT

After Brent works sample:

- research cost/prospect
- rep calls
- decision-makers
- qualified conversations
- meetings
- rep time/research-time saved estimate if measured.

This becomes the first real internal validation of Prospect Factory value.

---

# 26. FIRST CONTROLLED VOICE REPORT

Test participants only:

- cost/minute
- cost/test call
- latency
- tool cost
- no conversion conclusions from test participants.

Controlled test is for quality, not sales economics.

---

# 27. PRODUCTION REPORT

Only after approved real pilot:

- cost/attempt
- cost/conversation
- cost/decision-maker
- cost/qualified conversation
- cost/meeting
- cost/opportunity
- research + telecom + AI separately
- source/hook/tier cohort.

---

# 28. NO FAKE PRECISION

When provider invoice cost is delayed/estimated:

mark:

- estimated
- actual
- reconciled.

Do not present estimated micro-cost as exact accounting fact.

---

# 29. ACCEPTANCE

The system must make it possible to answer:

> How much did it cost us to produce these 100 Tier B+ HVAC prospects?

and later:

> Which prospect source and hook gives us the cheapest qualified opportunities without lowering quality?

If it cannot, the learning loop is incomplete.
