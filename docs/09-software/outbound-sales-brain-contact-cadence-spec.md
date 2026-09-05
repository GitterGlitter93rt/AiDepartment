# Your AI Department — Outbound Contact Cadence Specification

**Status:** Architecture authority; exact legal/company limits supplied by reviewed policy  
**Purpose:** Define how contact attempts, requested callbacks, voicemail, email/SMS and outcomes drive the next eligible action without hard-coding aggressive cadence into the AI.

---

# 1. PRINCIPLE

The system manages a relationship/contact history, not an infinite retry loop.

Every next attempt must have:

- a reason;
- a current policy authorization;
- an eligible time;
- attempt-history context;
- no active suppression.

Exact max attempts/time gaps are configuration from reviewed company/compliance policy.

---

# 2. CADENCE STATE

Per Account/Contact/Phone/Campaign maintain:

- attempts
- live conversations
- voicemail count
- gatekeeper outcomes
- wrong contact/number
- requested callback
- follow-up due
- email/SMS requests
- DNC
- last attempt/time
- next eligible time
- cadence reason/status.

---

# 3. REQUESTED CALLBACK OVERRIDES GENERIC CADENCE

If prospect says:

> Call Friday at 2.

Create requested callback with:

- timestamp
- timezone
- person/role
- context.

Do not continue generic retry sequence before that time unless prospect initiates contact.

Requested callback becomes top priority at due time.

---

# 4. LIVE CONVERSATION OUTCOME

After meaningful conversation:

- follow agreed next step;
- do not treat as no-answer and continue generic cadence.

Examples:

- send email -> wait/follow agreed path
- strategy call booked -> remove from cold cadence
- no pain/disqualified -> exit campaign
- follow up next month -> scheduled follow-up
- DNC -> suppress.

---

# 5. NO ANSWER

Policy engine returns:

- whether retry allowed
- next eligible time/window
- remaining attempts
- voicemail eligibility.

Cadence planner chooses next task only within those constraints.

Do not let LLM decide “call again in 20 minutes.”

---

# 6. VOICEMAIL

Campaign defines:

- leave voicemail on which attempt(s)
- maximum voicemail count
- message template strategy
- callback number
- whether machine detection confidence required.

Avoid leaving same voicemail every attempt.

---

# 7. GATEKEEPER

Gatekeeper interaction is not identical to no answer.

Possible outcomes:

- decision-maker identified
- direct line supplied
- best time supplied
- email path supplied
- refused access
- owner unavailable.

Next action follows learned routing.

Do not repeatedly call front desk on generic schedule while ignoring supplied best time.

---

# 8. WRONG CONTACT

Same company but wrong person:

- update contact/routing
- stop attempts to wrong individual if appropriate
- preserve account campaign.

Wrong number/company:

- remove endpoint from campaign/contact path
- research correction
- do not retry that number.

---

# 9. “NOT INTERESTED”

Not automatically DNC unless policy chooses that treatment or prospect explicitly requests no contact.

Recommended sales behavior:

- close/disqualify current effort rather than repeated objection sequence.

Future nurture, if any, follows reviewed company policy and CRM strategy, not a hidden cold-call retry.

---

# 10. EMAIL REQUEST

If prospect asks email:

- send approved targeted email if channel policy allows
- create follow-up state based on prospect request/approved cadence
- do not auto-call five minutes later unless explicitly agreed.

---

# 11. SMS REQUEST

If prospect explicitly requests text/link and policy permits:

- send requested item
- record channel event
- next action based on agreement.

Phone-call contactability does not imply SMS marketing permission.

---

# 12. STRATEGY CALL BOOKED

Remove from cold prospect cadence.

Move to:

- meeting confirmation/reminder workflow
- CRM opportunity stage
- no duplicate cold attempts by other rep/AI.

---

# 13. ACTIVE OPPORTUNITY

If Human Assist/AI creates qualified opportunity:

cold campaign membership transitions out of generic cold cadence.

Opportunity owner controls next steps.

Do not let replenishment controller see Account as “uncontacted supply.”

---

# 14. MULTIPLE CONTACTS SAME ACCOUNT

Campaign can choose account-contact policy:

- one primary stakeholder at a time
- fallback stakeholder after failed routing
- location-level stakeholders.

Do not blast every executive at company simultaneously.

Account-level contact history informs all candidate contacts.

---

# 15. MULTIPLE CAMPAIGNS SAME ACCOUNT

Before attempt, check:

- active opportunity
- recent other campaign attempt
- suppression
- ownership.

Avoid two YAD campaigns contacting same company same day with different pitches unless intentionally coordinated.

---

# 16. TIMEZONE

All next-attempt timestamps stored as absolute timestamp + prospect timezone/context.

Eligibility evaluated in destination/local timezone under policy.

Server timezone irrelevant.

---

# 17. ATTEMPT BUDGET

Campaign/company policy supplies:

- maximum attempts
- cooldown
- voicemail max
- live-contact reset/transition rules.

When exhausted:

- campaign membership ends/pauses
- do not silently reset because research refresh occurred.

---

# 18. RESEARCH REFRESH DOES NOT RESET CADENCE

New ad observation next week does not make prior contact attempts disappear.

Account/contact attempt history remains.

A completely new campaign may have separate policy, but cross-campaign frequency gate still applies as configured.

---

# 19. CADENCE REASON

Every scheduled contact stores reason:

- initial high-priority prospect
- no-answer retry
- requested callback
- gatekeeper best time
- email follow-up
- seasonal follow-up
- technical follow-up.

Rep/AI can understand why task exists.

---

# 20. CANCEL CONDITIONS

Cancel pending contact tasks immediately when:

- DNC
- wrong number
- closed business
- active opportunity owns contact
- meeting booked
- account exclusion/customer conflict
- campaign paused/canceled
- policy changes make attempt ineligible.

---

# 21. CADENCE ANALYTICS

Track:

- connect by attempt number
- decision-maker by attempt number
- qualified conversations by attempt number
- DNC/complaints by attempt number
- voicemail callback rate.

Use to reduce unnecessary attempts, not maximize dial count.

---

# 22. ADAPTIVE CADENCE — FUTURE

After enough data, system may recommend best attempt timing by vertical/market.

Constraints:

- policy remains hard boundary
- no self-escalation of max attempts
- human approval for material cadence changes in V1.

---

# 23. TEST FIXTURE — CALLBACK

Attempt 1 Monday.

Prospect says call Friday 2 PM.

Expected:

- no Tuesday/Wednesday generic calls
- Friday requested callback task high priority.

---

# 24. TEST FIXTURE — RESEARCH REFRESH

Three prior attempts; new Google ad observed.

Expected:

- attempt count remains three
- no automatic reset to initial cadence.

---

# 25. TEST FIXTURE — BOOKED

Meeting confirmed.

Expected:

- all cold retry jobs canceled/superseded
- meeting workflow owns next contact.

---

# 26. TEST FIXTURE — CROSS-CAMPAIGN

Same Account in HVAC ads campaign and CRM campaign.

One live conversation today.

Expected:

- second campaign respects cross-campaign contact policy/cooldown.

---

# 27. ACCEPTANCE

- exact attempt limits configurable/policy-versioned
- requested callbacks honored
- DNC cancels everything
- research refresh does not reset history
- active opportunity exits cold cadence
- multiple campaign conflicts handled
- no LLM-controlled retry timing outside policy.
