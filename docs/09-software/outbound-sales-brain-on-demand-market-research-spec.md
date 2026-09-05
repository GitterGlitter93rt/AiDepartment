# YAD Sales Brain — On-Demand Market Research Specification

**Status:** Product/architecture authority  
**Implementation owner:** Claude Code  
**Purpose:** Define what happens when a rep searches a ZIP/city/market that has thin or stale inventory.

---

# 1. CORE PRINCIPLE

A rep search is first a **database query**, not an internet scrape.

The portal should respond quickly with what YAD already knows.

Only when coverage is insufficient should an authorized user request more research.

---

# 2. SEARCH FLOW

Rep enters:

- vertical
- geography
- mining mode
- filters

Example:

`Roofing + 32092 + Advertiser First + Tier B+`

System:

1. normalizes geography;
2. queries canonical inventory;
3. returns matching Accounts;
4. calculates coverage/freshness summary;
5. displays whether more research is likely useful.

---

# 3. COVERAGE SUMMARY

Return business-readable metadata such as:

- researched Accounts found
- unclaimed ready
- latest market refresh
- advertiser queries last run
- coverage state
- active mining job yes/no

Suggested coverage states:

- `GOOD`
- `PARTIAL`
- `THIN`
- `STALE`
- `UNKNOWN`
- `RESEARCHING`

Do not claim “complete market coverage” unless methodology truly supports it.

---

# 4. RESEARCH MORE

If user has permission, show:

`Research More`

Click creates a durable `MarketResearchRequest`.

Fields:

- request_id
- requested_by
- vertical/profile
- geography
- mining_mode
- requested filters/objective
- requested_at
- estimated/allowed budget
- priority
- status
- linked Saved Market optional

The button must not run scraping in the browser request thread.

---

# 5. DUPLICATE REQUEST CONTROL

Before creating work, check:

- active equivalent job;
- recent equivalent search;
- cooldown/saturation;
- budget state.

If equivalent job already active:

> Research already running for this market.

Do not launch duplicate provider batches because two reps clicked the button.

---

# 6. PRIORITY

Potential priorities:

- NORMAL_REPLENISHMENT
- REP_REQUESTED
- MANAGER_PRIORITY
- CALLBACK_CONTACT_RESEARCH
- ACTIVE_OPPORTUNITY_RESEARCH

A rep-requested ZIP may outrank ordinary replenishment but should not bypass global budgets or source rules.

---

# 7. RESEARCH STAGES

Rep-facing progress stages:

- Searching market
- Resolving companies
- Researching websites
- Checking advertising
- Enriching contacts
- Scoring prospects
- Ready

Do not show fake 73% progress unless work units justify it.

Operational backend can retain more granular job states.

---

# 8. STREAMING / INCREMENTAL RESULTS

New Accounts may become visible as soon as they are safe enough for inventory.

Do not wait for the entire market run to finish if 15 useful prospects are already research-ready.

But do not expose half-normalized duplicates merely for visual progress.

---

# 9. FILTERS VS MINING OBJECTIVE

A rep may filter existing results more narrowly than the underlying research job.

Example:

Rep searches `Tier A + Phone+Email`.

The miner should not necessarily search the internet for “Tier A companies.” It discovers/researches Accounts and computes Tier/channel readiness afterward.

Keep user filters separate from provider query semantics.

---

# 10. MARKET EXPANSION

If one ZIP is saturated/thin, the system should not automatically broaden to nearby ZIPs without approved policy.

Offer manager options such as:

- include adjacent ZIPs
- expand radius
- use saved metro territory

Geographic expansion should be explicit/auditable.

---

# 11. BUDGET

Every request must inherit or define:

- discovery provider budget
- contact enrichment budget
- deep research limit
- maximum businesses/results

Rep UI should not expose provider secrets, but manager/admin can see approximate cost/usage.

---

# 12. RATE / ABUSE CONTROL

Prevent one rep from clicking Research More repeatedly across hundreds of ZIPs and consuming unlimited provider spend.

Controls may include:

- role permissions
- per-user request limit
- per-market cooldown
- global daily budget
- manager approval above threshold

---

# 13. RESULT NOTIFICATION

When requested research materially adds inventory:

> 18 new researched prospects are ready in 32092 Roofing.

If zero qualify:

> Research completed. No additional prospects met the current criteria.

Do not weaken criteria silently.

---

# 14. FAILURE

Provider failure should produce:

- degraded job state;
- retry/circuit-breaker behavior;
- partial results preserved;
- honest UI message.

Never convert provider outage to `no advertisers found`.

---

# 15. ACCEPTANCE EXAMPLE

Brent searches:

`HVAC + 32084 + Advertiser First + Tier B+`

Database returns 11 unclaimed prospects and says coverage is stale/partial.

Brent clicks Research More.

System creates one durable job.

Sarah performs same search 20 seconds later and sees:

> 11 available · Research in progress

No second duplicate research job is created.

As new Accounts become ready, inventory rises to 24 and both reps can browse/claim them.