# Your AI Department — Outbound Sales Brain Architecture Backlog

**Status:** Core architecture substantially complete; remaining work is refinement/provider validation/implementation support  
**Owner:** Michael Chanata  
**Architecture:** ChatGPT  
**Implementation:** Claude Code  
**Rule:** Documentation/spec work here must not enable production dialing or automatic CI.

---

# A. FOUNDATION

- [x] Define complete outbound AI sales brain architecture.
- [x] Separate pre-call research brain from low-latency realtime voice brain.
- [x] Make `docs/07-sales/training-manual/**` the sales-doctrine source of truth.
- [x] Define explicit operating modes.
- [x] Define compliance/suppression architecture.
- [x] Define call state machine and post-call flow.
- [x] Define voice UX/latency/barge-in/repetition/number-verbalization requirements.
- [x] Define source-of-truth hierarchy and commercial-truth override.
- [x] Create Claude Code implementation handoff.

# B. MARKET MINER / PROSPECT FACTORY

- [x] Reframe prospect supply as primary upstream engine before Twilio.
- [x] Define state/county/city/ZCTA/radius territory model.
- [x] Define search-cell coverage and territory saturation concept.
- [x] Define business-discovery provider abstraction.
- [x] Define source ownership/retention classes.
- [x] Define Google-first advertiser mining strategy.
- [x] Define DataForSEO / SerpApi / Places / Apollo / website source hierarchy.
- [x] Define Google advertiser query matrix and staged query budgeting.
- [x] Define advertiser observation vs permanent company fact.
- [x] Define identity resolution / deduplication architecture.
- [x] Define reversible merge/unmerge rules and fixtures.
- [x] Define website crawl/extraction and technology-signal rules.
- [x] Define research-completeness score separate from YAD fit.
- [x] Define continuous inventory/replenishment architecture.
- [x] Define canonical machine-readable Prospect/data contract.
- [x] Define EvidenceRecord contract and precedence rules.
- [x] Define initial source freshness/TTL matrix.
- [x] Define normalized Account/Location/Contact/Domain/Phone model.
- [x] Define provider cost/usage record contract.
- [x] Define campaign budget/quality circuit breakers.
- [ ] Expand geography/search-cell implementation details and fixtures.
- [ ] Create provider benchmark/selection test plan.
- [ ] Create first-market acceptance dataset/audit protocol.

# C. VERTICAL INTELLIGENCE

- [x] Define reusable vertical-profile schema.
- [x] Build HVAC machine-readable vertical profile.
- [x] Build Plumbing machine-readable vertical profile.
- [x] Create vertical query dictionaries/exclusions/high-value/urgency/system/hook/question/safety metadata.
- [x] Map profiles to canonical Sales Manual modules.
- [x] Define profile/version snapshot requirements.
- [ ] Add future vertical profiles only after HVAC/Plumbing implementation proves schema.

# D. SCORING / PRIORITIZATION

- [x] Preserve Module 4C canonical YAD score as auditable baseline.
- [x] Separate future learned propensity score from manual score.
- [x] Create deterministic scoring fixture bank.
- [x] Create ambiguous/unknown evidence tests.
- [x] Define queue tie-break ranking separately from canonical score.
- [x] Define stale-research refresh behavior without corrupting fit score.
- [x] Define contactability/compliance as queue gates, not score penalties.
- [ ] Calibrate ranking after real labeled outcomes exist.

# E. OPPORTUNITY / OFFER ENGINE

- [x] Define current YAD offer-family taxonomy from launch decisions.
- [x] Define opportunity-classification rules.
- [x] Define primary/secondary offer hypothesis logic.
- [x] Define no-sale / measure-first / human-discovery outputs.
- [x] Define prohibited offer inference rules.
- [x] Define current approved next-step/commercial mapping.
- [ ] Reconcile if launch decisions change.

# F. SALES STRATEGY / CALL PACK / KNOWLEDGE

- [x] Define problem-hypothesis framework.
- [x] Define primary/backup hook concept.
- [x] Define canonical Call Pack schema.
- [x] Define compact live-agent context budget.
- [x] Create 15 worked Call Pack examples.
- [x] Define public-fact vs hypothesis language behavior.
- [x] Define research-correction behavior.
- [x] Define Sales Manual RAG/index architecture.
- [x] Define live RAG latency/fallback.
- [x] Define deterministic current-commercial-truth layer.
- [ ] Expand gold retrieval test set during implementation as failures are discovered.

# G. VOICE / CONVERSATION ENGINE

- [x] Define conversation state machine.
- [x] Define common objection branches.
- [x] Define exact turn-taking/streaming policy.
- [x] Define partial-STT policy.
- [x] Define silence/truthful-filler strategy.
- [x] Define voicemail behavior.
- [x] Define transfer/booking failure behavior.
- [x] Define phone/email/date/time/currency verbalization rules.
- [x] Define DNC/wrong-number/hostile termination priority.
- [x] Define realtime benchmark matrix and latency gates.
- [ ] Select realtime provider/model only after Claude benchmarks actual stacks.

# H. ROLEPLAY / QA

- [x] Identify manual persona set.
- [x] Use Module 4A 12-point call scorecard.
- [x] Convert personas into repeatable evaluation scenarios.
- [x] Define hard-fail assertions.
- [x] Define simulated prospect private state / expected behavior contract.
- [x] Define controlled-test certification suite.
- [x] Define minimum pass levels before pilot.
- [ ] Implementation should add machine-readable scenario files if test harness benefits.

# I. CRM / DATA / FOLLOW-UP

- [x] Define canonical CRM stage mapping.
- [x] Define call disposition taxonomy and required notes.
- [x] Define follow-up task contract.
- [x] Define durable outbox/retry semantics.
- [x] Define prospect-statement provenance/corrections.
- [x] Define closed-lost/disqualification reasons.
- [x] Define duplicate outreach prevention rules.
- [x] Define provider-neutral CRM adapter contract.
- [ ] Final external CRM vendor mapping can be chosen during implementation/operations.

# J. COMPLIANCE / POLICY SOFTWARE CONTRACT

- [x] Define deterministic policy engine.
- [x] Define policy input schema.
- [x] Define decision states: autonomous / human-only / research-only / review / suppress.
- [x] Define timezone/calling-window resolution architecture.
- [x] Define DNC hierarchy and synchronous suppression rules.
- [x] Define attempt-frequency/cooldown architecture.
- [x] Define recording/transcription policy flags.
- [x] Define unknown line/contact-basis handling.
- [x] Define policy versioning/audit record.
- [x] Define software fixtures.
- [ ] Obtain/reconcile formal legal/company policy before real autonomous prospect calls.

# K. CAMPAIGN ORCHESTRATION

- [x] Define campaign schema.
- [x] Define queue priority algorithm.
- [x] Define target-inventory low/high-water behavior.
- [x] Define research refresh scheduling.
- [x] Define provider/contact circuit breakers.
- [x] Define campaign/global pause and kill switch.
- [x] Define territory expansion logic.
- [x] Define existing-customer/exclusion checks.
- [x] Define prospect leasing/in-flight duplicate prevention.
- [ ] Create detailed geography implementation spec/fixtures.

# L. ANALYTICS / LEARNING

- [x] Define learning as analytical/human-reviewed in V1.
- [x] Adopt Sales Manual management metrics.
- [x] Define event taxonomy.
- [x] Define metric formulas/denominators.
- [x] Define hook/source/vertical/provider attribution.
- [x] Define research cost per Tier A/B.
- [x] Define cost per decision-maker/qualified conversation/meeting/opportunity.
- [x] Define future propensity-model inputs.
- [x] Define experiments/version controls.
- [x] Define thin-sample caution.
- [x] Define weekly management report.
- [ ] Calibrate future learned model only after sufficient real labeled data.

# M. ADMIN / CONTROL PLANE

- [x] Define user roles.
- [x] Define Market Miner dashboard.
- [x] Define campaign builder/controller.
- [x] Define prospect list/detail/evidence inspector.
- [x] Define score explainer.
- [x] Define provider spend monitor.
- [x] Define suppression/DNC center.
- [x] Define call/QA review.
- [x] Define human-assist queue for Brent/reps.
- [x] Define audit log / RBAC.
- [x] Define minimum V1 UI before advanced analytics.

# N. SECURITY / OPERATIONS

- [x] Define server-side secrets rule.
- [x] Define authentication/authorization model.
- [x] Define production dial multi-gate enablement.
- [x] Define global kill switch.
- [x] Define provider webhook validation requirement.
- [x] Define durable DB/queue/lease/idempotency requirements.
- [x] Define transcript/audio retention classes.
- [x] Define logging redaction.
- [x] Define retry/idempotency rules.
- [x] Define backup/recovery priorities.
- [x] Define monitoring/SLOs/provider degradation.
- [x] Define development/staging/production separation.
- [x] Preserve manual-only GitHub CI during active development.
- [ ] Final deployment topology validated by Claude against actual EdgeXpert/server environment.

# O. CLAUDE IMPLEMENTATION PACKAGE

- [x] Master architecture specification.
- [x] Market Miner specification.
- [x] Provider blueprint.
- [x] Google advertiser search matrix.
- [x] Canonical data contract.
- [x] Entity-resolution specification.
- [x] Website-intelligence specification.
- [x] Reusable vertical-profile schema.
- [x] HVAC profile.
- [x] Plumbing profile.
- [x] Offer-selection specification.
- [x] Scoring/research QA fixtures.
- [x] Call Pack specification/examples.
- [x] Sales Manual RAG specification.
- [x] Campaign/replenishment specification.
- [x] CRM/follow-up specification.
- [x] Compliance-engine specification.
- [x] Roleplay/certification specification.
- [x] Realtime voice policy.
- [x] Analytics/learning specification.
- [x] Admin/control-plane specification.
- [x] Security/operations specification.
- [x] Mandatory implementation gates.
- [x] Update Claude handoff with Market Miner-first build order.
- [ ] Create architecture index/README.
- [ ] Create detailed geography engine specification.
- [ ] Create provider benchmark plan.
- [ ] Create Jacksonville/St. Augustine first-market acceptance pack.
- [ ] Update `brain/PHONE-AGENT.md` to reflect architecture-first/Market-Miner-first state.

---

# REMAINING ARCHITECTURE EXECUTION ORDER

1. Detailed geography engine/search-cell specification.
2. Provider benchmark/selection test plan.
3. Jacksonville/St. Augustine Market Miner acceptance pack.
4. Architecture index/README.
5. Update brain state for Claude continuity.
6. Final consistency review across architecture docs.

After those items, the architecture package is mature enough for Claude to begin Gate 0 and then implement the Market Miner in controlled phases.
