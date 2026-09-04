# Your AI Department — Strategy Call Reminder & No-Show Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Preserve conversion after the Sales AI books a 15-minute strategy call by using Cal.com for scheduling/reminders while keeping YAD's canonical Account/Opportunity state accurate.

---

# 1. PRINCIPLE

A booked meeting is not the end of the outbound workflow.

The system should maximize the probability that the qualified prospect actually reaches Michael without creating duplicate reminders, duplicate calendar events, or contradictory outreach.

Current authority:

- scheduling authority: Cal.com;
- connected host calendar: `michael@youraidepartment.ai`;
- meeting location: Cal Video;
- event: `YAD 15-Minute AI Strategy Call`.

YAD stores meeting state and context. Cal.com owns booking/reschedule/cancellation mechanics and configured reminder workflows.

---

# 2. BOOKED STATE

When Cal.com confirms a booking, YAD creates/updates canonical meeting state:

- account_id;
- contact_id;
- booking_provider = `cal_com`;
- provider_booking_id;
- event_type_id;
- start/end;
- timezone;
- attendee name/email/phone where legitimately captured;
- Cal Video/join metadata according to retention policy;
- source call ID;
- source campaign;
- booked_by = Sales AI / human rep;
- booking confirmed timestamp;
- relationship owner;
- prep brief status.

Immediately transition the Account out of generic cold cadence.

---

# 3. REMINDER AUTHORITY

Prefer Cal.com reminder/workflow capability for attendee-facing meeting reminders.

Do not have YAD independently send duplicate reminder messages by default.

If YAD later adds its own reminder channel, it must be explicitly configured as complementary and deduplicated against Cal.com workflows.

Never send SMS solely because a phone number exists; channel permission/policy remains separate.

---

# 4. INITIAL REMINDER STRATEGY

Recommended initial configuration to test in Cal.com:

- immediate booking confirmation/invite;
- one reminder sufficiently before the meeting to be useful;
- optional shorter reminder close to the meeting if Cal.com configuration and prospect experience justify it.

Exact reminder timing should be configuration, not hard-coded into the Sales AI prompt.

Do not overwhelm a prospect who booked a 15-minute call with multiple marketing touches.

---

# 5. SAME-DAY BOOKINGS

Same-day bookings are valuable because intent is fresh.

If meeting is booked soon enough that one of the standard reminders would be nonsensical or duplicate the booking confirmation:

- let Cal.com workflow rules suppress/adjust the reminder where possible;
- do not manufacture a YAD reminder simply to satisfy a generic cadence.

The initial invite itself may be sufficient for a meeting happening shortly.

---

# 6. MICHAEL PREP BRIEF

Every confirmed meeting triggers generation/update of:

`StrategyCallPrepBrief`

Use:

`outbound-sales-brain-strategy-call-prep-brief-spec.md`

The brief must be available before meeting start and contain:

- why YAD called;
- prospect's current workflow in their own words;
- supported pain/opportunity;
- numbers/systems actually stated;
- objections/concerns;
- decision-maker/authority context;
- what remains unknown;
- best questions for Michael;
- claims Michael must not assume;
- recording/transcript references if retained/authorized.

Do not make Michael repeat the cold-call discovery from zero.

---

# 7. RESCHEDULE

When prospect reschedules through Cal.com:

- provider booking event updates canonical meeting state;
- prior scheduled occurrence is marked superseded/rescheduled, not deleted from history;
- cold cadence remains paused;
- prep brief carries forward unless new conversation materially changes it;
- callbacks/tasks tied to old time are canceled/replaced.

Do not create a second Opportunity solely because the meeting moved.

---

# 8. CANCELLATION

When prospect cancels:

Store:

- canceled_at;
- cancel source/provider;
- reason if legitimately supplied;
- whether reschedule requested/offered;
- relationship owner.

Do not automatically put the Account back into an aggressive cold cadence.

Next state should be determined by:

- explicit prospect request;
- prior qualification strength;
- reason/timing if known;
- approved follow-up policy.

Possible next states:

- waiting_for_reschedule;
- human_followup;
- future_callback;
- opportunity_paused;
- closed_no_current_interest;
- DNC if requested.

---

# 9. NO-SHOW DETECTION

A no-show is not inferred merely because no one clicked a link at an arbitrary timestamp unless the provider data supports that conclusion.

Preferred sources:

- Cal.com/meeting provider attendance status where available;
- Michael/rep manual disposition;
- explicit prospect message.

Canonical state:

- `scheduled`;
- `completed`;
- `canceled`;
- `rescheduled`;
- `no_show_confirmed`;
- `attendance_unknown`.

Unknown is not automatically no-show.

---

# 10. NO-SHOW RECOVERY

For a genuinely qualified prospect with confirmed no-show:

Default recovery is **one concise human-owned or approved automated reschedule touch**, not restarting cold prospecting from scratch.

Example intent:

> Hey John — looks like we missed each other for the 15-minute strategy call today. No problem. If you still want to look at the estimate-follow-up workflow we discussed, here's the reschedule option.

The message should reference the actual agreed topic, not generic AI services.

If there is no response after approved recovery, relationship state follows company cadence/nurture policy.

Do not repeatedly chase a no-show indefinitely.

---

# 11. PROSPECT ASKS TO RESCHEDULE DURING A CALL

If prospect calls YAD and asks to move the meeting:

- load existing booking;
- use Cal.com reschedule flow/provider action;
- do not create an unrelated second booking if provider supports reschedule;
- confirm only after provider confirms.

---

# 12. MEETING COMPLETED

Once Michael completes the strategy call:

- cold cadence remains permanently exited for that campaign;
- relationship transitions according to meeting outcome;
- store strategy-call outcome;
- create next agreed action only;
- proposal/Executive AI Strategy/implementation discussion follows current commercial authority.

Possible outcome categories:

- no_current_need;
- measurement_first;
- technical_review;
- second_strategy_meeting;
- executive_ai_strategy_candidate;
- implementation_candidate;
- growth_system_candidate;
- managed_ai_department_future;
- future_timing;
- disqualified.

Do not automatically create a paid opportunity simply because the meeting occurred.

---

# 13. CALENDAR EVENT CONTENT

The calendar invite should be useful but concise.

Recommended event context:

- `YAD 15-Minute AI Strategy Call — [Company]` where configuration permits;
- Cal Video link;
- one-sentence purpose derived from confirmed topic;
- reschedule/cancel controls supplied by Cal.com.

Do not insert speculative revenue leaks, sensitive notes, or internal prospect scoring into the attendee-facing calendar description.

Internal prep data stays in YAD.

---

# 14. METRICS

Track:

- qualified calls -> bookings;
- bookings -> attended;
- same-day booking attendance;
- next-day booking attendance;
- cancellation rate;
- reschedule rate;
- confirmed no-show rate;
- no-show recovery -> rebook;
- meeting -> next qualified stage.

Do not optimize booking count while ignoring attendance and meeting quality.

---

# 15. ACCEPTANCE FIXTURES

## A — same-day booking

Prospect books 3 hours out.

Expected:

- one Cal.com booking;
- Outlook sync via Cal.com;
- Cal Video link;
- cold cadence canceled;
- sensible reminder behavior;
- Michael prep brief generated.

## B — reschedule

Prospect moves tomorrow 10:30 to Friday 2:00.

Expected:

- same relationship/opportunity;
- old occurrence superseded;
- no duplicate active meeting;
- prep context retained.

## C — cancel with no reschedule

Expected:

- no automatic generic cold sequence restart;
- relationship owner receives appropriate state/task.

## D — attendance unknown

No provider attendance signal.

Expected:

- do not label confirmed no-show automatically.

## E — confirmed no-show

Michael marks no-show.

Expected:

- one approved reschedule recovery path;
- no generic cold script restart.

## F — meeting completed

Expected:

- cold campaign remains exited;
- next action follows actual strategy-call disposition.

---

# 16. CORE RULE

**The metric that matters after booking is not calendar volume. It is qualified prospects who actually reach Michael and advance through an honest next step.**
