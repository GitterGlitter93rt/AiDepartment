# Your AI Department — Claude Code Implementation Backlog

**Status:** Engineering backlog derived from architecture  
**Owner:** Claude Code  
**Constraint:** Execute under `outbound-sales-brain-implementation-gates.md`; local tests first; no automatic GitHub Actions; no real prospect dialing without explicit approval.

---

# EPIC 0 — AUDIT / RECONCILIATION

## 0.1 Read architecture/source authority

Acceptance:

- all required files from Claude handoff read;
- conflicts listed.

## 0.2 Audit existing `phone-agent/`

Determine:

- reusable transport/types
- obsolete prototype code
- security gaps
- persistence gaps.

## 0.3 Audit existing Twilio/receptionist runtime

Document:

- server/process
- Nginx/TLS/WebSocket
- current model/STT/TTS
- callbacks
- observed latency path.

## 0.4 Local development workflow

Document commands for:

- install
- typecheck
- test
- database
- worker
- local server.

No CI needed for normal checkpoint testing.

Deliverable: Gate 0 report.

---

# EPIC 1 — PROJECT STRUCTURE / CORE TYPES

## 1.1 Choose implementation module structure

Recommended logical modules:

- domain
- db
- geography
- mining
- providers
- research
- evidence
- scoring
- verticals
- strategy
- campaigns
- human-assist
- compliance
- voice
- tools
- post-call
- analytics.

## 1.2 Canonical enums/value objects

- confidence
- evidence state
- tri-state
- tier
- dispositions
- job states
- campaign modes.

## 1.3 Schema validation

Use runtime schemas for external/LLM/provider inputs.

Acceptance: compile + unit tests.

---

# EPIC 2 — POSTGRES / MIGRATIONS

## 2.1 Choose DB library/migration framework

Compatible with Node/TypeScript and EdgeXpert environment.

## 2.2 Identity tables

- Account
- Location
- Domain
- PhoneEndpoint
- Contact
- SourceIdentity
- aliases/relationships.

## 2.3 Research tables

- MiningJob
- Territory/SearchCell
- SearchTask/Observation
- ResearchRun
- Evidence
- ProviderUsage.

## 2.4 Strategy tables

- Score snapshot
- ResearchCompleteness
- OpportunityHypothesis
- OfferHypothesis
- CallPack.

## 2.5 Campaign/outreach tables

- Campaign
- membership
- lease
- Suppression
- ComplianceDecision
- ContactAttempt/Call/Event/Outcome
- FollowUp.

## 2.6 Operations

- jobs
- outbox
- audit
- system flags.

Acceptance: Gate 1.

---

# EPIC 3 — CLAIM REGISTRY / EVIDENCE ENGINE

## 3.1 Load `market-miner-claim-registry.v1.yaml`

Validate schema.

## 3.2 Evidence candidate validator

Reject:

- unsupported claim key
- invalid source
- missing provenance
- invalid confidence/state.

## 3.3 Evidence current read model

Handle:

- active
- stale
- contradicted
- superseded.

## 3.4 TTL/refresher

Mark evidence aging/stale without deleting history.

Acceptance: claim-registry fixtures/properties.

---

# EPIC 4 — MODULE 4C SCORING

## 4.1 Implement exact canonical score

No hidden points.

## 4.2 Score explanation

Every point -> EvidenceRecord(s).

## 4.3 Run fixture YAML

Acceptance: 100% arithmetic/tier fixture pass, Gate 2.

---

# EPIC 5 — VERTICAL PROFILE ENGINE

## 5.1 Validate/load HVAC profile

## 5.2 Validate/load Plumbing profile

## 5.3 Query taxonomy access

## 5.4 Hypothesis/hook/role/system lookup

## 5.5 Profile snapshot/version

Acceptance: Gate 3.

---

# EPIC 6 — GEOGRAPHY ENGINE

## 6.1 Import/reference U.S. geography

- states
- counties
- places
- CBSAs
- ZCTAs.

## 6.2 Territory resolver

Support:

- city
- county
- ZCTA
- CBSA
- radius.

## 6.3 SearchCell planner

## 6.4 Timezone mapping

## 6.5 Coverage/saturation records

Acceptance: print sensible Jacksonville/St. Augustine plans before paid API calls.

---

# EPIC 7 — DURABLE JOB SYSTEM

## 7.1 Job table/queue adapter

## 7.2 Leases/retries/dead letter

## 7.3 Fake provider jobs

## 7.4 Budget precheck

## 7.5 Campaign pause/supersede

Acceptance: worker restart test + no duplicate fake spend.

---

# EPIC 8 — SERP PROVIDER BENCHMARK

## 8.1 Revalidate current provider docs/pricing/terms

## 8.2 Implement temporary benchmark adapters

- DataForSEO candidate
- SerpApi candidate

## 8.3 Run HVAC gold query set

Jacksonville/St. Augustine.

## 8.4 Manual validation sample

## 8.5 Select routing strategy

Acceptance: provider benchmark report.

---

# EPIC 9 — GOOGLE ADVERTISER MINER

## 9.1 Provider production adapter

## 9.2 Three-pass query planner

## 9.3 Time/device sampling context

## 9.4 Paid observation parser

## 9.5 LSA/local sponsored parser

## 9.6 Advertiser strength compiler

## 9.7 Provider cost records

Acceptance: Gate 4.

---

# EPIC 10 — ENTITY RESOLUTION

## 10.1 Normalizers

- name
- domain
- phone
- address.

## 10.2 Strong-key matching

## 10.3 fuzzy/review candidate

## 10.4 multi-location

## 10.5 franchise/parent/aggregator

## 10.6 merge/unmerge

Acceptance: Gate 5 fixtures + manual audit.

---

# EPIC 11 — WEBSITE INTELLIGENCE

## 11.1 domain resolver

## 11.2 HTTP crawler

## 11.3 relevant-page planner

## 11.4 optional browser renderer

## 11.5 identity/service/CTA extraction

## 11.6 scripts/technology detector

## 11.7 leadership/hiring/location extraction

## 11.8 public lead-flow map

Acceptance: Gate 6 50-site review.

---

# EPIC 12 — CONTACT ENRICHMENT

## 12.1 first-party contact extraction

## 12.2 licensed provider adapter

## 12.3 role ranking from vertical profile

## 12.4 contact dedupe/staleness

## 12.5 cost attribution

Acceptance: manually reviewed high-priority sample.

---

# EPIC 13 — RESEARCH ORCHESTRATOR

## 13.1 ResearchRun orchestration

## 13.2 staged adapters/fan-in

## 13.3 deterministic extraction + LLM structured synthesis

## 13.4 conflict/evidence normalization

## 13.5 ResearchCompleteness

## 13.6 refresh planner

Acceptance: every material prospect fact traceable to source.

---

# EPIC 14 — OPPORTUNITY / OFFER ENGINE

## 14.1 Opportunity hypotheses

## 14.2 solution category vs commercial offer separation

## 14.3 no-sale/measure-first

## 14.4 current CommercialTruthSnapshot

Acceptance: worked examples from offer spec.

---

# EPIC 15 — CALL PACK

## 15.1 prompt/compiler input model

## 15.2 primary/backup hook selection

## 15.3 first questions/objection guidance

## 15.4 fact rendering/prohibited claims

## 15.5 immutable snapshot

Acceptance: 15 Call Pack cases, Gate 10 after RAG if needed; initial deterministic pack available for Human Assist earlier.

---

# EPIC 16 — CAMPAIGN / REPLENISHMENT

## 16.1 campaign state

## 16.2 ready inventory

## 16.3 low/high-water controller

## 16.4 query/cell saturation

## 16.5 queue priority

## 16.6 provider circuit breakers

Acceptance: target inventory fills/stops honestly.

---

# EPIC 17 — JACKSONVILLE/ST. AUGUSTINE MARKET MILESTONE

Run acceptance pack:

`HVAC + advertiser-first + Tier B+ + target 100`

Deliver:

- search plan
- provider cost/yield
- deduped Accounts
- score/tier
- evidence
- website intelligence
- Call Packs
- manual 20-prospect audit.

Acceptance: Gate 7.

---

# EPIC 18 — HUMAN ASSIST MVP

## 18.1 authenticated admin/rep user

## 18.2 campaign/prospect list

## 18.3 prospect detail/evidence/score

## 18.4 Call Pack view

## 18.5 lease/assignment

## 18.6 human outcome/follow-up

## 18.7 DNC

## 18.8 provider spend

Acceptance: Brent can work a controlled/test list, Gate 8.

---

# EPIC 19 — SALES MANUAL RAG

## 19.1 chunk/index

## 19.2 hybrid retrieval

## 19.3 CommercialTruthSnapshot precedence

## 19.4 gold tests

Acceptance: Gate 9.

---

# EPIC 20 — TEXT SALES ENGINE / ROLEPLAY

## 20.1 conversation state machine

## 20.2 prompt compiler

## 20.3 action mocks

## 20.4 roleplay simulator

## 20.5 QA grader

## 20.6 critical roleplay YAML

Acceptance: Gate 11.

---

# EPIC 21 — COMPLIANCE SOFTWARE ENGINE

Implement policy interfaces/fixtures with autonomous cold AI still disabled by default.

Acceptance: Gate 12.

---

# EPIC 22 — REALTIME VOICE BENCHMARK

Benchmark STT/LLM/TTS/endpointing with fake/test conversations.

Acceptance: Gate 13.

---

# EPIC 23 — TWILIO CONTROLLED TEST

- signed webhooks/WSS
- allowlist
- AMD benchmark
- streaming/barge-in
- kill switch.

Acceptance: Gate 14.

---

# EPIC 24 — ACTION TOOLS / CRM

- DNC
- booking
- follow-up
- email/SMS policy
- transfer
- CRM/outbox
- calculator.

Acceptance: Gate 15.

---

# EPIC 25 — AUDIO CERTIFICATION

Run critical roleplays through actual voice.

Acceptance: Gate 16.

---

# EPIC 26 — STOP FOR APPROVAL

Before any real autonomous prospect:

Present:

- gates
- Market Miner quality
- compliance state
- latency/QA
- costs
- recommended micro-pilot.

Do not proceed until Michael explicitly approves.
