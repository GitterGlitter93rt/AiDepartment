# YAD Sales Brain — Same-Day Sales Portal Rollout Plan

**Status:** Execution plan for Claude Code  
**Goal:** Get internal sales reps using a secure shared prospect portal as quickly as practical without waiting for full autonomous mining/voice completeness.

---

# 1. DEFINITION OF TODAY'S WIN

A same-day internal pilot is successful if two salespeople can securely access the portal and do this:

1. log in;
2. browse/import existing prospect inventory;
3. search by ZIP/city + vertical;
4. filter to unclaimed prospects;
5. claim prospects to themselves;
6. see each other's ownership;
7. open a prospect dossier;
8. copy/call phone and copy/email contact info;
9. save a disposition/callback;
10. create DNC;
11. retain all state after restart.

Full Market Miner automation can continue after this core is online.

---

# 2. SAME-DAY SCOPE — MUST HAVE

## Infrastructure

- app boots reliably on EdgeXpert;
- PostgreSQL durable state;
- process supervision;
- secure authenticated web access;
- HTTPS;
- no public database port.

## Users

- at least two named rep accounts;
- one manager/admin;
- role checks server-side.

## Inventory

- Account/Contact import from existing CSV/spreadsheet/list;
- dedupe basic domain/phone identity;
- shared unclaimed inventory;
- ZIP/city/vertical fields searchable.

## Rep UI

- Overview;
- Find Prospects;
- My Prospects;
- Account Detail;
- Follow-Up.

## Ownership

- Claim to Me;
- Claim Selected;
- one-owner concurrency protection;
- manager reassignment;
- ownership visible to all authorized reps.

## Sales actions

- phone/email copy/action;
- disposition;
- callback;
- wrong number;
- DNC.

---

# 3. SAME-DAY SCOPE — NICE TO HAVE

If time permits after the must-have acceptance passes:

- saved Markets cards;
- live `Research More` status;
- first Google advertiser provider adapter;
- first website enrichment worker;
- contact research worker;
- Smartlead export;
- richer dashboard metrics;
- email reply sync.

Do not sacrifice data safety/ownership correctness to fit these in.

---

# 4. NOT REQUIRED TODAY

Do not block rollout on:

- autonomous Twilio cold calls;
- realtime voice benchmark;
- every vertical profile;
- Meta ad automation;
- advanced learned ranking;
- every CRM integration;
- full proposal/delivery brain;
- perfect provider economics dashboard;
- mobile perfection.

Architecture for these already exists and can be layered onto the same Account model.

---

# 5. IMPLEMENTATION SLICES

## Slice 1 — Data / auth

Prove:

- user can log in;
- role visible;
- Accounts persist;
- Contacts persist;
- owner nullable;
- activity persists.

## Slice 2 — Find Prospects

Prove:

- filter by ZIP/city/vertical;
- unclaimed filter;
- pagination;
- clean UI;
- Account drawer/detail.

## Slice 3 — Claim

Prove:

- single claim;
- batch claim;
- concurrent conflict;
- manager reassignment;
- ownership persists.

## Slice 4 — Work Account

Prove:

- phone/email visible;
- disposition saved;
- callback saved;
- DNC saved/enforced;
- timeline updated.

## Slice 5 — Secure access

Prove:

- reps access from external devices over HTTPS;
- app not directly exposing internal services;
- provider/secrets absent from frontend.

## Slice 6 — Existing lists

Import one or more real YAD prospect lists in research/human-assist mode.

Do not auto-contact imported Accounts.

Resolve duplicates into canonical Accounts.

## Slice 7 — two-rep pilot

Run acceptance below.

---

# 6. TWO-REP PILOT SCRIPT

Use two test accounts, e.g. Rep A and Rep B.

### Test 1 — same inventory

Both search same ZIP + vertical.

Expected: same available unclaimed prospect pool.

### Test 2 — claim collision

Both attempt to claim the same Account.

Expected: one succeeds; one gets owner conflict.

### Test 3 — batch claim

Rep A selects ten prospects.

Rep B claims two of those before Rep A submits.

Expected: Rep A receives eight successful claims + two conflicts.

### Test 4 — visibility

Rep B searches again.

Expected: Rep A's owned prospects display owner and are not claimable by Rep B.

### Test 5 — callback

Rep A creates requested callback.

Expected: appears in Follow-Ups and survives restart.

### Test 6 — DNC

Rep B marks an owned test Account DNC.

Expected:

- removed from claimable cold inventory;
- remains suppressed after rediscovery/import;
- Rep B cannot remove DNC with ordinary rep permissions.

### Test 7 — manager reassignment

Manager reassigns an unprotected cold Account.

Expected:

- new owner visible;
- audit event shows old/new owner/actor/reason.

---

# 7. INITIAL UI QUALITY BAR

Do not ship a default unstyled admin panel just because it is internal.

Minimum:

- existing YAD navy/blue/cyan design system;
- clean left nav;
- polished search panel;
- readable prospect table;
- badge hierarchy;
- responsive Account drawer;
- clear Claim to Me;
- obvious owner state;
- clear DNC destructive treatment;
- good empty/loading/error states.

The sales team should perceive this as YAD internal software.

---

# 8. INITIAL DATA IMPORT

Before automated mining is fully connected, Claude should support a controlled CSV/import path using the canonical lead import contract.

Possible sources:

- existing Jacksonville/St. Augustine lists;
- Apollo exports;
- salesman's researched Airtable export;
- prior manually curated lists.

Every import goes through:

`normalize -> identity resolve -> suppression check -> Account/Contact upsert -> ownership check -> inventory`.

Never simply append rows into a separate lead table.

---

# 9. AIRTABLE SALES-GUY LIST

Treat the rep's Airtable as a valid external lead source if exported/API-accessible later.

Do not compete with or delete it on day one.

Import its useful fields where available:

- company;
- website;
- phone;
- POC;
- email;
- research summary;
- review/website observations;
- source timestamp;
- Airtable/source ID.

Then YAD performs:

- canonical dedupe;
- evidence normalization;
- YAD score;
- contact-quality classification;
- ownership/suppression checks.

This lets YAD compare the rep's source against the Google advertiser miner over time.

---

# 10. MINER HANDOFF AFTER PORTAL IS LIVE

Once the portal is stable:

1. connect provider adapter;
2. create first saved market;
3. run `Jacksonville HVAC — Advertiser First`;
4. new Accounts enter inventory UNCLAIMED;
5. reps can browse/claim without any workflow change;
6. enable continuous refresh/replenishment.

The portal must not care whether an Account originated from:

- Google advertiser mining;
- Apollo;
- Airtable;
- CSV;
- manual research;
- future inbound assessment.

Canonical Account behavior is the same.

---

# 11. GO / NO-GO

## GO for internal pilot

Only if:

- auth works;
- HTTPS works;
- ownership is server-enforced;
- DNC persists;
- callbacks persist;
- claim concurrency test passes;
- no production autonomous dialing;
- secrets are not exposed;
- database backup procedure exists.

## NO-GO

If:

- ownership is frontend-only;
- DNC can disappear after restart;
- shared passwords are the only access model with no actor audit;
- public DB/worker ports are exposed;
- rep can access/reassign another rep's Accounts without permission;
- imported duplicates become separate cold Accounts;
- testing causes real prospect calls/emails without explicit operator action.

---

# 12. AFTER FIRST DAY

Collect rep feedback on:

- search speed;
- usefulness of filters;
- clarity of Tier/advertiser signals;
- contact accuracy;
- Claim workflow;
- missing fields;
- disposition speed;
- whether reps still feel a need to maintain side spreadsheets.

Use those observations to improve the portal before expanding feature density.

The same-day goal is not maximum automation. It is a trustworthy shared sales workspace that the team can actually use.