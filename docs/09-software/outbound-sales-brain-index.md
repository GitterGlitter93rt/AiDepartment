# Your AI Department — Prospect Factory / Outbound Sales Brain Architecture Index

**Status:** Start here  
**Architecture owner:** ChatGPT  
**Implementation owner:** Claude Code  
**Business owner:** Michael Chanata  
**Branch:** `feature/outbound-sales-brain`

---

# 1. WHAT THIS SYSTEM IS

The system is a prospect factory first and a phone agent second.

Canonical business flow:

`Market / Geography`
-> `Google advertiser-first discovery`
-> `Business identity / dedupe`
-> `Independent website / public research`
-> `Evidence ledger`
-> `Module 4C YAD score / Tier A-D`
-> `Opportunity + current YAD offer hypothesis`
-> `Sales Manual retrieval`
-> `Call Pack`
-> `Human Assist first`
-> `Compliance gate`
-> `Controlled/reviewed realtime voice later`
-> `CRM outcome / follow-up`
-> `QA / analytics / learning`

The architecture is deliberately designed so Market Miner can create business value before autonomous prospect calling exists.

---

# 2. SOURCE-OF-TRUTH ORDER

## Company/commercial truth

`docs/00-company/launch-decisions.md`

## Sales doctrine

`docs/07-sales/training-manual/**`

## Architecture

The files in this index.

## Implementation

Code only after it has been reconciled against the architecture/source-of-truth documents.

The existing `phone-agent/` prototype is not architectural authority.

---

# 3. START HERE — CLAUDE

Read:

1. `outbound-ai-sales-brain-claude-handoff.md`
2. `outbound-sales-brain-implementation-gates.md`
3. `outbound-ai-sales-brain-master-spec.md`

Then read the specialized specs below before implementing their corresponding gate.

Claude's first action is Gate 0 audit, not coding the dialer.

---

# 4. CORE ARCHITECTURE

## `outbound-ai-sales-brain-master-spec.md`

Full system mission, logical brains, end-to-end pipeline, operating modes, research/evidence doctrine, call state machine, tools, QA, security, build phases, production gates.

## `outbound-ai-sales-brain-claude-handoff.md`

Current engineering order. Market Miner comes first; Twilio/realtime voice comes later.

## `outbound-sales-brain-implementation-gates.md`

Mandatory Gate 0–18 acceptance sequence. A phase is not done merely because code exists.

## `outbound-sales-brain-architecture-backlog.md`

Architecture work status and remaining refinement tasks.

---

# 5. MARKET MINER

## `market-miner-prospect-factory-spec.md`

Overall prospect-factory design: territory, discovery, enrichment, scoring, opportunity classification, inventory/replenishment.

## `market-miner-geography-engine-spec.md`

State/county/city/CBSA/ZCTA/radius/search-cell planning, coverage, saturation, timezone and geographic fixtures.

## `market-miner-provider-blueprint.md`

Provider roles and current recommended hierarchy.

## `market-miner-provider-benchmark-plan.md`

How Claude must benchmark DataForSEO/SerpApi/etc. on actual Jacksonville/St. Augustine HVAC use before locking provider routing.

## `google-advertiser-miner-search-matrix.md`

Google advertiser query families, three-pass search strategy, query budgeting, paid observation model, advertiser confidence and saturation logic.

## `market-miner-entity-resolution-spec.md`

Account/location/domain/phone/contact identity resolution, DBAs, franchises, tracking numbers, aggregators, merge/unmerge and duplicate-outreach prevention.

## `market-miner-website-intelligence-spec.md`

Website crawl/fetch policy, service/CTA/24-7/financing/location/hiring/decision-maker extraction, technology signals, lead-flow mapping, and no-fake-form rule.

## `market-miner-jacksonville-staugustine-hvac-acceptance-pack.md`

First actual Market Miner acceptance milestone: Jacksonville + St. Augustine HVAC, advertiser-first, Tier B+, target 100, manual audit and provider economics.

---

# 6. CANONICAL DATA / SCORING

## `outbound-sales-brain-data-contract.md`

Canonical Account, Location, Contact, Domain, Phone, SourceIdentity, Evidence, Score, Call Pack, Campaign, Compliance, Call, Outcome, QA, ProviderUsage and other core objects.

## `outbound-sales-brain-scoring-research-fixtures.yaml`

Executable/spec test fixtures for Module 4C score arithmetic and claim-discipline traps.

Important invariant:

Research completeness and compliance are separate from YAD fit score.

---

# 7. VERTICAL INTELLIGENCE

## `vertical-profile-schema.md`

Reusable machine-readable industry-profile contract.

## `vertical-profiles/hvac.v1.yaml`

HVAC profile — Vertical Priority 1.

## `vertical-profiles/plumbing.v1.yaml`

Plumbing profile — Vertical Priority 2.

These profiles derive from the canonical Sales Manual and do not replace it.

---

# 8. OPPORTUNITY / OFFER / STRATEGY

## `outbound-sales-brain-offer-selection-spec.md`

How the system separates a problem/solution hypothesis from the current approved commercial wrapper. Includes no-sale/measure-first behavior.

## `outbound-sales-brain-call-pack-spec.md`

Canonical compact prospect context plus 15 worked scenarios.

## `outbound-sales-brain-sales-manual-rag-spec.md`

How to index/retrieve the Sales Manual, keep evidence limitations together, preserve commercial truth, and support low-latency live retrieval.

---

# 9. CAMPAIGN / HUMAN ASSIST / CRM

## `outbound-sales-brain-campaign-replenishment-spec.md`

Campaign states, ready inventory, low/high water, queue priority, advertiser-first mode, search yield, saturation, provider budgets and replenishment loop.

## `outbound-sales-brain-admin-control-plane-spec.md`

Internal dashboard/control plane, Market Miner view, evidence inspector, score explainer, Human Assist queue for Brent/reps, provider spend, suppression and QA.

## `outbound-sales-brain-crm-followup-spec.md`

CRM stages, dispositions, notes, ProspectStatements, research corrections, follow-up tasks, booking, outbox/retry and duplicate-outreach prevention.

---

# 10. COMPLIANCE / SECURITY

## `outbound-sales-brain-compliance-engine-spec.md`

Deterministic policy-engine contract. Software architecture only; autonomous AI cold-prospect rules remain disabled/review-required until formal policy review.

## `outbound-sales-brain-security-operations-spec.md`

Authentication, authorization, secrets, multi-gate dial enablement, durable DB/queue, idempotency, redaction, media retention, backup, monitoring, SLOs and release gates.

---

# 11. VOICE / QA

## `outbound-sales-brain-realtime-voice-policy.md`

Turn-taking, first-audio latency, endpointing, partial STT, barge-in, repetition, number/email/date/currency verbalization, voicemail, tool failure and benchmark requirements.

## `outbound-sales-brain-roleplay-certification-spec.md`

25+ behavioral scenarios, hard fails, 12-point Sales Manual scorecard, text/audio/control-test certification levels.

---

# 12. ANALYTICS / LEARNING

## `outbound-sales-brain-analytics-learning-spec.md`

Event taxonomy, Market Miner quality, source/hook/tier performance, provider economics, voice latency, QA, experiments, sample-size caution and future learned propensity model.

V1 is analytical/human-reviewed; it does not autonomously rewrite production prompts or score rules.

---

# 13. FIRST BUILD ORDER

Claude should implement in this order:

1. Gate 0 audit.
2. Canonical DB/data model.
3. Module 4C scoring + vertical loader.
4. Geography/mining job planner.
5. Google advertiser provider benchmark + first adapter.
6. Entity resolution.
7. Website intelligence.
8. Evidence/research/offer/Call Pack generation.
9. Jacksonville/St. Augustine HVAC Market Miner acceptance.
10. Human Assist UI/workflow.
11. Sales Manual RAG.
12. Text roleplay/QA.
13. Compliance software.
14. Realtime voice benchmark.
15. Controlled Twilio integration.
16. Action tools/CRM durability.
17. Audio certification.
18. Stop for explicit approval before any real-prospect autonomous pilot.

---

# 14. FIRST PRODUCT DEFINITION

The first thing YAD should be able to use is:

> “Give Brent the best researched HVAC prospects in Jacksonville/St. Augustine today, ranked in order, show why each is worth calling, what ad/service signal we saw, what the website/system looks like, what we think the opportunity may be, and exactly what question to ask first.”

That product is useful before an AI places a single prospect call.

---

# 15. NON-NEGOTIABLE RULES

- no fake lead/form submissions
- no invented ad spend
- no invented revenue/ROI
- no active-ad claim from pixel/tag alone
- no “no CRM” claim from failed detection
- no duplicate account because several searches found it
- no attacking existing employees/CRM/IT/agency
- no secret leakage
- no in-memory-only DNC
- no unauthenticated public dial control
- no automatic GitHub CI spam during active development
- no autonomous production prospect dialing without explicit approval and passed gates
