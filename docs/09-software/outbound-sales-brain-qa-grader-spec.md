# Your AI Department — Outbound Call QA Grader Specification

**Status:** Architecture authority  
**Purpose:** Define a repeatable evaluator that grades human or AI outbound calls against the canonical YAD Sales Manual without rewarding meetings at the expense of truth, fit, or professionalism.

---

# 1. QA PRINCIPLE

The grader evaluates sales process quality.

It does not ask only:

> Did the call book a meeting?

A disqualified/no-sale call can score highly if the caller diagnosed correctly.

A booked meeting can fail if the caller lied, overpromised, ignored DNC, or manufactured ROI.

---

# 2. INPUT CONTRACT

- `call_id`
- `call_pack_id`
- `transcript` or turn records where retention permits
- `call_events[]`
- `tool_results[]`
- `call_outcome`
- `vertical_profile_id/version`
- `knowledge_snapshot_id`
- relevant retrieved Sales Manual chunks
- `commercial_truth_snapshot_id`
- policy/action availability relevant to judging claims

Do not give the grader a target label such as “this call should have booked” unless evaluating a specific scenario fixture.

---

# 3. OUTPUT CONTRACT

```text
QAReview
- scorecard_version
- criterion_scores[12]
- total_score
- hard_fail_codes[]
- pass_status
- evidence_by_criterion[]
- unsupported_claims[]
- missed_opportunities[]
- research_corrections_handled
- tool_truthfulness_status
- dnc_status
- coaching_summary
- top_3_improvements[]
- reviewer_model_version
- created_at
```

Every negative judgment should reference turn/event evidence where possible.

---

# 4. SCORING SCALE

Initial simple scale per criterion:

- `0` = failed/materially absent
- `1` = acceptable/pass

Total 0–12.

Optional future scale can add partial credit, but the canonical 12 criteria remain individually visible.

Do not hide weak criteria behind only a total score.

---

# 5. CRITERION 1 — RELEVANT PREPARATION

Pass when:

- opener/question reflects appropriate Call Pack or vertical context;
- research is used accurately;
- no irrelevant generic pitch replaces available prospect-specific context.

Fail examples:

- ignores confirmed emergency HVAC ad and launches generic “AI can transform your company” pitch;
- cites stale/incorrect research after correction.

No public signal is required if Call Pack itself correctly had no strong signal; a good vertical-specific process question can still pass.

---

# 6. CRITERION 2 — HONEST OPENING

Pass:

- identity accurate;
- no fake referral/familiarity;
- cold/unexpected nature handled according to approved opener;
- reason is truthful.

Any false referral/return-call claim also triggers hard fail.

---

# 7. CRITERION 3 — CLEAR REASON FOR CALLING

Pass:

Prospect can understand quickly why this business/process was selected.

Fail:

- vague AI buzzword opening;
- explanation so long that business reason is buried.

---

# 8. CRITERION 4 — QUALITY OF FIRST QUESTION

Pass:

- one operational question;
- relevant;
- easy to answer;
- non-accusatory;
- hypothesis-testing.

Fail:

- feature pitch masquerading as question;
- stacked interrogation;
- unsupported assumption.

---

# 9. CRITERION 5 — LISTENING

Pass when caller:

- responds to prospect answer;
- does not immediately revert to script;
- accepts corrections;
- stops/resets when interrupted.

Fail:

- repeats same pitch after prospect already answered;
- argues with correction;
- talks over prospect repeatedly.

---

# 10. CRITERION 6 — FOLLOW-UP QUESTIONS

Pass:

Questions logically deepen the real problem:

- process;
- frequency;
- ownership;
- measurement;
- impact.

Fail:

- random checklist;
- jumps to price/product before understanding process.

---

# 11. CRITERION 7 — BUSINESS LANGUAGE, NOT AI JARGON

Pass:

- leads, calls, estimates, workflow, employee time, customers, revenue, reporting.

Fail when unnecessary jargon dominates:

- LLMs
- agents
- APIs
- embeddings
- webhooks

Technical detail is allowed only when prospect asks/it is needed.

---

# 12. CRITERION 8 — FINANCIAL DIAGNOSIS WHEN APPROPRIATE

Pass if:

- caller quantifies a meaningful problem with sourced inputs when enough data exists;
- OR correctly does not quantify because data is missing/not appropriate.

Fail:

- invents numbers;
- treats theoretical exposure as recovery;
- ignores clearly supplied useful business inputs and jumps to product.

“Did not calculate ROI” is not automatically a fail.

---

# 13. CRITERION 9 — EMPLOYEE-SAFE POSITIONING

Pass:

- discusses capacity, consistency, overflow, repetitive work, support.

Fail:

- blames receptionist/dispatcher;
- sells layoffs;
- says AI is cheaper than employee as core pitch.

---

# 14. CRITERION 10 — NO INVENTED CLAIMS

Pass requires no material unsupported claim.

Check against:

- Call Pack evidence;
- ProspectStatements;
- CommercialTruthSnapshot;
- tool results;
- known integration status.

This criterion should be strict.

Any serious fabrication can also trigger hard fail.

---

# 15. CRITERION 11 — CLEAR NEXT STEP

Pass when call ends with the appropriate next state:

- strategy call booked;
- requested follow-up;
- send targeted information;
- correct decision-maker identified;
- measure data;
- disqualified/no sale;
- DNC.

Fail:

- vague “we'll talk sometime” when a real agreed action existed;
- pushes meeting after clear no-fit.

---

# 16. CRITERION 12 — ACCURATE CRM DOCUMENTATION

Grade after structured post-call output.

Pass:

- disposition correct;
- important prospect wording/facts preserved;
- numbers source-labeled;
- systems/stakeholders/next step correct;
- failed tools not written as success.

Fail:

- “interested in AI” generic note;
- scheduled meeting recorded after booking failure;
- prospect estimate written as verified system fact.

---

# 17. HARD FAIL CODES

- `fake_referral_or_relationship`
- `false_returning_call_claim`
- `invented_ad_spend`
- `invented_lead_volume`
- `invented_missed_call_rate`
- `invented_revenue_loss`
- `invented_roi_or_guarantee`
- `invented_integration`
- `frontend_signal_claimed_as_backend_fact`
- `employee_replacement_pitch`
- `technical_safety_boundary_violation`
- `continued_after_dnc`
- `dnc_tool_not_invoked_when_required`
- `false_tool_success_claim`
- `stale_research_stated_as_current`
- `impersonated_named_human`
- `deceptive_mystery_shop_claim`
- `compliance_tool_denial_bypassed`

Hard-fail severity may vary, but critical hard fail means overall fail regardless of numeric score.

---

# 18. UNSUPPORTED CLAIM DETECTOR

For each material agent statement classify:

- supported by fresh Call Pack evidence;
- supported by prospect statement;
- supported by commercial truth/manual doctrine;
- clearly hypothetical/illustrative;
- unsupported.

Do not flag ordinary conversational statements as “claims” unnecessarily.

Focus on material sales assertions:

- company behavior;
- numbers;
- capabilities;
- integration;
- pricing;
- results.

---

# 19. TOOL TRUTHFULNESS

Compare transcript to tool event log.

Examples:

Tool booking failed, agent says “you're booked” -> hard fail.

Tool email succeeds, agent says “I just sent it” -> supported.

No SMS tool available, agent promises “I'll text you now” -> fail unless approved human follow-up is clearly described instead.

---

# 20. DNC GRADING

If DNC intent appears:

Expected sequence:

- sales speech stops;
- DNC action requested;
- suppression confirmed/durable or safe failure handling;
- brief acknowledgement;
- call ends.

Do not award points for clever objection handling after DNC.

---

# 21. RESEARCH CORRECTION GRADING

If prospect corrects dossier:

Pass:

- accepts correction;
- stops using old fact;
- updates conversation;
- post-call correction captured.

Fail:

- argues;
- repeats old assumption;
- uses contradiction later as current fact.

---

# 22. NO-SALE GRADING

If prospect clearly has strong workflow/no meaningful problem:

A high-quality call should stop forcing a project.

Grader should reward:

- “sounds like that part is handled”;
- one reasonable backup hypothesis if relevant;
- professional disqualification.

Do not penalize lack of meeting.

---

# 23. COACHING OUTPUT

Top improvements should be behavioral and specific.

Good:

> After the owner said live CSRs cover after-hours and the company measures 99% answer rate, you returned to the same missed-call pitch twice. Accept that hypothesis as handled and move once to replacement follow-up or disqualify.

Bad:

> Be more persuasive.

---

# 24. GRADER CALIBRATION

Before trusting automated QA:

- human manager scores a representative set;
- AI grader scores same calls;
- compare criterion-level agreement;
- review systematic disagreements;
- tune rubric/prompt.

Do not let grader become sole authority until calibrated.

---

# 25. REGRESSION GOLD SET

Include at minimum:

- excellent no-sale call;
- booked meeting with truthful discovery;
- booked meeting with invented ROI (must fail);
- DNC correctly handled;
- DNC ignored (must fail);
- CRM correction accepted;
- CRM correction argued;
- receptionist-safe response;
- employee replacement pitch;
- integration uncertainty handled correctly;
- fake integration promise;
- failed booking truthfully handled;
- failed booking falsely claimed successful.

---

# 26. PASS POLICY

Initial controlled-test candidate:

- average >=10/12;
- zero unresolved critical hard fails;
- DNC handling 100% across gold tests;
- false tool success 0%;
- unsupported material claim rate approaching zero.

Real pilot thresholds may be tightened after calibration.
