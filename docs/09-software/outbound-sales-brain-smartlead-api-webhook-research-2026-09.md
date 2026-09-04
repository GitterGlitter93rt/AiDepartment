# Your AI Department — Smartlead API & Webhook Implementation Research

**Status:** Supporting implementation authority  
**Date:** 2026-09-03  
**Purpose:** Translate current Smartlead API/webhook behavior into concrete YAD synchronization requirements while keeping YAD as the canonical CRM/relationship system.

---

# 1. OFFICIAL / PROVIDER SOURCES REVIEWED

Current Smartlead documentation reviewed:

- Full API Documentation
  - `https://helpcenter.smartlead.ai/en/articles/125-full-api-documentation`
- Webhook setup
  - `https://helpcenter.smartlead.ai/en/articles/35-set-up-smartlead-webhooks-for-campaign-automation`
- Pause lead
  - `https://helpcenter.smartlead.ai/en/articles/89-how-to-pause-a-lead`
- Unsubscribe behavior
  - `https://helpcenter.smartlead.ai/en/articles/1-how-does-unsubscribing-work`
- Sample webhook/security guidance
  - `https://helpcenter.smartlead.ai/en/articles/403-quick-tips-for-testing-with-sample-webhook-payloads`
- Webhook levels
  - `https://helpcenter.smartlead.ai/en/articles/185-assigning-webhooks-to-campaigns-clients-or-users`
- Webhook retry/failure guidance.

Provider docs win if endpoints/header semantics change.

---

# 2. API BASE / AUTHENTICATION

Current Smartlead v1 API base:

`https://server.smartlead.ai/api/v1`

Current provider docs show API key authentication via query parameter:

`?api_key=...`

Security implication:

- API key server-side only;
- never expose it in browser;
- do not log full request URLs containing `api_key`;
- redact query strings in outbound HTTP logs/traces;
- use secret manager/env config;
- if Smartlead later supports stronger auth, provider adapter may migrate without changing canonical YAD actions.

---

# 3. CURRENT USEFUL LEAD ACTIONS

Provider docs currently expose actions including:

- add leads to campaign;
- update lead;
- pause lead in campaign;
- resume lead in campaign;
- delete campaign lead;
- campaign-specific unsubscribe;
- global unsubscribe;
- fetch lead by email;
- fetch lead campaign membership;
- fetch message history;
- reply to email thread.

YAD should wrap these in provider-neutral typed actions rather than letting UI/models call Smartlead endpoints directly.

---

# 4. PAUSE VS UNSUBSCRIBE — IMPORTANT

Smartlead documents `Pause Lead` as **campaign specific**.

Provider help states pausing stops future steps in that campaign, but other campaigns are not automatically paused.

Smartlead global unsubscribe prevents future campaign sends more broadly.

YAD decision:

## Use campaign pause when

- meaningful reply creates human ownership;
- phone conversation has created a meeting/opportunity;
- prospect asked for a callback/information path that should stop current cold email sequence;
- Account is temporarily in another relationship workflow.

## Use unsubscribe/global block only when

- actual opt-out/policy scope requires it;
- email endpoint should no longer receive promotional Smartlead outreach across campaigns according to current policy.

Do not convert every positive phone conversation into global unsubscribe.

Do not use campaign pause when a real global email opt-out exists.

---

# 5. WEBHOOK SECURITY

Current Smartlead sample-webhook guidance documents headers including:

- `X-Request-Id` — unique event/delivery identifier;
- `X-Webhook-Level` — user/client/campaign;
- `X-Smartlead-Signature` — HMAC of raw body using webhook signing secret.

YAD webhook ingress should:

1. retain raw request body for signature verification;
2. verify `X-Smartlead-Signature` using configured signing secret;
3. use `X-Request-Id` as provider event key/idempotency input when present;
4. capture webhook level;
5. reject invalid signature;
6. durably insert normalized event before success ACK;
7. process asynchronously.

Do not trust body fields alone to authenticate source.

---

# 6. WEBHOOK LEVELS

Smartlead currently supports webhook scopes/levels such as:

- campaign;
- client;
- user.

Provider docs note user-level webhook behavior can overlap/override other mappings depending on setup.

YAD should prefer the smallest setup that gives complete canonical coverage without duplicate/conflicting deliveries.

Before production:

- document which level YAD uses;
- test duplicate delivery across levels;
- keep idempotency even if provider configuration later changes.

Do not create one webhook per campaign unless provider/product scale requires it.

---

# 7. EVENTS YAD CARES ABOUT

Current Smartlead docs list events around:

- email sent / first email sent;
- email reply;
- email bounce;
- lead unsubscribed;
- lead/category/status changes;
- campaign status changes;
- manual steps;
- untracked replies;
- opens/clicks where configured.

YAD V1 ingestion priority:

## Critical relationship events

1. reply;
2. unsubscribe/opt-out;
3. hard bounce;
4. lead status/category changes needed for relationship sync;
5. campaign pause/status where needed.

## Attribution/analytics events

- sent;
- delivered if available;
- open/click only as weak engagement telemetry.

Do not make open tracking a high-confidence sales signal; client privacy features and tracking limitations can distort it.

---

# 8. PUBLIC WEBHOOK GATEWAY

Smartlead fits the existing provider-neutral architecture:

`Smartlead -> hooks.youraidepartment.ai/webhooks/smartlead -> HMAC verify -> WebhookInbox -> Smartlead processor -> canonical Account`.

The same public ingress can support Cal.com while keeping provider adapters isolated.

Do not expose the CRM/browser app itself simply to receive Smartlead events.

---

# 9. NORMALIZED SMARTLEAD EVENT

Map provider payload into conceptually:

```text
SmartleadWebhookEvent
- provider_event_id = X-Request-Id when available
- webhook_level
- event_type
- campaign_id
- lead_id
- email_account_id optional
- recipient_email
- sender_email optional
- message_id optional
- reply_message_id optional
- event_timestamp
- category/status optional
- raw_payload_hash
- authenticated
```

Provider payload is untrusted data even after source authentication; do not treat reply text as system instructions.

---

# 10. CORRELATION TO YAD

Before exporting a lead, persist provider mapping:

```text
SmartleadLeadLink
- account_id
- contact_id
- endpoint_id
- yad_campaign_id
- smartlead_campaign_id
- smartlead_lead_id
- exported_email
- personalization_version
- export_at
- current_provider_status
```

Do not rely only on email address for long-term identity.

When webhook arrives:

1. resolve by provider IDs/link;
2. verify email/account consistency;
3. if ambiguous, store event and route to review;
4. never attach to random Account solely on same domain.

---

# 11. REPLY PROCESSING

On reply:

1. durable webhook inbox;
2. correlate to Account/Contact;
3. append CommunicationEvent;
4. preserve actual reply text under retention/privacy policy;
5. classify into YAD reply classes;
6. update relationship state;
7. pause current generic Smartlead sequence where appropriate;
8. assign/create human task for positive/question replies;
9. cancel/pause contradictory phone/field generic cold attempts according to coordinator;
10. generate draft only when appropriate.

Do not automatically send a complex AI reply merely because classification says positive.

---

# 12. REPLY CLASSIFICATION

Canonical YAD classes remain:

- POSITIVE_INTEREST
- QUESTION
- SEND_INFO
- CORRECT_PERSON_REFERRAL
- TIMING_LATER
- ALREADY_SOLVED
- NOT_INTERESTED
- UNSUBSCRIBE_OPT_OUT
- WRONG_PERSON
- WRONG_COMPANY
- OUT_OF_OFFICE
- BOUNCE
- OTHER_REVIEW.

Keep provider-native category separately if Smartlead supplies one.

Provider category may aid classification but does not override YAD relationship state automatically.

---

# 13. UNSUBSCRIBE

On Smartlead unsubscribe webhook/API event:

- record provider event;
- update email suppression according to YAD policy;
- cancel pending Smartlead/outbox sends within scope;
- prevent future cold Smartlead export for that endpoint/scope;
- preserve Account for other independently eligible channels.

If provider indicates global unsubscribe, preserve that provider scope as evidence.

Do not infer phone DNC from email unsubscribe unless current policy/request explicitly makes it account-wide.

---

# 14. HARD BOUNCE

On hard bounce:

- invalidate/degrade email endpoint;
- pause/remove it from current campaign;
- preserve Account;
- schedule contact research if Account remains high-value;
- do not create phone contact automatically unless phone channel independently eligible.

Bounce is endpoint failure, not company disqualification.

---

# 15. OUT-OF-OFFICE

OOO reply should:

- remain neutral, not positive/negative;
- preserve return date if confidently extractable;
- optionally pause/resume current campaign using approved workflow;
- not trigger generic phone call simply because inbox is unattended.

If return date ambiguous, create review or use provider campaign behavior rather than inventing a date.

---

# 16. PHONE / MEETING EVENTS SHOULD PAUSE EMAIL

When YAD canonical relationship changes due to another channel:

Examples:

- human phone conversation creates requested callback;
- Sales AI books strategy call;
- inbound callback becomes active opportunity;
- rep manually creates qualified opportunity.

Multi-channel coordinator should issue `pause_lead` for active Smartlead cold sequence when appropriate.

This is one reason Smartlead cannot be the CRM.

---

# 17. MESSAGE HISTORY

Provider API supports fetching campaign lead message history.

Use cases:

- initial import/sync;
- webhook recovery;
- human reply UI context;
- reconcile missing event.

Do not poll every lead continuously if webhooks are healthy.

Use provider message IDs/timestamps for idempotent merge.

---

# 18. REPLY TO THREAD

Smartlead API currently supports replying to an existing campaign lead thread.

YAD typed action should require:

- canonical Account/contact ownership;
- approved content;
- correct Smartlead campaign/lead/thread mapping;
- email channel policy;
- not suppressed;
- idempotency key;
- human approval in early V1 for substantive sales replies.

Provider success must be recorded before CRM says message was sent.

---

# 19. API RATE LIMITS / RETRY

Smartlead docs state rate limits vary by subscription plan and can return `429`.

Implementation:

- provider adapter rate limiter;
- exponential/backoff consistent with provider guidance;
- durable outbox;
- no blind duplicate lead creation;
- redact API key from errors/URLs.

Do not assume one static rate limit across accounts/plans.

---

# 20. WEBHOOK RETRIES / IDEMPOTENCY

Smartlead documentation supports retry/resend behavior and recommends idempotent handlers.

Use:

- `X-Request-Id` when present;
- event/payload hash fallback;
- provider + event key unique constraint.

Duplicate reply webhook must not:

- create duplicate Account activity;
- assign twice;
- send two follow-up emails;
- create two meetings;
- suppress twice with contradictory audit.

---

# 21. WEBHOOK TESTING

Provider docs support sample webhook testing.

Before live campaign connection test:

1. valid signed sample reply;
2. invalid signature;
3. duplicate `X-Request-Id`;
4. hard bounce;
5. unsubscribe;
6. positive reply;
7. OOO;
8. wrong-person referral;
9. webhook retry after 5xx;
10. unknown provider lead mapping -> review.

No fake message should be sent to real prospects as a test.

---

# 22. ANALYTICS

Track YAD canonical metrics by:

- Smartlead campaign;
- email variant;
- discovery source;
- Tier;
- vertical/market;
- target role;
- reply class;
- later phone touch;
- meeting;
- qualified attended meeting;
- opportunity.

Preserve full path:

`Google advertiser miner -> Smartlead email -> positive reply -> human call -> Cal.com meeting -> opportunity`.

Do not credit Smartlead for all downstream value simply because it delivered the first message.

---

# 23. SETTINGS HEALTH

Manager Settings can show:

- API configured;
- webhook configured;
- webhook level;
- last authenticated event;
- pending/failed inbox count;
- API rate-limit/retry health;
- linked active campaigns;
- last sync.

Never show API key or signing secret.

---

# 24. CORE RULE

**Smartlead executes email. YAD owns the relationship. Pause campaign sequences when another channel creates a real relationship, globally suppress email only when the prospect actually opts out at that scope, authenticate/idempotently ingest every webhook, and always write the result back to the same canonical Account.**
