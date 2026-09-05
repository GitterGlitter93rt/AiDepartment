# Your AI Department — Public Webhook Ingress Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Receive authenticated external provider events without exposing the internal Sales Brain/CRM broadly to the public internet.

---

# 1. PROBLEM

Several external systems need to call YAD asynchronously:

- Cal.com booking/reschedule/cancel/no-show events;
- Smartlead/reply/bounce/unsubscribe events when integrated;
- potentially other approved SaaS callbacks later.

The EdgeXpert sales application may remain private/tailnet-restricted during pilot use.

External providers cannot send webhooks to localhost/private-only URLs.

Therefore webhook ingress is a distinct public edge concern.

---

# 2. PRODUCT DECISION

Create one small public HTTPS webhook ingress layer with provider-specific authenticated routes.

Conceptual flow:

`External SaaS`
-> `public HTTPS webhook route`
-> `provider authentication/signature verification`
-> `durable WebhookInbox`
-> `private relay / canonical worker`
-> `Sales Brain DB / Account timeline`.

The webhook gateway is **not** the CRM UI.

It does not expose Account search, reports, login, admin pages or provider secrets.

---

# 3. POSSIBLE DEPLOYMENT OPTIONS

Claude should choose after auditing actual runtime constraints.

## Option A — Cloudflare Tunnel / public route to EdgeXpert ingress process

Advantages:

- direct durable write to canonical Postgres possible;
- minimal relay complexity.

Requirements:

- only webhook route publicly exposed;
- CRM/auth routes remain protected/private;
- TLS/public hostname;
- provider authenticity check before durable processing.

## Option B — Public voice VPS webhook gateway

Advantages:

- already public HTTPS infrastructure;
- external providers can reach it;
- internal Sales Brain remains private.

Flow:

`provider -> VPS gateway -> authenticated private Sales Brain API/outbox via Tailscale/secure route`.

Requirements:

- gateway does not become second CRM;
- durable local inbox/relay or guaranteed retry semantics;
- private authenticated relay;
- no heavy Sales Brain research on voice runtime.

## Option C — Other lightweight public edge

Acceptable if it provides:

- HTTPS;
- secure secret storage;
- signature validation;
- durable delivery/idempotency;
- private downstream route.

Do not choose architecture purely because deployment is convenient.

---

# 4. HOSTNAME

Possible dedicated hostname:

`hooks.youraidepartment.ai`

or provider-scoped routes on an existing secure public service.

Recommended route shapes:

- `/webhooks/calcom`
- `/webhooks/smartlead`

Twilio realtime voice webhooks may remain under `voice.youraidepartment.ai` because they are latency-sensitive telephony transport rather than ordinary SaaS event sync.

Do not expose raw provider names in a way that creates security through obscurity assumptions; route secrecy is not authentication.

---

# 5. HTTP SURFACE

Default:

- POST only for event routes;
- GET may return 404/health according to deployment policy;
- reject other methods;
- strict content type;
- body size cap;
- request timeout;
- rate limiting/abuse controls compatible with provider delivery;
- no browser session/cookie auth.

Provider authentication is specific to provider webhook mechanism.

---

# 6. PROVIDER ADAPTER CONTRACT

Each webhook adapter implements conceptually:

```text
identifyProviderEvent(request)
authenticate(request, rawBody)
parse(rawBody)
normalize(parsedPayload)
extractIdempotencyKey(parsedPayload)
ackPolicy()
```

Output:

```text
NormalizedWebhookEvent
- provider
- event_type
- provider_event_key
- primary_external_object_id optional
- occurred_at optional
- received_at
- normalized_metadata
- raw_payload_reference optional
- authenticity_verified
```

Provider parser never directly mutates Account/Opportunity state before durable inbox insertion.

---

# 7. AUTHENTICATION

Provider event must pass the exact current provider authenticity mechanism.

Examples:

- webhook secret/signature;
- signed header;
- provider-specific verification.

Rules:

- verify using raw body where provider requires it;
- constant-time comparison where applicable;
- reject invalid event before canonical processing;
- log failure metadata without logging secret;
- secret rotated/configured outside repo.

Never treat source IP alone as sufficient identity unless current provider documentation explicitly requires/supports it as one layer.

---

# 8. DURABLE INBOX

Canonical pattern:

```text
WebhookInbox
- webhook_inbox_id
- provider
- provider_event_key
- event_type
- primary_external_object_id optional
- payload_hash
- raw_payload_encrypted_or_reference optional
- authenticity_verified
- received_at
- processing_status
- attempts
- last_error
- processed_at optional
```

Unique constraint:

`provider + provider_event_key`

or a deterministic equivalent when provider gives no event ID.

Duplicate provider delivery must not create duplicate CRM effects.

---

# 9. ACKNOWLEDGEMENT

After:

- request authenticated;
- payload validated enough to identify event;
- durable inbox insert succeeds or duplicate is recognized;

return provider-appropriate success quickly.

Do not keep external webhook request open while running:

- Market Miner;
- LLM classification;
- email generation;
- long CRM workflow;
- downstream provider calls.

Workers handle those asynchronously.

If durable write fails, do not return false success unless architecture has another durable acceptance layer.

---

# 10. PRIVATE PROCESSOR

Webhook worker consumes normalized event and performs provider-specific reconciliation.

Examples:

## Cal.com

- booking created;
- rescheduled;
- cancelled;
- no-show;
- meeting started/ended.

## Smartlead

- message sent;
- reply;
- bounce;
- unsubscribe;
- campaign state as approved.

Processor resolves canonical Account/Contact/provider mapping, then appends activity/state.

It may create human review if mapping is ambiguous.

Do not guess Account identity from one weak field.

---

# 11. CANONICAL ACCOUNT MEMORY

External provider events never become parallel truth silos.

They attach to canonical:

- Account;
- Contact;
- CommunicationEvent;
- Meeting;
- Opportunity;
- suppression;
- follow-up.

Example:

Smartlead positive reply must stop generic cold outreach against the same Account even if phone channel uses a different provider.

Cal.com cancellation must update the same Meeting object originally created from the AI call.

---

# 12. AMBIGUOUS MATCH

If provider event cannot safely resolve to one canonical object:

- store event;
- mark `REVIEW_REQUIRED`;
- do not silently attach to a random Account;
- expose manager exception with useful identifiers.

Examples:

- imported email reused across multiple Account aliases;
- stale provider booking metadata;
- manual Cal.com booking created outside YAD context.

---

# 13. HEALTH / OBSERVABILITY

Manager Settings/Research Health should show per provider:

- webhook configured;
- last authenticated event;
- events received 24h;
- pending inbox count;
- failed processing count;
- oldest pending age;
- authentication failures;
- processor health.

Do not expose payload contents or secrets by default.

---

# 14. INCIDENT BEHAVIOR

If webhook processor is down:

- ingress continues durable capture if capacity allows;
- backlog visible;
- worker catches up after recovery.

If ingress itself is down:

- provider retries where supported;
- reconciliation poller may catch current state for critical providers;
- manager health shows degraded state.

Do not lose DNC/unsubscribe events silently.

Provider events that affect suppression receive highest processing priority.

---

# 15. SECURITY

Public ingress service must not:

- expose Postgres publicly;
- include admin debug endpoints without authentication;
- return stack traces;
- log authorization tokens/secrets;
- permit arbitrary outbound URL fetch based on webhook payload;
- interpret webhook text as system/prompt instructions;
- allow provider payload to execute code/templates.

Treat provider payload strings as untrusted data.

---

# 16. TESTS

Per provider:

1. valid signed event accepted once;
2. invalid signature rejected;
3. duplicate event produces no duplicate side effect;
4. malformed payload rejected safely;
5. inbox write failure does not falsely ack;
6. processor retry is idempotent;
7. ambiguous Account mapping -> review;
8. provider secret never appears in logs;
9. oversized body rejected;
10. provider event cannot invoke arbitrary URL/code;
11. suppression/unsubscribe event cancels conflicting pending outreach;
12. processing backlog visible in health UI.

---

# 17. RELEASE ORDER

V1:

1. Cal.com adapter + signed fixture tests;
2. public webhook route/gateway;
3. durable inbox;
4. Cal.com lifecycle processor;
5. health panel;
6. Smartlead adapter later using same ingress architecture.

Do not build a generic plugin marketplace before current providers need it.

---

# 18. CORE RULE

**Expose the smallest possible authenticated webhook surface to the internet, durably capture provider events, and reconcile them into one private canonical Account memory. Never expose the CRM just because a SaaS provider needs a callback URL.**
