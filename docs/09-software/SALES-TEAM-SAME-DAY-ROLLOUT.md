# YAD SALES TEAM ACCESS — SAME-DAY ROLLOUT PLAN

**Status:** Immediate implementation authority for today's internal rollout  
**Date:** 2026-09-03  
**Business owner:** Michael Chanata  
**Implementation owner:** Claude Code on the EdgeXpert  
**Goal:** Give YAD sales reps a secure web portal with real prospects to call/email today, while keeping Market Miner enrichment/replenishment modular.

---

# 1. DEFINITION OF DONE FOR TODAY

Today is successful when all of the following are true:

1. A salesperson can open `https://sales.youraidepartment.ai` from a phone or laptop outside Michael's network.
2. The application is authenticated; it is not a public prospect database.
3. At least two sales users can log in independently.
4. A manager/admin can import an existing CSV/XLSX-derived prospect list into the canonical Account/Contact store through a controlled import path.
5. Each rep sees an assigned ranked worklist.
6. Each prospect card shows, when available:
   - company;
   - city/state;
   - website;
   - target role/contact;
   - phone;
   - email;
   - endpoint confidence;
   - score/tier if research exists;
   - why-contact/hypothesis if research exists;
   - primary first question/hook if research exists;
   - do-not-claim warnings;
   - Account history.
7. A rep can:
   - claim/open a prospect;
   - tap/copy the phone;
   - copy email details;
   - mark no answer;
   - voicemail;
   - decision-maker reached;
   - wrong number;
   - wrong contact;
   - possible opportunity;
   - not a fit;
   - DNC;
   - requested callback;
   - meeting booked;
   - notes/corrections.
8. DNC immediately removes the Account/contact endpoint from actionable cold worklists.
9. Requested callbacks reappear at the requested time/date and take priority over new cold prospects.
10. Two reps cannot unknowingly cold-work the same claimed Account at the same time.
11. Manager/admin can see basic team activity and current assignments.
12. Data survives service restart.
13. No autonomous Twilio prospect calls are enabled.
14. GitHub Actions remain manual-only.

The advertiser miner does NOT have to be fully production-complete for reps to begin using the portal. Existing lists/imports are an approved Day-0 seed source.

---

# 2. DAY-0 SYSTEM SHAPE

```text
Rep phone/laptop
        |
        v
https://sales.youraidepartment.ai
        |
        v
Cloudflare Access / authenticated ingress
        |
        v
Cloudflare Tunnel
        |
        v
EDGE XPERT
+---------------------------------------+
| Sales Portal / Control API            |
|                                       |
| Prospect DB / persistent storage      |
|                                       |
| Background Job Worker                 |
|                                       |
| Market Miner adapters                 |
|   - imports                           |
|   - Google advertiser source later    |
|   - website research                  |
|   - contact enrichment                |
|                                       |
| Rep worklist engine                   |
+---------------------------------------+
        |
        +------ future/read-only ------> voice.youraidepartment.ai
                                      Twilio realtime voice
```

The marketing site and realtime voice VPS remain separate services.

---

# 3. HOSTING DECISION FOR TODAY

## EdgeXpert

Use the EdgeXpert as the Day-0 host for:

- internal sales portal;
- control/API;
- Market Miner/background workers;
- research processing;
- canonical prospect/worklist persistence, unless a separate existing Postgres instance is already the better choice.

Do not move realtime Twilio conversational processing onto this machine as part of today's rollout.

## Cloudflare Tunnel

Preferred ingress for Day 0:

- remotely managed Cloudflare Tunnel;
- public hostname `sales.youraidepartment.ai`;
- route hostname to local sales application on EdgeXpert;
- no public inbound application port required;
- do not expose SSH through the public hostname;
- add Cloudflare Access/authentication in front of the internal application.

If YAD's authoritative DNS is not currently on Cloudflare, Claude must report the exact DNS situation before changing nameservers. Do not break the production website or voice DNS merely to launch the internal portal.

If moving the whole zone would create risk, use the supported partial/CNAME approach or another safe authenticated ingress rather than making a rushed nameserver migration.

---

# 4. AUTHENTICATION

Day-0 requirements:

- named user accounts;
- no shared generic `sales/sales` password;
- Access allowlist and/or application authentication;
- roles:
  - ADMIN;
  - SALES_MANAGER;
  - SALES_REP;
  - RESEARCH_OPS.

Fastest acceptable user experience:

- Cloudflare Access email/identity authentication;
- application still enforces internal user identity/role for authorization.

Cloudflare ingress identity is not a substitute for application RBAC.

---

# 5. DAY-0 DATABASE MINIMUM

Use durable storage.

Preferred: PostgreSQL if practical in the current EdgeXpert/runtime environment.

If Claude proposes another datastore for speed, it must demonstrate:

- safe concurrent use by multiple reps;
- durability after restart;
- unique Account identity;
- unique Contact/endpoint identity;
- transactions/locking for claims;
- migration/export path to canonical Postgres.

Do not keep assignments, DNC, callbacks, or dispositions only in process memory.

Minimum entities for today:

- User
- Team
- Account
- Location
- Contact
- PhoneEndpoint
- EmailEndpoint
- Assignment/Claim
- Interaction
- Disposition
- CallbackTask
- Suppression
- ImportBatch
- WorklistItem
- Evidence (may be partial on imported leads)
- Score (optional until researched)

---

# 6. TWO-STAGE DELIVERY

## Stage 1 — reps can work today

Do not block on automated Google mining.

Seed inventory from:

- existing Jacksonville/St. Augustine local lead spreadsheets;
- existing Apollo/Smartlead exports where permitted;
- existing YAD prospect lists;
- manager-uploaded CSV;
- manually entered Accounts.

All seed records must pass:

`normalize -> dedupe -> suppression check -> contactability -> worklist`

before being exposed to reps.

Imported list origin must remain visible.

## Stage 2 — automatic inventory replenishment

Once a Google advertiser provider is configured:

`Campaign request`
-> `Google paid search observations`
-> `advertiser normalization`
-> `identity resolution`
-> `website research`
-> `contact enrichment`
-> `canonical score/tier`
-> `hypothesis/hook`
-> `eligible rep inventory`.

Miner failure must never stop reps from working already-available inventory.

---

# 7. DAY-0 PORTAL SCREENS

Avoid spending Day 0 on design polish.

## Login / Access

Secure entry.

## Rep Home

Show:

- callbacks due;
- Call + Email count;
- Call Now count;
- Email Now count;
- newly assigned prospects;
- today's attempts;
- qualified conversations;
- meetings/next steps.

## Worklist

Each row/card:

- company;
- city;
- target role/contact;
- primary phone;
- primary email;
- Tier if known;
- advertiser signal if known;
- short why-contact line;
- assigned rep;
- next action.

## Prospect Detail

Show:

- identity;
- contact endpoints + confidence/source;
- website;
- public/research facts;
- hypothesis;
- first question;
- do-not-claim warnings;
- prior interactions;
- notes/corrections;
- disposition buttons;
- callback scheduling.

## Manager View

Minimum:

- users;
- unassigned inventory;
- assigned inventory;
- callbacks overdue;
- attempts by rep;
- decision-makers reached;
- qualified/possible opportunities;
- meetings;
- DNC/wrong endpoint corrections;
- import new list;
- assign/reassign batches.

---

# 8. REP CLAIM / LEASE BEHAVIOR

When a rep opens/claims a cold Account:

- create a durable lease/assignment;
- show current owner to other reps;
- prevent accidental duplicate concurrent cold work;
- lease expires only according to documented ownership rules, not browser closure alone;
- manager can reassign;
- requested callback creates sticky ownership unless manager changes it;
- positive reply/active opportunity creates sticky relationship ownership;
- DNC overrides ownership.

Do not implement `SELECT then hope nobody else clicked it` concurrency.

Use an atomic database claim/lock strategy.

---

# 9. CONTACTABILITY FOR TODAY

Every endpoint must have status.

Phone examples:

- VERIFIED_BUSINESS_MAIN
- VERIFIED_DIRECT_BUSINESS
- PROVIDER_BUSINESS
- PUBLIC_UNVERIFIED
- WRONG_NUMBER
- DISCONNECTED
- SUPPRESSED

Email examples:

- VERIFIED_BUSINESS
- PROVIDER_BUSINESS
- PUBLIC_UNVERIFIED
- BOUNCED
- UNSUBSCRIBED
- SUPPRESSED

A company without a named decision-maker may still be callable through a verified main business number with a target role:

> Ask for Owner / GM / Operations.

Do not fabricate a person merely to make a row look complete.

---

# 10. DAY-0 WORKLIST PRIORITY

Priority order:

1. requested callback due now;
2. positive reply/human follow-up due;
3. active qualified follow-up;
4. assigned Tier A Call + Email;
5. assigned Tier A Call;
6. assigned Tier A Email;
7. Tier B equivalents;
8. lower tiers only if campaign policy permits.

Within cold inventory, use the existing deterministic queue priority spec.

Do not allow a lower-quality new cold lead to bury a prospect-requested callback.

---

# 11. MANAGER “BUILD ME A LIST” DAY-0 CONTRACT

The manager UI/API should support a request such as:

> Assign Brent 50 Jacksonville/St. Augustine HVAC Tier A/B advertisers, prefer Call + Email.

Inputs:

- assignee/team;
- vertical;
- geography;
- Tier threshold;
- advertiser requirement/preference;
- channel requirement;
- count;
- exclude prior contact/client/opportunity/DNC;
- freshness requirement.

If only 31 records meet the request, return/assign 31 and report the shortfall.

Never silently lower Tier, freshness, geography, advertiser requirement, or endpoint quality to manufacture the requested count.

---

# 12. IMPORT PATH FOR IMMEDIATE INVENTORY

Day 0 must have an import route because it guarantees salesperson utility before automatic mining is finished.

Required import support:

- CSV;
- normalized columns;
- preview before commit;
- row-level validation;
- batch ID;
- source/list name;
- duplicate summary;
- rejected-row summary;
- suppression matches;
- created vs merged records.

Minimum common aliases:

- company / company_name / business;
- website / domain;
- phone / business_phone;
- email / work_email;
- first_name;
- last_name;
- title;
- city;
- state;
- zip;
- industry;
- source.

Do not allow an import to overwrite newer verified canonical data simply because the spreadsheet contains a value.

---

# 13. GOOGLE ADVERTISER MINER DAY-0 BOUNDARY

If provider credentials are available today, enable only RESEARCH/HUMAN-ASSIST mining.

First campaign:

- HVAC;
- Jacksonville + St. Augustine;
- advertiser-first;
- Google high-intent search;
- target Tier B+;
- no autonomous contact.

Day-0 advertiser miner does NOT need:

- every supported vertical;
- nationwide geography;
- learned propensity model;
- Meta automation;
- autonomous voice;
- elaborate market-autopilot.

It DOES need:

- provider adapter;
- query/search cell;
- raw observation storage according to retention policy;
- advertiser normalization;
- dedupe;
- domain resolution;
- website research;
- score/tier;
- queue handoff.

If contact enrichment is not ready, verified main business phone + target role is acceptable for human calling.

---

# 14. SMARTLEAD TODAY

Smartlead is optional for first login but high priority after canonical Account IDs exist.

Safe Day-0 minimum:

- manager exports eligible EMAIL or CALL+EMAIL prospects;
- export contains canonical Account/Contact IDs;
- Smartlead campaign/list identifier is recorded;
- later reply/bounce/unsubscribe can be reconciled back.

Do NOT create a second independent Smartlead master list with no YAD Account identity.

---

# 15. BACKUPS / RECOVERY

Before reps begin meaningful use:

- database backup procedure documented;
- test restoring a small backup or at least validate backup readability;
- application config/secrets excluded from Git;
- logs do not contain provider API keys/passwords;
- service restart does not erase assignments/history/callbacks;
- EdgeXpert reboot startup behavior documented.

Day-0 uptime does not need enterprise HA, but it must fail safely.

If EdgeXpert is offline:

- reps cannot access the portal;
- no prospect history is lost;
- no autonomous calling continues from stale state.

Later production evolution can move database/workers to cloud infrastructure for 24/7 availability.

---

# 16. OBSERVABILITY

Minimum status page/admin diagnostics:

- portal healthy;
- database healthy;
- worker healthy;
- tunnel/ingress reachable;
- last successful background job;
- pending job count;
- failed job count;
- current inventory counts by channel;
- last backup timestamp.

No need for a huge observability platform today.

---

# 17. DO NOT DO TODAY

Do not:

- enable autonomous prospect dialing;
- move Twilio realtime voice onto the EdgeXpert;
- migrate the production marketing website merely to host the portal;
- open database ports to the public internet;
- expose SSH publicly for the portal;
- re-enable automatic GitHub Actions;
- build all verticals;
- build predictive AI ranking;
- build polished executive dashboards;
- build complex proposal/delivery features;
- build a mobile native app;
- hard-code provider secrets;
- invent contacts or enrichment data;
- bypass source rate limits/access controls;
- lower quality filters to fill arbitrary quotas.

---

# 18. SAME-DAY EXECUTION ORDER FOR CLAUDE

## Step 0 — audit before changes

Report:

- EdgeXpert OS/runtime;
- existing repo checkout/branch;
- existing app/runtime conventions;
- database availability;
- current Cloudflare/DNS ownership situation;
- current firewall/open ports;
- whether Docker/systemd/process manager is already used;
- current secrets method;
- current production website/voice separation.

No GitHub CI runs.

## Step 1 — persistent data + seed import

Implement canonical minimal entities, migrations and CSV import.

Acceptance:

- import a synthetic fixture;
- duplicates merge correctly;
- DNC remains excluded;
- restart preserves data.

## Step 2 — authenticated internal portal

Implement rep/manager roles and basic UI.

Acceptance:

- two users can authenticate;
- role boundaries work;
- no public unauthenticated prospect access.

## Step 3 — Cloudflare Tunnel / hostname

Connect `sales.youraidepartment.ai` to local EdgeXpert app through secure ingress.

Acceptance:

- works from external phone network;
- authentication required;
- no public origin app port required;
- production website/voice unaffected.

## Step 4 — rep worklists

Implement assignment, atomic claim, prospect card, disposition, callback and DNC.

Acceptance:

- two-browser/two-user concurrent test;
- cannot silently double-claim;
- DNC immediately disappears;
- callback survives restart.

## Step 5 — load first real approved YAD list

Use an existing YAD list approved by Michael.

Do not contact automatically.

Manager reviews import summary before reps work it.

## Step 6 — rep smoke test

Have at least two reps each work 5–10 internal/prospect records as approved by management.

Observe:

- list clarity;
- endpoint usefulness;
- disposition speed;
- ownership behavior;
- bugs.

## Step 7 — advertiser miner if credentials ready

Start Jacksonville/St. Augustine HVAC advertiser-first RESEARCH_ONLY/HUMAN_ASSIST job.

Do not hold the portal launch hostage to this step.

## Step 8 — Smartlead export/sync minimum

After Account identity is stable, add approved export path.

---

# 19. SAME-DAY GO/NO-GO CHECK

GO for internal rep use when:

- authenticated externally accessible portal works;
- persistent database works;
- at least two reps tested;
- DNC works;
- callback works;
- assignment collision test passes;
- backups documented;
- real approved seed inventory imported;
- no autonomous Twilio enabled.

NO-GO if:

- portal is publicly open;
- DNC is not durable;
- assignments disappear/reassign unpredictably;
- two reps can unknowingly work the same Account;
- database has no backup path;
- production website/voice DNS was broken;
- secrets were committed;
- test required automatic GitHub Actions.

---

# 20. BUSINESS RESULT

By the end of Day 0, YAD should have an internal sales URL where reps can work a shared, controlled pool instead of personal spreadsheets.

The miner then continuously improves the quality and freshness of that pool.

The sequence is intentionally:

`give reps access today`
-> `automate prospect replenishment`
-> `improve enrichment`
-> `coordinate Smartlead`
-> `measure outcomes`
-> `controlled voice tests`
-> `only later consider autonomous outbound`.
