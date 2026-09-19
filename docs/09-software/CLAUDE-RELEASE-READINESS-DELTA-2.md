# CLAUDE CODE — RELEASE READINESS DELTA 2

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Purpose:** Add only the newest implementation deltas created after `CLAUDE-RELEASE-READINESS-LATEST.md` so Claude can reconcile them without rereading/replacing completed work.

Read after:

- `CLAUDE-RELEASE-READINESS-LATEST.md`

---

# 1. NEW FILES

1. `market-miner-dataforseo-first-hvac-benchmark-plan.md`
2. `outbound-sales-brain-smartlead-api-webhook-research-2026-09.md`
3. `outbound-sales-brain-webhook-auth-fixtures.v1.yaml`
4. `outbound-sales-brain-ai-pilot-candidate-selection-delta-v1.1.yaml`
5. `outbound-sales-brain-florida-recording-transcription-policy-research-2026-09.md`
6. `outbound-sales-brain-twilio-conversation-data-retention-spec.md`
7. `outbound-sales-brain-sales-ai-vertical-language-pack.v1.yaml`

These supplement existing provider, CRM, Pilot, Call Review, Smartlead, compliance and conversation specs.

---

# 2. DATAFORSEO FIRST BENCHMARK

Do not run broad provider volume immediately.

First HVAC benchmark:

- research-only;
- Jacksonville + St. Augustine;
- six canonical Pass-1 HVAC queries;
- 12 city-level Standard tasks first;
- expand to selected ZCTAs only if yield justifies;
- max 20 Live validation tasks;
- absolute first-benchmark task cap 218;
- hard provider-spend ceiling `$2` even if account balance is larger;
- no auto-recharge;
- no outreach.

Judge by:

- paid/LSA precision;
- unique advertiser yield;
- entity resolution;
- Tier B+ / Ready Human Assist yield;
- provider cost per trustworthy Account.

---

# 3. SMARTLEAD CURRENT INTEGRATION

Implement/provider-test current Smartlead behavior:

- API remains execution provider, not CRM;
- webhook signature uses current Smartlead HMAC over raw body;
- use `X-Request-Id` for event idempotency when present;
- track `X-Webhook-Level`;
- campaign pause is **campaign-specific**;
- global unsubscribe is global.

Relationship rules:

- positive reply / requested callback / booked meeting / active opportunity may pause current generic campaign;
- actual email unsubscribe updates suppression at the correct scope;
- do not globally unsubscribe every engaged prospect merely to pause a sequence;
- hard bounce invalidates endpoint, not Account.

Use provider-neutral public webhook ingress.

---

# 4. EXACT WEBHOOK AUTH

Use:

`outbound-sales-brain-webhook-auth-fixtures.v1.yaml`

Current exact provider behavior to test:

## Cal.com

- header `x-cal-signature-256`;
- HMAC-SHA256 of exact raw body using configured secret;
- verify before JSON mutation/re-serialization.

## Smartlead

- `X-Smartlead-Signature` current format;
- HMAC-SHA256 exact raw body;
- `X-Request-Id` preferred idempotency key;
- webhook level captured.

Authentication and idempotency are separate.

Durably accept authenticated new event before returning provider success.

---

# 5. PILOT CANDIDATE v1.1

A high-fit prospect is not automatically an AI-callable endpoint.

Pilot readiness must now explicitly surface/evaluate:

- telecom line type + source/freshness;
- business context evidence;
- current ChannelPermissionEvidence/contact basis;
- scope/revocation;
- destination jurisdiction/timezone;
- exact AI eligibility reason codes.

Manager UI should be able to show e.g.:

```text
Fit: A · 13
Human Call: Allowed
AI Voice: Review Required
Reason: AI voice contact basis not established for this endpoint
```

Do not turn `public business contact`, `landline`, `B2B`, or `Tier A` into invented AI-voice permission.

---

# 6. FLORIDA MEDIA CAPTURE

Recording/transcript behavior is now explicitly split from AI-call permission.

At minimum evaluate separately:

- REALTIME_SPEECH_PROCESSING
- DURABLE_TRANSCRIPT_STORAGE
- AUDIO_RECORDING
- QA_AUDIO_RETENTION
- TRANSCRIPT_ANALYTICS_RETENTION

For Florida durable audio recording, fail closed without the consent evidence required by current reviewed policy.

Do not assume AI disclosure = recording consent.

Do not assume staying on the call = recording consent.

Call Review must distinguish:

- media retained;
- structured review only;
- intentionally blocked by policy;
- technical capture failure.

---

# 7. TWILIO / PROVIDER RETENTION

Production privacy profile should not accidentally create durable media through provider config.

Unless current MediaCaptureDecision allows:

```text
TWILIO_CALL_RECORDING = OFF
CONVERSATION_INTELLIGENCE_SERVICE = UNSET
YAD_FULL_TRANSCRIPT_PERSISTENCE = OFF
RAW_AUDIO_DEBUG_CAPTURE = OFF
FULL_TURN_APPLICATION_LOGGING = OFF
```

Current Twilio docs say ConversationRelay transcripts are not persisted to Conversation Intelligence by default; configuring `intelligenceService` changes that behavior.

Audit:

- selected STT provider retention;
- selected TTS provider/TwiML log retention;
- selected LLM provider retention/logging;
- application/WebSocket logs.

Internal consented debug profile must be separate from production privacy profile.

---

# 8. ONE AI, INDUSTRY-APPROPRIATE LANGUAGE

Use:

`outbound-sales-brain-sales-ai-vertical-language-pack.v1.yaml`

Do **not** create new vertical personalities.

Use the appropriate business nouns/questions from supported vertical classification, e.g.:

- HVAC: service call / dispatch / replacement estimate;
- Roofing: inspection / estimate / proposal;
- Collision: estimate / repair order / estimator;
- Law: inquiry / intake / consultation;
- Real estate: seller/buyer inquiry / nurture;
- Dental/med spa: new-patient/client inquiry / appointment;
- Restoration: emergency call / dispatch;
- PDR/hail: hail inquiry / estimate / vehicle.

Prospect-supplied safe terminology should override generic vocabulary during the call.

Do not use jargon merely to sound expert.

---

# 9. RELEASE-GATE ADDITION

Add media/privacy checks to real-pilot evidence:

- current MediaCaptureDecision exists;
- provider recording configuration matches it;
- Conversation Intelligence disabled unless allowed;
- transcript persistence matches it;
- logs do not become hidden transcript store;
- allowlisted consent/decline path tested;
- selected LLM/STT/TTS retention audited.

If unresolved, do not mark full media QA capture as available.

---

# 10. CORE RULE

**The remaining work is integration correctness, not feature count. Provider events must be authenticated and deduped, campaign state must reconcile into one Account, the AI-call candidate must have actual channel evidence, Florida media capture must be explicit, and one Sales AI must speak the language of the business without becoming a collection of separate bots.**
