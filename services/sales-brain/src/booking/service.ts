import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import {
  DEFAULT_POLICY, computeFreeSlots, describeSlot, selectOfferedSlots, type BookingPolicy,
} from './policy.js';
import type { CalendarAdapter, TimeSlot } from './types.js';
import { microsoftGraphAdapter } from './graphAdapter.js';
import { calDotComAdapter } from './calcomAdapter.js';

/**
 * Strategy-call booking.
 * Authority: CLAUDE-CURRENT-TASK.md §T7 and its hard constraints in §8.
 *
 * The single rule everything here serves:
 *
 *     A booking is spoken as confirmed only after the provider confirms creation.
 *
 * So: availability is read before any time is offered, an unreadable calendar
 * produces zero offers rather than a guess, and a failed creation produces a human
 * follow-up plus an explicit "not confirmed" message for the caller to say.
 */

// Cal.com owns the booking lifecycle and syncs to Outlook. Graph remains available
// for a deployment that deliberately opts out, but the two must never both create an
// event for the same meeting.
let adapter: CalendarAdapter =
  config.booking.provider === 'microsoft_graph' ? microsoftGraphAdapter : calDotComAdapter;

/** Swaps the calendar provider. Tests use this; production uses Graph. */
export function setCalendarAdapter(next: CalendarAdapter): void {
  adapter = next;
}
export function currentCalendarAdapter(): CalendarAdapter {
  return adapter;
}

export interface OfferedSlot {
  start: Date;
  end: Date;
  /** How the agent or rep should say it out loud. */
  spoken: string;
  /** Opaque token the caller quotes back when the prospect picks one. */
  token: string;
}

export interface AvailabilityOffer {
  ok: boolean;
  slots: OfferedSlot[];
  sameDay: boolean;
  calendarUpn: string;
  timezone: string;
  /**
   * What to say when no time can be offered. Never empty when `slots` is empty, so
   * a caller always has honest words available.
   */
  message: string;
  reason?: 'NOT_CONFIGURED' | 'CALENDAR_UNREADABLE' | 'NO_AVAILABILITY';
}

function slotToken(start: Date, end: Date): string {
  return createHash('sha256')
    .update(`${start.toISOString()}|${end.toISOString()}|${config.portal.sessionSecret}`)
    .digest('hex').slice(0, 24);
}

/**
 * Reads real availability and returns the times we are willing to offer.
 *
 * If the calendar cannot be read, this returns zero slots with a reason. It never
 * falls back to a default schedule: offering a time we have not verified turns a
 * cold call into a broken promise.
 */
export async function getAvailability(options: {
  calendarUpn?: string;
  policy?: Partial<BookingPolicy>;
  now?: Date;
  count?: number;
} = {}): Promise<AvailabilityOffer> {
  const policy: BookingPolicy = {
    ...DEFAULT_POLICY,
    timezone: config.booking.timezone || DEFAULT_POLICY.timezone,
    ...options.policy,
  };
  const calendarUpn = options.calendarUpn ?? config.booking.calendarUpn;
  const now = options.now ?? new Date();

  if (!adapter.isConfigured()) {
    return {
      ok: false, slots: [], sameDay: false, calendarUpn, timezone: policy.timezone,
      reason: 'NOT_CONFIGURED',
      message: 'I can\'t reach the calendar right now, so I don\'t want to promise you a time. '
        + 'Let me have someone confirm and come straight back to you.',
    };
  }

  const from = now;
  const to = new Date(now.getTime() + policy.horizonDays * 86_400_000);
  const busyResult = await adapter.getBusy({
    calendarUpn, from, to, durationMinutes: policy.durationMinutes, timezone: policy.timezone,
  });

  if (!busyResult.ok) {
    // An unreadable calendar is not an empty calendar.
    return {
      ok: false, slots: [], sameDay: false, calendarUpn, timezone: policy.timezone,
      reason: 'CALENDAR_UNREADABLE',
      message: 'I can\'t see the calendar at the moment, so I don\'t want to give you a time that '
        + 'might not hold. Can I have someone confirm and come back to you?',
    };
  }

  const free = computeFreeSlots(now, busyResult.busy, policy);
  const { slots, sameDay } = selectOfferedSlots(now, free, policy, options.count ?? 2);

  if (slots.length === 0) {
    return {
      ok: true, slots: [], sameDay: false, calendarUpn, timezone: policy.timezone,
      reason: 'NO_AVAILABILITY',
      message: 'The calendar is full for the next few days. Rather than guess, let me get a time '
        + 'confirmed and come back to you.',
    };
  }

  return {
    ok: true,
    sameDay,
    calendarUpn,
    timezone: policy.timezone,
    slots: slots.map((slot) => ({
      start: slot.start,
      end: slot.end,
      spoken: describeSlot(slot, now, policy.timezone),
      token: slotToken(slot.start, slot.end),
    })),
    message: '',
  };
}

export interface BookingRequest {
  accountId: string;
  contactId?: string | null;
  ownerUserId?: string | null;
  start: Date;
  end: Date;
  /** Must match the token issued with the offered slot. */
  slotToken?: string;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  attendeePhone?: string | null;
  prospectTimezone?: string | null;
  agendaNote?: string | null;
  /** Set only when the prospect has actually agreed to this time. */
  prospectAgreed: boolean;
  createdBy?: string | null;
  calendarUpn?: string;
}

export interface BookingResult {
  ok: boolean;
  bookingId?: string;
  providerEventId?: string;
  webLink?: string;
  /** Exactly what the caller may say about this booking. */
  spokenConfirmation: string;
  followUpId?: number;
  reason?: 'NOT_AGREED' | 'SLOT_EXPIRED' | 'NOT_CONFIGURED' | 'ALREADY_BOOKED'
    | 'PROVIDER_FAILED' | 'NO_LONGER_FREE' | 'ACCOUNT_SUPPRESSED';
  error?: string;
}

/**
 * Books the strategy call.
 *
 * Order matters and is deliberate: agreement, then eligibility, then a fresh
 * availability re-check, then the provider call, and only then a database row
 * marked CONFIRMED. The schema independently refuses a CONFIRMED row without a
 * provider event id, so a bug here cannot manufacture a confirmed meeting.
 */
export async function bookStrategyCall(request: BookingRequest): Promise<BookingResult> {
  const calendarUpn = request.calendarUpn ?? config.booking.calendarUpn;

  if (!request.prospectAgreed) {
    return {
      ok: false, reason: 'NOT_AGREED',
      spokenConfirmation: '',
      error: 'A calendar event is never created before the prospect agrees to the time.',
    };
  }

  if (request.slotToken && request.slotToken !== slotToken(request.start, request.end)) {
    return {
      ok: false, reason: 'SLOT_EXPIRED',
      spokenConfirmation: 'That time slipped away while we were talking — let me offer you another.',
      error: 'Slot token does not match the offered slot.',
    };
  }

  const { rows: accountRows } = await query<{ is_suppressed: boolean; canonical_name: string }>(
    'select is_suppressed, canonical_name from accounts where account_id = $1', [request.accountId],
  );
  const account = accountRows[0];
  if (!account) {
    return { ok: false, reason: 'PROVIDER_FAILED', spokenConfirmation: '', error: 'Account not found.' };
  }
  if (account.is_suppressed) {
    return {
      ok: false, reason: 'ACCOUNT_SUPPRESSED', spokenConfirmation: '',
      error: 'This account is suppressed; no meeting may be booked.',
    };
  }

  // One logical booking, one calendar event, even if the caller retries.
  const idempotencyKey = createHash('sha256')
    .update(`${request.accountId}|${request.start.toISOString()}|${calendarUpn}`)
    .digest('hex').slice(0, 40);

  const { rows: existingRows } = await query<{
    booking_id: string; status: string; provider_event_id: string | null; provider_web_link: string | null;
    requested_start: Date;
  }>(
    `select booking_id, status, provider_event_id, provider_web_link, requested_start
       from meeting_bookings where idempotency_key = $1`,
    [idempotencyKey],
  );
  const existing = existingRows[0];
  if (existing && existing.status === 'CONFIRMED') {
    return {
      ok: true, reason: 'ALREADY_BOOKED',
      bookingId: existing.booking_id,
      providerEventId: existing.provider_event_id ?? undefined,
      webLink: existing.provider_web_link ?? undefined,
      spokenConfirmation: `You're already booked in for ${describeSlot(
        { start: existing.requested_start, end: request.end }, new Date(), config.booking.timezone,
      )}.`,
    };
  }

  // Record the intent as PENDING first, so a crash between here and the provider
  // call leaves a visible unresolved booking rather than nothing at all.
  const { rows: pendingRows } = await query<{ booking_id: string }>(
    `insert into meeting_bookings (account_id, contact_id, owner_user_id, calendar_upn, meeting_type,
                                   idempotency_key, requested_start, requested_end, prospect_timezone,
                                   attendee_name, attendee_email, attendee_phone, agenda_note,
                                   status, provider, created_by)
     values ($1,$2,$3,$4,'strategy_call',$5,$6,$7,$8,$9,$10,$11,$12,'PENDING',$13,$14)
     on conflict (idempotency_key) do update set
       attendee_name = coalesce(excluded.attendee_name, meeting_bookings.attendee_name),
       attendee_email = coalesce(excluded.attendee_email, meeting_bookings.attendee_email),
       status = 'PENDING'
     returning booking_id`,
    [
      request.accountId, request.contactId ?? null, request.ownerUserId ?? null, calendarUpn,
      idempotencyKey, request.start, request.end, request.prospectTimezone ?? null,
      request.attendeeName ?? null, request.attendeeEmail ?? null, request.attendeePhone ?? null,
      request.agendaNote ?? null, adapter.name, request.createdBy ?? null,
    ],
  );
  const bookingId = pendingRows[0]!.booking_id;

  if (!adapter.isConfigured()) {
    const followUpId = await recordBookingFailure(
      bookingId, request, 'Calendar provider is not configured', calendarUpn,
    );
    return {
      ok: false, bookingId, followUpId, reason: 'NOT_CONFIGURED',
      spokenConfirmation: 'I have that time noted, but I can\'t confirm it on the calendar from here. '
        + 'Someone will confirm it with you shortly — please treat it as tentative until then.',
      error: 'Calendar provider is not configured.',
    };
  }

  // Re-check availability immediately before creating: the offer may be minutes old.
  const recheck = await adapter.getBusy({
    calendarUpn,
    from: new Date(request.start.getTime() - 60_000),
    to: new Date(request.end.getTime() + 60_000),
    durationMinutes: Math.round((request.end.getTime() - request.start.getTime()) / 60_000),
    timezone: config.booking.timezone,
  });
  if (recheck.ok && recheck.busy.some(
    (period) => period.start < request.end && request.start < period.end,
  )) {
    await query(
      `update meeting_bookings set status = 'FAILED', failure_reason = $2 where booking_id = $1`,
      [bookingId, 'slot was taken between offering and booking'],
    );
    return {
      ok: false, bookingId, reason: 'NO_LONGER_FREE',
      spokenConfirmation: 'That slot just got taken — let me give you the next one.',
    };
  }

  const created = await adapter.createEvent({
    calendarUpn,
    subject: `YAD strategy call — ${account.canonical_name}`,
    body: buildEventBody(request, account.canonical_name),
    start: request.start,
    end: request.end,
    timezone: config.booking.timezone,
    attendeeName: request.attendeeName ?? null,
    attendeeEmail: request.attendeeEmail ?? null,
    location: request.attendeePhone ? `Phone: ${request.attendeePhone}` : null,
    idempotencyKey,
  });

  if (!created.ok || !created.providerEventId) {
    const followUpId = await recordBookingFailure(
      bookingId, request, created.error ?? 'provider did not confirm', calendarUpn,
    );
    return {
      ok: false, bookingId, followUpId, reason: 'PROVIDER_FAILED',
      error: created.error,
      // The caller must not imply this is booked.
      spokenConfirmation: 'I wasn\'t able to lock that in on the calendar just now. I\'ll have it '
        + 'confirmed and sent to you — please treat it as tentative until you see the invite.',
    };
  }

  // Only now, with a provider event id in hand, does this become CONFIRMED.
  await withTransaction(async (client) => {
    await client.query(
      `update meeting_bookings set status = 'CONFIRMED', provider_event_id = $2,
              provider_web_link = $3, confirmed_at = now(), failure_reason = null
        where booking_id = $1`,
      [bookingId, created.providerEventId, created.webLink ?? null],
    );
    const { rows: activityRows } = await client.query<{ activity_id: number }>(
      `insert into activities (account_id, contact_id, activity_type, channel, actor_user_id,
                               owner_user_id, disposition, occurred_at, notes, payload)
       values ($1,$2,'MEETING_SCHEDULED','system',$3,$4,'MEETING_SCHEDULED', now(), $5, $6)
       returning activity_id`,
      [
        request.accountId, request.contactId ?? null, request.createdBy ?? null,
        request.ownerUserId ?? null,
        `Strategy call booked for ${request.start.toISOString()} on ${calendarUpn}`,
        JSON.stringify({
          booking_id: bookingId,
          provider_event_id: created.providerEventId,
          attendee_email: request.attendeeEmail ?? null,
        }),
      ],
    );
    await client.query(
      'update meeting_bookings set activity_id = $2 where booking_id = $1',
      [bookingId, activityRows[0]!.activity_id],
    );
    // A booked meeting is a protected relationship state.
    await client.query(
      `update accounts set relationship_state = 'MEETING_SCHEDULED'
        where account_id = $1 and relationship_state not in ('CLIENT','PROPOSAL')`,
      [request.accountId],
    );
  });

  const spoken = describeSlot({ start: request.start, end: request.end }, new Date(), config.booking.timezone);
  return {
    ok: true,
    bookingId,
    providerEventId: created.providerEventId,
    webLink: created.webLink,
    spokenConfirmation: `You're confirmed for ${spoken}${
      request.attendeeEmail ? `, and the invite is going to ${request.attendeeEmail}` : ''
    }.`,
  };
}

/** A failed booking always leaves a human on the hook. It is never silently dropped. */
async function recordBookingFailure(
  bookingId: string, request: BookingRequest, reason: string, calendarUpn: string,
): Promise<number | undefined> {
  await query(
    `update meeting_bookings set status = 'FAILED', failure_reason = $2 where booking_id = $1`,
    [bookingId, reason.slice(0, 500)],
  );

  const ownerUserId = request.ownerUserId
    ?? (await query<{ current_owner_user_id: string | null }>(
      'select current_owner_user_id from accounts where account_id = $1', [request.accountId],
    )).rows[0]?.current_owner_user_id
    ?? (await query<{ user_id: string }>(
      `select user_id from users where role in ('SALES_MANAGER','ADMIN') and is_active
        order by created_at limit 1`,
    )).rows[0]?.user_id;

  if (!ownerUserId) return undefined;

  const { rows } = await query<{ followup_id: number }>(
    `insert into follow_ups (account_id, contact_id, owner_user_id, followup_type, due_at,
                             prospect_requested, context)
     values ($1,$2,$3,'BOOKING_RECOVERY', now(), true, $4)
     returning followup_id`,
    [
      request.accountId, request.contactId ?? null, ownerUserId,
      `Prospect agreed to ${request.start.toISOString()} on ${calendarUpn} but the calendar did not `
      + `confirm it (${reason.slice(0, 200)}). The prospect was told it is tentative. Confirm and send the invite.`,
    ],
  );
  return rows[0]!.followup_id;
}

function buildEventBody(request: BookingRequest, companyName: string): string {
  const lines = [
    `Strategy call with ${companyName}.`,
    '',
    request.attendeeName ? `Contact: ${request.attendeeName}` : null,
    request.attendeeEmail ? `Email: ${request.attendeeEmail}` : null,
    request.attendeePhone ? `Phone: ${request.attendeePhone}` : null,
    request.prospectTimezone ? `Their timezone: ${request.prospectTimezone}` : null,
    '',
    request.agendaNote ? `What they raised:\n${request.agendaNote}` : null,
    '',
    'Booked by the YAD Sales Brain. Full context is on the account in the sales portal.',
  ];
  return lines.filter((line) => line !== null).join('\n');
}

export { DEFAULT_POLICY, describeSlot };
export type { TimeSlot, BookingPolicy };
