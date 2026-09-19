# Your AI Department — Twilio Telephony Integration Specification

**Status:** Architecture authority / implementation must revalidate current Twilio docs  
**Purpose:** Define the downstream telephony boundary after Market Miner, compliance and Call Pack have already authorized a controlled call.

Official references to revalidate during implementation:

- https://www.twilio.com/docs/voice/answering-machine-detection
- https://www.twilio.com/docs/voice/conversationrelay
- https://www.twilio.com/docs/voice/conversationrelay/websocket-messages
- https://www.twilio.com/docs/voice/twiml/connect/conversationrelay
- https://www.twilio.com/docs/usage/security

---

# 1. PRINCIPLE

Twilio is a transport/action provider.

It does not decide:

- who to call;
- whether a prospect is a fit;
- whether autonomous AI voice is permitted;
- what the sales strategy is;
- whether DNC can be ignored.

Correct chain:

`Ready Prospect -> Current Compliance Decision -> Contact Attempt Lock -> Twilio Call -> Realtime Voice Gateway -> Tool/CRM Events`

---

# 2. TELEPHONY PROVIDER ABSTRACTION

Core application should define provider-neutral operations:

- `place_call`
- `cancel_call`
- `transfer_call`
- `send_digits`
- `receive_status_event`
- `receive_answer_classification`
- `open_realtime_session`
- `close_realtime_session`

Twilio adapter implements these.

Do not let business logic depend directly on Twilio REST response objects.

---

# 3. CALL INITIATION GATES

Before Twilio API call, code requires:

- campaign active and correct mode;
- global dial state enabled for that mode;
- current ComplianceDecision permits call;
- suppression check current;
- current Call Pack;
- phone endpoint resolved;
- contact attempt lease/lock;
- attempt-frequency policy passes;
- local calling window passes;
- provider credentials/health available;
- test allowlist when in controlled-test mode.

If any gate fails, no Twilio call request is sent.

---

# 4. TWILIO CALL RECORD

Create internal ContactAttempt/Call before or transactionally with provider request.

Store:

- internal call ID
- account/contact/phone/campaign
- compliance decision ID
- Call Pack ID
- requested from number
- provider = Twilio
- request timestamp
- provider Call SID after response
- status
- idempotency/attempt sequence.

Never use Twilio Call SID as the only internal identifier.

---

# 5. OUTBOUND WEBHOOK URL

Twilio outbound call should point to a signed/validated voice webhook that returns TwiML for this internal call/session.

Do not trust a user-supplied `leadId` query parameter alone.

Resolve session through:

- internal opaque call/session token;
- provider Call SID mapping;
- authenticated/signed webhook context.

Prospect/customer identifiers should not be guessable authorization mechanisms.

---

# 6. WEBHOOK SIGNATURE VALIDATION

Every Twilio HTTP webhook must validate `X-Twilio-Signature` using current Twilio security guidance and the exact externally visible URL/parameters.

Consider reverse-proxy/public URL behavior carefully.

On invalid signature:

- reject request;
- do not mutate call/CRM state;
- log security event without leaking secrets.

---

# 7. CONVERSATIONRELAY ROLE

Current preferred architecture candidate:

Twilio `<Connect><ConversationRelay>` handles the telephony speech transport, STT/TTS integration and WebSocket exchange while YAD controls the conversational model/orchestration over a secure WebSocket.

Use it only after Claude benchmarks actual latency/naturalness against alternatives.

The architecture must retain a provider/interface boundary so Twilio Media Streams or another realtime voice path can be evaluated if ConversationRelay does not meet product requirements.

---

# 8. CONVERSATIONRELAY SESSION PARAMETERS

Pass only minimal opaque parameters needed to bind WebSocket session, such as:

- internal call session token;
- campaign/session version.

Do not put:

- full prospect dossier;
- secret keys;
- raw CRM data;
- compliance logic

into public TwiML parameters.

Realtime gateway loads Call Pack server-side after validated session binding.

---

# 9. WEBSOCKET SECURITY

Validate the ConversationRelay WebSocket connection using Twilio's current supported signature/authentication mechanism, including `X-Twilio-Signature` where documented.

Requirements:

- WSS/TLS only;
- reject invalid/unbound connection;
- bind to expected internal Call/session;
- one active realtime session per call unless explicit recovery design;
- rate/message-size limits;
- no secrets in URL query string.

---

# 10. CONVERSATIONRELAY MESSAGE HANDLING

Current Twilio ConversationRelay message model includes inbound events such as setup/prompt/interruption/DTMF/error and outbound actions such as text/audio-related response controls according to current docs.

Implementation must create typed adapter events rather than spread raw message shapes through sales logic.

Example normalized events:

- `realtime_connected`
- `prospect_speech_partial`
- `prospect_speech_final`
- `prospect_interrupted_agent`
- `dtmf`
- `transport_error`

Outbound:

- `speak_text_chunk`
- `play_audio`
- `send_digits`
- `change_language`
- `end_realtime_session`.

Revalidate exact Twilio schemas at implementation time.

---

# 11. STREAMING

Realtime path should stream:

`prospect speech -> transcript event -> LLM generation -> token/text chunk -> TTS playback`

Do not wait for complete long model message.

Measure:

- speech final/endpoint decision
- model first token
- first outbound text chunk
- first audible TTS.

---

# 12. INTERRUPTIONS

On Twilio/voice-provider interruption event:

- increment generation cancellation ID;
- cancel/discard stale LLM output;
- stop/cancel queued speech according to provider capabilities;
- transition state with new prospect utterance.

Do not let delayed model tokens from old turn continue after barge-in.

---

# 13. TTS VOICE SELECTION

ConversationRelay currently supports multiple TTS-provider options according to Twilio docs, including providers such as Google/Amazon/ElevenLabs depending on current product support.

Do not choose voice solely from marketing demos.

Benchmark:

- naturalness
- first-audio latency
- interruption response
- number/name pronunciation
- cost
- stability.

Voice/provider ID remains configuration/versioned per campaign/test.

---

# 14. STT / LANGUAGE

Benchmark current ConversationRelay speech recognition options/settings for:

- business names
- city/service names
- CRM names
- phone/email dictation
- accents/noisy calls.

Support language switching only if YAD explicitly designs a multilingual campaign/agent; do not improvise a language change without appropriate prompt/QA coverage.

---

# 15. ANSWERING MACHINE DETECTION

Twilio AMD can classify human/machine/fax/unknown with synchronous or asynchronous behavior and options such as message-end detection according to current docs.

Architecture goal:

- avoid long human-answer dead air;
- preserve accurate voicemail handling;
- record classification confidence/result.

Claude must benchmark:

- synchronous AMD
- asynchronous AMD
- no/limited AMD + conversational detection if appropriate

on controlled calls.

Do not choose slower “more accurate” configuration if it creates unacceptable human greeting delay without measurable benefit.

---

# 16. VOICEMAIL

If machine result is sufficiently confident and campaign permits voicemail:

- use short voicemail message;
- record voicemail outcome;
- no long pitch;
- no conversation model wasting tokens after machine path decided.

If ambiguous answer:

Use conservative human-safe logic.

---

# 17. STATUS CALLBACKS

Configure provider status events needed for durable state:

- initiated/queued
- ringing
- answered/in-progress
- completed
- busy
- no-answer
- failed/canceled

Normalize into internal Call events.

Webhook validation required.

Out-of-order callbacks must be handled idempotently.

---

# 18. AMD CALLBACKS

If Async AMD used:

- signed callback
- map Call SID/session
- record answer classification
- state machine decides whether/how to transition.

Do not allow late machine classification to corrupt a call already clearly engaged as human without explicit reconciliation logic.

---

# 19. TRANSFER

Warm/controlled transfer design:

- approved destination list only;
- destination availability policy;
- explain transfer to prospect;
- initiate provider action;
- wait for meaningful result where possible;
- fallback to callback/booking if failure.

Do not let LLM construct arbitrary phone destinations.

---

# 20. FROM NUMBER / CALLER ID

Use legitimate assigned Twilio/YAD numbers.

Do not spoof unrelated numbers or churn caller IDs to evade reputation/DNC behavior.

Future caller-reputation work may include:

- STIR/SHAKEN attestation
- branded calling
- Twilio Voice Integrity/reputation tooling

according to current provider programs.

This is deliverability/reputation work, not a workaround for consent/policy.

---

# 21. CALLER REPUTATION METRICS

Track by from-number/campaign:

- answer rate
- carrier failures
- spam-label reports if data available
- short-duration hangups
- DNC rate
- complaint indicators.

If reputation degrades unexpectedly:

- pause campaign/number for review;
- do not auto-rotate numbers to evade labeling.

---

# 22. RECORDING / TRANSCRIPTION

Twilio/provider recording features are enabled only if ComplianceDecision/media policy permits.

Separate:

- provider call recording
- ConversationRelay/STT transcript
- YAD persistent transcript.

A transport may produce transient speech text even when YAD chooses not to retain it; implementation must understand provider retention behavior before claiming no transcript exists.

---

# 23. CALL COST ACCOUNTING

Record:

- Twilio call duration/cost where available
- ConversationRelay/voice feature costs
- STT/TTS costs
- LLM inference cost
- transfer/SMS costs

Tie to Call/campaign for cost/meeting calculations.

---

# 24. ERROR BEHAVIOR

## Twilio REST call create fails

- mark attempt failed
- release lease appropriately
- do not count as answered contact attempt
- retry only under safe/idempotent policy.

## TwiML webhook fails

- alert; call may fail/terminate
- no duplicate automatic redial without attempt policy.

## WebSocket fails before greeting

- terminate safely or approved fallback
- record technical failure.

## WebSocket/model fails mid-call

- one bounded recovery if safe
- otherwise apologize/end or transfer according to configuration.

---

# 25. CONTROLLED TEST ALLOWLIST

In `controlled_test` mode:

- destination must exist in durable explicit allowlist;
- from-number configuration limited to test-approved numbers;
- no arbitrary API override;
- dashboard visibly shows TEST.

Attempts outside allowlist fail before Twilio REST request.

---

# 26. TWILIO-SPECIFIC TEST FIXTURES

## Invalid HTTP signature

Expected: 403/reject; no call-state mutation.

## Invalid WebSocket signature/session token

Expected: reject socket.

## Duplicate status callback

Expected: idempotent event processing.

## Callback arrives out of order

Expected: final state reconciled by provider event timestamps/status rules.

## Non-allowlisted test number

Expected: no Twilio REST call.

## DNC already present

Expected: no Twilio REST call.

## Global kill switch triggered while call queued

Expected: job rechecks immediately before call and does not initiate.

---

# 27. BENCHMARK ACCEPTANCE

Before real prospect pilot, Claude reports controlled-call sample showing:

- answer/greeting latency p50/p95
- turn latency p50/p95
- interruption stop p50/p95
- AMD false-human/false-machine reviewed sample
- voicemail behavior
- connection failure rate
- tool action reliability
- cost/minute/call
- voice naturalness review.

No amount of Twilio integration code substitutes for measured caller experience.
