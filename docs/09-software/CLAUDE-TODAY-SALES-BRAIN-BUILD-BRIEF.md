# Claude Code — TODAY Sales Brain Build Brief

**Status:** Immediate implementation brief  
**Date:** 2026-09-03  
**Environment:** EdgeXpert  
**Branch:** `feature/outbound-sales-brain`  
**Goal:** Put a secure, sleek internal prospect inventory / rep-claim product in front of YAD salespeople today, then connect public-first contact research and Market Miner replenishment behind it.

---

# 1. TODAY'S BUSINESS OUTCOME

By the end of the first usable internal release, an authorized YAD rep should be able to:

1. open `sales.youraidepartment.ai` from phone/laptop;
2. authenticate with their own user;
3. search a ZIP/city/market + vertical;
4. browse precompiled researched Accounts already stored by EdgeXpert;
5. filter to unclaimed prospects and useful contactability;
6. select one or more Accounts;
7. click `Claim to Me`;
8. see those Accounts under `My Prospects`;
9. see the best truthful decision-maker/contact route available;
10. call/copy a phone number or copy/open an email;
11. record disposition, callback, wrong number and DNC;
12. preserve all ownership/history after restart;
13. allow a second rep to see ownership and claim different Accounts.

Do not block this release on autonomous Twilio.

---

# 2. CURRENT PRODUCT MODEL

`EdgeXpert 24/7 workers`
-> `canonical PostgreSQL Account inventory`
-> `sales.youraidepartment.ai`
-> `Find Prospects / Markets`
-> `rep browse + search ZIP`
-> `Claim to Me`
-> `My Prospects`
-> `human call/email`
-> `shared Account memory`
-> `Smartlead / meetings / opportunities`
-> later controlled Twilio.

The rep experience is browse/search/claim, not a forced AI queue.

---

# 3. CONTACT STRATEGY DECISION

Apollo is optional.

Default contact mode:

`PUBLIC_ONLY`

Read:

- `outbound-sales-brain-public-decision-maker-resolution-spec.md`
- `outbound-sales-brain-public-contact-source-registry.v1.yaml`
- `outbound-sales-brain-public-contact-resolution-fixtures.v1.yaml`
- `outbound-sales-brain-contact-endpoint-quality-spec.md`
- `outbound-sales-brain-decision-maker-routing-spec.md`

V1 must be able to produce all of these without Apollo:

- named current decision-maker where public evidence supports it;
- target role where no name is found;
- current official company main line;
- explicitly public direct business phone where available;
- public business email where available;
- role/main-line fallback when direct endpoint is not found.

Do not block Human Assist merely because a direct mobile number is absent.

---

# 4. TODAY'S BUILD ORDER

## T0 — Audit existing EdgeXpert/repo

Before code changes report:

- portal-capable app structure;
- database availability;
- auth options already present;
- current services/ports;
- reverse proxy/tunnel state;
- safe path to `sales.youraidepartment.ai`;
- current lists/import files available;
- existing crawler/research code worth reusing;
- what in `phone-agent/` is irrelevant to portal/miner.

Do not ask Michael for information the machine/repo can answer.

## T1 — Durable canonical sales data

Implement/minimally prove:

- User
- Account
- Location
- Contact
- ContactEndpoint
- AccountOwnership
- Activity/TimelineEvent
- Disposition
- Callback
- Suppression/DNC
- ImportSource

Requirements:

- Postgres persistence;
- server-side ownership;
- unique/dedupe constraints;
- audit history;
- no frontend-only truth.

## T2 — Auth + RBAC

At least:

- `SALES_REP`
- `SALES_MANAGER`
- `ADMIN`

Two separate rep identities required for pilot.

Manager reassignment must be audited.

## T3 — Seed inventory import

Import one or more existing YAD prospect lists.

Supported initial fields where available:

- company
- domain
- website
- phone
- city/state/ZIP
- vertical
- POC
- title
- email
- source
- research notes

Pipeline:

`normalize -> identity resolve -> suppression check -> canonical Account upsert -> Contact/endpoint classification -> inventory`

Do not create a separate raw lead universe.

## T4 — Sleek rep portal shell

Required screens:

- Overview
- Find Prospects
- Markets
- My Prospects
- Account Detail
- Follow-Ups

Use existing YAD visual system.

Do not ship default Bootstrap/admin-template aesthetics.

## T5 — Find / browse / claim

Rep must be able to filter:

- vertical
- ZIP
- city
- Tier if present
- unclaimed
- advertiser signal if present
- named decision-maker
- direct phone available
- business phone available
- email available
- both phone + email

Atomic operations:

- Claim
- Claim Selected
- Release eligible cold Account
- manager reassign

Concurrency test with two reps is mandatory.

## T6 — Account detail / work actions

Show clearly:

- Account identity
- company/location
- source
- Tier/score where available
- advertiser evidence where available
- best target person/role
- role confidence
- phone semantic type
- phone quality/source
- email semantic type
- email quality/source
- primary opportunity hypothesis where available
- first question / why reach out where available
- DO NOT CLAIM warnings
- ownership
- shared history

Actions:

- tap/copy phone
- copy/open email
- disposition
- callback
- wrong number
- DNC

## T7 — Public Decision Maker Resolver MVP

Implement one provider-independent pipeline behind a background worker.

Minimum adapters:

1. company first-party website/team/contact research;
2. generic approved search result discovery adapter;
3. pluggable public registry adapter interface;
4. role/person evidence reconciliation;
5. endpoint classification;
6. main-line fallback.

For Florida, design adapters so state corporation/license sources can be added cleanly after source/terms validation. Do not hard-code fragile scraping before review.

Output must follow public contact fixtures.

## T8 — On-demand contact research

From Account detail, authorized user can request:

`Research Contact`

Expected:

- one idempotent background job;
- no page block;
- progress/status shown;
- result updates same Account/Contact records;
- existing verified corrections never silently overwritten;
- provider spend remains zero in PUBLIC_ONLY mode.

## T9 — Saved market / ZIP inventory connection

At minimum support one market such as:

`Jacksonville HVAC`

Rep ZIP search queries existing inventory first.

If research coverage is low, authorized `Research More` schedules background mining; do not block existing results.

## T10 — Secure EdgeXpert exposure

Target:

`sales.youraidepartment.ai`

Use secure reverse-proxy/tunnel architecture appropriate to current EdgeXpert network.

Requirements:

- HTTPS
- app auth
- no exposed Postgres port
- no public worker/admin debug ports
- secrets server-side
- process supervision
- restart persistence
- backup procedure

## T11 — Two-rep pilot

Run:

- same search
- concurrent single claim
- concurrent batch claim
- ownership visibility
- callback persistence
- wrong-number endpoint invalidation
- DNC persistence
- manager reassignment audit
- restart persistence
- mobile workflow.

---

# 5. SAME-DAY CUT LINE

If time becomes constrained, prioritize in this order:

1. durable Account/ownership/DNC/callback data;
2. auth;
3. import existing lists;
4. Find Prospects;
5. Claim to Me;
6. Account detail + contact labels;
7. secure external access;
8. two-rep pilot;
9. public decision-maker worker;
10. continuous Market Miner.

The reps can get value from imported inventory before the research engine is perfect.

Do not cut ownership/DNC correctness to make the miner look more complete.

---

# 6. FIRST PUBLIC-CONTACT MVP

A valid Account after contact research may look like:

```text
ABC Heating & Air
Jacksonville FL

Best target:
John Smith — Owner
Role confidence: strong
Evidence: company About page + public entity relationship

Phone:
904-555-1000
Official company main line — current
Route: Ask for John Smith

Direct phone:
Not publicly found

Email:
john@abcair.example
Company-published business email

Contact status:
NAMED_EMAIL_READY + NAMED_MAINLINE_ROUTE_READY
```

This is successful.

Do not represent the main line as John's direct line.

---

# 7. SECOND PUBLIC-CONTACT MVP

Also valid:

```text
Quick Fix AC
St. Augustine FL

Named person:
Not verified

Target role:
Operations / GM

Phone:
904-555-2000
Official current main business line

Call route:
Ask who oversees inbound lead handling / operations

Status:
ROLE_ROUTE_READY
```

Do not invent a person's name to improve appearance.

---

# 8. OPTIONAL PAID CONTACT ENRICHMENT

Do not implement as a required dependency today.

Design adapter interface only if useful:

```text
PaidContactProvider
- searchPeople(account, targetRoles)
- getBusinessEndpoints(person)
```

Provider activation must be configuration/policy controlled.

Default:

`PUBLIC_ONLY`

Possible later:

- `PUBLIC_THEN_PAID`
- `PAID_ALLOWED_FOR_TIER_A`

If Apollo is unavailable, the portal/miner must continue working normally.

---

# 9. HARD FAILS TODAY

Do not ship if:

- two reps can own the same Account unknowingly;
- DNC can disappear;
- database is not durable;
- rep can bypass ownership server-side;
- imported duplicates create separate cold prospects;
- company main line is labeled as owner direct line;
- registered agent is treated as owner by default;
- guessed email appears verified;
- public Decision Maker Resolver requires Apollo credentials;
- provider/API secrets appear in browser code;
- real prospects are auto-called/emailed during tests;
- automatic GitHub Actions are re-enabled;
- changes are merged to `main` without Michael review.

---

# 10. REPORTING

After each T-stage report:

- files changed
- migrations
- commands/tests
- screenshots/manual UI checks
- acceptance results
- security findings
- current EdgeXpert URL/service state
- blockers requiring credentials/decisions
- next exact stage

Do not report a stage complete merely because it compiles.

---

# 11. TODAY'S SUCCESS STATEMENT

The first useful release is achieved when:

**YAD reps can securely search shared prospect inventory by ZIP/market, claim companies to themselves, see a truthful decision-maker/contact route, and work/save outcomes from one polished EdgeXpert-hosted portal while the research engine continues improving behind them.**
