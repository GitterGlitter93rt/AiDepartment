# Your AI Department — Prospect Factory / Outbound Sales Brain Architecture V1 Status

**Date:** 2026-09-02  
**Status:** V1 architecture ready for Claude Gate 0 implementation audit  
**Production autonomous calling:** Disabled / not approved

---

# COMPLETED ARCHITECTURE AREAS

## Product / system

- Market Miner-first architecture
- Human Assist before autonomous voice
- source-of-truth hierarchy
- implementation gates
- Claude engineering backlog
- first-market launch/acceptance plan.

## Prospect discovery

- advertiser-first Google search strategy
- search query matrix
- city/county/ZCTA/radius geography
- time/device sampling
- provider abstraction
- provider benchmark plan
- source retention model
- advertiser evidence-strength ranking.

## Research

- first-party website intelligence
- contact/decision-maker enrichment
- deterministic + LLM research orchestration
- claim registry
- evidence provenance/confidence/state
- research completeness
- stale/contradicted evidence
- source corrections.

## Identity

- Account/Location/Domain/Phone/Contact separation
- duplicate resolution
- DBAs/franchises/parent brands
- aggregators/lead generators
- reversible merge/unmerge
- duplicate outreach prevention.

## Scoring / verticals

- exact Module 4C canonical scoring
- corrected fixtures
- HVAC machine profile
- Plumbing machine profile
- profile governance for later industries
- advertiser strength separate from fit score.

## Sales strategy

- opportunity hypotheses
- solution category vs commercial offer separation
- current offer selection
- CommercialTruthSnapshot
- Call Pack schema/examples
- Sales Manual RAG
- prompt authority/compiler.

## Financial diagnosis

- source labels
- exposure vs recovery vs measured ROI
- missed-call/estimate/capacity/ads/reactivation calculators
- deterministic calculation tool.

## Human workflow / CRM

- Human Assist operating flow
- CRM stages/dispositions/notes
- requested callback priority
- durable follow-up/outbox
- research corrections
- DNC/suppression.

## Conversation / QA

- explicit state machine
- priority interrupts
- primary/backup hypothesis rules
- roleplay certification
- machine-readable critical scenarios
- 12-point QA grader + hard fails
- no-sale as valid passing outcome.

## Voice / telephony

- realtime voice UX policy
- realtime provider benchmark plan
- Twilio provider/ConversationRelay architecture
- AMD benchmark requirements
- streaming/barge-in/number speech
- test allowlist and signed webhook/WSS requirements.

## Compliance

- deterministic compliance decision architecture
- policy/version/audit model
- federal/state/contact-basis/line-type review template
- autonomous cold AI voice default disabled/review-required
- recording/transcription separation.

## Security / operations

- auth/RBAC
- server-side secrets
- multi-gate dial enablement
- global kill switch
- durable DB/jobs/leases/idempotency
- API contracts
- storage/indexing
- privacy/retention
- incident response
- local safe testing/no automatic Actions.

## Analytics / economics

- event taxonomy
- Market Miner data-quality SLOs
- source/query/hook/tier metrics
- provider economics
- full unit economics
- future learned propensity separated from canonical score.

## Interoperability

- Apollo/CSV/CRM import reconciliation
- provider-neutral contact/search/telecom/CRM interfaces
- exports with audit/license controls.

---

# INTENTIONALLY DEFERRED TO IMPLEMENTATION / REVIEW

These are not missing architecture; they need measured environment/provider/policy input.

1. Exact DB/query/migration library after Gate 0 EdgeXpert audit.
2. Exact job queue technology after Gate 0.
3. Final SERP provider routing after provider benchmark.
4. Final contact provider configuration/credits.
5. Final realtime LLM/STT/TTS stack after controlled benchmark.
6. ConversationRelay vs alternative Twilio transport after latency testing.
7. Formal autonomous outbound legal/company policy per jurisdiction/contact basis.
8. Final external CRM vendor projection.
9. National geographic expansion allocation.
10. Learned score/optimizer after sufficient real outcomes.
11. Additional vertical YAML profiles after HVAC/Plumbing prove schema.

Claude should surface these at their defined gate rather than making silent product decisions.

---

# FIRST IMPLEMENTATION PROOF

The first real engineering/business proof is NOT a cold AI call.

It is:

> Produce an evidence-backed, deduplicated, ranked HVAC prospect inventory for Jacksonville + St. Augustine, prioritizing fresh Google advertisers, with accurate websites/phones, Module 4C scoring, research completeness, advertiser evidence strength, opportunity/offer hypotheses, Call Packs, source provenance and provider cost — then pass the manual quality audit without contacting any prospect.

Target ready inventory: 100 Tier B+ if the market genuinely contains 100 under the selected criteria.

Truthful shortfall is correct behavior.

---

# SECOND IMPLEMENTATION PROOF

Brent/Human Assist can work the ranked queue without manually researching every business from scratch.

The system captures:

- outcome
- decision-maker
- research correction
- problem
- systems
- numbers/source
- next action
- DNC.

This creates real labeled data for later AI voice work.

---

# THIRD IMPLEMENTATION PROOF

Only after Human Assist/roleplay/compliance software:

Use controlled allowlisted test numbers to benchmark and certify realtime voice.

No real prospect autonomous calls yet.

---

# STOP CONDITION BEFORE REAL AUTONOMOUS OUTREACH

Claude must stop after technical/audio certification and present:

- completed gate evidence
- compliance policy state
- Market Miner quality
- QA/hard-fail rates
- latency
- provider/unit economics
- proposed micro-pilot cohort.

Michael must explicitly approve moving to a real autonomous prospect pilot.

---

# CURRENT START FILE

Claude should start with:

`docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md`

and execute Gate 0 only.

Architecture additions after this point should primarily address real implementation discoveries, provider changes, policy review, or observed sales/quality failures rather than speculative expansion.
