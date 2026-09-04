# Voice Runtime Reuse Audit — Deployed Receptionist/Demo Line

**Status:** Implementation audit (evidence-based)
**Date:** 2026-09-04
**Audited from:** EdgeXpert (`edgexpert-832b`), branch `feature/outbound-sales-brain`
**Gate:** `CLAUDE-EXTERNAL-BLOCKERS-CURRENT.md` §5 — "determine whether the voice VPS is reachable ... if reachable, inspect only; preserve working demo"

---

# 1. REACHABILITY — RESOLVED, NOT BLOCKED

The voice runtime is reachable from this machine over HTTPS. No credential was needed to audit it.

| Check | Result |
|---|---|
| DNS `voice.youraidepartment.ai` | `45.32.171.201` |
| HTTPS `/health` | `200`, JSON body |
| Edge | `nginx/1.24.0 (Ubuntu)` |
| App | `127.0.0.1:3001` behind that nginx |
| TCP 22 | open |
| SSH private key on EdgeXpert | **none present** (`~/.ssh` holds only `known_hosts`) |
| Tailnet membership | `edgexpert-832b`, `palacios-hs-laptop` only — the voice VPS is **not** on the tailnet |

So: HTTP inspection yes, shell access no. Nothing in this audit required shell access, and nothing on the VPS was modified — every request was a `GET`.

## Live service identity (from `/health`, 2026-09-04)

```json
{ "status": "ok", "activeSessions": 0,
  "build": { "shortCommit": "2ad6449", "branch": "feature/twilio-ai-phone-agent", "dirty": false,
             "startedAt": "2026-09-03T00:58:33.108Z" },
  "config": { "port": 3001, "host": "127.0.0.1",
              "publicBaseUrl": "https://voice.youraidepartment.ai",
              "relayUrl": "wss://voice.youraidepartment.ai/twilio/conversation",
              "twilioSignatureValidation": "enforced",
              "claudeModel": "claude-haiku-4-5-20251001",
              "twilioPhoneNumber": "+19046829345",
              "calendar": "MOCK", "sms": "MOCK", "humanTransfer": "absent",
              "logTranscripts": false, "partialPrompts": true } }
```

**The deployed runtime is built from this repository**, branch `feature/twilio-ai-phone-agent`, commit `2ad6449`, working tree clean. Its source is `services/ai-phone-agent/`. That is the code this audit reads; there is no unknown third-party transport to reverse-engineer.

Two facts worth acting on:

- `calendar: MOCK`, `sms: MOCK`, `humanTransfer: absent` — the deployed demo books nothing real. Outbound sales booking must go through Cal.com in the sales service, not through this runtime's tool layer.
- The approved number `+19046829345` is already live on inbound. Sharing it outbound is the case the dual-service spec covers.

---

# 2. WHAT IS PROVEN AND SHOULD BE REUSED

These modules are transport and runtime concerns with no receptionist business logic in them. They carry real operational knowledge — several comments in them document bugs already paid for — and rewriting them from memory would re-introduce those bugs.

| Concern | File (at `2ad6449`) | Why it is worth keeping |
|---|---|---|
| Public HTTP/WS surface | `src/http/paths.ts` | Single source for paths. Its comment records a real outage: the derived relay URL said `/relay` while the socket listened on `/twilio/conversation`, so every call dropped on connect. |
| Twilio signature validation | `src/twilio/signature.ts` | Enforced in production today (`twilioSignatureValidation: enforced`). |
| TwiML generation | `src/twilio/twiml.ts` | `conversationRelayTwiml`, `fallbackTwiml`, `transferTwiml`, `hangupTwiml`. |
| Relay frame parsing | `src/twilio/relay.ts` | Setup/prompt/interrupt/mark frames and the text-response encoder. |
| Socket + turn lifecycle | `src/server.ts` (`wss.on('connection')`) | One socket per call, all state keyed by `callSid`. Holds the interim-vs-final transcript rule, the "turn opens on first interim" rule, and the in-flight `AbortController` that stops an abandoned generation from being spoken over the caller. |
| Barge-in | `src/server.ts` interrupt handler | Aborts generation *and* truncates the stored agent turn to `utteranceUntilInterrupt`, so the next turn never refers back to words the caller never heard. |
| Latency timeline | `src/core/telemetry.ts` | Marks `WEBSOCKET_CONNECTED`, `RELAY_SETUP_RECEIVED`, `FIRST_CALLER_SPEECH`, `LAST_PARTIAL_TEXT_CHANGE`, `INTERRUPT_RECEIVED`. Honestly labels `FIRST_AGENT_AUDIO_PROXY` as `observable: false` because Twilio owns synthesis and reports nothing. |
| Session store | `src/core/session.ts` | Per-`callSid` lifecycle, `truncateLastAgentTurn`. |
| STT/TTS config | `src/config.ts` | `ttsVoice` (`en-US-Journey-O`), `ttsLanguage`, `partialPrompts`, relay URL derivation. |
| Tool dispatch | `src/core/tool-protocol.ts`, `src/tools/index.ts` | Framework only. |
| Structured logging / rate limit / body caps | `src/logger.ts`, `src/http/guards.ts` | — |
| Deployment | `deploy/yad-voice-agent.service`, `deploy/nginx-voice.*.conf`, `deploy/logrotate-*` | systemd + nginx with a dedicated `location /twilio/conversation` carrying the long WebSocket timeouts. |

## What must NOT be carried over

Per the dual-service spec §4, and confirmed by reading the code:

- `src/prompts/core-agent.ts`, `src/prompts/router.ts` — receptionist prompt and intent hierarchy;
- `src/business/*`, `src/industries/*`, `src/knowledge/*` — demo/industry personas (collision shop, tow equipment, attorney intake…);
- `src/core/router.ts`, `router-rules.ts`, `service-intent.ts` — inbound "which industry is this" routing;
- `DEMO_INTRO` positioning, which is already fenced behind `deploymentMode === 'demo'` and must never reach a client's caller;
- `src/tools/calendar.ts`, `src/tools/sms.ts` — both MOCK in production; outbound booking is Cal.com through the sales service.

The outbound brain is the composition already built and tested on this branch: `services/sales-brain/src/callbrain/` (`agent.ts`, `openerSelector.ts`, `knowledge.ts`, `qualification.ts`, `workingMemory.ts`), profile `yad-sales-core-v1`.

---

# 3. THE SPLIT — WHERE THE SEAM ACTUALLY IS

The deployed service is already close to the required shape. Two things it does not yet have:

1. `deploymentMode` is `'demo' | 'client'` (`src/config.ts:147`). The dual-service spec needs outbound as its own service, not a third value on this enum. A third enum value would be exactly the prompt-hot-swapping §7 forbids.
2. The socket handler builds turns by calling the receptionist `Orchestrator` directly. That call site is the seam: the transport does not care what produces the next line of speech.

Proposed structure, unchanged transport:

```text
services/voice-core/          transport only, lifted verbatim from 2ad6449
  http/paths.ts  twilio/{signature,twiml,relay}.ts
  core/{session,telemetry,tool-protocol}.ts  logger.ts  http/guards.ts
  → exposes: startVoiceService({ paths, turnProducer, greeting, config })

services/ai-phone-agent/      inbound receptionist (unchanged behaviour)
  turnProducer = receptionist Orchestrator

services/sales-voice/         NEW, separate process, separate unit, separate health
  turnProducer = callbrain agent (yad-sales-core-v1) + Cal.com booking bridge
```

Routing follows the spec §3/§5 and the nginx config already in the repo:

| Direction | Entry | Service |
|---|---|---|
| inbound | number webhook → `POST /twilio/incoming` | receptionist |
| outbound | Calls API with `From: +19046829345`, TwiML URL → `POST /outbound/voice?callContextId=…` | sales |
| inbound relay | `WSS /twilio/conversation` | receptionist |
| outbound relay | `WSS /outbound/conversation` | sales |

Separate systemd unit, separate port, separate `location` blocks reusing the existing WebSocket timeout block. One service crashing cannot take the other down. Each call session snapshots an immutable `agent_profile_id` at creation (`yad-receptionist-v1` / `yad-sales-core-v1`), so an operator toggle affects new calls only.

---

# 4. WHAT BLOCKS WHAT

Nothing in §3 requires a credential. It does require the two branches to be integrated, since the voice runtime is on `feature/twilio-ai-phone-agent` and the sales brain is on `feature/outbound-sales-brain`. That integration is a repository decision for Michael, not something to do silently inside a feature branch — and it is the only thing standing between this audit and the shared `voice-core`.

Requires Michael or an external account before a real outbound call:

- Twilio account/product limits and concurrency headroom (spec §10) — needs console access;
- confirmation that `+19046829345` may carry outbound sales caller ID;
- VPS capacity check and outbound concurrency cap;
- the controlled-pilot approval gate itself.

Explicitly still open on the VPS and unrelated to this audit: `calendar: MOCK`, `sms: MOCK`, `humanTransfer: absent`.

---

# 5. FINDING

The voice VPS is reachable, the deployed runtime is this repository's own code at a known clean commit, and its transport is worth keeping. **No voice transport should be rewritten.** The work is to lift `voice-core` out unchanged, leave the receptionist on it, and hang the already-tested sales brain off the same seam in a second process.
