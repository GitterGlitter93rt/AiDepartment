# Your AI Department — Event Market Activation Brain

**Status:** Architecture authority  
**Purpose:** Allow the Prospect Factory to recognize time-sensitive market events—especially hail/severe weather—that may justify activating research for PDR/Hail, Roofing, Restoration, and related verticals without automatically authorizing outreach.  
**Implementation owner:** Claude Code

---

# 1. CORE IDEA

Some YAD target markets are event-driven.

Examples:

- automotive hail
- storm roofing
- water/fire restoration
- freeze-related plumbing/restoration
- severe weather service surges.

The Market Miner should eventually be able to say:

> “A new hail event affected this metro. This is an approved target region. Start a research-only market probe and determine which relevant businesses are actively entering the market or advertising.”

It should NOT say:

> “Storm happened, automatically blast everyone with calls.”

Research activation and outreach authorization are separate.

---

# 2. EVENT TYPES

Initial architecture categories:

- HAIL
- SEVERE_CONVECTIVE_STORM
- WIND
- FREEZE
- FLOOD_WATER_EVENT
- FIRE_EVENT where appropriate public data exists
- OTHER_APPROVED_MARKET_EVENT

Not every event is relevant to every vertical.

---

# 3. EVENT SOURCE ADAPTER

`MarketEventProvider`

Output:

- event_id
- event_type
- source
- observed_at
- event_start/end where known
- geography/polygon/points
- severity attributes
- confidence
- source reference
- raw retention policy

Implementation must use reliable public/licensed source and revalidate terms.

NOAA/NWS or other official/public weather data may be candidates; Claude must audit exact source/API during implementation.

---

# 4. EVENT NORMALIZATION

Provider-specific weather/event data becomes canonical `MarketEvent`.

Store:

- type
- time
- affected geography
- severity/supporting facts
- source.

Do not turn generalized severe-weather loss figures into local repair opportunity estimates.

---

# 5. EVENT-TO-VERTICAL MAP

## HAIL

Potential profiles:

- pdr-hail-us-v1
- roofing-us-v1
- collision-repair-us-v1 where hail service exists.

## WIND / SEVERE STORM

Potential:

- roofing
- restoration
- general contractors depending approved strategy.

## FREEZE

Potential:

- plumbing
- restoration
- HVAC/electrical only when relevant, not automatically.

## WATER/FLOOD

Potential:

- restoration
- plumbing depending context.

---

# 6. ACTIVATION POLICY

`EventActivationPolicy`

- event types allowed
- approved states/metros
- verticals
- minimum event confidence/severity criteria
- research mode only vs campaign proposal
- provider budget
- freshness window
- admin approval requirement
- outreach mode default OFF.

V1 should default to research-only activation.

---

# 7. EVENT MARKET OBJECT

`EventMarket`

- market_event_id
- vertical_profile
- geography
- activation_status
- first_detected
- last_updated
- search plan
- existing YAD market history
- current event-specific advertisers
- temporary locations/pages
- market inventory
- event freshness
- owner/admin status.

---

# 8. PDR/HAIL RESEARCH PLAN

When approved current hail event detected:

1. resolve affected cities/ZCTAs/metros;
2. search approved hail query families;
3. identify current Google/Meta hail campaigns where reliable;
4. inspect hail-specific landing pages;
5. distinguish permanent shop vs mobile/storm operator;
6. identify temporary/local location claims;
7. research field-sales/multi-market signals;
8. score/rank using PDR/Hail profile;
9. no contact until separate campaign/contact policy.

---

# 9. ROOFING EVENT PLAN

Search approved terms:

- hail damage roof
- storm damage roof
- roof repair
- roof replacement.

Research:

- storm-specific ads/landing pages
- inspection offer
- financing
- new temporary market pages
- multi-market operation
- CRM/sales team signals.

Do not assume every roofer wants storm work.

---

# 10. RESTORATION EVENT PLAN

For freeze/water/storm event:

research:

- emergency water removal ads
- 24/7
- commercial emergency service
- location/service-area expansion
- call/overflow funnel.

Do not claim local loss volume from weather event alone.

---

# 11. EVENT FRESHNESS

Event-market evidence ages rapidly.

Track:

- event active/recent/historical
- ad first/last observed
- temporary market page first/last observed
- location signal freshness.

Once stale:

- current-event hooks disabled
- historical Account relationship remains.

---

# 12. MARKET-LAUNCH SIGNALS

Public signals:

- new city landing page
- “now serving [market]”
- current hail creative
- temporary shop location
- job listings / field rep recruitment
- local tracking numbers
- storm-specific offers.

These may strengthen PDR/Hail market-launch hypothesis.

Never infer actual lead volume.

---

# 13. YAD INTERNAL HAIL USE CASE

Because YAD leadership has deep collision/PDR/hail operating context, this engine may later support YAD's own hail-related business intelligence.

Keep Account/client data and any separate hail operating company data appropriately isolated by tenant/project.

Do not let shared founder knowledge bypass source/provenance rules in the automated system.

---

# 14. EVENT DEDUPE

Weather providers may report many observations from one storm.

Group into event/market context conservatively.

Do not create a new sales market for every individual hail report.

---

# 15. EVENT MARKET SATURATION

Event markets have lifecycle:

- DETECTED
- PROBING
- ACTIVE_RESEARCH
- PRODUCTIVE
- DECLINING
- STALE
- HISTORICAL.

As event ages and advertisers leave, stop expensive repeated mining.

---

# 16. OUTREACH AUTHORIZATION SEPARATE

Event detection may create:

- research job
- MarketRecommendation
- admin alert.

It may NOT automatically:

- create autonomous call campaign
- send SMS/email
- submit forms
- visit private locations.

Outreach requires normal account/campaign/compliance controls.

---

# 17. ANALYTICS

Measure:

- event-to-first-research time
- unique advertisers/operators
- Tier B+
- provider cost
- new vs known Accounts
- eventual Human Assist outcomes
- market duration/saturation.

This helps determine whether event-triggered mining is commercially useful.

---

# 18. RED-TEAM CASES

1. Old hail event imported -> historical only, no current hook.
2. Severe storm with no target business evidence -> no automatic calls.
3. Roofing company with no storm service -> still ordinary Roofing context unless evidence.
4. Mobile hail operator uses same brand across cities -> one Account + market/location contexts.
5. Event data broad county polygon -> do not claim every city/property was damaged.
6. Weather provider outage -> no invented event.

---

# 19. ACCEPTANCE TESTS

1. Current hail event in approved Florida market -> research-only PDR/Roofing probe allowed.
2. Market not approved -> recommendation/alert only, no job if policy says approval required.
3. 1-year-old hail evidence -> no current market language.
4. Freeze -> Plumbing/Restoration research per policy, not every vertical.
5. Storm query finds aggregator -> false-positive layer handles it.
6. Event research discovers existing DNC Account -> research may update public intelligence, outreach still suppressed.
7. Event generates temporary location -> Account identity remains canonical.
8. Current event ends -> market transitions declining/stale based on configured freshness.

---

# 20. CORE RULE

Events can tell the Market Miner where business conditions may have changed. They never prove demand, damage, revenue, or permission to contact someone. Event intelligence activates research; normal evidence and outreach policy still control what happens next.
