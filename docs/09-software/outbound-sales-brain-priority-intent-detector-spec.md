# Your AI Department — Realtime Priority Intent Detector Specification

**Status:** Architecture authority  
**Purpose:** Detect DNC, wrong-number, stop-conversation, transfer/human requests and other high-priority intents independently enough that the normal sales model cannot accidentally continue its pitch.

---

# 1. PRINCIPLE

Some intents are too important to leave only to open-ended sales generation.

Priority detector watches prospect speech and can emit deterministic orchestration events.

Highest priorities:

1. explicit do-not-contact / stop calling
2. wrong number / wrong company
3. prospect ends conversation
4. request for human/known rep
5. correction of identity/contact
6. requested callback timing.

---

# 2. INPUT

- final STT utterance
- optionally high-confidence partial STT for immediate speech-stop behavior
- recent one or two turns for context
- current Account/Contact/call state.

Do not feed entire Sales Manual.

---

# 3. OUTPUT

```text
PriorityIntent
- intent_type
- confidence
- scope/parameters
- source_turn_id
- requires_immediate_audio_stop
- deterministic_action
- needs_clarification
```

---

# 4. EXPLICIT DNC

Examples:

- “Don't call me again.”
- “Take me off your list.”
- “Stop calling this number.”
- “Remove me from your call list.”
- “Do not contact us anymore.”

Expected:

- immediate audio cancellation
- `dnc` state interrupt
- durable suppression tool
- brief acknowledgement
- end.

No sales objection handling.

---

# 5. TEMPORARY TIMING IS NOT AUTOMATIC DNC

Examples:

- “Don't call me right now, call Friday.”
- “I'm busy — call next week.”
- “Not today.”

Expected:

- requested_callback/timing intent
- confirm time if needed
- follow-up task
- no global suppression unless language separately indicates permanent stop.

Context matters.

---

# 6. AMBIGUOUS “NOT INTERESTED”

Examples:

- “Not interested.”
- “We're good.”

This is not automatically DNC unless approved company policy intentionally treats it as such.

Expected:

- sales conversation closes professionally/disqualified
- no repeated objection battle
- follow-up cadence depends on company policy/outcome, not DNC detector.

If prospect adds:

> “Don't call again”

then DNC.

---

# 7. WRONG NUMBER

Examples:

- “This isn't ABC Plumbing.”
- “You have the wrong number.”
- “They don't use this number anymore.”

Expected:

- immediate end of sales pitch
- wrong-number outcome
- phone/account correction task
- prevent repeat attempt to that identity under policy.

Do not ask the unrelated person whether they need AI services.

---

# 8. PERSON LEFT COMPANY

Example:

> “John hasn't worked here for a year.”

Not necessarily wrong company/number.

Expected:

- contact correction
- old Contact stale/invalid
- ask correct role only if conversation appropriate
- Account can remain valid.

---

# 9. PROSPECT ENDS CALL

Examples:

- “I have to go.”
- “That's all, bye.”
- “I'm hanging up.”

Expected:

- brief close
- no last-second pitch.

If coupled with DNC, DNC wins.

---

# 10. REQUEST FOR HUMAN

Examples:

- “Can I talk to Brent?”
- “I want a real person.”
- “Get me your manager.”

Expected:

- transfer/follow-up path if available
- no debate about AI/human preference.

If no human available:

- capture callback/booking truthfully.

---

# 11. AI IDENTITY QUESTION

Examples:

- “Are you a robot?”
- “Is this AI?”

High-priority conversational intent, but not terminal.

Expected:

- truthful response under approved AI identity policy
- continue only if prospect willing.

Could be detected by main model too; priority detector ensures it is not evaded.

---

# 12. REQUESTED CALLBACK

Extract:

- day/date
- time
- timezone context
- “morning/afternoon”
- person requested.

Use date/time parser + confirmation, not LLM guess alone.

If ambiguous:

ask one clarification.

---

# 13. CHANNEL REQUEST

Examples:

- “Email me.”
- “Text me the link.”

Priority intent can route to action state but channel policy still validates.

Do not treat request as permission for unrelated marketing cadence.

---

# 14. DETECTION ARCHITECTURE

Use layered approach:

## Layer 1 — high precision deterministic phrases

Fast phrase/pattern matcher for obvious DNC/wrong-number.

## Layer 2 — lightweight semantic classifier

Handles paraphrase/context.

## Layer 3 — main conversation model

Can identify/confirm other intents.

Orchestration applies strongest current result.

Do not rely on one brittle regex.

---

# 15. PARTIAL STT

For obvious partial phrase such as:

> “Don't call me...”

system can stop current agent audio quickly before final transcript.

Final classification decides DNC action after sufficient intent certainty.

Avoid irreversible suppression from a highly uncertain partial such as:

> “Don't call me late...”

which could mean timing preference.

---

# 16. CONFIDENCE POLICY

## Explicit phrase high confidence

Act immediately.

## Semantic high confidence

Act.

## Ambiguous

Ask concise clarification if needed:

> Just to make sure — do you mean don't call again at all, or just not right now?

Do not use clarification as friction against a clear opt-out.

---

# 17. DNC SCOPE

Detector can extract:

- “this number” -> phone scope minimum
- “don't contact our company” -> account/company scope
- “don't email me” -> channel/contact scope

Compliance policy defines final scope mapping.

If unclear, apply safe minimum required policy and no continued sales during current call.

---

# 18. NEGATION / QUOTED LANGUAGE

Avoid false positives:

Prospect:

> “My customers tell telemarketers ‘don't call me,’ but I’m actually curious what you do.”

Detector should use conversation/quotation context rather than automatically suppress.

Test these cases.

---

# 19. ASR ERROR

STT may turn:

- “don't call me” into something similar/wrong.

When confidence low and audio/policy permits:

- ask clarification rather than continue pitch.

Critical repeated phrases should be part of STT benchmark.

---

# 20. LANGUAGE

If multilingual operation is later approved:

priority-intent phrase/classifier coverage must exist for each supported language before production.

Do not run multilingual sales if DNC detector only understands English.

---

# 21. EVENT PRIORITY

Suggested orchestration priority:

`DNC`
>
`wrong number/company`
>
`policy/security termination`
>
`human transfer request`
>
`prospect ends call`
>
`requested callback`
>
`channel/action request`
>
`normal sales intent`.

DNC can override a simultaneous booking state.

---

# 22. AUDIO CANCELLATION

When immediate-stop intent detected:

- increment generation/cancellation token
- clear queued TTS
- stop playback as provider allows
- do not resume stale answer after tool action.

---

# 23. QA INTEGRATION

CallEvent records:

- detector intent/confidence
- actual action
- transcript turn
- final disposition.

QA checks:

- clear DNC detected?
- suppression happened?
- did sales continue?

False-positive DNC also reviewed because it affects sales/customer experience.

---

# 24. TEST FIXTURES — DNC

- Don't call me again -> DNC
- Take me off the list -> DNC
- Remove this number -> DNC
- Stop calling our company -> account/company DNC under policy
- Don't call me today, call Friday -> callback, not DNC
- Don't call after 5 -> timing preference/policy input, not global DNC
- I'm not interested -> close/disqualify, not automatically DNC
- I'm not interested, stop calling -> DNC.

---

# 25. TEST FIXTURES — WRONG CONTACT

- wrong number -> terminal
- John left company -> contact correction, account stays
- this is accounting, you need operations -> routing/gatekeeper
- this company closed -> research correction/account review.

---

# 26. ACCEPTANCE

Before controlled voice certification:

- clear DNC test recall = 100% in gold suite
- no sales speech after clear DNC
- temporary callback phrases not incorrectly suppressed in gold suite
- wrong-number tests terminal
- human request routed
- partial STT barge-in behavior tested
- detector action/event fully auditable.
