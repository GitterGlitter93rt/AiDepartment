# YAD SALES TEAM ACCESS — CURRENT IMPLEMENTATION MANIFEST

**Status:** Near-term product authority  
**Date:** 2026-09-03  
**Business objective:** Give YAD salespeople researched people/companies to call and email before autonomous Twilio outbound exists.  
**Implementation owner:** Claude Code on EdgeXpert

---

# 1. WHAT TO BUILD

The near-term internal product is:

`Market Miner`
-> `Researched / deduplicated Accounts`
-> `Contact enrichment`
-> `Score / Tier / advertiser evidence`
-> `Opportunity hypothesis / hook`
-> `Sales Team Access`
-> `Human calls + Smartlead/direct email`
-> `Shared Account memory`
-> `Callbacks / meetings / opportunities`.

Autonomous AI cold calling is NOT required to deliver value to the sales team.

---

# 2. WHAT A REP NEEDS

A rep logs in and gets:

- Call Now
- Email Now
- Call + Email
- Follow-Up / Callbacks

Every prospect should answer:

- who is the company?
- who should I ask for?
- what phone/email can I use?
- how reliable is that endpoint?
- why is this prospect worth my time?
- what public evidence supports that?
- what is the primary business hypothesis?
- what should I ask first?
- what should I NOT claim?
- has anybody at YAD already contacted them?
- what is the next action?

---

# 3. REQUIRED SPECS

Claude must implement this milestone against:

- `outbound-sales-brain-sales-team-prospect-access-spec.md`
- `outbound-sales-brain-sales-team-rbac-permissions-spec.md`
- `outbound-sales-brain-prospect-worklist-contract.v1.yaml`
- `outbound-sales-brain-sales-team-access-fixtures.v1.yaml`
- `outbound-sales-brain-sales-team-access-mvp-acceptance.md`
- `outbound-sales-brain-human-assist-workflow.md`
- `outbound-sales-brain-human-assist-daily-brief-spec.md`
- `outbound-sales-brain-smartlead-sync-spec.md`
- `outbound-sales-brain-multichannel-coordination-spec.md`
- `market-miner-lead-import-export-spec.md`
- `outbound-sales-brain-ready-queue-priority-spec.md`
- `outbound-sales-brain-prospect-memory-spec.md`
- `outbound-sales-brain-account-opportunity-lifecycle-spec.md`

The global architecture still begins at:

`OUTBOUND-SALES-BRAIN-V1-CURRENT.md`

---

# 4. IMPLEMENTATION ORDER

Do NOT start by building Twilio autonomous outbound.

## A. Prerequisite Market Miner proof

Prove trustworthy prospect inventory first.

Initial target remains:

> HVAC — Jacksonville + St. Augustine — advertiser-first — Tier B+ — target 100 research-ready prospects — NO AUTONOMOUS CONTACT.

## B. Sales Team Access data/query layer

Implement:

- rep/team ownership;
- channel eligibility;
- worklists;
- shared timeline;
- endpoint quality;
- suppression filtering;
- callbacks/follow-ups.

## C. Internal UI

Implement:

- login;
- rep home;
- Call Now;
- Email Now;
- Both;
- Follow-Ups;
- prospect detail;
- claim/release;
- disposition;
- callback;
- correction;
- manager assignment.

## D. Smartlead coordination

Implement export/sync after canonical Account/Contact state exists.

## E. Two-rep acceptance

Run the documented Sales Team Access MVP acceptance with at least two reps.

## F. Improve based on actual rep use

Do not wait for voice AI to learn whether prospect research and UI are useful.

---

# 5. INITIAL USER ROLES

At minimum:

- SALES_REP
- SALES_MANAGER
- RESEARCH_OPS
- ADMIN

Permissions follow RBAC spec.

Important:

- reps can create DNC immediately;
- reps cannot remove DNC;
- ordinary reps cannot export unrestricted master database;
- no sales role can enable autonomous outbound.

---

# 6. WORKLIST CONTRACTS

The product must produce:

## CALL_SHEET

For human calling.

## EMAIL_SHEET

For eligible email prospects.

## COMBINED_WORKLIST

For coordinated multichannel human work.

## SMARTLEAD_EXPORT

Minimum permitted personalization/contact fields for approved Smartlead execution.

Canonical machine contract:

`outbound-sales-brain-prospect-worklist-contract.v1.yaml`

---

# 7. RELATIONSHIP RULES

One company = one canonical Account.

The Account history follows the company across:

- Google discovery;
- Apollo/imported lists;
- different vertical campaigns;
- human phone calls;
- Smartlead;
- direct email;
- field visits;
- assessment completion;
- meetings;
- proposals;
- later Twilio.

A new source NEVER resets:

- DNC;
- prior contact;
- callback;
- owner;
- opportunity stage;
- client status.

---

# 8. SMARTLEAD RULE

Smartlead is an execution channel, not the CRM/master database.

YAD owns canonical:

- Account identity;
- Contact identity;
- score/tier;
- research;
- owner;
- suppression;
- relationship history;
- opportunity state.

Smartlead sends/replies/bounces/unsubscribes sync back to YAD.

Positive reply should stop contradictory generic cold outreach and create Human Assist ownership/follow-up.

---

# 9. REP EXPERIENCE TARGET

A good rep should:

- understand a new prospect in under ~60 seconds;
- know exactly who/what to ask for;
- have a relevant first question;
- disposition a simple attempt in under ~15 seconds;
- schedule callback in under ~20 seconds;
- record DNC in under ~10 seconds;
- never need a personal spreadsheet to determine ownership/history.

---

# 10. HARD FAILS

Do not accept implementation if:

- DNC appears in actionable list;
- two reps unknowingly own same cold Account;
- client appears in generic cold list;
- active opportunity appears in generic cold list;
- positive email reply is followed by uncoordinated generic cold outreach;
- stale ad evidence generates current-tense ad personalization;
- ordinary rep can unsuppress DNC;
- provider credentials appear in frontend;
- exports are not audited;
- callback/follow-up state is only in memory and can disappear after restart.

---

# 11. FIRST PRACTICAL SALES DELIVERY

A manager should be able to create:

> Brent — 50 Jacksonville HVAC Tier A/B advertisers — Call + Email

and Brent should receive a working queue with:

- company;
- decision-maker/target role;
- phone;
- email;
- Google/LSA evidence;
- advertised service;
- score/tier;
- primary business hypothesis;
- primary hook;
- first question;
- personalized email line;
- do-not-claim warnings;
- Account history;
- one-click disposition/callback/DNC.

This is the first rep-facing proof of the Prospect Factory.

---

# 12. NEXT AFTER THIS MILESTONE

Once reps are successfully using researched lists:

1. compare advertiser-mined vs Apollo/imported cohorts;
2. improve contact enrichment;
3. refine hooks based on qualified-conversation outcomes;
4. expand verticals/markets;
5. deepen Smartlead automation;
6. continue Sales Manual RAG/QA;
7. benchmark realtime voice;
8. add controlled Twilio only after its separate gates.

---

# 13. CORE RULE

**Get researched prospects into the hands of YAD salespeople now.**

The first commercial value of the Sales Brain is not autonomous dialing. It is giving every rep a better list, better context, better first question, and one shared memory across call and email.