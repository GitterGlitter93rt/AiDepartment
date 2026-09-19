# Your AI Department — Twilio Conversation Data Retention Specification

**Status:** Architecture authority based on current Twilio documentation  
**Date:** 2026-09-03  
**Purpose:** Make provider-side transcript/audio retention explicit so YAD does not accidentally create durable call recordings/transcripts through Twilio configuration while the application believes capture is disabled.

---

# 1. CURRENT TWILIO BEHAVIOR REVIEWED

Current Twilio ConversationRelay documentation states:

- ConversationRelay handles STT/TTS over the active call;
- call recording is a separate Voice recording capability;
- ConversationRelay transcripts are **not stored by Twilio in Conversation Intelligence by default**;
- configuring the `intelligenceService` attribute sends ConversationRelay transcribed utterances to Conversation Intelligence (classic) for persistence/analysis;
- Conversation Intelligence receives transcript text, not call audio, for this integration;
- Twilio's AI Nutrition Facts describe provider-specific logging/retention characteristics and should be re-reviewed when voice/STT provider configuration changes.

Provider docs win if behavior changes.

---

# 2. DEFAULT PRODUCTION PRIVACY MODE

Unless the current `MediaCaptureDecision` explicitly allows durable media/transcript retention:

```text
TWILIO_CALL_RECORDING = OFF
CONVERSATION_INTELLIGENCE_SERVICE = UNSET
YAD_FULL_TRANSCRIPT_PERSISTENCE = OFF
RAW_AUDIO_DEBUG_CAPTURE = OFF
FULL_TURN_APPLICATION_LOGGING = OFF
```

Realtime ConversationRelay operation remains subject to separately reviewed realtime speech-processing policy.

Do not turn on observability products as a hidden workaround for a blocked transcript policy.

---

# 3. CONVERSATION INTELLIGENCE

Current Twilio integration uses the ConversationRelay `intelligenceService` attribute.

YAD rule:

- leave `intelligenceService` unset by default;
- only configure it when the exact deployment's transcript-retention policy is ALLOW;
- tie configuration to explicit environment/mode + policy version;
- record the Intelligence Service SID/name only as secret/config metadata, not in browser-visible Call Pack;
- do not enable it globally because one internal test requires transcripts.

Production mode and internal test mode may legitimately differ.

---

# 4. TWILIO CALL RECORDING

Twilio Voice recording is a separate feature from ConversationRelay.

YAD may call any Twilio recording API/TwiML only after:

- `AUDIO_RECORDING = ALLOW`;
- required consent evidence exists;
- current jurisdiction/policy passes;
- retention duration/config is defined.

If capture decision is BLOCK/REVIEW:

- do not start recording;
- do not request provider recording after the call;
- Call Review UI must show `Audio not retained by policy`, not `Recording missing`.

---

# 5. PROVIDER-SIDE TEXT / TWIML LOGS

Current Twilio AI Nutrition Facts note provider/TwiML logging behavior can differ by STT/TTS path. For example, current ElevenLabs-related ConversationRelay documentation notes TwiML/Say logs may be available for troubleshooting for a limited period.

Architecture rule:

- treat provider-side text/log visibility as retention surface;
- audit selected TTS/STT provider before production;
- minimize prospect-sensitive content passed in diagnostic metadata;
- do not put full Call Pack/prospect research into TwiML text fields unnecessarily;
- verify Twilio Console/log retention settings/options available for the account;
- document unavoidable provider log retention in privacy/retention policy.

Do not assume `we did not save it in Postgres` means no provider copy/log exists.

---

# 6. APPLICATION WEBSOCKET LOGGING

ConversationRelay sends/transports text events through YAD WebSocket runtime.

Production logger must default to structured metadata:

```text
call_id
session_id
event_type
state
message_direction
character_or_token_count
latency_ms
provider_event_id
error_code
```

Avoid logging full utterance text by default.

Debug text logging:

- separate explicit mode;
- internal/allowlisted only unless policy allows;
- retention cap;
- redaction;
- audited enable/disable.

Never log raw audio payloads as ordinary debug data.

---

# 7. LLM PROVIDER RETENTION AUDIT

ConversationRelay STT/TTS is only part of the call path.

Claude must separately document selected LLM provider runtime settings:

- whether API inputs/outputs are retained;
- training/data-use settings;
- request logging;
- regional/data-processing options where relevant;
- deletion/retention configuration.

Do not assume Twilio's STT/TTS retention statements apply to the separate LLM API.

LLM provider selection/change requires privacy/retention re-review.

---

# 8. STT/TTS PROVIDER CHANGE CONTROL

If Claude changes:

- Deepgram ↔ Google STT;
- ElevenLabs ↔ Google/Amazon TTS;
- model/voice provider;

then re-run:

1. latency/accuracy benchmark;
2. provider retention/privacy audit;
3. selected provider terms/config review;
4. media-capture policy compatibility.

A faster provider that retains more data outside approved policy is not automatically acceptable.

---

# 9. INTERNAL / ALLOWLISTED DEBUG PROFILE

Define a named profile, e.g.:

`INTERNAL_VOICE_DEBUG`

Possible features after tester consent:

- durable transcript;
- audio recording;
- full text logs;
- Conversation Intelligence;

but only the minimum actually needed should be enabled.

This profile may never be silently reused for real prospect traffic.

Production profile must be separate, e.g.:

`PRODUCTION_OUTBOUND_PRIVACY`.

---

# 10. PRODUCTION CONFIG SNAPSHOT

Every call attempt should record privacy/media config IDs such as:

```text
media_capture_decision_id
voice_runtime_profile_version
conversation_intelligence_enabled
provider_recording_enabled
full_transcript_persistence_enabled
selected_stt_provider
selected_tts_provider
selected_llm_provider
retention_policy_version
```

Do not store provider secrets with the snapshot.

---

# 11. CALL REVIEW UX

Review page must distinguish:

- `Audio retained`;
- `Transcript retained`;
- `Structured review only`;
- `Capture blocked by policy`;
- `Capture unavailable due technical error`.

Those are different states.

Never imply intentional non-retention is a system failure.

---

# 12. RELEASE TESTS

1. production privacy profile produces no Twilio Recording resource;
2. production privacy profile leaves `intelligenceService` unset when transcript policy blocks;
3. internal consented debug profile can enable allowed media without changing production config;
4. WebSocket logs contain no full transcript in production default;
5. error logs do not dump full provider text payload;
6. Call Review correctly reports policy-blocked media;
7. runtime profile/version stored per call;
8. changing STT/TTS provider fails configuration review until privacy profile updated;
9. no raw audio written to disk by ordinary application logger;
10. provider retention audit appears in release evidence.

---

# 13. CORE RULE

**Realtime AI speech, call recording, durable transcript persistence, provider observability and application logging are separate data-retention surfaces. Keep them off by default unless the current media-capture policy explicitly allows them, and never let a debugging feature silently become the production recording system.**
