# Your AI Department — Florida Recording / Transcript Capture Policy Research

**Status:** Official-source architecture research; not legal advice  
**Date:** 2026-09-03  
**Purpose:** Prevent YAD from treating realtime speech processing, durable transcript retention and call audio recording as one implicit capability during Florida calls.

---

# 1. OFFICIAL SOURCE REVIEWED

Florida Statutes § 934.03 — Interception and disclosure of wire, oral, or electronic communications prohibited:

`https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.03.html`

Current 2026 text provides, among other exceptions, that it is lawful for a person to intercept a wire, oral or electronic communication when **all parties to the communication have given prior consent**.

Formal production interpretation should be reviewed by qualified counsel/compliance professionals.

---

# 2. PRODUCT DECISION — SEPARATE MEDIA MODES

Do not use one boolean `record_call` or one vague `transcription_enabled` flag.

At minimum distinguish:

```text
REALTIME_SPEECH_PROCESSING
DURABLE_TRANSCRIPT_STORAGE
AUDIO_RECORDING
QA_AUDIO_RETENTION
TRANSCRIPT_ANALYTICS_RETENTION
```

Each can have:

- ALLOW
- BLOCK
- REVIEW_REQUIRED
- NOT_APPLICABLE

with:

- jurisdiction;
- consent evidence;
- purpose;
- policy version;
- evaluated time;
- retention class.

---

# 3. REALTIME SPEECH PROCESSING

The Sales AI requires some speech recognition / realtime text or model input to converse.

Do not assume the legal treatment of transient realtime processing is identical to durable recording/storage.

Architecture should preserve a separate deterministic policy question for:

`REALTIME_SPEECH_PROCESSING`.

Until formal policy says otherwise, do not use the existence of realtime STT as permission to retain:

- full transcript;
- audio recording;
- raw provider audio;
- indefinitely stored utterances.

Transient processing should be minimized to what is needed for the call and governed by the selected AI-voice policy.

---

# 4. AUDIO RECORDING — FLORIDA DEFAULT

For Florida calls, do not durably record call audio unless the current recording policy has evidence that all required parties consented under the reviewed rule.

A UI/QA preference like:

`record calls for coaching = true`

cannot override this gate.

If recording consent is absent/unclear:

```text
AUDIO_RECORDING = BLOCK or REVIEW_REQUIRED
```

The AI call may only continue if the separately reviewed realtime-processing policy allows the call without recording.

---

# 5. DURABLE TRANSCRIPT STORAGE

Treat full durable transcript storage as a separate capture/retention decision.

For conservative V1 Florida policy:

- do not retain a verbatim full transcript unless the current policy/evidence permits it;
- prefer structured post-call facts/outcomes when raw transcript retention is not allowed;
- preserve only the minimum durable business facts needed for CRM, with source semantics appropriate to the reviewed policy.

If legal review concludes transcript storage falls within the same all-party consent requirements for the selected architecture, the deterministic gate must enforce it.

Do not let the model decide.

---

# 6. CONSENT EVIDENCE

Recording/transcript consent should use structured evidence from:

`ChannelPermissionEvidence`

or a specialized `MediaCaptureConsentEvidence` object.

Suggested fields:

```text
media_consent_id
call_id
account_id
contact_id optional
jurisdiction
capture_modes[]
consent_status
consenting_party_identity_or_role
consent_language_version
consent_obtained_at
source_call_event_id
policy_version
revoked_at optional
```

Do not infer consent because:

- they stayed on the phone;
- they said hello;
- they accepted a strategy meeting;
- they know the caller is AI;
- the business line has a generic `calls may be recorded` message on some unrelated inbound path.

---

# 7. START-OF-CALL DISCLOSURE / CONSENT FLOW

If the selected Florida policy requires recording/transcription consent:

1. provide the approved disclosure before capture that requires consent begins;
2. obtain an affirmative response in the required form;
3. persist consent evidence;
4. enable only the approved capture modes;
5. if caller declines, either:
   - continue in no-recording/no-durable-transcript mode if current policy/technology allows; or
   - end/route to a human path if the call cannot lawfully/functionally continue.

Do not hide consent language inside the sales pitch.

Exact required wording belongs to reviewed policy/config, not hard-coded architecture prose.

---

# 8. AI IDENTITY VS RECORDING CONSENT

These are separate questions.

A prospect can know:

> `I'm an AI voice assistant for Your AI Department.`

without having agreed to:

> audio recording / transcript storage.

Likewise recording disclosure does not automatically satisfy any AI-voice calling consent requirement.

Store/evaluate separately.

---

# 9. CALL REVIEW PAGE

Call Review should conditionally render:

## When audio retention allowed

- audio player;
- recording status;
- consent/policy reference.

## When durable transcript allowed

- transcript;
- timestamps;
- speaker labels.

## When neither is allowed

Still show permitted structured review data:

- Account/Contact;
- selected hook;
- conversation state transitions if retainable;
- structured prospect facts/outcome;
- tool calls/results;
- latency metrics;
- QA flags that do not require retained raw content;
- DNC/wrong-number/booking results;
- version snapshot.

Do not show an empty audio player suggesting a missing recording bug when recording was intentionally blocked.

---

# 10. QA WITHOUT RECORDING

The pilot should still support operational QA when raw media cannot be stored.

Possible permitted telemetry subject to current policy:

- answer-to-first-audio latency;
- interruption timestamps;
- TTS cancellation events;
- state transitions;
- tool calls;
- disposition;
- structured prospect statements/facts if retention allowed;
- aggregate STT confidence/error metrics without raw utterance retention;
- reviewer live listen-only only if policy allows.

Do not bypass recording rules by storing `debug audio` under another name.

---

# 11. PROVIDER SETTINGS

Twilio / ConversationRelay / STT / LLM providers may have their own logging/retention options.

Claude must audit:

- Twilio call recording settings;
- provider-side ConversationRelay logs/recordings if any;
- STT provider data retention;
- LLM provider request/log retention;
- application log payloads;
- crash/error traces.

Turning off YAD's database recording is insufficient if a provider is still retaining raw audio/transcripts contrary to policy.

Settings should explicitly configure the most privacy-preserving provider mode compatible with the approved deployment.

---

# 12. LOG REDACTION

Never let normal application logs accidentally become the call recording system.

Avoid logging:

- raw audio;
- complete transcript turns by default;
- prospect email/phone without necessary redaction/context;
- provider payloads containing full conversation text.

Use IDs, hashes, state names and metrics where enough.

Debug capture requires explicit temporary mode and same policy/retention rules as ordinary capture.

---

# 13. RETENTION

When capture is permitted, define:

- purpose;
- retention duration;
- authorized roles;
- deletion behavior;
- legal hold if applicable;
- export/access audit;
- provider-side deletion/retention where available.

Do not keep pilot recordings indefinitely merely because storage is cheap.

---

# 14. MULTI-STATE CALLS

Do not use `YAD is in Florida` as the only recording-law selector.

Policy engine should consider:

- called party location/jurisdiction;
- YAD/caller location where relevant;
- governing reviewed multi-state recording policy.

When state/location is uncertain, choose conservative REVIEW/BLOCK for durable capture until policy resolves it.

---

# 15. INTERNAL / ALLOWLISTED TESTS

For internal/allowlisted voice testing:

- testers should knowingly agree to the recording/transcript modes being tested;
- consent event should still be recorded so the production workflow is exercised;
- do not use internal test mode to validate a hidden production recording path that bypasses the actual consent gate.

---

# 16. MACHINE-READABLE DECISION

Conceptual:

```text
MediaCaptureDecision
- call_id
- jurisdiction
- realtime_speech_processing
- durable_transcript_storage
- audio_recording
- qa_audio_retention
- transcript_analytics_retention
- consent_evidence_ids[]
- policy_version
- evaluated_at
- refresh_or_reconsent_condition
- reason_codes[]
```

No capture component initializes until the relevant decision is ALLOW.

---

# 17. RELEASE GATE ADDITION

Before Florida real-pilot classification:

- recording/transcript policy pack reviewed;
- provider retention audited;
- capture decisions server-side;
- consent path tested on allowlisted participants;
- decline path tested;
- Call Review page respects missing/blocked media;
- no raw conversation leaks into logs;
- exact pilot configuration confirms whether audio/transcript will be retained.

If unresolved:

- do not record audio;
- do not durably retain full transcript;
- real AI pilot classification remains subject to whether approved realtime processing can operate under the current policy.

---

# 18. CORE RULE

**A working voice bot does not automatically have permission to record the call. In Florida, durable audio capture should fail closed without the required all-party consent evidence. Realtime processing, transcript retention and recording are separate policy-controlled capabilities, and the CRM/QA experience must respect that separation.**
