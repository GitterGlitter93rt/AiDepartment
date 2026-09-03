# CLAUDE CODE — CURRENT TASK AUTHORITY

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Implementation owner:** Claude Code on EdgeXpert  
**Architecture owner:** ChatGPT  
**Business owner:** Michael Chanata

## START HERE

This file is the current task authority for Claude Code.

Do not ask Michael to paste large architecture prompts. Read the repository documentation directly.

If an older handoff conflicts with this file, this file wins for the immediate implementation priority.

---

# 1. IMMEDIATE BUSINESS OBJECTIVE

Get a usable YAD internal sales system online as quickly as practical while preserving the larger Prospect Factory / AI Sales Brain architecture.

The current near-term product is:

`EdgeXpert 24/7 prospect research`
-> `shared canonical Account inventory`
-> `sales.youraidepartment.ai`
-> `rep searches market / ZIP / vertical`
-> `rep browses researched prospects`
-> `rep claims Accounts to self`
-> `rep calls/emails/follows up`
-> `shared Account memory`
-> `Outlook strategy-call booking`
-> later controlled AI outbound voice.

The rep experience is **browse/search/claim**, not a forced black-box queue.

---

# 2. REQUIRED DOCUMENT ORDER

Read these before implementation:

1. `CLAUDE.md`
2. `brain/README.md`
3. `brain/TODO.md`
4. `docs/09-software/SALES-TEAM-ACCESS-CURRENT.md`
5. `docs/09-software/CLAUDE-SALES-PORTAL-START-PROMPT.md`
6. `docs/09-software/outbound-sales-brain-public-decision-maker-resolver-spec.md`
7. `docs/09-software/outbound-sales-brain-public-decision-maker-fixtures.v1.yaml`
8. `docs/09-software/outbound-sales-brain-public-contact-research-worker-contract.md`
9. `docs/09-software/outbound-sales-brain-contact-waterfall-spec.md`
10. `docs/09-software/outbound-sales-brain-contact-endpoint-quality-spec.md`
11. `docs/09-software/outbound-sales-brain-decision-maker-routing-spec.md`
12. `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md`
13. relevant referenced data/RBAC/ownership/import/Market Miner specs.

Do not reread every architecture file if the gate-specific docs above are sufficient.

---

# 3. CURRENT CONTACT STRATEGY — IMPORTANT CHANGE

Apollo is NOT a mandatory dependency.

Default contact mode is `PUBLIC_ONLY`.

The system should first resolve decision-makers from approved public/first-party business sources such as:

- company website/team/about/location pages;
- company schema/structured data;
- current public business registrations where appropriate;
- professional/business licensing records where appropriate;
- public business directories/associations with permitted use;
- company press/team/news pages;
- current publicly indexed business documents/search results.

Then resolve the best legitimate contact path:

- direct business phone if publicly supported;
- business email if publicly supported;
- extension if supported;
- otherwise verified main business line + named/role route.

Paid contact enrichment such as Apollo/equivalent is OPTIONAL and should be used only when campaign economics justify filling missing direct endpoints for high-value Accounts.

Never label a main/front-desk number as a person's direct number without evidence.

Never fabricate a person, title, mobile number, extension or email.

---

# 4. TODAY'S IMPLEMENTATION PRIORITY

## Gate T0 — Audit current EdgeXpert and repo

Before coding, inspect:

- current application/package structure;
- existing `phone-agent/` reusable vs disposable code;
- EdgeXpert services/processes/ports;
- Postgres availability/state;
- existing reverse proxy/tunnel/DNS setup;
- authentication options already present;
- current branch status;
- migration state;
- secrets handling;
- available current prospect CSV/list assets if locally accessible;
- current Outlook/Microsoft 365 integration readiness if credentials/config exist locally.

Return concise findings, blockers and proposed exact file/module structure.

Then proceed unless a blocker requires Michael.

## Gate T1 — Canonical sales data foundation

Implement or reconcile:

- Account
- Location
- Contact
- PhoneEndpoint / EmailEndpoint
- Evidence/provenance
- ownership
- activity/timeline
- disposition
- callback
- suppression/DNC
- import source identity
- research job state

Do not create a second parallel lead database.

## Gate T2 — Rep portal

Build the sleek internal portal intended for `sales.youraidepartment.ai`.

Required initial pages:

- Overview
- Find Prospects
- Markets
- My Prospects
- Account Detail
- Follow-Ups
- Manager Team/Ownership

Hero workflow:

`Find Prospects -> ZIP/city + vertical -> filters -> inspect -> Claim to Me -> My Prospects`.

Use existing YAD brand primitives. Do not ship a generic admin table/Airtable clone.

Claim ownership must be server-enforced and atomic.

## Gate T3 — Seed inventory

Support importing current YAD lists into the canonical Account model.

Possible sources:

- Jacksonville/St. Augustine lists;
- prior CSVs;
- Airtable export from sales rep;
- Apollo exports if available;
- other approved internal prospect lists.

Import flow:

`normalize -> identity resolve -> suppression check -> Account/Contact upsert -> ownership check -> inventory`.

No automatic outreach on import.

## Gate T4 — Public decision-maker resolver

Implement public-first Decision Maker Resolver and Public Contact Research Worker according to the current specs.

For each sales-ready Account, attempt to answer:

- who likely owns the problem/workflow?
- who is the current named person, if publicly supportable?
- what title/role evidence supports that?
- is there a direct business endpoint?
- if not, what verified main-line + role/name route should the rep use?

Keep role confidence and endpoint confidence separate.

## Gate T5 — Market Miner inventory connection

Connect cached/shared inventory search first, then background mining/research.

Rep ZIP search must:

1. query existing PostgreSQL inventory immediately;
2. show available results;
3. optionally allow authorized `Research More`;
4. schedule server-side research without blocking the UI;
5. dedupe into canonical Accounts.

Heavy mining/crawling stays on EdgeXpert/research workers, not realtime voice process.

## Gate T6 — Secure internal deployment

Prepare secure internal exposure for `sales.youraidepartment.ai` using the safest practical existing environment path.

Requirements:

- HTTPS;
- authenticated users;
- server-side RBAC;
- no public Postgres;
- no provider credentials in browser;
- process supervision;
- restart persistence;
- backup procedure;
- health endpoint.

## Gate T7 — Outlook strategy-call booking adapter

Current business intent: successful outbound conversations should normally earn a short strategy/discovery call with Michael rather than attempt to close a full YAD implementation on the cold call.

Target calendar/mailbox:

`michael@youraidepartment.ai`

Design/implement provider-neutral booking tools with Microsoft Outlook/Microsoft Graph as the current target adapter if credentials/config are available.

Required behavior:

- check real availability first;
- offer real candidate slots only;
- prefer same-day when a suitable slot actually exists and timing is reasonable;
- otherwise offer next-business-day/next suitable slots;
- capture prospect name/email/phone/timezone as required;
- create calendar event only after prospect agrees;
- include prospect as attendee when appropriate;
- write booking ID/time back to canonical Account/Opportunity/timeline;
- idempotency prevents duplicate events;
- if booking fails, create human follow-up and tell caller scheduling is not confirmed.

Do not hard-code imaginary availability.

## Gate T8 — AI cold-call script / roleplay preparation

Build script/prompt/state behavior from canonical Sales Manual doctrine, especially:

- Module 4A cold calling;
- Module 05 hooks;
- vertical profile;
- objection intelligence;
- conversation state machine;
- priority DNC intent;
- action tools;
- booking adapter.

Primary cold-call purpose:

1. reach correct decision-maker;
2. ask one researched business-process question;
3. listen/probe;
4. identify whether there is a real problem/opportunity;
5. book a short strategy call with Michael when warranted;
6. otherwise record correct next step/disqualification.

Do not make the AI sell a full undefined implementation on first contact.

Do not feature-dump.

Do not fabricate spend, ROI, CRM usage, missed-call rate, decision-maker identity, referrals or results.

Do not position AI as firing/replacing employees.

Create text-roleplay and test fixtures before any real outbound pilot.

---

# 5. TOMORROW AI COLD-CALL MICRO-PILOT

A real prospect pilot is NOT automatically authorized merely because implementation is ready.

Before any real autonomous prospect call, require:

- explicit Michael approval for the pilot;
- deterministic compliance eligibility for each number/contact/jurisdiction/campaign;
- durable suppression/DNC functioning;
- approved caller ID;
- controlled campaign size;
- Call Pack present;
- logging/QA present;
- booking action tested;
- kill switch available;
- no unresolved critical roleplay failures.

If compliance/voice gates are not ready, run the exact same conversation/booking path on internal/allowlisted test participants first.

No model may override the compliance decision.

---

# 6. PILOT CALL OUTCOME MODEL

Successful outcomes include:

- correct decision-maker identified;
- meaningful problem discovered;
- strategy call booked with Michael;
- specific requested callback;
- requested targeted email;
- clear no-need/disqualification;
- DNC honored immediately.

A booked meeting is not the only successful outcome.

The system must record exact prospect wording, relevant numbers, current systems if prospect states them, objection, decision-maker correction and next step.

---

# 7. TOMORROW CALL STYLE TARGET

The AI should sound like a concise researched business-development person, not an AI demo.

Default shape:

`honest context -> one relevant question -> listen -> probe -> quantify only when supported -> position briefly -> next step`.

Example structure, not a universal verbatim script:

> Hey [Name], this is [Agent] with Your AI Department. This is a cold call, so I'll be brief. I had a quick question about how you handle [specific researched business process].

If prospect is busy:

> Completely understand. Give me ten seconds and you can tell me whether I should disappear.

If real opportunity emerges:

> Based on what you just told me, I think this is worth a proper look. Rather than guess on a cold call, the next step would be a short strategy conversation with Michael where we map the workflow and see if there's actually a business case. Would you be open to that?

Then check actual calendar availability and offer two real slots.

The runtime prompt should use vertical/problem-specific language rather than repeating one generic script.

---

# 8. HARD CONSTRAINTS

- Do not merge `main` without Michael's explicit approval.
- Do not re-enable automatic GitHub Actions.
- Do not manually dispatch CI unless explicitly requested.
- Do not commit secrets.
- Do not submit fake prospect/customer forms.
- Do not call real prospects during tests.
- Do not invent contact data.
- Do not make Apollo mandatory.
- Do not run heavy research workloads on the realtime voice gateway.
- Do not create calendar events without prospect agreement / approved booking flow.
- Do not claim a booking succeeded until provider result confirms it.

---

# 9. REPORTING

After each gate, report:

- exact files changed;
- schema/migrations;
- services/processes changed;
- commands/tests run;
- test results;
- UI screenshots/manual verification where useful;
- security checks;
- credentials/config readiness;
- blockers requiring Michael;
- next exact gate.

Do not ask Michael questions that a repo/server audit can answer.

---

# 10. CURRENT SUCCESS CONDITION

Near-term:

**EdgeXpert maintains a shared researched prospect pool; sales reps can securely browse/search a market, claim Accounts, see trustworthy decision-maker/contact paths, call/email/follow up, and book qualified prospects directly onto Michael's Outlook calendar.**

Then:

**A tightly controlled AI outbound micro-pilot can use the same prospect intelligence, scripts, tools, calendar and shared memory after explicit approval and compliance/voice gates pass.**
