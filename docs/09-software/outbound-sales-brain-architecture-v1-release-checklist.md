# Your AI Department — Prospect Factory / Outbound Sales Brain Architecture V1 Release Checklist

**Status:** Architecture package readiness checklist  
**Purpose:** Define when the design is mature enough for Claude Code to begin Gate 0/implementation without having to invent major product decisions.

---

# 1. PRODUCT DEFINITION

- [x] Prospect Factory/Market Miner is upstream foundation.
- [x] Human Assist creates value before autonomous voice.
- [x] Twilio/realtime voice is downstream and gated.
- [x] First vertical = HVAC; second = Plumbing.
- [x] First market milestone = Jacksonville + St. Augustine HVAC.
- [x] Active Google advertisers are premium discovery signal, not sole YAD market.

---

# 2. AUTHORITY / GOVERNANCE

- [x] Sales Manual source of truth identified.
- [x] Commercial truth authority identified.
- [x] Architecture index created.
- [x] Claude handoff created.
- [x] Implementation gates created.
- [x] Architecture vs implementation ownership clarified.
- [x] Existing prototype marked non-authoritative.
- [x] Automatic GitHub Actions remain manual-only.
- [x] No merge/production call authority granted.

---

# 3. MARKET MINER

- [x] Prospect factory master spec.
- [x] Geography/search-cell system.
- [x] Google advertiser query matrix.
- [x] Time/device sampling.
- [x] Provider blueprint.
- [x] Provider benchmark plan.
- [x] Advertiser evidence-strength layer.
- [x] Website intelligence.
- [x] Contact enrichment.
- [x] Entity resolution/merge/unmerge.
- [x] Research orchestration.
- [x] Evidence claim registry.
- [x] Lead import/export/reconciliation.
- [x] Data-quality SLOs.
- [x] First-market acceptance pack.

---

# 4. DATA / SCORING

- [x] Canonical domain object model.
- [x] Confidence/state semantics.
- [x] Three-state negative semantics.
- [x] Module 4C score preserved exactly.
- [x] Corrected scoring fixtures.
- [x] Research completeness separate.
- [x] Compliance/contactability separate.
- [x] Advertiser strength separate.
- [x] Provider usage/cost data model.
- [x] Persistent storage/indexing spec.

---

# 5. VERTICALS

- [x] Generic vertical profile schema.
- [x] HVAC profile.
- [x] Plumbing profile.
- [x] Profile-generation governance for later verticals.
- [x] Professional/safety boundaries supported.

---

# 6. SALES STRATEGY

- [x] Opportunity hypothesis model.
- [x] Solution category vs commercial offer distinction.
- [x] Offer-selection rules.
- [x] CommercialTruthSnapshot.
- [x] Call Pack schema/examples.
- [x] Sales Manual RAG.
- [x] Prompt composition/precedence.
- [x] No-sale path.

---

# 7. FINANCIAL DIAGNOSIS

- [x] Source classes for numbers.
- [x] Exposure vs recovery vs actual ROI separation.
- [x] Missed-call calculator rules.
- [x] Estimate pipeline rules.
- [x] Capacity calculation rules.
- [x] Attribution/reactivation rules.
- [x] Deterministic calculator tool.

---

# 8. HUMAN ASSIST / CRM

- [x] Human Assist workflow.
- [x] CRM stages/dispositions.
- [x] ProspectStatement provenance.
- [x] Follow-up semantics.
- [x] Requested callback priority.
- [x] Durable outbox.
- [x] DNC workflow.
- [x] First human launch plan.

---

# 9. CONVERSATION / VOICE

- [x] Detailed state machine.
- [x] Turn-taking/latency policy.
- [x] Realtime provider benchmark plan.
- [x] Twilio integration spec.
- [x] AMD/voicemail strategy defined for benchmark.
- [x] Barge-in/cancellation.
- [x] Number/email/date verbalization.
- [x] Tool action truth rules.

---

# 10. QA / ROLEPLAY

- [x] Manual 12-point scorecard encoded.
- [x] Hard-fail taxonomy.
- [x] 25+ scenario roleplay spec.
- [x] Critical machine-readable roleplay fixtures.
- [x] QA grader contract.
- [x] Research correction tests.
- [x] No-sale tests.
- [x] DNC/booking/tool failure tests.

---

# 11. COMPLIANCE / SAFETY

- [x] Deterministic compliance engine architecture.
- [x] Federal/state/contact-basis/line-type review template.
- [x] Autonomous AI cold voice defaults disabled/review-required.
- [x] DNC durable/fail-closed.
- [x] Calling-window/timezone framework.
- [x] Recording/transcription separate flags.
- [x] AI identity/impersonation boundary.
- [ ] Formal legal/company policy review completed for real autonomous prospect campaign — intentionally deferred until before real pilot.

---

# 12. SECURITY / OPERATIONS

- [x] Authentication/RBAC.
- [x] Secrets/server-side controls.
- [x] Multi-gate production dial enablement.
- [x] Global kill switch.
- [x] Durable DB/queue/leases/idempotency.
- [x] Provider webhook/WSS validation requirement.
- [x] Data retention/privacy architecture.
- [x] Audit/log redaction.
- [x] Backup/restore.
- [x] Incident response runbook.
- [x] Local development/test safeguards.

---

# 13. SERVICES / WORKERS

- [x] Internal API/domain contracts.
- [x] Job queue/worker orchestration.
- [x] Provider fakes/testing strategy.
- [x] Long-running async task model.
- [x] Provider failure/degradation behavior.

---

# 14. ANALYTICS / ECONOMICS

- [x] Analytics event taxonomy.
- [x] Sales funnel metrics.
- [x] Market Miner quality metrics.
- [x] Provider economics.
- [x] Unit economics from search to opportunity.
- [x] Advertiser vs generic cohort comparison plan.
- [x] Future learned propensity separated from canonical score.

---

# 15. CLAUDE EXECUTION

- [x] Gate-based engineering backlog.
- [x] Market Miner-first build order.
- [x] First Gate 0 task defined.
- [x] No external provider spend in normal unit tests.
- [x] No real prospect calls during normal development.
- [x] Human Assist Gate 8 before autonomous production.
- [x] Explicit stop-for-approval before real autonomous pilot.

---

# 16. ITEMS INTENTIONALLY NOT FINALIZED IN ARCHITECTURE

These require implementation benchmarking, live environment inspection, legal review or business data:

- final SERP provider routing;
- final DB library/migration package;
- final queue implementation;
- final realtime LLM/STT/TTS stack;
- final Twilio ConversationRelay vs alternative transport choice;
- formal autonomous calling policy by jurisdiction/contact basis;
- final external CRM vendor mapping;
- learned score weights;
- scaled national territory/query allocation;
- future vertical order after HVAC/Plumbing.

Claude must not treat these as architecture omissions to invent silently; it should benchmark/audit/report according to the relevant gate.

---

# 17. V1 ARCHITECTURE READY CONDITION

Architecture V1 is ready for Claude Gate 0 when:

- architecture index/handoff/backlog reference current docs;
- cross-document terminology is reconciled;
- corrected fixtures are current;
- first-market acceptance criteria exist;
- implementation gates and engineering epics exist;
- production autonomous dialing remains disabled.

After that, additional architecture work should primarily respond to implementation discoveries rather than continue speculative overdesign.
