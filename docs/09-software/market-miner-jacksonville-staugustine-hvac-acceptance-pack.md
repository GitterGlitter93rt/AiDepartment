# Your AI Department — First Market Miner Acceptance Pack

**Pilot market:** Jacksonville + St. Augustine, Florida  
**Vertical:** HVAC  
**Mode:** Research-only / Human-assist  
**Autonomous prospect calling:** OFF  
**Purpose:** Define exactly what Claude must produce before the Market Miner is considered a usable prospect-supply product.

---

# 1. BUSINESS QUESTION

Can YAD give a salesperson a high-quality ranked list of HVAC businesses in the Jacksonville/St. Augustine market where every prospect has a defensible reason for outreach, with active Google advertisers prioritized?

The milestone is successful even if the final number is below the requested target, provided the system reports the shortfall honestly.

---

# 2. REQUEST

Canonical test request:

- vertical: HVAC
- geography: Jacksonville + St. Augustine, Florida
- mode: advertiser-first
- minimum tier: B
- target ready inventory: 100
- research depth: sales-ready
- Google ad freshness target: <=48 hours for current-ad-specific hooks
- Meta: optional secondary evidence
- decision-maker enrichment: attempt, not mandatory
- no outreach

---

# 3. TERRITORY

Initial intended area:

- Jacksonville city/core market
- St. Augustine city/core market
- selected St. Johns / Duval ZCTAs/search cells according to geography planner
- adjacent cells only when staged expansion logic justifies it

The test is not “all of Florida.”

Claude must print/store the actual resolved geography/search cells before provider spending begins.

---

# 4. QUERY PLAN

Start with HVAC profile high-value queries.

Pass 1 example:

- emergency AC repair
- AC repair
- AC replacement
- HVAC contractor
- heat pump installation
- HVAC financing

Run market-localized Jacksonville and St. Augustine observations.

Pass 2:

- selected high-yield query families across prioritized cells/ZCTAs.

Pass 3:

- synonyms/extra cells only while yield/budget thresholds justify.

The final report must show exactly how many tasks ran per query family/geography.

---

# 5. TARGET FUNNEL

Requested, not guaranteed:

`paid observations`
-> `unique advertiser identities`
-> `canonical HVAC Accounts`
-> `website research`
-> `evidence + score`
-> `Tier A/B`
-> `Call Pack ready`

Do NOT fabricate expected percentages before data exists.

---

# 6. REQUIRED OUTPUT PER PROSPECT

Every ready prospect record must include:

## Identity

- canonical company name
- account ID
- location(s)
- primary phone or explicit unavailable status
- canonical website/domain or explicit resolution status

## Discovery provenance

- source/provider
- queries/cells that found prospect
- first/last observation timestamp
- paid format(s): search/LSA/local sponsored where known

## Google ad evidence

- current status: confirmed current / repeated / transparency-only / unknown
- advertised service(s)
- landing page/domain
- observation freshness

## Website intelligence

- services
- 24/7/emergency
- financing
- quote/booking/contact CTA
- physical locations vs service area
- tracking signals
- CRM/field-service signals
- hiring/growth signals

## Score

- raw Module 4C points
- Tier A/B
- every component + evidence IDs

## Research completeness

- label
- missing research
- stale items

## Strategy

- primary hypothesis
- backup hypothesis
- primary offer hypothesis
- primary hook
- backup hook
- first three questions
- prohibited claims

## Contacts

- decision-maker/contact if found
- role/source/confidence
- `unknown` if not found

## Cost

- attributable provider usage/cost where practical

---

# 7. READY CRITERIA

Normal `READY_HUMAN_ASSIST` requires:

- identity resolved enough to avoid obvious duplicate/misroute;
- HVAC classification passes;
- score >=6;
- research completeness `good` or `complete` unless manager explicitly allows partial;
- primary hook has evidence basis;
- current-ad wording only when current ad evidence fresh;
- primary phone available for phone queue, or kept in non-phone prospect list;
- no known current suppression/existing-customer exclusion.

No compliance decision for autonomous AI voice is required because this milestone does not autonomously call.

---

# 8. MANUAL AUDIT SAMPLE

Before accepting 100-prospect list, randomly select at least 20 ready prospects, with a mix of:

- Tier A and B;
- Google search advertisers;
- LSA if present;
- repeated advertisers;
- multi-location businesses;
- ServiceTitan/other system signals;
- no-system-signal cases;
- Jacksonville and St. Augustine.

Reviewer checks actual public evidence manually.

---

# 9. MANUAL AUDIT SCORECARD

For each sampled prospect:

1. Is this a real HVAC service business?
2. Is canonical domain correct?
3. Is phone/business identity correct?
4. Were duplicates merged correctly?
5. Is physical-location count accurate?
6. Was current Google ad evidence actually paid?
7. Is advertised service extracted correctly?
8. Is 24/7 claim accurate?
9. Is financing claim accurate?
10. Are CTAs accurate?
11. Are technology/CRM signals labeled as signals rather than backend facts?
12. Does Module 4C arithmetic match evidence?
13. Is Tier correct?
14. Is primary hook grounded in confirmed facts?
15. Does hook avoid accusations?
16. Are prohibited claims appropriate?
17. Is decision-maker source/confidence honest?
18. Is research freshness correct?
19. Is provider/source provenance visible?
20. Would a competent salesperson understand why this company is worth calling?

---

# 10. AUTOMATIC HARD FAILS

Market acceptance fails if sample finds systemic examples of:

- ordinary/organic result classified as paid;
- pixel/tag classified as active ad;
- company absent from sampled ad results classified “not advertising” as fact;
- aggregator ad assigned to wrong contractor;
- wrong canonical domain/phone at material rate;
- duplicate accounts creating duplicate outreach risk;
- ServiceTitan/CRM frontend signal stated as confirmed backend process;
- score arithmetic wrong;
- points added outside canonical Module 4C without explicit separate label;
- stale ad used as “currently advertising” hook;
- fake form/appointment submission used in research.

---

# 11. INITIAL QUALITY THRESHOLDS

Architecture targets for manually audited sample:

- business-category precision >=95%
- canonical-domain precision >=95% where domain resolved
- paid-ad classification precision >=95%
- score arithmetic = 100%
- unsupported backend CRM claim = 0
- pixel-to-active-ad false inference = 0
- duplicate outreach risk from known merges = 0 critical failures
- current-ad hook without fresh evidence = 0

If sample too small, report raw numerator/denominator alongside percentage.

These are initial engineering quality gates, not external marketing claims.

---

# 12. INVENTORY SHORTFALL

If market produces:

- 100+ qualifying -> stop at high-water according to campaign settings.
- 73 qualifying -> report 73 and why.
- 40 qualifying advertisers but 35 additional non-advertiser Tier B+ -> advertiser-first campaign may include them only if campaign permits non-ad gap fill.
- advertiser-only mode -> never fill target with non-advertisers silently.

System should recommend next approved territory/search expansion based on coverage/yield.

---

# 13. PROVIDER COST REPORT

Include:

- provider tasks
- cost
- paid observations
- unique advertisers
- unique canonical Accounts
- Tier A count
- Tier B count
- cost/unique advertiser
- cost/Tier B+
- cost by query family
- cost by geography/search cell

This is the first real economic measurement of Market Miner.

---

# 14. QUERY YIELD REPORT

Example columns:

- query family
- market/cell
- tasks
- paid observations
- unique advertisers
- new advertisers
- duplicates
- Tier B+
- cost
- saturation status

This tells YAD which searches are worth continuing.

---

# 15. EXAMPLE ACCEPTABLE PROSPECT CARD

Company:

Example Comfort Air

Tier:

A — 12

Why high priority:

- fresh Google sponsored observation for emergency AC repair
- high-value replacement services
- lead-heavy HVAC customer journey
- 24/7 service
- quote form
- strong phone dependence

System signal:

ServiceTitan booking-related frontend signal — workflow unknown.

Primary hypothesis:

Paid urgent calls may require an overflow/after-hours recovery process.

Hook:

> I noticed you guys are advertising around emergency AC in Jacksonville. When one of those calls comes in after hours or everybody is already tied up, what happens next?

Unknowns:

- actual missed-call rate
- answering/overflow setup
- monthly ad spend
- CRM follow-up configuration

Never claim:

- they are losing calls
- they spend a fortune
- ServiceTitan is configured badly

---

# 16. EXAMPLE ACCEPTABLE NON-ADVERTISER CARD

Only if campaign allows gap fill.

Company:

Example Multi-Location HVAC

Evidence:

- three physical locations
- 24/7
- online booking
- high-value replacement
- active CSR hiring
- strong phone dependence
- no confirmed current paid advertising

Tier:

A based on non-ad public signals if canonical score supports it.

Hook:

> When peak-season volume spikes across the three locations, where does the office get overloaded first — phones, scheduling, dispatch, follow-up, or reporting?

Do NOT mention Google ads.

---

# 17. HUMAN SALES TEST

After research quality passes, before autonomous voice:

Give a bounded subset to Brent/human rep in Human Assist.

Collect:

- whether company/decision-maker info was accurate;
- whether hook felt relevant;
- whether public facts were corrected;
- conversation outcome;
- missing fields reps needed;
- usability feedback.

This is implementation/user testing, not automated calling.

---

# 18. ACCEPTANCE REPORT

Claude must produce:

1. MiningJob config.
2. Resolved geography/search cells.
3. Provider benchmark/routing used.
4. Query task/yield report.
5. Provider cost report.
6. Prospect funnel counts.
7. Tier distribution.
8. Research completeness distribution.
9. Manual audit results with numerator/denominator.
10. Examples of top 10 Call Packs.
11. Known errors/uncertainties.
12. Honest inventory shortfall if any.
13. Recommended next improvement.
14. Confirmation that no prospect was contacted.

---

# 19. DEFINITION OF MILESTONE SUCCESS

Market Miner V1 is valuable when Brent can open the Human Assist queue and see a ranked list where:

- the companies are real;
- the ad evidence is real;
- duplicates are controlled;
- the score is explainable;
- the website research is useful;
- the hook makes sense;
- unknowns are explicit;
- no one has to manually Google every company before dialing.

That is the foundation Twilio will later consume.
