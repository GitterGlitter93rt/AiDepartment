# Claude Code Handoff — Build the Your AI Department Outbound AI Sales Brain

**Implementation owner:** Claude Code on the EdgeXpert  
**Architecture authority:** `docs/09-software/outbound-ai-sales-brain-master-spec.md`  
**Production dialing:** MUST REMAIN DISABLED until explicitly approved by Michael after the acceptance gates pass.

---

# Your assignment

Implement the Outbound AI Sales Brain described in:

`docs/09-software/outbound-ai-sales-brain-master-spec.md`

Do not redesign the business/sales architecture from scratch. The architecture has already been decided. Your job is to inspect the current repo and existing phone/receptionist infrastructure, identify what can be reused, then implement and test the system in controlled phases.

---

# Read first

Before touching code, read in this order:

1. `CLAUDE.md`
2. `brain/README.md`
3. `brain/TODO.md`
4. `docs/09-software/outbound-ai-sales-brain-master-spec.md`
5. `docs/07-sales/training-manual/README.md`
6. `docs/07-sales/training-manual/module-01-sales-doctrine.md`
7. `docs/07-sales/training-manual/module-03-discovery-and-financial-diagnosis.md`
8. `docs/07-sales/training-manual/module-03b-crm-fundamentals-for-salespeople.md`
9. `docs/07-sales/training-manual/module-04a-cold-calling-and-prospecting.md`
10. `docs/07-sales/training-manual/module-04c-prospect-qualification-and-target-scoring.md`
11. `docs/07-sales/training-manual/module-05-hooks-and-opening-angles.md`
12. `docs/07-sales/training-manual/module-07-objection-handling.md`
13. `docs/07-sales/training-manual/module-10-hvac-industry-playbook.md`
14. `docs/07-sales/training-manual/module-11-plumbing-industry-playbook.md`
15. `docs/07-sales/training-manual/module-39-roleplay-academy.md`
16. `docs/07-sales/training-manual/module-40-sales-management-and-coaching.md`

Then inspect the existing Twilio/receptionist code, voice deployment files, and the current `phone-agent/` prototype branch.

---

# Important repository rule

The `phone-agent/` prototype was an architecture experiment created before this handoff.

Treat it as disposable/reusable code, NOT as the source of truth.

Audit every existing file against the master specification.

You may:

- keep good transport-level code;
- refactor it;
- replace it;
- delete obsolete prototype pieces;

but do not preserve bad architecture merely because code already exists.

---

# Do not do these things

- Do NOT enable production autonomous dialing.
- Do NOT call real prospects during development.
- Do NOT submit fake business leads/forms/appointments to test response times.
- Do NOT expose secrets in GitHub.
- Do NOT modify the production Astro website for this project unless a later explicit task requires it.
- Do NOT re-enable noisy automatic GitHub CI notifications while active development is occurring unless Michael requests it.
- Do NOT invent business pricing, offers, integrations, case studies, ROI, benchmarks, or capabilities.
- Do NOT replace the canonical Module 4C prospect score with an arbitrary AI-generated 0–100 score.
- Do NOT treat pixel detection as proof of active ads.
- Do NOT treat failure to detect a CRM as proof there is no CRM.
- Do NOT use the entire Sales Manual as the realtime prompt.
- Do NOT build all verticals before HVAC works.
- Do NOT allow an LLM to override the deterministic compliance/suppression engine.

---

# Phase 0 — audit before implementation

Start by producing a written audit in the repo or terminal output covering:

1. Where the existing Twilio/receptionist implementation lives.
2. What transport components are reusable.
3. What causes the current 3–5 second response delays reported in call testing, if identifiable.
4. How speech interruption/barge-in currently works.
5. How phone numbers are currently verbalized.
6. Which model/STT/TTS providers are currently in use.
7. Where the deployed `voice.youraidepartment.ai` service actually runs.
8. What persistence/storage exists today.
9. What CRM/calendar/SMS/email integrations already exist.
10. Whether the current prototype conflicts with the master spec.
11. Exact proposed component/file structure.
12. Exact local testing procedure.

Do not make architectural assumptions where inspection can answer the question.

---

# Phase 1 — canonical contracts + tests

Implement the core types/contracts first:

- Account
- Contact
- Lead Source
- Research Run
- Evidence Ledger record
- Prospect Research Card
- Canonical Module 4C score and Tier A–D
- Call Pack
- Compliance Decision
- Call
- Call Event
- Prospect Statement
- Opportunity
- Suppression
- Follow-Up Task
- QA Review
- Experiment Assignment
- Knowledge Snapshot

Write tests showing the exact Module 4C scoring model is reproduced.

Example fixture:

HVAC prospect with:

- confirmed active Google ads = +4
- confirmed active Meta ads = +3
- multiple paid channels = +1
- high-value economics = +2
- operationally important lead volume = +2
- 24/7 = +1
- appointment/estimate-heavy = +1
- multiple locations = +1
- visible growth = +1
- strong phone dependence = +1
- prominent CTA = +1

Expected raw score: 18
Expected tier: Tier A

Keep score reasons auditable.

---

# Phase 2 — research engine

Build adapter-based research with independent failure handling.

Minimum V1 adapters:

1. business identity
2. website crawler
3. CTA/lead-capture mapper
4. visible technology detector
5. CRM/system signal detector
6. Google ad research interface
7. Meta ad research interface
8. public web/Claude synthesis interface
9. growth/multi-location signal
10. decision-maker/public-role signal where permitted

Every result must become one or more Evidence Ledger records.

Use `CONFIRMED`, `LIKELY`, `UNKNOWN` exactly as described in the master spec.

No source failure is allowed to silently become a negative fact.

Research output must be testable on known public companies WITHOUT contacting them.

---

# Phase 3 — Sales Manual index and retrieval

Index `docs/07-sales/training-manual/**`.

Requirements:

- preserve file path and heading metadata;
- semantic chunks around headings;
- vertical metadata;
- topic metadata;
- hybrid lexical + semantic retrieval if practical;
- version/hash snapshot;
- deterministic fallback if vector infrastructure is unavailable.

Test these retrieval queries:

- HVAC after-hours missed call opener
- active Google advertiser hook
- already has CRM
- already has receptionist
- send me an email
- has marketing agency
- asks for guaranteed ROI
- asks whether a specific integration works
- do not contact

Inspect the retrieved text manually and write regression tests for obvious failures.

---

# Phase 4 — strategy / Call Pack

Build the pre-call strategy engine.

Inputs:

- research card
- evidence ledger
- canonical score/tier
- vertical
- manual retrieval
- campaign objective

Output must be compact and include:

- top confirmed facts
- top hypotheses
- primary hook
- backup hook
- honest opener
- first three diagnostic questions
- likely objections
- CRM/system positioning
- advertised offer/CTA if actually confirmed
- prohibited claims
- target next step
- available tools
- manual snapshot/version

Test that a `LIKELY` or `UNKNOWN` CRM/ad signal never appears in the Call Pack as a confirmed assertion.

---

# Phase 5 — text roleplay before telephony

Do NOT jump directly to phone calls.

Build a text/simulated conversation harness using the 20 personas in Module 39.

The system must demonstrate:

- honest opener
- one question at a time
- no long feature dump
- listens before pitching
- handles existing CRM positively
- protects existing employees
- does not attack agency/IT
- does not invent ROI
- verifies integration questions
- disqualifies no-pain prospect
- immediately honors DNC

Add QA scoring using Module 4A's 12 categories.

Create hard-fail assertions for:

- false familiarity/referral
- invented ad spend
- invented CRM/integration
- invented ROI/revenue loss
- guarantee
- employee replacement pitch
- continuing after DNC
- claiming a tool action succeeded when it failed

Do not move to telephony until the roleplay suite is consistently passing.

---

# Phase 6 — realtime voice benchmark

Use controlled internal/test phone numbers ONLY.

Benchmark several possible realtime model/STT/TTS configurations behind abstractions.

Do not assume the current provider stack is best.

Measure actual caller experience:

- answer-to-greeting latency
- end-of-user-speech to first-audio latency
- p50/p95 latency
- barge-in stop latency
- average response duration
- dropped/interrupted turn behavior
- transcript accuracy
- phone-number pronunciation

Product targets from the master spec:

- greeting target < 1.0s after usable human answer signal
- median first-audio response target < 1.0s
- p95 target < 1.5s
- barge-in stop target < 300ms

If those targets cannot be met, document the measured constraint before loosening them.

The reported 3–5 second dead-air behavior is unacceptable.

---

# Phase 7 — Twilio controlled integration

Implement/verify:

- Twilio outbound call placement
- webhook signature verification
- answer/voicemail handling
- ConversationRelay or alternative approved transport
- WebSocket lifecycle
- stream cancellation on interruption
- status callbacks
- controlled retry handling
- global kill switch
- strict allowlist in CONTROLLED_TEST mode

A production dial flag must default to false.

It should be difficult to accidentally dial a non-test number during development.

---

# Phase 8 — action tools

Implement deterministic action tools:

- add_do_not_contact
- book_strategy_call
- warm_transfer
- send_sms
- send_email
- create_human_followup
- crm_update
- retrieve_manual_guidance
- calculate_business_case
- end_call

Each action needs:

- validation
- success result
- explicit failure result
- retry policy where appropriate
- audit event

The agent may only claim completion after the tool returns verified success.

DNC writes must be synchronous and highest priority.

---

# Phase 9 — persistence + operations

Use durable storage for:

- accounts/contacts
- evidence
- research runs
- scores
- call packs
- compliance decisions
- calls/events
- prospect statements
- opportunities
- suppressions
- follow-up tasks
- QA reviews
- experiment variants
- knowledge snapshots

DNC/suppression must survive restarts/deployments.

Implement durable outbox/retry for CRM/follow-up writes.

---

# Phase 10 — HVAC controlled certification

Create a controlled HVAC test set containing examples of:

- Google advertiser + 24/7
- Meta advertiser
- multi-channel advertiser
- ServiceTitan signal
- no detectable CRM
- multi-location
- no strong public signals
- busy owner
- gatekeeper
- already has receptionist
- already has marketing agency
- asks for ROI guarantee
- asks for integration guarantee
- no meaningful pain
- DNC

Review Call Packs and simulated/test calls.

Acceptance goal before any pilot:

- average QA score >= 10/12
- zero unresolved hard fails
- measured latency acceptable
- DNC reliable
- bookings/transfers/follow-up actions reliable
- research claim discipline reliable

---

# Git workflow

During active development:

- work locally on the EdgeXpert;
- run tests locally first;
- keep automatic CI disabled unless explicitly requested;
- commit coherent milestones, not every tiny experiment;
- never commit secrets;
- use a dedicated feature branch;
- update the relevant `brain/` files when project state materially changes.

Do not merge to `main` without review.

---

# Required implementation quality

Do not call a phase complete merely because code exists.

For every phase report:

1. files changed
2. tests run
3. test results
4. manual verification performed
5. blockers
6. exact next action

If a dependency/API behavior is uncertain, verify it from official documentation before encoding assumptions.

---

# Final instruction

Build the smallest robust system that proves this loop:

`approved HVAC prospect → research → evidence → Tier score → Sales Manual retrieval → Call Pack → deterministic compliance → controlled Twilio call → natural low-latency discovery → action → structured CRM outcome → QA score`

Do not expand scope until this loop works repeatedly.
