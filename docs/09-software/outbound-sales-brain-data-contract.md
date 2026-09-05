# Your AI Department — Outbound Sales Brain Canonical Data Contract

**Status:** Architecture authority  
**Purpose:** Define the canonical entities and field semantics shared by Market Miner, research, scoring, Sales Manual retrieval, compliance, Twilio, CRM, QA, and analytics.  
**Implementation owner:** Claude Code

---

# 1. DESIGN RULE

There must be one canonical meaning for each business object.

Provider-specific fields belong in provider adapters or raw observation payloads. They must not leak throughout the core application.

The core system should operate on normalized entities:

- Account
- Location
- Contact
- PhoneEndpoint
- Domain
- SourceIdentity
- MiningJob
- SearchObservation
- ResearchRun
- EvidenceRecord
- ProspectProfile
- CanonicalScore
- ResearchCompleteness
- OpportunityHypothesis
- OfferHypothesis
- CallPack
- ComplianceDecision
- Campaign
- ContactAttempt
- Call
- CallEvent
- ProspectStatement
- CallOutcome
- FollowUpTask
- Suppression
- QAReview
- KnowledgeSnapshot
- ExperimentAssignment
- ProviderUsage

Every object should have:

- stable internal ID;
- created timestamp;
- updated timestamp where mutable;
- provenance/version metadata where relevant.

Use UTC storage for timestamps and explicit IANA timezone identifiers for local-time behavior.

---

# 2. ENUMERATION CONVENTIONS

Core enums should use lowercase machine values with documented display labels.

## Evidence confidence

- `confirmed`
- `likely`
- `unknown`
- `contradicted`

`contradicted` means later evidence or the prospect directly disproved an earlier observation. Preserve the old record; do not silently delete history.

## Tri-state factual status

For fields where absence of evidence is common:

- `yes`
- `no_confirmed`
- `unknown`

Do not use boolean false when the real meaning is “we did not detect it.”

## Source retention class

- `durable`
- `durable_with_license`
- `transient`
- `identifier_only`
- `do_not_store_raw`

## Research freshness

- `fresh`
- `aging`
- `stale`
- `unknown`

## YAD tier

- `A`
- `B`
- `C`
- `D`

## Operating mode

- `off`
- `research_only`
- `human_assist`
- `controlled_test`
- `autonomous_outbound`
- `inbound_receptionist`

## Compliance decision

- `allow_autonomous`
- `human_only`
- `research_only`
- `review_required`
- `suppress`

---

# 3. ACCOUNT

Represents one business organization/brand/account.

Required fields:

- `account_id`
- `canonical_name`
- `normalized_name`
- `account_type`
- `industry_code`
- `vertical_profile_id`
- `status`
- `created_at`
- `updated_at`

Optional fields:

- `legal_name`
- `dba_names[]`
- `parent_account_id`
- `franchise_brand`
- `franchisee_name`
- `employee_size_band`
- `revenue_size_band` only when sourced legitimately; never estimated and presented as fact without provenance
- `location_count_confirmed`
- `location_count_observed`
- `existing_customer_status`
- `owner_team_notes`

`account_type` examples:

- independent_business
- multi_location_business
- franchise_location_group
- franchise_corporate
- enterprise
- unknown

Rules:

- one company may have many locations;
- one brand/domain does not necessarily equal one legal entity;
- franchise locations should not be automatically merged into corporate ownership;
- parent/child relationships remain explicit.

---

# 4. LOCATION

Represents one physical or operational business location/service-market node.

Fields:

- `location_id`
- `account_id`
- `name`
- `address_line_1`
- `address_line_2`
- `city`
- `state_region`
- `postal_code`
- `country_code`
- `latitude`
- `longitude`
- `timezone`
- `location_type`
- `service_area_text`
- `is_headquarters`
- `is_active`
- `source_evidence_ids[]`

Do not force a street address for service-area businesses if none is publicly appropriate.

---

# 5. DOMAIN

Fields:

- `domain_id`
- `account_id`
- `hostname`
- `canonical_url`
- `domain_role`
- `verification_status`
- `first_seen_at`
- `last_verified_at`
- `source_evidence_ids[]`

`domain_role`:

- primary
- campaign
- landing_page
- location_subdomain
- third_party_booking
- lead_generator_possible
- unknown

Never treat a third-party lead-generation landing domain as the business's canonical domain without verification.

---

# 6. PHONE ENDPOINT

Fields:

- `phone_id`
- `account_id`
- `location_id` optional
- `contact_id` optional
- `e164`
- `display_number`
- `phone_role`
- `line_type`
- `line_type_status`
- `source`
- `verified_at`
- `suppression_status`
- `last_contact_attempt_at`

`phone_role` examples:

- main_business
- sales
- service
- location
- owner_direct
- contact_direct
- tracking_number
- unknown

Important:

A call-tracking number can be a valid business contact path while not being the canonical underlying number. Preserve both when known.

---

# 7. CONTACT

Represents a person or role associated with the Account.

Fields:

- `contact_id`
- `account_id`
- `location_id` optional
- `first_name`
- `last_name`
- `full_name`
- `title`
- `role_category`
- `email`
- `phone_ids[]`
- `source_provider`
- `source_reference`
- `confidence`
- `last_verified_at`
- `contact_basis_metadata`
- `suppression_status`

`role_category` examples:

- owner
- founder
- president
- general_manager
- operations
- marketing
- sales
- office_manager
- intake
- administrator
- unknown

Do not assume the public owner is the correct operational decision-maker for every problem.

---

# 8. SOURCE IDENTITY

Maps provider-native identities to YAD's canonical entity.

Fields:

- `source_identity_id`
- `provider`
- `provider_entity_type`
- `provider_native_id`
- `account_id`
- `location_id` optional
- `retention_class`
- `first_seen_at`
- `last_seen_at`

Purpose:

- prevent duplicates;
- preserve source linkage;
- honor source storage rules;
- make entity merges reversible.

---

# 9. MINING JOB

Represents one requested prospect-generation campaign/run.

Fields:

- `mining_job_id`
- `name`
- `vertical_profile_id`
- `geography_selector`
- `target_inventory_count`
- `minimum_yad_tier`
- `required_signals[]`
- `excluded_signals[]`
- `query_budget`
- `provider_budget_usd`
- `research_depth`
- `status`
- `created_by`
- `created_at`
- `started_at`
- `completed_at`
- `pause_reason`

`geography_selector` must support:

- states[]
- counties[]
- cities[]
- zctas[]
- cbsa[]
- radius points[]
- explicit search cells[]

---

# 10. SEARCH OBSERVATION

Represents one provider observation from one query at one time.

This is intentionally separate from durable Evidence.

Fields:

- `observation_id`
- `mining_job_id`
- `provider`
- `source_type`
- `query`
- `search_cell_id`
- `observed_at`
- `provider_native_id` where retainable
- `observed_name`
- `observed_domain`
- `observed_phone`
- `observed_location`
- `result_type`
- `position`
- `ad_format`
- `advertised_service`
- `ad_headline`
- `landing_url`
- `retention_class`
- `raw_payload_pointer` only where allowed
- `account_id` after entity resolution

`result_type` examples:

- paid_search
- local_service_ad
- sponsored_local
- organic
- local_result
- transparency_ad
- directory_result

Six observations for the same advertiser remain six observations connected to one Account.

---

# 11. RESEARCH RUN

One complete research attempt for one Account at a point in time.

Fields:

- `research_run_id`
- `account_id`
- `trigger`
- `vertical_profile_id`
- `vertical_profile_version`
- `started_at`
- `completed_at`
- `status`
- `adapter_results[]`
- `evidence_ids[]`
- `research_completeness_id`
- `manual_snapshot_id`
- `cost_total_usd`
- `error_summary[]`

`trigger`:

- newly_discovered
- refresh_before_call
- scheduled_refresh
- human_requested
- campaign_expansion
- stale_evidence

A partially failed adapter does not invalidate the whole research run.

---

# 12. EVIDENCE RECORD

The Evidence Record is the most important claim-control object.

Fields:

- `evidence_id`
- `account_id`
- `location_id` optional
- `contact_id` optional
- `research_run_id`
- `category`
- `claim_key`
- `claim_text`
- `normalized_value`
- `confidence`
- `can_state_as_fact`
- `source_provider`
- `source_type`
- `source_reference`
- `source_observation_id` optional
- `observed_at`
- `expires_at`
- `freshness`
- `retention_class`
- `independently_verified`
- `supersedes_evidence_id` optional
- `contradicted_by_evidence_id` optional
- `notes`

Examples:

`claim_key = active_google_search_ad`

`normalized_value = yes`

`confidence = confirmed`

or:

`claim_key = crm_provider`

`normalized_value = servicetitan`

`confidence = likely`

`can_state_as_fact = false`

because only a frontend widget was observed.

---

# 13. EVIDENCE PRECEDENCE

When sources conflict, do not simply keep whichever arrived last.

Initial precedence framework:

1. prospect-confirmed current statement about their own workflow;
2. authenticated/internal customer data, when legitimately available;
3. first-party business website/current direct business source;
4. current government/public registry for fields it authoritatively controls;
5. licensed structured business/contact provider;
6. current direct ad/search observation;
7. ad-transparency observation;
8. technology inference;
9. AI synthesis/inference.

Precedence is claim-specific.

Example:

The business website is strong evidence for its advertised service and stated hours, but a state license registry may outrank the website for license status.

Never destroy lower-priority conflicting evidence; mark the current canonical conclusion and preserve the conflict history.

---

# 14. INITIAL SIGNAL FRESHNESS / TTL MATRIX

These are initial architecture defaults; make configurable.

- current paid-search ad observation: 48 hours
- Local Services Ad observation: 48 hours
- Meta active-ad observation: 48 hours
- ad-transparency evidence: 7 days
- website offer/promotion: 7 days
- website CTA/form/booking: 14 days
- website technology signal: 14 days
- hours / emergency / 24-7 claim: 30 days
- location/address: 30 days
- public decision-maker: 30 days
- licensed contact data: provider-dependent, target 30 days
- business license status: source-dependent, target 30–90 days
- line type: 30 days or recheck before high-risk use
- DNC/suppression: no normal expiry unless policy explicitly defines one
- prospect-confirmed workflow statement: retain historically; freshness depends on topic and next interaction

A stale evidence record can remain in history but cannot support a “I noticed you're currently...” opener without refresh.

---

# 15. PROSPECT PROFILE

A read model assembled from normalized entities and current evidence.

Fields:

- `prospect_profile_id`
- `account_id`
- `vertical_profile_id`
- `primary_location_id`
- `primary_domain_id`
- `primary_phone_id`
- `preferred_contact_id` optional
- `current_fact_summary[]`
- `unknowns[]`
- `ad_signal_summary`
- `website_summary`
- `technology_signal_summary`
- `crm_signal_summary`
- `growth_signal_summary`
- `decision_maker_summary`
- `canonical_score_id`
- `research_completeness_id`
- `opportunity_hypothesis_ids[]`
- `offer_hypothesis_ids[]`
- `research_run_id`
- `generated_at`

This is a read model. Canonical source records remain the underlying truth.

---

# 16. CANONICAL SCORE

Fields:

- `canonical_score_id`
- `account_id`
- `research_run_id`
- `score_version`
- `total_points`
- `tier`
- `components[]`
- `calculated_at`

Each component contains:

- `rule_id`
- `description`
- `points_possible`
- `points_awarded`
- `evidence_ids[]`
- `reason`

Never award points for `unknown`.

Never subtract fit points merely because research is incomplete. Research completeness is separate.

---

# 17. RESEARCH COMPLETENESS

Fields:

- `research_completeness_id`
- `account_id`
- `research_run_id`
- `numeric_score`
- `label`
- `components[]`
- `generated_at`

Initial labels:

- complete
- good
- partial
- thin
- stale

Components may include:

- identity resolved
- domain confirmed
- phone confirmed
- website researched
- ad checks attempted
- technology checks attempted
- decision-maker search attempted
- geography confirmed
- evidence freshness acceptable

---

# 18. OPPORTUNITY HYPOTHESIS

Fields:

- `opportunity_hypothesis_id`
- `account_id`
- `category`
- `hypothesis_text`
- `supporting_evidence_ids[]`
- `missing_fact_questions[]`
- `confidence`
- `priority`
- `generated_by`
- `generated_at`

Categories:

- missed_call
- after_hours
- speed_to_lead
- follow_up
- unsold_estimate
- crm_workflow
- attribution
- website_conversion
- paid_acquisition
- reactivation
- employee_capacity
- reporting
- integration
- appointment_no_show
- customer_communication
- other

A hypothesis is not a factual claim about the prospect.

---

# 19. OFFER HYPOTHESIS

Fields:

- `offer_hypothesis_id`
- `account_id`
- `offer_family`
- `rank`
- `reason`
- `supporting_opportunity_ids[]`
- `supporting_evidence_ids[]`
- `required_discovery_questions[]`
- `commercial_truth_reference`
- `must_not_promise[]`
- `generated_at`

Offer families should map to current launch decisions, not invented products.

Initial families:

- ai_department_assessment
- strategy_call
- executive_ai_strategy
- ai_implementation
- ai_growth_systems
- managed_ai_department
- google_ads
- meta_ads
- seo
- crm_system
- ai_phone_agent
- workflow_automation
- ai_training
- ai_workshop
- executive_ai_coaching
- no_sale_measure_first

The system may identify a technical solution category without claiming a fixed packaged price.

---

# 20. CALL PACK

Snapshot used by a human rep or realtime agent.

Fields:

- `call_pack_id`
- `account_id`
- `contact_id` optional
- `campaign_id`
- `research_run_id`
- `canonical_score_id`
- `manual_snapshot_id`
- `generated_at`
- `expires_at`
- `company_summary`
- `top_confirmed_facts[]`
- `important_unknowns[]`
- `primary_hypothesis`
- `backup_hypothesis`
- `primary_offer_hypothesis`
- `backup_offer_hypothesis`
- `primary_hook`
- `backup_hook`
- `recommended_opener`
- `first_questions[]`
- `likely_objections[]`
- `known_system_signals[]`
- `advertising_evidence_summary`
- `prohibited_claims[]`
- `allowed_next_steps[]`
- `commercial_truth_summary`
- `compliance_decision_id`
- `context_version`

The Call Pack is immutable after generation. If research changes materially, create a new Call Pack.

---

# 21. CAMPAIGN

Fields:

- `campaign_id`
- `name`
- `vertical_profile_id`
- `geography_selector`
- `lead_source_selector`
- `minimum_tier`
- `operating_mode`
- `target_ready_inventory`
- `max_attempts`
- `attempt_cooldown_policy`
- `calling_window_policy_id`
- `research_freshness_policy_id`
- `voicemail_policy_id`
- `follow_up_policy_id`
- `model_version`
- `voice_version`
- `manual_snapshot_policy`
- `compliance_policy_version`
- `daily_contact_cap`
- `provider_budget_usd`
- `kill_switch_state`
- `status`

---

# 22. COMPLIANCE DECISION

Fields:

- `compliance_decision_id`
- `account_id`
- `contact_id` optional
- `phone_id`
- `campaign_id`
- `policy_version`
- `decision`
- `reason_codes[]`
- `jurisdiction`
- `local_timezone`
- `local_time_evaluated`
- `line_type`
- `contact_basis`
- `dnc_status`
- `attempt_count_window`
- `recording_allowed`
- `transcription_allowed`
- `ai_voice_policy_result`
- `evaluated_at`
- `expires_at`

Decision must be recalculated immediately before dialing if its TTL has passed or relevant facts changed.

---

# 23. CONTACT ATTEMPT

Represents every attempted outreach, regardless of channel.

Fields:

- `attempt_id`
- `account_id`
- `contact_id` optional
- `campaign_id`
- `channel`
- `direction`
- `started_at`
- `completed_at`
- `disposition`
- `provider_id`
- `call_id` optional
- `follow_up_task_id` optional
- `compliance_decision_id`

Channels:

- phone
- sms
- email
- human_field
- other

---

# 24. CALL

Fields:

- `call_id`
- `attempt_id`
- `account_id`
- `contact_id` optional
- `phone_id`
- `campaign_id`
- `provider`
- `provider_call_id`
- `call_pack_id`
- `started_at`
- `answered_at`
- `ended_at`
- `answer_type`
- `duration_seconds`
- `disposition`
- `transcript_reference` subject to policy
- `audio_reference` subject to policy
- `model_version`
- `voice_version`
- `qa_review_id`

---

# 25. CALL EVENT

Append-only event stream for important call behavior.

Fields:

- `call_event_id`
- `call_id`
- `event_type`
- `occurred_at`
- `turn_index`
- `payload`
- `latency_ms` optional

Events:

- answer_detected
- voicemail_detected
- user_speech_started
- user_speech_final
- agent_generation_started
- agent_audio_started
- interruption
- tool_requested
- tool_succeeded
- tool_failed
- dnc_requested
- suppression_written
- transfer_started
- transfer_failed
- booking_started
- booking_succeeded
- booking_failed
- model_timeout
- call_ended

Use events for analytics rather than reconstructing everything from transcript text.

---

# 26. PROSPECT STATEMENT

Stores material prospect-provided facts.

Fields:

- `prospect_statement_id`
- `account_id`
- `contact_id`
- `call_id`
- `category`
- `statement_text`
- `normalized_value`
- `source_class`
- `confidence`
- `captured_at`
- `supersedes_statement_id` optional

`source_class` examples:

- prospect_verified
- prospect_estimate

These statements can supersede public hypotheses.

---

# 27. CALL OUTCOME

Fields:

- `call_outcome_id`
- `call_id`
- `disposition`
- `problem_discussed`
- `current_workflow_summary`
- `prospect_statement_ids[]`
- `economic_inputs[]`
- `systems_named[]`
- `objections[]`
- `decision_maker_status`
- `urgency`
- `next_step_type`
- `next_step_at`
- `follow_up_task_id`
- `crm_stage`
- `disqualification_reason`
- `research_corrections[]`
- `summary`

---

# 28. FOLLOW-UP TASK

Fields:

- `follow_up_task_id`
- `account_id`
- `contact_id` optional
- `source_call_id` optional
- `task_type`
- `owner`
- `due_at`
- `reason`
- `context`
- `status`
- `external_provider`
- `external_task_id`
- `attempt_count`
- `last_error`

---

# 29. SUPPRESSION

Fields:

- `suppression_id`
- `scope`
- `account_id` optional
- `contact_id` optional
- `phone_id` optional
- `email` optional
- `reason`
- `source`
- `effective_at`
- `expires_at` optional only when policy allows
- `created_by`
- `source_call_id` optional
- `notes`

`scope`:

- phone
- contact
- account
- email
- campaign_specific

DNC normally uses durable suppression without automatic expiry.

---

# 30. QA REVIEW

Fields:

- `qa_review_id`
- `call_id`
- `scorecard_version`
- `criterion_scores[]`
- `total_score`
- `hard_fail_codes[]`
- `pass_status`
- `coach_summary`
- `recommended_improvements[]`
- `reviewer_type`
- `reviewer_version`
- `created_at`

Preserve the 12 Sales Manual scorecard criteria as explicit fields/references.

---

# 31. KNOWLEDGE SNAPSHOT

Fields:

- `manual_snapshot_id`
- `source_commit_sha`
- `source_paths[]`
- `index_version`
- `chunking_version`
- `embedding_model`
- `generated_at`

Every Call Pack should point to the knowledge snapshot it used.

---

# 32. EXPERIMENT ASSIGNMENT

Fields:

- `experiment_assignment_id`
- `account_id`
- `campaign_id`
- `experiment_id`
- `variant_id`
- `assigned_at`
- `eligibility_reason`

Experiments must not alter compliance restrictions or truth boundaries.

---

# 33. PROVIDER USAGE

Fields:

- `provider_usage_id`
- `provider`
- `operation`
- `mining_job_id` optional
- `research_run_id` optional
- `account_id` optional
- `requested_at`
- `completed_at`
- `units`
- `estimated_cost_usd`
- `actual_cost_usd` when available
- `status`
- `error_code`

This supports cost per discovered prospect / Tier A-B / meeting.

---

# 34. IMMUTABILITY / HISTORY RULES

Immutable snapshots/events:

- SearchObservation
- EvidenceRecord once written; contradictions create new records
- CanonicalScore snapshot
- CallPack
- ComplianceDecision snapshot
- ContactAttempt
- CallEvent
- ProspectStatement
- QAReview
- KnowledgeSnapshot
- ExperimentAssignment

Mutable operational records:

- Account current canonical fields
- Contact current canonical fields
- Campaign status
- FollowUpTask status
- Suppression only through auditable administrative action

Never rewrite history so an old call appears to have used research it did not have.

---

# 35. IDENTITY / DEDUPE MATCH ORDER

Suggested match order:

1. exact permitted provider-native stable ID mapping;
2. exact normalized domain + compatible geography;
3. exact normalized business phone + compatible name;
4. exact license/entity number;
5. exact address + strong name similarity;
6. fuzzy name/domain/address composite;
7. human review.

Do not auto-merge when strong evidence conflicts.

All merges should retain `SourceIdentity` records and merge audit history.

---

# 36. MINIMUM PROSPECT RECORD BEFORE HUMAN QUEUE

To appear in the normal ranked human-assist queue, a prospect should normally have:

- account identity;
- primary geography;
- business phone or explicit no-phone status;
- website/domain or explicit no-website evidence;
- vertical classification;
- at least one completed research run;
- canonical YAD score;
- research completeness label;
- primary opportunity hypothesis;
- primary hook;
- evidence references.

Decision-maker contact is desirable but not mandatory.

---

# 37. MINIMUM RECORD BEFORE TWILIO QUEUE

In addition to the human-queue requirements:

- call destination resolved;
- line/contact-basis policy inputs collected sufficiently for policy engine;
- current suppression check;
- current compliance decision;
- fresh Call Pack;
- campaign limits checked;
- no existing in-flight attempt;
- operating mode authorizes the requested type of call.

Twilio must never receive an arbitrary phone number disconnected from this chain.
