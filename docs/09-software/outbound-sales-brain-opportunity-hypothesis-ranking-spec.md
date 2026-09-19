# Your AI Department — Opportunity Hypothesis Ranking Engine

**Status:** Architecture authority  
**Purpose:** Rank the business problems worth investigating first for a researched prospect without converting hypotheses into unsupported claims.  
**Implementation owner:** Claude Code

---

# 1. CORE QUESTION

Research often reveals several plausible conversations.

Example HVAC advertiser:

- paid Google search
- 24/7 language
- quote form
- financing
- ServiceTitan booking signal
- multiple locations

Possible hooks:

- after-hours call handling
- speed-to-lead
- unsold replacement estimates
- attribution
- CRM workflow
- multi-location reporting

The system must choose what to ask first.

---

# 2. HYPOTHESIS IS NOT A FACT

A hypothesis means:

> Based on the business model and observed public workflow, this is a useful place to ask a question.

It does NOT mean:

> The problem definitely exists.

Every hypothesis stores:

- supporting evidence
- missing facts
- questions required to verify
- prohibited claims

---

# 3. HYPOTHESIS OBJECT

`OpportunityHypothesis`

- hypothesis_id
- account_id
- campaign_context
- vertical_profile_id/version
- category
- title
- support_evidence_ids[]
- contradictory_evidence_ids[]
- trigger_signals[]
- missing_fact_keys[]
- discovery_questions[]
- hypothesis_strength
- business_value_relevance
- research_specificity
- decision_maker_relevance
- safety/risk class
- solution_categories[]
- candidate_offer_families[]
- primary_hook_template
- backup_hook_templates[]
- must_not_claim[]
- generated_at
- strategy_version

---

# 4. CANONICAL HYPOTHESIS FAMILIES

Core reusable families:

- paid_lead_protection
- missed_call_recovery
- after_hours_handling
- speed_to_lead
- intake_consistency
- appointment_scheduling
- no_show_recovery
- unsold_estimate_follow_up
- unsold_proposal_follow_up
- consultation_follow_up
- CRM_capture
- CRM_workflow
- attribution
- reporting_visibility
- reactivation
- employee_capacity
- repetitive_admin
- customer_status_communication
- document_workflow
- multi_location_consistency
- field_lead_capture
- market_launch
- AI_governance
- website_conversion_foundation
- marketing_growth

Profiles define which are relevant.

---

# 5. RANKING DIMENSIONS

V1 should rank hypotheses using auditable dimensions rather than one freeform LLM judgment.

## A. Evidence Specificity

How directly do confirmed observations make this question relevant?

Examples:

Current emergency ad + 24/7 page -> strong specificity for after-hours handling.

Generic HVAC website only -> weak specificity.

## B. Economic Relevance

Does the business model make the workflow economically meaningful?

High-ticket replacement/proposal flow may make follow-up highly relevant.

## C. Operational Centrality

Is this workflow central to acquiring/serving customers?

## D. Vertical Priority

Profiles define which leaks are commonly worth checking first.

## E. Differentiation / Non-Genericness

Prefer a researched question over a generic “do you use AI?” opener.

## F. Decision-Maker Fit

Can YAD reasonably reach a role that owns the workflow?

## G. Safety / Professional Risk

Demote hypotheses requiring sensitive judgment or unsupported automation.

## H. Contradictory Evidence

Strong existing workflow evidence may demote or invalidate a hypothesis.

---

# 6. HYPOTHESIS STRENGTH LABELS

- `STRONG`
- `GOOD`
- `TENTATIVE`
- `GENERIC_ONLY`
- `CONTRADICTED`
- `NOT_APPLICABLE`

Strength represents quality of **question rationale**, not confidence that pain exists.

---

# 7. STRONG HYPOTHESIS EXAMPLE

Roofing prospect:

Confirmed:

- current roof replacement ads
- financing
- inspection CTA
- sales team page

Hypothesis:

`unsold_proposal_follow_up`

Why strong:

- high-value proposal-driven journey
- public evidence shows active acquisition
- financing/proposal process visible
- manual identifies unsold proposal follow-up as high-value diagnostic

Allowed opener:

> “I noticed you're advertising roof replacement in Jacksonville. What happens when someone gets a proposal but doesn't sign the first time?”

Not allowed:

> “You're losing thousands on unsold roofing estimates.”

---

# 8. CONTRADICTED HYPOTHESIS

Prospect previously told YAD:

> “Every open estimate has an automated task and management reviews untouched estimates daily.”

If recent/credible, then generic `unsold_estimate_follow_up` should be demoted/contradicted.

The system may ask about another workflow instead.

Do not keep hammering the same problem because it is the vertical's favorite hook.

---

# 9. HYPOTHESIS DIVERSITY

Call Pack should normally contain:

- 1 primary hypothesis
- 1 backup hypothesis
- optional third internal fallback

Do not load ten unrelated pitches.

The backup should ideally come from a different workflow family.

Example:

Primary: paid-after-hours call handling

Backup: source-to-revenue attribution

rather than:

Primary: missed calls

Backup: missed-call recovery

which is effectively the same conversation.

---

# 10. CAMPAIGN OBJECTIVE

Campaign can influence eligible hypothesis families.

Example:

`website_foundation` campaign may prioritize no/weak website prospects.

`advertiser_first` campaign may prioritize acquisition-protection and attribution.

Campaign objective cannot invent a problem unsupported by business context.

---

# 11. RELATIONSHIP MEMORY

Prior conversations modify ranking.

Example:

First call confirmed:

- CRM strong
- missed-call recovery strong
- attribution weak

Next Call Pack should elevate attribution rather than reset to original missed-call hook.

---

# 12. CURRENT SYSTEM SIGNALS

Existing CRM/system signals should usually change the question from:

> “Do you have a CRM?”

to:

> “Once a lead enters ServiceTitan, what happens automatically after the first no-response?”

System presence can improve specificity while keeping workflow unknown.

---

# 13. ADVERTISING SIGNALS

Current ads increase relevance of:

- paid-lead protection
- speed-to-lead
- after-hours
- attribution
- lead follow-up

But current ads do not prove any leak.

Repeated/high-intent advertiser strength may influence first-question priority without changing Module 4C score beyond the canonical ad points.

---

# 14. NO-PAIN / NO-SALE ROUTING

If discovery confirms strong workflows across likely hypotheses:

- mark no immediate problem confirmed;
- avoid inventing a weaker pain merely to keep selling;
- possibly route to broader strategy/measurement discussion only if legitimate;
- allow `NO_SALE_CURRENTLY` outcome.

---

# 15. WEBSITE-FOUNDATION SPECIAL CASE

If business has no verified website:

primary hypothesis may be:

`website_conversion_foundation`

But do not automatically assume they need a new website if their business model intentionally operates through another effective channel.

Ask about customer acquisition/process first.

---

# 16. LAW SAFETY

Law hypotheses may target:

- intake response
- scheduling
- follow-up
- attribution
- admin capacity
- governance

Never rank:

- case-merit decision automation
- legal advice automation
- conflict clearance without approved human process
- unsupervised substantive legal judgment

---

# 17. COLLISION SAFETY

Do not rank safety-critical repair decision automation.

Keep to:

- estimate intake
- communication
- follow-up
- documents/admin
- attribution
- customer status from reliable systems

---

# 18. HAIL EVENT CONTEXT

For PDR/Hail, current event evidence may strongly elevate:

- surge capacity
- field lead capture
- appointment/no-show
- market launch

When event evidence expires, those market-specific hypotheses lose current priority.

---

# 19. EXPLAINABILITY

Human Assist should show:

**Primary hypothesis:** After-hours paid-call handling

**Why:** Current emergency AC ad + 24/7 service + phone-first CTA.

**What we don't know:** Whether calls are missed or how overflow is handled.

**Ask:** “When one of those calls comes in after hours and everyone is tied up, what happens next?”

**Do not say:** “You're losing calls.”

---

# 20. ACCEPTANCE FIXTURES

1. Emergency HVAC advertiser -> after-hours/paid lead primary.
2. HVAC prospect confirms strong after-hours system -> attribution or estimate follow-up becomes primary.
3. Roofing current replacement advertiser -> unsold proposal or paid-lead response.
4. Collision shop with high status-call workload prospect statement -> customer-status/admin capacity primary.
5. Hail operator in active market with field reps -> surge/field lead capture.
6. PI firm with current ads and after-hours intake -> intake response/attribution; never case-merit automation.
7. Brokerage with Meta seller campaign and long sales cycle -> long-term nurture/seller follow-up.
8. Tier A prospect with no specific evidence beyond vertical economics -> generic vertical workflow question, not fabricated personalized claim.
9. Prospect says all candidate workflows strong/no pain -> NO_SALE_CURRENTLY valid.
10. Existing CRM signal -> CRM workflow question, never “you don't have a CRM.”

---

# 21. CORE RULE

The best first hook is the most relevant **question** supported by the evidence and business model — not the most dramatic problem the AI can imagine.
