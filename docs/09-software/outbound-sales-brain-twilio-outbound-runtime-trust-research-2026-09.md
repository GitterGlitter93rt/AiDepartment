# Your AI Department — Twilio Outbound Runtime & Caller Trust Research

**Status:** Supporting implementation authority  
**Date:** 2026-09-03  
**Purpose:** Translate current Twilio AMD and caller-trust documentation into concrete YAD release requirements for the outbound Sales AI.

---

# 1. OFFICIAL TWILIO SOURCES REVIEWED

Current documentation reviewed:

- Answering Machine Detection
  - `https://www.twilio.com/docs/voice/answering-machine-detection`
  - `https://www.twilio.com/docs/voice/answering-machine-detection-faq-best-practices`
- SHAKEN/STIR
  - `https://www.twilio.com/docs/voice/trusted-calling-with-shakenstir`
- Voice Integrity
  - `https://www.twilio.com/docs/voice/spam-monitoring-with-voiceintegrity`
- CNAM
  - `https://www.twilio.com/docs/voice/brand-your-calls-using-cnam`
- Branded Calling
  - `https://www.twilio.com/docs/voice/branded-calling`
  - `https://www.twilio.com/docs/voice/branded-calling/us-basic`
  - `https://www.twilio.com/docs/voice/branded-calling/us-enhanced`

Provider documentation wins if product requirements/status change.

---

# 2. SYNCHRONOUS AMD IS A HUMAN-EXPERIENCE RISK

Twilio's current AMD best-practice documentation explicitly notes that synchronous AMD can introduce several seconds of silence for the called party because call progression waits for the AMD decision.

Twilio currently documents average AMD decisions around roughly four seconds under default settings, with a speed/accuracy tradeoff.

That maps directly to YAD's observed failure mode:

- person answers;
- hears silence for 3–5 seconds;
- assumes dead/robocall;
- hangs up or starts saying hello repeatedly.

YAD decision:

**Do not make synchronous AMD the default human-answer path for Production Outbound Sales.**

---

# 3. ASYNC AMD BENCHMARK

Twilio supports `AsyncAmd=true` for Calls API outbound calls.

With async AMD:

- call/TwiML can progress immediately;
- AMD analyzes in background;
- classification arrives via `AsyncAmdStatusCallback`.

YAD should benchmark async AMD as the primary candidate for the first controlled outbound stack.

Test flow:

```text
Twilio outbound call
-> immediate ConversationRelay / fast greeting path
-> Async AMD in background
-> callback returns human / machine / fax / unknown
-> runtime reconciles result
```

Important: do not let late machine classification cause an incoherent mid-conversation jump if a real human is clearly engaging.

The runtime needs a state reconciliation policy.

---

# 4. ASYNC AMD AUDIO-FORK CONSTRAINT

Twilio currently notes that Async AMD consumes one forked audio stream while analyzing, from a per-call limit shared with features such as Media Streams, SIPREC and Real-Time Transcription.

Implementation implication:

Claude must audit whether the selected ConversationRelay/voice stack consumes conflicting forked streams.

If relevant features share the limit:

- sequence them correctly;
- wait for async AMD callback before starting an additional forked feature where needed;
- or choose a stack/configuration that avoids the conflict.

Do not assume all Twilio realtime features can be stacked simultaneously with no resource interaction.

---

# 5. AMD MODE BY PURPOSE

Twilio supports at least:

- `MachineDetection=Enable`
- `MachineDetection=DetectMessageEnd`

YAD intent:

## Human-first conversational Sales AI

Primary experiment:

- async AMD;
- rapid human greeting / ConversationRelay;
- use classification as a supporting signal.

## Voicemail-leaving path

If campaign policy permits voicemail and machine classification is sufficiently confident, `DetectMessageEnd` can be evaluated because Twilio waits for the machine greeting/end before returning the appropriate machine-end result.

Do not optimize voicemail delivery at the expense of a four-second silent human-answer experience.

---

# 6. AMD UNCERTAINTY

Possible outcomes:

- human;
- machine variants;
- fax;
- unknown.

Rules:

- `unknown` does not authorize a long prerecorded pitch;
- if a live person is already speaking coherently, conversational evidence should be considered by the runtime state machine rather than blindly switching to machine behavior on a questionable late result;
- preserve provider classification + timestamps for QA;
- tune optional AMD thresholds only after controlled call samples.

Do not set an extremely short timeout solely to win latency if accuracy collapses.

---

# 7. HUMAN-ANSWER LATENCY METRICS

For controlled tests capture:

```text
answered_at
first_agent_audio_at
amd_started_at
amd_decision_at
amd_answered_by
conversationrelay_connected_at
first_prospect_speech_at
```

Derived:

- human-answer-to-first-audio;
- AMD decision latency;
- answer-to-ConversationRelay session readiness;
- false machine/human classifications;
- hangup before first audio.

Use actual PSTN experience, not only server timing.

---

# 8. SHAKEN/STIR

Twilio's current SHAKEN/STIR docs describe attestation levels:

- A — caller identity known and provider knows the caller has the right to use the caller ID;
- B — customer known but caller-ID right not fully established;
- C — lower/other cases.

Current Twilio status callbacks can expose `StirStatus` for outgoing calls.

YAD should:

- complete Trust Hub/business identity requirements needed for the highest legitimate attestation available;
- log outgoing `StirStatus` with CallerIdentity health;
- monitor changes/anomalies;
- never spoof caller ID.

A-attestation is a trust signal, not a guarantee against spam labeling or a guarantee the prospect will answer.

---

# 9. VOICE INTEGRITY

Twilio Voice Integrity is designed to register approved business numbers with analytics vendors and reduce inappropriate spam labeling.

Twilio currently recommends Voice Integrity alongside SHAKEN/STIR, CNAM and Branded Calling as trust/answer-rate measures.

YAD should treat Voice Integrity onboarding as part of Production Outbound number readiness where eligible.

Store in `CallerIdentity`:

- Business Profile reference;
- Voice Integrity registration state;
- last reviewed/approved time;
- number assignment state;
- any available trust/reputation health signal.

Do not claim registration guarantees `not spam`.

---

# 10. CNAM

Twilio currently documents US CNAM as Public Beta.

Important current constraints include:

- US phone numbers;
- Business Profile with EIN or DUNS association;
- display depends on destination carrier/recipient service;
- CNAM has format/length restrictions;
- not all mobile users will see CNAM.

YAD should configure an approved business identity where useful, but should not use CNAM visibility as a release guarantee.

Manager Settings can display:

- configured;
- pending;
- approved;
- unavailable;

without exposing Trust Hub secrets.

---

# 11. BRANDED CALLING

Twilio currently offers Branded Calling products, including US Enhanced Branded Calling as generally available and US Basic as Public Beta according to current documentation.

Depending on product/device/carrier, branding can include business identity and potentially logo/call reason.

Current onboarding can depend on:

- approved Business Profile;
- Voice Integrity;
- proof/authorization of brand;
- additional eligibility/reputation requirements.

YAD should evaluate Branded Calling after the initial controlled pilot path is stable.

Do not delay internal/allowlisted voice engineering solely because Branded Calling is not yet active.

Before scaled real outreach, caller identity presentation becomes more important.

---

# 12. CALLER TRUST READINESS MODEL

Add/retain business-safe caller identity fields:

```text
CallerIdentity
- phone_number
- provider
- business_profile_status
- stir_shaken_status
- recent_stir_attestation
- voice_integrity_status
- cnam_status
- branded_calling_status
- spam_label_monitoring_status
- health_state
- last_reviewed_at
```

Health:

- HEALTHY
- WATCH
- DEGRADED
- PAUSED
- DISABLED
- TEST_ONLY

No automatic number rotation to evade reputation problems.

---

# 13. FIRST PILOT NUMBER STRATEGY

For first controlled outbound tests:

- use one approved YAD business number unless capacity/testing requires otherwise;
- preserve callback routing;
- preserve Account attribution;
- monitor provider errors, early hangups and trust status;
- do not churn numbers to manipulate answer rate.

Same business number can still support Demo vs Production modes through explicit routing/configuration, but the active production caller identity should be unambiguous at attempt time.

---

# 14. NUMBER-HEALTH CIRCUIT BREAKERS

Pause/review number/campaign for signals such as:

- Trust Hub/provider rejection;
- unexpected attestation degradation;
- duplicate-call defect;
- complaint/DNC anomaly;
- spam-label reports where available;
- abrupt extreme early-hangup anomaly;
- carrier error spike;
- caller-ID configuration mismatch.

Do not interpret answer-rate movement alone as definitive proof of spam labeling.

---

# 15. SETTINGS / PILOT UI

Manager should be able to see:

### Caller Identity
- number;
- mode;
- SHAKEN/STIR registration/status;
- latest outgoing attestation if available;
- Voice Integrity;
- CNAM;
- Branded Calling;
- health state.

### AMD
- mode;
- sync vs async;
- recent classification accuracy sample;
- answer-to-first-audio p50/p95;
- machine/unknown rate.

Do not expose provider auth credentials.

---

# 16. TESTS CLAUDE SHOULD RUN

1. human answer with synchronous AMD baseline — measure silence;
2. human answer with async AMD — measure first audio;
3. voicemail with async/appropriate detection path;
4. unknown AMD result — no incoherent voicemail/pitch switch;
5. async AMD + selected realtime voice features do not exceed fork constraints;
6. late machine result during obvious live engagement handled safely;
7. outgoing call stores `StirStatus` where Twilio supplies it;
8. caller number cannot be spoofed by Call Pack/model;
9. disabled/degraded caller identity cannot dial;
10. callback to outbound number still resolves recent Account context;
11. number-health pause blocks new calls immediately;
12. caller trust UI contains statuses but no secrets.

---

# 17. CORE RELEASE DECISION

**Human-answer experience beats elegant machine detection.**

For YAD's conversational AI, a several-second silent answer is unacceptable. Benchmark async AMD and a fast ConversationRelay greeting path, then preserve machine/voicemail handling without sacrificing the live human experience.

Caller trust should be built through legitimate business identity — SHAKEN/STIR, Voice Integrity, CNAM/Branded Calling where eligible — never through spoofing or number churn.
