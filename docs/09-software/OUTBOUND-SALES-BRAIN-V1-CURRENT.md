# OUTBOUND SALES BRAIN V1 — CURRENT ARCHITECTURE MANIFEST

**THIS IS THE CURRENT START FILE FOR CLAUDE CODE.**  
**Updated:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Architecture owner:** ChatGPT  
**Implementation owner:** Claude Code on the EdgeXpert  
**Business owner:** Michael Chanata

If any older index/handoff conflicts with or omits files listed here, this manifest is the current architecture navigation authority.

---

# 1. WHAT WE ARE BUILDING

The core product is a **Prospect Factory / Market Miner first and an AI phone agent second**.

The system must answer:

> Who should YAD contact next, why are they worth contacting, what do we actually know about them, which business context applies, what business problem is worth investigating, who inside the company should own that conversation, and what should the first question be?

Canonical flow:

`Approved Market / Territory`
-> `Query Planner`
-> `Google / approved advertiser-first discovery`
-> `Identity resolution / dedupe`
-> `False-positive / aggregator filtering`
-> `Website / business / contact research`
-> `Evidence Ledger + freshness`
-> `Vertical / business-context routing`
-> `Canonical Module 4C score / Tier A-D`
-> `Advertiser evidence strength`
-> `Research completeness`
-> `Opportunity hypothesis ranking`
-> `Decision-maker routing`
-> `Solution category`
-> `Current commercial offer mapping`
-> `Sales Manual retrieval`
-> `Call Pack`
-> `Ready Queue Priority`
-> `Human Assist Daily Brief`
-> `Compliance gate`
-> `Controlled realtime voice later`
-> `CRM / prospect memory / follow-up`
-> `QA / analytics / closed-loop learning`
-> `Approved query/market optimization proposals`.

The phone is a downstream consumer of this intelligence chain.

---

# 2. NON-NEGOTIABLE IMPLEMENTATION ORDER

Use:

`docs/09-software/outbound-sales-brain-implementation-waves-v1.md`

High-level order:

1. Gate 0 audit.
2. Durable data model / evidence / scoring.
3. HVAC/Plumbing profile loader.
4. Geography / jobs / provider benchmark.
5. Google advertiser miner.
6. Entity resolution / website intelligence / contacts.
7. Opportunity hypotheses / Call Pack / ready queue.
8. Jacksonville + St. Augustine HVAC Gate 7 proof.
9. Human Assist for Brent.
10. Supply autopilot / refresh / query planning.
11. Sales Manual RAG / QA / roleplay.
12. Plumbing second-profile proof.
13. Expand vertical implementations selectively.
14. Closed-loop learning.
15. Compliance software.
16. Realtime voice benchmark.
17. Controlled Twilio + action tools.
18. Audio certification.
19. STOP for explicit approval before any real autonomous prospect pilot.

Architecture-ready does not mean “implement everything now.”

Production autonomous cold AI voice remains disabled/review-required until explicit approval and required policy/gates pass.

---

# 3. PROJECT / COMMERCIAL AUTHORITIES

Read first:

- `CLAUDE.md`
- `brain/README.md`
- `brain/TODO.md`
- `brain/PHONE-AGENT.md`
- `docs/00-company/launch-decisions.md`
- `docs/07-sales/training-manual/README.md`

Current commercial truth from launch decisions overrides stale sales-training/commercial references.

Canonical sales doctrine remains:

`docs/07-sales/training-manual/**`

---

# 4. PRIMARY EXECUTION DOCUMENTS

- `outbound-ai-sales-brain-master-spec.md`
- `outbound-ai-sales-brain-claude-handoff.md`
- `outbound-sales-brain-implementation-gates.md`
- `outbound-sales-brain-implementation-waves-v1.md`
- `outbound-sales-brain-claude-implementation-backlog.md`
- `outbound-sales-brain-architecture-v1-release-checklist.md`
- `outbound-sales-brain-consistency-decisions.md`

Claude's first engineering action is still Gate 0 audit, not coding the dialer.

---

# 5. MARKET MINER — DISCOVERY / RESEARCH

Core specifications:

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
- `market-miner-claim-registry.v1.yaml`
- `market-miner-jacksonville-staugustine-hvac-acceptance-pack.md`

New autopilot intelligence:

- `market-miner-autonomous-query-planner-spec.md`
- `market-miner-false-positive-learning-spec.md`
- `market-miner-refresh-orchestrator-spec.md`
- `market-miner-territory-expansion-controller-spec.md`
- `market-miner-autopilot-fixtures.v1.yaml`

Key principles:

- approved query universe only in V1;
- actual paid SERP/LSA observation is premium evidence;
- one failed ad observation is UNKNOWN, not “not advertising”;
- dedupe before expensive research;
- filter known directories/supply/training noise early;
- refresh only claims needed for the next decision;
- saturation is time-bounded, not permanent;
- never lower minimum Tier secretly to fill inventory;
- market expansion remains inside admin-approved geography.

---

# 6. DATA / STORAGE / JOBS / MEMORY

- `outbound-sales-brain-data-contract.md`
- `outbound-sales-brain-storage-indexing-spec.md`
- `outbound-sales-brain-job-queue-spec.md`
- `outbound-sales-brain-service-api-contracts.md`
- `outbound-sales-brain-local-development-test-spec.md`
- `outbound-sales-brain-prospect-memory-spec.md`

Normative semantics:

- evidence confidence = `confirmed / likely / unknown`;
- evidence lifecycle = `active / aging / stale / contradicted / superseded`;
- three-state facts = `yes / no_confirmed / unknown`;
- failed detection normally yields `unknown`;
- historical evidence is not deleted merely because new evidence supersedes it;
- prospect statements retain source/time/scope;
- DNC/contact history survives rediscovery and cross-vertical campaigns.

---

# 7. SCORING / VERTICAL INTELLIGENCE

Core:

- `outbound-sales-brain-scoring-research-fixtures.yaml`
- `vertical-profile-schema.md`
- `vertical-profile-generation-process.md`
- `vertical-profile-registry.v1.yaml`

Canonical Module 4C:

- maximum current score = 18
- Tier A = 9+
- Tier B = 6–8
- Tier C = 3–5
- Tier D = 0–2

No hidden vertical, CRM, contactability, research-completeness or classification points.

## Architecture-ready machine profiles

Wave 1 proof:

- `vertical-profiles/hvac.v1.yaml`
- `vertical-profiles/plumbing.v1.yaml`

Additional profiles:

- `vertical-profiles/roofing.v1.yaml`
- `vertical-profiles/collision-repair.v1.yaml`
- `vertical-profiles/pdr-hail.v1.yaml`
- `vertical-profiles/law-firms.v1.yaml`
- `vertical-profiles/general-contractors-remodeling.v1.yaml`
- `vertical-profiles/electrical.v1.yaml`
- `vertical-profiles/dental.v1.yaml`
- `vertical-profiles/med-spas.v1.yaml`
- `vertical-profiles/real-estate-brokerages.v1.yaml`
- `vertical-profiles/restoration.v1.yaml`
- `vertical-profiles/garage-door.v1.yaml`

Validation/control:

- `outbound-sales-brain-vertical-router-spec.md`
- `outbound-sales-brain-vertical-router-fixtures.v1.yaml`
- `outbound-sales-brain-expanded-vertical-fixtures.v1.yaml`
- `outbound-sales-brain-cross-vertical-intelligence-v1.md`

Router invariants:

- one Account may have several vertical assignments;
- current campaign context chooses active profile;
- secondary profiles do not create duplicate Accounts;
- account-wide contact history/DNC persists;
- classification confidence is separate from fit score;
- stricter safety/professional boundary wins;
- ambiguous context blocks vertical-specific claims.

---

# 8. OPPORTUNITY / OFFER / COMMERCIAL TRUTH

- `outbound-sales-brain-opportunity-hypothesis-ranking-spec.md`
- `outbound-sales-brain-offer-selection-spec.md`
- `outbound-sales-brain-commercial-truth-snapshot-spec.md`
- `outbound-sales-brain-business-case-calculator-spec.md`

Critical distinction:

`Observed fact`
!=
`Opportunity hypothesis`
!=
`Confirmed pain`
!=
`Solution category`
!=
`Commercial offer family`.

The system selects the most relevant question supported by evidence; it never invents pain to make a pitch more dramatic.

Current ads make paid-lead handling/attribution worth investigating. They do not prove a leak.

No-sale / measure-first remains valid.

---

# 9. DECISION-MAKER / CONTACT ROUTING

- `outbound-sales-brain-decision-maker-routing-spec.md`

Route by problem ownership, not merely “find the owner.”

Examples:

- intake -> intake/operations/practice administrator
- unsold proposals -> sales leadership/GM
- paid attribution -> marketing/operations/owner
- missed calls -> operations/office/dispatch
- law AI governance -> operations/managing partner/appropriate security owner

A role-only target is valid when no named current person can be verified.

Never invent a person's name.

---

# 10. CALL PACK / SALES MANUAL / PROMPT

- `outbound-sales-brain-call-pack-spec.md`
- `outbound-sales-brain-sales-manual-rag-spec.md`
- `outbound-sales-brain-prompt-composition-spec.md`

Prompt authority:

1. safety/security
2. deterministic compliance/tool permissions
3. YAD invariant sales doctrine
4. CommercialTruthSnapshot
5. campaign objective/mode
6. active vertical profile/boundaries
7. Call Pack
8. retrieved Sales Manual guidance
9. current conversation / relationship brief
10. prospect instructions that do not conflict with higher authority.

Live model never receives the entire Sales Manual on every turn.

---

# 11. READY QUEUE / HUMAN ASSIST

- `outbound-sales-brain-ready-queue-priority-spec.md`
- `outbound-sales-brain-campaign-replenishment-spec.md`
- `outbound-sales-brain-admin-control-plane-spec.md`
- `outbound-sales-brain-human-assist-workflow.md`
- `outbound-sales-brain-human-assist-daily-brief-spec.md`
- `outbound-sales-brain-first-launch-plan.md`

Relationship commitments outrank cold-prospect optimization.

Example:

A requested callback due now outranks a brand-new Tier A cold prospect.

Human Assist is a first-class business product milestone. Brent should be able to work ranked, researched prospects before autonomous voice exists.

---

# 12. CRM / FOLLOW-UP / ACTIONS

- `outbound-sales-brain-crm-followup-spec.md`
- `outbound-sales-brain-action-tools-spec.md`

Critical:

- DNC durable and synchronous;
- requested callback beats generic cadence;
- booked meeting removes Account from ordinary cold queue;
- tool success must be confirmed before agent claims success;
- external writes use durable outbox/retry;
- corrections preserve historical provenance;
- cross-vertical rediscovery never resets relationship state.

---

# 13. ANALYTICS / CLOSED-LOOP LEARNING / EXPERIMENTS

- `outbound-sales-brain-analytics-learning-spec.md`
- `outbound-sales-brain-unit-economics-spec.md`
- `outbound-sales-brain-closed-loop-learning-spec.md`
- `outbound-sales-brain-experiment-governance-spec.md`

Separate learning loops:

- supply learning: market/query/provider/research priority;
- sales learning: hooks/roles/questions/Call Pack proposals;
- quality learning: evidence/refresh/noise/QA/voice configuration proposals.

V1 may automatically reorder approved tasks within bounded config.

V1 may NOT autonomously rewrite:

- Module 4C scoring
- sales doctrine
- commercial truth/pricing
- compliance/DNC policy
- professional/safety boundaries
- production prompt architecture
- new query families without review.

Use experiments, sample-size discipline, guardrails and rollback.

---

# 14. CONVERSATION / QA / ROLEPLAY

- `outbound-sales-brain-conversation-state-machine.md`
- `outbound-sales-brain-roleplay-certification-spec.md`
- `outbound-sales-brain-critical-roleplay-fixtures.yaml`
- `outbound-sales-brain-qa-grader-spec.md`

QA uses the Sales Manual 12-point scorecard plus hard fails.

No-sale can be a high-quality passing outcome.

DNC/truth/tool-success failures override numeric score.

---

# 15. VOICE / TWILIO

- `outbound-sales-brain-realtime-voice-policy.md`
- `outbound-sales-brain-realtime-provider-benchmark-plan.md`
- `outbound-sales-brain-twilio-telephony-spec.md`

Voice goals:

- no ordinary 3–5 second dead air;
- p50/p95 measured first-audio latency;
- reliable barge-in;
- natural numbers/dates/emails;
- short spoken turns;
- no repeated canned promises.

Do not select model/STT/TTS on brand preference. Benchmark the real end-to-end caller experience.

---

# 16. COMPLIANCE

- `outbound-sales-brain-compliance-engine-spec.md`
- `outbound-sales-brain-compliance-policy-review-template.yaml`

Architecture is not final legal advice.

Until policy review is completed:

- Market Miner can proceed;
- Human Assist can proceed under approved human-sales procedures;
- controlled allowlisted voice tests can proceed after technical gates;
- autonomous real-prospect cold AI voice remains disabled/review-required.

LLM never overrides deterministic suppression/contact policy.

---

# 17. SECURITY / OPERATIONS / PRIVACY

- `outbound-sales-brain-security-operations-spec.md`
- `outbound-sales-brain-data-retention-privacy-spec.md`
- `outbound-sales-brain-incident-response-runbook.md`

Non-negotiable:

- secrets server-side;
- authenticated control APIs;
- provider callback validation;
- durable DNC;
- durable jobs/DB;
- global kill switch;
- logs redacted;
- source/license retention policy;
- public website content treated as untrusted data;
- crawler must prevent SSRF/private-network access;
- research model does not receive communication/shell/secrets tools.

---

# 18. FIRST MARKET PROOF

Exact first milestone remains:

> **HVAC — Jacksonville + St. Augustine — advertiser-first — Tier B+ — target 100 research-ready prospects — NO CONTACT.**

If only 63 genuinely qualify, output 63 and explain the coverage/shortfall.

Required proof:

- geography plan
- provider benchmark/routing
- paid observations
- dedupe
- false-positive handling
- website research
- score/tier/evidence
- advertiser strength
- opportunity hypothesis
- decision-maker route
- Call Pack
- provider cost
- random >=20 ready-prospect human quality audit

Only after this passes should implementation broaden beyond the initial profile loop.

---

# 19. GOOGLE / ADVERTISER RULES

- paid SERP/LSA observation = premium current signal;
- tag/pixel != current advertising;
- one search without an ad = unknown;
- repeated observations strengthen evidence, not repeated +4 score;
- record query/time/device/geography;
- stale ad cannot support current-tense opener;
- no ad-spend inference from visibility or placement;
- aggregator ad cannot be assigned to contractor without identity proof;
- law ad language must match observed practice area;
- Hail/PDR market language requires current market/event evidence;
- Med Spa is intentionally mixed-channel with Meta as an important discovery source where a reliable compliant method exists.

---

# 20. CURRENT PROVIDER CANDIDATES

Benchmark, do not hard-code blindly:

- DataForSEO — candidate bulk Google paid SERP miner
- SerpApi — candidate fallback/validation/LSA parser
- Google Places — gap-fill/identity, not current-ad proof
- first-party business websites — durable intelligence
- Apollo/licensed equivalent — contacts
- Google Ads Transparency — supporting advertiser evidence
- Meta — secondary/primary-by-vertical ad evidence where reliable compliant access exists.

Revalidate pricing/docs/terms at implementation time.

---

# 21. EXISTING `phone-agent/` CODE

Early prototype only.

Claude may reuse, refactor, replace or delete pieces after Gate 0 audit.

Do not preserve prototype architecture merely because code exists.

---

# 22. GITHUB / DEVELOPMENT RULE

Automatic GitHub Actions remain manual-only unless Michael explicitly changes this.

Claude:

- executes/tests locally on EdgeXpert;
- uses fake providers by default;
- paid integration tests require explicit opt-in;
- commits coherent tested checkpoints;
- does not merge `main` without explicit request;
- does not enable real prospect dialing during ordinary development.

---

# 23. EXACT FIRST CLAUDE TASK

> Read `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md` first, then the source-of-truth and Gate 0 documents it references. Execute Gate 0 only. Audit the current repository, the existing `phone-agent/` prototype, the Twilio/receptionist implementation, `voice.youraidepartment.ai` runtime/deployment, persistence, and the local EdgeXpert test workflow. Do not enable production dialing, do not call prospects, do not spend on external providers except a tiny explicitly approved diagnostic if truly required, and do not re-enable automatic GitHub Actions. Return the Gate 0 audit, reusable-vs-replaceable code assessment, proposed Market Miner implementation module structure, database/queue recommendation based on the actual environment, exact local test commands, and blockers before starting Gate 1.

---

# 24. CURRENT ARCHITECTURE STATUS

The brain is now specified across:

- advertiser-first market mining
- adaptive approved query planning
- geography / saturation / territory expansion
- provider economics
- false-positive/noise learning
- entity resolution
- website intelligence
- evidence/freshness/refresh
- prospect memory
- canonical scoring
- 13 architecture-ready vertical profiles
- cross-vertical routing
- opportunity-hypothesis ranking
- decision-maker routing
- offer/commercial mapping
- Sales Manual RAG
- ready-queue priority
- Human Assist Daily Brief
- CRM/follow-up/action tools
- analytics/closed-loop learning
- experiment governance
- QA/roleplay
- compliance architecture
- realtime voice/Twilio architecture.

Implementation-dependent decisions intentionally remain for Claude at the relevant gate:

- final SERP provider routing after benchmark;
- exact DB/query library;
- exact queue implementation;
- actual provider/account economics;
- final realtime STT/LLM/TTS stack;
- final Twilio realtime transport if benchmarked alternative is superior;
- formal autonomous-calling company/legal policy;
- external CRM adapter selection;
- learned propensity models after sufficient labeled outcomes.

The architecture should now constrain implementation decisions without pretending benchmark-dependent answers are already known.
