# CLAUDE CODE — DEPLOYED VOICE RUNTIME REUSE AUDIT CURRENT

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Purpose:** Inspect and safely reuse the working YAD demo/receptionist voice runtime before implementing Production Outbound Sales voice.

Do not rewrite working telephony from the prototype until the actually deployed VPS runtime has been inspected.

---

# 1. PRODUCT DECISION

The same approved Twilio business number may support three roles:

- `DEMO_AI`
- `PRODUCTION_INBOUND`
- `PRODUCTION_OUTBOUND_SALES`

They may reuse a shared low-latency voice core, but they must not share one mutable business prompt/session namespace/process.

Outbound Sales uses the same caller ID by setting the outbound call's voice URL/runtime explicitly. Inbound number routing remains independently selectable.

---

# 2. FIRST RULE — PRESERVE THE WORKING DEMO

Before modifying anything on the voice VPS:

1. identify host, service manager and working directory;
2. record current git/release/version if applicable;
3. record process/service names and ports;
4. record reverse-proxy routes;
5. record Twilio webhook/voice URLs without exposing secrets;
6. record environment variable NAMES only unless values are needed locally;
7. capture current `/health` result;
8. preserve/config-backup the working runtime before refactor;
9. do not change Twilio production routing merely to inspect code.

If the runtime is not in Git, document the exact source location and copy strategy before changing it.

---

# 3. AUDIT MATRIX

For each item report:

- current implementation/file/module
- provider/config
- measured behavior
- reuse verdict: `REUSE_AS_IS | EXTRACT_SHARED | REIMPLEMENT | DEMO_ONLY`
- reason
- tests needed

Audit:

## Telephony edge

- Twilio incoming webhook validation
- outbound call creation capability if any
- callback/status webhooks
- AMD if present
- caller ID configuration
- request signature validation

## Realtime transport

- ConversationRelay / Media Streams / other transport
- WebSocket path
- connection lifecycle
- reconnect/failure behavior
- session cleanup

## Speech

- STT provider/model/settings
- TTS provider/voice/settings
- streaming support
- endpointing
- language configuration
- pronunciation helpers

## Turn-taking

- barge-in detection
- TTS cancellation
- stale generation cancellation
- interruption recovery
- silence handling

## Latency

Measure:

- answer -> first audio
- prospect end-of-turn -> first audio
- interruption -> TTS stop
- tool request -> acknowledgment

Use the targets from `outbound-sales-brain-realtime-voice-policy.md`.

## Conversation/model

- model provider
- prompt construction
- conversation history handling
- tool calling
- business context injection
- whether demo scenario content is hard-coded

## Speech normalization

- phone number pronunciation
- email pronunciation
- dates/times
- money/percentages

## Tool transport

- transfer
- SMS/email if present
- booking if present
- DNC if present
- action-result semantics

## Observability

- call/session IDs
- logs
- latency metrics
- provider errors
- recordings/transcripts where configured
- health endpoints

---

# 4. KNOWN DEMO FAILURE MODES TO REGRESSION TEST

The earlier demo experience exposed these defects; verify whether deployed runtime has already solved them:

- 3–5 second dead air at interaction start;
- slow responses causing caller to speak over agent;
- stale/repeated sentence after interruption;
- repetitive promise such as repeatedly saying a link will be sent;
- unnatural phone-number grouping;
- forcing caller to call back later instead of handling current intent;
- generic industry-routing questions unrelated to what caller explicitly asked for.

Do not assume the prototype branch represents the deployed behavior.

---

# 5. TARGET SERVICE LAYOUT

After audit, preferred conceptual separation:

```text
reverse proxy / Twilio routes
  /demo/*             -> yad-voice-demo
  /voice/inbound/*    -> yad-voice-inbound
  /voice/outbound/*   -> yad-voice-sales

shared package/library
  voice-core/
    twilio validation / transport
    websocket/session lifecycle
    STT/TTS configuration helpers
    interruption / cancellation
    speech normalization
    telemetry
```

Equivalent layout is acceptable if the deployed environment has a better existing structure.

Do not force a rewrite merely to match folder names.

---

# 6. PRODUCTION OUTBOUND SALES BOUNDARY

`yad-voice-sales` receives a prepared immutable Runtime Call Pack from the Sales Brain/API.

It must not:

- crawl websites;
- run Market Miner searches;
- resolve decision-makers live;
- query large research providers during ordinary turns;
- load the entire Sales Manual;
- mutate demo/inbound prompts.

It may perform bounded realtime tools:

- check availability;
- book after agreement;
- DNC;
- requested follow-up action;
- warm transfer where approved;
- small account-state writeback.

Heavy work remains on EdgeXpert.

---

# 7. SAME NUMBER ROUTING

The Twilio number's inbound webhook controls **new inbound calls**.

Outbound call creation supplies the Sales AI voice URL/runtime explicitly.

Therefore:

- Production Inbound may remain active while Production Outbound Sales calls use the same caller ID;
- Demo inbound routing can be intentionally enabled when Michael is demonstrating;
- switching inbound mode applies only to new inbound sessions;
- no mode toggle changes an already-active call's agent profile.

Implement operator-visible mode status rather than editing webhook URLs by hand for normal use.

---

# 8. CALLBACK

A prospect returning a call to the shared number must enter Production Inbound / inbound-sales-callback handling, not restart the cold opener.

Use recent Account/call context when safely matched.

---

# 9. ACCEPTANCE BEFORE OUTBOUND VOICE TEST

At minimum prove on internal/allowlisted numbers:

- correct Sales AI service receives outbound call;
- inbound receptionist remains independently healthy;
- demo remains independently available;
- first audio latency measured;
- barge-in cancels stale speech;
- number/date/time pronunciation natural;
- Runtime Call Pack loads before conversation;
- unexpected prospect answer changes next response;
- DNC path writes durable suppression;
- booking path uses fake/real configured adapter correctly;
- no heavy research job runs inside voice service;
- service restart does not erase canonical Account/call outcome state;
- STOP NEW OUTBOUND CALLS prevents new Twilio call creation.

---

# 10. AUDIT REPORT FORMAT

Return:

1. voice VPS reachable? host/access method;
2. deployed runtime location/version;
3. service/process manager;
4. ports/routes;
5. Twilio transport used;
6. STT/TTS/model providers;
7. measured latency;
8. barge-in behavior;
9. reusable components matrix;
10. known demo defects still present/fixed;
11. exact shared-core extraction plan;
12. exact separate Sales AI service plan;
13. credentials/access blockers;
14. test plan before any real prospect call.

---

# 11. CORE RULE

**Preserve the working demo, reuse the proven realtime voice plumbing, isolate business agents/processes, and let the outbound Sales AI consume prebuilt intelligence rather than rebuilding the voice stack or researching during the call.**
