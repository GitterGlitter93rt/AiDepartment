# Your AI Department — Outbound Sales Brain Admin / Control Plane Specification

**Status:** Architecture authority  
**Purpose:** Define the internal interface for operating Market Miner, human-assist prospecting, campaign controls, evidence review, provider spend, compliance state, and call QA.

---

# 1. PRODUCT PRINCIPLE

The admin UI is not merely a pretty analytics dashboard.

It is the control surface for:

- what markets are being mined;
- what prospects are ready;
- why a prospect was scored;
- what evidence supports the hook;
- what providers are spending money;
- whether calling is permitted/enabled;
- what happened on calls;
- whether the AI is making unsupported claims;
- where salespeople should focus next.

Critical actions must be explicit and auditable.

---

# 2. USER ROLES

Initial role model:

## Administrator

Can:

- manage campaigns;
- configure provider budgets;
- view all research/evidence;
- manage suppression;
- pause campaigns;
- use global kill switch according to authorization;
- manage users/roles;
- approve controlled tests;
- view full QA/compliance audit.

## Sales Manager

Can:

- create/adjust human-assist campaigns within limits;
- assign prospects;
- review calls/notes/QA;
- view scoring/evidence;
- manage follow-up;
- pause campaign outreach;
- cannot override compliance hard blocks.

## Sales Rep

Can:

- view assigned prospect Call Packs;
- start/log human calls;
- record outcomes;
- create follow-up;
- mark wrong contact;
- request suppression/DNC;
- see evidence relevant to their prospect;
- cannot change score rules/provider settings/compliance rules.

## Reviewer / QA

Can:

- review transcripts/audio where allowed;
- score/correct QA;
- flag research errors;
- flag unsupported claims;
- recommend prompt/manual changes.

## Read-only Executive

Can:

- view metrics/campaign status/economics;
- cannot trigger contact/actions.

---

# 3. GLOBAL HEADER / SAFETY STATUS

Always-visible indicators:

- global autonomous-dial state: OFF / CONTROLLED TEST / PRODUCTION ENABLED;
- global kill switch;
- active campaign count;
- provider spend today;
- current ready inventory;
- unresolved compliance/quality alerts.

Production calling should never be hidden behind a sub-menu.

---

# 4. HOME / OPERATIONS DASHBOARD

Cards:

## Prospect supply

- Tier A ready
- Tier B ready
- stale needing refresh
- research in progress
- new today

## Outreach

- assigned human calls today
- eligible calls
- conversations
- decision-makers
- meetings
- DNC

## Quality

- QA average
- hard fails
- research correction rate
- unsupported claim alerts

## Costs

- research/provider spend today
- cost per Tier B+
- telecom/model spend if enabled
- cost per meeting

## System health

- research workers
- provider API status
- realtime voice gateway
- database/queue
- suppression store

---

# 5. MARKET MINER VIEW

Filters:

- vertical;
- state;
- metro;
- city;
- county;
- ZIP/ZCTA/search cell;
- source provider;
- search query family;
- Google/LSA/Meta status;
- score/tier;
- research completeness;
- status;
- discovered date.

Map/table should display:

- territory coverage;
- search-cell saturation;
- unique advertisers found;
- Tier A/B yield;
- provider cost;
- last mined.

Actions:

- create mining job;
- pause/resume;
- request refresh;
- expand territory manually;
- inspect query yield;
- export approved human-assist list.

---

# 6. CAMPAIGN BUILDER

Form inputs:

- campaign name;
- vertical profile;
- geography;
- target inventory;
- minimum tier;
- advertiser-first/advertiser-only;
- preferred signals;
- exclusions;
- research depth;
- daily provider budget;
- total provider budget;
- maximum new prospects/day;
- human-assist vs controlled test vs approved production mode;
- assignment team;
- follow-up policy;
- compliance policy version.

Before creation show estimated search plan/budget range where possible.

Do not let UI imply an estimate is guaranteed actual cost.

---

# 7. CAMPAIGN DETAIL

Sections:

## Status

- mode;
- target/ready inventory;
- low/high water;
- budget consumed;
- territory state;
- pause/kill status.

## Funnel

- discovered
- deduplicated
- research complete
- Tier A
- Tier B
- assigned
- contacted
- conversations
- decision-makers
- qualified
- meetings

## Search performance

Query + geography matrix showing:

- tasks;
- unique advertisers;
- duplicate rate;
- Tier B+ yield;
- cost.

## Outreach performance

- hook performance;
- source performance;
- score/tier performance.

---

# 8. PROSPECT LIST

Columns:

- rank;
- company;
- city;
- tier/score;
- research completeness;
- current ad signal;
- advertised service;
- 24/7;
- locations;
- system signal;
- primary hypothesis;
- primary hook family;
- decision-maker;
- last outcome;
- next action;
- status.

Quick filters:

- Tier A only;
- fresh Google advertisers;
- LSA;
- multi-channel advertisers;
- replacement advertisers;
- 24/7;
- no website;
- decision-maker found;
- stale research;
- uncontacted.

---

# 9. PROSPECT DETAIL — “WHY ARE WE CALLING THEM?”

Top section must answer:

- why selected;
- current score/tier;
- score reasons;
- current Call Pack;
- current research completeness;
- last research time;
- contact history.

Tabs:

1. Overview
2. Evidence
3. Website
4. Ads
5. Systems
6. Contacts
7. Calls
8. Follow-up
9. Audit/history

---

# 10. EVIDENCE INSPECTOR

Every material claim shown with:

- claim;
- confidence;
- source/provider;
- source reference;
- observed timestamp;
- expiry/freshness;
- can-state-as-fact flag;
- current/contradicted/stale status.

Reviewer actions:

- confirm/correct normalized value;
- mark provider/parser error;
- link contradicting evidence;
- trigger refresh;
- never erase immutable source history.

This is essential for debugging why the AI said something.

---

# 11. SCORE EXPLAINER

Display each Module 4C rule:

- rule;
- points possible;
- points awarded;
- evidence;
- reason.

Example:

`+4 Active Google paid search` → evidence: `emergency AC repair Jacksonville`, observed 09/02 11:14 AM.

Do NOT show opaque score without reasons.

Also show separately:

- research completeness;
- queue priority;
- future learned propensity score when implemented.

Never visually merge them into one misleading “AI score.”

---

# 12. HUMAN-ASSIST SALES QUEUE

Rep view optimized for calling.

For each assigned prospect:

- company/contact;
- click-to-call/manual dialing action;
- primary hook;
- backup hook;
- top facts;
- top unknowns;
- first questions;
- objection shortcuts;
- evidence quick view;
- notes;
- outcome buttons.

Outcome buttons:

- no answer
- voicemail
- gatekeeper
- wrong contact
- spoke/no pain
- possible opportunity
- follow-up requested
- email requested
- strategy call scheduled
- disqualified
- DNC

DNC must be prominent and immediate, not buried.

---

# 13. CALL REVIEW

Where media retention policy allows:

- transcript;
- audio player;
- agent/prospect turn separation;
- timestamps;
- tool/action events;
- interruption events;
- latency timeline;
- Call Pack used;
- evidence claims used;
- outcome;
- QA score.

Reviewer should be able to click an agent claim and see supporting evidence when available.

---

# 14. QA VIEW

Show 12 Sales Manual criteria:

1. Relevant preparation
2. Honest opening
3. Clear reason
4. First-question quality
5. Listening
6. Follow-up questions
7. Business language
8. Financial diagnosis
9. Employee-safe positioning
10. No invented claims
11. Clear next step
12. CRM documentation

Also:

- hard-fail flags;
- reviewer notes;
- AI grader vs human grader;
- disagreement queue.

---

# 15. COMPLIANCE / SUPPRESSION CENTER

Functions:

- search phone/contact/account;
- see suppression scope/reason/date/source;
- create manual suppression;
- review DNC event/call;
- see policy version;
- inspect compliance decision inputs/reason codes;
- view next eligible timestamp;
- never one-click “ignore DNC.”

Reversing a suppression requires privileged audited action and policy-defined reason.

---

# 16. PROVIDER SPEND CENTER

By provider:

- tasks today/month;
- spend;
- errors;
- cost/new account;
- cost/Tier B+;
- cost/meeting when attributable.

By query/market:

- spend;
- yield;
- saturation;
- recommended budget shift.

Alerts:

- provider cost spike;
- error spike;
- duplicate-yield spike;
- budget 75%/90%/100%.

---

# 17. EXPERIMENT CENTER

Show:

- experiment;
- cohort;
- variants;
- sample size;
- primary outcome;
- guardrail metrics;
- status;
- conclusion.

No experiments may weaken truth/compliance boundaries.

---

# 18. SYSTEM HEALTH

Health checks:

- database;
- queue;
- research workers;
- website crawler;
- ad providers;
- contact provider;
- Twilio;
- STT/TTS/model providers;
- booking;
- CRM;
- suppression store.

Critical dependency down should show operational impact:

> Suppression store unavailable — autonomous outbound blocked.

rather than generic red dot.

---

# 19. AUDIT LOG

Audit:

- campaign created/changed;
- mode changed;
- global dial state changed;
- kill switch triggered/released;
- budget changed;
- suppression added/changed;
- policy version changed;
- manual evidence correction;
- score/profile version update;
- prospect merge/unmerge;
- admin override.

Store:

- actor;
- timestamp;
- old/new value;
- reason where required.

---

# 20. ACCESS CONTROL / AUTHENTICATION

Architecture requirements:

- authenticated internal users;
- role-based permissions;
- least privilege;
- strong protection around production-call controls and suppression changes;
- session/audit logging;
- no public unauthenticated `/api/dial` equivalent;
- secrets never delivered to browser.

---

# 21. MOBILE/REP EXPERIENCE

Human-assist queue should work well on mobile because field/call reps may use it away from a desk.

Priority mobile elements:

- company;
- call button;
- primary hook;
- key facts;
- outcome buttons;
- notes;
- follow-up scheduling.

Deep evidence/admin configuration can remain desktop-first.

---

# 22. V1 ADMIN BUILD PRIORITY

Do not build an enormous SaaS dashboard before core data works.

V1 minimum:

1. campaign/mining job list;
2. ready prospect list;
3. prospect detail/evidence/score;
4. human-assist Call Pack view;
5. disposition/follow-up;
6. suppression search/create;
7. provider spend summary;
8. global/campaign pause status.

Then add:

- call review;
- QA;
- experiments;
- advanced maps;
- analytics visualizations.

---

# 23. FIRST UI ACCEPTANCE TEST

A sales manager should be able to:

1. create `Jacksonville HVAC — Tier B+ — advertiser-first` in research/human-assist mode;
2. see mining progress and provider spend;
3. open a Tier A prospect;
4. understand every point in its score;
5. inspect the Google ad evidence;
6. see the website/system research;
7. assign the prospect to Brent;
8. Brent can see the hook/questions and log an outcome;
9. if prospect says DNC, suppression becomes immediately visible;
10. manager can see the resulting funnel metric.

No Twilio autonomous call is needed to pass this milestone.
