# Your AI Department — Strategy Meeting Handoff Specification

**Status:** Architecture authority  
**Purpose:** Ensure a successful cold conversation hands into a strategy/discovery meeting with context, evidence, unanswered questions, and commitments preserved so the prospect does not have to start over.  
**Implementation owner:** Claude Code

---

# 1. PROBLEM

A bad sales handoff sounds like:

> “Thanks for meeting with us. Tell me about your business.”

right after the prospect already spent fifteen minutes explaining it to YAD.

The system should carry forward everything legitimately learned while clearly separating:

- public research
- prospect-verified facts
- estimates
- hypotheses
- unknowns.

---

# 2. HANDOFF OBJECT

`StrategyMeetingBrief`

- account
- location/vertical context
- meeting date/time/timezone
- attendees
- source campaign
- relationship owner
- original research summary
- confirmed public facts
- prospect-verified facts
- primary problem/objective
- workflow map partial
- qualification stage
- economic inputs + sources
- current systems
- decision stakeholders
- prior objection(s)
- promised materials/actions
- missing discovery questions
- technical/privacy/compliance flags
- do_not_repeat_questions[]
- recommended meeting agenda
- Call Pack/version lineage

---

# 3. DO NOT REPEAT KNOWN FACTS AS QUESTIONS

If prospect already said:

> “We use ServiceTitan and get about 500 calls a week.”

Strategy meeting should say:

> “Last time you mentioned ServiceTitan and roughly 500 calls a week. I want to go a level deeper on what happens after the first no-answer.”

not:

> “Do you use a CRM?”

> “How many calls do you get?”

Unless validation is genuinely needed.

---

# 4. CONFIDENCE DISPLAY

Brief should label:

- `PUBLIC_CONFIRMED`
- `PROSPECT_VERIFIED`
- `PROSPECT_ESTIMATE`
- `LIKELY_HYPOTHESIS`
- `UNKNOWN`

Meeting leader must be able to see what still needs validation.

---

# 5. MEETING AGENDA GENERATION

Recommended agenda should follow the Sales Manual's discovery layers, tailored to what remains unknown.

Possible sections:

1. confirm business objective
2. map the priority workflow
3. quantify frequency/volume
4. understand current systems
5. identify desired state
6. constraints/human boundaries
7. technical feasibility questions
8. economic scenario if enough data
9. stakeholder/buying process
10. next step.

Do not run all seven discovery layers mechanically if the earlier conversation already covered some.

---

# 6. MISSING-DATA PRIORITY

Rank missing questions by decision value.

Example missed-call case:

High priority:

- actual inbound call volume
- missed/overflow volume
- new-business share
- current recovery process
- average customer value/close rate if relevant

Lower priority:

- general curiosity about every software tool in the company.

---

# 7. WORKFLOW MAP CONTINUITY

Carry partial workflow forward.

Example:

`Google Ad -> CallRail number -> office -> missed after 6 PM -> answering service -> morning callback -> ServiceTitan`.

Meeting should identify unknown handoffs:

- does answering service create ServiceTitan record?
- response SLA?
- source retained?
- outcome tracked?

---

# 8. ECONOMIC INPUTS

Show every existing number with provenance.

Example:

- 500 calls/week — prospect estimate
- 8% missed — unknown, not established
- $1,200 average customer — prospect estimate

The meeting leader must not accidentally use hypothetical model inputs as client facts.

---

# 9. TECHNICAL FLAGS

Examples:

- ServiceTitan API/integration must be verified
- call provider unknown
- Meta lead source connector unknown
- HIPAA/privacy review required
- law-firm confidentiality/vendor review required
- field-service system access unclear.

These become explicit discovery/technical tasks.

---

# 10. STAKEHOLDER MAP

Carry:

- champion/contact
- process owner
- decision-maker
- technical owner
- security/privacy/legal reviewer
- finance/approval stakeholder

Unknown stakeholders become meeting questions.

---

# 11. PRIOR OBJECTION MEMORY

If prospect said:

> “I don't want this replacing my receptionist.”

Strategy brief should highlight:

**Positioning constraint:** employee-safe / overflow and admin support, not replacement.

Do not make them repeat the concern.

---

# 12. PROMISE TRACKING

Anything YAD promised during outreach becomes a handoff item:

- send example
- verify integration
- bring ROI worksheet
- include partner/owner
- call at specific time.

Meeting owner should see completion status before meeting.

---

# 13. MEETING OPENING

Preferred structure:

1. reference prior conversation accurately;
2. summarize what YAD believes it heard;
3. ask prospect to correct it;
4. explain what the meeting should determine.

Example:

> “When we spoke, you said the main issue wasn't generating leads—it was keeping follow-up consistent after the first attempt. You mentioned Housecall Pro and roughly 200–250 inquiries a month. I want to make sure I have that right, then map the workflow and see whether there's actually enough opportunity to justify changing anything.”

This demonstrates listening without overstating facts.

---

# 14. STRATEGY MEETING OUTCOMES

Possible:

- no project / strong workflow
- measurement/audit first
- technical discovery
- scoped opportunity
- assessment
- proposal preparation
- nurture/future
- disqualified.

Not every strategy call should produce a proposal.

---

# 15. POST-MEETING OUTPUT

Update:

- qualification snapshot
- workflow map
- economic inputs
- stakeholders
- systems
- solution hypothesis
- technical review tasks
- next action
- opportunity stage
- proposal readiness.

Preserve previous snapshots.

---

# 16. PROPOSAL-READINESS CHECK

Before proposal, ideally know:

- confirmed priority problem
- current workflow
- desired state
- measurable baseline or measurement plan
- stakeholders
- required systems/integrations
- major constraints
- human-required boundaries
- scope assumptions
- current commercial offer family

If these are not known, proposal may be premature.

---

# 17. ACCEPTANCE TESTS

1. Cold call already captured CRM + volume -> strategy brief carries both; meeting doesn't restart from zero.
2. Public research conflicts with prospect statement -> brief displays both and current operational clarification.
3. Prospect requested no staff-replacement framing -> prominent meeting constraint.
4. Specific integration unverified -> technical flag, not promise.
5. Economic data unknown -> agenda prioritizes measurement rather than fake ROI.
6. Strong workflow confirmed during meeting -> no-sale allowed.
7. Law firm meeting -> confidentiality/legal judgment boundaries carried forward.
8. Dental meeting -> clinical/privacy boundaries carried forward.
9. Meeting booked from Roofing proposal-follow-up hook -> agenda focuses proposal pipeline first, not generic AI brainstorming.
10. Meeting canceled/rescheduled -> relationship state persists, no cold reset.

---

# 18. CORE RULE

Every YAD interaction should compound context. The next person should know what the prospect already told us, what is still unknown, and why the next conversation exists.
