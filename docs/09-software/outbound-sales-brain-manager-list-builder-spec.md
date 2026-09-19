# Your AI Department — Manager Prospect List Builder Specification

**Status:** Architecture authority  
**Purpose:** Turn management intent such as “Give Brent 100 Jacksonville HVAC advertisers with phone + email” into an auditable, quality-preserving prospect cohort without requiring managers to understand crawler/provider internals.  
**Implementation owner:** Claude Code

---

# 1. PRODUCT GOAL

A sales manager should be able to specify:

> who needs prospects, where, what kind, how many, what quality, and which contact channels

and receive:

- ready prospects now;
- prospects needing limited enrichment/research;
- a transparent shortfall if the exact request cannot be met;
- expected research/enrichment workload/cost where measurable.

The builder must never quietly weaken the request merely to hit a round number.

---

# 2. NATURAL-LANGUAGE EXAMPLE

Manager request:

> Give Brent 100 HVAC companies in Jacksonville and St. Augustine, Tier B or better, preferably current Google advertisers, and I want a usable phone plus decision-maker email when possible.

System compiles this into the canonical machine request defined by:

`outbound-sales-brain-manager-list-request-contract.v1.yaml`.

Natural language is an authoring convenience. The compiled request is the execution authority.

---

# 3. REQUIRED INPUTS

Minimum:

- assignee rep/team;
- geography;
- vertical/business context;
- target count;
- minimum Tier/score constraint;
- intended channels.

Optional:

- advertiser evidence requirement/preference;
- target role;
- endpoint quality minimum;
- freshness;
- source mix;
- new-only vs follow-up eligible;
- campaign;
- priority/deadline;
- exclusions.

---

# 4. GEOGRAPHY INPUTS

Support:

- city;
- ZIP/postal;
- county where supported;
- state;
- approved metro/territory;
- explicit list of cities/ZIPs;
- radius only when geography engine has approved semantics.

The builder delegates geography resolution to the canonical geography engine.

Do not interpret a state request as permission to search outside configured campaign/state policy.

---

# 5. VERTICAL INPUT

Choose from approved vertical profiles.

Examples include:

- HVAC
- Plumbing
- Roofing
- Collision Repair
- PDR/Hail
- Law Firms

V1 implementation proof remains HVAC first.

Do not silently substitute adjacent industries to fill quota.

---

# 6. FIT FILTERS

Manager may specify:

- Tier A only;
- Tier A/B;
- minimum canonical score;
- advertiser-first;
- current Google paid observation required;
- LSA included;
- Meta evidence preference where approved;
- phone-dependent only;
- emergency/after-hours only;
- multi-location only;
- other canonical evidence filters.

Filters use existing evidence/score semantics; they do not invent new score points.

---

# 7. CONTACTABILITY FILTERS

Channel options:

- `CALL_READY`
- `EMAIL_READY`
- `CALL_AND_EMAIL_READY`
- `CALL_OR_EMAIL_READY`
- `ROLE_ROUTE_ONLY_ALLOWED`

Optional strictness:

- named decision-maker required;
- target role required;
- official/current business line required;
- direct business line preferred;
- named-person email required;
- general business email acceptable;
- minimum endpoint-quality class.

Contactability never changes Module 4C fit score.

---

# 8. TARGET ROLE

Allow role categories rather than forcing an exact title.

Examples:

- owner/principal;
- GM;
- operations;
- office/dispatch;
- sales leadership;
- marketing;
- practice administrator;
- intake manager.

Decision-maker routing should recommend problem owner based on primary hypothesis.

If no current named person is verified, a role-only gatekeeper route may still qualify for a call-ready list when manager policy allows it.

---

# 9. EXCLUSIONS

Always apply canonical exclusions before assignment:

- suppression/DNC;
- current customer/client where cold campaign inappropriate;
- active opportunity;
- booked meeting;
- relationship owned by another rep unless manager intentionally transfers;
- incompatible active campaign;
- duplicate Account;
- invalid endpoint for requested channel;
- stale required evidence beyond request tolerance.

Managers should not need to remember to check DNC manually.

---

# 10. SOURCE MIX

Manager may select:

- Market Miner only;
- imported list only;
- mixed canonical pool;
- advertiser-mined preferred with generic fallback;
- specific import batch for testing.

Source affects provenance/analytics, not canonical identity.

Example business experiment:

- 50 advertiser-mined HVAC prospects;
- 50 Apollo/imported HVAC prospects researched/scored identically.

---

# 11. REQUEST COMPILATION

Before execution show a plain-language compiled summary:

> Brent / HVAC / Jacksonville + St. Augustine / target 100 / Tier B+ / current paid Google preferred / phone+email / exclude existing relationships and suppressed Accounts.

Manager can edit before running.

Do not require review for every saved template once explicitly approved, but preserve request version.

---

# 12. PREVIEW

Before expensive enrichment, provide best available estimate:

- canonical Accounts matching basic geography/vertical;
- ready now;
- likely needs website refresh;
- needs contact enrichment;
- blocked/suppressed;
- advertiser-confirmed count;
- expected maximum supply from current pool;
- estimated provider/research cost where pricing telemetry exists.

Estimates must be labeled estimates.

---

# 13. OUTPUT BUCKETS

Every request produces explicit buckets:

## `READY_NOW`

Meets all hard constraints.

## `NEEDS_ENRICHMENT`

Fit is adequate but requested contact endpoint/role needs more work.

## `NEEDS_RESEARCH_REFRESH`

Required evidence is stale/unknown.

## `HUMAN_REVIEW`

Ambiguous identity/classification/contact conflict.

## `BLOCKED`

Suppression, relationship conflict, customer/active opportunity, policy, etc.

## `SHORTFALL`

Requested quantity could not be reached under the specified constraints.

---

# 14. QUALITY PRESERVATION

If manager requests 100 and only 63 qualify:

Expected output:

> 63 ready. 21 need contact enrichment. 9 need fresh advertiser checks. 17 otherwise available Accounts are below Tier B or blocked. No constraints were weakened.

Offer manager explicit options such as:

- expand approved geography;
- allow Tier C;
- remove named-email requirement;
- include non-advertisers;
- wait for refresh/enrichment.

Do not apply any change until manager chooses it or a pre-approved saved policy authorizes it.

---

# 15. HARD VS PREFERENCE CONSTRAINTS

Every request field should be marked:

- `HARD`
- `PREFERRED`

Example:

- Tier B+ = HARD
- current Google advertiser = PREFERRED
- call-ready = HARD
- named owner email = PREFERRED

Ranking may optimize preferences only after hard constraints pass.

---

# 16. RANKING WITHIN THE READY COHORT

Use canonical ready-queue comparator.

Relationship commitments still outrank new cold optimization when mixing callbacks/follow-ups.

For pure new-prospect assignment, rank by existing fit/evidence/research/contactability priorities without mutating canonical score.

---

# 17. ASSIGNMENT STRATEGIES

Support manager choice:

- assign all to one rep;
- split evenly;
- round robin;
- territory-based;
- skill/vertical-based later;
- manual selected rows.

Assignment does not create permanent relationship ownership before contact.

Cold Accounts still use work leases when reps actively work them.

---

# 18. FAIRNESS / DUPLICATION

When splitting across reps:

- no Account appears in two cold assignments unless deliberate;
- distribute comparable quality where possible;
- track Tier/evidence mix by rep;
- do not give one rep all Tier A and use raw counts to judge performance.

Manager can intentionally create controlled experiments, but cohort differences must be visible.

---

# 19. SAVED LIST TEMPLATES

Examples:

- `JAX_HVAC_ADVERTISER_CALL_READY`
- `ST_AUG_HVAC_EMAIL_READY`
- `FL_ROOFING_TIER_A_B_BOTH`

Template stores filters/preferences, not a static stale list.

Running it again recompiles from current canonical prospect state.

---

# 20. LIVE VS SNAPSHOT LIST

Two distinct products:

- **Snapshot cohort** — fixed Accounts for a test/campaign assignment.
- **Live replenishing queue** — continuously refilled according to saved criteria.

Do not mix semantics.

Tests/experiments often need snapshots; everyday rep prospecting often benefits from live queues.

---

# 21. MANAGER UI

Suggested flow:

1. `Build Prospect List`
2. choose rep/team
3. geography
4. vertical
5. target count
6. Tier/advertiser requirements
7. call/email requirements
8. target role/contact strictness
9. preview supply
10. compile request
11. run research/enrichment if needed
12. review result/shortfall
13. assign/export where permitted.

Advanced source/provider filters may live under `More filters`.

---

# 22. EXPORT

Export is separate from assignment.

Manager with permission may export eligible cohort for:

- Smartlead;
- approved CRM workflow;
- offline backup;
- analysis.

Export still passes channel/suppression/license rules at execution time.

---

# 23. REQUEST AUDIT

Record:

- request ID/version;
- manager;
- compiled filters;
- hard/preferences;
- target count;
- execution time;
- candidate count;
- ready count;
- shortfall;
- assigned/exported count;
- provider/research jobs spawned;
- changes to constraints.

This makes it possible to explain why a rep got a particular list.

---

# 24. ACCEPTANCE TESTS

1. Request 100 Tier B+ Jacksonville HVAC call+email prospects; 63 qualify -> output 63 ready and explicit shortfall, no Tier C leakage.
2. Current advertiser is `PREFERRED` -> non-advertiser Tier B may rank later but remains eligible.
3. Current advertiser is `HARD` -> unknown/non-advertiser evidence does not enter ready bucket.
4. Named decision-maker email required -> `info@company.com` does not satisfy it.
5. Call-ready role route allowed -> main business line + operations target may satisfy call route without invented person's name.
6. Suppressed Account appears in candidate pool -> blocked before assignment/export.
7. Existing relationship owner is Rep B -> cannot silently assign cold to Brent.
8. Manager deliberately transfers ownership -> tasks/history move per ownership spec.
9. Saved template rerun next week -> current pool/state, not frozen stale rows.
10. 50/50 source comparison -> both cohorts retain source identity for analytics.

---

# 25. CORE RULE

The list builder is a compiler from sales intent to trustworthy prospect inventory. Quantity is a target, never permission to dilute evidence, invent contacts, ignore suppression, or hide shortages.