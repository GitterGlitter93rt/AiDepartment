# CLAUDE CODE — CAL.COM BOOKING MIGRATION CURRENT

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Status:** Current booking implementation delta  
**Architecture owner:** ChatGPT

The implementation log records Gate T7 as a provider-neutral booking core plus Microsoft Graph adapter tested against a fake calendar. That work is reusable, but the product decision changed afterward.

## CURRENT AUTHORITY

- Cal.com is the scheduling authority.
- Michael's Microsoft 365 / Outlook calendar remains the calendar Cal.com checks/syncs.
- Cal Video is the default meeting location.
- Event type: `YAD 15-Minute AI Strategy Call`.
- Do not create a second direct Outlook event when Cal.com owns the booking.

The old Azure app-registration blocker is therefore **not the primary booking blocker for V1**. Keep the Graph adapter as a future/alternate provider adapter; do not delete proven code merely because the current provider changed.

---

# 1. CURRENT CAL.COM API TARGET

Use Cal.com API v2, not deprecated v1.

Implementation should use server-side credentials only.

Expected capability surface:

- retrieve event type / configuration as needed;
- query provider-returned slots for the configured event type/date range/timezone;
- create booking after prospect agreement;
- retrieve booking result/status;
- reschedule/cancel where supported by current workflow;
- consume booking webhooks for external changes/status reconciliation;
- preserve provider UID/reference in canonical `meeting_bookings`.

Do not hard-code API version/header values in the LLM prompt. Keep provider headers/version in the adapter configuration/code.

---

# 2. ADAPTER INTERFACE

The existing provider-neutral booking service should remain the business interface.

Add current adapter concept:

`CalComBookingAdapter`

Methods:

- `health()`
- `getEventType()` or configuration validation
- `findAvailableSlots(input)`
- `createBooking(input, idempotencyKey)`
- `getBooking(providerUid)`
- `rescheduleBooking(providerUid, input, idempotencyKey)` where supported
- `cancelBooking(providerUid, reason, idempotencyKey)`

The Sales AI/action layer continues calling provider-neutral actions such as:

- `check_strategy_call_availability`
- `book_strategy_call`

The LLM must not know Cal.com endpoint details.

---

# 3. REQUIRED CONFIGURATION

Server-side configuration should support:

- CALCOM_API_KEY / approved server credential
- CALCOM_EVENT_TYPE_ID or canonical event-type lookup reference
- CALCOM_API_BASE_URL defaulting to official API host
- CALCOM_WEBHOOK_SECRET where current webhook verification supports it
- CALCOM_DEFAULT_TIMEZONE fallback only; prospect/calendar timezone remains authoritative
- booking minimum-notice/buffer rules primarily controlled by Cal.com event configuration

Never expose API key in browser HTML/JS/log output.

---

# 4. SLOT FLOW

1. Sales AI reaches `BOOK_NOW`.
2. Prospect agrees to scheduling.
3. Action layer requests availability for appropriate date range/timezone.
4. Cal.com adapter returns real slots only.
5. Agent offers at most two slots per turn.
6. Prospect chooses.
7. Required attendee fields are captured/confirmed.
8. Booking action calls Cal.com.
9. Only a confirmed provider result writes canonical confirmed booking / speaks confirmation.

If provider fails or result is ambiguous:

- do not say booked;
- store desired slot/request;
- create human follow-up;
- allow reconciliation by provider UID/idempotency record before retry.

---

# 5. IDEMPOTENCY / DUPLICATE PROTECTION

Use internal idempotency record keyed from at least:

- account/contact
- event type
- selected slot
- call/session/action request

Before retry after timeout/5xx:

- check internal prior action state;
- query provider by known UID/reference if available;
- never blindly POST a second booking when outcome is ambiguous.

The database invariant that a confirmed booking requires provider proof remains valid.

---

# 6. WEBHOOK RECONCILIATION

Use Cal.com booking webhooks to reconcile changes made outside YAD where practical:

- booking created/confirmed
- rescheduled
- cancelled
- other relevant booking status events

Webhook processing:

- verify authenticity according to current Cal.com mechanism;
- dedupe event delivery;
- resolve booking by provider UID;
- update canonical booking status/times;
- append Account timeline event;
- adjust follow-up/reminder state;
- never reset Account to cold prospect on cancellation.

---

# 7. OUTLOOK / CALENDAR ROLE

Michael should connect `michael@youraidepartment.ai` to Cal.com through the Cal.com product UI.

Cal.com then owns:

- availability conflict checking from connected calendar(s);
- attendee invite/calendar synchronization;
- Cal Video meeting link;
- configured reminders/workflows.

YAD does not need Microsoft Graph application credentials merely to duplicate this flow.

Keep the existing Graph adapter behind provider-neutral interface for future direct-calendar needs, but it is not the V1 default.

---

# 8. TESTS

Add tests for:

1. adapter not configured -> explicit NOT_CONFIGURED, no fake slots;
2. slot query returns provider slots normalized to canonical time model;
3. no slots -> clean empty result;
4. create booking confirmed -> canonical booking confirmed with provider UID;
5. create booking timeout/ambiguous -> not confirmed, no duplicate on retry;
6. provider 5xx -> human fallback path;
7. reschedule -> same relationship/booking lineage preserved;
8. cancel -> cold cadence does not automatically restart;
9. webhook duplicate -> idempotent processing;
10. webhook reschedule/cancel -> Account timeline + booking state update;
11. API key never returned through portal/client response;
12. fake Cal.com adapter permits deterministic test suite before real credential is supplied.

---

# 9. SETTINGS UI

`Settings -> Calendar / Cal.com` should show:

- Connection: configured / not configured / degraded
- Event Type: YAD 15-Minute AI Strategy Call
- Connected calendar label when known
- Meeting location: Cal Video
- Last health check
- `Test Availability` admin action

Never display the API key after entry.

---

# 10. CURRENT BLOCKER

To connect the real provider, Michael/admin needs to supply/configure:

1. a Cal.com account;
2. `michael@youraidepartment.ai` Outlook calendar connected in Cal.com;
3. the 15-minute event type configured with Cal Video;
4. a current server API key/approved credential;
5. the event type identifier/reference used by the adapter.

Everything else can be implemented and tested with a fake adapter before those values exist.

---

# 11. CORE RULE

**Cal.com owns scheduling; Outlook supplies calendar availability through Cal.com; YAD owns the sales relationship and canonical booking record; the AI only says booked after provider confirmation.**
