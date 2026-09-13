# Your AI Department — Personalized Prospect Demo Brain

**Status:** Architecture authority  
**Purpose:** Turn researched/qualified prospect context into a safe, relevant YAD demo that illustrates the workflow under discussion without pretending an unverified integration or result already exists.  
**Implementation owner:** Claude Code

---

# 1. CORE PRINCIPLE

A demo should answer:

> “What would this workflow look like for a business like yours?”

not:

> “Look at all the cool AI things we can do.”

The demo follows confirmed discovery.

It does not create the sales diagnosis.

---

# 2. DEMO ELIGIBILITY

Generate personalized demo when:

- prospect has engaged;
- primary workflow/objective is understood;
- demo can be shown safely without unverified promises;
- correct human/professional boundaries are known;
- demo improves the next decision.

Do not spend time creating deep demos for every cold lead.

---

# 3. DEMO TYPES

Canonical categories:

- AI_phone_overflow
- missed_call_recovery
- speed_to_lead
- CRM_followup_pipeline
- unsold_estimate_or_proposal_followup
- scheduling_and_no_show
- lead_reactivation
- source_to_revenue_attribution
- customer_status_communication
- document_admin
- internal_knowledge_assistant
- employee_capacity_workflow
- multi_location_dashboard
- market_launch_system
- AI_governance_example
- website_conversion_flow

Profiles determine allowed/relevant types.

---

# 4. DEMO SELECTION INPUTS

`DemoContext`

- Account / vertical
- qualification snapshot
- prospect-verified workflow
- primary problem
- current systems
- desired state
- human-required boundaries
- technical unknowns
- requested demo type if any
- decision-maker/stakeholders
- commercial truth
- approved demo assets

---

# 5. DEMO BRIEF

`DemoBrief`

- demo_id
- account_id
- objective
- scenario
- confirmed context used
- synthetic assumptions
- systems shown
- integration status labels
- steps to demonstrate
- expected user roles
- human escalation points
- what demo proves
- what demo does NOT prove
- next discovery questions
- technical follow-ups

---

# 6. SYNTHETIC DATA DEFAULT

Unless prospect explicitly provides approved data in the appropriate workflow, demo uses synthetic records.

Examples:

- fictional customer names
- fake phone numbers
- synthetic estimate values
- synthetic appointments
- synthetic lead sources

Do not copy real customer/client/patient/case data from a prospect website into a demo.

---

# 7. AI PHONE DEMO

Example HVAC qualified problem:

- office cannot always answer simultaneous/after-hours calls
- ServiceTitan used
- exact integration not yet verified.

Demo may show:

1. synthetic customer calls about no-cool issue;
2. agent collects approved non-technical intake;
3. agent offers scheduling/callback workflow;
4. conversation summary created;
5. **simulated** CRM handoff displayed clearly as simulated until integration is verified;
6. human escalation shown.

Never say:

> “This is already connected to your ServiceTitan.”

unless technically implemented/verified.

---

# 8. CRM FOLLOW-UP DEMO

Roofing example:

Synthetic pipeline:

- proposal sent
- day 3 follow-up
- financing question
- salesperson task
- next-action date
- status/lost reason
- dashboard stale proposal value.

Demo shows consistency around salesperson, not replacement of salesperson.

---

# 9. ATTRIBUTION DEMO

Show conceptual chain:

`Campaign -> Lead -> Conversation -> Appointment/Estimate -> Sale -> Revenue`

Use synthetic data unless connected data is approved.

If real system linkage is unknown, label:

`Integration to be verified`.

Do not imply YAD can automatically solve offline conversion tracking without source-system access.

---

# 10. REACTIVATION DEMO

Use synthetic segmented database:

- stale estimate
- future timing
- no-show
- prior customer

Show:

- segmentation
- approved sequence concept
- response routing
- DNC/opt-out
- human handoff.

Do not demo blasting the entire database indiscriminately.

---

# 11. HEALTHCARE / LAW DEMOS

## Law

Use fictional potential-client records and administrative intake scenarios.

No legal advice/case-merit demo.

## Dental / Med Spa

Use fictional inquiries/appointments.

No diagnosis/treatment suitability demo.

Do not use real PHI.

Privacy/security architecture must be clearly separated from a UI mock/demo.

---

# 12. COLLISION / RESTORATION SAFETY

Collision demo:

- estimate intake
- customer communication
- CRM follow-up
- source attribution

not repairability/safety decisions.

Restoration demo:

- emergency intake/routing
- document/admin/status workflow

not mitigation scope/coverage.

---

# 13. DEMO NARRATIVE

Recommended flow:

1. “Here is the workflow you described.”
2. “Here is the specific handoff we are testing.”
3. demonstrate improved workflow
4. show human decision point
5. show measurement/output
6. explain assumptions/technical verification still required
7. ask whether future state matches desired outcome.

---

# 14. DEMO DOES NOT EQUAL PROPOSAL

A good demo may reveal:

- system already solves it;
- integration difficult;
- data unavailable;
- different problem more important.

Update qualification after demo.

Do not force scope because a demo exists.

---

# 15. DEMO ASSET REGISTRY

Version reusable components:

- phone scenario
- CRM pipeline mock
- attribution dashboard mock
- no-show flow
- reactivation flow
- status automation
- internal knowledge assistant

Metadata:

- verticals allowed
- claims/boundaries
- current version
- required setup
- demo-only limitations.

---

# 16. PERSONALIZATION RULES

May personalize:

- company name
- market
- confirmed service
- confirmed public CTA
- confirmed CRM/system if relevant
- confirmed workflow from prospect.

Must label synthetic:

- numbers
- customer records
- revenue
- volumes
- conversion results.

---

# 17. DEMO SUCCESS METRICS

Track:

- demo requested
- demo delivered
- workflow relevance rating
- technical questions surfaced
- next meeting/proposal
- no-sale after demo

Do not optimize demos purely for wow-factor.

---

# 18. ACCEPTANCE TESTS

1. HVAC with missed-call pain -> phone/overflow demo, no technical HVAC advice.
2. Roofing unsold proposals -> CRM follow-up demo, not receptionist demo.
3. Law intake -> fictional admin intake, no case decision.
4. Dental no-show -> scheduling/recovery demo, no patient diagnosis.
5. Existing CRM integration unverified -> demo labels integration simulated.
6. Prospect provides no business problem -> no elaborate personalized demo generated automatically.
7. Demo uses synthetic financial values -> clearly labeled.
8. Demo reveals strong existing workflow -> no-sale/alternate discovery allowed.
9. Real customer data visible on public website -> not copied into demo.
10. Requested competitor/system integration -> verify capability before claiming live integration.

---

# 19. CORE RULE

A personalized demo should make the prospect's desired future workflow tangible while being painfully clear about what is real, what is simulated, and what still requires technical verification.
