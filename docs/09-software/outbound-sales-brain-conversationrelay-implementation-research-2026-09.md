# Your AI Department — Twilio ConversationRelay Implementation Research

**Status:** Supporting implementation research; current Twilio documentation reviewed  
**Date:** 2026-09-03  
**Purpose:** Translate current Twilio ConversationRelay capabilities/best practices into concrete YAD voice-runtime benchmark requirements without replacing the existing realtime voice policy.

---

# 1. OFFICIAL SOURCES REVIEWED

Current Twilio documentation reviewed:

- `https://www.twilio.com/docs/voice/conversationrelay/best-practices`
- `https://www.twilio.com/docs/voice/conversationrelay/websocket-messages`
- `https://www.twilio.com/docs/voice/conversationrelay/voice-configuration`
- `https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun`
- `https://www.twilio.com/en-us/changelog/conversationrelay-now-supports-ssml-tags-to-fine-tune-speech`

These are implementation references, not business/compliance authority.

---

# 2. STREAM TOKENS EARLY

Twilio recommends streaming LLM text tokens/chunks to ConversationRelay as they become available rather than waiting for the complete response.

YAD implication:

- do not wait for full paragraph generation before first TTS audio;
- stream only after the next phrase is semantically safe;
- keep first clauses short enough to produce audio quickly;
- preserve whitespace between streamed tokens/chunks;
- mark final token correctly using the `last` field.

Benchmark:

1. token streaming;
2. phrase/chunk streaming;
3. full-response buffering as a negative/quality comparator.

Measure caller-experienced first-audio latency and natural cadence.

---

# 3. INTERRUPTIBLE / PREEMPTIBLE AUDIO

ConversationRelay text messages support:

- `interruptible` — caller speech/DTMF can stop current playback;
- `preemptible` — a subsequent app message can replace current playback.

YAD default live-agent intent:

- ordinary Sales AI responses should be interruptible;
- stale responses should be preemptible so a newly classified intent can replace them;
- DNC/wrong-number/identity questions must be able to preempt the old turn immediately;
- do not blindly resume abandoned text after interruption.

Claude should inspect whether the current demo runtime uses these fields correctly.

Test explicitly:

- interrupt during opener;
- interrupt during YAD explanation;
- interrupt during booking options;
- DNC interrupt;
- `who is this?` interrupt;
- prospect correction during email/phone confirmation.

---

# 4. TTS TEXT NORMALIZATION

Twilio's best-practice guidance specifically recommends normalizing:

- numbers/units;
- dates;
- email addresses;
- names;
- abbreviations;
- special characters;
- punctuation;
- acronyms/initials.

YAD now has:

`outbound-sales-brain-sales-ai-spoken-normalization-fixtures.v1.yaml`

Use YAD's deterministic normalizer before the spoken string is sent to TTS.

The canonical CRM value must remain unchanged.

Example:

`+19045551212`

canonical storage stays exact; spoken rendering becomes roughly:

`nine oh four, five five five, one two one two`.

---

# 5. ELEVENLABS NORMALIZATION TRADEOFF

Twilio supports an `elevenlabsTextNormalization` setting.

Twilio notes that enabling ElevenLabs normalization can improve handling of certain text formats but adds another normalization step; disabling it can provide more control/lower latency when the application handles normalization itself.

YAD benchmark:

### Variant A

YAD deterministic normalizer + ElevenLabs normalization OFF.

### Variant B

YAD minimal normalizer + ElevenLabs normalization ON.

Compare:

- phone-number accuracy;
- email accuracy;
- business-name pronunciation;
- natural cadence;
- first-audio latency;
- total turn latency.

Do not choose solely on subjective voice quality.

---

# 6. SSML / PRONUNCIATION

ConversationRelay supports SSML passthrough depending on provider.

Current Twilio documentation indicates:

- Google/Amazon support provider-specific SSML features;
- ElevenLabs supports the `<phoneme>` tag for `en-US` in this context.

YAD use:

- difficult company names;
- uncommon surnames;
- critical brand/product pronunciations;
- known acronyms if deterministic text spacing is insufficient.

Do not insert phoneme markup into canonical CRM values.

Use pronunciation dictionary:

```text
canonical_token
spoken_form / phoneme
scope = global | vertical | account | contact
source
verified_at
```

Only use SSML when needed; ordinary text normalization should handle common cases.

---

# 7. TTS PROVIDER / VOICE

Twilio's current ConversationRelay voice configuration supports multiple TTS providers and currently documents ElevenLabs as the default provider when a provider/voice is not explicitly supplied.

YAD must still explicitly configure the selected production voice rather than rely on provider defaults changing over time.

Benchmark candidate voice stacks using:

- current demo voice if it is already strong;
- at least one alternative voice/provider only if needed;
- identical scripts/Call Packs during comparison.

Evaluate:

- naturalness;
- intelligibility on PSTN audio;
- phone/email pronunciation;
- interruption behavior;
- latency;
- cost/minute;
- provider reliability.

Do not change the successful demo voice just because another voice sounds better in a browser sample.

---

# 8. STT PROVIDER TESTING

Twilio explicitly recommends testing STT providers/models for the use case rather than assuming one universal best provider.

Current ConversationRelay supports provider configuration including Google and Deepgram in documented flows.

YAD test corpus should include:

- HVAC;
- CRM;
- ServiceTitan;
- Housecall Pro;
- PDR;
- roofing company names;
- common Florida city names;
- email dictation;
- phone-number dictation;
- accents/background noise where internal testers can reproduce safely.

Metrics:

- word accuracy on business terms;
- intent-classification impact;
- endpointing delay;
- false interruption;
- correction frequency.

A provider with slightly better generic transcription but worse endpointing may create a worse call.

---

# 9. MULTI-LANGUAGE

Current ConversationRelay documentation supports multi-language configurations, with provider constraints for automatic detection.

Do not enable automatic language switching in the first Sales AI pilot unless tested end to end.

When YAD later enables it:

- language detection must not unexpectedly change voice identity;
- relevant STT/TTS provider combination must be supported;
- business terms/booking remain accurate;
- language-specific scripts/boundaries must be reviewed.

English-only pilot remains simpler.

---

# 10. ERROR MESSAGES / WEBSOCKET

ConversationRelay can send WebSocket error messages when app messages fail validation.

Production runtime should log structured fields:

- call/session ID;
- ConversationRelay error code;
- bad message type/validation context;
- current conversation state;
- whether caller audio was affected;
- retry/recovery result.

Do not expose raw provider errors to the caller.

Repeated transport/TTS/STT error should trigger concise recovery/end rather than an endless apology loop.

---

# 11. `last` MESSAGE DISCIPLINE

Correct use of the `last` indicator matters in streaming mode.

YAD should treat a spoken response as a versioned `TurnGeneration`:

- generation_id;
- state version;
- text chunks;
- final/last marker;
- cancelled_at optional.

After interruption/cancellation:

- old generation may not later send `last` as if it completed normally;
- new generation owns the current turn.

This should be tested because stale message completion can cause duplicated or delayed speech.

---

# 12. WELCOME GREETING / ANSWER EXPERIENCE

ConversationRelay supports a configured welcome greeting.

For outbound Sales AI, benchmark whether the greeting is best produced through:

1. configured welcome greeting;
2. app-generated immediate first turn;
3. precomputed CallPack-specific opening ready before connection.

Goal:

- no 3–5 second silence after human answer;
- still use the correct Account-specific opener;
- avoid speaking over voicemail/answer detection.

A generic fast greeting is not automatically better than a slightly later but relevant opener; benchmark the entire experience.

---

# 13. DEMO-RUNTIME REUSE AUDIT

Before replacing transport, Claude should document current demo values for:

- ConversationRelay TwiML;
- TTS provider/voice;
- STT provider/model;
- streaming behavior;
- `interruptible` default;
- `preemptible` default;
- endpointing settings;
- text normalization;
- welcome greeting behavior;
- WebSocket session lifecycle;
- tool transport;
- call-state persistence;
- observed latency.

Then classify each component:

- `REUSE_AS_IS`;
- `REUSE_WITH_CONFIG_CHANGE`;
- `REFACTOR_SHARED_CORE`;
- `DO_NOT_REUSE`.

Production Sales AI remains a separate process even when sharing the same underlying voice-core code.

---

# 14. BENCHMARK OUTPUT

For each candidate stack/config capture:

- greeting p50/p95;
- first-audio turn p50/p95;
- barge-in stop p50/p95;
- speech recognition accuracy on test corpus;
- phone normalization pass rate;
- email normalization pass rate;
- stale-audio-after-interrupt failures;
- TTS validation/error count;
- subjective naturalness 1–5;
- cost/minute;
- configuration version.

Do not promote a stack with severe interruption/accuracy failures simply because the voice sounds impressive.

---

# 15. CORE RULE

**Use Twilio's streaming, interruptibility, normalization and provider flexibility deliberately. The winning voice stack is the one that responds quickly, stops when interrupted, says business data correctly and preserves the Sales AI's conversational intent over a real phone line.**
