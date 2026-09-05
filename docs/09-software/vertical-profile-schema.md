# Your AI Department — Machine-Readable Vertical Profile Schema

**Status:** Architecture authority  
**Purpose:** Define the reusable schema Claude Code will use to convert Sales Manual industry playbooks into machine-readable prospecting/research/call-strategy profiles.

---

# 1. PRINCIPLE

A vertical profile does not replace the Sales Manual.

It provides deterministic/machine-readable metadata extracted from the canonical manual so the Market Miner can:

- generate searches;
- classify businesses;
- identify useful public signals;
- rank hypotheses;
- choose relevant research adapters;
- select discovery questions;
- identify system/CRM clues;
- generate Call Packs;
- enforce safety/professional boundaries.

Every profile must retain:

- source manual path;
- source commit/version;
- profile version;
- generated/reviewed date.

If the manual changes materially, the profile must be reviewed/regenerated.

---

# 2. TOP-LEVEL PROFILE

Required fields:

- `profile_id`
- `version`
- `status`
- `industry_name`
- `industry_aliases[]`
- `priority`
- `country_scope[]`
- `source_manual_paths[]`
- `source_manual_commit`
- `business_model`
- `search_taxonomy`
- `classification_rules`
- `public_signal_rules`
- `customer_journey[]`
- `leak_hypotheses[]`
- `decision_maker_roles[]`
- `system_families[]`
- `hook_priorities[]`
- `discovery_question_banks`
- `offer_mapping`
- `roi_tools[]`
- `objection_guidance[]`
- `safety_boundaries[]`
- `no_sale_conditions[]`
- `scoring_overrides`
- `research_requirements`
- `call_pack_defaults`

---

# 3. BUSINESS MODEL

Fields:

- `revenue_categories[]`
- `lead_types[]`
- `customer_types[]`
- `high_value_service_families[]`
- `recurring_revenue_families[]`
- `urgency_characteristics[]`
- `seasonality_characteristics[]`
- `phone_dependence`
- `appointment_dependence`
- `estimate_proposal_dependence`
- `field_service_dependence`

These are qualitative model facts, not universal ticket-size benchmarks.

---

# 4. SEARCH TAXONOMY

Fields:

- `core_queries[]`
- `high_intent_queries[]`
- `urgent_queries[]`
- `high_ticket_queries[]`
- `financing_queries[]`
- `commercial_queries[]`
- `service_aliases[]`
- `negative_terms[]`
- `classification_warning_terms[]`

Each query entry may include:

- `query`
- `family`
- `intent_weight`
- `priority`
- `recommended_for_paid_serp`
- `recommended_for_places_gap_fill`

---

# 5. CLASSIFICATION RULES

Fields:

- `positive_business_categories[]`
- `negative_business_categories[]`
- `website_keyword_positive[]`
- `website_keyword_negative[]`
- `required_any_of[]`
- `exclude_if_all[]`
- `manual_review_if[]`

Purpose: prevent search noise from becoming prospects.

---

# 6. PUBLIC SIGNAL RULES

Each signal:

- `signal_id`
- `category`
- `description`
- `evidence_claim_key`
- `confidence_required`
- `why_it_matters`
- `possible_hypothesis_ids[]`
- `score_rule_reference`

Examples:

- active_google_search_ads
- active_meta_ads
- emergency_24_7
- financing_promoted
- multiple_locations
- online_booking
- quote_form
- visible_hiring

---

# 7. CUSTOMER JOURNEY

Ordered stage list.

Each stage:

- `stage_id`
- `label`
- `common_inputs[]`
- `common_outputs[]`
- `handoff_risks[]`
- `human_judgment_required`

This helps the AI ask “what happens next?” at the correct point.

---

# 8. LEAK HYPOTHESIS

Each hypothesis:

- `hypothesis_id`
- `category`
- `title`
- `description`
- `trigger_signals[]`
- `disqualifying_signals[]`
- `public_fact_requirements[]`
- `questions_to_verify[]`
- `primary_hook_template`
- `backup_hook_templates[]`
- `offer_families[]`
- `roi_tool_ids[]`
- `must_not_claim[]`

---

# 9. DECISION-MAKER ROLE

Fields:

- `role_category`
- `titles[]`
- `relevant_hypothesis_ids[]`
- `priority`

Do not require owner-only access when another role legitimately owns the workflow.

---

# 10. SYSTEM FAMILY

Fields:

- `system_family_id`
- `names[]`
- `category`
- `frontend_detection_terms[]`
- `positioning_rule`
- `questions[]`

Positioning must distinguish:

`system detected`

from

`workflow confirmed`.

---

# 11. HOOK PRIORITY

Fields:

- `hook_family`
- `base_priority`
- `boost_if_signals[]`
- `demote_if_signals[]`
- `avoid_if[]`
- `question_templates[]`

The strategy engine may rank hook families, but the profile supplies vertical relevance.

---

# 12. DISCOVERY QUESTION BANKS

Map by category:

- lead_generation
- phone_after_hours
- scheduling_dispatch
- sales_follow_up
- retention_reactivation
- employee_capacity
- reporting
- systems_crm
- attribution
- technical_constraints

Each question may include:

- `text`
- `purpose`
- `follow_up_if_yes`
- `follow_up_if_no`
- `data_field_created`

---

# 13. OFFER MAPPING

Each mapping:

- `opportunity_category`
- `possible_offer_families[]`
- `positioning`
- `required_discovery_before_recommending[]`
- `do_not_recommend_if[]`

The profile must map to canonical current YAD offers/capabilities, not invent new commercial packages.

---

# 14. ROI TOOLS

Fields:

- `roi_tool_id`
- `name`
- `relevant_hypothesis_ids[]`
- `required_inputs[]`
- `prohibited_shortcuts[]`

No ROI calculator may assume every lead/opportunity converts.

---

# 15. OBJECTION GUIDANCE

Each objection:

- `objection_id`
- `match_phrases[]`
- `principle`
- `response_guidance`
- `follow_up_questions[]`
- `must_not_say[]`
- `manual_reference`

---

# 16. SAFETY / PROFESSIONAL BOUNDARIES

Each boundary:

- `boundary_id`
- `category`
- `prohibited_agent_claims[]`
- `human_required_for[]`
- `escalation_guidance`

These remain vertical-specific.

---

# 17. NO-SALE CONDITIONS

Examples:

- prospect demonstrates strong workflow in tested area;
- no meaningful pain;
- economics too small;
- existing system already solves the issue;
- technical/safety scope outside YAD capability;
- prospect demands unsupported guarantee;
- no decision path;
- unsafe/unethical request.

The strategy engine must be able to select `no_sale_measure_first`.

---

# 18. SCORING OVERRIDES

The general Module 4C score remains canonical.

A vertical profile may contain:

- mapping of general score rules to vertical evidence;
- vertical explanatory labels;
- additional research-only prioritization features;

It must NOT silently replace Module 4C tier thresholds.

If the vertical playbook contains a slightly different practical signal list, preserve it as `vertical_priority_signals`, not a conflicting hidden score model unless company leadership explicitly approves a scoring revision.

---

# 19. RESEARCH REQUIREMENTS

Fields:

- `required_before_score[]`
- `recommended_before_human_queue[]`
- `required_before_research_specific_hook[]`
- `refresh_before_call[]`

Example:

A hook that says “I noticed you are actively advertising emergency AC” requires fresh confirmed ad evidence.

---

# 20. CALL PACK DEFAULTS

Fields:

- `default_primary_hook_family`
- `default_backup_hook_family`
- `default_first_questions[]`
- `common_objection_ids[]`
- `vertical_truth_boundaries[]`
- `preferred_next_step`

Defaults only apply when prospect-specific evidence does not justify a better choice.
