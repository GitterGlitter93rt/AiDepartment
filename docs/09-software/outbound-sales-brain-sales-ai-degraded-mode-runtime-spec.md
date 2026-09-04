# Your AI Department — Sales AI Degraded-Mode Runtime Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Define what the live Sales AI does when STT, LLM, TTS, booking, email, websocket or another dependency becomes slow/uncertain/unavailable so callers hear a short truthful recovery instead of dead air, fake success or repetitive apologies.

---

# 1. PRINCIPLE

Every realtime dependency can fail.

The caller experience should degrade from:

`normal conversation -> brief truthful recovery -> smallest safe next step -> clean end/human follow-up`

not:

`normal conversation -> silence -> hallucinated answer -> repeated apology loop`.

The model does not decide whether a dependency is healthy. Runtime/provider health does.

---

# 2. FAILURE CLASSES

Normalize at least:

- `STT_LOW_CONFIDENCE`
- `STT_TIMEOUT`
- `LLM_FIRST_TOKEN_SLOW`
- `LLM_TIMEOUT`
- `LLM_PROVIDER_ERROR`
- `TTS_FIRST_AUDIO_SLOW`
- `TTS_PROVIDER_ERROR`
- `WEBSOCKET_TRANSIENT`
- `WEBSOCKET_FATAL`
- `BOOKING_AVAILABILITY_SLOW`
- `BOOKING_AVAILABILITY_FAILED`
- `BOOKING_COMMIT_FAILED`
- `EMAIL_SEND_FAILED`
- `SMS_SEND_FAILED`
- `TRANSFER_FAILED`
- `CRM_WRITE_DEGRADED`
- `DNC_WRITE_FAILED`
- `SUPPRESSION_SERVICE_UNAVAILABLE`
- `UNKNOWN_REALTIME_FAILURE`.

Each failure has:

```text
severity
caller_safe_to_continue
side_effects_allowed
recovery_budget
fallback_action
terminal_if_repeated
```

---

# 3. NO DEAD-AIR RULE

Ordinary turns should meet the realtime voice latency policy.

If the runtime knows a slow operation is occurring and the caller is waiting, one concise truthful status phrase may be spoken.

Approved shapes:

- `One second — I'm checking that.`
- `Let me pull up Michael's calendar.`
- `I didn't catch that clearly — can you say that once more?`

Not approved:

- fake typing noises;
- `I'm thinking...` every turn;
- repeated `sorry, one moment` loops;
- invented provider success;
- five seconds of silence while waiting for a predictable slow tool.

Filler is a recovery feature, not normal conversational cadence.

---

# 4. RECOVERY BUDGET

Per failure class limit retries/re-prompts.

Default V1:

- STT clarification: max 1–2 depending on criticality;
- ordinary LLM response retry: max 1;
- TTS retry: max 1 if transport remains healthy;
- booking availability refresh: max 1 during live call;
- booking commit retry: only through idempotent provider-safe path;
- email/SMS send retry: no blind duplicate if provider result ambiguous;
- websocket reconnect: only if Twilio/session semantics safely support it.

After recovery budget exhausted, choose human follow-up/clean end.

Do not keep the prospect trapped while infrastructure retries.

---

# 5. STT LOW CONFIDENCE

For noncritical conversational content:

> I didn't catch that clearly — can you say that one more time?

For email/phone/time:

- ask only for the uncertain chunk;
- do not ask them to repeat the whole address/number if only one part is uncertain;
- preserve previous confirmed chunks;
- use longer endpointing patience during dictation.

Example:

> I got `john at abc air dot com` — was that `john` or `jon` before the at sign?

Do not guess the missing value.

---

# 6. LLM SLOW / TIMEOUT

The precomputed opening removes the first LLM round trip from the answer path.

For later turns:

## Early threshold

If first safe phrase is not ready inside the normal latency target, runtime may prepare one deterministic noncommittal acknowledgment only when context supports it:

- `Got it.`
- `Okay.`
- `That's helpful.`

Do not emit an acknowledgment that implies understanding if transcript/intent is not stable.

## Timeout

If the LLM fails completely:

- do not improvise a sales answer from stale text;
- use deterministic fallback based on current state.

Examples:

### discovery

> I don't want to waste your time while my system catches up. Let me have Michael's team follow up instead.

### booking already requested

> My calendar connection isn't responding cleanly. I don't want to give you a time I can't confirm — I'll have the team follow up with the slot you wanted.

Persist human follow-up if database/action path is healthy.

If CRM is also unavailable, end without promising follow-up unless a durable fallback queue exists.

---

# 7. TTS FAILURE

If TTS fails before any audio for a generated turn:

- one provider retry/fallback voice only if already tested and safe;
- do not switch to an obviously different personality/voice mid-sentence without reason;
- if recovery fails, terminate cleanly if Twilio permits a static fallback phrase.

Possible static fallback:

> I'm having a connection issue on my side. I'll let you go rather than waste your time.

Do not keep an open silent call.

---

# 8. WEBSOCKET FAILURE

## Transient before meaningful conversation

If session can safely reconnect inside strict time budget, reconnect once.

## Fatal / uncertain state

- stop new speech generation;
- do not replay previous turn from beginning;
- preserve provider/call state;
- end through the safest Twilio fallback route.

If a prospect stated DNC immediately before failure and stable transcript/intention exists:

- DNC action has priority;
- if suppression persistence cannot be confirmed, fail closed and raise SEV-0/incident workflow.

---

# 9. BOOKING AVAILABILITY SLOW

When prospect agrees to meeting:

AI may say once:

> Let me check Michael's calendar.

If availability returns within acceptable tool window:

- offer two real slots.

If availability remains unavailable:

> The calendar isn't loading cleanly, and I don't want to make up a time. What's generally better for you — later today or tomorrow morning? I'll have the team confirm it.

Only ask preference if durable human follow-up action can be created.

Do not tell them they are booked.

---

# 10. BOOKING COMMIT FAILURE

If selected slot fails:

First attempt:

> That one didn't confirm on my side. Let me refresh it once.

If fresh availability succeeds:

- offer new real choices.

If commit still fails:

> I don't want to tell you it's booked when it isn't. I have the time you preferred and I'll have the team confirm it directly.

Create human follow-up only after durable action confirmation.

Canonical Meeting remains `NOT_CONFIRMED` / equivalent.

False booking success is a hard fail.

---

# 11. EMAIL / SMS FAILURE

If prospect asks for information:

## Provider definitively failed

> That didn't go through on my side. I captured what you wanted and I'll have the team resend it.

Only say this if durable follow-up is confirmed.

## Provider result ambiguous

Do not retry blindly.

> I can't confirm that message went through, so I don't want to send it twice. I'll have the team check it.

Use idempotency/provider message ID reconciliation.

---

# 12. TRANSFER FAILURE

If hot transfer fails:

> Michael isn't connecting on the transfer. Rather than keep you hanging, I can get a 15-minute time on the calendar instead.

If booking healthy, use normal Cal.com flow.

If booking unhealthy:

- capture requested callback/preferred time;
- confirm only durable follow-up action, not a nonexistent transfer/meeting.

---

# 13. CRM WRITE DEGRADED

A voice conversation cannot safely continue making business commitments if canonical state cannot be persisted.

If noncritical analytics write fails but core Account/action storage remains healthy:

- continue;
- durable outbox/retry.

If critical relationship state cannot be stored:

- no booking confirmation unless booking + canonical linkage can still be durably reconciled;
- no DNC-dependent continued operation;
- no new autonomous call after current session until health restored.

Critical DB/suppression failures follow incident-response runbook.

---

# 14. DNC WRITE FAILED

This is not an ordinary tool failure.

If prospect clearly requests stop:

- stop selling immediately;
- acknowledge briefly;
- end call;
- block new autonomous calls through fail-closed circuit until suppression durability is restored/reconciled;
- incident severity according to existing runbook.

The agent must never say:

> I marked you do-not-call

unless durable suppression action confirms success.

Safer if persistence fails:

> Understood. I won't continue this call.

Then system incident path ensures suppression is repaired manually/automatically before further outreach.

---

# 15. UNKNOWN FAILURE

If system cannot classify the realtime failure confidently:

- no speculative tool results;
- no continued long discovery;
- one concise exit.

> I'm having a connection issue on my side. I'll let you go rather than waste your time.

Record `UNKNOWN_REALTIME_FAILURE` and review.

---

# 16. FAILURE MEMORY / REPETITION

Working memory tracks:

- recovery phrase already used;
- retry count by dependency;
- last failed tool;
- whether human follow-up created;
- whether prospect already repeated data.

Do not ask the prospect for the same email/time three times because provider state was lost.

---

# 17. PROVIDER CIRCUIT BREAKERS

At service level, automatically stop initiating new Sales AI calls when critical realtime dependencies cross configured failure thresholds, for example:

- LLM availability severe;
- TTS unavailable;
- ConversationRelay transport failing;
- canonical DB unavailable;
- suppression service unavailable;
- booking required for campaign but adapter globally failing;
- repeated false/ambiguous tool-state defect.

Human Assist may continue if its separate dependencies/policies remain healthy.

---

# 18. PILOT UI

Live Calls / Pilot Health should show:

- dependency health;
- current degraded mode;
- recovery count;
- tool error;
- whether caller was told success;
- human follow-up created;
- terminal reason.

Completed call root causes include:

- MODEL_LATENCY
- MODEL_ERROR
- STT_ERROR
- TTS_ERROR
- WEBSOCKET
- BOOKING
- MESSAGING
- CRM
- SUPPRESSION
- UNKNOWN_RUNTIME.

Do not make operator read raw logs to know a booking adapter failed.

---

# 19. TEST FIXTURES

Required allowlisted tests:

1. LLM first-token delay > target but recovers — no repeated filler.
2. LLM hard timeout during discovery — clean exit/follow-up only if durable.
3. STT mishears email — asks only uncertain chunk.
4. TTS provider error — one safe retry/fallback, then clean end.
5. websocket drops after opener — no stale opener replay.
6. Cal.com availability timeout — no invented slots.
7. Cal.com chosen slot disappears — one refresh.
8. Cal.com commit hard failure — never says booked.
9. email provider ambiguous success — no duplicate blind send.
10. transfer fails — booking fallback if healthy.
11. CRM analytics write fails but canonical relationship write healthy — continue.
12. canonical DB fails — stop new commitments / autonomous calls.
13. DNC write fails — end + fail closed / incident.
14. unknown error — one concise exit, no loop.
15. two dependencies fail simultaneously — one recovery/exit, not stacked apologies.

---

# 20. QA HARD FAILS

- >3 seconds recurring silent wait without justified/tested exception;
- false tool success;
- stale speech resumes after interruption/failure;
- repeated recovery phrase loop;
- prospect asked to repeat already-confirmed data because runtime lost state;
- DNC failure followed by continued sales pitch;
- booking provider failure recorded as confirmed meeting;
- uncontrolled retry sends duplicate email/SMS/meeting;
- runtime continues autonomous campaign while critical suppression/DB dependency unavailable.

---

# 21. CORE RULE

**When technology degrades, become simpler and more truthful — not more talkative. One brief recovery attempt, preserve the prospect's time, never invent a successful action, and end or hand off cleanly before a provider problem becomes a bad sales experience.**
