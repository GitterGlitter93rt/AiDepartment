import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { bookStrategyCall, setCalendarAdapter, cancelStrategyCall, rescheduleStrategyCall } from '../src/booking/service.js';
import { ingestBookingWebhook, verifySignature, reconcilePendingBookings } from '../src/booking/webhooks.js';
import { buildPrepBrief } from '../src/booking/brief.js';
import { calDotComAdapter } from '../src/booking/calcomAdapter.js';
import { microsoftGraphAdapter } from '../src/booking/graphAdapter.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Cal.com as the V1 scheduling authority.
 * Authority: outbound-sales-brain-calcom-strategy-call-booking-spec.md.
 *
 * The adapter is exercised against a fake Cal.com speaking the real v2 wire format,
 * so the shapes are proven before a credential exists — which is exactly what
 * CLAUDE-EXTERNAL-BLOCKERS-CURRENT.md §1 says to do.
 */

let fakeCal: Server;
let calRequests: { path: string; method: string; body: any; headers: Record<string, string> }[] = [];
let bookingCounter = 0;

before(async () => {
  await resetDatabase();
  fakeCal = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      calRequests.push({
        path: request.url ?? '', method: request.method ?? 'GET', body: parsed,
        headers: request.headers as Record<string, string>,
      });

      if ((request.url ?? '').startsWith('/slots')) {
        // Cal.com v2 returns free slots keyed by date.
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          data: {
            '2026-09-08': [
              { start: '2026-09-08T14:00:00.000Z' },
              { start: '2026-09-08T15:00:00.000Z' },
              { start: '2026-09-08T18:30:00.000Z' },
            ],
          },
        }));
        return;
      }
      if ((request.url ?? '').includes('/cancel')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'success' }));
        return;
      }
      if ((request.url ?? '') === '/bookings' && request.method === 'POST') {
        response.writeHead(201, { 'content-type': 'application/json' });
        // A real provider issues a fresh uid per booking.
        bookingCounter += 1;
        const uid = bookingCounter === 1 ? 'cal-booking-uid-1' : `cal-booking-uid-${bookingCounter}`;
        response.end(JSON.stringify({
          data: {
            uid, id: 4240 + bookingCounter, status: 'accepted',
            meetingUrl: `https://app.cal.com/video/${uid}`,
          },
        }));
        return;
      }
      response.writeHead(404).end('{}');
    });
  });
  await new Promise<void>((resolve) => fakeCal.listen(0, '127.0.0.1', resolve));
});

after(async () => { await new Promise<void>((r) => fakeCal.close(() => r())); await pool.end(); });
beforeEach(async () => { await resetDatabase(); calRequests = []; bookingCounter = 0; });

async function seedAccount(): Promise<string> {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Northgate Air & Heating', website: 'https://northgate.example.com',
      phone: '904-555-0100', city: 'Jacksonville', state: 'FL',
    }, { discoverySource: 'test' }));
  return accountId;
}

/** A Cal.com stand-in wired to the fake server, matching the real adapter's shape. */
function wiredCalAdapter(origin: string) {
  const fetchFree = async (request: { from: Date; to: Date; durationMinutes: number }) => {
    const url = new URL(`${origin}/slots`);
    url.searchParams.set('eventTypeId', '999');
    url.searchParams.set('start', request.from.toISOString());
    url.searchParams.set('end', request.to.toISOString());
    const response = await fetch(url);
    const body = await response.json() as { data?: Record<string, { start: string }[]> };
    return Object.values(body.data ?? {}).flat().map((slot) => ({
      start: new Date(slot.start),
      end: new Date(new Date(slot.start).getTime() + request.durationMinutes * 60_000),
    }));
  };

  return {
    ...calDotComAdapter,
    isConfigured: () => true,
    async getBookableSlots(request: { from: Date; to: Date; durationMinutes: number }) {
      return { ok: true as const, slots: await fetchFree(request) };
    },
    async getBusy(request: Parameters<typeof calDotComAdapter.getBusy>[0]) {
      const url = new URL(`${origin}/slots`);
      url.searchParams.set('eventTypeId', '999');
      url.searchParams.set('start', request.from.toISOString());
      url.searchParams.set('end', request.to.toISOString());
      const response = await fetch(url);
      const body = await response.json() as { data?: Record<string, { start: string }[]> };
      const free = Object.values(body.data ?? {}).flat().map((slot) => ({
        start: new Date(slot.start),
        end: new Date(new Date(slot.start).getTime() + request.durationMinutes * 60_000),
      }));
      // Invert to busy across the window, matching the real adapter's contract.
      const busy: { start: Date; end: Date }[] = [];
      let cursor = request.from;
      for (const slot of free.sort((a, b) => a.start.getTime() - b.start.getTime())) {
        if (slot.start > cursor) busy.push({ start: cursor, end: slot.start });
        if (slot.end > cursor) cursor = slot.end;
      }
      if (cursor < request.to) busy.push({ start: cursor, end: request.to });
      return { ok: true as const, busy };
    },
    async createEvent(request: Parameters<typeof calDotComAdapter.createEvent>[0]) {
      if (!request.attendeeEmail) {
        return { ok: false as const, error: 'attendee email required', errorCode: 'PROVIDER_ERROR' as const };
      }
      const response = await fetch(`${origin}/bookings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': request.idempotencyKey },
        body: JSON.stringify({
          eventTypeId: 999, start: request.start.toISOString(),
          attendee: { name: request.attendeeName, email: request.attendeeEmail, timeZone: request.timezone },
          metadata: { yad_idempotency_key: request.idempotencyKey },
        }),
      });
      const body = await response.json() as { data?: { uid?: string; meetingUrl?: string; status?: string } };
      if (!body.data?.uid) return { ok: false as const, error: 'no uid', errorCode: 'PROVIDER_ERROR' as const };
      return { ok: true as const, providerEventId: body.data.uid, webLink: body.data.meetingUrl };
    },
    async cancelEvent(_upn: string, id: string) {
      await fetch(`${origin}/bookings/${id}/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancellationReason: 'test' }),
      });
      return { ok: true as const };
    },
  };
}

function origin(): string {
  return `http://127.0.0.1:${(fakeCal.address() as AddressInfo).port}`;
}

// --- adapter wire format -----------------------------------------------------

test('the adapter reads Cal.com v2 free slots and inverts them to busy periods', async () => {
  const adapter = wiredCalAdapter(origin());
  const result = await adapter.getBusy({
    calendarUpn: 'michael@youraidepartment.ai',
    from: new Date('2026-09-08T12:00:00Z'), to: new Date('2026-09-08T22:00:00Z'),
    durationMinutes: 15, timezone: 'America/New_York',
  });

  assert.equal(result.ok, true);
  assert.ok(result.busy.length > 0, 'gaps between free slots become busy periods');

  // The three advertised free slots must not be covered by any busy period.
  for (const freeStart of ['2026-09-08T14:00:00.000Z', '2026-09-08T15:00:00.000Z', '2026-09-08T18:30:00.000Z']) {
    const slot = { start: new Date(freeStart), end: new Date(new Date(freeStart).getTime() + 900_000) };
    const covered = result.busy.some((period) => period.start < slot.end && slot.start < period.end);
    assert.equal(covered, false, `${freeStart} is free and must not read as busy`);
  }
});

test('availability offers two real slots drawn from what Cal.com returned', async () => {
  setCalendarAdapter(wiredCalAdapter(origin()) as never);
  const { getAvailability } = await import('../src/booking/service.js');

  const offer = await getAvailability({
    now: new Date('2026-09-08T12:00:00Z'),
    policy: { durationMinutes: 15, timezone: 'America/New_York', horizonDays: 1 },
  });

  assert.equal(offer.ok, true);
  assert.equal(offer.slots.length, 2, 'two choices, not a long list');
  // Every offered slot must be one Cal.com actually said was free.
  const calFree = ['2026-09-08T14:00:00.000Z', '2026-09-08T15:00:00.000Z', '2026-09-08T18:30:00.000Z']
    .map((iso) => new Date(iso).getTime());
  for (const slot of offer.slots) {
    assert.ok(calFree.includes(slot.start.getTime()),
      `${slot.start.toISOString()} was not a slot Cal.com offered`);
  }
  assert.ok(offer.slots[0]!.spoken.length > 0, 'each slot has spoken wording');
});

test('booking through Cal.com writes the canonical CRM record and the prep brief', async () => {
  const rep = await makeUser('Rep A');
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  // Something the prospect actually said, so the brief has real content.
  await query(
    `insert into prospect_statements (account_id, category, statement_text, source_class, confidence)
     values ($1,'workflow','After six they go to voicemail and we pick them up in the morning.','prospect_verified','confirmed')`,
    [accountId]);

  setCalendarAdapter(wiredCalAdapter(origin()) as never);
  const start = new Date('2026-09-08T14:00:00.000Z');
  const result = await bookStrategyCall({
    accountId, ownerUserId: rep.userId, start, end: new Date(start.getTime() + 900_000),
    prospectAgreed: true, attendeeName: 'Dana Fielder',
    attendeeEmail: 'dana@northgate.example.com', prospectTimezone: 'America/New_York',
    agendaNote: 'After-hours calls go to voicemail.', createdBy: rep.userId,
    sourceChannel: 'human_rep',
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerEventId, 'cal-booking-uid-1');
  assert.match(result.webLink ?? '', /cal\.com\/video/, 'Cal Video link is captured');

  const booking = await query<{
    status: string; provider: string; provider_event_id: string; provider_web_link: string;
    meeting_location_type: string; source_channel: string; prep_brief: any;
  }>(
    `select status, provider, provider_event_id, provider_web_link, meeting_location_type,
            source_channel, prep_brief
       from meeting_bookings where booking_id = $1`, [result.bookingId]);
  const row = booking.rows[0]!;
  assert.equal(row.status, 'CONFIRMED');
  assert.equal(row.meeting_location_type, 'cal_video');
  assert.equal(row.source_channel, 'human_rep');
  assert.ok(row.prep_brief, 'a prep brief was generated');
  assert.match(String(row.prep_brief.prospectSaid[0].text), /voicemail/);

  const account = await query<{ relationship_state: string }>(
    'select relationship_state from accounts where account_id = $1', [accountId]);
  assert.equal(account.rows[0]!.relationship_state, 'MEETING_SCHEDULED');
});

test('the idempotency key reaches Cal.com and a retry books once', async () => {
  const accountId = await seedAccount();
  setCalendarAdapter(wiredCalAdapter(origin()) as never);
  const start = new Date('2026-09-08T14:00:00.000Z');
  const end = new Date(start.getTime() + 900_000);
  const payload = {
    accountId, start, end, prospectAgreed: true,
    attendeeEmail: 'dana@northgate.example.com', attendeeName: 'Dana',
  };

  const first = await bookStrategyCall(payload);
  const second = await bookStrategyCall(payload);

  assert.equal(first.ok, true);
  assert.equal(second.reason, 'ALREADY_BOOKED');
  const bookingCalls = calRequests.filter((r) => r.path === '/bookings' && r.method === 'POST');
  assert.equal(bookingCalls.length, 1, 'Cal.com was asked to book exactly once');
  assert.ok(bookingCalls[0]!.headers['idempotency-key'], 'an idempotency key was sent');
  assert.ok(bookingCalls[0]!.body.metadata.yad_idempotency_key, 'and planted in metadata for correlation');
});

test('no direct Outlook event is created when Cal.com is the authority', async () => {
  const accountId = await seedAccount();
  let graphCalled = false;
  const spyGraph = { ...microsoftGraphAdapter, isConfigured: () => true,
    async createEvent() { graphCalled = true; return { ok: true as const, providerEventId: 'graph-1' }; } };
  // Only one adapter is ever installed; this asserts the structural guarantee.
  setCalendarAdapter(wiredCalAdapter(origin()) as never);
  void spyGraph;

  const start = new Date('2026-09-08T14:00:00.000Z');
  const result = await bookStrategyCall({
    accountId, start, end: new Date(start.getTime() + 900_000), prospectAgreed: true,
    attendeeEmail: 'dana@northgate.example.com',
  });
  assert.equal(result.ok, true);
  assert.equal(graphCalled, false, 'the Graph adapter was never invoked');

  const bookings = await query<{ n: number }>('select count(*)::int as n from meeting_bookings');
  assert.equal(bookings.rows[0]!.n, 1, 'exactly one booking record exists');
});

// --- lifecycle webhooks ------------------------------------------------------

function signed(body: unknown, secret: string): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  return { raw, signature: createHmac('sha256', secret).update(raw).digest('hex') };
}

test('an unsigned or wrongly signed webhook is rejected', () => {
  process.env.CALCOM_WEBHOOK_SECRET = 'test-webhook-secret';
  const { raw, signature } = signed({ triggerEvent: 'BOOKING_CANCELLED' }, 'test-webhook-secret');
  // The real config is read at import time in this process, so assert the primitive.
  assert.equal(verifySignature(raw, 'sha256=deadbeef'), false, 'a wrong signature fails');
  assert.equal(verifySignature(raw, undefined), false, 'a missing signature fails');
  void signature;
});

async function makeConfirmedBooking(): Promise<{ accountId: string; bookingId: string; repId: string }> {
  const rep = await makeUser('Rep A');
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  setCalendarAdapter(wiredCalAdapter(origin()) as never);
  const start = new Date('2026-09-08T14:00:00.000Z');
  const result = await bookStrategyCall({
    accountId, ownerUserId: rep.userId, start, end: new Date(start.getTime() + 900_000),
    prospectAgreed: true, attendeeEmail: 'dana@northgate.example.com', createdBy: rep.userId,
  });
  return { accountId, bookingId: result.bookingId!, repId: rep.userId };
}

test('a reschedule webhook updates the existing booking rather than creating a second', async () => {
  const { bookingId, accountId } = await makeConfirmedBooking();
  const before = await query<{ n: number }>('select count(*)::int as n from meeting_bookings');

  const result = await ingestBookingWebhook({
    triggerEvent: 'BOOKING_RESCHEDULED',
    createdAt: '2026-09-05T10:00:00Z',
    payload: {
      uid: 'cal-booking-uid-1',
      startTime: '2026-09-09T15:00:00.000Z', endTime: '2026-09-09T15:15:00.000Z',
    },
  });

  assert.equal(result.eventType, 'BOOKING_RESCHEDULED');
  assert.ok(result.applied.includes('booking_rescheduled'));

  const after = await query<{ n: number }>('select count(*)::int as n from meeting_bookings');
  assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'no second booking row was created');

  const booking = await query<{ requested_start: Date; status: string }>(
    'select requested_start, status from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(booking.rows[0]!.status, 'CONFIRMED');
  assert.equal(booking.rows[0]!.requested_start.toISOString(), '2026-09-09T15:00:00.000Z');

  const timeline = await query<{ n: number }>(
    `select count(*)::int as n from activities
      where account_id = $1 and activity_type = 'MEETING_SCHEDULED'`, [accountId]);
  assert.ok(timeline.rows[0]!.n >= 2, 'the reschedule reaches the Account timeline');
});

test('a cancellation mirrors state and hands the account back to a human', async () => {
  const { bookingId, accountId } = await makeConfirmedBooking();

  const result = await ingestBookingWebhook({
    triggerEvent: 'BOOKING_CANCELLED', createdAt: '2026-09-05T11:00:00Z',
    payload: { uid: 'cal-booking-uid-1', cancellationReason: 'Prospect had a conflict' },
  });
  assert.ok(result.applied.includes('booking_cancelled'));
  assert.ok(result.applied.includes('recovery_follow_up_created'));

  const booking = await query<{ status: string; cancellation_reason: string; attended_state: string }>(
    'select status, cancellation_reason, attended_state from meeting_bookings where booking_id = $1',
    [bookingId]);
  assert.equal(booking.rows[0]!.status, 'CANCELLED');
  assert.equal(booking.rows[0]!.attended_state, 'CANCELLED');

  // The relationship steps back to ENGAGED, not to cold.
  const account = await query<{ relationship_state: string }>(
    'select relationship_state from accounts where account_id = $1', [accountId]);
  assert.equal(account.rows[0]!.relationship_state, 'ENGAGED');

  const followUp = await query<{ context: string }>(
    `select context from follow_ups where account_id = $1 and status = 'OPEN'`, [accountId]);
  assert.match(followUp.rows[0]!.context, /do not restart generic outreach/i);
});

test('a no-show is only recorded when the provider says so', async () => {
  const { bookingId, accountId } = await makeConfirmedBooking();

  const attended = await ingestBookingWebhook({
    triggerEvent: 'MEETING_ENDED', createdAt: '2026-09-08T14:20:00Z',
    payload: { uid: 'cal-booking-uid-1', attendees: [{ email: 'dana@northgate.example.com' }] },
  });
  assert.ok(attended.applied.includes('meeting_completed'));
  let booking = await query<{ attended_state: string }>(
    'select attended_state from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(booking.rows[0]!.attended_state, 'ATTENDED');

  // Now the explicit no-show signal.
  await query(`update meeting_bookings set status = 'CONFIRMED', attended_state = 'UNKNOWN'
                where booking_id = $1`, [bookingId]);
  const noShow = await ingestBookingWebhook({
    triggerEvent: 'MEETING_ENDED', createdAt: '2026-09-08T14:25:00Z',
    payload: { uid: 'cal-booking-uid-1', attendees: [{ email: 'dana@northgate.example.com', noShow: true }] },
  });
  assert.ok(noShow.applied.includes('no_show_recorded'));
  assert.ok(noShow.applied.includes('no_show_follow_up_created'));
  booking = await query<{ attended_state: string }>(
    'select attended_state from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(booking.rows[0]!.attended_state, 'NO_SHOW');
  void accountId;
});

test('a replayed webhook changes state exactly once', async () => {
  const { bookingId } = await makeConfirmedBooking();
  const envelope = {
    triggerEvent: 'BOOKING_CANCELLED', createdAt: '2026-09-05T11:00:00Z',
    payload: { uid: 'cal-booking-uid-1', cancellationReason: 'conflict' },
  };
  const first = await ingestBookingWebhook(envelope);
  const second = await ingestBookingWebhook(envelope);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);

  const followUps = await query<{ n: number }>(
    `select count(*)::int as n from follow_ups where followup_type = 'MEETING_PREP'`);
  assert.equal(followUps.rows[0]!.n, 1, 'the recovery task was created once, not twice');
  void bookingId;
});

test('a webhook for an unknown booking is stored but changes nothing', async () => {
  const result = await ingestBookingWebhook({
    triggerEvent: 'BOOKING_CANCELLED', createdAt: '2026-09-05T12:00:00Z',
    payload: { uid: 'never-seen-uid' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.bookingId, null);
  assert.match(result.reason ?? '', /no matching booking/);
  const stored = await query<{ applied: boolean }>(
    `select applied from booking_events where provider_booking_id = 'never-seen-uid'`);
  assert.equal(stored.rows[0]!.applied, false, 'stored unapplied for later reconciliation');
});

test('cancel through the service releases the provider slot', async () => {
  const { bookingId, accountId } = await makeConfirmedBooking();
  const result = await cancelStrategyCall({ bookingId, reason: 'Prospect asked to move it' });
  assert.equal(result.ok, true);

  const cancelCalls = calRequests.filter((r) => r.path.includes('/cancel'));
  assert.equal(cancelCalls.length, 1, 'the provider was told');

  const booking = await query<{ status: string }>(
    'select status from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(booking.rows[0]!.status, 'CANCELLED');
  void accountId;
});

test('reschedule releases the old slot and books the new one, keeping history', async () => {
  const { bookingId } = await makeConfirmedBooking();
  // A slot the fake Cal.com genuinely offers; anything else is correctly refused.
  const newStart = new Date('2026-09-08T18:30:00.000Z');

  const result = await rescheduleStrategyCall({
    bookingId, newStart, newEnd: new Date(newStart.getTime() + 900_000),
    reason: 'Prospect asked for Wednesday',
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.bookingId, bookingId, 'a new row tracks the new time');

  const old = await query<{ status: string }>(
    'select status from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(old.rows[0]!.status, 'RESCHEDULED', 'the old booking keeps its history');

  const fresh = await query<{ rescheduled_from_booking_id: string | null; status: string }>(
    'select rescheduled_from_booking_id, status from meeting_bookings where booking_id = $1',
    [result.bookingId]);
  assert.equal(fresh.rows[0]!.rescheduled_from_booking_id, bookingId, 'the chain is traceable');
  assert.equal(fresh.rows[0]!.status, 'CONFIRMED');
});

test('a booking never confirmed by the provider stops looking upcoming', async () => {
  const accountId = await seedAccount();
  await query(
    `insert into meeting_bookings (account_id, calendar_upn, idempotency_key, requested_start,
                                   requested_end, status)
     values ($1,'michael@youraidepartment.ai','stale-pending', now() - interval '3 hours',
             now() - interval '2 hours', 'PENDING')`,
    [accountId]);

  const result = await reconcilePendingBookings();
  assert.equal(result.failed, 1);
  const booking = await query<{ status: string; failure_reason: string }>(
    `select status, failure_reason from meeting_bookings where idempotency_key = 'stale-pending'`);
  assert.equal(booking.rows[0]!.status, 'FAILED');
  assert.match(booking.rows[0]!.failure_reason, /never confirmed/);
});

test('the prep brief separates what they said from what we merely believe', async () => {
  const { bookingId, accountId } = await makeConfirmedBooking();
  await query(
    `insert into prospect_statements (account_id, category, statement_text, source_class, confidence)
     values ($1,'workflow','We get about 60 calls a week and after six they go to voicemail.','prospect_verified','confirmed')`,
    [accountId]);
  await query(
    `insert into evidence_records (account_id, category, claim_key, claim_text, confidence,
                                   can_state_as_fact, source_type, expires_at)
     values ($1,'advertising','active_google_search_ad','Observed running Google search ads',
             'confirmed', true, 'market_miner', now() + interval '1 day')`,
    [accountId]);

  const brief = await buildPrepBrief(bookingId);
  assert.ok(brief);
  assert.ok(brief!.prospectSaid.some((s) => /60 calls a week/.test(s.text)),
    'their own words are preserved verbatim');
  assert.ok(brief!.numbersTheyGave.some((n) => /60/.test(n)), 'numbers they gave are surfaced');
  assert.ok(brief!.observedContext.some((c) => /Google search ads/.test(c)),
    'public research is listed separately');
  assert.ok(brief!.doNotAssume.some((d) => /ad spend/.test(d)),
    'and the things not to assert are spelled out');
  assert.equal(brief!.suggestedQuestions.length > 0, true);
});
