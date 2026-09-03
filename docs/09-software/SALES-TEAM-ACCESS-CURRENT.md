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
-> `Saved Markets + shared researched Account inventory`
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

# 2. REQUIRED PRIMARY SPECS

Claude must treat these as primary implementation authority for the rep-access milestone:

- `outbound-sales-brain-rep-inventory-browse-claim-spec.md`
- `outbound-sales-brain-rep-portal-ui-ux-spec.md`
- `outbound-sales-brain-rep-portal-visual-system.md`
- `outbound-sales-brain-edge-xpert-sales-portal-deployment-spec.md`
- `outbound-sales-brain-rep-inventory-contract.v1.yaml`
- `outbound-sales-brain-rep-portal-api-contract.v1.md`
- `outbound-sales-brain-rep-ownership-data-model.md`
- `outbound-sales-brain-saved-markets-inventory-replenishment-spec.md`
- `outbound-sales-brain-ownership-lifecycle-and-claim-governance-spec.md`
- `outbound-sales-brain-manager-territory-team-controls-spec.md`
- `outbound-sales-brain-prospect-detail-explanation-spec.md`
- `outbound-sales-brain-rep-notification-and-daily-digest-spec.md`
- `outbound-sales-brain-mobile-rep-workflow-spec.md`
- `outbound-sales-brain-sales-portal-v1-release-acceptance-matrix.md`
- `outbound-sales-brain-sales-portal-same-day-rollout-plan.md`
- `CLAUDE-SALES-PORTAL-START-PROMPT.md`

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
7. Replies
8. Opportunities
9. Manager Team/Assignment

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

Search/filter actions must not create unbounded provider spend.

---

# 5. SAVED / PRECOMPILED MARKETS

The EdgeXpert should maintain approved Saved Market inventories 24/7.

Examples:

- Jacksonville HVAC Advertisers
- St. Augustine HVAC Advertisers
- Jacksonville Roofing Advertisers
- St. Augustine Businesses With No Verified Website

Each market should display:

- researched Accounts;
- unclaimed ready;
- claimed active;
- Tier A/B;
- phone + email;
- active advertiser evidence;
- research freshness;
- mining status;
- source/provider health;
- inventory target/floor where manager-authorized.

Reps click a market and browse available Accounts.

The replenishment controller may maintain target inventory, but must never silently weaken qualification/research standards merely to fill a quota.

---

# 6. CLAIM TO ME / OWNERSHIP

A cold Account begins as `UNCLAIMED` unless manager-assigned or already relationship-owned.

A rep can:

- Claim one;
- select several and `Claim Selected`;
- release eligible cold Accounts;
- manager can assign/reassign.

Claim must be atomic and server-side.

Two reps cannot own the same cold Account at once.

If another rep wins the claim first, the second rep sees the current owner and cannot work the Account through YAD generic cold workflows.

Ownership changes are audited.

Do not use frontend-only claim state.

Requested callbacks, positive replies, active opportunities, meetings/proposals and clients receive stronger relationship protection than ordinary cold claims.

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

Reps should not need private spreadsheets to track ownership or follow-up.

---

# 8. ACCOUNT DETAIL

Every Account should answer quickly:

- who is the company?
- where are they?
- what are they advertising/promoting?
- why are they attractive to YAD?
- what is the YAD Tier/score and point breakdown?
- who should the rep ask for?
- what phone/email is available and how reliable is it?
- what facts are confirmed?
- what is only a hypothesis?
- what is the primary business hypothesis?
- what is the suggested first question?
- what should the rep not claim?
- what public paid-demand funnel can we observe?
- who owns the Account?
- what has YAD already done with them?
- what is due next?

Do not dump raw research logs or hidden model reasoning on the primary rep view.

Prospect-provided corrections should be stored as new evidence/history rather than silently deleting earlier observations.

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
10. receive important positive-reply/callback alerts;
11. never need a personal spreadsheet to track ownership/history.

A new Account should be understandable in under roughly 60 seconds.

---

# 10. OWNERSHIP / ANTI-HOARDING

Ownership protects coordination, but reps should not lock unlimited companies forever.

Management rules should be configurable:

- active cold-account target/cap;
- inactivity review;
- unworked-account release/reassignment;
- territory/team visibility;
- manager override.

Never auto-release an Account with:

- requested callback;
- positive reply;
- active opportunity;
- scheduled meeting;
- proposal;
- client relationship;
- explicit ongoing follow-up commitment.

Manager intervention should be visible and audited.

---

# 11. TERRITORIES / TEAM CONTROLS

Support configurable access models such as:

- OPEN_SHARED
- TEAM_SHARED
- REP_EXCLUSIVE
- MANAGER_ASSIGN_ONLY
- RESEARCH_ONLY

Territory rules control who may browse/claim/contact; they do not create duplicate Accounts.

Changing a territory must not reset prior ownership, callback, DNC, opportunity or client history.

---

# 12. CHANNELS

A claimed Account can expose eligibility such as:

- CALL READY
- EMAIL READY
- CALL + EMAIL
- CONTACT RESEARCH NEEDED
- CALLBACK
- SUPPRESSED

Smartlead remains an execution channel, not the canonical CRM/database.

Email replies/bounces/unsubscribes must sync back to the Account.

A positive reply should stop contradictory generic cold outreach and surface to the owner as a high-priority action.

---

# 13. NOTIFICATIONS / DAILY DIGEST

V1 should prioritize in-app alerts for:

- positive replies;
- requested callbacks due/overdue;
- manager handoffs/reassignment;
- contact research completed on claimed Accounts where useful.

Use daily digest for lower-priority inventory updates such as:

- new Tier A/B prospects in saved markets;
- fresh contact availability;
- claimed Accounts with no first touch.

Do not notify reps for crawler/provider/debug noise.

---

# 14. MOBILE

The portal must be genuinely usable from a phone.

Essential mobile actions:

- Find by ZIP/city/market;
- filter;
- claim/bulk claim;
- open Account;
- tap phone;
- copy/open email;
- see Why Reach Out / First Question / Do Not Claim;
- disposition;
- callback;
- DNC.

Do not ship a horizontally scrolling desktop table as the only mobile experience.

---

# 15. EDGE XPERT DEPLOYMENT

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

# 16. IMPLEMENTATION ORDER

Do NOT start with autonomous Twilio.

## Phase A — Portal foundation

- Postgres/schema
- auth/RBAC
- Account/Contact/ownership state
- import existing prospect lists
- audit/event model

## Phase B — Rep product

- Overview
- Find Prospects
- Markets
- My Prospects
- Account detail
- atomic Claim to Me
- dispositions/callback/DNC
- manager assignment/reassignment
- mobile essential flows

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
- freshness/saturation/budget controls

## Phase E — Email coordination

- Smartlead export/sync
- reply/bounce/unsubscribe state
- positive-reply alerts

## Phase F — two-rep pilot

Use two internal salespeople in the same markets and verify ownership/collision behavior, mobile usability, callbacks, DNC and manager visibility.

## Phase G — voice later

Controlled Twilio remains a separate downstream gate.

---

# 17. SAME-DAY VALUE RULE

Do not block initial sales-team rollout on perfect Market Miner automation.

If the portal can securely import/display current lists, search them, claim Accounts, preserve ownership, and capture call/email outcomes, reps can begin using it while EdgeXpert research adapters are being completed.

Then Market Miner begins replenishing that same canonical inventory automatically.

---

# 18. RELEASE GATE

Use:

`outbound-sales-brain-sales-portal-v1-release-acceptance-matrix.md`

before rep rollout.

At minimum, release must prove:

- auth/RBAC;
- search/filter;
- Account dedupe;
- atomic claim;
- DNC persistence;
- callback persistence;
- Account truth/hypothesis separation;
- basic mobile workflow;
- Saved Market inventory;
- backups/restart persistence;
- no accidental autonomous outbound.

---

# 19. HARD FAILS

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
- quality thresholds silently weaken to fill a Saved Market quota;
- reps must use private spreadsheets to know which prospects belong to them.

---

# 20. CURRENT FIRST PRACTICAL PROOF

The system should support this exact workflow:

> Brent logs into sales.youraidepartment.ai, opens Find Prospects, selects HVAC + Jacksonville/32256 + advertiser-first + Tier B+ + unclaimed, sees the pre-researched companies already available, selects the ones he wants, clicks Claim to Me, and they immediately become his Accounts under My Prospects with phone/email/context/history.

A second rep searching the same market sees Brent's claimed Accounts as owned and selects different companies.

If inventory is thin, the rep/manager can request more research for that ZIP while continuing to work existing Accounts.

---

# 21. CORE RULE

**EdgeXpert builds and refreshes the pool. Sales reps search the territory, choose the companies they want, claim them, and work them from one shared YAD memory.**