# YAD Sales Brain — Saved Markets & Inventory Replenishment Specification

**Status:** Product/architecture authority  
**Implementation owner:** Claude Code  
**Purpose:** Keep useful prospect inventory available continuously without forcing reps into preassigned queues.

---

# 1. CORE MODEL

The EdgeXpert runs Market Miner workers continuously and maintains durable researched inventory.

A **Saved Market** is a reusable prospecting definition, not merely a saved UI filter.

Example:

`Jacksonville HVAC Advertisers`

may define:

- vertical: HVAC
- geography: Jacksonville / Duval / approved ZIP set
- mode: ADVERTISER_FIRST
- minimum Tier: B
- desired ready inventory: 250
- preferred channels: CALL_AND_EMAIL
- research freshness rules
- provider/query budget
- exclusions

The system should attempt to keep the configured inventory target filled while respecting quality, cost, source-policy, dedupe, suppression, and saturation rules.

---

# 2. REP EXPERIENCE

Reps can browse Saved Markets from the `Markets` page.

A market card should answer:

- What market/vertical is this?
- How many researched Accounts exist?
- How many are currently unclaimed?
- How many have usable phone + email?
- How many are Tier A/B?
- How fresh is the inventory?
- Is deeper research currently running?

Example:

**Jacksonville HVAC Advertisers**  
186 researched · 72 unclaimed · 41 phone+email · 38 Tier A · refreshed 2h ago

Actions:

- Browse Prospects
- Research More (authorized users)
- Save Personal View

Reps do not need to wait for a mining run to finish before browsing existing inventory.

---

# 3. MARKET STATES

Suggested market states:

- `ACTIVE`
- `PAUSED`
- `SATURATED`
- `RESEARCHING`
- `DEGRADED_PROVIDER`
- `BUDGET_PAUSED`
- `ARCHIVED`

State is operational metadata, not a prospect score.

---

# 4. INVENTORY DEFINITIONS

Track at least:

- `total_accounts`
- `research_complete`
- `research_partial`
- `tier_a`
- `tier_b`
- `unclaimed_ready`
- `claimed_active`
- `phone_eligible`
- `email_eligible`
- `call_and_email_eligible`
- `stale_refresh_required`
- `suppressed`
- `active_opportunity`
- `client`

A prospect with DNC, active opportunity, client status, stale critical evidence, or invalid contact must not count toward cold-ready inventory.

---

# 5. REPLENISHMENT CONTROLLER

For each Saved Market, define:

- `target_ready_inventory`
- `minimum_ready_floor`
- `maximum_ready_inventory`
- `refresh_interval`
- `query_budget_daily`
- `research_budget_daily`
- `priority`

Example:

- target: 250
- floor: 150
- max: 325

Behavior:

1. if ready inventory > target, refresh only stale high-value Accounts;
2. if ready inventory falls below target, schedule incremental mining;
3. if below floor, raise mining priority;
4. never lower quality filters merely to hit target;
5. stop or cooldown when market saturation is detected;
6. expand geography only according to an approved expansion plan.

If only 73 Accounts qualify, the system stores 73. It must not manufacture 250 by weakening rules silently.

---

# 6. SATURATION

Track query/search yield by:

- market
- search cell
- query family
- provider
- date

Suggested saturation signals:

- repeated searches return mostly already-known Accounts;
- very low new unique advertiser yield;
- high duplicate rate;
- low Tier B+ yield despite broad query coverage.

Saturation thresholds must be configurable.

A saturated market may still need periodic refresh because advertising and websites change.

---

# 7. FRESHNESS

Inventory freshness is separate from Account age.

A company discovered 6 months ago may remain useful if important evidence was refreshed recently.

Track freshness for:

- advertiser evidence
- landing page/offer
- website CTA
- decision maker
- phone/email
- CRM/frontend signals
- business location/hours

Critical hook evidence should be refreshed before it is used as current-tense personalization.

---

# 8. REP SEARCH VS MARKET RESEARCH

When a rep searches:

`HVAC + 32256`

system behavior:

1. query durable inventory immediately;
2. return existing matches;
3. show inventory freshness/coverage;
4. if insufficient and rep has permission, offer `Research More`;
5. `Research More` creates a mining job; it does not block the page;
6. new researched Accounts appear progressively.

A UI search is not itself permission to contact anybody.

---

# 9. COST CONTROL

Replenishment must be cost-aware.

Track:

- discovery cost per unique Account
- research cost per research-complete Account
- cost per Tier A/B
- contact-enrichment cost per usable POC
- eventually cost per qualified conversation/meeting

Managers may configure per-market budgets.

No rep action should accidentally trigger unlimited provider spend.

---

# 10. MANAGER CONTROLS

Managers can:

- create Saved Market
- pause/resume
- change target inventory
- adjust allowed geography
- change vertical/mode only through explicit edit/version
- view source health/cost
- force refresh
- archive

Ordinary reps may browse/claim from approved markets but should not edit system-wide mining budgets/provider routing.

---

# 11. HARD FAILS

Implementation fails if:

- inventory target causes quality thresholds to be weakened silently;
- claimed Accounts are reintroduced as unclaimed duplicates;
- DNC/client/active-opportunity Accounts count as cold-ready;
- a stale ad observation is displayed as currently active without freshness context;
- rep searches launch unbounded provider jobs;
- one provider outage becomes `not advertising` or `no business found`;
- market status exists only in memory and disappears after restart.

---

# 12. ACCEPTANCE EXAMPLE

Saved Market:

> Jacksonville HVAC Advertisers — Tier B+ — target 250 ready

Expected:

- existing researched inventory appears immediately;
- unclaimed count is accurate;
- claiming 20 Accounts reduces unclaimed count by 20;
- when ready inventory falls below configured threshold, background mining replenishes it;
- low-yield searches eventually cooldown;
- no threshold is relaxed to fabricate inventory;
- manager can see cost/yield/freshness.