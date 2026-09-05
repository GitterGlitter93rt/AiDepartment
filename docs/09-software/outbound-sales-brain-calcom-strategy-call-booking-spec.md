# Your AI Department — Cal.com Strategy Call Booking Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Define the booking flow used by human reps and the outbound Sales AI to convert a qualified cold conversation into a 15-minute strategy call with Michael without requiring a separate paid video-conferencing subscription.

---

# 1. PRODUCT DECISION

Use **Cal.com as the scheduling authority** for the initial YAD outbound-sales booking flow.

Use **Cal Video** as the default meeting location for the 15-minute strategy call.

Connect Cal.com to Michael's Microsoft 365 / Outlook calendar:

`michael@youraidepartment.ai`

Canonical booking flow:

`Prospect agrees to next step`
-> `YAD checks Cal.com availability`
-> `offer real candidate slots`
-> `prospect chooses`
-> `YAD books through Cal.com`
-> `Cal.com writes/syncs event to Outlook`
-> `Cal Video meeting link generated`
-> `prospect receives invite/reminders`
-> `booking written to canonical YAD Account/Opportunity/timeline`.

Do not create a second Outlook event directly when Cal.com is the booking authority. That risks duplicates and inconsistent rescheduling/cancellation state.

---

# 2. CURRENT EVENT TYPE

Initial event type:

**YAD 15-Minute AI Strategy Call**

Recommended configuration:

- duration: 15 minutes;
- host: Michael Chanata;
- host calendar: `michael@youraidepartment.ai`;
- meeting location: Cal Video;
- timezone: detected/prospect-confirmed;
- minimum notice: configurable;
- buffer before: configurable, initial recommendation 5 minutes;
- buffer after: configurable, initial recommendation 5 minutes;
- same-day booking: enabled when availability and minimum-notice rules permit;
- next-business-day availability: preferred fallback;
- booking window: configurable;
- cancellation/reschedule: enabled through Cal.com where appropriate.

Do not hard-code working hours in the voice prompt. Cal.com/connected calendar availability is authoritative.

---

# 3. WHY CAL.COM IS THE BOOKING AUTHORITY

The booking layer should solve:

- real calendar availability;
- timezone handling;
- booking creation;
- attendee invite;
- reminders/workflows;
- reschedule/cancellation;
- meeting-location creation;
- calendar synchronization;
- booking IDs/status.

The AI should not recreate these functions conversationally.

Provider adapters remain replaceable, but current implementation targets Cal.com.

---

# 4. VIDEO PROVIDER

Default meeting location:

`Cal Video`

This avoids requiring YAD to purchase Zoom solely for 15-minute strategy calls.

The event should contain one obvious join link.

Do not expose several competing meeting links in the invitation.

Zoom, Microsoft Teams, Google Meet, or another provider can be added later without changing the canonical Booking object.

---

# 5. AVAILABILITY TOOL

Typed action:

`check_strategy_call_availability`

Inputs:

- booking target/event type ID;
- requested date/range;
- prospect timezone;
- account/contact ID;
- call/session ID optional.

Output:

- provider: `cal_com`;
- event type ID;
- candidate slots[];
- start/end;
- timezone;
- freshness/retrieved timestamp;
- provider request/reference;
- status.

The AI may only offer slots returned by the availability tool.

Availability is not a reservation.

---

# 6. SAME-DAY SLOT POLICY

The Sales AI should prefer converting interest while it is fresh.

Default selection order:

1. practical same-day slot when available;
2. next-business-day slot;
3. next suitable slot within configured booking horizon.

Do not offer a same-day slot that violates minimum notice or creates an impractical transition for Michael/prospect.

When multiple slots are available, offer two choices instead of reading a long calendar list.

Example:

> I can get you with Michael today at 3:30 or tomorrow at 10:15. Which is easier?

Only say this after those slots are returned by Cal.com.

---

# 7. BOOKING TOOL

Typed action:

`book_strategy_call`

Required inputs:

- account ID;
- contact ID if known;
- prospect name;
- prospect email;
- prospect phone optional according to event form/policy;
- selected slot;
- timezone;
- event type ID;
- source: AI call / human rep / email / portal;
- source call/session ID optional;
- idempotency key;
- context summary safe for calendar notes.

Preconditions:

- prospect explicitly agreed to the meeting;
- selected slot was returned from recent availability check;
- required attendee fields present;
- event type configured;
- Account not suppressed from the relevant action;
- booking provider healthy.

Success result:

- status `confirmed`;
- Cal.com booking ID/reference;
- start/end/timezone;
- Cal Video join details where safe;
- attendee/invite state;
- calendar sync reference where available.

The agent may only say the meeting is booked after status is `confirmed`.

---

# 8. BOOKING FAILURE

If the chosen slot disappears or provider fails:

Agent should say something like:

> That slot didn't confirm on my side. Let me give you another time instead.

Then either:

- refresh availability and offer another real slot; or
- capture preferred time and create a human follow-up.

Never claim a meeting is confirmed because the model attempted the tool.

---

# 9. REQUIRED PROSPECT DATA

Try to obtain only what is needed to book and follow up:

- name;
- business/company association;
- email;
- timezone if not safely derived/confirmed;
- phone already known from call context where appropriate.

Do not interrogate the prospect for redundant information already known with sufficient confidence.

Before booking, confirm email naturally if there is any uncertainty.

---

# 10. EVENT TITLE / CONTENT

Recommended title:

`Your AI Department — 15-Minute Strategy Call — <Company>`

Calendar body can contain:

- prospect name/company;
- high-level problem discussed;
- source campaign;
- YAD Account ID/internal reference only if it does not confuse external attendee;
- brief preparation note for Michael;
- meeting link generated by Cal.com.

Do not put private research logs, unsupported claims, internal scores, DNC state, or sensitive notes in attendee-visible calendar content.

If Cal.com supports internal-only metadata, store IDs there instead.

---

# 11. PRE-MEETING BRIEF FOR MICHAEL

A booked meeting should create an internal Meeting Brief linked to the Account:

- company;
- contact/person/title confidence;
- vertical;
- observed ad/service context;
- primary opportunity hypothesis;
- what the prospect actually said;
- any numbers prospect supplied;
- current systems they mentioned;
- objection/concern;
- meeting objective;
- recommended first 3 strategy-call questions;
- source call/transcript reference;
- CallPack/decision trace ID.

Michael should not need to research the company from scratch before the 15-minute call.

---

# 12. REMINDERS / ALERTS

Use Cal.com booking notifications/workflows for attendee confirmation/reminders where available/configured.

Email confirmation should be the minimum.

SMS reminders may be enabled only after YAD confirms current provider cost/configuration and has an appropriate phone/contact basis; do not assume unlimited free SMS merely because the scheduling product supports SMS notifications.

The YAD Account timeline should also receive:

- booking created;
- rescheduled;
- cancelled;
- completed/no-show where detectable or manually recorded.

---

# 13. NO-SHOW FOLLOW-UP

If the prospect does not attend:

- record no-show only when supported by meeting/provider/human confirmation;
- create a follow-up task for Account owner;
- do not immediately restart generic cold outreach;
- send/reschedule only through approved follow-up policy.

---

# 14. RESCHEDULING / CANCELLATION

Cal.com should remain the source of truth for booking lifecycle where it created the booking.

YAD stores provider IDs and mirrors current state.

Do not create a second new event when the existing booking can be rescheduled through the provider.

---

# 15. API / CREDENTIAL BOUNDARY

Cal.com API/auth credentials remain server-side on the EdgeXpert/control API or approved secure backend.

Never put booking API credentials in:

- browser JavaScript;
- CallPack;
- model prompt;
- transcript;
- Git repository.

The realtime Sales AI calls a YAD typed booking tool; it does not receive raw provider credentials.

---

# 16. PROVIDER-NEUTRAL CANONICAL OBJECT

```text
Booking
- booking_id
- account_id
- contact_id optional
- provider: cal_com
- provider_booking_id
- event_type_id
- host_user_id
- start_at
- end_at
- timezone
- meeting_location_type
- meeting_join_url optional
- attendee_email
- source_channel
- source_session_id optional
- status
- created_at
- updated_at
- idempotency_key
```

Do not make the canonical Account schema depend on Cal.com-native field names.

---

# 17. HUMAN REP USE

The same booking engine should be usable from the rep portal.

On Account Detail:

`[ Book 15-Min Strategy Call ]`

Flow:

- read actual availability;
- choose slot;
- confirm prospect email;
- create booking;
- update Account automatically.

This keeps human and AI-created meetings in the same system.

---

# 18. AI CALL CLOSE

When a problem is real:

> Based on what you just told me, I think it's worth putting you together with Michael for 15 minutes rather than trying to diagnose the whole thing on a cold call. Want me to see what he has open?

If yes, check Cal.com.

Then:

> I've got today at 3:30 or tomorrow at 10:15. Which works better?

After selection and confirmed booking:

> Perfect — you're set for 3:30 today with Michael. The invite and meeting link are going to the email you gave me.

Do not use those times unless returned by the booking provider.

---

# 19. ACCEPTANCE TESTS

1. Outlook calendar has a busy block -> Cal.com does not offer conflicting slot.
2. Same-day slot exists -> agent may offer it.
3. No same-day slot -> next-business-day offered.
4. Prospect chooses slot -> booking creates one Cal.com event, not duplicate Outlook + Cal.com events.
5. Cal.com success -> Account timeline and Booking record updated.
6. Provider failure -> agent does not claim confirmation.
7. Two simultaneous prospects select same final slot -> second gets refresh/alternate, not duplicate booking.
8. Cal Video link generated -> invite contains usable meeting location.
9. Human rep books from portal -> same canonical Booking lifecycle.
10. Reschedule -> existing provider booking updated/mirrored rather than duplicate created.

---

# 20. CORE RULE

**Cal.com owns scheduling; Outlook owns Michael's real calendar; Cal Video owns the initial video meeting. YAD owns the Account, context, qualification and booking history.**
