# Your AI Department — Decision Trace & Observability Specification

**Status:** Architecture authority  
**Purpose:** Make every important Prospect Factory / Sales Brain decision explainable, replayable, and debuggable from discovery through follow-up.  
**Implementation owner:** Claude Code

---

# 1. CORE QUESTION

For any Account, YAD should be able to answer:

- Where did we find this business?
- Which searches showed it?
- Why did we merge these records?
- Which facts do we believe and why?
- Why is it Tier A?
- Why is this the primary hypothesis?
- Why are we targeting this role?
- Why is it ranked #4 today?
- What did the prospect correct?
- What did we promise?
- Why was a tool called?
- Which versions of prompts/manual/profile/policy were active?

If we cannot answer those questions, the system is too opaque.

---

# 2. TRACE IDENTITY

Every major run has IDs:

- mining_job_id
- search_task_id
- research_run_id
- identity_resolution_run_id
- score_snapshot_id
- strategy_run_id
- call_pack_id
- queue_decision_id
- compliance_decision_id
- attempt/call_id
- followup_task_id
- QA_review_id

All should link back to Account and campaign.

---

# 3. PROSPECT TIMELINE

Admin view should reconstruct:

1. discovered
2. source observations
3. identity merge/link
4. website resolved
5. evidence created
6. profile assignment
7. score calculated
8. hypothesis generated
9. contact target selected
10. Call Pack created
11. queue entered
12. leased to rep
13. contacted
14. prospect statements/corrections
15. outcome
16. follow-up/meeting
17. refresh
18. later research changes.

---

# 4. “WHY THIS SCORE?”

Display exact Module 4C components.

Example:

- Google active +4 — Evidence E123
- high-value economics +2 — HVAC profile business-model rule
- lead flow important +2 — profile rule + visible intake
- emergency +1 — website 24/7 evidence E131
- estimate-heavy +1 — profile rule
- phone dependent +1 — profile rule
- form/booking +1 — website evidence E144

Total 12 / Tier A.

Do not show hidden modifiers.

---

# 5. “WHY THIS HYPOTHESIS?”

Show:

**Hypothesis:** Paid after-hours lead handling

Supporting:

- current emergency AC ad
- 24/7 website
- phone-first CTA

Unknown:

- missed-call rate
- after-hours staffing
- overflow system

Prohibited claim:

- company is losing calls.

---

# 6. “WHY THIS CONTACT?”

Example:

**Target:** Operations Director

Reason:

- primary hypothesis is call/after-hours workflow
- first-party leadership page current
- operations owns intake/dispatch more directly than marketing

Fallback:

- GM
- owner.

---

# 7. “WHY #4 IN QUEUE?”

Show ordered comparator:

- no callback commitment
- campaign priority 1
- Tier A / 13
- advertiser strength STRONG
- hypothesis STRONG
- research COMPLETE
- named current operations contact
- ready since 2 hours ago.

Also show why #1 outranks it, e.g. requested callback due.

---

# 8. EVIDENCE VIEW

Every EvidenceRecord shows:

- normalized claim
- value
- confidence
- lifecycle
- source type
- source reference
- observed_at
- expires_at
- can_state_as_fact
- contradicted/superseded links

Admin can inspect source when permitted.

---

# 9. IDENTITY MERGE TRACE

Show why two observations map to same Account:

- exact domain
- exact phone
- address
- provider ID
- fuzzy name
- reviewer override.

If fuzzy/ambiguous, show confidence and review history.

Merge/unmerge should be auditable.

---

# 10. PROMPT / KNOWLEDGE TRACE

For every conversation/strategy output store versions/hashes of:

- invariant system policy
- CommercialTruthSnapshot
- vertical profile
- Call Pack
- Sales Manual chunks retrieved
- conversation state
- tool availability
- model/provider version.

Do not necessarily store secrets/full internal prompts in broad-access UI; retain secure debug references.

---

# 11. TOOL TRACE

For tool calls:

- requested action
- validated input
- permission/policy result
- execution result
- latency
- provider ID
- retry/idempotency key
- caller-visible claim made after result.

Example:

Booking requested -> provider error -> fallback task created -> agent said “I couldn't lock that time in, but I can have the team confirm it.”

This proves no false-success assertion.

---

# 12. RESEARCH CORRECTION TRACE

Example:

Public signal:
ServiceTitan booking widget.

Prospect:
> “We moved to Housecall Pro.”

Timeline shows:

- old signal remains historical
- prospect statement created
- current system memory changed
- hypothesis/Call Pack refreshed
- research-correction event logged.

---

# 13. COST TRACE

Per Account show attributed provider usage:

- paid SERP tasks
- website render
- contact enrichment
- refresh
- telecom/model later.

Useful questions:

> Why did this prospect cost $0.84 to research while another cost $0.09?

---

# 14. FAILURE TRACE

A failed pipeline should show where and how it degraded.

Example:

- paid SERP complete
- website blocked
- contact provider timeout
- research PARTIAL
- Call Pack allowed only generic hook
- no named contact
- queue remains Human Assist only.

No silent failure.

---

# 15. REPLAY

For deterministic stages, allow replay using stored inputs/version snapshots:

- scoring
- vertical routing
- opportunity ranking
- ready queue comparator
- compliance decisions
- follow-up eligibility.

Replay should not hit live providers unless explicitly requested.

---

# 16. DIFF VIEW

When a new version changes result, show:

Before:
Tier B 8

After refresh:
Tier A 12

Why:
- new current Google ad +4

Or:

Before primary hook: after-hours
After prospect correction: attribution

Why:
- prospect confirmed strong after-hours answering workflow.

---

# 17. AUDIENCE / ACCESS

Rep:
- business-facing evidence and reasons

Manager:
- queue/scoring/relationship trace

Admin/technical:
- provider/debug/version/tool details

Sensitive prompt/security logs restricted.

---

# 18. ALERTABLE EVENTS

Observability should surface:

- DNC write failure
- duplicate-contact collision
- provider cost spike
- queue starvation
- stale inventory spike
- research correction spike
- unsupported claim QA fail
- false-success tool claim
- voice p95 regression
- database/outbox backlog.

---

# 19. ACCEPTANCE TESTS

1. Pick any Tier A prospect -> UI/API explains every point.
2. Same company found by six queries -> trace shows six observations, one Account.
3. Prospect correction -> before/after strategy diff visible.
4. Requested callback -> queue reason visible.
5. DNC -> suppression event and future exclusion visible.
6. Booking failure -> exact tool result and spoken fallback visible.
7. Stale ad -> trace shows why ad opener became disallowed.
8. Provider outage -> partial research state and fallback visible.
9. Profile ambiguity -> router evidence/review visible.
10. Historical call replay -> exact profile/manual/commercial versions resolvable.

---

# 20. CORE RULE

No critical business decision in the Sales Brain should exist only inside a model's hidden reasoning. The system should preserve the evidence, rules, versions and outputs needed to explain what happened.
