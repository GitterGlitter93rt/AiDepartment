# Your AI Department — Strategy Call Qualification Gate

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Decide when the outbound Sales AI should attempt to book Michael's 15-minute strategy call versus continue discovery, schedule a callback, send targeted information, or end the interaction.

---

# 1. PRINCIPLE

The system should optimize for **useful strategy calls**, not raw booking count.

A calendar full of polite but unqualified prospects creates false success and wastes Michael's time.

The booking decision is separate from:

- Module 4C Account fit score;
- advertiser strength;
- contact quality;
- conversation sentiment.

A Tier A Account can still be a bad meeting if the tested problem is solved and the prospect has no interest in another area.

---

# 2. BOOKING SIGNAL OBJECT

```text
StrategyCallReadiness
- account_id
- contact_id optional
- call_id
- tested_hypothesis
- stakeholder_relevance
- pain_status
- problem_priority
- willingness_to_explore
- data_gap_status
- next_step_requested
- booking_recommendation
- supporting_turn_ids[]
- reason_codes[]
- created_at
```

Recommended categorical values rather than one opaque probability.

---

# 3. PAIN STATUS

- `confirmed_meaningful`
- `confirmed_minor`
- `possible_worth_measuring`
- `solved_strong_process`
- `no_problem`
- `unknown`

Do not convert a public hypothesis into `confirmed_meaningful`.

---

# 4. STAKEHOLDER RELEVANCE

- `decision_owner`
- `strong_influencer`
- `routing_only`
- `wrong_person`
- `unknown`

A routing-only gatekeeper normally should not book Michael unless they are explicitly scheduling for the correct stakeholder.

---

# 5. WILLINGNESS TO EXPLORE

- `explicit_yes`
- `interested`
- `neutral`
- `busy_but_open`
- `not_interested`
- `explicit_no`

Politeness is `neutral`, not `interested`.

---

# 6. BOOK NOW

Recommend `BOOK_NOW` when a relevant stakeholder and at least one legitimate reason for deeper review exist.

Common paths:

## Path A — confirmed problem

- stakeholder = decision_owner or strong_influencer;
- pain = confirmed_meaningful;
- willingness = explicit_yes/interested/busy_but_open.

## Path B — worth measuring

- stakeholder relevant;
- pain = possible_worth_measuring;
- current data is insufficient;
- prospect agrees it would be useful to measure/map the workflow.

## Path C — prospect requests next step

Prospect explicitly requests:

- strategy conversation;
- demonstration;
- assessment;
- deeper review;
- conversation with Michael.

Provided scope is legitimate for YAD.

## Path D — multi-stakeholder problem

Current contact understands/owns enough of the workflow to identify a real issue but another stakeholder is needed.

Meeting can include both when prospect agrees.

---

# 7. DO NOT BOOK YET

Recommend `CONTINUE_BRIEFLY` when:

- prospect is engaged but current problem is still unclear;
- first answer is too vague to justify Michael's time;
- AI needs one additional high-information question;
- stakeholder may be relevant but authority/problem ownership is unclear.

Do not continue indefinitely. The cold call should not become free consulting.

---

# 8. CALLBACK INSTEAD

Recommend `CALLBACK` when:

- relevant stakeholder is genuinely busy but open;
- prospect asks for a specific time;
- correct decision-maker is unavailable and business provides a callback window;
- calendar booking isn't appropriate yet but conversation should continue.

Callback is not a failed booking.

---

# 9. TARGETED EMAIL INSTEAD

Recommend `SEND_TARGETED_INFO` when:

- prospect asks for a short email;
- topic can be made specific from conversation;
- they are not ready to schedule;
- channel policy permits.

Capture an agreed follow-up point where possible.

Do not turn `send me an email` into automatic opportunity stage advancement.

---

# 10. END / NO SALE

Recommend `END_NO_NEED` when:

- tested primary process is strong;
- one evidence-supported backup is also strong/no pain;
- prospect reports no meaningful operational issue;
- economics/volume clearly too small based on supported conversation;
- YAD is not appropriate;
- prospect is not interested and does not want another step.

No-sale is an acceptable and desirable outcome.

---

# 11. DISQUALIFIED / UNSAFE REQUEST

Recommend `DISQUALIFY_OR_REVIEW` when request depends on:

- unlawful/discriminatory behavior;
- unauthorized professional judgment;
- guaranteed outcomes;
- YAD capabilities not supported by current truth;
- risk/compliance issue requiring human review.

Do not book Michael simply to avoid saying no unless a legitimate governance/strategy conversation still exists.

---

# 12. MEETING DESCRIPTION

Prospect should understand the meeting as:

> A short business strategy conversation to map the relevant workflow, understand the real numbers where available, and determine whether there is actually a useful YAD opportunity.

It is not automatically:

- a sales demo;
- a proposal meeting;
- an implementation kickoff;
- a guaranteed savings audit;
- a free consulting engagement.

---

# 13. BOOKING CLOSE POLICY

Once `BOOK_NOW` is reached, prefer moving to booking rather than asking five more questions.

Recommended:

> Based on what you just told me, that sounds worth looking at properly instead of guessing on a cold call. Michael handles these strategy conversations for us, and it's only 15 minutes. Want me to check what he has open?

If yes -> booking tool.

If hesitation -> ask one clarifying question about next-step concern, not another discovery chain.

---

# 14. MEETING HANDOFF QUALITY

A meeting should not be considered successfully qualified until canonical handoff contains at least:

- company/account;
- attendee/role;
- reason YAD called;
- tested hypothesis;
- current workflow summary from prospect;
- problem/pain or reason for review;
- relevant systems/numbers only if stated;
- objections/concerns;
- what prospect expects from the meeting;
- questions Michael should ask;
- unsupported assumptions Michael should avoid.

---

# 15. METRICS

Track separately:

- calls connected;
- correct stakeholder conversations;
- meaningful problems found;
- strategy calls offered;
- strategy calls accepted;
- strategy calls booked;
- strategy calls attended;
- Michael marks meeting qualified/unqualified;
- opportunities created;
- no-need outcomes.

Key quality metric:

`qualified_attended_strategy_calls / booked_strategy_calls`

Do not optimize only `booked / dials`.

---

# 16. FEEDBACK LOOP

After meeting, Michael/rep can mark:

- excellent qualification;
- useful but incomplete;
- wrong stakeholder;
- no real problem;
- misleading call summary;
- premature booking;
- missed opportunity.

Use reviewed outcomes to propose conversation-policy improvements.

Do not autonomously change the booking threshold from small samples.

---

# 17. ACCEPTANCE FIXTURES

1. Owner confirms after-hours messages sit until morning and wants improvement -> BOOK_NOW.
2. Owner has 24/7 integrated booking and no other supported issue -> END_NO_NEED.
3. Receptionist identifies GM but cannot discuss workflow -> routing/callback, not Michael booking.
4. Decision-maker says `send me something` but refuses discussion -> SEND_TARGETED_INFO, not BOOK_NOW.
5. Decision-maker says process may leak but has no data and wants to measure -> BOOK_NOW.
6. Prospect politely answers but says everything works -> no booking.
7. Prospect explicitly asks for a demo -> BOOK_NOW if relevant/scope appropriate.
8. Prospect asks for discriminatory automation -> DISQUALIFY_OR_REVIEW, not ordinary booking.
9. Prospect is walking into meeting but asks for call tomorrow -> CALLBACK or strategy booking according to expressed intent.
10. Tier A advertiser says no interest and asks to stop -> no booking; apply suppression when requested.

---

# 18. CORE RULE

**Book Michael when there is a credible reason for Michael to spend 15 minutes with the prospect — not merely because the AI succeeded in keeping them on the phone.**
