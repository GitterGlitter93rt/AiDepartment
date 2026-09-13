# Your AI Department — First Launch Plan: Market Miner + Human Assist

**Status:** Initial operating plan after Claude implementation gates 0–8  
**Scope:** Jacksonville + St. Augustine HVAC  
**Autonomous AI cold calling:** OFF  
**Primary user:** Brent / YAD human salesperson

---

# 1. PURPOSE

The first real operational launch should validate the Prospect Factory before YAD adds autonomous voice risk.

Questions:

1. Can the system find better prospects than a generic list?
2. Are the facts/hooks accurate enough that a salesperson trusts them?
3. Do current Google advertisers generate more qualified conversations?
4. Does pre-call research reduce rep research time?
5. Which query/source/hook patterns deserve expansion?

---

# 2. ENTRY GATES

Do not start until Claude passes:

- Gate 0 audit
- Gate 1 data model
- Gate 2 scoring
- Gate 3 vertical loader
- Gate 4 Google advertiser miner
- Gate 5 entity resolution
- Gate 6 website intelligence
- Gate 7 first Market Miner acceptance
- Gate 8 Human Assist MVP.

Autonomous voice gates are irrelevant for this human-first launch.

Human outreach still follows approved YAD human sales/compliance procedures.

---

# 3. MARKET

Initial:

- Jacksonville
- St. Augustine
- approved surrounding cells from acceptance plan.

Vertical:

- HVAC.

Why:

- manual says Vertical Priority 1;
- urgent/high-ticket services;
- paid search/LSA relevance;
- phone-heavy customer journey;
- straightforward hooks.

---

# 4. PROSPECT COHORTS

Build comparable cohorts.

## Cohort A — Fresh Google advertiser Tier A

Highest priority.

## Cohort B — Fresh Google advertiser Tier B

## Cohort C — Non-advertiser/unknown-ad Tier A/B

Only if campaign allows gap-fill.

## Cohort D — Generic Apollo HVAC list after same dedupe/research/score

Optional controlled comparison.

Do not compare raw Apollo list to fully researched advertiser list; apply same downstream research/scoring where possible.

---

# 5. INITIAL DAILY VOLUME

Start intentionally small.

Example operational rollout:

- first day: 10–20 researched prospects
- review every outcome/data correction
- next days: 20–40 depending rep capacity/quality
- expand only if list accuracy/UX stable.

These are internal starting ranges, not permanent quotas.

Do not dump 500 accounts on one rep and lose feedback quality.

---

# 6. REP WORKFLOW

For each prospect:

1. open ranked card
2. inspect primary reason/hook
3. call using normal approved human workflow
4. select outcome
5. record correction/system/problem/numbers
6. create next step
7. DNC if requested
8. move to next.

Target prep time should be seconds/minutes, not manual research from scratch.

---

# 7. DAILY FEEDBACK REVIEW

Manager/architect reviews:

- wrong businesses
- wrong contacts
- stale/incorrect ads
- weak hooks
- CRM/system corrections
- no-pain high-score cases
- strong conversations
- rep UI friction.

Make fixes upstream.

Example:

If 8 “HVAC” leads are supply houses, improve vertical classifier/search exclusions before adding more rep coaching.

---

# 8. WHAT BRENT SHOULD RATE

After each/selected call:

- company research accurate? yes/no
- hook relevant? 1–5
- decision-maker info useful? yes/no
- prep saved time? yes/no/estimate
- primary hypothesis correct/supported/contradicted
- missing info needed.

Keep feedback quick enough rep actually uses it.

---

# 9. CORE SALES METRICS

- attempts
- conversations
- decision-makers reached
- qualified conversations
- strategy calls/next steps
- disqualifications
- DNC
- wrong contacts.

Break down by cohort/query/hook/tier.

Do not judge first 20 calls by close rate.

---

# 10. RESEARCH QUALITY METRICS

- business-category accuracy
- ad accuracy
- contact correction rate
- website/system correction rate
- duplicate incidents
- stale hook incidents.

Use Market Miner data-quality SLO.

---

# 11. ECONOMIC METRICS

- research/provider cost
- cost/Tier B+
- rep prep time
- cost/decision-maker reached
- cost/qualified conversation
- cost/meeting.

Compare advertiser-first vs generic cohorts when sample becomes useful.

---

# 12. HYPOTHESIS TO TEST

Primary:

> Businesses visibly paying for high-intent Google demand will create more relevant YAD conversations than generic unqualified local-business lists.

Secondary:

> Research-backed hooks improve decision-maker engagement compared with generic AI-service openers.

Do not treat hypotheses as true before outcomes.

---

# 13. HOOK TRACKING

Log hook family:

- paid after-hours
- missed call
- replacement estimate
- speed-to-lead
- attribution
- employee capacity
- CRM workflow.

Manager asks:

> Which hooks create qualified conversations?

not:

> Which hook makes calls longer?

---

# 14. RESEARCH CORRECTIONS

Every correction routed upstream.

Examples:

- “We stopped running Google ads.”
- “That person hasn't worked here in a year.”
- “We use Housecall Pro, not ServiceTitan.”
- “We have four offices, not two.”

This creates real labeled QA data.

---

# 15. FIRST WEEK EXIT REVIEW

After a meaningful first working set, review:

- list accuracy
- rep trust/usability
- advertiser cohort performance
- query family yield
- provider cost
- contact enrichment usefulness
- score calibration observations
- strongest/weakest hooks
- common no-sale reasons.

Do not change canonical score from tiny sample, but record proposals.

---

# 16. EXPANSION DECISION

Possible next moves:

## A — More Jacksonville/St. Augustine HVAC

If market not saturated.

## B — Plumbing same geography

Validates second profile with same Market Miner.

## C — Orlando/Tampa HVAC

Validates geography expansion.

## D — Improve data before expansion

If accuracy/contacts/hooks weak.

Choose based on evidence.

---

# 17. WHEN TO START VOICE ENGINE WORK

Claude can technically develop later gates in parallel after Market Miner architecture is stable, but business pilot should not wait for AI caller to get value.

The human launch supplies:

- real objection patterns
- real research corrections
- real call outcomes
- actual best hooks
- baseline human performance.

These improve AI certification later.

---

# 18. SUCCESS DEFINITION

The first launch succeeds if YAD can say:

> We now have a repeatable machine that finds and ranks local HVAC prospects, especially current advertisers, tells Brent why each one is worth calling and what to ask, and captures the outcome so the next batch gets smarter.

It does not require an AI voice agent yet.
