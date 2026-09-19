# Your AI Department — Experiment Governance Specification

**Status:** Architecture authority  
**Purpose:** Let YAD test hooks, search strategies, providers, Call Pack formats, and voice settings without contaminating production data or allowing unsafe behavior changes.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

The system needs experiments, but every experiment must be:

- explicit;
- versioned;
- reversible;
- auditable;
- bounded;
- safe;
- analyzable.

“Claude changed the prompt and it felt better” is not an experiment.

---

# 2. EXPERIMENT TYPES

Allowed V1 categories:

- query_priority
- search_provider
- search_depth
- research_depth
- contact_role_priority
- hook_family
- opener_wording within approved doctrine
- Call Pack presentation
- follow-up timing under approved cadence
- voicemail wording
- voice/STT/TTS technical configuration on controlled tests
- Human Assist UI ordering

Not eligible for casual experiments:

- compliance rules
- DNC handling
- AI disclosure policy
- production dial enablement
- legal/professional boundaries
- commercial pricing/offer truth
- guarantees/claim boundaries
- secrets/security controls

---

# 3. EXPERIMENT OBJECT

`Experiment`

- experiment_id
- name
- hypothesis
- category
- owner
- created_at
- start_at
- end_at optional
- target_verticals[]
- target_markets[]
- eligible_campaigns[]
- unit_of_randomization
- variants[]
- primary_metric
- guardrail_metrics[]
- minimum_sample_target
- analysis_plan
- stop_conditions[]
- status
- approved_by

---

# 4. RANDOMIZATION UNIT

Choose deliberately.

Possible units:

- search task
- Account
- campaign
- market
- human rep
- controlled test call

Do not randomize the same Account into conflicting outreach variants simultaneously.

For sales hooks, Account is often safer than call attempt so the same company does not receive inconsistent messages across attempts.

---

# 5. VARIANT SNAPSHOT

Each variant stores exact versioned inputs.

Example hook experiment:

A: `paid_after_hours`
B: `attribution`

Store:

- Call Pack version
- prompt template version
- vertical profile hash
- CommercialTruthSnapshot
- manual snapshot
- campaign rules

This makes historical results reproducible.

---

# 6. PRIMARY METRIC

One experiment should have one primary decision metric whenever possible.

Examples:

Query test:
`cost_per_tier_b_plus`

Hook test:
`qualified_conversation_rate_per_decision_maker`

Contact-role test:
`qualified_conversation_rate_per_successful_role_contact`

Voice technical test:
`p95_turn_first_audio_latency` with QA guardrails.

Avoid choosing whichever metric looks best after the test.

---

# 7. GUARDRAIL METRICS

Every sales experiment should monitor:

- DNC rate
- hostile response rate
- QA hard-fail rate
- unsupported-claim rate
- research correction rate
- complaint/escalation rate

A variant that increases meetings but causes claim violations is not a winner.

---

# 8. STOP CONDITIONS

Immediate stop examples:

- DNC handling failure
- unsupported material claims
- wrong-person leakage due bad routing
- production safety/compliance violation
- materially elevated complaints
- provider cost runaway
- system bug causing duplicate contact

Statistical underperformance alone normally does not require emergency shutdown unless budget limits apply.

---

# 9. SAMPLE SIZE DISCIPLINE

Do not declare winners from tiny samples.

Minimum reporting should always include:

- eligible units
- attempts
- decision-makers reached
- qualified conversations
- meetings
- confidence/uncertainty

If sample is thin, output:

`INSUFFICIENT_EVIDENCE`

rather than “Variant B wins.”

---

# 10. SEGMENTATION

Analyze experiment by planned segments only.

Examples:

- HVAC vs Roofing
- Tier A vs B
- Google LSA vs paid search
- market

Avoid post-hoc slicing until some tiny subgroup appears to win.

---

# 11. PROVIDER EXPERIMENTS

When comparing DataForSEO/SerpApi/etc., measure:

- cost
- result completeness
- paid-observation yield
- unique Account yield
- duplicate/noise rate
- latency
- failure rate
- Tier B+ yield

Ensure equivalent geography/query intent where possible.

Do not compare one provider's broad organic search to another provider's narrow paid endpoint and call it apples-to-apples.

---

# 12. HUMAN ASSIST EXPERIMENTS

Possible UI tests:

- evidence-first vs hook-first card layout
- 3-question vs 5-question Call Pack
- decision-maker at top vs lower
- source links collapsed/expanded

Primary metrics:

- rep prep time
- research correction rate
- rep usefulness rating
- conversation qualification

Do not optimize solely for fastest clicks if quality suffers.

---

# 13. VOICE EXPERIMENTS

Production prospect voice tests require the applicable deployment/compliance gate.

Before that, run controlled participant tests.

Variables:

- endpointing
- STT provider
- realtime LLM
- TTS voice
- speech rate
- turn-length limits

Guardrails:

- identity/truthfulness
- DNC
- barge-in
- action-tool accuracy
- no impersonation

---

# 14. LEARNING PROMOTION

An experiment result becomes a proposed default change only after:

1. analysis complete;
2. guardrails pass;
3. sample adequate;
4. reviewer approves;
5. configuration version created;
6. rollback path exists.

Do not directly mutate profile YAML or production prompt from experiment results.

---

# 15. ROLLBACK

Every deployable experiment change must store:

- prior version
- new version
- activation time
- affected campaigns
- rollback command/control

Critical operational config should support immediate rollback without code deploy where practical.

---

# 16. CONTAMINATION CONTROL

Exclude from normal performance analysis:

- internal test calls
- roleplay calls
- known demo businesses
- repeated test Accounts
- manually scripted demos

Tag them clearly.

---

# 17. REPORT TEMPLATE

Each concluded experiment reports:

- hypothesis
- variants
- population
- dates
- primary metric
- guardrails
- sample counts
- result
- uncertainty
- operational interpretation
- recommended action
- approved/rejected

---

# 18. CORE RULE

Experimentation is how YAD gets smarter without turning production into an uncontrolled prompt playground. Every test must leave a clean audit trail and every production change must remain reversible.
