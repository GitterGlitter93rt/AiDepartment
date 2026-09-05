import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';

/**
 * Booking lifecycle events from the scheduling provider.
 * Authority: outbound-sales-brain-calcom-strategy-call-booking-spec.md §12-§14.
 *
 * Cal.com owns the lifecycle of a booking it created; YAD mirrors it. A reschedule
 * updates the existing booking rather than creating a second event, and every
 * transition reaches the Account timeline so a rep sees the same truth the calendar
 * has.
 */

export type BookingEventType =
  | 'BOOKING_CREATED' | 'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLED' | 'BOOKING_REJECTED'
  | 'MEETING_ENDED' | 'NO_SHOW_RECORDED' | 'BOOKING_PAYMENT_INITIATED' | 'UNKNOWN';

/** Cal.com trigger names mapped to our canonical event types. */
const TRIGGER_MAP: Record<string, BookingEventType> = {
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_REQUESTED: 'BOOKING_CREATED',
  BOOKING_RESCHEDULED: 'BOOKING_RESCHEDULED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_REJECTED: 'BOOKING_REJECTED',
  MEETING_ENDED: 'MEETING_ENDED',
  BOOKING_NO_SHOW_UPDATED: 'NO_SHOW_RECORDED',
  BOOKING_PAYMENT_INITIATED: 'BOOKING_PAYMENT_INITIATED',
};

export interface WebhookEnvelope {
  triggerEvent?: string;
  createdAt?: string;
  payload?: {
    uid?: string;
    bookingId?: number | string;
    startTime?: string;
    endTime?: string;
    /** Present on a reschedule: the booking this one replaced. */
    rescheduleUid?: string;
    cancellationReason?: string;
    attendees?: { email?: string; name?: string; timeZone?: string; noShow?: boolean }[];
    metadata?: Record<string, string>;
    status?: string;
  };
}

export interface WebhookResult {
  ok: boolean;
  duplicate: boolean;
  eventType: BookingEventType;
  bookingId: string | null;
  applied: string[];
  reason?: string;
}

/**
 * Verifies the provider's signature.
 * An unverified payload is rejected rather than trusted: a booking state change is
 * a durable, rep-visible fact.
 */
export function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = config.booking.calcomWebhookSecret;
  if (!secret) return false;
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.trim().toLowerCase().replace(/^sha256=/, '');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(provided, 'hex');
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function ingestBookingWebhook(
  envelope: WebhookEnvelope, provider = 'calcom',
): Promise<WebhookResult> {
  const eventType = TRIGGER_MAP[envelope.triggerEvent ?? ''] ?? 'UNKNOWN';
  const payload = envelope.payload ?? {};
  const providerBookingId = payload.uid ?? (payload.bookingId ? String(payload.bookingId) : null);

  // A stable per-delivery id. Cal.com does not always supply one, so it is derived
  // from the trigger, the booking and the event time — enough that a genuine replay
  // collides while a real subsequent change does not.
  const providerEventId = [
    envelope.triggerEvent ?? 'unknown', providerBookingId ?? 'nobooking',
    envelope.createdAt ?? payload.startTime ?? '',
  ].join(':');

  const existing = await query<{ booking_event_id: number; booking_id: string | null }>(
    'select booking_event_id, booking_id from booking_events where provider = $1 and provider_event_id = $2',
    [provider, providerEventId],
  );
  if (existing.rows[0]) {
    return {
      ok: true, duplicate: true, eventType,
      bookingId: existing.rows[0].booking_id, applied: [],
      reason: 'event already processed',
    };
  }

  // Resolve by provider id first, then by the idempotency key we planted in metadata.
  const { rows: bookingRows } = await query<{
    booking_id: string; account_id: string; contact_id: string | null; status: string;
    owner_user_id: string | null; requested_start: Date;
  }>(
    `select booking_id, account_id, contact_id, status, owner_user_id, requested_start
       from meeting_bookings
      where ($1::text is not null and provider_event_id = $1::text)
         or ($2::text is not null and idempotency_key = $2::text)
      order by created_at desc limit 1`,
    [providerBookingId, payload.metadata?.['yad_idempotency_key'] ?? null],
  );
  const booking = bookingRows[0];

  const applied: string[] = [];

  await withTransaction(async (client) => {
    await client.query(
      `insert into booking_events (booking_id, account_id, provider, provider_event_id,
                                   provider_booking_id, event_type, payload, occurred_at, applied)
       values ($1,$2,$3,$4,$5,$6,$7, coalesce($8::timestamptz, now()), $9)`,
      [
        booking?.booking_id ?? null, booking?.account_id ?? null, provider, providerEventId,
        providerBookingId, eventType, JSON.stringify(payload),
        envelope.createdAt ?? null, Boolean(booking),
      ],
    );

    if (!booking) return;

    const timelineNote = async (activityType: string, notes: string): Promise<void> => {
      await client.query(
        `insert into activities (account_id, contact_id, activity_type, channel, notes,
                                 source_system, payload)
         values ($1,$2,$3,'system',$4,$5,$6)`,
        [
          booking.account_id, booking.contact_id, activityType, notes, provider,
          JSON.stringify({ booking_id: booking.booking_id, provider_booking_id: providerBookingId }),
        ],
      );
    };

    switch (eventType) {
      case 'BOOKING_RESCHEDULED': {
        // Update in place. Creating a second event here is exactly what §14 forbids.
        await client.query(
          `update meeting_bookings
              set requested_start = coalesce($2::timestamptz, requested_start),
                  requested_end = coalesce($3::timestamptz, requested_end),
                  provider_event_id = coalesce($4, provider_event_id),
                  status = 'CONFIRMED', confirmed_at = coalesce(confirmed_at, now())
            where booking_id = $1`,
          [booking.booking_id, payload.startTime ?? null, payload.endTime ?? null, providerBookingId],
        );
        await timelineNote('MEETING_SCHEDULED',
          `Strategy call rescheduled to ${payload.startTime ?? 'a new time'} by the prospect or host.`);
        applied.push('booking_rescheduled');
        break;
      }

      case 'BOOKING_CANCELLED':
      case 'BOOKING_REJECTED': {
        await client.query(
          `update meeting_bookings set status = 'CANCELLED', cancelled_at = now(),
                  cancellation_reason = $2, attended_state = 'CANCELLED'
            where booking_id = $1`,
          [booking.booking_id, payload.cancellationReason ?? 'cancelled at the provider'],
        );
        // The relationship steps back, but never below what it already earned.
        await client.query(
          `update accounts set relationship_state = 'ENGAGED'
            where account_id = $1 and relationship_state = 'MEETING_SCHEDULED'`,
          [booking.account_id],
        );
        await timelineNote('NOTE',
          `Strategy call cancelled${payload.cancellationReason ? `: ${payload.cancellationReason}` : ''}.`);

        // A cancelled meeting is a human's problem, not a trigger to resume cold outreach.
        if (booking.owner_user_id) {
          await client.query(
            `insert into follow_ups (account_id, contact_id, owner_user_id, followup_type, due_at,
                                     prospect_requested, context)
             values ($1,$2,$3,'MEETING_PREP', now(), false, $4)`,
            [
              booking.account_id, booking.contact_id, booking.owner_user_id,
              'The strategy call was cancelled. Decide the next step personally — do not restart generic outreach.',
            ],
          );
          applied.push('recovery_follow_up_created');
        }
        applied.push('booking_cancelled');
        break;
      }

      case 'MEETING_ENDED': {
        // Attendance is only recorded when the provider or a human confirms it (§13).
        const noShow = (payload.attendees ?? []).some((attendee) => attendee.noShow === true);
        await client.query(
          `update meeting_bookings set status = $2, attended_state = $3 where booking_id = $1`,
          [booking.booking_id, noShow ? 'NO_SHOW' : 'COMPLETED', noShow ? 'NO_SHOW' : 'ATTENDED'],
        );
        await timelineNote('NOTE', noShow ? 'Prospect did not attend the strategy call.' : 'Strategy call completed.');
        if (noShow && booking.owner_user_id) {
          await client.query(
            `insert into follow_ups (account_id, contact_id, owner_user_id, followup_type, due_at,
                                     prospect_requested, context)
             values ($1,$2,$3,'CALLBACK', now(), false, $4)`,
            [
              booking.account_id, booking.contact_id, booking.owner_user_id,
              'No-show on the strategy call. Reach out personally through the approved follow-up policy.',
            ],
          );
          applied.push('no_show_follow_up_created');
        }
        applied.push(noShow ? 'no_show_recorded' : 'meeting_completed');
        break;
      }

      case 'NO_SHOW_RECORDED': {
        await client.query(
          `update meeting_bookings set attended_state = 'NO_SHOW', status = 'NO_SHOW'
            where booking_id = $1`,
          [booking.booking_id],
        );
        applied.push('no_show_recorded');
        break;
      }

      case 'BOOKING_CREATED': {
        // A booking created directly in Cal.com (not through YAD) still belongs on
        // the timeline, but it cannot invent an Account it cannot resolve.
        await client.query(
          `update meeting_bookings set status = 'CONFIRMED',
                  provider_event_id = coalesce(provider_event_id, $2),
                  confirmed_at = coalesce(confirmed_at, now())
            where booking_id = $1 and status <> 'CANCELLED'`,
          [booking.booking_id, providerBookingId],
        );
        applied.push('booking_confirmed');
        break;
      }

      default:
        break;
    }
  });

  return {
    ok: true, duplicate: false, eventType,
    bookingId: booking?.booking_id ?? null,
    applied,
    reason: booking ? undefined : 'no matching booking; event stored unapplied',
  };
}

/**
 * Reconciles bookings whose provider state may have drifted — a webhook we never
 * received, or a delivery that failed. Runs from the worker.
 */
export async function reconcilePendingBookings(): Promise<{ checked: number; failed: number }> {
  // Anything still PENDING well past its start time never confirmed. Mark it failed
  // so it stops looking like an upcoming meeting on someone's screen.
  const { rowCount } = await query(
    `update meeting_bookings
        set status = 'FAILED',
            failure_reason = coalesce(failure_reason, 'never confirmed by the provider')
      where status = 'PENDING' and requested_start < now() - interval '1 hour'`,
  );
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from meeting_bookings where status = 'CONFIRMED'`,
  );
  return { checked: rows[0]?.n ?? 0, failed: rowCount ?? 0 };
}
