# Your AI Department — Opportunity Qualification & Discovery State Specification

**Status:** Architecture authority  
**Purpose:** Define when a cold conversation becomes a meaningful YAD opportunity, what remains unknown, what should be measured, and when the correct outcome is no-sale or deeper strategy discovery.  
**Source doctrine:** Sales Manual Module 3 — Discovery and Financial Diagnosis.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

The cold caller's job is not to fully qualify and scope a complex AI implementation in one call.

The first conversation should determine whether there is enough legitimate business relevance to earn a deeper strategy/discovery conversation.

Qualification is therefore progressive.

---

# 2. QUALIFICATION STAGES

## `UNTOUCHED_RESEARCHED`

Research only.

## `CONTACTED_NO_DISCOVERY`

Spoke but did not obtain meaningful workflow information.

## `POSSIBLE_OPPORTUNITY`

A relevant workflow/problem is plausible and prospect engaged, but frequency/economics/priority may still be unknown.

## `QUALIFIED_DISCOVERY`

Prospect confirmed a real workflow issue or strategic objective and agreed it deserves deeper evaluation.

## `MEASUREMENT_FIRST`

Potential problem exists but the data required to quantify it is unknown/unreliable.

## `TECHNICAL_REVIEW_REQUIRED`

Business case appears potentially relevant but integration/security/compliance/feasibility must be verified.

## `STRONG_EXISTING_WORKFLOW`

Relevant workflow appears well controlled; do not force YAD solution.

## `DISQUALIFIED`

Not enough volume/economics/fit/authority/priority or inappropriate objective.

## `MEETING_BOOKED`

Next strategy/discovery conversation confirmed.

---

# 3. QUALIFICATION DIMENSIONS

Do not use one BANT-style hidden score.

Track dimensions separately:

- `business_problem`
- `frequency_volume`
- `economic_relevance`
- `current_workflow`
- `current_workaround`
- `desired_state`
- `priority_urgency`
- `process_owner`
- `decision_stakeholders`
- `systems_data`
- `measurement_quality`
- `technical_constraints`
- `human_required_boundaries`
- `next_step_commitment`

Each may be:

- known_verified
- prospect_estimate
- partial
- unknown_measure
- not_applicable

---

# 4. THE LEAK LADDER AS MACHINE STATE

For each confirmed problem:

1. `SYMPTOM`
2. `FREQUENCY`
3. `CAUSE`
4. `CURRENT_WORKAROUND`
5. `COST_OR_IMPACT`
6. `DESIRED_STATE`
7. `CONSTRAINTS`
8. `FEASIBILITY`
9. `PRIORITY`

Cold call may legitimately stop at 1–3 if that is enough to schedule deeper discovery.

The strategy meeting should fill missing layers.

---

# 5. BUSINESS LEAK TAGS

Tag each discovery:

- Revenue Leakage
- Marketing Leakage
- Labor Leakage
- Capacity Leakage
- Information Leakage

A problem may carry multiple tags.

Example:

Paid lead enters after hours and sits until morning:

- Marketing Leakage
- possible Revenue Leakage
- Capacity Leakage
- Information Leakage if response is not measured.

Do not treat a tag as proof of dollar loss.

---

# 6. QUALIFIED-DISCOVERY MINIMUM

A `QUALIFIED_DISCOVERY` normally requires:

1. a real workflow or objective confirmed by prospect;
2. reason the workflow matters to the business;
3. at least one meaningful weakness, constraint, or desired improvement;
4. appropriate stakeholder/owner identified or reachable;
5. prospect agrees deeper review is worthwhile.

Exact economics do not need to be known yet.

---

# 7. POSSIBLE OPPORTUNITY

Example:

Prospect says:

> “Yeah, missed calls happen sometimes, but I don't know how many.”

Correct state:

`POSSIBLE_OPPORTUNITY` or `MEASUREMENT_FIRST`

Not:

`qualified $50k revenue leak`.

---

# 8. MEASUREMENT-FIRST

Use when a potentially important workflow exists but the business lacks visibility.

Examples:

- missed-call rate unknown
- unsold proposal count unknown
- source-to-revenue unknown
- admin hours unknown
- no-show rate unknown

Approved framing:

> “That's useful. I don't want to invent the number. One of the first things we'd want to do is measure it.”

Lack of visibility may itself be a YAD opportunity.

---

# 9. ECONOMIC INPUT SOURCE CLASSES

Every number stores:

- verified_client_data
- prospect_estimate
- system_verified
- public_source
- external_benchmark
- illustrative_assumption
- unknown

Never convert an illustrative scenario into prospect-specific fact.

---

# 10. BUSINESS MODEL FIRST

Before using an ROI tool, know the relevant business unit.

Examples:

- HVAC service call vs replacement estimate
- PI law inquiry vs estate-planning consultation
- dental implant lead vs hygiene appointment
- roofing retail proposal vs storm lead
- collision estimate vs completed repair

Do not mix economics across service families.

---

# 11. VOLUME / FREQUENCY

Questions should follow the specific pain.

Examples:

- How many calls per week?
- How many paid inquiries monthly?
- How many proposals remain open?
- How many no-shows?
- How many employees touch the process?
- How many repetitive hours per week?

If prospect does not know, record unknown_measure.

---

# 12. CURRENT WORKFLOW MAP

For important problems capture:

`Trigger -> Input -> Person/System -> Action -> Handoff -> Decision -> Outcome -> Measurement`

Machine fields should preserve:

- trigger
- entry channel
- owner
- system
- next action
- timing
- failure point
- measurement

This should feed later proposal/scoping work.

---

# 13. PAIN VS PRIORITY

A confirmed annoyance is not necessarily worth solving.

Capture:

- emotional importance
- economic/operational importance
- leadership priority
- timing

Example:

A hated manual task worth $1,500/year may rank below an ignored proposal-follow-up gap affecting much more opportunity.

---

# 14. AUTHORITY / STAKEHOLDERS

Do not require first contact to be final signer.

Capture:

- workflow owner
- executive sponsor
- technical stakeholder
- marketing/sales stakeholder
- legal/security/privacy stakeholder where required
- final approval process if known.

A strong operational contact may be enough to schedule strategy discovery.

---

# 15. TECHNICAL REVIEW REQUIRED

Trigger when:

- specific CRM integration is essential and unverified;
- data access unknown;
- privacy/security requirements significant;
- workflow crosses regulated/professional boundary;
- prospect requests consequential automated decision;
- API/vendor feasibility unknown.

Do not promise feasibility during the cold call.

---

# 16. RED FLAGS

Possible qualification downgrades:

- no meaningful lead/process volume
- no identifiable business problem
- no internal owner
- leadership unwilling to change process
- demands guarantee
- primary objective staff elimination
- wants AI making inappropriate sensitive decisions
- unreliable/no accessible data where solution depends on it
- unsupported integration is mandatory
- economics clearly weak

These may lead to disqualified, measurement-first, or technical-review rather than an immediate sale.

---

# 17. NO-SALE QUALITY

`STRONG_EXISTING_WORKFLOW` is a valid outcome.

Example:

Prospect confirms:

- all calls recovered
- CRM tasks reliable
- attribution clean
- no significant admin pain
- leadership satisfied

Correct response:

Do not invent another problem.

Record what is strong and exit professionally.

---

# 18. NEXT-STEP TYPES

Possible outcomes:

- strategy_call
- technical_review
- measurement/audit
- human_followup
- send_specific_information
- nurture_future
- no_sale
- disqualify

Next step should match missing information.

---

# 19. STRATEGY-MEETING READINESS

Before booking, ideally know:

- primary confirmed problem/objective
- why it matters
- relevant process owner
- key systems if known
- 2–5 missing facts worth exploring
- prospect's desired outcome

Do not require full ROI math before scheduling.

---

# 20. QUALIFICATION OBJECT

`OpportunityQualificationSnapshot`

- account_id
- opportunity_id optional
- stage
- primary_problem
- leak_tags[]
- current_workflow_summary
- confirmed_failure_or_constraint
- frequency_volume_values[]
- economic_inputs[]
- desired_state
- priority
- process_owner
- stakeholders[]
- systems[]
- measurement_quality
- technical_review_flags[]
- human_required_boundaries[]
- missing_discovery_fields[]
- next_step
- source_call/conversation
- generated_at
- qualification_version

Immutable snapshot; create a new one as discovery progresses.

---

# 21. ACCEPTANCE TESTS

1. Prospect confirms missed calls but no volume -> MEASUREMENT_FIRST, not quantified leak.
2. Roofing owner confirms 60 open proposals and inconsistent follow-up -> QUALIFIED_DISCOVERY.
3. Law firm asks AI to decide case acceptance -> technical/professional boundary; do not sell that automation.
4. Strong ServiceTitan HVAC workflow with reliable overflow and attribution -> STRONG_EXISTING_WORKFLOW/no-sale allowed.
5. Prospect wants specific unsupported integration -> TECHNICAL_REVIEW_REQUIRED.
6. Med spa confirms slow Meta lead response but patient-data flow unclear -> QUALIFIED_DISCOVERY + privacy/technical review.
7. Owner says problem exists but not a priority this year -> nurture/future, not forced meeting.
8. Employee reports problem but correct owner unknown -> POSSIBLE_OPPORTUNITY + stakeholder discovery.
9. No actual workflow pain, only curiosity about AI -> strategy call only if legitimate strategic objective exists; no fabricated operational problem.
10. Prospect provides actual source-to-revenue data -> store source as prospect/system verified, not generic benchmark.

---

# 22. CORE RULE

Qualification should tell YAD what is genuinely known, what still needs discovery, and whether the problem is important enough to earn the next conversation. It must never turn uncertainty into a stronger sales story than the evidence supports.
