# Your AI Department — Unified Human Review Queue Specification

**Status:** Architecture authority  
**Purpose:** Route ambiguous or high-impact decisions to the correct human reviewer instead of forcing the AI/system to guess.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

`UNKNOWN` and `REVIEW_REQUIRED` are useful system states only if they lead somewhere operationally.

The Review Queue centralizes issues that should not be silently resolved by an LLM.

---

# 2. REVIEW CATEGORIES

Canonical:

- IDENTITY
- VERTICAL_CLASSIFICATION
- EVIDENCE_CLAIM
- ADVERTISER_IDENTITY
- WEBSITE_RESEARCH
- CONTACT_IDENTITY
- DUPLICATE_MERGE
- TECHNICAL_INTEGRATION
- SECURITY_PRIVACY
- PROFESSIONAL_BOUNDARY
- COMMERCIAL_PRICING
- PROMISE_AUTHORITY
- PROPOSAL_READINESS
- COMPLIANCE_POLICY
- DNC_SCOPE
- DATA_RETENTION_SOURCE_TERMS
- QA_HARD_FAIL
- DELIVERY_HANDOFF_CONFLICT
- OTHER_ADMIN.

---

# 3. REVIEW ITEM

`ReviewItem`

- review_id
- category
- priority
- account/opportunity/call/proposal IDs as applicable
- triggering event
- question requiring decision
- relevant evidence/records
- system recommendation optional
- uncertainty/reason
- created_at
- due_at optional
- assigned_role
- assigned_user optional
- state
- decision
- decision_reason
- reviewer
- decided_at
- downstream_actions[]

---

# 4. PRIORITIES

## P0 — SAFETY / CONTACT STOP

Examples:

- DNC storage conflict
- unauthorized production call
- security incident
- sensitive boundary violation.

May pause campaign/system.

## P1 — BLOCKING ACTIVE RELATIONSHIP

- meeting/proposal blocker
- integration promise pending
- identity conflict before contact
- commercial approval.

## P2 — NORMAL OPERATIONS

- vertical ambiguity
- contact conflict
- merge review
- research correction.

## P3 — QUALITY / BACKLOG

- new negative query proposal
- new tech signature review
- learning proposal.

---

# 5. ASSIGNMENT ROLES

Possible reviewer roles:

- sales_manager
- research_ops
- technical_owner
- security_privacy
- commercial_approver
- compliance_policy_owner
- delivery_owner
- system_admin
- business_owner.

Do not send every question to Michael by default.

---

# 6. IDENTITY REVIEW

Show:

- candidate source records
- domains
- phones
- addresses
- names
- parent/franchise relationships
- merge confidence
- historical contact state.

Reviewer may:

- merge
- keep separate
- parent/link
- mark aggregator/noise
- request more research.

All reversible/audited.

---

# 7. VERTICAL REVIEW

Show evidence per possible profile.

Example:

GC site mentions roofing but no dedicated service page.

Reviewer decides:

- confirmed Roofing
- secondary/likely
- not Roofing
- request more evidence.

Classification decision never modifies Module 4C points directly.

---

# 8. EVIDENCE / CLAIM REVIEW

Examples:

- site says 24/7 but footer hours conflict
- two public phone numbers
- provider says closed, site active
- current ad identity ambiguous.

Reviewer decides claim state; source history preserved.

---

# 9. CONTACT REVIEW

Show:

- raw titles
- source dates
- first-party vs enrichment
- location/account scope
- prior conversation corrections.

No automatic personal-data expansion beyond approved sources.

---

# 10. TECHNICAL REVIEW

For integration/capability question:

- requested workflow
- system/vendor
- required data/actions
- known API/docs
- authentication
- security/privacy
- client access
- feasibility result
- limitations.

Output becomes verification record for Promise Registry/Scope Compiler.

---

# 11. COMMERCIAL REVIEW

For:

- custom price
- discount
- payment terms
- scope change
- SLA/support
- exclusivity.

Show:

- current CommercialTruthSnapshot
- approved quote
- scope
- requested concession
- economics if appropriate.

Decision creates auditable authority record.

---

# 12. COMPLIANCE REVIEW

Policy/legal/company owner reviews:

- jurisdiction/line/contact basis ambiguity
- recording/transcription settings
- AI voice policy
- DNC scope conflict
- channel eligibility.

Sales/LLM does not override.

---

# 13. REVIEW STATE

- OPEN
- ASSIGNED
- IN_REVIEW
- NEEDS_INFORMATION
- DECIDED_APPROVED
- DECIDED_REJECTED
- DECIDED_ALTERNATIVE
- SUPERSEDED
- CLOSED_NO_ACTION.

---

# 14. BLOCKING EFFECT

Every review type declares what it blocks.

Examples:

Identity conflict:
- blocks outreach/merge-dependent research.

Technical integration:
- may allow strategy meeting but blocks integration promise/proposal scope.

New query proposal:
- does not block current campaign.

---

# 15. SLA / AGING

Manager dashboard shows:

- blocking reviews overdue
- review category backlog
- average decision time
- repeated issue type.

Do not invent universal SLA; configure operationally.

---

# 16. DECISION REUSE

Some reviewed decisions may become reusable knowledge.

Examples:

- verified provider adapter field meaning
- approved tech signature
- known integration capability version
- common false-positive domain.

Reuse only within scope/version; do not generalize client-specific integration proof to every client automatically.

---

# 17. LEARNING PROPOSALS

If same review occurs repeatedly, learning engine may propose deterministic rule.

Example:

> 45 reviewed PDR “training” sites were non-service businesses. Recommend stronger negative pattern.

Human approves rule change.

---

# 18. REVIEW AUDIT

Store:

- what system believed before
- evidence shown
- reviewer decision
- rule/version affected
- downstream objects changed.

This is critical for later debugging and quality improvement.

---

# 19. ACCEPTANCE TESTS

1. Two similar HVAC companies -> identity review blocks outreach until resolved.
2. GC incidental roofing -> vertical review.
3. Provider says closed/site active -> evidence review.
4. Prospect asks CCC integration -> technical review blocks promise, not strategy conversation.
5. Rep requests discount -> commercial review.
6. DNC scope ambiguous -> conservative policy state/review, no sales override.
7. New query candidate -> P3 review, campaign keeps running approved queries.
8. Review decides wrong contact -> target refreshed.
9. Repeated reviewed noise -> proposal for new exclusion rule.
10. Reviewer decision preserves original evidence/history.

---

# 20. CORE RULE

The brain should know when it does not know. Human Review is where uncertainty becomes an explicit decision instead of a hidden hallucination.
