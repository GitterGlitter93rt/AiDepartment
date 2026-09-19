# Your AI Department — Proposal Readiness Gate

**Status:** Architecture authority  
**Purpose:** Prevent proposals from being generated or presented before the business problem, assumptions, technical path, responsibilities, measurement, and commercial truth are sufficiently defined.  
**Source doctrine:** Sales Manual Module 9 Proposal Quality Gate.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

A proposal is not a brainstorming document.

It records a business recommendation the prospect should already understand.

The system therefore needs a deterministic gate before proposal generation.

---

# 2. GATE RESULT

Possible results:

- `READY`
- `READY_WITH_EXPLICIT_ASSUMPTIONS`
- `NEEDS_DISCOVERY`
- `NEEDS_TECHNICAL_REVIEW`
- `NEEDS_COMMERCIAL_APPROVAL`
- `NEEDS_STAKEHOLDER_ALIGNMENT`
- `NOT_RECOMMENDED`

Proposal generator may only produce a client-presentable proposal for `READY` or approved `READY_WITH_EXPLICIT_ASSUMPTIONS`.

---

# 3. REQUIRED QUESTIONS

The gate should answer:

1. Is the business problem clearly defined?
2. Did the prospect confirm the current workflow?
3. Is impact measured, responsibly estimated, or explicitly baseline-required?
4. Are ROI assumptions sourced/labeled?
5. Does recommendation solve the actual problem?
6. Is human review defined where necessary?
7. Is technical feasibility verified enough for promises in scope?
8. Is scope specific?
9. Are exclusions explicit?
10. Are third-party costs explicit/TBD?
11. Are client responsibilities explicit?
12. Are success metrics defined?
13. Is commercial investment/authority valid?
14. Are decision stakeholders identified?
15. Is next step explicit?

---

# 4. CRITICAL VS NONCRITICAL GAPS

Critical gaps block proposal.

Examples:

- no confirmed problem
- mandatory integration unknown
- sensitive workflow without human/security review
- unsupported pricing
- solution path unclear
- no desired outcome.

Noncritical gap may become explicit assumption/TBD if appropriate.

Example:

Exact monthly Twilio usage cost cannot be known before call volume; proposal can show pricing basis/estimated usage separately if approved.

---

# 5. PROBLEM CONFIRMATION

Required evidence:

- prospect-verified workflow/problem OR
- strategy engagement deliverable confirming the issue.

Public research/hypothesis alone is never enough for a custom implementation proposal.

---

# 6. CURRENT-STATE WORKFLOW CONFIRMATION

Proposal must have a recognizable current-state workflow.

If prospect says diagram is wrong:

- update discovery
- regenerate readiness
- do not proceed with old diagnosis.

---

# 7. FINANCIAL CLAIM GATE

Each proposal financial number must be classed:

- client/system verified
- prospect estimate
- external benchmark
- illustrative assumption

Any unlabeled material number blocks financial presentation.

If no defensible business case exists, do not invent one.

---

# 8. SOLUTION FEASIBILITY GATE

For every scope item:

- system involved
- integration status
- data requirement
- dependency
- human decision point
- known limitation.

Unsupported essential feature -> proposal blocked or explicitly removed from scope.

---

# 9. SECURITY / PROFESSIONAL GATE

For relevant workflows, require:

- privacy/security review status
- human-required boundary
- approved data class/access
- professional stakeholder as appropriate.

Examples:

- law confidentiality
- healthcare PHI/BAA consideration
- electrical/restoration safety
- collision repair judgment.

---

# 10. COMMERCIAL TRUTH GATE

Proposal pricing/offer must come from current CommercialTruthSnapshot plus approved custom quote/authority.

Never use stale manual pricing if launch decisions changed.

Managed AI Department pricing remains custom unless current authority says otherwise.

---

# 11. DISCOUNT / TERMS AUTHORITY

Proposal stores:

- list/custom approved investment
- pricing approver
- discount if any
- discount authority/reference
- payment terms
- term authority

Unapproved concession blocks final proposal.

---

# 12. STAKEHOLDER GATE

Before major proposal presentation, know enough about:

- signer/decision-maker
- champion
- operational owner
- IT/security if required
- legal/compliance if required
- finance/procurement if required.

Missing stakeholder may yield `NEEDS_STAKEHOLDER_ALIGNMENT`.

---

# 13. CLIENT RESPONSIBILITY GATE

Implementation cannot be scoped responsibly without knowing required client participation.

At minimum where relevant:

- system access
- SME availability
- data
- approvals
- testing
- employee training/adoption
- security requirements.

---

# 14. SUCCESS-METRIC GATE

Every scope should identify what success means.

If baseline unknown:

metric can be:

`Baseline measurement required in Phase 1.`

Do not promise improvement against a nonexistent baseline.

---

# 15. OUT-OF-SCOPE GATE

Proposal should protect against scope ambiguity.

Examples depending project:

- unsupported/custom integrations
- data migration beyond agreed size
- advertising spend
- third-party subscriptions
- creative production
- extra locations/departments
- legal/compliance advice
- custom software beyond defined deliverables.

Do not copy a generic exclusion list blindly; select relevant exclusions.

---

# 16. READINESS REPORT

`ProposalReadinessReport`

- opportunity_id
- result
- checks[]
- blockers[]
- assumptions[]
- unresolved_questions[]
- technical_reviews[]
- commercial_approval_status
- stakeholder_status
- generated_at
- gate_version

---

# 17. MANAGER OVERRIDE

Manager may approve `READY_WITH_EXPLICIT_ASSUMPTIONS` when assumptions are legitimate and visible.

Manager may NOT override:

- fabricated truth
- illegal/unsafe scope
- unapproved pricing/authority
- known unsupported capability portrayed as supported.

Overrides are audited.

---

# 18. ACCEPTANCE TESTS

1. Public research only, no discovery -> NEEDS_DISCOVERY.
2. Confirmed workflow but mandatory CRM API unknown -> NEEDS_TECHNICAL_REVIEW.
3. Defined implementation + verified integration + metrics + approved price -> READY.
4. Unknown baseline but measurement phase explicit -> READY_WITH_EXPLICIT_ASSUMPTIONS possible.
5. Managed relationship pricing invented -> NEEDS_COMMERCIAL_APPROVAL / block.
6. Law workflow includes confidential data but no security review -> NEEDS_TECHNICAL_REVIEW.
7. Prospect wants AI legal judgment -> NOT_RECOMMENDED for that scope.
8. Missing signer for major project -> NEEDS_STAKEHOLDER_ALIGNMENT.
9. Proposal includes third-party phone/model costs with no inclusion status -> not ready.
10. Strong workflow/no meaningful opportunity -> NOT_RECOMMENDED.

---

# 19. CORE RULE

The proposal gate exists to protect the client, YAD sales, and YAD delivery from the same failure: selling certainty that discovery did not earn.
