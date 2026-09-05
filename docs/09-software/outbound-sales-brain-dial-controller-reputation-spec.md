# Your AI Department — Dial Controller & Caller Reputation Specification

**Status:** Architecture authority  
**Purpose:** Control how eligible prospects become actual outbound attempts while protecting DNC/compliance, avoiding duplicate calls, managing concurrency, monitoring number health, and preventing abusive/spam-like calling behavior.  
**Implementation owner:** Claude Code  
**Production status:** Architecture only; real autonomous prospect calling remains gated/disabled.

---

# 1. PRINCIPLE

Twilio is transport.

The Dial Controller decides whether a call should exist at all.

No LLM may directly invoke unrestricted outbound calling.

Canonical runtime path:

`Ready Queue`
-> `Account Lease`
-> `Attempt-Time Compliance Preflight`
-> `Number / Caller-ID Selection`
-> `Concurrency / Reputation Gate`
-> `Twilio Call`
-> `Answer Classification`
-> `Conversation / Voicemail`
-> `Disposition`
-> `Cooldown / Follow-Up`.

---

# 2. DIAL REQUEST

`DialRequest`

- account_id
- contact_id/phone_id
- campaign_id
- call_pack_id
- relationship_state
- requested_callback_id optional
- compliance_policy_version
- source queue decision
- desired local attempt time
- test/production mode
- request_id / idempotency key.

---

# 3. HARD PRE-DIAL GATES

All required before attempt:

- global dial kill switch enabled for mode
- campaign enabled
- Account/contact not suppressed
- line/contact basis eligible under policy
- local calling window eligible
- attempt limits/cooldowns eligible
- no active Account lease/call
- no booked meeting/conflicting relationship state
- phone normalized/valid enough for attempt
- call pack fresh enough
- caller number healthy/eligible
- concurrency capacity available.

Failure returns explicit reason; no call is placed.

---

# 4. IDEMPOTENCY

The same queued job must not create two calls due retry/network ambiguity.

Store:

- dial_request_id
- provider call SID/ID if created
- state
- idempotency key

Worker retries query existing attempt state before placing a new call.

---

# 5. ACCOUNT ATTEMPT LOCK

Before provider call:

acquire durable lock/lease on:

- Account
- phone endpoint
- campaign attempt slot.

Purpose:

- prevent Human Assist + autonomous call collision
- prevent two workers dialing same company
- prevent cross-vertical duplicate attempts.

---

# 6. CALLER NUMBER REGISTRY

`CallerIdentity`

- provider
- phone number
- intended campaign/tenant
- geographic/brand role
- voice-enabled
- registration/reputation status
- CNAM/branded-calling status where applicable
- verification status
- recent attempt/contact metrics
- complaint/spam-label signals where available
- health state
- concurrency limit
- enabled/disabled

No arbitrary caller-ID spoofing.

---

# 7. NUMBER HEALTH STATES

- HEALTHY
- WATCH
- DEGRADED
- PAUSED
- DISABLED
- TEST_ONLY

Potential signals:

- carrier/provider errors
- sudden answer-rate collapse
- complaint/DNC anomaly
- spam-label reports/monitoring
- high short-duration hangups
- provider trust/reputation notices
- invalid-number spike.

Health metrics should be interpreted cautiously; answer rate alone does not prove spam labeling.

---

# 8. NO NUMBER-CHURN EVASION

The system must not rotate through fresh numbers merely to evade spam reputation or opt-out history.

Number selection is for:

- legitimate capacity
- geography/brand structure
- redundancy
- tenant isolation
- approved testing.

Suppression applies to destination Account/contact regardless of which caller number would be used.

---

# 9. CALLER ID / BRANDING

Where provider/carrier ecosystem supports it, architecture may incorporate:

- STIR/SHAKEN signing/attestation
- CNAM
- branded calling / verified identity programs
- provider reputation registration/monitoring.

Claude must verify current Twilio/carrier requirements during implementation.

No claim that a specific registration guarantees no spam labeling.

---

# 10. CONCURRENCY

Set limits by:

- environment
- campaign
- caller number
- provider account
- voice gateway/model capacity
- human transfer capacity.

Ramp slowly during controlled pilot.

Do not design V1 as a high-volume power dialer before quality/compliance/reputation is proven.

---

# 11. PACING

Dial Controller should respect:

- daily/hourly campaign caps
- per-Account attempt policy
- rep/human-transfer availability
- voice infrastructure load
- number health
- provider error rate.

A ready queue of 5,000 prospects does not mean place 5,000 calls immediately.

---

# 12. ATTEMPT RECORD

`CallAttempt`

- attempt_id
- account/contact/phone
- caller_identity
- campaign
- call_pack
- compliance_decision
- requested_at
- provider_created_at
- answered_at
- ended_at
- provider_call_id
- answer_classification
- disposition
- termination_reason
- duration
- voice/model version
- errors
- next_attempt_eligibility.

---

# 13. ANSWERING MACHINE / HUMAN CLASSIFICATION

Possible:

- human
- voicemail/machine
- fax
- unknown
- carrier/failure.

Do not treat uncertain machine detection as permission for a long sales monologue.

Voicemail behavior is campaign-controlled and short.

---

# 14. VOICEMAIL POLICY

Configurable:

- whether to leave voicemail
- which attempt numbers
- voicemail version
- callback number
- whether follow-up email is allowed.

Voicemail should contain:

- identity
- one relevant reason/question
- callback/context.

No long pitch.

---

# 15. REQUESTED CALLBACKS

A callback requested by prospect:

- uses requested local time/timezone
- gets priority over cold queue
- may use same owner/caller context
- carries relationship brief
- does not count as generic cold cadence attempt in analytics without distinction.

---

# 16. NUMBER REPUTATION CIRCUIT BREAKERS

Automatically pause or require review for:

- DNC/complaint anomaly
- duplicate-call bug
- provider rejection spike
- extreme early-hangup anomaly
- caller number health alert
- unauthorized campaign mode
- suppression database failure.

Fail safe, not “keep dialing and investigate later.”

---

# 17. HUMAN TRANSFER CAPACITY

If agent offers live transfer:

before offer/execution determine:

- approved destination
- rep availability
- hours
- transfer capacity
- context handoff mechanism.

If nobody available:

- offer booking/callback
- do not put prospect into indefinite hold.

---

# 18. CALL COST / ECONOMICS

Track:

- telecom cost
- voice/STT/TTS/model cost
- lookup cost
- recording/transcription cost where applicable
- transfer duration/cost.

Later metrics:

- cost per conversation
- cost per decision-maker
- cost per qualified conversation
- cost per meeting.

Do not optimize cost at expense of truth/compliance/call quality.

---

# 19. CAMPAIGN RAMP

Suggested operational stages:

1. internal allowlist
2. team participants
3. tiny reviewed prospect pilot only after approval
4. small daily cap
5. incremental ramp based on QA/compliance/reputation metrics
6. broader campaign only after stable evidence.

Every stage has rollback.

---

# 20. REPUTATION DASHBOARD

Show per caller number/campaign:

- attempts
- human answers
- voicemail
- short-duration rate
- DNC
- complaints/flags where available
- provider errors
- spam-label reports/signals
- number health
- current cap
- last config change.

No hidden number pool behavior.

---

# 21. FAILURE CASES

## Suppression store unavailable

No new autonomous dials.

## Provider call create timeout

Check provider/idempotent state before retrying.

## Voice gateway overloaded

Pause new calls; do not create calls that cannot be served.

## Human transfer unavailable

Fallback to booking.

## Caller number degraded

Pause/route per approved reputation policy; do not evade by uncontrolled rotation.

---

# 22. ACCEPTANCE TESTS

1. Duplicate worker job -> one provider call.
2. Same Account in two campaigns -> one active attempt lease.
3. DNC written milliseconds before dial -> preflight blocks.
4. Suppression DB down -> autonomous dialing fails closed.
5. Caller health PAUSED -> no calls from number.
6. Voice capacity full -> queue waits, no half-connected calls.
7. Transfer target unavailable -> booking fallback.
8. Requested callback -> priority and correct relationship context.
9. Caller number changes -> destination DNC still applies.
10. Provider call creation timeout -> no blind second call.
11. Campaign daily cap reached -> stop new attempts.
12. No number rotation to evade reputation.

---

# 23. CORE RULE

The Dial Controller protects the relationship, compliance system, infrastructure, and caller reputation. A prospect being “ready” is necessary but never sufficient to place a call.
