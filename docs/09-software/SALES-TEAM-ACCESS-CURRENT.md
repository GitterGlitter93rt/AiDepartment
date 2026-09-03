# YAD SALES TEAM ACCESS — CURRENT IMPLEMENTATION MANIFEST

**Status:** Near-term product authority  
**Date:** 2026-09-03  
**Business objective:** Give YAD salespeople a sleek internal web application where they can browse pre-researched prospect inventory, search a ZIP/city/market, claim Accounts to themselves, and then call/email/follow up from one shared company memory.  
**Implementation owner:** Claude Code on EdgeXpert

---

# 1. CURRENT PRODUCT DECISION

The primary rep experience is **NOT a forced call queue**.

The EdgeXpert should run Market Miner/research workers 24/7 and maintain a shared pool of researched Accounts.

Sales reps should be able to:

1. browse precompiled markets/lists;
2. search a ZIP/city/market + vertical on demand;
3. filter the shared inventory;
4. inspect ranked prospects;
5. select the companies they want;
6. click `Claim to Me`;
7. work those Accounts from `My Prospects` through phone/email/Smartlead/follow-up.

Ranking and recommendations still matter, but they help the rep choose rather than trapping the rep inside a black-box ordered queue.

Canonical flow:

`EdgeXpert 24/7 Market Miner`
-> `Shared researched Account inventory`
-> `Find Prospects / Markets`
-> `Rep search + filters`
-> `Claim to Me`
-> `My Prospects`
-> `Human calls + email + Smartlead`
-> `Shared Account memory`
-> `Callbacks / meetings / opportunities`
-> later approved Twilio.

Autonomous AI cold calling is not required for this milestone.

---

# 2. REQUIRED NEW SPECS

Claude must treat these as primary implementation authority for the rep-access milestone:

- `outbound-sales-brain-rep-inventory-browse-claim-spec.md`
- `outbound-sales-brain-rep-portal-ui-ux-spec.md`
- `outbound-sales-brain-edge-xpert-sales-portal-deployment-spec.md`

Also use the existing supporting specs:

- `outbound-sales-brain-sales-team-prospect-access-spec.md`
- `outbound-sales-brain-sales-team-rbac-permissions-spec.md`
- `outbound-sales-brain-prospect-worklist-contract.v1.yaml`
- `outbound-sales-brain-sales-team-access-fixtures.v1.yaml`
- `outbound-sales-brain-sales-team-access-mvp-acceptance.md`
- `outbound-sales-brain-human-assist-workflow.md`
- `outbound-sales-brain-smartlead-sync-spec.md`
- `outbound-sales-brain-multichannel-coordination-spec.md`
- `market-miner-lead-import-export-spec.md`
- `outbound-sales-brain-prospect-memory-spec.md`
- `outbound-sales-brain-account-opportunity-lifecycle-spec.md`

The global architecture still begins at:

`OUTBOUND-SALES-BRAIN-V1-CURRENT.md`

---

# 3. PRIMARY REP PAGES

The internal portal should be available through a secure web address such as:

`sales.youraidepartment.ai`

Initial page set:

1. Overview
2. Find Prospects
3. Markets
4. My Prospects
5. Account Detail
6. Follow-Ups
7. Manager Team/Assignment

The interface should be sleek, modern, fast, responsive, and use existing YAD brand/design primitives rather than looking like Airtable or a raw CRM database.

---

# 4. FIND PROSPECTS

This is the primary rep workflow.

Rep can choose:

- vertical;
- ZIP/ZCTA;
- city;
- county;
- state;
- radius/saved market;
- mining mode;
- Tier;
- advertiser evidence;
- phone/email availability;
- decision-maker availability;
- ownership state;
- research freshness.

Example:

> HVAC + 32256 + Advertiser First + Tier B+ + Unclaimed + Phone/Email

The system queries existing durable inventory first and returns it immediately.

If coverage is incomplete/stale, authorized users can select `Research More`, which schedules Market Miner work on EdgeXpert without blocking already available results.

---

# 5. PRECOMPILED MARKETS

The EdgeXpert should maintain saved market inventories 24/7.

Examples:

- Jacksonville HVAC Advertisers
- St. Augustine HVAC Advertisers
- Jacksonville Roofing Advertisers
- St. Augustine Businesses With No Verified Website

Each market should display counts such as:

- researched;
- unclaimed;
- claimed;
- Tier A/B;
- phone + email;
- active advertiser evidence;
- freshness;
- mining status.

Reps click a market and browse available Accounts.

---

# 6. CLAIM TO ME

A cold Account begins as `UNCLAIMED` unless manager-assigned or already relationship-owned.

A rep can:

- Claim one;
- select several and `Claim Selected`;
- manager can assign/reassign.

Claim must be atomic and server-side.

Two reps cannot own the same cold Account at once.

If another rep wins the claim first, the second rep sees the current owner and cannot work the Account through YAD cold workflows.

Ownership changes are audited.

Do not use frontend-only claim state.

---

# 7. MY PROSPECTS

`My Prospects` is the rep's working book of business.

Useful filters:

- newly claimed;
- not contacted;
- call ready;
- email ready;
- call + email;
- callback;
- positive reply;
- Tier;
- advertiser strength;
- geography;
- vertical;
- opportunity stage.

Priority/ranking can recommend what to work first, but the rep keeps a searchable portfolio.

---

# 8. ACCOUNT CARD / DETAIL

Every Account should answer quickly:

- who is the company?
- where are they?
- what are they advertising/promoting?
- why are they attractive to YAD?
- what is the YAD Tier/score?
- who should the rep ask for?
- what phone/email is available and how reliable is it?
- what is the primary business hypothesis?
- what is the suggested first question?
- what should the rep not claim?
- who owns the Account?
- what has YAD already done with them?
- what is due next?

Do not dump raw research logs on the primary rep view.

---

# 9. REP EXPERIENCE TARGET

A salesperson should be able to:

1. log in;
2. search `HVAC + 32256`;
3. see researched businesses immediately if inventory exists;
4. filter to unclaimed Tier B+ advertisers;
5. select 5–25 prospects;
6. claim them;
7. open My Prospects;
8. call/email/follow up with context;
9. record disposition/callback/DNC;
10. never need a personal spreadsheet to track ownership/history.

---

# 10. OWNERSHIP / ANTI-HOARDING

Ownership protects coordination, but reps should not lock unlimited companies forever.

Management rules should be configurable:

- active cold-account target/cap;
- inactivity review;
- unworked-account release/reassignment;
- manager override.

Never auto-release an Account with:

- requested callback;
- positive reply;
- active opportunity;
- scheduled meeting;
- proposal;
- client relationship;
- explicit ongoing follow-up commitment.

---

# 11. CHANNELS

A claimed Account can expose eligibility such as:

- CALL READY
- EMAIL READY
- CALL + EMAIL
- CONTACT RESEARCH NEEDED
- CALLBACK
- SUPPRESSED

Smartlead remains an execution channel, not the canonical CRM/database.

Email replies/bounces/unsubscribes must sync back to the Account.

---

# 12. EDGE XPERT DEPLOYMENT

Initial internal architecture:

`sales.youraidepartment.ai`
-> secure tunnel/reverse proxy
-> EdgeXpert Sales Portal/API
-> PostgreSQL
-> Market Miner/research workers.

Keep realtime Twilio infrastructure at `voice.youraidepartment.ai` logically separate.

The rep browser never directly scrapes Google or contains provider credentials.

ZIP/market searches query PostgreSQL first; background research runs server-side on EdgeXpert.

---

# 13. IMPLEMENTATION ORDER

Do NOT start with autonomous Twilio.

## Phase A — Portal foundation

- Postgres/schema
- auth/RBAC
- Account/Contact/ownership state
- import existing prospect lists

## Phase B — Rep product

- Overview
- Find Prospects
- Markets
- My Prospects
- Account detail
- atomic Claim to Me
- dispositions/callback/DNC
- manager assignment/reassignment

## Phase C — Secure exposure

- secure `sales.youraidepartment.ai`
- process supervision
- backups
- health checks

## Phase D — 24/7 Market Miner

- approved Google advertiser discovery provider
- website research
- contact enrichment
- dedupe
- scoring
- continual saved-market replenishment
- on-demand ZIP research

## Phase E — Email coordination

- Smartlead export/sync
- reply/bounce/unsubscribe state

## Phase F — two-rep pilot

Use two internal salespeople in the same markets and verify ownership/collision behavior.

## Phase G — voice later

Controlled Twilio remains a separate downstream gate.

---

# 14. SAME-DAY VALUE RULE

Do not block initial sales-team rollout on perfect Market Miner automation.

If the portal can securely import/display current lists, search them, claim Accounts, preserve ownership, and capture call/email outcomes, reps can begin using it while EdgeXpert research adapters are being completed.

Then Market Miner begins replenishing that same canonical inventory automatically.

---

# 15. HARD FAILS

Do not accept implementation if:

- DNC appears as claimable cold inventory;
- two reps can unknowingly own the same Account;
- ownership exists only in frontend/local state;
- client appears as unclaimed cold prospect;
- active opportunity appears as generic available prospect;
- a rep can bypass another rep's ownership through API manipulation;
- stale ad evidence is presented as current;
- provider credentials appear in frontend;
- on-demand ZIP search creates duplicate Accounts;
- manager reassignment is not audited;
- Account history disappears after restart;
- heavy mining/crawling runs on the live voice gateway;
- reps must use private spreadsheets to know which prospects belong to them.

---

# 16. CURRENT FIRST PRACTICAL PROOF

The system should support this exact workflow:

> Brent logs into sales.youraidepartment.ai, opens Find Prospects, selects HVAC + Jacksonville/32256 + advertiser-first + Tier B+ + unclaimed, sees the pre-researched companies already available, selects the ones he wants, clicks Claim to Me, and they immediately become his Accounts under My Prospects with phone/email/context/history.

A second rep searching the same market sees Brent's claimed Accounts as owned and selects different companies.

If inventory is thin, the rep/manager can request more research for that ZIP while continuing to work existing Accounts.

---

# 17. CORE RULE

**EdgeXpert builds and refreshes the pool. Sales reps search the territory, choose the companies they want, claim them, and work them from one shared YAD memory.**