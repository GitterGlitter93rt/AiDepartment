# OUTBOUND SALES BRAIN V1 — CURRENT ARCHITECTURE MANIFEST

**THIS IS THE CURRENT START FILE FOR CLAUDE CODE.**  
**Updated:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Architecture owner:** ChatGPT  
**Implementation owner:** Claude Code on the EdgeXpert  
**Business owner:** Michael Chanata

If an older architecture index/handoff has a shorter document list, use this manifest as the current navigation authority.

---

# 1. WHAT WE ARE BUILDING

The core product is a **Prospect Factory / Market Miner**, not merely an AI dialer.

The system must answer:

> Who should YAD contact next, why are they worth contacting, what do we actually know about them, what business problem is worth investigating, and what should the first question be?

Canonical flow:

`Territory`
-> `Google advertiser-first discovery`
-> `Identity resolution / dedupe`
-> `Website / business / contact research`
-> `Evidence ledger`
-> `YAD Module 4C score / Tier A-D`
-> `Advertiser evidence strength`
-> `Vertical / business-context routing`
-> `Opportunity hypothesis`
-> `Solution category`
-> `Current commercial offer mapping`
-> `Sales Manual strategy`
-> `Call Pack`
-> `Human Assist`
-> `Compliance gate`
-> `Controlled realtime voice later`
-> `CRM / follow-up`
-> `QA / analytics / learning`.

---

# 2. NON-NEGOTIABLE BUILD ORDER

1. Claude Gate 0 audit.
2. Persistent domain/data model.
3. Claim registry + evidence engine.
4. Exact Module 4C score.
5. Vertical profile registry/loader — implement HVAC/Plumbing first.
6. Geography/search-cell planner.
7. Durable jobs/workers.
8. Google advertiser provider benchmark.
9. Google advertiser miner.
10. Entity resolution.
11. Website intelligence.
12. Contact enrichment.
13. Research orchestration.
14. Opportunity/offer/Call Pack generation.
15. Jacksonville/St. Augustine HVAC Gate 7 acceptance.
16. Human Assist MVP for Brent.
17. Sales Manual RAG.
18. Text conversation/roleplay/QA.
19. Compliance software.
20. Realtime provider benchmark.
21. Controlled Twilio integration.
22. Action tools/CRM durability.
23. Audio certification.
24. STOP for explicit approval before any real autonomous prospect pilot.

The expanded Roofing/Collision/PDR-Hail/Law/Real-Estate profiles are architecture-ready, but Claude must not delay the HVAC/Plumbing proof loop to implement every vertical at once.

Production autonomous cold AI voice remains disabled/review-required until explicit approval and policy/gates.

---

# 3. PROJECT / COMMERCIAL AUTHORITIES

Read first:

- `CLAUDE.md`
- `brain/README.md`
- `brain/TODO.md`
- `brain/PHONE-AGENT.md`
- `docs/00-company/launch-decisions.md`
- `docs/07-sales/training-manual/README.md`

Commercial truth from launch decisions overrides older sales-training references.

---

# 4. PRIMARY EXECUTION DOCUMENTS

Claude must read:

- `docs/09-software/outbound-ai-sales-brain-master-spec.md`
- `docs/09-software/outbound-ai-sales-brain-claude-handoff.md`
- `docs/09-software/outbound-sales-brain-implementation-gates.md`
- `docs/09-software/outbound-sales-brain-claude-implementation-backlog.md`
- `docs/09-software/outbound-sales-brain-architecture-v1-release-checklist.md`
- `docs/09-software/outbound-sales-brain-consistency-decisions.md`

When an older handoff omits a newer spec listed in THIS manifest, the newer spec still applies at its corresponding gate.

---

# 5. MARKET MINER — CORE

- `market-miner-prospect-factory-spec.md`
- `market-miner-geography-engine-spec.md`
- `market-miner-provider-blueprint.md`
- `market-miner-provider-benchmark-plan.md`
- `google-advertiser-miner-search-matrix.md`
- `google-advertiser-observation-sampling-spec.md`
- `market-miner-advertiser-evidence-strength-spec.md`
- `market-miner-entity-resolution-spec.md`
- `market-miner-website-intelligence-spec.md`
- `market-miner-contact-enrichment-spec.md`
- `market-miner-research-orchestration-spec.md`
- `market-miner-lead-import-export-spec.md`
- `market-miner-data-quality-slo-spec.md`
- `market-miner-jacksonville-staugustine-hvac-acceptance-pack.md`
- `market-miner-claim-registry.v1.yaml`

---

# 6. DATA / STORAGE / JOBS / APIs

- `outbound-sales-brain-data-contract.md`
- `outbound-sales-brain-storage-indexing-spec.md`
- `outbound-sales-brain-job-queue-spec.md`
- `outbound-sales-brain-service-api-contracts.md`
- `outbound-sales-brain-local-development-test-spec.md`

Normative clarification:

- evidence confidence = confirmed / likely / unknown;
- evidence lifecycle state = active / aging / stale / contradicted / superseded;
- three-state fact semantics = yes / no_confirmed / unknown;
- failed detection is normally unknown.

---

# 7. SCORING / VERTICAL INTELLIGENCE

Core:

- `outbound-sales-brain-scoring-research-fixtures.yaml` — use v1.0.1+ corrected fixture arithmetic.
- `vertical-profile-schema.md`
- `vertical-profile-generation-process.md`

Machine profiles currently defined:

- `vertical-profiles/hvac.v1.yaml`
- `vertical-profiles/plumbing.v1.yaml`
- `vertical-profiles/roofing.v1.yaml`
- `vertical-profiles/collision-repair.v1.yaml`
- `vertical-profiles/pdr-hail.v1.yaml`
- `vertical-profiles/law-firms.v1.yaml`
- `vertical-profiles/real-estate-brokerages.v1.yaml`

Cross-vertical control:

- `outbound-sales-brain-vertical-router-spec.md`
- `outbound-sales-brain-vertical-router-fixtures.v1.yaml`
- `outbound-sales-brain-cross-vertical-intelligence-v1.md`

Router invariants:

- one Account may have multiple vertical assignments;
- campaign context chooses the active research/search/hook profile;
- secondary profiles never create duplicate Accounts;
- account-wide DNC/contact history applies across every vertical;
- law ad language is practice-area specific;
- collision and PDR/hail context remain distinct;
- professional/safety boundaries can only become more restrictive when profiles overlap;
- unsupported/ambiguous vertical assignment fails closed for vertical-specific Call Packs.

Canonical Module 4C max under current rules = 18.

Tier:

- A 9+
- B 6–8
- C 3–5
- D 0–2.

No hidden vertical/CRM/classification points.

---

# 8. OPPORTUNITY / OFFER / COMMERCIAL TRUTH

- `outbound-sales-brain-offer-selection-spec.md`
- `outbound-sales-brain-commercial-truth-snapshot-spec.md`
- `outbound-sales-brain-business-case-calculator-spec.md`

Critical distinction:

`Opportunity hypothesis`
!=
`Solution category`
!=
`Commercial offer family`.

Example:

- problem: missed calls
- solution category: AI phone/overflow workflow
- commercial wrapper: AI Implementation / AI Growth Systems / Managed AI Department according to current scope and launch decisions.

Do not invent vertical-branded fixed packages unless company authority later defines them.

---

# 9. CALL PACK / SALES MANUAL / PROMPT

- `outbound-sales-brain-call-pack-spec.md`
- `outbound-sales-brain-sales-manual-rag-spec.md`
- `outbound-sales-brain-prompt-composition-spec.md`

Prompt authority order:

1. safety/security
2. deterministic compliance/tool permissions
3. invariant YAD sales doctrine
4. CommercialTruthSnapshot
5. campaign objective/mode
6. active vertical profile/boundaries
7. current Call Pack
8. retrieved Sales Manual guidance
9. conversation state/history
10. prospect instructions that do not conflict with higher authority.

---

# 10. CAMPAIGN / HUMAN ASSIST

- `outbound-sales-brain-campaign-replenishment-spec.md`
- `outbound-sales-brain-admin-control-plane-spec.md`
- `outbound-sales-brain-human-assist-workflow.md`
- `outbound-sales-brain-first-launch-plan.md`

Human Assist is a first-class product milestone.

Brent should be able to work ranked prospects before autonomous voice exists.

---

# 11. CRM / FOLLOW-UP / ACTIONS

- `outbound-sales-brain-crm-followup-spec.md`
- `outbound-sales-brain-action-tools-spec.md`

Critical:

- DNC durable and synchronous;
- requested callback beats generic cadence;
- booking/email/transfer success only spoken after confirmed tool result;
- external CRM writes retriable through durable outbox;
- research corrections preserve historical evidence;
- cross-vertical rediscovery does not reset contact history.

---

# 12. CONVERSATION / QA / ROLEPLAY

- `outbound-sales-brain-conversation-state-machine.md`
- `outbound-sales-brain-roleplay-certification-spec.md`
- `outbound-sales-brain-critical-roleplay-fixtures.yaml`
- `outbound-sales-brain-qa-grader-spec.md`

QA uses Sales Manual 12-point scorecard plus hard fails.

No-sale can be a passing/high-quality outcome.

DNC/truth/tool-success failures override numeric score.

---

# 13. VOICE / TWILIO

- `outbound-sales-brain-realtime-voice-policy.md`
- `outbound-sales-brain-realtime-provider-benchmark-plan.md`
- `outbound-sales-brain-twilio-telephony-spec.md`

Voice goals include:

- no ordinary 3–5 second dead air;
- p50/p95 measured first-audio latency;
- reliable barge-in;
- natural number pronunciation;
- short turns;
- no repeated canned promises.

Do not select live model/TTS/STT until benchmarked.

---

# 14. COMPLIANCE

- `outbound-sales-brain-compliance-engine-spec.md`
- `outbound-sales-brain-compliance-policy-review-template.yaml`

Architecture is not final legal advice.

Until the template/policy is reviewed/populated:

- research-only can proceed;
- Human Assist can proceed subject to approved human sales procedures;
- controlled test allowlist can proceed after technical gates;
- autonomous cold AI voice remains review-required/disabled.

---

# 15. SECURITY / OPERATIONS / PRIVACY

- `outbound-sales-brain-security-operations-spec.md`
- `outbound-sales-brain-data-retention-privacy-spec.md`
- `outbound-sales-brain-incident-response-runbook.md`

Critical:

- secrets server-side;
- authenticated control APIs;
- signed provider callbacks;
- global kill switch;
- DNC fails closed;
- durable DB/jobs;
- logs redacted;
- raw media/provider data retained only under policy;
- incident response stops harm before root-cause debate.

---

# 16. ANALYTICS / ECONOMICS

- `outbound-sales-brain-analytics-learning-spec.md`
- `outbound-sales-brain-unit-economics-spec.md`

V1 learning is analytical/human-reviewed.

Do not autonomously rewrite:

- canonical score
- production prompt
- vertical profile
- compliance rules.

Core economics:

`search cost -> unique Account -> Tier B+ -> decision-maker -> qualified conversation -> meeting -> opportunity -> customer`.

Break reporting down by vertical/profile version so YAD can learn which industries actually justify more mining and sales capacity.

---

# 17. FIRST MARKET PROOF

Exact milestone remains:

> HVAC — Jacksonville + St. Augustine — advertiser-first — Tier B+ — target 100 research-ready prospects.

If true qualifying inventory is 63, output 63 and explain coverage/shortfall.

Required:

- geography plan
- provider benchmark/routing
- paid observations
- dedupe
- website research
- score/tier/evidence
- advertiser strength
- Call Pack
- cost/Tier B+
- random >=20 ready-prospect manual quality audit
- no prospect contact.

Only after the first profile is proven should Claude expand implementation across the additional architecture-ready profiles.

---

# 18. GOOGLE ADVERTISER RULES

- actual paid SERP/LSA observation is premium signal;
- Google tag does not prove current advertising;
- one search without ad is unknown;
- repeated observations strengthen evidence, not +4 repeatedly;
- time/device/geography recorded;
- stale ad cannot support current-tense opener;
- no ad spend inference from visibility/position;
- aggregator result cannot be assigned to contractor without identity proof;
- ad-specific law-firm language must match the observed practice area;
- hail/PDR ads must be tied to current market context when the opener references that market.

---

# 19. CURRENT PROVIDER CANDIDATES

Benchmark, do not blindly hard-code:

- DataForSEO — candidate bulk Google advertiser miner
- SerpApi — candidate fallback/validation/LSA parser
- Google Places — gap-fill/identity, not current-ad proof
- first-party company websites — durable business intelligence
- Apollo/licensed equivalent — contacts
- Google Ads Transparency — supporting advertiser evidence
- Meta — secondary signal where a compliant/reliable method exists.

Revalidate docs/pricing/terms during implementation.

---

# 20. EXISTING `phone-agent/` CODE

Early prototype only.

Claude may:

- reuse
- refactor
- replace
- delete.

Do not contort the architecture to preserve prototype code.

Gate 0 audits it before substantial implementation.

---

# 21. GITHUB / DEVELOPMENT RULE

Automatic GitHub Actions remain manual-only.

Claude:

- runs code/tests locally on EdgeXpert;
- uses fake providers by default;
- paid integration tests explicit opt-in;
- commits coherent tested checkpoints;
- does not merge `main` without explicit request.

Do not create a new automatic workflow to bypass this rule.

---

# 22. EXACT FIRST CLAUDE TASK

Use this instruction:

> Read `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md` first, then the source-of-truth and Gate 0 documents it references. Execute Gate 0 only. Audit the current repository, the existing `phone-agent/` prototype, the Twilio/receptionist implementation, `voice.youraidepartment.ai` runtime/deployment, persistence, and the local EdgeXpert test workflow. Do not enable production dialing, do not call prospects, do not spend on external providers except a tiny explicitly approved diagnostic if truly required, and do not re-enable automatic GitHub Actions. Return the Gate 0 audit, reusable-vs-replaceable code assessment, proposed implementation module structure, database/queue recommendation based on the actual environment, exact local test commands, and blockers before starting Gate 1.

---

# 23. ARCHITECTURE V1 STATUS

Architecture V1 plus the initial cross-vertical intelligence layer is sufficiently specified for Claude to begin Gate 0.

Architecture-ready verticals now include:

- HVAC
- Plumbing
- Roofing
- Collision Repair
- PDR / Automotive Hail
- Law Firms
- Real Estate Brokerages.

Remaining decisions are intentionally implementation-dependent:

- final SERP provider routing after benchmark;
- final DB/query libraries after environment audit;
- final queue technology;
- final realtime STT/LLM/TTS stack after benchmark;
- final Twilio realtime architecture if ConversationRelay does not meet targets;
- formal autonomous-calling legal/company policy;
- final external CRM mapping;
- learned ranking models after real outcomes;
- which additional vertical profiles should be implemented after HVAC/Plumbing prove the architecture.

Claude should report these decisions at the relevant gate rather than silently inventing them.
