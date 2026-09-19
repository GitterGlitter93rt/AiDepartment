# Your AI Department — Shared Twilio Number / Dual Voice Service Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Reuse the proven receptionist voice plumbing while keeping inbound receptionist and outbound sales workloads independently controllable, even when they use the same Twilio phone number.

---

# 1. PRODUCT DECISION

YAD may use the **same Twilio number** for:

- inbound receptionist calls; and
- outbound sales caller ID.

But inbound receptionist and outbound Sales AI should be deployed as **separate logical services/processes**.

Do not create one giant process whose prompt/mode is mutated in-place between receptionist and outbound sales conversations.

Preferred model:

```text
                         SAME TWILIO NUMBER
                                |
                +---------------+---------------+
                |                               |
          inbound call                     outbound call
                |                               |
      Twilio number webhook              Calls API `From`
                |                               |
     Receptionist Voice Service         Sales Voice Service
                |                               |
      receptionist prompt/core          Sales CallPack + core
                |                               |
                +---------------+---------------+
                                |
                     shared canonical CRM/data
```

---

# 2. WHY SHARE THE NUMBER

Potential benefits:

- one recognizable YAD business number;
- callback continuity;
- simpler brand identity;
- fewer numbers to manage initially;
- outbound prospects who call back reach YAD rather than a dead line.

Shared caller ID does **not** mean shared conversational state.

---

# 3. DIRECTION-BASED ROUTING

## Inbound

The Twilio phone number's inbound voice webhook continues to point to the receptionist entrypoint.

Example logical route:

`POST /voice/inbound`

The receptionist service decides how to greet, route, capture, book, or transfer inbound callers.

## Outbound

The outbound Sales AI initiates a Twilio call through the Calls API using the same approved YAD number as `From`.

The outbound call's TwiML/voice URL points explicitly to the outbound Sales AI entrypoint.

Example logical route:

`POST /voice/outbound?callContextId=...`

Therefore outbound calls do not depend on the phone number's inbound webhook to choose their AI.

---

# 4. REUSE THE RECEPTIONIST VOICE CORE — NOT ITS BUSINESS PROMPT

Claude should audit the actual deployed receptionist implementation and extract/reuse proven infrastructure where it is genuinely reusable.

Likely reusable voice-core concerns:

- Twilio signature validation;
- HTTP/webhook plumbing;
- WebSocket/ConversationRelay transport;
- STT/TTS provider configuration;
- turn/event parsing;
- interruption/barge-in behavior;
- speech pacing;
- number/date/time pronunciation helpers;
- session lifecycle;
- connection recovery;
- structured logging;
- tool dispatch framework;
- transfer primitives;
- latency measurement;
- health checks.

Do **not** blindly clone:

- receptionist system prompt;
- receptionist intent hierarchy;
- industry-demo routing logic;
- lead-intake assumptions;
- inbound-only booking questions;
- stale latency/response patterns that caused prior demo problems.

The reusable unit should become a shared `voice-core` or equivalent abstraction where practical.

---

# 5. PROCESS ISOLATION

Initial production direction:

```text
voice.youraidepartment.ai
  reverse proxy
      |
      +-- /inbound/*   -> receptionist service
      +-- /outbound/*  -> outbound sales service
      +-- /relay/inbound/*  -> receptionist realtime session
      +-- /relay/outbound/* -> sales realtime session
```

Equivalent subdomains or internal ports are acceptable if Claude's runtime audit finds a cleaner deployment path.

Requirements:

- separate process supervision;
- separate health checks;
- separate prompt/config versions;
- separate runtime feature flags;
- separate session stores/namespaces;
- shared canonical Account/Contact/booking data only through controlled APIs/database boundaries;
- one service crashing must not automatically kill the other.

---

# 6. OPERATOR MODE CONTROLS

The admin/control plane should expose independent toggles rather than one ambiguous `AI ON/OFF` switch.

Recommended switches:

- `Inbound Receptionist`: ON / OFF
- `Outbound Sales AI`: OFF / INTERNAL TEST / CONTROLLED PILOT / ENABLED_BY_POLICY
- `Outbound Dial Creation`: ON / OFF
- `Auto-book Strategy Calls`: ON / OFF
- `Warm Transfer to Human`: ON / OFF

The operator should be able to leave inbound receptionist fully operational while outbound sales is disabled.

Likewise, outbound sales can be tested internally without changing the inbound receptionist webhook.

---

# 7. NO PROMPT HOT-SWAPPING BETWEEN ACTIVE CALLS

Do not implement:

> set global mode = SALES and all calls now use Sales prompt.

That can corrupt active sessions and create race conditions.

Every call/session receives an immutable `agent_profile_id` / `mode` snapshot at creation.

Example:

```text
CallSession
- call_id
- direction: inbound | outbound
- agent_profile_id: yad-receptionist-v1 | yad-sales-core-v1
- prompt_version
- CallPack ID optional
- account_id optional
- created_at
```

Changing an admin toggle affects **new calls only**.

---

# 8. CALLBACK ROUTING

A prospect who receives an outbound call may later call the same number back.

V1 safest behavior:

1. inbound call reaches receptionist;
2. receptionist checks caller ID against recent YAD outbound history where permitted;
3. if a recent open sales context exists, receptionist may say it sees they recently spoke with YAD and route to the appropriate human/sales callback flow;
4. otherwise ordinary receptionist flow.

Do not automatically launch the outbound cold-call script merely because the caller's number exists in the prospect database.

Later option:

`RecentOutboundCallbackRouter`

- caller number match;
- recent attempt window;
- Account owner;
- requested callback state;
- open meeting/opportunity;
- transfer availability.

---

# 9. SAME-NUMBER CALLER ID RULE

Outbound Sales AI should use only an approved YAD-controlled caller ID.

Do not rotate/spoof unrelated local numbers to simulate proximity.

Store caller identity used on every attempt.

Number reputation/STIR-SHAKEN/Voice Integrity configuration remains part of the dial-controller/reputation workstream.

---

# 10. CAPACITY / CONCURRENCY

Claude must audit actual Twilio account/product limits and the current VPS capacity before pilot.

The design must assume inbound and outbound calls can overlap.

Protect inbound service quality by:

- separate process limits;
- outbound concurrency cap;
- outbound circuit breaker when CPU/memory/latency thresholds are unhealthy;
- priority to inbound receptionist if the services share the same host/resources;
- no Market Miner crawling on realtime voice process.

Initial pilot should use very low outbound concurrency.

---

# 11. DEPLOYMENT OPTIONS

## Preferred near-term

Same voice VPS, separate services/processes/ports.

Advantages:

- fastest path to reuse current voice plumbing;
- same DNS/cert/reverse proxy;
- easier pilot observability.

## Later scale

Separate hosts if required:

- `voice-inbound` node;
- `voice-outbound` node;
- shared control/data API.

Public URL can remain stable behind proxy/load balancer.

---

# 12. SHARED VOICE CORE PACKAGE

Claude should evaluate a structure such as:

```text
voice/
  core/
    transport/
    twilio/
    relay/
    speech/
    tools/
    telemetry/
    pronunciation/
  receptionist/
    prompt/
    intents/
    server/
  sales/
    prompt/
    CallPack/
    state-machine/
    server/
```

Do not force this exact layout if current production code suggests a safer refactor, but preserve separation of core transport from business behavior.

---

# 13. CRITICAL RECEPTIONIST LESSONS TO CARRY FORWARD

Earlier demos exposed issues that must not reappear in outbound:

- 3–5 second interaction pauses are unacceptable;
- response latency must be measured per turn;
- barge-in must stop speech quickly;
- do not repeat the same instruction when user talks over the agent;
- do not force callers to call back later when the task can be advanced now;
- phone numbers must be spoken naturally;
- agent should answer the caller's actual intent rather than reset to generic intake questions.

These are voice-core quality requirements, not vertical-specific script requirements.

---

# 14. PILOT CONFIGURATION

For the first controlled outbound pilot:

- same YAD Twilio caller ID may be used if approved/configured;
- inbound receptionist remains enabled;
- outbound Sales AI operates in separate process;
- outbound concurrency very low;
- explicit allowlist/compliance eligibility;
- kill switch available;
- CallPack required;
- booking adapter tested;
- session/call logs and QA enabled;
- outbound process restart must not interrupt inbound receptionist.

---

# 15. HARD FAILS

Reject implementation if:

- switching Sales AI ON changes the behavior of already-active inbound calls;
- inbound and outbound share one mutable global prompt;
- outbound failure takes down inbound reception;
- crawler/miner workloads execute in realtime voice process;
- same phone number causes callback loops;
- system cannot identify whether a call is inbound or outbound;
- caller ID is spoofed/uncontrolled;
- phone number is used as the sole key for Account identity;
- an outbound prospect callback is automatically treated as a cold outbound conversation without routing context.

---

# 16. CORE RULE

**Reuse the receptionist's proven low-latency voice engine, not its receptionist brain. One YAD number can serve both directions, while inbound receptionist and outbound sales remain independently deployable and independently switchable.**
