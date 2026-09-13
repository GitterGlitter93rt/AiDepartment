# Your AI Department — Client Outcome, Evidence & Expansion Brain

**Status:** Architecture authority  
**Purpose:** Measure implemented YAD work against agreed baselines, preserve verified results, identify new legitimate opportunities, and prevent future sales from inventing case studies or random upsells.  
**Source doctrine:** Sales Manual Module 9 sections on success measurement, case-study capture, expansion, and no-sale.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

A sold project should create evidence.

Not marketing fiction.

The system should answer:

- What did we agree to improve?
- What was the baseline?
- What was implemented?
- What changed?
- What cannot be attributed confidently?
- Did the client achieve the success threshold?
- What new bottleneck/opportunity is now visible?
- Is expansion justified?

---

# 2. MEASUREMENT PLAN

At kickoff define per KPI:

- metric
- baseline
- baseline source
- measurement method
- data system
- review frequency
- target/decision threshold
- owner
- limitations.

If baseline unknown, establish before claiming improvement.

---

# 3. OUTCOME RECORD

`ClientOutcomeRecord`

- client_account
- engagement_id
- scope_item
- metric
- baseline_value
- baseline_source
- post_value
- post_source
- measurement_window
- change
- attribution_confidence
- confounding_factors[]
- verified_by
- client_confirmed boolean
- eligible_for_internal_evidence boolean
- eligible_for_public_case_study boolean
- approval_reference optional
- notes

---

# 4. ATTRIBUTION CONFIDENCE

Possible:

- strong
- moderate
- weak
- not_attributable

Example:

Response time dropped from 42 minutes to 3 minutes immediately after workflow launch with stable input channel -> potentially strong operational attribution.

Revenue rose 30% while ad spend, sales staff, seasonality and market conditions all changed -> weak causal attribution to YAD alone.

Do not overclaim.

---

# 5. KPI FAMILIES

Possible:

- lead response time
- missed-call recovery rate
- CRM capture completeness
- follow-up compliance
- appointment rate
- no-show rate
- estimate/proposal follow-up
- conversion rate
- processing time
- repetitive employee hours
- reporting time
- attribution coverage
- pipeline visibility
- employee adoption
- customer-response SLA.

Use only metrics tied to actual scope.

---

# 6. BEFORE / AFTER WORKFLOW

Store structured workflow snapshots:

Before:

`Call -> voicemail -> manual callback -> unknown outcome`

After:

`Call -> overflow capture -> CRM -> callback task -> outcome tracked`

This can become internal learning evidence even if revenue attribution remains uncertain.

---

# 7. MILESTONE REVIEWS

Possible checkpoints:

- launch
- 30 days
- 60 days
- 90 days
- project-specific milestone

Do not force 30/60/90 when engagement cycle does not fit.

---

# 8. CASE-STUDY CANDIDATE

A result becomes candidate only when:

- baseline credible
- post metric credible
- scope clear
- timeframe clear
- limitations known
- client approval path identified.

Candidate is not automatically public.

---

# 9. PUBLIC EVIDENCE APPROVAL

Before sales/website can use result:

- verify metric/source
- confirm attribution wording
- obtain required client permission
- define approved wording
- define forbidden wording
- assign review date.

Then add to approved Evidence/Card registry.

No salesperson/model may use raw project outcome as public proof before approval.

---

# 10. EXAMPLE CLAIM DISCIPLINE

Verified:

Response time improved from 30 minutes to under 5 minutes during measured period.

Approved claim might be:

> “During the measured pilot, median lead response time fell from approximately 30 minutes to under 5 minutes.”

Not:

> “YAD increased revenue 6x.”

unless that exact causal claim is independently supportable and approved.

---

# 11. EXPANSION DISCOVERY

After reviewing results ask:

1. Did primary workflow improve?
2. What did data reveal?
3. What bottleneck moved downstream?
4. Which unscoped workflow now matters most?
5. Is another department/location seeing similar issue?
6. Is ongoing optimization/governance warranted?

Expansion follows same doctrine:

Diagnose -> Quantify -> Prioritize -> Recommend.

---

# 12. EXPANSION OPPORTUNITY OBJECT

`ExpansionOpportunity`

- client_account
- originating_engagement
- newly_observed_problem
- source
- workflow
- economic_relevance
- priority
- affected_department/location
- current systems
- qualification_stage
- recommended_next_step

Do not auto-create proposal merely because client is existing customer.

---

# 13. MANAGED AI DEPARTMENT PATH

A one-time client may become ongoing candidate if results show:

- multiple departments/opportunities
- recurring optimization need
- roadmap/governance requirement
- employee adoption/training
- ongoing vendor/technology change.

Use current custom pricing.

Do not convert every implementation client into a retainer by default.

---

# 14. DELIVERY-TO-SALES FEEDBACK

Sales brain should receive approved internal outcome metadata:

- which vertical/workflow
- implementation feasibility lessons
- common client blockers
- adoption issues
- provider/integration truth
- actual measured KPI patterns.

This improves future discovery and scope without fabricating public case studies.

---

# 15. IMPLEMENTATION FEASIBILITY LEARNING

Examples:

- integration consistently difficult
- certain CRM supports workflow well
- certain handoff needs client data cleanup
- phone workflow performs poorly without updated hours/dispatch data.

These become technical/architecture lessons, not automatically sales promises.

---

# 16. CLIENT HEALTH / RISK

Track:

- adoption
- access delays
- unresolved dependencies
- scope conflicts
- metric quality
- stakeholder engagement
- support issues.

Do not use client-health data to make deceptive scarcity/upsell pressure.

---

# 17. NO EXPANSION

Valid when:

- client achieved goal and has no further priority
- next opportunity economics weak
- adoption capacity limited
- existing systems already solve it
- technical constraints
- client explicitly does not want expansion.

Respect it.

---

# 18. ACCEPTANCE TESTS

1. Response-time baseline/post measured -> internal verified outcome possible.
2. Revenue rose with several confounders -> no strong causal YAD revenue claim.
3. Client has not approved public use -> no public case study.
4. Successful HVAC phone workflow reveals weak estimate follow-up -> create new discovery opportunity, not automatic proposal.
5. One-off project finishes cleanly/no new need -> no forced retainer.
6. Multiple departments now need ongoing roadmap -> Managed AI Department candidate, custom pricing only.
7. No baseline -> cannot claim improvement until baseline/alternative evidence established.
8. Sales brain learns integration limitation -> technical lesson, not client-facing claim unless verified/approved.
9. Client asks not to be used as case study -> public eligibility false.
10. Scope delivered but KPI unchanged -> record accurately; do not cherry-pick unrelated metric.

---

# 19. CORE RULE

Client results become compounding business intelligence only when YAD measures them honestly. Expansion should be earned by new diagnosis, and public proof should be earned by verification and permission.
