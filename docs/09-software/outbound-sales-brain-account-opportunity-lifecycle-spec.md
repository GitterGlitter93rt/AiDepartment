# Your AI Department — Account / Opportunity Lifecycle State Machine

**Status:** Architecture authority  
**Purpose:** Define the complete business lifecycle from discovered company through research, outreach, opportunity, proposal, client delivery, measurement, and future expansion without resetting or duplicating relationship state.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

Account identity, research state, relationship state, opportunity state, and delivery state are different dimensions.

Do not overload one `status` field with everything.

A company can simultaneously be:

- Research: COMPLETE
- Relationship: FOLLOW_UP
- Opportunity: MEASUREMENT_FIRST
- Campaign: ELIGIBLE_PLUMBING
- Delivery: none.

Use separate state machines with explicit transitions.

---

# 2. ACCOUNT IDENTITY STATE

Possible:

- DISCOVERED
- IDENTITY_PARTIAL
- IDENTITY_RESOLVED
- IDENTITY_CONFLICTED
- MERGED_CANONICAL
- CLOSED_NONOPERATING
- EXCLUDED_NOISE

Identity state does not imply sales fit.

---

# 3. RESEARCH STATE

- NOT_RESEARCHED
- QUEUED
- RESEARCHING
- PARTIAL
- COMPLETE
- STALE_LIGHT
- STALE_BLOCKING
- REFRESHING
- FAILED_RETRYABLE
- FAILED_REVIEW_REQUIRED

---

# 4. VERTICAL ASSIGNMENT STATE

Per profile:

- UNASSESSED
- LIKELY
- CONFIRMED
- REVIEW_REQUIRED
- EXCLUDED_FOR_PROFILE
- HISTORICAL

An Account may hold several profile assignments.

---

# 5. CAMPAIGN ELIGIBILITY STATE

Per campaign:

- NOT_EVALUATED
- ELIGIBLE
- BLOCKED_RESEARCH
- BLOCKED_DUPLICATE
- BLOCKED_POLICY
- BLOCKED_EXISTING_RELATIONSHIP
- BLOCKED_CAPACITY
- SUPPRESSED
- COMPLETED

---

# 6. RELATIONSHIP STATE

Canonical:

- NEVER_CONTACTED
- ATTEMPTED_NO_CONTACT
- VOICEMAIL
- GATEKEEPER
- WRONG_CONTACT
- DECISION_MAKER_CONTACTED
- POSSIBLE_OPPORTUNITY
- REQUESTED_CALLBACK
- EMAIL_INFORMATION_REQUESTED
- QUALIFIED_FOLLOWUP
- MEETING_BOOKED
- MEETING_HELD
- NURTURE_FUTURE
- NOT_INTERESTED
- NO_SALE_CURRENTLY
- DISQUALIFIED
- DNC

Relationship is account-wide with contact-level detail.

---

# 7. OPPORTUNITY STATE

Separate opportunity object begins when legitimate business issue/objective exists.

- POSSIBLE
- QUALIFIED_DISCOVERY
- MEASUREMENT_FIRST
- TECHNICAL_REVIEW
- STRATEGY_ENGAGEMENT_CANDIDATE
- IMPLEMENTATION_CANDIDATE
- MANAGED_RELATIONSHIP_CANDIDATE
- PROPOSAL_NOT_READY
- PROPOSAL_READY
- PROPOSAL_PRESENTED
- NEGOTIATION_DECISION
- CLOSED_WON
- CLOSED_LOST
- NO_SALE
- DEFERRED

One Account may eventually have several Opportunities over time.

---

# 8. PROPOSAL STATE

- NOT_APPLICABLE
- GATE_NOT_READY
- DRAFTING
- INTERNAL_REVIEW
- TECHNICAL_REVIEW
- COMMERCIAL_REVIEW
- CLIENT_READY
- SENT_PENDING_REVIEW
- REVIEW_SCHEDULED
- PRESENTED
- REVISION_REQUESTED
- APPROVED
- DECLINED
- SUPERSEDED

Proposal versions are immutable after client exposure.

---

# 9. ENGAGEMENT / DELIVERY STATE

After closed won:

- CONTRACTING_PAYMENT
- HANDOFF_PREPARATION
- DELIVERY_REVIEW
- KICKOFF_BLOCKED
- KICKOFF_READY
- ACTIVE_DISCOVERY_VALIDATION
- ACTIVE_BUILD
- ACTIVE_INTEGRATION
- ACTIVE_TESTING
- ACTIVE_TRAINING
- DEPLOYED
- MEASUREMENT_OPTIMIZATION
- COMPLETE
- ONGOING_MANAGED
- PAUSED
- CANCELLED

---

# 10. MEASUREMENT / EVIDENCE STATE

Per KPI/outcome:

- BASELINE_REQUIRED
- BASELINE_ESTABLISHED
- MEASURING
- RESULT_AVAILABLE
- VERIFIED_INTERNAL
- CASE_STUDY_CANDIDATE
- PUBLIC_APPROVAL_PENDING
- PUBLIC_APPROVED
- PUBLIC_REJECTED
- EXPIRED_REVIEW_REQUIRED

---

# 11. EXPANSION STATE

- NONE
- NEW_SIGNAL
- DISCOVERY_REQUIRED
- QUALIFIED
- DEFERRED
- PROPOSAL_PATH
- NO_EXPANSION

Expansion creates a new Opportunity rather than mutating old engagement into unrelated scope.

---

# 12. IMPORTANT TRANSITION RULES

## Research -> Ready

Requires:

- valid Account identity
- profile/campaign context
- sufficient fresh research
- score snapshot
- Call Pack/strategy
- policy/relationship gates.

## Contact -> Opportunity

Requires:

- prospect confirms legitimate workflow/objective or enough reason for deeper discovery.

## Opportunity -> Proposal Ready

Requires Proposal Readiness Gate.

## Proposal -> Won

Requires approved commercial process/contract state.

## Won -> Kickoff

Requires Delivery Handoff acceptance.

## Complete -> Expansion

Requires new diagnosis, not automatic upsell.

---

# 13. DNC OVERRIDE

DNC/contact suppression can coexist with:

- existing customer delivery
- booked meetings if policy determines appropriate handling
- internal records.

It blocks prohibited outbound contact, not necessarily deletion of Account/project history.

LLM cannot clear DNC state.

---

# 14. WRONG CONTACT DOES NOT KILL ACCOUNT

If person is wrong role:

- update contact status
- preserve Account fit/research
- route to correct role
- respect contact-specific suppression.

---

# 15. NO-SALE CURRENTLY VS DISQUALIFIED

`NO_SALE_CURRENTLY`:

- company may be good fit generally
- current workflow strong / no priority / timing wrong.

`DISQUALIFIED`:

- weak fit/economics/inappropriate objective/no legitimate target.

Future refresh/nurture policy differs.

---

# 16. CLOSED LOST REASONS

Standardized:

- no_priority
- no_budget
- weak_business_case
- technical_infeasible
- security_privacy_blocker
- stakeholder_no_alignment
- timing
- chose_other_solution
- existing_system_sufficient
- unsupported_scope_expectation
- no_response_after_process
- other_reviewed.

Do not record insulting subjective labels.

---

# 17. EXISTING CUSTOMER REDISCOVERY

If Market Miner rediscovers current client:

- identify Account as existing relationship
- do not cold-call
- optionally surface research as account intelligence/expansion signal
- route through account owner/customer-success process.

---

# 18. CALLBACK / MEETING PRIORITY

Requested callback/meeting state overrides ordinary cold queue.

Transitions include exact time/timezone/owner.

If callback completed, create new relationship/outcome state.

---

# 19. MULTI-OPPORTUNITY ACCOUNT

Example:

HVAC client first buys missed-call workflow.

Later marketing attribution becomes a new Opportunity.

Keep:

- shared Account identity
- shared relationship history
- separate opportunity scope/economics/proposal/delivery.

---

# 20. STATE CHANGE EVENT

Every material transition logs:

- object type/id
- old state
- new state
- reason code
- actor (human/system)
- source event
- timestamp
- policy/version if relevant.

No silent status changes.

---

# 21. INVALID TRANSITIONS

Examples:

- NEVER_CONTACTED -> CLOSED_WON without opportunity/commercial process unless manually migrated legacy client with explicit reason
- DNC -> cold call eligible by model decision
- PROPOSAL_NOT_READY -> CLIENT_READY without gate/override
- CLOSED_WON -> ACTIVE_BUILD before delivery handoff/kickoff controls
- PUBLIC_CASE_STUDY without approval.

System should reject invalid transition or require authorized migration path.

---

# 22. MIGRATION / IMPORT

Legacy CRM/imported data may enter at later lifecycle state.

Require:

- migration reason
- source
- known/unknown fields
- imported state confidence.

Do not fabricate missing historical steps.

---

# 23. DASHBOARD VIEW

Show separate columns/badges:

- Research
- Relationship
- Opportunity
- Proposal
- Delivery
- Expansion

This prevents ambiguous “Status: Active.”

---

# 24. ACCEPTANCE TESTS

1. Tier A researched/no contact -> Research COMPLETE, Relationship NEVER_CONTACTED, no Opportunity.
2. Conversation confirms pain -> Relationship POSSIBLE_OPPORTUNITY + Opportunity QUALIFIED_DISCOVERY.
3. Measurement unknown -> Opportunity MEASUREMENT_FIRST.
4. Proposal gate fails -> Proposal GATE_NOT_READY, Opportunity remains discovery/technical review.
5. Proposal approved -> Opportunity CLOSED_WON + Engagement HANDOFF_PREPARATION.
6. Delivery blocks unsupported promise -> KICKOFF_BLOCKED until resolved.
7. Project complete -> delivery COMPLETE; no automatic expansion.
8. New opportunity after results -> new Opportunity ID.
9. Existing client rediscovered in Google search -> no cold queue.
10. DNC rediscovered -> remains blocked for outbound per policy.

---

# 25. CORE RULE

A business relationship is not one status. Keep identity, research, contact, opportunity, proposal, delivery, and expansion states separate so the system knows exactly what has happened and what is allowed next.
