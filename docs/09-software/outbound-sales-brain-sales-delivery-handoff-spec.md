# Your AI Department — Sales-to-Delivery Handoff Specification

**Status:** Architecture authority  
**Purpose:** Ensure every sold YAD engagement transfers the exact problem, scope, assumptions, promises, stakeholders, technical unknowns, human boundaries, and success measures to implementation before work begins.  
**Source doctrine:** Sales Manual Module 9 Sales-to-Delivery Handoff.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

If delivery is surprised by what sales promised, the sales process failed.

A signed proposal is not enough context.

Delivery needs to know:

- why the client bought;
- what problem matters most;
- what the client believes YAD will do;
- what was excluded;
- what remains uncertain;
- what business value was discussed;
- who has authority;
- what would make the client call the project successful.

---

# 2. HANDOFF PACKAGE

`DeliveryHandoffPackage`

- client Account/Locations
- engagement/opportunity ID
- executive sponsor
- operational owner
- technical owner
- other stakeholders
- primary problem statement
- current-state workflow
- desired future-state workflow
- qualification snapshot
- sold commercial offer family
- proposal version
- contract/approval reference
- scope items[]
- deliverables[]
- explicit exclusions[]
- assumptions[]
- client responsibilities[]
- systems/integrations[]
- integration verification status
- data/security/privacy requirements
- human-review requirements
- baseline metrics
- ROI/business-case assumptions
- success metrics
- business timing/deadlines
- third-party costs/responsibility
- promises made[]
- open questions[]
- risks[]
- pilot/phase design
- sales owner
- delivery owner
- handoff status

---

# 3. PROMISE LEDGER

Handoff includes every material sales promise from:

- calls
- emails
- demos
- strategy meeting
- proposal
- negotiation.

Each promise shows:

- exact/normalized commitment
- source
- authority status
- verification status
- proposal scope item if applicable
- delivery owner

No promise remains hidden in transcript only.

---

# 4. INTEGRATION MATRIX

For each system:

- system name
- role in workflow
- access owner
- verified integration status
- authentication/access expected
- data direction
- sensitive data class
- unresolved technical questions
- third-party vendor dependency.

Example:

`ServiceTitan | CRM/field service | client admin | likely_needs_validation | lead write + outcome read TBD`

Delivery can challenge weak assumptions before kickoff.

---

# 5. HUMAN RESPONSIBILITY MAP

Explicitly list decisions that remain human.

Examples:

- sales closes customer
- attorney decides legal matter/case acceptance
- clinician diagnoses/treats
- electrician makes technical/safety decisions
- collision technician/estimator makes repair decisions
- client approves messaging/content
- manager handles exceptions.

This protects implementation from accidentally automating beyond sold boundaries.

---

# 6. BASELINE / MEASUREMENT

For each success metric:

- baseline value
- source
- measurement method
- baseline-required flag
- target/decision threshold if approved
- review milestone.

If baseline does not exist:

first implementation phase may be measurement.

---

# 7. ROI ASSUMPTION TRANSFER

Business case inputs must show source.

Example:

- 400 calls/month — prospect estimate
- 8% missed — unknown; baseline measurement required
- $900 average customer value — client estimate
- 10% scenario recovery — illustrative assumption.

Delivery must not treat illustrative assumptions as performance commitments.

---

# 8. CLIENT RESPONSIBILITIES

Visible before kickoff:

- system access
- API/vendor access
- data exports
- security requirements
- SME availability
- approvals
- testing feedback
- designated users
- training participation
- decision turnaround.

Missing dependencies should become kickoff blockers/tasks.

---

# 9. BUSINESS TIMING

Record real urgency only:

- busy season
- software renewal
- location opening
- marketing launch
- hail market
- hiring decision
- compliance deadline if verified
- board/leadership deadline.

Do not transfer fake urgency created by sales.

---

# 10. FORMAL HANDOFF CALL

For meaningful engagements, conduct a sales-to-delivery call before or at kickoff.

Sales explains:

1. why client bought;
2. problem priority;
3. business case;
4. client expectation;
5. scope/exclusions;
6. open technical questions;
7. stakeholder dynamics;
8. success definition.

Delivery may challenge unclear assumptions.

The handoff is not ceremonial.

---

# 11. DELIVERY ACCEPTANCE

Delivery owner can mark:

- ACCEPTED
- ACCEPTED_WITH_ACTIONS
- BLOCKED_CLARIFICATION_REQUIRED
- BLOCKED_SCOPE_CONFLICT
- BLOCKED_TECHNICAL_FEASIBILITY
- BLOCKED_COMMERCIAL_CONFLICT

A signed sale does not force delivery to pretend an impossible promise is feasible.

Escalate conflicts before implementation begins.

---

# 12. SALES REMAINS INVOLVED, BUT DOES NOT BYPASS DELIVERY

Sales may join:

- kickoff
- milestone reviews
- expectation clarification
- expansion discovery
- case-study capture.

Sales may not independently add scope or make new client commitments without delivery/commercial alignment.

---

# 13. CHANGE REQUESTS AFTER SALE

New request becomes:

- clarification within scope
- change request
- later phase
- new opportunity.

Do not silently absorb:

- website rebuild
- extra integrations
- more locations
- extra departments
- unlimited revisions

because client mentioned them after signing.

---

# 14. KICKOFF READINESS

Before kickoff, verify:

- delivery owner assigned
- sponsor/operational owner confirmed
- contract/approval complete
- access plan
- initial client tasks
- scope/exclusions acknowledged
- high-risk technical questions assigned
- baseline plan
- first milestone.

---

# 15. CASE-STUDY MEASUREMENT SEED

If appropriate and approved, handoff can create a measurement record for potential future case study:

- pre-project workflow
- baseline
- target KPI
- scope
- measurement method
- review milestones.

This does NOT authorize public use.

Only verified approved results may later become sales evidence.

---

# 16. EXPANSION MEMORY

Post-implementation opportunity discovery should start from:

- original problems
- results achieved
- unresolved issues
- new bottlenecks
- departments not in original scope.

Expansion follows diagnose -> quantify -> prioritize -> recommend.

Not random upselling.

---

# 17. HANDOFF QUALITY SCORE

Managers may grade:

1. problem clarity
2. scope clarity
3. promise accuracy
4. integration status clarity
5. business-case provenance
6. stakeholder completeness
7. human-boundary clarity
8. success measurement
9. client responsibility clarity
10. open-risk clarity.

Hard fail:

Delivery discovers a material unsupported promise that sales failed to record.

---

# 18. ACCEPTANCE TESTS

1. Proposal includes verified HubSpot integration -> handoff contains exact verification and access owner.
2. Proposal says integration TBD -> handoff keeps it unresolved, not implied supported.
3. Sales told client “we'll check whether CCC integration is possible” -> appears as open task, not promise.
4. Dental project -> privacy/clinical human boundaries explicit.
5. Roofing project -> insurance/legal boundaries explicit if relevant.
6. Baseline unknown -> measurement task at kickoff.
7. Client requests extra location after signing -> change request/phase, not silent scope.
8. Delivery finds commercial conflict -> BLOCKED_COMMERCIAL_CONFLICT.
9. Sales promised approved material -> promise ledger confirms authority.
10. No hidden transcript-only commitment.

---

# 19. CORE RULE

Sales closes the business case; delivery inherits a precise contract with reality. Every important expectation must survive the handoff intact and auditable.
