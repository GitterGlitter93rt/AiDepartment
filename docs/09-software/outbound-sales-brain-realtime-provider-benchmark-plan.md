# Your AI Department — Realtime Voice Provider Benchmark Plan

**Status:** Architecture / implementation test plan  
**Purpose:** Select the realtime speech/model stack using measured end-to-end caller experience rather than choosing a vendor/model by reputation.

---

# 1. PRINCIPLE

The winning stack is the one that best satisfies YAD's actual sales-call requirements:

- fast first audio;
- accurate business speech recognition;
- natural voice;
- reliable barge-in;
- tool use;
- low repetition;
- stable cost;
- provider reliability.

Do not optimize one isolated benchmark such as model tokens/second.

---

# 2. CANDIDATE ARCHITECTURES

Claude must inspect current available APIs/products at implementation time.

Benchmark at least:

## A — Twilio ConversationRelay + realtime LLM

Twilio-managed STT/TTS transport, YAD model/orchestration over WebSocket.

## B — Twilio media transport + explicit STT/TTS stack

If ConversationRelay cannot meet latency/control/naturalness needs, evaluate Media Streams or another current Twilio-supported realtime transport architecture.

## C — Approved alternate voice stack

Only if it can integrate with Twilio/telephony and satisfies security/compliance requirements.

Do not add providers solely to increase benchmark complexity.

---

# 3. MODEL PROVIDERS

Benchmark the smallest set of credible models available at implementation time.

Candidates may include:

- Claude low-latency model suitable for live dialogue;
- OpenAI realtime/low-latency model if approved/current;
- another approved provider with materially useful latency/tool behavior.

The pre-call research brain can remain Claude even if the live model is different.

---

# 4. STT

Evaluate:

- Twilio ConversationRelay recognition configuration;
- provider-native STT if using alternate architecture;
- current best low-latency speech recognition option compatible with transport.

Test vocabulary:

- ServiceTitan
- Housecall Pro
- Jobber
- CallRail
- HVAC
- heat pump
- Jacksonville
- St. Augustine
- Your AI Department
- common owner names
- email addresses
- phone digits.

---

# 5. TTS

Candidate voices/providers should be tested for:

- natural conversational prosody;
- low first-byte/audio latency;
- interruption responsiveness;
- names/phone numbers;
- non-announcer tone;
- stability across long session.

Do not select a dramatic “demo” voice that sounds unnatural on business calls.

---

# 6. TEST ENVIRONMENT

Use controlled allowlisted test participants/numbers only.

Run from the intended staging deployment path so measurements include:

- Twilio network;
- public TLS/WebSocket gateway;
- STT;
- model;
- TTS;
- YAD orchestration.

Local-only synthetic latency is not sufficient for final selection.

---

# 7. TIMESTAMP INSTRUMENTATION

Record per turn:

- call answered
- first inbound media/speech
- speech partial timestamps
- speech-final/endpoint decision
- model request start
- model first token
- first text chunk sent to TTS
- first audible agent audio if measurable
- interruption detected
- agent audio stopped
- tool request/result.

Use monotonic clocks inside service for durations.

---

# 8. PRIMARY LATENCY METRICS

## Greeting

`first audible agent speech - usable human answer`

Target architecture:

- p50 <800 ms
- p95 <1,250 ms.

## Normal turn

`first audible response - endpoint decision`

Target:

- p50 <1,000 ms
- p95 <1,500 ms.

## Barge-in stop

`agent audio stopped - interruption detected`

Target:

- p50 <200 ms
- p95 <300 ms.

If exact audio playback timestamp cannot be measured programmatically, supplement with controlled call recording/manual timing.

---

# 9. QUALITY METRICS

Human reviewers grade 1–5:

- naturalness
- pace
- warmth/professionalism
- interruption behavior
- turn timing
- pronunciation
- clarity
- robotic/repetitive cadence
- long-sentence tendency.

Also objective:

- STT correction/error rate on gold phrases
- repeated-response count
- talk-over count
- silence >2s
- silence >3s.

---

# 10. SALES-BEHAVIOR METRICS

Run same text roleplay scenarios through candidate stacks.

The voice transport/model must still pass:

- DNC
- busy owner
- ServiceTitan correction
- no-sale
- integration uncertainty
- booking failure
- financial-data caution.

Fast wrong answers do not win.

---

# 11. TOOL TEST

Measure:

- availability lookup
- booking commit
- DNC
- follow-up
- manual RAG retrieval.

Model should begin truthful acknowledgement where appropriate without claiming success before tool returns.

Long tool latency should not freeze ordinary conversation.

---

# 12. RAG TEST

Inject an unexpected objection requiring live Sales Manual retrieval.

Measure:

- retrieval time
- model response latency
- accuracy
- whether p95 remains acceptable.

If live RAG is too slow:

- improve local index/cache
- prefetch likely objections
- use safe fallback.

Do not accept 4-second silence because “RAG is powerful.”

---

# 13. LONG-CALL TEST

Run 10–15 minute controlled conversation.

Watch:

- memory drift
- repeated identity/product explanation
- latency growth
- connection stability
- websocket reconnect behavior
- TTS degradation
- state-machine correctness.

---

# 14. NOISE TEST

Controlled scenarios:

- office background
- driving-road noise simulation where safe/test environment
- speakerphone
- moderate TV/background speech
- quiet line.

Measure STT/turn detection.

---

# 15. INTERRUPTION TEST

At predictable points, tester interrupts:

- early opener
- middle of company explanation
- while AI confirms number
- while tool status phrase speaking.

Pass:

- stale speech stops
- new intent handled
- old answer not resumed blindly.

---

# 16. PHONE/EMAIL TEST

Tester dictates:

- 904-555-1212
- name/email with dots/hyphens
- corrected digit mid-confirmation.

Evaluate:

- transcript correctness
- spoken confirmation grouping
- ability to accept correction.

---

# 17. ANSWERING MACHINE TEST

Controlled cases:

- human immediate hello
- voicemail greeting
- long corporate greeting
- ambiguous “hello, you've reached...”
- silence.

Benchmark AMD strategy:

- classification accuracy
- human greeting delay
- voicemail transition.

Human experience takes precedence over theoretical classifier accuracy.

---

# 18. COST

Per candidate measure:

- Twilio/transport cost/minute
- STT/minute
- TTS/minute/characters
- model/input/output cost
- RAG cost
- total controlled call cost.

Report variable cost/minute and cost/typical call duration.

Do not choose cheapest stack if call quality materially worse.

---

# 19. RELIABILITY

At least a meaningful controlled sample of repeated calls.

Track:

- failed connection
- websocket disconnect
- STT failure
- TTS failure
- model timeout
- provider 5xx/rate limit
- call completion.

A stack that is excellent 8/10 times is not production-ready.

---

# 20. PROVIDER FAILOVER

Decide whether V1 needs:

- realtime model fallback
- TTS fallback
- safe call termination only.

Failover itself adds complexity/latency.

Do not build elaborate multi-provider switching unless controlled tests justify it.

At minimum, failure should be graceful.

---

# 21. BENCHMARK MATRIX

For each candidate configuration record:

- transport
- STT
- endpointing settings
- model/provider/version
- TTS provider/voice
- prompt compiler version
- RAG config
- date
- sample count
- p50/p95 greeting
- p50/p95 turn
- p50/p95 barge-in
- quality scores
- STT phrase accuracy
- reliability
- cost/minute.

---

# 22. DECISION SCORECARD

Suggested weighting:

- end-to-end latency 25%
- conversational/sales correctness 25%
- naturalness 15%
- interruption control 10%
- STT accuracy 10%
- reliability 10%
- cost 5%.

Weights can change, but do not let cost dominate product quality prematurely.

Critical DNC/truth failures disqualify a candidate regardless of weighted score.

---

# 23. SELECTION REPORT

Claude reports:

1. candidate stacks
2. exact versions/configs
3. test sample
4. latency distribution
5. naturalness review
6. STT error examples
7. interruption performance
8. reliability
9. variable cost
10. hard-fail behavior
11. recommended primary stack
12. fallback/safe-failure plan
13. remaining risks.

---

# 24. ACCEPTANCE

A stack is eligible for controlled Twilio certification when:

- no critical roleplay hard fails attributable to model behavior
- repeated ordinary 3–5s gaps eliminated
- measured latency meets target or a specific documented exception is approved
- DNC/barge-in reliable
- phone-number behavior natural
- provider reliability acceptable
- cost understood.
