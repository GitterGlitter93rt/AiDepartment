# Your AI Department — Solution Scope Compiler Specification

**Status:** Architecture authority  
**Purpose:** Convert qualified discovery into the correct level of YAD commercial next step without fabricating implementation scope when the solution is still uncertain.  
**Source doctrine:** Sales Manual Module 9.  
**Implementation owner:** Claude Code

---

# 1. CORE PRINCIPLE

The system should match the sale to the level of certainty.

A prospect saying:

> “We want AI.”

is not enough to generate an implementation proposal.

The Scope Compiler asks:

> What do we know about the problem, future state, technical path, economics, stakeholders, human boundaries, and measurement plan — and what commercial next step is responsible at this level of certainty?

---

# 2. CERTAINTY LEVELS

## LEVEL 0 — NOT ENOUGH DISCOVERY

Use when:

- problem vague
- no workflow mapped
- curiosity only
- no priority
- no owner.

Possible next step:

- additional discovery
- free assessment / strategy call according to current CommercialTruthSnapshot
- no sale.

## LEVEL 1 — PROBLEM IDENTIFIED, SOLUTION NOT FULLY DEFINED

Use when:

- meaningful opportunity exists
- multiple workflows/departments
- build-vs-buy unclear
- ROI needs more data
- security/governance significant
- technical environment complex.

Possible commercial next step:

- Executive AI Strategy
- deeper paid strategy engagement according to current commercial truth.

## LEVEL 2 — DEFINED PROBLEM + FEASIBLE IMPLEMENTATION PATH

Use when:

- current workflow sufficiently known
- desired future state known
- technical requirements reasonably understood
- critical integrations verified enough for scope
- client responsibilities known
- success can be measured.

Possible next step:

- AI Implementation proposal.

## LEVEL 3 — MULTIPLE ONGOING OPPORTUNITIES

Use when:

- several departments/workflows
- recurring optimization/training/governance
- ongoing ownership needed
- relationship clearly broader than one implementation.

Possible next step:

- Managed AI Department custom relationship according to current commercial truth.

Do not force prospects through every level.

---

# 3. SCOPE READINESS INPUT

`ScopeReadinessContext`

- Account
- OpportunityQualificationSnapshot
- StrategyMeetingBrief/output
- validated current-state workflow(s)
- desired-state workflow(s)
- economic inputs/scenarios
- systems inventory
- integration verification results
- data/privacy/security requirements
- human-required decisions
- stakeholders / decision process
- client responsibilities
- success metrics / baseline status
- implementation dependencies
- current CommercialTruthSnapshot

---

# 4. READINESS DIMENSIONS

Evaluate separately:

- `problem_definition`
- `current_state_validation`
- `desired_state_definition`
- `economic_case_quality`
- `technical_feasibility`
- `data_availability`
- `security_privacy_review`
- `human_review_definition`
- `stakeholder_alignment`
- `client_responsibility_definition`
- `success_measurement_definition`
- `scope_boundary_clarity`

States:

- ready
- partial
- missing
- blocked
- not_applicable

Do not average a blocked critical dependency into a misleading “84% ready.”

---

# 5. CRITICAL BLOCKERS

Implementation proposal is blocked when required and unresolved:

- core integration feasibility
- data access
- security/privacy requirement
- legal/professional boundary
- human approval design
- required client system access
- basic desired outcome
- success measurement
- commercial authority/pricing.

Correct output may be technical review or strategy engagement.

---

# 6. FUTURE-STATE WORKFLOW

Scope should compile from a business workflow, not feature wish list.

Example:

`Lead -> CRM Record -> Source Captured -> Immediate Acknowledgment -> Assigned Owner -> Appropriate Qualification -> Appointment/Next Step -> Follow-Up -> Outcome -> Reporting`

Then technology maps to those steps.

Do not start with:

`GPT + Zapier + Twilio + dashboard`.

---

# 7. SCOPE ITEM OBJECT

`ScopeItem`

- scope_item_id
- business_objective
- current_state_problem
- future_state_step
- YAD_responsibility
- client_responsibility
- systems_involved[]
- integration_status
- data_inputs[]
- human_review_point
- success_metric
- dependency_ids[]
- exclusion_ids[]
- phase
- verification_status

---

# 8. INTEGRATION STATUS

Canonical:

- verified_supported
- likely_needs_validation
- unknown_review_required
- unsupported
- client_managed
- not_required

Only `verified_supported` may be stated as confirmed capability for this specific scope.

Do not interpret generic API availability as proven implementation feasibility.

---

# 9. BASELINE STATUS

Each KPI:

- known_verified
- prospect_estimate
- baseline_measurement_required
- unavailable

If baseline unknown:

include initial measurement phase rather than inventing improvement percentage.

---

# 10. PILOT COMPILER

Recommend pilot when:

- customer reaction uncertain
- AI reliability must be validated
- integration complexity
- multi-location rollout
- adoption uncertain
- economics promising but not proven.

Pilot must define:

- workflow
- users/location
- success metrics
- milestone/test period
- expansion decision rule.

Pilot is not an automatic discount.

---

# 11. PHASE COMPILER

Possible generic phases:

1. Discovery / Validation
2. Design
3. Configuration / Build
4. Integration
5. Testing
6. Training
7. Deployment
8. Measurement / Optimization

Use only phases required by the scope.

Do not invent exact calendar dates before dependencies/timeline are approved.

---

# 12. SCOPE REDUCTION

When prospect cannot justify full project:

possible output:

`Priority Phase 1`

rather than same work at arbitrary discount.

Example:

Full:
CRM + phone + attribution + dashboards + reactivation

Phase 1:
Lead capture + response + CRM pipeline.

Scope reduction must preserve the primary business outcome.

---

# 13. CLIENT RESPONSIBILITIES

Compile only relevant requirements:

- system credentials/access
- workflow SME availability
- data
- vendor/API access
- employee testing
- messaging approval
- privacy/security requirements
- decision turnaround
- training attendance.

The proposal should expose dependencies rather than hide them.

---

# 14. THIRD-PARTY COSTS

For each known external cost:

- provider
- cost category
- included / separate / client-paid / estimated / TBD
- usage assumptions
- recurring/one-time

Never hide phone/model/SMS/CRM/API costs to make YAD price appear smaller.

---

# 15. HUMAN RESPONSIBILITY COMPILER

Explicitly generate:

- AI drafts -> employee approves
- AI collects -> professional reviews
- automation routes -> salesperson decides/closes
- routine updates automate -> employee handles exceptions

Sensitive profiles carry stricter rules automatically.

---

# 16. SUCCESS-METRIC COMPILER

Choose only metrics tied to the business case.

Examples:

- response time
- missed-call recovery
- leads entering CRM
- follow-up compliance
- appointment rate
- no-show rate
- estimate follow-up
- processing time
- repetitive hours
- reporting time
- attribution coverage.

If baseline missing, mark baseline measurement required.

---

# 17. COMMERCIAL NEXT-STEP OUTPUT

`ScopeRecommendation`

- certainty_level
- recommended_offer_family
- reason
- proposal_ready boolean
- blockers[]
- scope_items[]
- phases[]
- pilot_recommended
- client_responsibilities[]
- third_party_costs[]
- human_review_points[]
- success_metrics[]
- assumptions[]
- exclusions[]
- open_questions[]

---

# 18. NO-PROPOSAL OUTPUT

If certainty insufficient:

say exactly why.

Example:

`Implementation proposal not ready: integration feasibility, baseline volume, and client security requirements are unresolved. Recommend Executive AI Strategy / technical validation.`

Do not fill gaps with generic boilerplate.

---

# 19. ACCEPTANCE TESTS

1. Multi-location company with five AI ideas/no priorities -> Level 1 Strategy, not implementation.
2. HVAC missed-call workflow fully mapped + integration verified + KPIs known -> Level 2 Implementation.
3. Broad ongoing multi-department roadmap -> Level 3 Managed relationship candidate, pricing still current custom truth.
4. Specific integration mandatory but unknown -> implementation blocked pending technical review.
5. Baseline unknown -> scope includes measurement phase.
6. Healthcare data workflow privacy unresolved -> blocked/technical review.
7. Prospect wants same full scope 25% cheaper -> suggest scope reduction only if legitimate; no unauthorized discount.
8. Strong existing workflow -> no proposal/no-sale.
9. Pilot appropriate for one of 12 locations -> pilot scope with expansion decision rule.
10. Third-party Twilio/model costs unknown -> marked TBD/separate, not hidden.

---

# 20. CORE RULE

The Scope Compiler must make it harder to sell the wrong project. Uncertainty should produce a smaller, more diagnostic next step — never a more confident proposal.
