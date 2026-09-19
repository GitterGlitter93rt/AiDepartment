# Your AI Department — Implementation Gate Document Map

**Status:** Current Claude reading map  
**Start file:** `OUTBOUND-SALES-BRAIN-V1-CURRENT.md`

Claude does not need to reread every architecture file at every gate. Use this map.

---

# ALWAYS READ / KEEP ACTIVE

- `CLAUDE.md`
- `brain/PHONE-AGENT.md`
- `docs/00-company/launch-decisions.md`
- `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md`
- `docs/09-software/outbound-sales-brain-consistency-decisions.md`
- `docs/09-software/outbound-sales-brain-implementation-gates.md`

When implementing sales behavior, relevant Sales Manual source is also authority.

---

# GATE 0 — AUDIT

Read:

- master spec
- Claude handoff
- current manifest
- security/operations
- local development/test spec
- Twilio telephony spec
- existing `phone-agent/` code
- current deployment/runtime files.

Output Gate 0 audit template.

---

# GATE 1 — DATA MODEL

Read:

- data contract
- consistency decisions
- storage/indexing spec
- claim registry
- entity-resolution spec
- CRM/follow-up spec
- data retention/privacy spec.

---

# GATE 2 — SCORING

Read:

- Sales Manual Module 4C
- scoring/research fixtures v1.0.1+
- claim registry
- consistency decisions
- advertiser evidence-strength spec.

---

# GATE 3 — VERTICAL PROFILE

Read:

- vertical-profile schema
- HVAC YAML
- Plumbing YAML
- Sales Manual HVAC/Plumbing modules
- profile generation/governance.

---

# GATE 4 — GOOGLE ADVERTISER MINER

Read:

- Market Miner prospect factory
- geography engine
- provider blueprint
- provider interface contracts
- provider benchmark plan
- Google search matrix
- observation sampling
- advertiser evidence strength
- claim registry
- unit economics
- job queue.

---

# GATE 5 — ENTITY RESOLUTION

Read:

- entity-resolution spec
- data contract
- storage/indexing
- import/export spec
- end-to-end gold fixtures.

---

# GATE 6 — WEBSITE INTELLIGENCE

Read:

- website-intelligence spec
- research orchestration
- claim registry
- vertical profile
- data-quality SLO
- contact enrichment for team/role extraction context.

---

# GATE 7 — MARKET MINER END-TO-END

Read:

- Jacksonville/St. Augustine HVAC acceptance pack
- end-to-end gold fixtures
- data-quality SLO
- campaign/replenishment
- unit economics
- provider benchmark/routing report
- all Gate 2–6 outputs.

---

# GATE 8 — HUMAN ASSIST

Read:

- admin/control-plane spec
- Human Assist workflow
- CRM/follow-up
- lead import/export
- first launch plan
- service API contracts
- security/RBAC.

---

# GATE 9 — SALES MANUAL RAG

Read:

- Sales Manual RAG spec
- prompt composition
- CommercialTruthSnapshot spec
- Sales Manual README/modules relevant to gold tests.

---

# GATE 10 — CALL PACK

Read:

- Call Pack spec
- offer selection
- prompt composition
- CommercialTruthSnapshot
- business-case calculator
- vertical profile
- current ResearchProfile/Evidence semantics.

---

# GATE 11 — TEXT ROLEPLAY

Read:

- conversation state machine
- roleplay certification
- critical roleplay fixtures
- QA grader
- action tools
- prompt composition
- relevant Sales Manual prospecting/objection modules.

---

# GATE 12 — COMPLIANCE SOFTWARE

Read:

- compliance engine
- compliance policy review template
- security/operations
- retention/privacy
- action tools DNC semantics.

Do not fill legal policy gaps by inference.

---

# GATE 13 — REALTIME BENCHMARK

Read:

- realtime voice policy
- realtime provider benchmark
- conversation state machine
- prompt composition
- QA/roleplay fixtures.

---

# GATE 14 — TWILIO CONTROLLED

Read:

- Twilio telephony spec
- security/operations
- realtime voice policy
- action tools
- local test spec
- incident runbook.

---

# GATE 15 — ACTION TOOLS

Read:

- action tools
- CRM/follow-up
- business-case calculator
- service API contracts
- CommercialTruthSnapshot
- security/operations.

---

# GATE 16 — AUDIO CERTIFICATION

Read:

- roleplay certification
- critical roleplay fixtures
- QA grader
- realtime benchmark output
- incident runbook.

---

# GATE 17 — REAL MICRO-PILOT

STOP.

Requires explicit Michael approval plus reviewed compliance policy.

Read:

- compliance policy actual populated version
- first launch/pilot plan adapted for autonomous cohort
- incident response
- analytics/unit economics
- all prior gate reports.

---

# GATE 18 — SCALE

Only after pilot review.

Read:

- campaign/replenishment
- analytics/learning
- data quality
- unit economics
- incident history
- provider quality/cost reports.

---

# IMPLEMENTATION RULE

When a gate reveals a real architecture conflict:

- stop that decision;
- document evidence/options;
- ask Michael/architecture owner only for the genuinely product-level decision.

Do not silently choose a behavior that changes scoring, offers, compliance, or sales doctrine.
