# Your AI Department — Outbound Sales Analytics & Learning Specification

**Status:** Architecture authority  
**Purpose:** Define how YAD measures Market Miner quality, sales performance, voice quality, provider economics, and future learned prioritization without allowing the system to self-modify production behavior prematurely.

---

# 1. LEARNING PRINCIPLE

V1 learning is:

- measured;
- explainable;
- versioned;
- human-reviewed.

V1 learning is NOT:

- autonomous prompt rewriting;
- automatic compliance-rule modification;
- automatic score-rule mutation;
- model retraining/deployment without review.

The system collects evidence about what works and proposes improvements.

---

# 2. ANALYTICS LAYERS

Measure separately:

1. Market Miner discovery quality.
2. Research quality.
3. Prospect fit/scoring.
4. Contactability/reach.
5. Conversation quality.
6. Sales outcomes.
7. Provider economics.
8. Voice/realtime technical quality.
9. Compliance/QA quality.
10. Long-term revenue/close outcomes where available.

Do not optimize one layer by destroying another.

Example:

Increasing dial volume while lowering research relevance is not an improvement.

---

# 3. EVENT TAXONOMY

Core event families:

## Mining

- mining_job_created
- search_task_scheduled
- search_task_completed
- advertiser_observed
- candidate_discovered
- candidate_rejected_category
- duplicate_linked
- new_account_created
- search_cell_saturated
- territory_expanded

## Research

- research_started
- website_resolved
- website_unresolved
- page_crawled
- tech_signal_observed
- ad_signal_observed
- decision_maker_found
- evidence_created
- evidence_expired
- research_completed
- research_partial
- research_failed

## Scoring/strategy

- score_calculated
- tier_assigned
- offer_hypothesis_generated
- call_pack_generated
- call_pack_refreshed

## Queue

- prospect_entered_ready_inventory
- prospect_leased_to_rep
- prospect_entered_call_queue
- prospect_removed_stale
- prospect_suppressed

## Outreach

- attempt_started
- no_answer
- voicemail
- gatekeeper
- decision_maker_reached
- meaningful_conversation
- qualified_conversation
- meeting_scheduled
- transfer_completed
- email_requested
- follow_up_requested
- disqualified
- dnc
- wrong_number

## Voice technical

- human_answer_detected
- speech_final
- model_first_token
- audio_first_byte
- audio_playback_started
- interruption_detected
- agent_audio_stopped
- model_timeout
- stt_error
- tts_error
- provider_disconnect

## Actions

- booking_requested
- booking_succeeded
- booking_failed
- sms_requested
- sms_succeeded
- email_requested_action
- email_succeeded
- crm_write_requested
- crm_write_succeeded
- crm_write_failed
- suppression_written

## QA

- qa_review_completed
- hard_fail_detected
- research_claim_corrected
- unsupported_claim_detected

---

# 4. CORE FUNNEL METRICS

Adopt Sales Manual management logic.

## Activity

- attempts
- calls
- conversations

## Reach

`conversation_rate = conversations / eligible_attempts`

`decision_maker_rate = decision_makers_reached / conversations`

## Qualification

`qualified_rate = qualified_conversations / decision_makers_reached`

## Meeting

`meeting_rate_per_qualified = meetings / qualified_conversations`

`meeting_rate_per_decision_maker = meetings / decision_makers_reached`

`meeting_rate_per_attempt = meetings / eligible_attempts`

## Opportunity

`opportunity_rate = opportunities_created / meetings_or_qualified_conversations` according to final CRM definition.

## Close

`close_rate = closed_won / qualified_opportunities`

Do not compare metrics using inconsistent denominators.

---

# 5. MARKET MINER METRICS

Per provider/query/vertical/territory:

- search tasks;
- paid observations;
- unique advertisers found;
- unique accounts found;
- duplicate rate;
- non-fit rejection rate;
- website resolution rate;
- decision-maker enrichment rate;
- research-complete rate;
- Tier A rate;
- Tier B+ rate;
- average YAD score;
- search-cell saturation rate;
- cost per unique account;
- cost per research-complete account;
- cost per Tier A;
- cost per Tier B+.

The best source is not necessarily the one that discovers the most companies.

It may be the source with the lowest cost per qualified meeting.

---

# 6. SOURCE QUALITY / DOWNSTREAM ATTRIBUTION

Every account retains source lineage.

Examples:

- DataForSEO paid SERP
- SerpApi LSA
- Google Places gap-fill
- Apollo list
- public registry
- manual list
- referral

Measure downstream by source:

- decision-maker reach;
- qualified conversation;
- meeting;
- opportunity;
- close;
- revenue.

This answers:

> Are active Google advertisers actually better prospects than generic lists for this vertical?

Do not assume the answer before data exists.

---

# 7. HOOK PERFORMANCE

Every outbound conversation logs the primary hook family actually used.

Families:

- paid_after_hours
- missed_call
- speed_to_lead
- replacement_follow_up
- generic_follow_up
- attribution
- crm_workflow
- employee_capacity
- reporting
- reactivation
- website_conversion
- growth_scalability
- integration

Metrics by hook:

- conversation continuation after opener;
- qualified conversation rate;
- meeting rate;
- negative/hostile rate;
- DNC rate;
- average QA score.

Do not optimize for call duration. A longer call can be a worse call.

---

# 8. ADVERTISER-SIGNAL PERFORMANCE

Track cohorts:

- Google paid only;
- Local Services Ad;
- Meta only;
- Google + Meta;
- Google + LSA;
- multi-channel;
- no confirmed paid advertising.

Also track advertised service category:

- emergency repair;
- replacement;
- financing;
- maintenance;
- generic brand;
- other.

Questions analytics should eventually answer:

- Do LSA advertisers yield more qualified conversations than normal paid search advertisers?
- Does replacement advertising outperform generic service advertising?
- Does multi-channel paid presence increase meeting rate?

---

# 9. YAD SCORE CALIBRATION

Canonical Module 4C score remains unchanged initially.

Measure outcome by score/tier:

- 0–2 / D
- 3–5 / C
- 6–8 / B
- 9+ / A

Also bucket exact score where sample size permits.

Compare:

- reach;
- qualified conversation;
- meeting;
- close.

If Tier A does not outperform B/C after sufficient sample, review feature assumptions — but do not silently rewrite the scoring model.

---

# 10. RESEARCH ACCURACY METRICS

Track when prospect corrects research.

Categories:

- business identity wrong;
- website wrong;
- ad activity stale;
- service/offer stale;
- system/CRM signal wrong;
- decision-maker wrong;
- location wrong;
- hours/24-7 wrong.

Metrics:

`research_correction_rate = corrected_material_claims / material_claims_used`

`unsupported_claim_rate = unsupported_claims / calls_reviewed`

Goal for production truth claims should approach zero unsupported claims.

---

# 11. RESEARCH COMPLETENESS VALIDATION

Compare outcomes/error rates by:

- complete
- good
- partial
- thin
- stale

If `partial` packs show materially higher correction/hard-fail rates, increase refresh requirements before contact.

---

# 12. VOICE LATENCY METRICS

Per turn:

## Answer-to-greeting

`greeting_latency = first_agent_audio - usable_human_answer_signal`

## Conversational first audio

`turn_first_audio_latency = first_agent_audio - user_speech_final`

Also measure from partial-endpoint signal if using predictive endpointing.

## Interruption stop

`barge_in_stop_latency = agent_audio_stopped - interruption_detected`

Report:

- p50
- p75
- p95
- p99

Do not hide tail latency behind average.

---

# 13. VOICE QUALITY PROXIES

Track:

- interruption count;
- agent-talk-over events;
- repeated-response events;
- long-agent-turn events;
- silence >2 seconds;
- silence >3 seconds;
- response cancellation success;
- STT corrections;
- call disconnects;
- voicemail classification accuracy from reviewed sample.

Human review still matters; metrics are proxies.

---

# 14. QA SCORE METRICS

Store all 12 Sales Manual criteria individually.

Report:

- average total score;
- distribution;
- per-criterion average;
- hard-fail rate;
- hard-fail category;
- score by prompt/model/voice version;
- score by vertical/hook.

A high average score does not excuse a non-zero severe DNC/false-claim failure rate.

---

# 15. ACTION RELIABILITY

For each tool:

- request count;
- success count;
- failure count;
- p50/p95 latency;
- retry count;
- false-success assertion count.

Critical tools:

- DNC suppression;
- booking;
- CRM write;
- transfer.

Target false-success assertion:

zero.

The agent must never say “you're booked” unless booking provider confirms success.

---

# 16. PROVIDER ECONOMICS

Per provider:

- task count;
- API cost;
- success/error rate;
- unique-account yield;
- Tier A/B yield;
- meeting yield;
- opportunity yield;
- revenue attribution eventually.

Key formulas:

`cost_per_unique_account = provider_cost / new_unique_accounts`

`cost_per_tier_b_plus = provider_cost / tier_b_plus_accounts`

`cost_per_decision_maker = attributed_research_cost / decision_makers_reached`

`cost_per_qualified_conversation = attributed_research_cost / qualified_conversations`

`cost_per_meeting = attributed_research_cost / meetings`

Do not attribute the entire platform monthly cost simplistically when provider usage spans campaigns; allocate according to usage rules.

---

# 17. CAMPAIGN UNIT ECONOMICS

Eventually include:

- research provider cost;
- telecom cost;
- model token/inference cost;
- STT/TTS cost;
- SMS/email cost;
- human sales labor if desired;
- booked meetings;
- opportunities;
- gross closed revenue;
- collected revenue.

This yields:

- cost per meeting;
- cost per opportunity;
- acquisition cost;
- gross return on outbound program.

Do not confuse prospect hypothetical ROI with YAD's internal campaign ROI.

---

# 18. EXPERIMENTATION

Every test needs:

- experiment ID;
- hypothesis;
- eligibility cohort;
- control;
- variant(s);
- assignment rule;
- primary metric;
- guardrail metrics;
- minimum sample policy;
- start/end dates;
- conclusion;
- reviewer.

Examples:

- honest “cold call” opener vs permission opener;
- after-hours hook vs attribution hook for same eligible cohort;
- voice A vs voice B;
- one model vs another.

Never experiment with:

- truthful vs deceptive identity;
- DNC compliance;
- unauthorized calling windows;
- unsupported claims.

---

# 19. SAMPLE-SIZE / THIN-DATA RULE

The Learning Brain must be allowed to say:

> Insufficient evidence.

Do not make strong optimization claims from five calls.

Initial reporting should show:

- numerator;
- denominator;
- confidence/uncertainty indicator;
- period.

Formal statistical methodology can be implemented later, but V1 should at minimum avoid ranking tiny samples as definitive winners.

---

# 20. FUTURE LEARNED PROPENSITY MODEL

Only after sufficient labeled data exists.

Potential targets:

- decision-maker reach probability;
- qualified conversation probability;
- meeting probability;
- opportunity probability;
- closed-won probability.

Potential features:

- vertical;
- geography;
- canonical score components;
- ad channel;
- LSA;
- advertised service;
- website maturity;
- locations;
- emergency;
- financing;
- system signals;
- decision-maker availability;
- source provider;
- hook family;
- day/time;
- historical attempt state.

Exclude sensitive/protected-person attributes.

Keep model output separate from canonical YAD score.

---

# 21. MODEL GOVERNANCE

Every live model/prompt version gets identifiers.

Record per call:

- realtime model;
- provider;
- system prompt version;
- Call Pack schema version;
- vertical profile version;
- Sales Manual knowledge snapshot;
- voice provider/voice ID;
- STT provider/model;
- orchestration version.

Without versioning, performance comparisons are meaningless.

---

# 22. WEEKLY MANAGEMENT REPORT

Recommended dashboard/report:

## Supply

- new accounts discovered;
- Tier A/B generated;
- ready inventory;
- research cost;
- top-yield territories/queries.

## Outreach

- attempts;
- conversations;
- decision-makers;
- qualified conversations;
- meetings;
- DNC;
- disqualifications.

## Conversion

- conversation/attempt;
- decision-maker/conversation;
- qualified/decision-maker;
- meeting/qualified.

## Quality

- QA score;
- hard fails;
- unsupported claim rate;
- research correction rate.

## Voice

- p50/p95 first-audio latency;
- barge-in latency;
- long-silence rate.

## Economics

- research cost/Tier B+;
- cost/meeting;
- telecom/model cost;
- opportunities/closed revenue when available.

## Learnings

Human-reviewed insights only, e.g.:

- “Tier A emergency-HVAC Google advertisers are producing more qualified conversations than generic HVAC lists; sample = 143 decision-maker conversations.”

Never omit the sample denominator.

---

# 23. SALES MANUAL FEEDBACK LOOP

The Learning Brain may propose:

- new hook candidate;
- weak hook to retire;
- new objection requiring training;
- vertical query terms producing strong prospects;
- public signal correlated with qualified opportunities;
- common research misconception;
- CRM note/disposition improvement.

Proposals go to human review.

Approved sales-doctrine changes should flow back into the canonical Sales Manual, then vertical profile/index — not become hidden runtime prompt drift.
