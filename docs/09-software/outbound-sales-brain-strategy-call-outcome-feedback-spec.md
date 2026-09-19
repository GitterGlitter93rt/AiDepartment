# Your AI Department — Strategy Call Outcome Feedback Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Close the learning loop from cold-call hook to attended 15-minute strategy call to real sales opportunity, so YAD does not optimize for calendar bookings that waste Michael's time.

---

# 1. PRINCIPLE

A booked meeting is an intermediate event, not the final quality signal.

The system should be able to answer:

> Which research pattern, target role, hook, hypothesis, conversation behavior and qualification decision produced meetings that Michael considered worth having?

Canonical learning path:

`Account research`
-> `Call Pack`
-> `hook/opener`
-> `cold conversation`
-> `qualification gate`
-> `Cal.com booking`
-> `attendance`
-> `Michael meeting outcome`
-> `Opportunity / no-sale / follow-up`
-> `feedback to targeting + hook + qualification`.

---

# 2. MEETING OUTCOME OBJECT

Create canonical `StrategyCallOutcome` attached to:

- meeting_booking_id;
- Account;
- Contact;
- Opportunity if created;
- source call/session;
- pilot/campaign;
- original Runtime Call Pack;
- hook/opener version;
- primary hypothesis;
- strategy-call qualification decision.

Suggested fields:

```text
strategy_call_outcome_id
meeting_booking_id
account_id
contact_id optional
opportunity_id optional
source_call_id optional
campaign_id optional
pilot_batch_id optional
attendee_status
meeting_started_at optional
meeting_ended_at optional
host_user_id
qualification_quality
problem_confirmed
problem_materiality
stakeholder_fit
urgency_timing
business_case_path
next_step
opportunity_created
opportunity_stage optional
no_sale_reason optional
host_notes
created_at
updated_at
```

---

# 3. ATTENDANCE STATES

Use explicit states:

- `ATTENDED`
- `NO_SHOW_CONFIRMED`
- `CANCELLED`
- `RESCHEDULED`
- `ATTENDANCE_UNKNOWN`

Do not label a prospect no-show merely because no downstream activity was recorded.

---

# 4. MICHAEL QUALIFICATION QUALITY

After an attended strategy call, Michael should be able to rate the **quality of the AI qualification**, not the personality of the prospect.

Recommended 1–5 scale:

## 5 — Excellent handoff

- correct stakeholder;
- AI-identified problem was real;
- prospect understood why meeting was happening;
- 15 minutes was justified;
- meaningful next step/opportunity or high-value no-sale conclusion.

## 4 — Good

- relevant stakeholder/problem;
- minor missing context;
- meeting was clearly worth taking.

## 3 — Borderline

- some relevance;
- meeting useful but qualification could have been stronger.

## 2 — Weak

- problem overstated/unclear;
- wrong stakeholder or very low priority;
- meeting likely should not have been booked yet.

## 1 — Bad booking

- no legitimate business reason;
- materially wrong context;
- prospect did not understand purpose;
- qualification gate failed.

Do not infer this score automatically from whether a deal closed.

A high-quality meeting can correctly end in no sale.

---

# 5. PROBLEM CONFIRMATION

Record whether the problem the Sales AI surfaced was:

- `CONFIRMED`
- `PARTIALLY_CONFIRMED`
- `CONTRADICTED`
- `NOT_EVALUATED`

This field should specifically evaluate the **original hypothesis**, not any unrelated problem Michael discovered later.

Example:

AI hypothesis:

`after-hours lead handling may be inconsistent`.

Michael learns:

- answering service reliably books all qualified emergencies;
- actual issue is old-estimate reactivation.

Result:

`primary hypothesis = CONTRADICTED`.

Meeting may still be valuable, but the hook/qualification learning remains honest.

---

# 6. PROBLEM MATERIALITY

If confirmed/partially confirmed, rate materiality:

- `HIGH`
- `MEDIUM`
- `LOW`
- `UNKNOWN`

Materiality should reflect business consequence supported during the meeting, not the AI's original guess.

Possible evidence:

- volume;
- labor burden;
- revenue exposure;
- customer experience;
- response-time issue;
- visibility/management burden;
- growth bottleneck.

Do not fabricate financial impact.

---

# 7. STAKEHOLDER FIT

Record:

- `DECISION_MAKER`
- `PROCESS_OWNER`
- `INFLUENCER`
- `WRONG_STAKEHOLDER`
- `UNKNOWN`

This lets the contact resolver learn separately from the hook.

A strong hook with the wrong attendee is primarily a contact-routing problem, not necessarily a script problem.

---

# 8. BUSINESS-CASE PATH

After the strategy call classify:

- `CLEAR_BUSINESS_CASE`
- `MEASUREMENT_FIRST`
- `TECHNICAL_VALIDATION_FIRST`
- `TIMING_FOLLOWUP`
- `NO_MEANINGFUL_CASE`
- `OUT_OF_SCOPE`
- `UNKNOWN`

This aligns with YAD doctrine that `measure first` and `no sale` are legitimate results.

---

# 9. NEXT STEP

Canonical next steps:

- second strategy/technical meeting;
- request small data set;
- Executive AI Strategy;
- AI Implementation discovery/scope;
- Managed AI Department discussion;
- marketing-specific discussion when current authority supports it;
- assessment;
- proposal readiness work;
- follow up on a specified date;
- no sale;
- disqualify.

Do not create a proposal automatically because a 15-minute meeting was positive.

---

# 10. HOST REVIEW UX

Within Meetings / Opportunity UI, after meeting end show a small `Meeting Outcome` card.

Target completion time: under ~60 seconds.

Fields shown to Michael:

1. Did they attend?
2. Was this meeting worth taking? `1–5`
3. Was the AI's original problem confirmed?
4. Was the person the right stakeholder?
5. What happens next?
6. Optional concise note.

Do not force Michael to fill a 30-field form after every meeting.

More detail can be added in Opportunity Detail later.

---

# 11. AUTO-PREFILL

System may prefill from existing records:

- Account;
- attendee;
- source call;
- original hook;
- original hypothesis;
- prep brief;
- meeting start/time;
- opportunity if already created.

Michael confirms/corrects outcome fields.

Do not have a model fabricate the host's qualification rating.

---

# 12. LINK BACK TO COLD CALL

Every outcome should join back to:

- hook family/version;
- opener frame;
- target role;
- contact route quality;
- primary hypothesis;
- research evidence class;
- advertiser evidence strength;
- agent/script version;
- voice/model version;
- qualification result;
- booking close version.

This makes downstream metrics possible without flattening everything into a raw booking rate.

---

# 13. CORE QUALITY METRICS

Per hook/cohort calculate when sample permits:

- booked meetings;
- attended meetings;
- attendance rate;
- average Michael qualification-quality score;
- % problem confirmed/partially confirmed;
- % correct stakeholder;
- % clear business case;
- % measurement-first;
- % opportunity created;
- % no meaningful case;
- % bad booking (`quality <=2`).

Do not compare small samples as if statistically conclusive.

---

# 14. QUALIFIED ATTENDED MEETING

For analytics, define a `qualified_attended_meeting` separately from simple attendance.

Recommended V1 definition:

```text
attendee_status = ATTENDED
AND qualification_quality >= 4
AND stakeholder_fit != WRONG_STAKEHOLDER
AND problem_confirmed IN (CONFIRMED, PARTIALLY_CONFIRMED)
```

Manager can revise definition through versioned analytics policy later.

This metric must not become a reason to hide valid no-sale meetings.

---

# 15. BAD-BOOKING ROOT CAUSE

If quality <=2, select primary cause:

- wrong_contact;
- weak_prospect_fit;
- unsupported_hypothesis;
- hook_misframed;
- agent_failed_to_listen;
- agent_booked_too_early;
- objection_misread_as_interest;
- AI_curiosity_only;
- prospect_misunderstood_meeting;
- data_stale;
- other.

Route that cause to the correct optimization system.

Do not rewrite the hook because contact enrichment selected the wrong person.

---

# 16. POSITIVE LEARNING

For quality >=4, capture what was right:

- correct problem family;
- strong evidence/context;
- good first question;
- useful prospect statement before booking;
- correct stakeholder;
- concise close;
- strong prep-brief handoff.

Use winning patterns as evidence for future selection, not as permission to fabricate social proof.

---

# 17. ATTENDANCE LEARNING

Attendance is partly distinct from cold-call qualification.

If booking quality is high but no-show rate is poor, investigate:

- reminder timing;
- meeting delay from booking;
- email correctness;
- calendar delivery;
- event framing;
- prospect timezone;
- reschedule UX.

Do not assume the sales script is responsible.

---

# 18. ANALYTICS FUNNEL

Update the main funnel to distinguish:

`Researched`
-> `Contactable`
-> `Attempted`
-> `Connected`
-> `Right Stakeholder`
-> `Meaningful Problem`
-> `Qualified Offer`
-> `Booked`
-> `Attended`
-> `Qualified Attended`
-> `Opportunity`
-> later commercial outcome.

---

# 19. EXPERIMENT PROMOTION RULE

A hook/opener variant should not be promoted solely because it has higher booking rate.

Prefer variants that improve, or at minimum preserve:

- qualification-quality score;
- attended-meeting quality;
- stakeholder correctness;
- problem confirmation;
- negative/DNC experience;
- hard-fail rate.

Booking count is a leading signal; meeting quality is downstream validation.

---

# 20. CORE RULE

**The Sales AI is successful when it gets the right business problem and the right person in front of Michael at the right time — not when it merely fills the calendar.**
