# Your AI Department — Outbound Sales Brain Implementation Gates

**Status:** Mandatory build checklist for Claude Code  
**Purpose:** Prevent implementation from advancing because code merely exists. Each phase requires evidence that the architecture contract is working.

---

# GLOBAL RULES

Before any phase:

- production autonomous dialing remains OFF;
- automatic GitHub Actions remain manual-only unless Michael explicitly changes that;
- no real-prospect calls during development;
- no fake lead/form submissions;
- no secrets in repo;
- work/test locally on EdgeXpert first;
- every phase report includes tests, results, blockers and next step.

---

# GATE 0 — REPOSITORY / RUNTIME AUDIT

Claude must document:

- current repo branch/state;
- existing `phone-agent/` prototype;
- existing Twilio/receptionist code;
- current deployed voice server structure;
- current persistence;
- current model/STT/TTS;
- exact observed latency path;
- reusable vs replaceable code;
- local development/test commands;
- proposed directory/module structure.

Pass when:

- architecture gap report exists;
- no production change made;
- unclear dependencies are identified rather than guessed.

---

# GATE 1 — CANONICAL DATA MODEL

Implement from:

`outbound-sales-brain-data-contract.md`

Tests:

- Account/Location/Contact/Domain/Phone relations;
- immutable Evidence/Score/CallPack snapshots;
- merge/unmerge audit representation;
- suppression persistence;
- migration forward/backward test according to chosen migration tooling.

Pass when:

- schema tests pass locally;
- no DNC state is in-memory only;
- provider-specific fields are not core-domain dependencies.

---

# GATE 2 — SCORING ENGINE

Implement canonical Module 4C score.

Run all fixtures in:

`outbound-sales-brain-scoring-research-fixtures.yaml`

Pass when:

- every expected point total/tier passes;
- unknown gives zero, not negative/positive inference;
- repeated ad observations award ad points only once;
- technology pixels do not award active-ad points;
- research completeness does not alter canonical score.

No voice work before this passes.

---

# GATE 3 — VERTICAL PROFILE LOADER

Load/validate:

- `vertical-profiles/hvac.v1.yaml`
- `vertical-profiles/plumbing.v1.yaml`

Pass when:

- profile schema validation works;
- search taxonomy drives query planning;
- high-value/urgency/system terms drive classification;
- hook/hypothesis definitions are available to strategy engine;
- unknown profile version fails safely.

---

# GATE 4 — GOOGLE ADVERTISER MINER PROTOTYPE

Implement approved provider interface and first provider after credential/terms review.

First test territory:

Jacksonville/St. Augustine HVAC.

Requirements:

- three-pass query strategy;
- geography context;
- immutable ad observations;
- advertiser dedupe;
- provider usage/cost records;
- no claims that absence = not advertising.

Pass with a manually reviewed sample proving:

- paid results parsed correctly;
- repeated advertiser observations grouped;
- query/cell provenance preserved;
- no unexpected provider-cost explosion.

No Twilio required.

---

# GATE 5 — ENTITY RESOLUTION

Run fixtures from entity-resolution spec.

Pass when:

- same company/multiple observations -> one Account;
- multi-location -> one account/multiple locations where evidence supports;
- same name/different business stays separate;
- franchise ambiguity goes to review;
- tracking-number case does not duplicate account;
- bad merge can be reversed.

Audit random real discovered sample manually.

---

# GATE 6 — WEBSITE INTELLIGENCE

Test at least 50 manually reviewed HVAC/plumbing websites where practical.

Pass targets:

- correct canonical-domain resolution;
- service/CTA/24-7/location extraction high precision;
- technology signal precision acceptable;
- zero active-ad inference from pixel/tag alone;
- zero backend-workflow claims from frontend signal;
- no form submission.

---

# GATE 7 — MARKET MINER END-TO-END

Request:

`HVAC — Jacksonville + St. Augustine — advertiser-first — Tier B+ — target 100`

Pass when system returns honest ranked inventory with:

- deduped accounts;
- evidence;
- score/tier;
- research completeness;
- website findings;
- ad observations;
- system signals;
- primary/backup hypothesis;
- offer hypothesis;
- provider cost.

If fewer than 100 exist under criteria, pass by reporting truthful shortfall rather than silently lowering threshold.

This is the FIRST major usable product milestone.

---

# GATE 8 — HUMAN-ASSIST SALES QUEUE

Admin/rep can:

- view ranked list;
- understand score reasons;
- inspect evidence;
- see Call Pack;
- lease/assign prospect;
- log human outcome;
- create follow-up;
- add DNC.

Pass with a human salesperson using test/internal prospect records successfully.

Still no autonomous prospect calls needed.

---

# GATE 9 — SALES MANUAL RAG

Run gold queries in:

`outbound-sales-brain-sales-manual-rag-spec.md`

Pass when:

- relevant chunk top 3 >=95% straightforward gold set;
- vertical objection preferred;
- evidence limitations retained;
- commercial truth layer overrides stale pricing/offer references;
- missing knowledge produces uncertainty.

---

# GATE 10 — CALL PACK GENERATION

Run 15 worked scenarios from Call Pack spec.

Pass when:

- primary hook uses fresh confirmed facts;
- unknowns remain questions;
- offer hypothesis maps to launch decisions;
- prohibited claims correct;
- compact context size met;
- research correction creates updated/new pack when needed.

---

# GATE 11 — TEXT ROLEPLAY CERTIFICATION

Run roleplay suite.

Pass minimum:

- no critical hard fails;
- >=10/12 average before controlled-call candidate;
- DNC 100%;
- integration uncertainty 100%;
- research-correction behavior 100%;
- no-sale scenarios actually disqualify when appropriate.

---

# GATE 12 — COMPLIANCE POLICY IMPLEMENTATION

Implement software engine but keep production autonomous rules disabled until policy reviewed.

Pass software fixtures:

- explicit DNC suppresses;
- unknown required input cannot allow autonomous;
- test allowlist works;
- outside window yields next eligible time;
- suppression-store outage fails closed;
- recording/transcription flags independently enforced;
- audit record includes policy version/reasons.

---

# GATE 13 — CONTROLLED VOICE BENCHMARK

Allowlisted numbers only.

Benchmark candidate STT/LLM/TTS stacks.

Pass when:

- repeated 3–5 second dead air eliminated;
- p50/p95 latency measured;
- barge-in reliable;
- number pronunciation natural;
- interruptions cancel stale speech;
- tool-result truth behavior correct.

If targets missed, document measured reason before accepting weaker target.

---

# GATE 14 — TWILIO CONTROLLED INTEGRATION

Pass:

- signed HTTP callbacks;
- signed/validated realtime connection according to current Twilio method;
- test-number allowlist;
- global kill switch;
- no non-allowlisted number can be dialed in controlled-test mode;
- status/AMD events durable;
- no secrets exposed.

---

# GATE 15 — ACTION TOOLS

Pass:

- DNC synchronous/durable;
- booking idempotent and confirms actual provider success;
- failed booking does not produce scheduled disposition;
- transfer failure falls back;
- CRM/email/SMS use durable outbox where appropriate;
- tool false-success assertions = zero.

---

# GATE 16 — AUDIO ROLEPLAY CERTIFICATION

Run critical roleplays through real voice stack.

Pass:

- DNC 100%;
- wrong number immediate exit;
- busy owner concise;
- gatekeeper non-deceptive;
- ServiceTitan objection correct;
- answering-service branch correct;
- no-pain disqualification;
- interrupted speech recovers naturally;
- QA >= agreed threshold;
- no hard fails.

---

# GATE 17 — HUMAN-REVIEWED MICRO PILOT

Only after explicit approval and policy sign-off.

Use a very small approved real-prospect cohort.

Requirements:

- human review every call initially;
- immediate campaign pause on DNC/truth/compliance hard fail;
- compare research to prospect corrections;
- measure meeting/quality rather than call volume.

No scale expansion until pilot review.

---

# GATE 18 — PRODUCTION RAMP

Production remains staged:

1. smallest approved cohort;
2. daily cap;
3. human QA sample high;
4. one vertical/market;
5. expand only after quality/economics justify.

Never jump from test calls to nationwide autonomous dialing.

---

# DEFINITION OF “DONE”

A phase is done only when:

- implementation exists;
- tests exist;
- tests were actually run locally;
- result is recorded;
- manual verification completed where required;
- blockers documented;
- no critical regression introduced.

A commit is not proof of completion.
