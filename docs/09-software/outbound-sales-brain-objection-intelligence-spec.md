# Your AI Department — Objection Intelligence Engine

**Status:** Architecture authority  
**Purpose:** Classify objections/brush-offs, retrieve approved guidance, choose concise follow-up questions, and learn objection patterns without letting the live model improvise unsupported promises.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

An objection is information.

The goal is not to “overcome” every objection.

The system should determine:

- Is this a brush-off, real constraint, misunderstanding, trust concern, timing issue, value concern, technical blocker, professional boundary, or genuine no-fit?
- What short response is supported by the Sales Manual?
- What question would clarify the real issue?
- Should the conversation continue, follow up later, route to technical review, or end?

---

# 2. OBJECTION OBJECT

`ObjectionEvent`

- objection_id
- account_id
- conversation_id
- vertical_profile
- normalized_category
- raw_prospect_language
- detected_at
- current_state
- response_guidance_id
- response_used
- follow_up_question
- outcome_after_objection
- hard_boundary boolean
- QA_flags[]

---

# 3. OBJECTION CATEGORIES

Canonical categories:

- brush_off_send_email
- busy_now
- already_have_crm
- already_have_receptionist
- already_have_answering_service
- already_have_marketing_agency
- already_have_it_provider
- already_use_chatgpt_ai
- relationship_human_preference
- privacy_security
- professional_judgment
- integration_uncertainty
- price_cost
- no_budget
- timing_not_now
- need_to_think
- need_partner_stakeholder
- ROI_guarantee_request
- AI_not_ready
- staff_replacement_concern
- bad_prior_automation_experience
- no_problem
- wrong_person
- not_interested
- DNC
- other_review_required

DNC is not a normal objection; it triggers priority suppression behavior.

---

# 4. BRUSH-OFF VS TRUE OBJECTION

Example:

> “Just send me something.”

Possible meanings:

- genuinely interested but busy
- wants proof/context
- polite dismissal

Do not launch a five-minute objection response.

Ask one small relevance question if appropriate:

> “Absolutely — should I send the piece around missed calls, CRM follow-up, or attribution?”

If they do not engage, send only policy-approved concise information or end.

---

# 5. EXISTING CRM

Approved principle:

Existing CRM is usually positive context.

Response direction:

> “Good. The question isn't whether you have one — it's what happens automatically after a lead enters and whether the calls/forms/follow-up/attribution are connected.”

Then ask a workflow question.

Never:

- attack the CRM
- assume poor adoption
- promise replacement is needed.

---

# 6. EXISTING RECEPTIONIST / STAFF

Principle:

Do not attack the employee.

Explore:

- simultaneous-call overflow
- after-hours
- repetitive intake
- scheduling
- missed-call recovery
- routine admin

Response direction:

> “That's good. We're not trying to replace the receptionist. I'm interested in what happens when demand exceeds one person's simultaneous capacity or after the office closes.”

---

# 7. MARKETING AGENCY

Principle:

Agency and YAD are not automatically competitors.

Ask:

- what happens after lead acquisition
- can source tie to customer/revenue
- speed/follow-up
- CRM handoff.

Never claim the agency is wasting money without evidence.

---

# 8. IT PROVIDER

Principle:

IT owns infrastructure/support/security in many businesses; YAD may work alongside them.

Ask:

- who owns workflow/process/automation
- what technical review is required
- whether IT should join strategy discussion.

Do not claim YAD replaces IT.

---

# 9. “WE USE CHATGPT”

Principle:

Distinguish individual tool use from governed repeatable business workflow.

Possible response:

> “That makes sense. The question is whether it's being used as an individual tool or connected to repeatable business workflows with the right data, review, and permissions.”

For law/healthcare, governance/privacy becomes especially important.

---

# 10. HUMAN PREFERENCE

Examples:

> “Our customers want humans.”

Approved direction:

Agree where human judgment/relationship matters; investigate admin/overflow/support around it.

Do not argue that customers prefer AI.

---

# 11. PRICE

If prospect asks price before scope:

- use only current CommercialTruthSnapshot;
- distinguish fixed approved offers from custom implementation;
- do not invent project price;
- explain that workflow/scope determines implementation.

Never create a discount to rescue the call unless explicit authority exists.

---

# 12. GUARANTEED ROI

Never guarantee.

Response direction:

> “We shouldn't promise a result before looking at your actual baseline. We can model an illustrative scenario, but the first step is measuring the workflow and using your numbers.”

---

# 13. INTEGRATION CLAIM

If asked:

> “Does this work with X?”

Allowed if verified in current technical truth.

If not:

> “We'd need to verify that specific integration before I promise it.”

Create technical review task.

---

# 14. PRIVACY / SECURITY

Do not say:

> “It's HIPAA compliant.”

> “It's secure.”

without appropriate verified scope.

Response should acknowledge the requirement and route to technical/security review.

Healthcare/law profiles add stronger boundaries.

---

# 15. PROFESSIONAL JUDGMENT

Examples:

- “AI can't decide legal cases.”
- “AI can't diagnose patients.”
- “AI can't decide electrical safety.”

Correct response:

Agree.

Then position YAD around appropriate workflow/admin/intake/follow-up/communication/reporting.

The objection may actually demonstrate the prospect understands a boundary YAD already shares.

---

# 16. STAFF REPLACEMENT CONCERN

YAD doctrine is employee-safe.

Response:

- clarify capacity/productivity/support framing;
- keep qualified human judgment and relationships;
- do not pivot into layoffs as ROI.

If prospect's primary goal is irresponsible employee elimination, that may be a red flag/no-sale.

---

# 17. “NO PROBLEM”

If prospect credibly demonstrates the workflow is strong:

Do not argue.

Options:

- ask one backup workflow question if justified;
- acknowledge strong system;
- no-sale.

The agent should not become adversarial just to preserve conversion rate.

---

# 18. TIMING

If legitimate but not now:

Capture:

- reason
- future date/event
- requested follow-up timing
- what would change priority.

Move to nurture/requested callback rather than repeated generic cadence.

---

# 19. NEEDS STAKEHOLDER

If prospect says:

> “My partner/marketing director/COO handles that.”

Treat as routing intelligence.

Capture stakeholder and next step.

Do not force current contact to make a decision outside their role.

---

# 20. RESPONSE LENGTH

Cold-call objection response target:

- 1 short acknowledgment
- 1 concise reframing
- 1 question

No long rebuttal monologues.

---

# 21. SALES MANUAL RETRIEVAL

Objection engine retrieves the smallest relevant approved manual chunk plus active profile boundaries.

Live fallback if retrieval fails:

- use safe base principle;
- avoid promises;
- offer human/technical follow-up for uncertainty.

---

# 22. OBJECTION MEMORY

Store prior material objections.

Future conversation should not repeat the same pitch without addressing what was previously said.

Example:

Prior:

> “We just implemented ServiceTitan; we're not switching.”

Future Call Pack should frame around configuration/integration/measurement, not CRM replacement.

---

# 23. OBJECTION ANALYTICS

Track by:

- vertical
- hook
- tier
- target role
- campaign
- response guidance
- outcome.

Metrics:

- objection frequency
- continuation after objection
- qualified conversation after objection
- meeting rate
- DNC/hostile rate
- QA violations.

Do not optimize toward manipulative persistence.

---

# 24. LEARNING PROPOSALS

The system may recommend:

> “Roofing owners frequently say their salespeople already follow up. The follow-up question about management visibility produces more useful discovery than arguing about automation.”

Proposal may adjust approved guidance priority after review.

It may not auto-invent guarantees, new pricing, or aggressive rebuttals.

---

# 25. ACCEPTANCE TESTS

1. “Send email” -> one relevance clarification max; concise follow-up.
2. “We have ServiceTitan” -> positive CRM workflow question.
3. “We have receptionist” -> overflow/after-hours, no employee attack.
4. “We have agency” -> downstream attribution/process, no agency attack.
5. “We use ChatGPT” -> individual tool vs governed workflow.
6. “AI can't diagnose patients” -> agree; non-clinical workflow only.
7. “Guarantee ROI?” -> refuse guarantee; use measurement/scenario.
8. Unsupported integration -> verify task, no promise.
9. Strong workflow/no pain -> no-sale allowed.
10. “Stop calling” -> objection engine yields immediately to DNC priority path.

---

# 26. CORE RULE

Good objection handling reduces uncertainty and preserves trust. The brain should respond to what the prospect actually means, not perform a memorized battle against every “no.”
