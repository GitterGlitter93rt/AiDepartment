# Your AI Department — Sales Inventory Replenishment Specification

**Status:** Architecture authority  
**Purpose:** Keep each YAD salesperson supplied with enough trustworthy call/email work without dumping giant stale lists on them or lowering qualification standards when inventory runs low.  
**Implementation owner:** Claude Code

---

# 1. CORE PRINCIPLE

The Prospect Factory should behave like an inventory system.

A rep does not need “10,000 leads.”

A rep needs:

- commitments due now;
- enough fresh, relevant cold prospects for the workday;
- clear channel readiness;
- no duplicates;
- no stale research masquerading as current.

Inventory is measured in **ready work**, not raw records.

---

# 2. INVENTORY CLASSES

Per rep/team/campaign track:

- `FOLLOWUPS_DUE`
- `CALLBACKS_DUE`
- `READY_CALL`
- `READY_EMAIL`
- `READY_BOTH`
- `READY_ROLE_ROUTE`
- `NEEDS_ENRICHMENT`
- `NEEDS_RESEARCH_REFRESH`
- `HUMAN_REVIEW`
- `BLOCKED`

A single Account may satisfy multiple readiness classes but should not be double-counted as two separate cold prospects.

---

# 3. CONFIGURABLE CAPACITY TARGETS

Manager may configure desired daily/rolling inventory by rep or campaign.

Examples are illustrative only:

- desired new call-ready inventory;
- desired new email-ready inventory;
- desired both-ready inventory;
- maximum unresolved follow-ups;
- reserve buffer.

No specific dial/email quota is canonical unless management explicitly sets it.

The system should support different capacities for:

- full-time caller;
- hybrid caller/email rep;
- field rep;
- manager;
- onboarding rep.

---

# 4. COMMITMENTS FIRST

Replenishment does not bury relationship work beneath new cold supply.

Priority:

1. requested callbacks;
2. promised follow-ups;
3. scheduled meetings/tasks;
4. warm referrals/replies;
5. then new cold inventory.

If a rep already has more due commitments than practical capacity, show overload instead of adding more cold work blindly.

---

# 5. INVENTORY FLOOR

For each queue define configurable:

- `target_ready_count`
- `reorder_point`
- `max_ready_count`
- `reserve_count` optional.

When ready inventory falls below reorder point, replenishment requests additional prospect research/enrichment.

Do not continuously enrich the entire national database “just in case.”

---

# 6. REPLENISHMENT REQUEST

A replenishment job inherits the manager-approved list template/campaign rules:

- geography;
- vertical;
- minimum Tier;
- advertiser requirement/preference;
- endpoint requirements;
- target roles;
- freshness;
- exclusions;
- source policy.

Replenishment cannot silently modify these to satisfy inventory floor.

---

# 7. REPLENISHMENT WATERFALL

When inventory is low:

1. consume already researched canonical Accounts meeting constraints;
2. refresh stale evidence on otherwise qualified Accounts;
3. enrich missing endpoints/decision-makers on strong Accounts;
4. process already discovered but incomplete prospects;
5. mine additional approved queries/ZIPs/cities inside approved territory;
6. expand to additional approved geography only if policy/template allows;
7. declare shortage/saturation.

Do not start with the most expensive new-web search if existing near-ready inventory can satisfy demand.

---

# 8. RESEARCH PRIORITY FROM SALES SHORTAGE

Research jobs should know *why* they matter.

Example:

> Jacksonville HVAC queue has enough companies but is short 18 email-ready Tier B+ prospects.

Research priority should favor:

- contact enrichment for existing Tier A/B Accounts;
- decision-maker email verification;

rather than mining 500 more raw companies.

Another example:

> No shortage of email-ready prospects; call-ready pool is low because phone endpoints are stale.

Refresh phones first.

---

# 9. CHANNEL-SPECIFIC SUPPLY

Track supply separately:

`ready_call_count`

`ready_email_count`

`ready_both_count`

`role_route_call_count`

Do not assume email enrichment solves call inventory or vice versa.

---

# 10. ACCOUNT RESERVATION

Accounts assigned to a rep can count toward that rep's ready inventory.

Accounts merely in the shared pool count toward team supply, not simultaneously toward every rep's personal inventory.

When split across reps, each Account should have one cold assignment at a time unless deliberately configured otherwise.

---

# 11. INVENTORY AGING

Ready inventory can become non-ready when:

- ad evidence expires;
- contact role becomes stale;
- phone/email fails;
- Account enters active opportunity elsewhere;
- Smartlead reply changes relationship;
- suppression is added;
- campaign context changes.

Recompute eligibility before actual action, not only at list creation.

---

# 12. FRESHNESS REFRESH JUST-IN-TIME

Not every claim requires full recrawl.

Before action refresh only evidence needed to safely support current hook/contact decision according to TTL/policy.

Example:

A 40-day-old company address may still be adequate while a 5-day-old “currently advertising emergency AC” statement may require a fresh paid observation if campaign policy demands it.

---

# 13. POOL SATURATION

A market/criteria set can become temporarily saturated.

Signals:

- most approved query/geo combinations recently sampled;
- high rediscovery/duplicate rate;
- few net-new eligible Accounts;
- remaining Accounts below required Tier;
- contact enrichment fill rate exhausted;
- too many existing relationships/suppressions.

Saturation is time-bounded and evidence-backed.

Do not permanently label a market “dead.”

---

# 14. SHORTAGE STATES

Standard shortage reasons:

- `NOT_ENOUGH_ACCOUNTS`
- `NOT_ENOUGH_TIER_QUALIFIED`
- `AD_EVIDENCE_SHORTAGE`
- `PHONE_ENDPOINT_SHORTAGE`
- `EMAIL_ENDPOINT_SHORTAGE`
- `DECISION_MAKER_SHORTAGE`
- `RESEARCH_STALE`
- `RELATIONSHIP_EXCLUSIONS`
- `SUPPRESSION_EXCLUSIONS`
- `TERRITORY_SATURATED`
- `PROVIDER_FAILURE`
- `BUDGET_LIMIT`
- `HUMAN_REVIEW_BACKLOG`

Manager sees cause, not only “queue low.”

---

# 15. MANAGER RESPONSE TO SHORTAGE

Offer explicit actions:

- run more approved queries;
- expand to already-approved nearby territory;
- fund/contact-enrichment jobs;
- relax a preference;
- deliberately relax a hard constraint;
- move rep to another campaign;
- work callbacks/follow-ups;
- wait for refresh/recycle window.

No automatic Tier lowering or invented contacts.

---

# 16. BUDGET AWARENESS

If provider/research cost telemetry exists, replenishment should estimate:

- incremental searches;
- contact-enrichment calls;
- expected yield;
- cost per new ready prospect.

Optimization should prefer cost-effective steps without sacrificing required data quality.

Provider price/config values come from current implementation configuration, not architecture documents.

---

# 17. SOURCE DIVERSITY

Inventory may come from:

- Google advertiser mining;
- approved Maps/business discovery;
- Apollo/imports;
- prior lists;
- CRM/history;
- manually added prospects.

All sources converge to canonical Accounts and the same qualification/readiness rules.

Source performance remains measurable.

---

# 18. SMARTLEAD SUPPLY

Smartlead campaign replenishment requests email-ready inventory from this system.

Before export:

- relationship state re-check;
- suppression re-check;
- endpoint quality re-check;
- personalization freshness re-check;
- duplicate campaign check.

A Smartlead lead is a channel projection of canonical inventory, not an independent copy of truth.

---

# 19. HUMAN CALL SUPPLY

Call Now queue requests call-ready inventory.

If named decision-maker is unavailable but approved role route exists, card can state:

> Call main business line; ask who oversees after-hours call handling / operations.

This is preferable to fabricating an owner name or holding back a strong Account unnecessarily when campaign allows gatekeeper routing.

---

# 20. REPLENISHMENT FREQUENCY

Implementation may evaluate inventory:

- on rep login;
- after dispositions consume ready work;
- on scheduled background cadence;
- when manager changes campaign capacity;
- after major import/mining job;
- after provider outage recovery.

Exact cadence is an implementation/config decision.

Avoid wasteful continuous full-pool recomputation.

---

# 21. DASHBOARD

Manager inventory view:

- rep/team;
- follow-ups due;
- ready call;
- ready email;
- ready both;
- near-ready enrichment;
- stale;
- blocked;
- days/hours of work implied only when based on configured rep capacity;
- shortages and cause;
- replenishment jobs in progress;
- expected completion/ETA only if implementation can support it reliably.

Do not invent completion times.

---

# 22. SERVICE LEVEL METRICS

Useful operational metrics:

- percent of rep sessions beginning with adequate ready inventory;
- ready-prospect fill rate;
- time from shortage detection to new ready prospect;
- research/enrichment cost per ready prospect;
- stale-at-action rejection rate;
- wrong-number/hard-bounce rate;
- percentage of ready inventory actually worked;
- unused inventory aging;
- saturation/shortfall frequency by territory/vertical.

These are operations metrics, not sales outcome guarantees.

---

# 23. WASTE CONTROL

Avoid:

- enriching thousands of Contacts nobody will use;
- refreshing ads on dormant Accounts every day;
- holding huge rep-assigned lists for weeks;
- letting one rep hoard the shared pool;
- repeatedly researching suppressed Accounts;
- creating new Accounts when canonical duplicates already exist.

---

# 24. ACCEPTANCE TESTS

1. Brent queue drops below configured call-ready reorder point -> near-ready Tier A/B Accounts receive phone/contact priority before broad new mining.
2. Email-ready is low but call-ready is healthy -> email enrichment prioritizes; no unnecessary phone refresh.
3. Manager target cannot be filled at Tier B+ -> shortage shown; no Tier C auto-inclusion.
4. Prospect gets positive Smartlead reply -> removed from generic cold inventory and becomes relationship work.
5. Ad evidence expires overnight -> affected ad-specific queue items re-evaluated before outreach.
6. Shared pool has 40 Accounts and two reps each need 30 -> do not count same 40 as 60 personal assignments.
7. Territory saturation detected -> report evidence/shortage; expand only within approved rules.
8. Provider outage -> preserve existing ready inventory; queue enrichment retry; do not invent endpoints.
9. Rep has many callbacks due -> system does not dump unnecessary cold inventory on top without manager policy.
10. Imported Apollo batch creates duplicates of Market Miner Accounts -> dedupe before counting new supply.

---

# 25. CORE RULE

The goal is not maximum lead volume. The goal is a continuously replenished stream of trustworthy, actionable sales work matched to real rep capacity and current relationship state.