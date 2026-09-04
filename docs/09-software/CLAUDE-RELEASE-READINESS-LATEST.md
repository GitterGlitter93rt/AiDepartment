# CLAUDE CODE — RELEASE READINESS LATEST

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Purpose:** Consolidate the latest architecture/research deltas that materially affect the next end-to-end implementation pass.

This supplements rather than replaces:

- `CLAUDE-CURRENT-TASK.md`
- `TOMORROW-OUTBOUND-PILOT-PREFLIGHT-CURRENT.md`
- `CLAUDE-CRM-UI-CURRENT.md`
- `CLAUDE-SALES-AI-PILOT-CURRENT.md`

Preserve legitimate completed implementation. Fetch/reconcile current branch safely before applying these deltas.

---

# 1. READ THESE CURRENT DELTAS

1. `YAD-EXTERNAL-BLOCKERS-CURRENT.md`
2. `CLAUDE-SALES-OPTIMIZATION-LATEST.md`
3. `outbound-sales-brain-sales-ai-frame-experiment-candidates.v1.yaml`
4. `outbound-sales-brain-sales-ai-spoken-normalization-fixtures.v1.yaml`
5. `outbound-sales-brain-conversationrelay-implementation-research-2026-09.md`
6. `outbound-sales-brain-twilio-outbound-runtime-trust-research-2026-09.md`
7. `outbound-sales-brain-calcom-v2-implementation-research-2026-09.md`
8. `outbound-sales-brain-public-webhook-ingress-spec.md`
9. `market-miner-dataforseo-serp-adapter-spec.md`

Do not reread every repo document if current implementation + these deltas are enough.

---

# 2. CURRENT IMPLEMENTATION PRIORITY

Continue in this practical order, adjusting only for actual local dependencies:

## A — finish CRM/UI functional waves

- shared components/read models/actions;
- complete core rep flows;
- Meetings + post-meeting outcome card;
- manager Pilot/Call Review/Research Health/Imports;
- Settings health for Cal.com, Market Miner and voice where appropriate.

## B — finish provider integrations with fixtures before asking for credentials

- Cal.com v2 adapter lifecycle;
- webhook inbox/processor + reconciliation fallback;
- DataForSEO adapter Standard/Live routes;
- DNC provider interface/mock/fail-closed path.

## C — Sales AI regression additions

- machine-readable hook selector;
- 55 real-language objection fixtures;
- frame experiments as versioned candidates;
- spoken normalization fixtures;
- StrategyCallOutcome feedback linkage.

## D — voice VPS reuse audit

- inspect actual demo/receptionist transport;
- reuse proven ConversationRelay/STT/TTS/session plumbing where appropriate;
- keep Production Outbound Sales process separate;
- benchmark async AMD and fast greeting path;
- verify interruption/preemption/token streaming/text normalization.

## E — internal/allowlisted full voice regression

Run exact preflight scenarios before any real prospect pilot.

---

# 3. ASYNC AMD IS NOW THE PRIMARY HUMAN-EXPERIENCE CANDIDATE

Current Twilio documentation states synchronous AMD can introduce several seconds of silence and current default detection averages around roughly four seconds.

Therefore:

- do not default Production Outbound Sales to synchronous blocking AMD;
- benchmark `AsyncAmd=true`;
- preserve machine/voicemail handling through background classification;
- reconcile late/unknown classification safely;
- inspect shared audio-fork constraints with selected realtime stack.

Measure:

- answer -> first agent audio;
- AMD decision time;
- false classifications;
- hangup before first audio.

---

# 4. CONVERSATIONRELAY DELTAS

Audit/use current supported behavior:

- stream safe text chunks/tokens to TTS instead of waiting for full paragraphs;
- ordinary spoken responses should be interruptible;
- stale queued speech should be preemptible/cancellable;
- `last`/generation completion must not resurrect cancelled speech;
- normalize CRM values before TTS;
- use pronunciation/SSML overrides selectively when needed;
- benchmark STT provider/model on YAD terms instead of assuming a winner.

Use `outbound-sales-brain-sales-ai-spoken-normalization-fixtures.v1.yaml` as regression input.

---

# 5. CALLER TRUST / NUMBER HEALTH

Before scaled real outreach, track legitimate business-number readiness:

- SHAKEN/STIR / outgoing attestation where available;
- Voice Integrity status;
- CNAM status;
- Branded Calling status where eligible;
- spam/reputation signals where available;
- caller-number health state.

Do not spoof or rotate numbers to evade reputation.

Branded Calling is not required for internal/allowlisted engineering tests, but caller trust should be treated as production readiness rather than an afterthought.

---

# 6. CAL.COM LIFECYCLE — CREATE IS NOT ENOUGH

Current adapter must support/reconcile:

- create booking;
- reschedule;
- cancellation;
- no-show signal;
- meeting start/end where provider supplies it;
- idempotent duplicate events.

Cal.com SaaS webhooks require public HTTPS, so tailnet-only CRM cannot be the subscriber URL.

Implement/test:

- provider-authenticated webhook route adapter;
- durable `WebhookInbox`;
- idempotent worker processor;
- reconciliation poller fallback;
- manager health state.

Do not expose the internal CRM publicly just for webhooks.

---

# 7. PUBLIC WEBHOOK INGRESS

Build a narrow provider-neutral public ingress capable of supporting Cal.com first and Smartlead later.

Possible deployment after environment audit:

- Cloudflare Tunnel to webhook-only route/process;
- voice VPS lightweight gateway -> private Sales Brain relay;
- another minimal public edge.

Requirements:

- public HTTPS;
- provider signature/secret validation;
- durable inbox before success ACK;
- no browser/admin surface;
- no provider secret logging;
- private downstream processing;
- duplicate delivery harmless.

---

# 8. DATAFORSEO MARKET MINER ADAPTER

Implement first provider adapter using:

- Standard advanced for background/autopilot by default;
- Live advanced selectively for small immediate manager refresh/validation;
- location-targeted requests;
- structured paid/local-services/organic normalization;
- provider usage/cost accounting;
- query fingerprint/cache to avoid duplicate spend.

Provider returns observations, never canonical Account truth.

Still run:

`observation -> entity resolve -> website/business validate -> evidence -> score -> contact -> Call Pack`.

Do not score organic result as paid ad.

---

# 9. SALES AI OPTIMIZATION DELTAS

Integrate/test:

- hook selection matrix;
- realistic objection language fixtures;
- StrategyCallOutcome link back to hook/Call Pack/version;
- optional F4 tailored-permission frame only as a controlled experiment after baseline voice works.

Do not modify several conversation dimensions in the same early test.

Do not promote a hook because it booked more meetings if Michael rates those meetings poorly.

Primary downstream quality signal:

`qualified_attended_meeting`.

---

# 10. EXTERNAL DEPENDENCIES

Use `YAD-EXTERNAL-BLOCKERS-CURRENT.md` as the current register.

Do not stop early for credentials.

Build the receiving adapter/UI/tests first, then ask Michael for the smallest exact external action.

Important current external categories:

- Cal.com live API/event config;
- narrow public webhook ingress/DNS if needed;
- DataForSEO credential + small spend ceiling;
- production DNC/compliance screening source;
- historical lead files if desired;
- public rep access if Tailscale is insufficient;
- voice VPS deployment access if Claude lacks it;
- live Twilio production configuration.

---

# 11. RELEASE CLASSIFICATION STILL APPLIES

Final test report must select exactly one:

- `REAL_AI_PILOT_ELIGIBLE`
- `INTERNAL_AI_TEST_ONLY`
- `HUMAN_ASSIST_ONLY`

Do not classify real-pilot eligible when production phone screening/DNC, voice experience or attempt-time eligibility are unresolved.

---

# 12. CORE RULE

**Finish the seams now: provider lifecycle, public event ingress, phone eligibility, low-latency interruptible voice, truthful hook selection and downstream meeting quality. Individual modules being green is not enough; the end-to-end chain must behave like one sales operating system.**
