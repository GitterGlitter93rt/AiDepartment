# Your AI Department — Proposal Compiler Specification

**Status:** Architecture authority  
**Purpose:** Generate a controlled proposal draft from approved discovery/scope/commercial truth after Proposal Readiness Gate passes.  
**Source doctrine:** Sales Manual Module 9.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

The proposal compiler is a document-generation system, not a sales-imagination system.

It may assemble and explain approved truth.

It may not create:

- new scope
- new pricing
- unsupported integrations
- invented ROI
- hidden recurring costs
- guaranteed results
- implementation dates not approved.

---

# 2. INPUTS

Required:

- ProposalReadinessReport = READY or approved READY_WITH_EXPLICIT_ASSUMPTIONS
- ScopeRecommendation
- current-state workflow
- desired future-state workflow
- qualification snapshot
- economic/business-case scenario
- CommercialTruthSnapshot
- approved custom pricing/terms
- technical verification results
- client responsibilities
- human review points
- success metrics
- third-party costs
- exclusions
- stakeholder/decision process

---

# 3. OUTPUT

`ProposalDraft`

- proposal_id
- account/opportunity
- version
- readiness_report_id
- commercial_truth_version
- scope_version
- sections[]
- pricing_source
- assumptions[]
- exclusions[]
- third_party_costs[]
- approval_status
- generated_at
- required_reviewers[]

Client-facing PDF/doc generation may happen downstream; the structured proposal is source of truth.

---

# 4. RECOMMENDED SECTIONS

For meaningful projects:

1. Executive Summary
2. Current-State Finding
3. Business Impact / Opportunity
4. Objectives
5. Recommended Future-State Workflow
6. Scope of Work
7. Deliverables
8. Human Responsibilities / Human Review
9. Technical Assumptions and Dependencies
10. Success Metrics / Baseline
11. Implementation Phases / Approach
12. Investment
13. Third-Party Costs
14. Exclusions / Out of Scope
15. Client Responsibilities
16. Next Steps / Approval

Simpler engagement may use fewer sections.

---

# 5. EXECUTIVE SUMMARY RULE

Lead with client business situation.

Good:

> “Discovery identified inconsistent after-hours lead capture and follow-up across paid call sources. YAD recommends a phased response and CRM workflow…”

Bad:

> “YAD leverages revolutionary cutting-edge artificial intelligence…”

---

# 6. CURRENT STATE

Must be prospect-confirmed or strategy-validated.

Represent visually/structurally:

`Trigger -> System/Person -> Handoff -> Failure/Constraint -> Outcome/Measurement`

If current-state confirmation changes after draft, invalidate/regenerate affected sections.

---

# 7. BUSINESS IMPACT

Use prospect/client numbers where possible.

Separate:

- theoretical exposure
- realistically recoverable scenario
- investment/payback/ROI scenario where appropriate.

Every assumption labeled.

Range scenarios may be used when uncertainty exists:

- conservative
- expected
- aggressive

Do not reverse-engineer assumptions to make ROI attractive.

---

# 8. FUTURE STATE

Show business flow before technology.

Example:

`Lead -> CRM -> Source -> Acknowledgment -> Owner -> Follow-Up -> Outcome -> Reporting`

Then describe supporting systems.

Use language:

> “The exact technology/integrations remain subject to the validated technical assumptions in this scope.”

where applicable.

---

# 9. SCOPE LANGUAGE

Each scope item should state:

- business objective
- YAD action
- deliverable
- system/dependency
- human review
- success metric.

Avoid vague phrases:

- automate sales
- build AI
- optimize everything.

---

# 10. INVESTMENT

Use only approved custom quote / current commercial truth.

Display calmly.

Do not add apology language or automatic discount.

If scope has optional phase/add-on, separate clearly.

---

# 11. THIRD-PARTY COSTS

For every known external platform/service:

- item
- included/separate/client-paid/estimated/TBD
- recurring/one-time/usage-based
- assumptions.

Never bury usage fees.

---

# 12. TIMELINE

Use approved phases/milestones.

Exact dates only when delivery/technical owner has approved them.

No AI-generated “2 weeks” because it sounds reasonable.

---

# 13. HUMAN REVIEW

Proposal must explicitly include human responsibility in sensitive/high-impact workflow.

Examples:

- legal review
- clinical judgment
- repair/safety judgment
- sales close
- exception handling
- content approval.

---

# 14. RESPONSIBILITIES

YAD responsibilities and client responsibilities should be visually distinct.

Do not let client dependency hide inside technical assumptions.

---

# 15. SUCCESS MEASUREMENT

For each KPI:

- metric
- baseline
- baseline source/status
- target or measurement approach
- measurement window
- data source.

If no baseline:

`Baseline to be established during Phase 1.`

---

# 16. NEXT STEP

Proposal should end with actual approval path:

- review meeting
- signer
- technical condition if any
- contracting/payment process
- kickoff requirements.

Not merely:

> “Let us know what you think.”

---

# 17. LIVE REVIEW REQUIRED FLAG

Significant proposals default to `live_review_required = true`.

If prospect requests document first:

- send approved proposal
- schedule review.

---

# 18. VERSIONING / CHANGE CONTROL

Any scope/pricing/assumption change creates new proposal version.

Store diff:

- added/removed scope
- changed price
- changed assumption
- changed integration status
- changed KPI
- changed responsibility.

No silent edits after client sees version.

---

# 19. APPROVAL WORKFLOW

Possible reviewers:

- sales manager
- technical/delivery owner
- security/privacy reviewer
- finance/commercial approver
- legal/contract reviewer where appropriate.

Proposal cannot move to client-ready until required approvals complete.

---

# 20. ACCEPTANCE TESTS

1. Readiness not passed -> compiler refuses client proposal.
2. Current state not confirmed -> section blocked.
3. Economic scenario uses prospect estimate -> labeled correctly.
4. Unverified integration appears -> only assumption/TBD, not confirmed deliverable.
5. Third-party SaaS usage -> inclusion status explicit.
6. Healthcare workflow -> human/privacy sections included.
7. Price not authorized -> proposal cannot become client-ready.
8. Scope change after price -> new version required.
9. Major proposal -> live review flag on.
10. No-sale outcome -> no proposal compiled.

---

# 21. CORE RULE

The proposal compiler documents a decision YAD has earned through discovery. It must never use polished writing to hide weak scope, missing evidence, or unresolved technical truth.
