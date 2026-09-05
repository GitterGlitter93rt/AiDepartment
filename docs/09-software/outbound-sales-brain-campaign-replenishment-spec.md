# Your AI Department — Campaign & Prospect Replenishment Specification

**Status:** Architecture authority  
**Purpose:** Define how the Market Miner maintains a ranked inventory of researched prospects and how campaigns consume that inventory without duplicate research/contact or runaway provider spend.

---

# 1. CAMPAIGN PRINCIPLE

A campaign is not a CSV upload plus a dial button.

A campaign is a controlled market operation with:

- vertical;
- geography;
- source strategy;
- target ready inventory;
- minimum fit tier;
- research freshness policy;
- contact mode;
- compliance policy;
- daily budgets/caps;
- follow-up rules;
- explicit pause/kill controls.

The Market Miner should continuously answer:

> How many high-quality, fresh, eligible prospects are available for this campaign right now, and where should the next ones come from?

---

# 2. CAMPAIGN STATES

- `draft`
- `research_only`
- `mining`
- `ready_human_assist`
- `controlled_test`
- `production_paused`
- `production_active`
- `budget_paused`
- `compliance_paused`
- `quality_paused`
- `completed`
- `archived`

Production-active must be impossible without explicit approved operating mode and current policy gates.

---

# 3. CAMPAIGN INPUT CONTRACT

Required:

- campaign ID/name;
- vertical profile/version;
- geography selector;
- mining provider policy;
- minimum YAD tier;
- target ready inventory;
- operating mode;
- research freshness policy;
- daily provider budget;
- lifetime provider budget optional;
- maximum new prospects per day;
- maximum research runs per day;
- maximum contact attempts/day for downstream calling;
- compliance policy version;
- owner;
- start/stop state.

Optional:

- required signals;
- preferred signals;
- excluded accounts/domains;
- existing customer list;
- franchise exclusions;
- company-size preferences;
- advertiser-only mode;
- LSA-priority mode;
- high-ticket-service preference;
- decision-maker requirement;
- territory expansion sequence.

---

# 4. READY INVENTORY

`Ready Inventory` means prospects satisfying the campaign's research requirements.

For human-assist, normal minimum:

- canonical account identity;
- vertical classified;
- primary phone or explicit unavailable status;
- website resolution attempted;
- research run complete/acceptable;
- score/tier calculated;
- research completeness acceptable;
- primary hypothesis/hook generated;
- no known suppression preventing human outreach under company rules.

For autonomous downstream queue, additional compliance/contactability gates apply.

Do not count stale or in-flight records as ready.

---

# 5. INVENTORY TARGET

Example:

`Jacksonville HVAC: maintain 250 Tier B+ research-complete prospects.`

Controller behavior:

- Ready inventory >= target -> pause new mining except scheduled freshness refreshes.
- Inventory drops below low-water mark -> resume mining.
- Inventory exceeds high-water mark -> finish current provider batch then pause.

Suggested defaults:

- target = 250
- low-water = 80% of target
- high-water = 110% of target

All configurable.

This hysteresis prevents constant start/stop thrashing.

---

# 6. INVENTORY CONSUMPTION

A prospect leaves `ready` inventory temporarily/permanently when:

- assigned to human rep;
- queued for approved call;
- contacted;
- research becomes stale;
- compliance status requires review;
- duplicate/merge discovered;
- disqualified;
- suppressed;
- converted to active opportunity/customer.

A follow-up prospect belongs to follow-up workflow, not the new-prospect inventory.

---

# 7. QUEUE PRIORITY ALGORITHM

Fit and contact eligibility are separate.

## Stage 1 — hard gates

Exclude from ready call queue if:

- suppression/DNC;
- existing customer exclusion;
- duplicate active attempt;
- unresolved identity conflict;
- research required for selected hook is stale;
- campaign paused;
- contact/calling policy fails;
- local calling window fails for autonomous use;
- campaign daily cap reached.

## Stage 2 — priority features

Rank remaining prospects using a transparent priority model.

Recommended order:

1. YAD tier: A before B before C before D.
2. Canonical YAD score within tier.
3. Fresh confirmed paid-ad evidence.
4. Local Services Ad/high-intent paid-call evidence where campaign values it.
5. Research completeness.
6. Multi-channel paid advertiser.
7. Urgency/after-hours signal.
8. High-ticket/estimate workflow.
9. Multiple locations/growth signals.
10. Decision-maker contact availability.
11. Research age — fresher first when otherwise equal.
12. Never-contacted before previously attempted, unless follow-up policy says otherwise.

Do not create hidden score points that alter canonical Module 4C score. Use a separate `queue_priority` explanation.

---

# 8. TIE-BREAK EXAMPLE

Two Tier A HVAC prospects both score 12.

Prospect 1:

- fresh Google sponsored emergency AC observation;
- 24/7;
- complete research;
- decision-maker found.

Prospect 2:

- last Google ad observation 36 hours ago;
- replacement focus;
- partial contact research.

Prospect 1 goes first.

Both remain Tier A / 12. Queue ranking does not rewrite fit score.

---

# 9. ADVERTISER-FIRST MODE

Campaign setting:

`advertiser_first = true`

Behavior:

1. Mine fresh paid Google SERPs first.
2. Deduplicate advertisers.
3. Research/scoring.
4. Fill target inventory from Tier A/B advertisers.
5. If insufficient inventory and campaign permits expansion, use Google Places/organic/public sources for non-advertiser high-fit prospects.

If `advertiser_only = true`, do not silently fill with non-advertisers; report inventory shortfall.

---

# 10. QUERY-BATCH STRATEGY

Per search cell/market:

## Pass 1 — core high-intent

Small number of strongest queries.

HVAC example:

- AC repair
- emergency AC repair
- AC replacement
- HVAC contractor
- heat pump installation
- HVAC financing

## Pass 2 — geography expansion

Repeat top-yield query families across selected ZCTA/cells.

## Pass 3 — query expansion

Add synonyms/service variants only while unique advertiser yield remains economically useful.

Do not launch a giant Cartesian product by default.

---

# 11. QUERY YIELD METRICS

Per query/search cell track:

- tasks run;
- paid results observed;
- unique advertisers;
- new unique advertisers;
- duplicates;
- research-qualified prospects;
- Tier A/B prospects;
- provider cost;
- cost per new advertiser;
- cost per Tier A/B prospect.

This allows automated query-budget shifts later.

---

# 12. SATURATION

A search cell/query family may become `saturated` when repeated mining produces mostly already-known entities.

Initial heuristic example:

Across last N comparable runs:

- >=90% known/duplicate advertisers;
- fewer than configured minimum new prospects;
- no meaningful Tier A/B yield improvement.

Then:

- cooldown search cell/query family;
- try adjacent geography/query family;
- revisit after refresh interval.

Saturation is not permanent.

---

# 13. TERRITORY EXPANSION

Campaign may define ordered territory groups.

HVAC Florida example:

1. St. Augustine / St. Johns
2. Jacksonville / Duval
3. Clay / Nassau
4. Orlando metro
5. Tampa Bay
6. South Florida
7. additional Florida metros

Expansion trigger options:

- current territory saturated;
- target inventory cannot be met;
- cost per new Tier A/B exceeds threshold;
- leadership manually advances territory.

Do not automatically expand nationwide simply because one city is temporarily low inventory.

---

# 14. RESEARCH DEPTH TIERS

## Depth 0 — discovery

- raw source observation;
- identity hints.

## Depth 1 — basic

- entity resolution;
- website/domain;
- phone;
- vertical classification;
- initial score signals.

## Depth 2 — sales-ready

- website research;
- current paid-ad evidence;
- system/CRM signals;
- offer/CTA;
- opportunity/Call Pack;
- decision-maker search attempt.

## Depth 3 — premium refresh

- fresh advertiser recheck;
- deeper public research;
- contact validation;
- used immediately before high-priority human/autonomous contact when justified.

Do not run Depth 3 on every discovered business.

---

# 15. RESEARCH REFRESH POLICY

Refresh only fields that need refresh.

Examples:

- current ads -> frequent refresh;
- website technology -> moderate refresh;
- location/address -> slower refresh;
- DNC/compliance -> immediate pre-contact evaluation.

A refresh run may reuse still-fresh evidence from earlier runs.

Do not recrawl ten pages because one ad observation expired.

---

# 16. PROVIDER BUDGET CIRCUIT BREAKERS

Per campaign:

- daily spend cap;
- total spend cap;
- task cap;
- provider-specific cap;
- max cost per new unique prospect threshold;
- max cost per Tier A/B threshold.

When cap breached:

- stop scheduling new paid provider jobs;
- complete/collect already-paid tasks where appropriate;
- mark campaign `budget_paused`;
- surface reason to admin.

Never allow an LLM to override a provider-spend circuit breaker.

---

# 17. QUALITY CIRCUIT BREAKERS

Pause automatic expansion/mining when:

- entity-resolution duplicate rate unexpectedly spikes;
- provider output shape changes;
- classification false-positive rate crosses threshold;
- research hard-fail rate crosses threshold;
- scoring fixture suite fails after a model/profile update;
- provider starts returning empty/invalid results at unusual rate.

Quality pause is preferable to feeding garbage downstream.

---

# 18. HUMAN-ASSIST ASSIGNMENT

For sales reps:

- assign a bounded daily set;
- rank in recommended order;
- display evidence/Call Pack;
- lock/lease prospect while rep works it;
- prevent simultaneous duplicate outreach by multiple reps;
- release lease after expiration/no activity according to policy.

Track rep disposition to improve future routing.

---

# 19. CONTACT ATTEMPT COOLDOWN

Attempt cadence belongs in policy, not fit score.

Campaign stores:

- max attempts;
- attempt interval/cooldown;
- voicemail count;
- live-conversation override;
- explicit callback dates;
- do-not-contact suppression.

A prospect with a scheduled requested callback should not be treated as a new queue candidate.

---

# 20. EXISTING CUSTOMER / ACTIVE OPPORTUNITY EXCLUSION

Before a newly mined Account enters outreach:

- match against current customer records;
- active opportunity accounts;
- explicit strategic exclusions;
- internal relationships;
- suppression list.

This check should use canonical account/domain/phone identity, not name only.

---

# 21. CAMPAIGN KILL SWITCH

Global kill switch:

- stops new autonomous calls immediately;
- prevents new calls entering provider queue;
- does not delete research/history;
- allows active calls to terminate safely or end according to policy;
- visible in admin control plane;
- audit log records who/what triggered it.

Separate campaign-level pause from global dial kill switch.

---

# 22. REPLENISHMENT LOOP

Pseudo-flow:

1. count ready inventory;
2. subtract stale/ineligible/leased/in-flight prospects;
3. compare to low-water mark;
4. if sufficient -> sleep/refresh only;
5. if low -> select highest-yield non-saturated territory/query batch;
6. check provider budget;
7. run discovery;
8. resolve/dedupe;
9. basic research/classification;
10. deep research promising candidates;
11. score;
12. generate hypotheses/Call Pack;
13. add eligible records to ready inventory;
14. recompute inventory;
15. stop at high-water or budget/quality circuit breaker.

---

# 23. CAMPAIGN HEALTH METRICS

- target ready inventory;
- current ready inventory;
- stale inventory;
- research in flight;
- discovered today;
- unique new accounts today;
- Tier A/B produced today;
- average research cost per new account;
- cost per Tier A/B;
- territory saturation rate;
- duplicate rate;
- classification rejection rate;
- provider error rate;
- downstream conversation/meeting metrics when available.

---

# 24. FIRST ACCEPTANCE TEST

Campaign:

- HVAC
- Jacksonville + St. Augustine
- advertiser-first
- Tier B+
- target 100 ready prospects
- research-only/human-assist
- no Twilio dialing

Pass criteria:

- no duplicate canonical accounts in ready list;
- every score traceable to evidence;
- every research-specific hook backed by fresh evidence;
- provider costs recorded;
- saturation/coverage recorded;
- no provider budget overrun;
- replenishment stops after target/high-water reached;
- if market cannot produce 100 Tier B+ records, system reports honest shortfall rather than lowering criteria silently.
