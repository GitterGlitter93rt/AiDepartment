# Your AI Department — Cal.com V2 Implementation Research

**Status:** Supporting implementation authority for current Cal.com adapter  
**Date:** 2026-09-03  
**Purpose:** Capture current Cal.com API/webhook behavior that materially affects YAD booking, state reconciliation and deployment.

---

# 1. OFFICIAL SOURCES REVIEWED

Current Cal.com documentation reviewed:

- `https://cal.com/docs/api-reference/v2/bookings/create-a-booking`
- `https://cal.com/docs/api-reference/v2/bookings/reschedule-a-booking`
- `https://cal.com/docs/api-reference/v2/bookings/request-to-reschedule-a-booking`
- `https://cal.com/docs/api-reference/v2/webhooks/create-a-webhook`
- `https://cal.com/docs/developing/guides/automation/webhooks`
- `https://cal.com/help/webhooks`

Use current official API docs as runtime authority if endpoint versions change.

---

# 2. API VERSION PINNING

Current Cal.com v2 booking documentation requires a `cal-api-version` header and currently documents:

`2026-02-25`

YAD implementation should:

- configure API version explicitly;
- not rely silently on Cal.com's fallback/default older version;
- record provider API version with booking adapter version;
- fail clearly if configured version is rejected rather than silently changing semantics.

Do not hard-code the value in conversational prompts.

---

# 3. CREATE BOOKING

Current v2 create-booking endpoint:

`POST /v2/bookings`

Important implementation details from current docs:

- booking start is submitted in ISO 8601 UTC;
- event can be identified using event type ID or supported slug/username combination;
- authentication may use supported Cal.com API/OAuth token mechanisms;
- response/provider booking UID becomes canonical external reference.

YAD action flow remains:

`check availability -> prospect selects recent real slot -> create booking -> verify provider success -> persist confirmed booking -> tell prospect confirmed`.

Never speak confirmation before provider confirmation.

---

# 4. RESCHEDULE / REQUEST RESCHEDULE

Cal.com provides booking reschedule functionality and a separate request-reschedule flow.

YAD should distinguish:

## Direct reschedule

Used only when YAD is intentionally moving a current booking to another confirmed slot with appropriate prospect agreement.

## Request reschedule

Can be used when the attendee should receive the provider's reschedule experience rather than YAD choosing a new slot on their behalf.

Do not implement `cancel old + create unrelated new` as the default if Cal.com's native reschedule semantics are available, because that loses provider relationship/attribution and can create duplicate state.

Persist:

- old booking UID;
- new/rescheduled UID where provider returns one;
- rescheduled-from/to relationship;
- reason;
- event timestamps;
- provider status.

---

# 5. WEBHOOKS ARE REQUIRED FOR DURABLE STATE SYNC

Outbound API calls alone are not sufficient for a durable CRM.

A prospect or host may later:

- reschedule through Cal.com;
- cancel;
- be marked no-show;
- complete the meeting;
- trigger meeting-start/meeting-end events.

YAD should subscribe to relevant webhook events so canonical Meeting state follows provider truth.

Current Cal.com webhook documentation includes triggers around:

- booking created;
- booking rescheduled;
- booking cancelled;
- booking requested/confirmed/rejected where applicable;
- booking no-show updates;
- meeting started;
- meeting ended;
- Cal Video host/guest no-show events in supported webhook scopes.

Only subscribe to events YAD actually processes.

---

# 6. PUBLIC HTTPS WEBHOOK INGRESS — IMPORTANT

Current Cal.com SaaS webhook documentation states subscriber URLs must be HTTPS and rejects private/internal IP destinations such as:

- `127.0.0.1`;
- `10.x.x.x`;
- `192.168.x.x`;
- localhost.

This matters because the EdgeXpert sales portal may initially be tailnet/private only.

Therefore YAD needs one of these architectures.

## Preferred V1

Narrow public HTTPS webhook ingress:

`Cal.com -> public HTTPS webhook endpoint -> signature/secret verification -> durable event inbox -> canonical sales DB`

Possible hosting/routing options after Claude audits actual environment:

- Cloudflare Tunnel to one webhook route only;
- existing secure public YAD service/reverse proxy that forwards authenticated webhook traffic;
- voice VPS as a tiny webhook ingress that securely relays to Sales Brain API;
- other approved public edge.

Do not make the entire internal CRM publicly exposed merely to receive Cal.com webhooks.

## Temporary fallback

If public webhook ingress is not ready:

- booking create/availability still works outbound;
- canonical booking remains provider-confirmed at creation;
- run a reconciliation poller for relevant upcoming/recent bookings;
- show `provider sync webhook not active` in manager health;
- do not pretend reschedule/cancel state is realtime.

Polling is a temporary consistency fallback, not the intended long-term provider integration.

---

# 7. WEBHOOK AUTHENTICITY

Cal.com supports a webhook secret/authenticity mechanism according to current docs.

YAD must:

- configure a strong secret;
- validate authenticity before processing payload;
- reject unauthenticated/invalid messages;
- log provider event ID/type/received time without leaking secrets;
- persist raw provider payload only according to retention/security policy;
- map to canonical event using idempotent processing.

A public webhook URL without authenticity validation is a release blocker.

---

# 8. DURABLE WEBHOOK INBOX

Do not perform every side effect synchronously in the HTTP request.

Recommended pattern:

```text
receive webhook
-> authenticate
-> derive provider event identity
-> insert WebhookInbox row if new
-> return success promptly
-> worker reconciles canonical Booking/Meeting state
-> append Account timeline event
-> update follow-up/opportunity workflow if required
```

Suggested fields:

```text
provider
provider_event_id_or_hash
trigger_type
booking_uid
received_at
authenticated
payload_hash
processing_status
processed_at
last_error
attempts
```

Unique provider-event identity/hash prevents duplicate processing.

---

# 9. CANONICAL EVENT MAPPING

Examples:

## BOOKING_CREATED / provider confirmation

- create/update external provider link;
- mark confirmed only with provider proof;
- append Account timeline;
- stop generic cold cadence.

## BOOKING_RESCHEDULED

- preserve previous booking relationship;
- update current meeting start/timezone/provider UID;
- update Account timeline;
- do not create second active meeting accidentally.

## BOOKING_CANCELLED

- mark cancelled;
- do not reset Account to never-contacted;
- create specific follow-up path only if appropriate.

## BOOKING_NO_SHOW / guest no-show

- mark confirmed no-show only when provider event supports it;
- run configured concise reschedule recovery workflow;
- preserve original source/hook attribution.

## MEETING_STARTED / MEETING_ENDED

- useful attendance/review signal;
- do not infer substantive qualification outcome from meeting-start/end alone;
- prompt Michael for StrategyCallOutcome after end.

---

# 10. WEBHOOK / API RACE CONDITIONS

Possible race:

1. YAD creates booking;
2. provider returns success;
3. webhook arrives before/after local write commit.

Implementation should reconcile by provider booking UID rather than assuming event order.

Use idempotent upsert/reconcile logic.

Do not create two canonical meetings because both synchronous response and webhook say `created`.

---

# 11. TIMEZONES

Create-booking request uses UTC start according to current API docs.

YAD must still preserve:

- prospect timezone;
- host timezone context;
- original slot offered;
- UTC canonical timestamp.

Voice presents natural local time; provider gets correct canonical timestamp.

Do not pass naive local time as UTC.

---

# 12. HEALTH CHECKS

Settings/Integrations and Pilot preflight should expose business-safe status:

- Cal.com API configured;
- event type configured;
- availability read healthy;
- create booking healthy;
- webhook subscription active;
- last webhook received;
- webhook authentication healthy;
- reconciliation backlog/error count;
- Cal Video location configured.

Do not expose API token or webhook secret.

---

# 13. TESTS CLAUDE SHOULD ADD

1. availability returns real candidate slots from adapter fixture;
2. create booking stores provider UID and one canonical booking;
3. create API + duplicate BOOKING_CREATED webhook remains one booking;
4. BOOKING_RESCHEDULED updates canonical current meeting and preserves history;
5. BOOKING_CANCELLED exits active meeting state without erasing relationship;
6. no-show webhook creates no-show state once/idempotently;
7. meeting-ended event makes Meeting Outcome review available;
8. invalid webhook secret is rejected;
9. duplicate webhook is harmless;
10. webhook arrives before synchronous local booking write — reconcile correctly;
11. API outage does not cause false verbal confirmation;
12. webhook unavailable mode clearly reports degraded realtime sync.

---

# 14. CURRENT DEPLOYMENT DECISION REQUIRED

Because Cal.com SaaS webhooks need public HTTPS, Claude should not assume tailnet-only `sales.youraidepartment.ai` can receive them.

During implementation audit, recommend the smallest secure public ingress that does **not** expose the internal CRM broadly.

Until then:

- outbound Cal.com API integration may proceed;
- booking tests may proceed;
- webhook ingestion can run locally with signed fixtures;
- reconciliation poller can be implemented/tested;
- manager health must show webhook ingress as not live.

---

# 15. CORE RULE

**Cal.com is the scheduling authority, and YAD must track the entire provider lifecycle — create, reschedule, cancel, no-show and meeting completion — through authenticated, idempotent synchronization rather than treating a successful POST as the end of the booking workflow.**
