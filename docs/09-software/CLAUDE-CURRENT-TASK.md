# CLAUDE CODE — CURRENT TASK AUTHORITY

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Implementation owner:** Claude Code on EdgeXpert / voice VPS  
**Architecture owner:** ChatGPT  
**Business owner:** Michael Chanata

## START HERE

This file is the current implementation task authority.

Do not ask Michael to paste large architecture prompts. Read the repository documentation directly.

If an older handoff conflicts with this file, this file wins for immediate implementation priority.

---

# 1. IMMEDIATE BUSINESS OBJECTIVE

Get a usable YAD sales operating system online quickly while preserving the larger Prospect Factory / AI Sales Brain architecture.

Near-term flow:

`EdgeXpert 24/7 prospect research`
-> `shared canonical Account inventory`
-> `sales.youraidepartment.ai`
-> `rep searches market / ZIP / vertical`
-> `rep browses researched prospects`
-> `rep claims Accounts to self`
-> `channel-specific contact eligibility`
-> `rep calls/emails/follows up`
-> `shared Account memory`
-> `Cal.com 15-minute strategy-call booking`
-> `Michael Outlook calendar`
-> `Cal Video meeting`
-> `controlled outbound Sales AI`.

The rep experience is **browse/search/claim**, not a forced black-box queue.

The outbound voice design uses **one core YAD Sales AI**, not 30+ independent industry sales agents.

Industry-specific research changes the CallPack, hypothesis, terminology, first question and professional boundaries. It does not create a different salesperson persona.

Phone-channel authorization is also no longer represented by one generic `CALL_READY` flag.

At minimum distinguish:

```text
HUMAN_MANUAL_CALL = ALLOW | BLOCK | REVIEW_REQUIRED
AUTONOMOUS_AI_VOICE = ALLOW | BLOCK | REVIEW_REQUIRED
```

---

# 2. REQUIRED DOCUMENT ORDER

Read these before implementing relevant gates:

1. `CLAUDE.md`
2. `brain/README.md`
3. `brain/TODO.md`
4. `docs/09-software/SALES-TEAM-ACCESS-CURRENT.md`
5. `docs/09-software/CLAUDE-SALES-PORTAL-START-PROMPT.md`
6. `docs/09-software/CLAUDE-SALES-AI-PILOT-CURRENT.md`
7. `docs/09-software/CLAUDE-DNC-RELEASE-ADDENDUM.md`
8. `docs/09-software/TOMORROW-OUTBOUND-PILOT-PREFLIGHT-CURRENT.md`
9. `docs/09-software/outbound-sales-brain-public-decision-maker-resolution-spec.md`
10. `docs/09-software/outbound-sales-brain-public-decision-maker-fixtures.v1.yaml`
11. `docs/09-software/outbound-sales-brain-public-contact-research-worker-contract.md`
12. `docs/09-software/outbound-sales-brain-contact-waterfall-spec.md`
13. `docs/09-software/outbound-sales-brain-contact-endpoint-quality-spec.md`
14. `docs/09-software/outbound-sales-brain-decision-maker-routing-spec.md`
15. `docs/09-software/outbound-sales-brain-phone-action-ui-spec.md`
16. `docs/09-software/outbound-sales-brain-human-manual-call-v1-spec.md`
17. `docs/09-software/outbound-sales-brain-global-phone-channel-eligibility-dnc-spec.md`
18. `docs/09-software/outbound-sales-brain-phone-screening-provider-interface-spec.md`
19. `docs/09-software/outbound-sales-brain-phone-channel-eligibility-fixtures.v1.yaml`
20. `docs/09-software/outbound-sales-brain-calcom-strategy-call-booking-spec.md`
21. `docs/09-software/outbound-sales-brain-single-sales-agent-operating-model.md`
22. `docs/09-software/outbound-sales-brain-sales-ai-first-60-seconds-playbook.md`
23. `docs/09-software/outbound-sales-brain-sales-ai-first-60-seconds-fixtures.v1.yaml`
24. `docs/09-software/outbound-sales-brain-shared-twilio-number-dual-service-spec.md`
25. `docs/09-software/outbound-sales-brain-demo-production-voice-mode-spec.md`
26. `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md`
27. relevant referenced data/RBAC/ownership/import/Market Miner/voice specs.

Do not reread every architecture file if the gate-specific documents are sufficient.

---

# 3. CURRENT CONTACT STRATEGY

Apollo is NOT a mandatory dependency.

Default contact mode is `PUBLIC_ONLY`.

Resolve decision-makers from approved public/first-party business sources first:

- company website/team/about/location pages;
- company schema/structured data;
- current public business registrations where appropriate;
- professional/business licensing records where appropriate;
- public business directories/associations with permitted use;
- company press/team/news pages;
- current publicly indexed business documents/search results.

Then resolve the best supported contact path:

- direct business phone if publicly supported;
- business email if publicly supported;
- extension if supported;
- otherwise verified main business line + named/role route.

Paid contact enrichment such as Apollo/equivalent is OPTIONAL and should be used only when campaign economics justify filling missing direct endpoints for high-value Accounts.

Never label a main/front-desk number as a person's direct number without evidence.

Never fabricate a person, title, mobile number, extension or email.

The Sales Portal must visually distinguish:

- Direct business line
- Main line — ask for named person
- Main line — ask for role
- Generic company/location line
- Phone research needed
- Do Not Call

---

# 4. GATE T0 — AUDIT CURRENT ENVIRONMENTS

Before coding, inspect the real systems.

## EdgeXpert

Audit:

- repository/package structure;
- current branch/worktree state;
- PostgreSQL availability/state;
- current services/processes/ports;
- reverse proxy/tunnel/DNS state;
- auth options;
- migration state;
- secrets handling;
- current prospect CSV/list assets if locally accessible;
- current contact/phone schema;
- existing suppression/DNC implementation;
- provider credentials/config references for research/contact/phone screening.

## Voice VPS

Audit the actually deployed demo/receptionist runtime:

- Twilio number/configuration;
- inbound webhook routing;
- current process supervisor/services;
- reverse proxy/routes;
- ConversationRelay/WebSocket implementation;
- current STT/TTS provider/config;
- realtime model/provider;
- interruption/barge-in handling;
- latency instrumentation;
- transfer/booking/tool primitives;
- health endpoints;
- logs/error behavior;
- reusable code vs demo-specific code.

Do not assume the isolated `phone-agent/` prototype is the same as the deployed receptionist. Inspect both.

Return concise findings and then proceed unless a real credential/external-account/business blocker exists.

---

# 5. GATE T1 — CANONICAL SALES DATA FOUNDATION

Implement/reconcile one durable data model for:

- Account;
- Location;
- Contact;
- PhoneEndpoint / EmailEndpoint;
- Evidence/provenance;
- ownership;
- activity/timeline;
- disposition;
- callback;
- suppression/DNC;
- import source identity;
- research job state;
- Booking;
- CallPack;
- ContactAttempt / CallSession / CallAttempt;
- RegistryScreenResult;
- ChannelEligibilityDecision;
- policy/version references.

Do not create a second parallel lead database.

A new source/import must not reset Account ownership, prior relationship, wrong-number state, DNC or screening history.

---

# 6. GATE T2 — REP PORTAL

Build the sleek internal portal intended for:

`sales.youraidepartment.ai`

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

Account phone/contact UI must follow:

`outbound-sales-brain-phone-action-ui-spec.md`

For V1 manual human calling:

```text
Open owned Account
-> Start Human Call
-> server-side HUMAN_MANUAL_CALL preflight
-> ALLOW: create ContactAttempt
-> return active tel: action
-> rep calls from device
-> return to persistent disposition UI
-> callback/email/opportunity/DNC
```

The rep's cell phone is transport only. YAD remains the system of record.

---

# 7. GATE T3 — SEED INVENTORY

Support controlled imports of current YAD lists into the canonical Account model.

Possible sources:

- Jacksonville/St. Augustine lists;
- prior CSVs;
- Airtable export from sales rep;
- Apollo exports if available;
- other approved internal prospect lists.

Import flow:

`normalize -> identity resolve -> suppression check -> Account/Contact upsert -> ownership check -> inventory`.

No automatic outreach on import.

Imported unknowns remain unknown. Do not relabel imported records as current advertisers, verified DMs or direct numbers without supporting evidence.

---

# 8. GATE T4 — PUBLIC DECISION-MAKER RESOLVER

Implement the public-first Decision Maker Resolver and Public Contact Research Worker.

For each sales-ready Account answer:

- who likely owns the problem/workflow?
- who is the current named person, if publicly supportable?
- what title/role evidence supports that?
- is there a direct business endpoint?
- if not, what verified main-line + role/name route should the rep use?

Keep role confidence and endpoint confidence separate.

A correct named-person/main-line route is better than a fabricated direct phone.

---

# 9. GATE T5 — MARKET MINER INVENTORY CONNECTION

Connect cached/shared inventory search first, then background mining/research.

Rep ZIP search must:

1. query existing PostgreSQL inventory immediately;
2. show available results;
3. optionally allow authorized `Research More`;
4. schedule server-side research without blocking UI;
5. dedupe into canonical Accounts.

Heavy mining/crawling stays on EdgeXpert/research workers, never the realtime voice process.

Do not DNC-screen every raw discovered company at full cost by default. Promote promising Accounts through staged phone screening when they become operationally relevant.

---

# 10. GATE T6 — SECURE INTERNAL DEPLOYMENT

Prepare secure internal exposure for `sales.youraidepartment.ai` using the safest practical existing environment path.

Requirements:

- HTTPS;
- authenticated users;
- server-side RBAC;
- no public PostgreSQL;
- no provider credentials in browser;
- process supervision;
- restart persistence;
- backup procedure;
- health endpoint.

---

# 11. GATE T7 — CAL.COM 15-MINUTE STRATEGY-CALL BOOKING

## Current product decision

Use **Cal.com as the booking authority**.

Connect it to Michael's real Microsoft 365 / Outlook calendar:

`michael@youraidepartment.ai`

Use **Cal Video** as the default meeting location.

Initial event type:

`YAD 15-Minute AI Strategy Call`

Do not create both a direct Outlook event and a Cal.com booking for the same meeting. Cal.com owns the booking lifecycle and synchronizes to Outlook.

Required behavior:

- check Cal.com real availability first;
- offer only returned slots;
- prefer a practical same-day slot when available;
- otherwise next-business-day / next suitable slots;
- usually offer two choices, not a long list;
- capture prospect name/email/timezone as required;
- create booking only after explicit agreement;
- include prospect as attendee;
- use Cal Video meeting link;
- write provider booking ID/time/status back to canonical Account/Opportunity/timeline;
- idempotency prevents duplicate bookings;
- if booking fails, never claim success; refresh or create human follow-up.

Build booking provider adapter so Cal.com specifics do not leak into core Account schema.

Human reps and Sales AI should use the same canonical booking tool.

---

# 12. GATE T8 — ONE CORE OUTBOUND SALES AI

Implement one core persona/profile:

`yad-sales-core-v1`

Do not create independent HVAC Sales AI, Roofing Sales AI, Law Sales AI, etc.

One core agent uses:

`YAD Sales doctrine`
+ `Company research`
+ `Vertical profile`
+ `Opportunity hypothesis`
+ `Decision-maker route`
+ `Observed paid-demand context`
+ `Relevant Sales Manual excerpts`
+ `Proof boundaries`
+ `Booking tools`.

Industry-specific context belongs in the CallPack.

Primary cold-call purpose:

1. reach correct decision-maker;
2. ask one researched business-process question;
3. listen/probe;
4. identify whether a real problem/opportunity exists;
5. book a 15-minute strategy call with Michael when warranted;
6. otherwise record correct next step/disqualification.

Do not sell a full undefined implementation on the first cold call.

Do not feature-dump.

Do not fabricate spend, ROI, CRM usage, missed-call rate, decision-maker identity, referrals or results.

Do not position AI as firing/replacing employees.

Use:

- `outbound-sales-brain-yad-sales-ai-core-script-v1.md`
- `outbound-sales-brain-sales-ai-first-60-seconds-playbook.md`
- `outbound-sales-brain-sales-ai-first-60-seconds-fixtures.v1.yaml`

The first minute should earn one useful process fact or correct route, not deliver a service pitch.

---

# 13. GATE T9 — REUSE THE RECEPTIONIST VOICE CORE

Michael wants to reuse the existing demo/receptionist voice technology rather than build a completely unrelated outbound audio stack.

Claude must inspect the deployed voice VPS and reuse proven infrastructure where practical:

- Twilio webhook/signature plumbing;
- ConversationRelay/WebSocket transport;
- STT/TTS configuration;
- interruption/barge-in behavior;
- speech pacing/pronunciation;
- session lifecycle;
- telemetry/latency measurement;
- transfer/tool dispatch primitives;
- health/process supervision.

Do **not** copy the receptionist/demo business prompt into the Sales AI.

The reusable layer is the voice engine/core. The Sales AI has its own prompt, CallPack, state machine and tools.

Carry forward lessons from the demos:

- 3–5 second conversational pauses are unacceptable;
- barge-in must stop speech quickly;
- do not repeat/reset after interruption;
- phone numbers must sound natural;
- act now when the caller/prospect wants action now;
- answer actual intent rather than restarting generic intake.

---

# 14. GATE T10 — SAME NUMBER, THREE EXPLICIT MODES

YAD may use the same approved Twilio number for demos, production inbound calls and outbound Sales AI caller ID.

But use separate logical runtimes/processes:

1. `DEMO_AI`
2. `PRODUCTION_INBOUND`
3. `PRODUCTION_OUTBOUND_SALES`

Michael should be able to choose the intended mode from an admin control plane without editing prompts/config by hand.

Recommended controls:

```text
Inbound Mode
  Production Receptionist
  Demo Runtime
  Human/Fallback

Outbound Sales AI
  Off
  Internal Test
  Controlled Pilot
  Policy Enabled

STOP NEW OUTBOUND CALLS
```

Outbound Calls API should explicitly point new outbound calls to the Sales AI route while using the same YAD caller ID.

Inbound callbacks continue through the inbound/receptionist path and can be routed using recent outbound Account context.

No active call may hot-swap prompts when Michael changes a mode.

A crash in outbound Sales AI should not automatically take down production inbound reception.

---

# 15. GATE T11 — PHONE SCREENING / DNC / CHANNEL ELIGIBILITY

Implement the global phone-channel architecture before any real autonomous prospect call.

Read:

- `CLAUDE-DNC-RELEASE-ADDENDUM.md`
- `outbound-sales-brain-global-phone-channel-eligibility-dnc-spec.md`
- `outbound-sales-brain-phone-screening-provider-interface-spec.md`
- `outbound-sales-brain-phone-channel-eligibility-fixtures.v1.yaml`
- `outbound-sales-brain-human-manual-call-v1-spec.md`

Architecture:

```text
PhoneEndpoint
-> YAD internal suppression first
-> required applicable screening adapters
-> normalized RegistryScreenResult(s)
-> deterministic ChannelEligibilityDecision
-> human action OR Twilio action
```

Rules:

- one canonical suppression history;
- new YAD DNC invalidates prior positive eligibility immediately;
- `ERROR`/`UNKNOWN` never becomes registry `NO_MATCH`;
- screening provider is abstracted behind normalized interface;
- screen operationally relevant endpoints rather than every raw scraped phone by default;
- rep ownership does not grant phone permission;
- Twilio must not receive an outbound request without current `AUTONOMOUS_AI_VOICE = ALLOW` for that exact endpoint/campaign/technology;
- human reps may use manual cell transport only when `HUMAN_MANUAL_CALL = ALLOW`;
- a rep cell cannot be used to bypass a YAD DNC or other human-channel restriction.

If required external registry/provider credentials are missing, report the exact blocker rather than inventing a successful screen.

---

# 16. DEFAULT SALES CONVERSATION SHAPE

The Sales AI should sound like a concise researched business-development person, not an AI demo.

Universal pattern:

`honest context -> one relevant question -> listen -> probe -> quantify only when supported -> position briefly -> next step`.

Example structure, not universal verbatim copy:

> Hey [Name], this is [Agent] with Your AI Department. Quick cold call — I'll keep it short. I came across you guys while looking at [claim-safe business context]. [one process question]

If a current paid-ad observation is relevant:

> I came across you while looking at companies advertising [service] in [market]. [one process question]

Do not infer ad spend, profitability, lead volume, or broken workflows from observing an ad.

If prospect is busy:

> Fair. Give me ten seconds and you can tell me whether I should disappear.

Only one save attempt. If they remain busy, ask for a better time or close.

If a real opportunity emerges:

> Based on what you just told me, I think it's worth putting you together with Michael for 15 minutes rather than trying to diagnose the whole thing on a cold call. Want me to see what he has open?

If yes, check Cal.com and offer two real slots.

---

# 17. TOMORROW AI COLD-CALL MICRO-PILOT

Use:

`TOMORROW-OUTBOUND-PILOT-PREFLIGHT-CURRENT.md`

as the operational release gate.

Implementation readiness alone does not authorize arbitrary autonomous dialing.

Before a real prospect pilot require:

- deterministic current `AUTONOMOUS_AI_VOICE = ALLOW` for every endpoint actually dialed;
- durable suppression/DNC;
- approved YAD caller ID;
- controlled campaign size;
- CallPack present;
- logging/QA present;
- Cal.com booking action tested;
- kill switch available;
- no unresolved critical roleplay/voice failures.

If a real-prospect gate is not ready, run the exact Sales AI + Cal.com path on internal/allowlisted participants first and keep human reps working separately eligible Accounts.

No model may override the deterministic eligibility decision.

Initial outbound concurrency should be 1.

For the first real pilot, use a very small reviewed HVAC Jacksonville/St. Augustine cohort rather than mixing many verticals.

After testing, report exactly one:

- `REAL_AI_PILOT_ELIGIBLE`
- `INTERNAL_AI_TEST_ONLY`
- `HUMAN_ASSIST_ONLY`

---

# 18. PILOT OUTCOMES

Successful outcomes include:

- correct decision-maker identified;
- meaningful problem discovered;
- 15-minute strategy call booked with Michael;
- specific requested callback;
- requested targeted email;
- correct no-need/disqualification;
- DNC honored immediately.

A booked meeting is not the only successful outcome.

Record exact prospect wording, relevant numbers they supply, current systems they state, objections, decision-maker corrections and next step.

---

# 19. HARD CONSTRAINTS

- Do not merge `main` without Michael's explicit approval.
- Do not re-enable automatic GitHub Actions.
- Do not manually dispatch CI unless explicitly requested.
- Do not commit secrets.
- Do not submit fake prospect/customer forms.
- Do not invent contact data.
- Do not make Apollo mandatory.
- Do not run heavy research workloads on realtime voice service.
- Do not create duplicate Cal.com + Outlook events.
- Do not claim a booking succeeded until Cal.com/provider confirms it.
- Do not create 30 independent Sales AI personalities.
- Do not share one mutable global prompt between demo, inbound and outbound services.
- Do not let demo interactions pollute production Account data.
- Do not spoof/rotate uncontrolled caller IDs.
- Do not expose registry/provider internals to ordinary reps.
- Do not let a rep's cell phone bypass a blocked human-call decision.
- Do not let Twilio bypass a missing/stale AI-voice eligibility decision.

---

# 20. REPORTING

After each meaningful gate, report:

- exact files changed;
- schema/migrations;
- services/processes changed;
- commands/tests run;
- test results;
- UI/manual verification where useful;
- security checks;
- credentials/config readiness;
- decision-maker/contact fill status;
- human manual-call preflight status;
- phone screening/provider status;
- AI eligibility status;
- DNC durability status;
- Cal.com status;
- voice latency/barge-in status;
- blockers requiring Michael;
- exact tomorrow release classification when applicable;
- next exact gate.

Do not ask Michael questions that a repo/server audit can answer.

---

# 21. CURRENT SUCCESS CONDITION

Near-term:

**EdgeXpert maintains a shared researched prospect pool; sales reps can securely browse/search a market, claim Accounts, see trustworthy decision-maker/contact paths, see the exact human/AI phone state, call/email/follow up, and book qualified prospects through Cal.com onto Michael's Outlook calendar with a Cal Video meeting link.**

Voice:

**The same YAD Twilio number can support an intentionally selected Demo AI, Production Inbound Receptionist, and one Production Outbound Sales AI, while the runtimes remain isolated and switchable.**

Pilot:

**The single Sales AI can use a researched CallPack, survive normal interruptions, carry a natural business conversation, and convert a legitimate opportunity into a confirmed 15-minute Cal.com strategy call with Michael — but only when the exact phone endpoint is currently eligible for that AI-voice action.**