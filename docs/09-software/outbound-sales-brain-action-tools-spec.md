# Your AI Department — Outbound Sales Action Tools Specification

**Status:** Architecture authority  
**Purpose:** Define deterministic tools the sales model may request, their validation rules, idempotency, success semantics and fallbacks.

---

# 1. PRINCIPLE

The LLM never directly performs an external side effect.

It requests a typed tool action.

Code validates:

- tool is available;
- policy permits it;
- inputs are complete;
- destination is approved;
- idempotency;
- current session/call authority.

Then code executes and returns a typed result.

---

# 2. COMMON TOOL RESULT

All tools return:

- `request_id`
- `status`: `confirmed | failed | pending | denied | needs_input`
- `reason_code` optional
- `provider_reference` optional
- `message_safe_for_agent` optional
- `retryable`
- `completed_at` optional.

The agent may only state success when status is `confirmed`.

---

# 3. `add_do_not_contact`

Highest-priority sales tool.

## Inputs

- call/session ID
- account ID
- contact ID optional
- phone ID/number
- requested scope if clear
- raw intent phrase/turn ID
- reason code.

## Validation

- clear DNC/stop-contact intent;
- resolve minimum safe suppression scope;
- no manager approval required to honor request.

## Success

Suppression durably committed and visible to immediate future eligibility checks.

## Failure

If durable suppression cannot be written:

- autonomous calling fails closed globally/for affected path according to operations policy;
- current call still ends;
- critical alert/audit.

Do not keep selling because database failed.

---

# 4. `book_strategy_call`

## Inputs

- account/contact
- attendee name/email/phone as required
- event type
- candidate slot
- timezone
- call ID
- idempotency key.

## Preconditions

- prospect requested/agreed;
- approved booking provider/event type;
- required contact data present;
- campaign allows booking.

## Process

Prefer two-step where needed:

1. check availability
2. commit selected slot.

## Confirmed result

- booking ID
- start/end
- timezone
- meeting details safe to disclose.

## Failure fallback

- capture preferred time
- `create_human_followup`
- tell prospect scheduling was not confirmed.

---

# 5. `check_availability`

Separate read tool where provider supports.

Inputs:

- date/date range
- timezone
- event type
- constraints.

Output:

- candidate slots.

No CRM “scheduled” stage from availability check alone.

---

# 6. `create_human_followup`

## Inputs

- account/contact
- owner/team
- due date/time
- timezone
- reason
- channel
- source call
- notes/context.

## Uses

- requested callback
- failed booking
- technical question
- decision-maker unavailable
- seasonal timing
- data review.

## Success

Durable internal task exists, then external CRM sync may occur via outbox.

---

# 7. `send_email`

## Inputs

- approved sender identity
- recipient
- subject
- body/template data
- topic/purpose
- call/contact IDs
- idempotency key.

## Validation

- recipient provenance/contact policy
- communication permission/rules
- content claim validator
- no forbidden internal material
- no unsupported pricing/integration/results.

## Confirmed

Provider message ID/accepted status sufficient under email adapter semantics.

## Ambiguous provider result

Do not blindly retry without idempotency/status resolution.

---

# 8. `send_sms`

Similar to email but channel-specific policy stricter/separate.

Phone-call eligibility does not imply SMS eligibility.

Inputs:

- destination phone
- approved sender
- content
- purpose
- call/contact
- idempotency.

Uses:

- requested link
- approved meeting confirmation
- requested follow-up.

---

# 9. `warm_transfer`

## Inputs

- current call ID
- approved destination ID, not arbitrary number
- transfer reason
- context summary optional for human recipient.

## Validation

- destination configured/available
- campaign allows transfer
- current call transport supports
- no arbitrary LLM-generated phone.

## Result

- initiated
- answered/completed where detectable
- failed/unavailable.

Fallback:

booking/callback.

---

# 10. `crm_update`

Live model should generally not issue arbitrary low-level CRM mutations.

Use typed intents:

- append note
- update contact clue
- create opportunity candidate
- create task
- update disposition.

Post-call processor performs canonical stage/outcome update after validation.

All writes:

- internal DB first where appropriate
- external CRM via provider adapter/outbox.

---

# 11. `record_prospect_statement`

Can be session-local or durable depending architecture.

Inputs:

- statement text/normalized field
- value/unit
- source class
- turn ID
- currentness.

Use for:

- system named
- call volume
- ad spend
- missed rate
- requested callback
- decision-maker correction.

Do not overwrite history when value changes later.

---

# 12. `create_research_correction`

Inputs:

- account
- evidence/claim being corrected
- prospect statement/source
- correction category
- urgency.

Use:

- CRM changed
- owner changed
- location/offer outdated
- ad status correction.

Does not delete historical evidence.

---

# 13. `retrieve_manual_guidance`

Read-only.

Inputs:

- topic/objection
- vertical
- current conversation state
- max chunks.

Output:

- concise guidance
- source chunk IDs
- truth/commercial warnings.

Hard latency timeout.

No internal manual text is sent to prospect directly unless appropriately paraphrased.

---

# 14. `calculate_business_case`

Deterministic calculator from dedicated spec.

Inputs:

- calculation type
- sourced values
- illustrative assumptions.

Output:

- result class
- formula/results
- missing inputs
- assumptions
- safe wording/prohibited overstatement.

Never execute arithmetic from invented model values.

---

# 15. `end_call`

Inputs:

- terminal reason
- optional concise closing text already generated/approved.

Use for:

- DNC
- wrong number
- no sale
- completed next step
- technical/policy termination.

Transport layer closes session/call appropriately.

---

# 16. `request_technical_review`

Inputs:

- account/contact
- question
- named system/integration
- source call
- urgency/next-step date.

Use when prospect asks:

- unverified integration
- security/technical architecture question
- unsupported delivery capability.

Success creates human technical follow-up; it does not imply solution is feasible.

---

# 17. `request_data_review`

Inputs:

- problem category
- data requested
- period
- owner
- secure follow-up process.

Example:

- 60 days inbound call log
- unsold estimate report
- ad spend + booked job report.

Never ask prospect to send sensitive data to an insecure arbitrary channel.

---

# 18. TOOL PERMISSION MATRIX

Tool availability varies by mode.

## Research only

- no outbound communication tools
- research/score only.

## Human Assist

AI may draft/suggest; human initiates side effects according to UI/permissions.

## Controlled test

Tools limited to test accounts/destinations.

## Autonomous outbound

Only after full policy/gates; allowed tools configured per campaign.

---

# 19. ACTION CONFIRMATION POLICY

Some actions require prospect confirmation before commit:

- selected meeting slot
- destination email if ambiguous
- requested SMS phone if different
- transfer when appropriate.

DNC does NOT require a “are you sure?” sales friction step when intent is clear.

---

# 20. IDEMPOTENCY

Every side-effect tool gets stable idempotency key.

Examples:

- booking: call + event type + slot + contact
- email: call + recipient + purpose/version
- SMS: call + recipient + message-purpose
- DNC: scope + identity + source request
- follow-up: call + follow-up type + due timestamp.

Retries should not duplicate action.

---

# 21. PENDING STATE

If provider returns pending/async:

Agent can say:

> I’m submitting that now.

but cannot say:

> It’s confirmed.

If call must end before final result, create human follow-up/outbox and communicate accurately.

---

# 22. TOOL TIMEOUTS

Each tool has max live-call wait budget.

Slow noncritical action:

- continue/close with truthful pending follow-up rather than hold prospect in silence indefinitely.

DNC remains synchronous critical.

---

# 23. TOOL AUDIT

Store:

- requested by model/human
- parameters (redacted as needed)
- validation result
- provider call
- result
- retry
- spoken confirmation turn.

This supports QA false-success checking.

---

# 24. SECURITY

- model never receives provider secrets
- arbitrary URLs/numbers not accepted for sensitive actions
- allowlists/templates/server-side IDs
- validate account/contact ownership/context
- output encoding/sanitization
- rate limits.

---

# 25. FIXTURE — DNC DUPLICATE REQUEST

Prospect says stop twice due overlap.

Expected:

- one effective suppression
- second idempotent success
- no duplicate errors
- call ends.

---

# 26. FIXTURE — BOOKING DOUBLE TOKEN

LLM/tool retry sends same commit twice.

Expected:

- one meeting
- same confirmed booking result returned.

---

# 27. FIXTURE — EMAIL CLAIM VALIDATION

Draft says:

> We guarantee 30% more revenue.

Expected:

- send denied/needs correction
- no email sent
- no model override.

---

# 28. FIXTURE — ARBITRARY TRANSFER NUMBER

Model outputs a number not configured.

Expected:

- denied
- offer approved fallback.

---

# 29. FIXTURE — CALCULATOR MISSING INPUT

Model requests missed-call revenue with legitimate-opportunity percentage missing.

Expected:

- insufficient_data
- missing input returned
- no lost-revenue number.

---

# 30. ACCEPTANCE

Before controlled voice pilot:

- every side-effect tool has schema validation
- idempotency tests
- success/failure/pending tests
- false-success QA fixture
- audit logging
- mode/permission checks
- no raw secret access by LLM.
