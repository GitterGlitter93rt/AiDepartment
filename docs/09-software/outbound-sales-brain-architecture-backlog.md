# Your AI Department — Outbound Sales Brain Architecture Backlog

**Status:** Active architecture checklist  
**Owner:** Michael Chanata  
**Architecture:** ChatGPT  
**Implementation:** Claude Code  
**Rule:** Documentation/spec work here must not enable production dialing or automatic CI.

---

# A. FOUNDATION

- [x] Define complete outbound AI sales brain architecture.
- [x] Separate pre-call research brain from low-latency realtime voice brain.
- [x] Make `docs/07-sales/training-manual/**` the sales-doctrine source of truth.
- [x] Define explicit operating modes: research-only, human-assist, controlled-test, autonomous-outbound, inbound-receptionist.
- [x] Define high-level compliance/suppression gate.
- [x] Define human/voicemail/wrong-number/live-call/post-call flow.
- [x] Define voice UX targets for latency, barge-in, repetition, number pronunciation, and act-now behavior.
- [x] Create Claude Code implementation handoff.

# B. MARKET MINER / PROSPECT FACTORY

- [x] Reframe prospect supply as the primary upstream engine before Twilio.
- [x] Define state/county/city/ZCTA/radius territory model.
- [x] Define search-cell coverage and territory saturation.
- [x] Define business discovery provider abstraction.
- [x] Define source ownership/retention classes.
- [x] Define Google-first advertiser mining strategy.
- [x] Define DataForSEO / SerpApi / Places / Apollo / website source hierarchy.
- [x] Define Google advertiser query matrix and staged query budgeting.
- [x] Define advertiser observation vs permanent company fact.
- [x] Define identity resolution and deduplication architecture.
- [x] Define website crawl priorities and frontend technology signals.
- [x] Define research-completeness score separate from YAD fit score.
- [x] Define continuous inventory/replenishment concept.
- [ ] Define canonical machine-readable Prospect data contract.
- [ ] Define exact evidence-record contract and precedence rules.
- [ ] Define exact source freshness/TTL matrix by signal type.
- [ ] Define canonical normalized business/contact/location model.
- [ ] Define per-provider cost/usage record contract.
- [ ] Define exact duplicate-merge/reversible-unmerge rules and test fixtures.
- [ ] Define territory expansion/saturation acceptance fixtures.

# C. VERTICAL INTELLIGENCE

- [ ] Build HVAC machine-readable vertical profile.
- [ ] Build Plumbing machine-readable vertical profile.
- [ ] Define reusable vertical-profile schema for all future industries.
- [ ] Create vertical query dictionaries, exclusions, high-ticket service families, urgency signals, CRM/system families, hook priorities, discovery questions, and sensitive boundaries.
- [ ] Map each vertical profile to its canonical Sales Manual module.
- [ ] Define how vertical versions/hashes are recorded per prospect/call.

# D. SCORING / PRIORITIZATION

- [x] Preserve Module 4C canonical YAD score as auditable baseline.
- [x] Separate future learned propensity score from manual score.
- [ ] Create deterministic scoring test fixture bank.
- [ ] Create ambiguous/unknown evidence scoring tests.
- [ ] Define tie-break ranking logic inside the same YAD tier.
- [ ] Define stale-research penalty/refresh behavior without corrupting canonical score.
- [ ] Define contactability/compliance as queue gates rather than fake fit-score penalties.

# E. OPPORTUNITY / OFFER ENGINE

- [ ] Define YAD offer-family taxonomy from current launch decisions.
- [ ] Define opportunity-classification rules.
- [ ] Define primary vs secondary offer hypothesis logic.
- [ ] Define when the engine should recommend no sale / measure first / human discovery.
- [ ] Define prohibited offer inference rules.
- [ ] Define current approved CTA/next-step mapping.

# F. SALES STRATEGY / CALL PACK

- [x] Define problem-hypothesis framework.
- [x] Define primary/backup hook concept.
- [ ] Define canonical Call Pack schema.
- [ ] Define compact live-agent context budget.
- [ ] Create 15–20 worked Call Pack examples.
- [ ] Define public fact vs hypothesis language templates.
- [ ] Define research-correction behavior when prospect contradicts dossier.
- [ ] Define live RAG retrieval contract and latency fallback.

# G. VOICE / CONVERSATION ENGINE

- [x] Define overall state machine.
- [x] Define common objection branches from Sales Manual.
- [x] Define latency/barge-in/repetition targets.
- [ ] Define exact turn-taking policy.
- [ ] Define partial-STT interruption policy.
- [ ] Define silence/filler strategy without deceptive prerecorded chatter.
- [ ] Define voicemail policy and follow-up cadence inputs.
- [ ] Define transfer/booking failure fallback scripts.
- [ ] Define phone-number/date/time/currency verbalization rules.
- [ ] Define hostile/irrelevant/wrong-number termination rules.

# H. ROLEPLAY / QA

- [x] Identify manual's roleplay persona set.
- [x] Use Module 4A 12-point call scorecard as QA basis.
- [ ] Convert personas into deterministic evaluation fixtures.
- [ ] Define hard-fail assertions.
- [ ] Define transcript grader input/output schema.
- [ ] Define simulated prospect state and expected branch outcomes.
- [ ] Create controlled-test certification suite for HVAC.
- [ ] Define minimum pass rates before real-prospect pilot.

# I. CRM / DATA / FOLLOW-UP

- [x] Define conceptual entities for account/contact/research/evidence/call/outcome/suppression.
- [ ] Define canonical CRM stage mapping.
- [ ] Define call disposition taxonomy and required notes.
- [ ] Define exact follow-up task contract.
- [ ] Define outbox/retry semantics for failed CRM/SMS/email writes.
- [ ] Define prospect-statement provenance and corrections.
- [ ] Define closed-lost/disqualification reasons.
- [ ] Define duplicate company/contact/contact-attempt prevention rules.

# J. COMPLIANCE / POLICY SOFTWARE CONTRACT

- [x] Define deterministic compliance engine concept.
- [ ] Define complete policy input schema.
- [ ] Define decision matrix: autonomous / human-only / research-only / review / suppress.
- [ ] Define timezone/calling-window resolution rules.
- [ ] Define DNC hierarchy and synchronous suppression rules.
- [ ] Define attempt-frequency/cooldown contract.
- [ ] Define recording/transcription policy flags.
- [ ] Define line-type/contact-basis unknown-state handling.
- [ ] Define policy versioning/audit record.
- [ ] Create software fixtures, explicitly subject to legal/company review before production.

# K. CAMPAIGN ORCHESTRATION

- [x] Define campaign concept and inventory replenishment.
- [ ] Define exact campaign schema.
- [ ] Define queue priority algorithm.
- [ ] Define market inventory target behavior.
- [ ] Define research refresh scheduling.
- [ ] Define max-spend/max-search/max-contact circuit breakers.
- [ ] Define campaign pause/kill-switch behavior.
- [ ] Define expansion from city -> metro -> state -> next market.
- [ ] Define exclusion lists and existing-customer suppression imports.

# L. ANALYTICS / LEARNING

- [x] Define learning brain as analytical, not self-modifying in V1.
- [x] Adopt Sales Manual management metrics.
- [ ] Define event taxonomy.
- [ ] Define metric formulas and denominators.
- [ ] Define hook/source/vertical/provider attribution.
- [ ] Define research cost per Tier A/B prospect.
- [ ] Define cost per decision-maker, qualified conversation, meeting, opportunity.
- [ ] Define data needed for future learned propensity model.
- [ ] Define experiment assignment and prompt/version controls.
- [ ] Define when results are statistically too thin to make a recommendation.

# M. ADMIN / CONTROL PLANE

- [ ] Define Market Miner dashboard views.
- [ ] Define prospect evidence inspector.
- [ ] Define campaign controller.
- [ ] Define provider spend monitor.
- [ ] Define suppression/DNC search.
- [ ] Define call review/QA view.
- [ ] Define manual human-assist queue for Brent/reps.
- [ ] Define audit log and role-based administrative actions.

# N. SECURITY / OPERATIONS

- [x] Define server-side secrets rule.
- [x] Define webhook signature requirement.
- [x] Define production dial flag and global kill switch concept.
- [ ] Define authentication/authorization model for internal APIs/admin.
- [ ] Define transcript/audio retention classes.
- [ ] Define logging redaction rules.
- [ ] Define retry/idempotency rules for external actions.
- [ ] Define backup/recovery expectations for suppression and CRM state.
- [ ] Define monitoring/SLOs for research workers and realtime gateway.

# O. CLAUDE IMPLEMENTATION PACKAGE

- [x] Master architecture specification.
- [x] Initial Claude handoff.
- [x] Market Miner specification.
- [x] Provider blueprint.
- [x] Google advertiser search matrix.
- [ ] Canonical data-contract specification.
- [ ] HVAC vertical profile.
- [ ] Offer-selection specification.
- [ ] Scoring/research QA fixtures.
- [ ] Call Pack specification/examples.
- [ ] Campaign/replenishment specification.
- [ ] Compliance-engine software specification.
- [ ] Analytics/learning specification.
- [ ] Admin/control-plane specification.
- [ ] Update Claude handoff with new build order.
- [ ] Create architecture-completion checklist Claude must pass before coding each phase.

---

# CURRENT EXECUTION ORDER

1. Canonical data contract.
2. HVAC vertical profile/schema.
3. Offer-selection engine.
4. Scoring + research QA fixtures.
5. Call Pack specification and examples.
6. Campaign/replenishment engine.
7. Compliance software contract.
8. Analytics/learning contract.
9. Admin/control-plane contract.
10. Final Claude build handoff update.
11. Plumbing profile after HVAC architecture is stable.

This backlog is intentionally larger than the first production milestone. Claude should not implement everything at once. Architecture can be complete while implementation proceeds in controlled phases.
