import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { recordDisposition } from '../src/domain/activities.js';
import { claimAccount } from '../src/domain/ownership.js';
import {
  bookStrategyCall, getAvailability, setCalendarAdapter, currentCalendarAdapter,
} from '../src/booking/service.js';
import {
  computeFreeSlots, selectOfferedSlots, describeSlot, zonedParts, zonedTimeToUtc, DEFAULT_POLICY,
} from '../src/booking/policy.js';
import { microsoftGraphAdapter } from '../src/booking/graphAdapter.js';
import type { CalendarAdapter, CreateEventResult, TimeSlot } from '../src/booking/types.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Booking behaviour.
 * Authority: CLAUDE-CURRENT-TASK.md §T7 and the §8 hard constraints —
 * check availability first, offer only real slots, prefer same-day when one truly
 * exists, and never claim a booking is confirmed until the provider says so.
 */

const TZ = 'America/New_York';

/** A controllable stand-in for Outlook. */
function fakeAdapter(options: {
  configured?: boolean;
  busy?: TimeSlot[];
  busyFails?: boolean;
  createResult?: CreateEventResult;
  onCreate?: (key: string) => void;
} = {}): CalendarAdapter {
  return {
    name: 'fake_calendar',
    isConfigured: () => options.configured !== false,
    async getBusy() {
      if (options.busyFails) {
        return { ok: false, busy: [], error: 'calendar unreachable', errorCode: 'PROVIDER_ERROR' as const };
      }
      return { ok: true, busy: options.busy ?? [] };
    },
    async createEvent(request) {
      options.onCreate?.(request.idempotencyKey);
      return options.createResult ?? { ok: true, providerEventId: 'evt-123', webLink: 'https://outlook.example/evt-123' };
    },
  };
}

/** A Tuesday at 08:00 New York, so "later today" is always genuinely possible. */
function tuesdayMorning(): Date {
  return zonedTimeToUtc(2026, 9, 8, 8, 0, TZ);
}

before(async () => { await resetDatabase(); });
after(async () => { setCalendarAdapter(microsoftGraphAdapter); await pool.end(); });
beforeEach(async () => { await resetDatabase(); setCalendarAdapter(fakeAdapter()); });

async function seedAccount(): Promise<string> {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Northgate Air & Heating', website: 'https://northgate.example.com',
      phone: '904-555-0100', city: 'Jacksonville', state: 'FL',
    }, { discoverySource: 'test' }),
  );
  return accountId;
}

// --- slot policy -------------------------------------------------------------

test('timezone conversion round-trips across a DST boundary', () => {
  // 2026-03-08 is the US spring-forward date.
  const beforeDst = zonedTimeToUtc(2026, 3, 7, 10, 0, TZ);
  const afterDst = zonedTimeToUtc(2026, 3, 9, 10, 0, TZ);
  assert.equal(zonedParts(beforeDst, TZ).hour, 10);
  assert.equal(zonedParts(afterDst, TZ).hour, 10);
  // 10:00 local on both days, but 47 hours apart because an hour disappeared.
  assert.equal((afterDst.getTime() - beforeDst.getTime()) / 3_600_000, 47);
});

test('slots fall inside working hours on business days only', () => {
  const now = tuesdayMorning();
  const slots = computeFreeSlots(now, [], DEFAULT_POLICY);
  assert.ok(slots.length > 0);
  for (const slot of slots) {
    const parts = zonedParts(slot.start, TZ);
    assert.ok(DEFAULT_POLICY.businessDays.includes(parts.weekday), 'weekends are never offered');
    assert.ok(parts.hour >= DEFAULT_POLICY.workdayStartHour);
    const endParts = zonedParts(slot.end, TZ);
    assert.ok(endParts.hour < DEFAULT_POLICY.workdayEndHour
      || (endParts.hour === DEFAULT_POLICY.workdayEndHour && endParts.minute === 0));
  }
});

test('a busy calendar removes the colliding slots, buffer included', () => {
  const now = tuesdayMorning();
  const blocked: TimeSlot[] = [{
    start: zonedTimeToUtc(2026, 9, 8, 10, 0, TZ),
    end: zonedTimeToUtc(2026, 9, 8, 11, 0, TZ),
  }];
  const free = computeFreeSlots(now, blocked, DEFAULT_POLICY);
  const collides = free.some((slot) =>
    slot.start < blocked[0]!.end && blocked[0]!.start < slot.end);
  assert.equal(collides, false, 'no offered slot overlaps a meeting');

  // The buffer also protects the ten minutes either side.
  const tooClose = free.some((slot) =>
    Math.abs(slot.start.getTime() - blocked[0]!.end.getTime()) < DEFAULT_POLICY.bufferMinutes * 60_000
    && slot.start.getTime() >= blocked[0]!.end.getTime());
  assert.equal(tooClose, false);
});

test('same-day is preferred when a suitable slot genuinely exists', () => {
  const now = tuesdayMorning();
  const free = computeFreeSlots(now, [], DEFAULT_POLICY);
  const { slots, sameDay } = selectOfferedSlots(now, free, DEFAULT_POLICY, 2);
  assert.equal(sameDay, true);
  assert.equal(slots.length, 2);
  const today = zonedParts(now, TZ);
  for (const slot of slots) {
    assert.equal(zonedParts(slot.start, TZ).day, today.day);
  }
  assert.ok(slots[1]!.start.getTime() - slots[0]!.start.getTime() >= 90 * 60_000,
    'the two offers are far enough apart to be a real choice');
});

test('a full day falls back to the next business day, not a scattered week', () => {
  // Block all of Tuesday.
  const now = tuesdayMorning();
  const allDay: TimeSlot[] = [{
    start: zonedTimeToUtc(2026, 9, 8, 8, 0, TZ),
    end: zonedTimeToUtc(2026, 9, 8, 18, 0, TZ),
  }];
  const free = computeFreeSlots(now, allDay, DEFAULT_POLICY);
  const { slots, sameDay } = selectOfferedSlots(now, free, DEFAULT_POLICY, 2);
  assert.equal(sameDay, false);
  assert.equal(slots.length, 2);
  const day = zonedParts(slots[0]!.start, TZ);
  assert.equal(zonedParts(slots[1]!.start, TZ).day, day.day, 'both offers are on the same next day');
  assert.equal(day.day, 9, 'and that day is the next business day');
});

test('a slot too soon to be actionable is never offered', () => {
  const now = zonedTimeToUtc(2026, 9, 8, 16, 45, TZ);   // late Tuesday afternoon
  const free = computeFreeSlots(now, [], DEFAULT_POLICY);
  for (const slot of free) {
    assert.ok(slot.start.getTime() - now.getTime() >= DEFAULT_POLICY.minimumLeadMinutes * 60_000);
  }
});

test('slots are described the way a person would say them', () => {
  const now = tuesdayMorning();
  assert.match(
    describeSlot({ start: zonedTimeToUtc(2026, 9, 8, 14, 30, TZ), end: now }, now, TZ),
    /^today at 2:30 PM$/,
  );
  assert.match(
    describeSlot({ start: zonedTimeToUtc(2026, 9, 9, 10, 0, TZ), end: now }, now, TZ),
    /^tomorrow at 10:00 AM$/,
  );
  assert.match(
    describeSlot({ start: zonedTimeToUtc(2026, 9, 11, 10, 0, TZ), end: now }, now, TZ),
    /^Friday at 10:00 AM$/,
  );
});

// --- availability ------------------------------------------------------------

test('an unreadable calendar offers nothing and says so honestly', async () => {
  setCalendarAdapter(fakeAdapter({ busyFails: true }));
  const offer = await getAvailability({ now: tuesdayMorning() });
  assert.equal(offer.slots.length, 0, 'an unreadable calendar is not an empty calendar');
  assert.equal(offer.reason, 'CALENDAR_UNREADABLE');
  assert.ok(offer.message.length > 0, 'the caller is given honest words to say');
  assert.doesNotMatch(offer.message, /confirmed|booked/i);
});

test('an unconfigured provider offers nothing rather than guessing', async () => {
  setCalendarAdapter(fakeAdapter({ configured: false }));
  const offer = await getAvailability({ now: tuesdayMorning() });
  assert.equal(offer.slots.length, 0);
  assert.equal(offer.reason, 'NOT_CONFIGURED');
  assert.ok(offer.message.length > 0);
});

test('the real Graph adapter reports NOT_CONFIGURED without credentials', async () => {
  // No MS_GRAPH_* variables are set in this environment.
  assert.equal(microsoftGraphAdapter.isConfigured(), false);
  const busy = await microsoftGraphAdapter.getBusy({
    calendarUpn: 'michael@youraidepartment.ai', from: new Date(), to: new Date(),
    durationMinutes: 20, timezone: TZ,
  });
  assert.equal(busy.ok, false);
  assert.equal(busy.errorCode, 'NOT_CONFIGURED');

  const created = await microsoftGraphAdapter.createEvent({
    calendarUpn: 'michael@youraidepartment.ai', subject: 's', body: 'b',
    start: new Date(), end: new Date(), timezone: TZ, idempotencyKey: 'k',
  });
  assert.equal(created.ok, false);
  assert.equal(created.errorCode, 'NOT_CONFIGURED');
});

// --- booking -----------------------------------------------------------------

test('no calendar event is created before the prospect agrees', async () => {
  const accountId = await seedAccount();
  let created = false;
  setCalendarAdapter(fakeAdapter({ onCreate: () => { created = true; } }));

  const result = await bookStrategyCall({
    accountId, start: new Date(Date.now() + 86_400_000), end: new Date(Date.now() + 87_600_000),
    prospectAgreed: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_AGREED');
  assert.equal(created, false, 'the provider was never called');
  assert.equal(result.spokenConfirmation, '', 'and nothing may be said about it');

  const { rows } = await query('select count(*)::int as n from meeting_bookings');
  assert.equal(rows[0]!.n, 0);
});

test('a confirmed booking requires a provider event id, and writes the timeline', async () => {
  const rep = await makeUser('Rep A');
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);

  const start = new Date(Date.now() + 86_400_000);
  const end = new Date(start.getTime() + 20 * 60_000);
  const result = await bookStrategyCall({
    accountId, ownerUserId: rep.userId, start, end, prospectAgreed: true,
    attendeeName: 'Dana Fielder', attendeeEmail: 'dana@northgate.example.com',
    attendeePhone: '904-555-0100', prospectTimezone: TZ,
    agendaNote: 'After-hours calls go to voicemail during summer peak.',
    createdBy: rep.userId,
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerEventId, 'evt-123');
  assert.match(result.spokenConfirmation, /confirmed/i);
  assert.match(result.spokenConfirmation, /dana@northgate\.example\.com/);

  const booking = await query<{ status: string; provider_event_id: string; confirmed_at: Date; activity_id: number }>(
    'select status, provider_event_id, confirmed_at, activity_id from meeting_bookings where booking_id = $1',
    [result.bookingId],
  );
  assert.equal(booking.rows[0]!.status, 'CONFIRMED');
  assert.ok(booking.rows[0]!.confirmed_at);
  assert.ok(booking.rows[0]!.activity_id, 'the booking is linked to its timeline entry');

  const account = await query<{ relationship_state: string }>(
    'select relationship_state from accounts where account_id = $1', [accountId],
  );
  assert.equal(account.rows[0]!.relationship_state, 'MEETING_SCHEDULED');

  const activity = await query<{ activity_type: string; payload: any }>(
    `select activity_type, payload from activities where account_id = $1 and activity_type = 'MEETING_SCHEDULED'`,
    [accountId],
  );
  assert.equal(activity.rows[0]!.payload.provider_event_id, 'evt-123');
});

test('a provider failure is never spoken as a confirmed booking', async () => {
  const rep = await makeUser('Rep A');
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  setCalendarAdapter(fakeAdapter({
    createResult: { ok: false, error: 'mailbox unavailable', errorCode: 'PROVIDER_ERROR' },
  }));

  const start = new Date(Date.now() + 86_400_000);
  const result = await bookStrategyCall({
    accountId, ownerUserId: rep.userId, start, end: new Date(start.getTime() + 1_200_000),
    prospectAgreed: true, attendeeEmail: 'dana@northgate.example.com',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PROVIDER_FAILED');
  // The exact words the caller may say must not imply success.
  assert.match(result.spokenConfirmation, /tentative/i);
  assert.doesNotMatch(result.spokenConfirmation, /you're confirmed|you are confirmed|all set/i);

  const booking = await query<{ status: string; failure_reason: string }>(
    'select status, failure_reason from meeting_bookings where booking_id = $1', [result.bookingId],
  );
  assert.equal(booking.rows[0]!.status, 'FAILED');
  assert.match(booking.rows[0]!.failure_reason, /mailbox unavailable/);

  // A human is left holding it.
  assert.ok(result.followUpId, 'a recovery follow-up was created');
  const followUp = await query<{ followup_type: string; owner_user_id: string; context: string }>(
    'select followup_type, owner_user_id, context from follow_ups where followup_id = $1', [result.followUpId],
  );
  assert.equal(followUp.rows[0]!.followup_type, 'BOOKING_RECOVERY');
  assert.equal(followUp.rows[0]!.owner_user_id, rep.userId);
  assert.match(followUp.rows[0]!.context, /tentative/i);
});

test('a 2xx with no event id is not a confirmed booking', async () => {
  await makeUser('Manager', 'SALES_MANAGER');
  const accountId = await seedAccount();
  setCalendarAdapter(fakeAdapter({ createResult: { ok: true } as CreateEventResult }));

  const start = new Date(Date.now() + 86_400_000);
  const result = await bookStrategyCall({
    accountId, start, end: new Date(start.getTime() + 1_200_000), prospectAgreed: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PROVIDER_FAILED');
  assert.match(result.spokenConfirmation, /tentative/i);
});

test('the database itself refuses a CONFIRMED booking without provider proof', async () => {
  const accountId = await seedAccount();
  await assert.rejects(
    () => query(
      `insert into meeting_bookings (account_id, calendar_upn, idempotency_key, requested_start,
                                     requested_end, status)
       values ($1, 'michael@youraidepartment.ai', 'forged', now(), now() + interval '20 minutes', 'CONFIRMED')`,
      [accountId],
    ),
    /meeting_bookings_confirmation_requires_provider/,
    'the schema is the last line of defence against a manufactured confirmation',
  );
});

test('booking twice creates one calendar event, not two', async () => {
  const accountId = await seedAccount();
  const keys: string[] = [];
  setCalendarAdapter(fakeAdapter({ onCreate: (key) => keys.push(key) }));

  const start = new Date(Date.now() + 86_400_000);
  const end = new Date(start.getTime() + 1_200_000);
  const first = await bookStrategyCall({ accountId, start, end, prospectAgreed: true });
  const second = await bookStrategyCall({ accountId, start, end, prospectAgreed: true });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.reason, 'ALREADY_BOOKED');
  assert.equal(second.bookingId, first.bookingId);
  assert.equal(keys.length, 1, 'the provider was called exactly once');

  const { rows } = await query('select count(*)::int as n from meeting_bookings');
  assert.equal(rows[0]!.n, 1);
});

test('a slot taken between the offer and the booking is refused', async () => {
  const accountId = await seedAccount();
  const start = new Date(Date.now() + 86_400_000);
  const end = new Date(start.getTime() + 1_200_000);
  let created = false;
  setCalendarAdapter(fakeAdapter({
    busy: [{ start, end }],
    onCreate: () => { created = true; },
  }));

  const result = await bookStrategyCall({ accountId, start, end, prospectAgreed: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_LONGER_FREE');
  assert.equal(created, false, 'a double booking is never created');
  assert.match(result.spokenConfirmation, /just got taken/i);
});

test('a suppressed account can never be booked', async () => {
  const rep = await makeUser('Rep A');
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', notes: 'remove us' }, rep);

  const start = new Date(Date.now() + 86_400_000);
  const result = await bookStrategyCall({
    accountId, start, end: new Date(start.getTime() + 1_200_000), prospectAgreed: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ACCOUNT_SUPPRESSED');
  const { rows } = await query('select count(*)::int as n from meeting_bookings');
  assert.equal(rows[0]!.n, 0);
});

test('an unconfigured provider still leaves a human follow-up', async () => {
  await makeUser('Manager', 'SALES_MANAGER');
  const accountId = await seedAccount();
  setCalendarAdapter(fakeAdapter({ configured: false }));

  const start = new Date(Date.now() + 86_400_000);
  const result = await bookStrategyCall({
    accountId, start, end: new Date(start.getTime() + 1_200_000), prospectAgreed: true,
    attendeeName: 'Dana Fielder',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_CONFIGURED');
  assert.match(result.spokenConfirmation, /tentative/i);
  assert.ok(result.followUpId, 'the prospect is not simply forgotten');
});

test('a tampered slot token is refused', async () => {
  const accountId = await seedAccount();
  const start = new Date(Date.now() + 86_400_000);
  const result = await bookStrategyCall({
    accountId, start, end: new Date(start.getTime() + 1_200_000),
    prospectAgreed: true, slotToken: 'not-the-real-token',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SLOT_EXPIRED');
});

test('the production adapter is Microsoft Graph', () => {
  setCalendarAdapter(microsoftGraphAdapter);
  assert.equal(currentCalendarAdapter().name, 'microsoft_graph');
});

// --- Cal.com is the booking authority ----------------------------------------

test('Cal.com is the default provider, and Graph is not also used', async () => {
  const { calDotComAdapter } = await import('../src/booking/calcomAdapter.js');
  // The service picks Cal.com unless BOOKING_PROVIDER explicitly says otherwise.
  setCalendarAdapter(calDotComAdapter);
  assert.equal(currentCalendarAdapter().name, 'calcom');

  // Without credentials it reports NOT_CONFIGURED rather than failing open.
  assert.equal(calDotComAdapter.isConfigured(), false);
  const busy = await calDotComAdapter.getBusy({
    calendarUpn: 'michael@youraidepartment.ai', from: new Date(), to: new Date(),
    durationMinutes: 15, timezone: TZ,
  });
  assert.equal(busy.ok, false);
  assert.equal(busy.errorCode, 'NOT_CONFIGURED');
});

test('Cal.com refuses to book without an attendee email', async () => {
  const { calDotComAdapter } = await import('../src/booking/calcomAdapter.js');
  const result = await calDotComAdapter.createEvent({
    calendarUpn: 'michael@youraidepartment.ai', subject: 's', body: 'b',
    start: new Date(), end: new Date(), timezone: TZ, idempotencyKey: 'k',
    attendeeEmail: null,
  });
  assert.equal(result.ok, false);
  // A meeting nobody was invited to is not a booking.
  assert.match(result.error ?? '', /attendee email|not configured/i);
});

test('only one provider creates the event for a booking', async () => {
  // The spec forbids creating both a Cal.com booking and a direct Outlook event.
  // The service holds exactly one adapter, so this is structural.
  const created: string[] = [];
  const counting = (name: string): CalendarAdapter => ({
    name,
    isConfigured: () => true,
    async getBusy() { return { ok: true, busy: [] }; },
    async createEvent() { created.push(name); return { ok: true, providerEventId: `${name}-1` }; },
  });

  setCalendarAdapter(counting('calcom'));
  const accountId = await seedAccount();
  const start = new Date(Date.now() + 86_400_000);
  const result = await bookStrategyCall({
    accountId, start, end: new Date(start.getTime() + 900_000), prospectAgreed: true,
    attendeeEmail: 'dana@northgate.example.com',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(created, ['calcom'], 'exactly one provider created the event');
});
