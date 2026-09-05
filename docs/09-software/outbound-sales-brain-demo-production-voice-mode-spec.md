# YAD Voice AI — Demo vs Production Mode Specification

**Status:** Architecture authority  
**Date:** 2026-09-03

## 1. Product decision

YAD uses the same approved Twilio business number, but Michael chooses which AI runtime is active for the purpose at hand.

There are three independently controlled capabilities:

- `DEMO_AI` — polished demo experience used when showing prospects sample AI receptionist/industry scenarios;
- `PRODUCTION_INBOUND` — real YAD receptionist for calls into the YAD number;
- `PRODUCTION_OUTBOUND_SALES` — one YAD Sales AI used to contact researched prospects.

The demo runtime is not the production sales runtime.

## 2. Same number, explicit routing

Inbound phone-number webhook must point to the currently approved inbound target.

Outbound Calls API explicitly supplies the outbound Sales AI voice URL, so outbound calls can use the same caller ID without changing the inbound webhook.

Demo mode may temporarily point inbound demo traffic to the demo runtime when Michael intentionally enables it.

No mode change may mutate an already-active call's prompt/profile.

## 3. Operator control

Admin page should expose clear controls:

```text
Inbound Mode
  - Production Receptionist
  - Demo Runtime
  - Human/Fallback

Outbound Sales AI
  - Off
  - Internal Test
  - Controlled Pilot
  - Enabled by approved policy

Demo Runtime
  - Ready / Unavailable

STOP NEW OUTBOUND CALLS
```

Changing inbound mode applies to new inbound calls only.

Outbound Sales AI is controlled separately and can remain off while Demo AI is active.

## 4. One outbound Sales AI

Do not create one autonomous sales agent per vertical.

Use `yad-sales-core-v1` plus a CallPack containing:

- company research;
- vertical context;
- observed ad/service context;
- decision-maker route;
- primary hypothesis;
- first question;
- relevant Sales Manual excerpts;
- proof boundaries;
- booking tools.

## 5. Shared voice-core reuse

Claude should inspect the working demo/receptionist runtime on the voice VPS and reuse proven low-latency components where appropriate:

- Twilio webhook/signature handling;
- ConversationRelay/WebSocket transport;
- STT/TTS configuration;
- barge-in/interruption handling;
- natural speech helpers;
- session lifecycle;
- telemetry/latency measurement;
- transfer/tool transport.

Business prompts/state machines remain separate.

## 6. Process isolation

Preferred near-term layout on the voice VPS:

```text
reverse proxy
  /demo/*            -> Demo AI service
  /voice/inbound/*   -> Production receptionist service
  /voice/outbound/*  -> Production Sales AI service
```

Equivalent internal ports/subdomains are acceptable after Claude audits the deployed runtime.

Each service gets:

- separate process supervisor unit;
- separate environment/config;
- separate health endpoint;
- separate session namespace;
- immutable agent-profile snapshot per call.

A Sales AI crash must not automatically take down production inbound reception.

## 7. Callback behavior

If a prospect called by the Sales AI calls the shared YAD number back, route through production inbound reception first.

Receptionist may look up recent outbound context and route to the Account owner/Michael or capture a callback.

Do not automatically start a cold outbound script on an inbound callback.

## 8. Demo safeguards

Demo AI can use synthetic/example company contexts and intentionally selected demo scenarios.

Demo context must never leak into real YAD production calls.

Production Account data must never be overwritten by demo interactions.

## 9. Production outbound objective

The production Sales AI's goal is not to demonstrate AI capabilities.

Its normal objective is:

`reach correct person -> ask one researched business-process question -> listen/probe -> identify meaningful opportunity -> book a 15-minute strategy call with Michael when warranted`.

## 10. Core rule

**Same number and shared voice technology are fine. Demo, production inbound, and production outbound remain explicit independent modes with separate prompts/processes. Michael chooses the active mode; active calls never hot-swap brains.**
