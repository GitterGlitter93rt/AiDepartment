import { config } from '../config.js';
import type {
  AvailabilityRequest, CalendarAdapter, CreateEventRequest, CreateEventResult, TimeSlot,
} from './types.js';

/**
 * Cal.com calendar adapter.
 * Authority: outbound-sales-brain-calcom-strategy-call-booking-spec.md.
 *
 * Cal.com is the booking authority: it owns availability, the invite, reminders,
 * reschedule and cancellation, and it synchronizes the event to Michael's Outlook.
 * YAD must never also create a direct Outlook event for the same meeting — two
 * sources of truth produce duplicates and inconsistent cancellation state (§1).
 *
 * Slot selection still happens in `policy.ts`, because Cal.com's returned slots are
 * the *possible* times while YAD decides which two to actually offer.
 */

const API_BASE = 'https://api.cal.com/v2';
const TIMEOUT_MS = 15_000;

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${config.booking.calcomApiKey}`,
    'content-type': 'application/json',
    // Cal.com v2 requires an explicit API version per endpoint family.
    'cal-api-version': '2024-08-13',
  };
}

export const calDotComAdapter: CalendarAdapter = {
  name: 'calcom',

  isConfigured(): boolean {
    return Boolean(config.booking.calcomApiKey && config.booking.calcomEventTypeId);
  },

  /**
   * Cal.com is the scheduling authority: these are the times it will actually accept.
   * The service offers only from this set, so YAD can never propose a slot Cal.com
   * did not return.
   */
  async getBookableSlots(request: AvailabilityRequest) {
    if (!this.isConfigured()) {
      return {
        ok: false, slots: [] as TimeSlot[],
        error: 'Cal.com is not configured (CALCOM_API_KEY / CALCOM_EVENT_TYPE_ID)',
        errorCode: 'NOT_CONFIGURED' as const,
      };
    }
    try {
      const url = new URL(`${API_BASE}/slots`);
      url.searchParams.set('eventTypeId', String(config.booking.calcomEventTypeId));
      url.searchParams.set('start', request.from.toISOString());
      url.searchParams.set('end', request.to.toISOString());
      url.searchParams.set('timeZone', request.timezone);

      const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status === 429) {
        return { ok: false, slots: [], error: 'rate limited by Cal.com', errorCode: 'RATE_LIMITED' as const };
      }
      if (!response.ok) {
        const detail = await response.text();
        return {
          ok: false, slots: [],
          error: `slots request failed (${response.status}): ${detail.slice(0, 200)}`,
          errorCode: 'PROVIDER_ERROR' as const,
        };
      }

      const body = await response.json() as { data?: Record<string, { start: string }[]> };
      const slots: TimeSlot[] = [];
      for (const day of Object.values(body.data ?? {})) {
        for (const slot of day) {
          const start = new Date(slot.start);
          if (Number.isNaN(start.getTime())) continue;
          slots.push({ start, end: new Date(start.getTime() + request.durationMinutes * 60_000) });
        }
      }
      return { ok: true as const, slots };
    } catch (error) {
      return {
        ok: false, slots: [] as TimeSlot[],
        error: `slots request error: ${(error as Error).message}`,
        errorCode: 'PROVIDER_ERROR' as const,
      };
    }
  },

  /**
   * Free/busy view, for callers that want one. Derived from the bookable slots, so
   * it stays consistent with the authoritative path above.
   */
  async getBusy(request: AvailabilityRequest) {
    if (!this.isConfigured()) {
      return {
        ok: false, busy: [] as TimeSlot[],
        error: 'Cal.com is not configured (CALCOM_API_KEY / CALCOM_EVENT_TYPE_ID)',
        errorCode: 'NOT_CONFIGURED' as const,
      };
    }

    try {
      const url = new URL(`${API_BASE}/slots`);
      url.searchParams.set('eventTypeId', String(config.booking.calcomEventTypeId));
      url.searchParams.set('start', request.from.toISOString());
      url.searchParams.set('end', request.to.toISOString());
      url.searchParams.set('timeZone', request.timezone);

      const response = await fetch(url, {
        headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 429) {
        return { ok: false, busy: [], error: 'rate limited by Cal.com', errorCode: 'RATE_LIMITED' as const };
      }
      if (!response.ok) {
        const detail = await response.text();
        return {
          ok: false, busy: [],
          error: `slots request failed (${response.status}): ${detail.slice(0, 200)}`,
          errorCode: 'PROVIDER_ERROR' as const,
        };
      }

      const body = await response.json() as { data?: Record<string, { start: string }[]> };
      const free: TimeSlot[] = [];
      for (const slots of Object.values(body.data ?? {})) {
        for (const slot of slots) {
          const start = new Date(slot.start);
          if (Number.isNaN(start.getTime())) continue;
          free.push({ start, end: new Date(start.getTime() + request.durationMinutes * 60_000) });
        }
      }

      // A configured calendar with genuinely zero free slots is a real answer; an
      // empty response because the request failed was already handled above.
      return { ok: true, busy: invertToBusy(free, request) };
    } catch (error) {
      return {
        ok: false, busy: [],
        error: `slots request error: ${(error as Error).message}`,
        errorCode: 'PROVIDER_ERROR' as const,
      };
    }
  },

  async createEvent(request: CreateEventRequest): Promise<CreateEventResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'Cal.com is not configured', errorCode: 'NOT_CONFIGURED' };
    }
    // Cal.com requires an attendee; without an address it cannot send the invite,
    // and a meeting nobody was invited to is not a booking.
    if (!request.attendeeEmail) {
      return {
        ok: false, errorCode: 'PROVIDER_ERROR',
        error: 'Cal.com requires an attendee email to create and send the invite',
      };
    }

    try {
      const response = await fetch(`${API_BASE}/bookings`, {
        method: 'POST',
        headers: { ...headers(), 'idempotency-key': request.idempotencyKey },
        body: JSON.stringify({
          eventTypeId: Number(config.booking.calcomEventTypeId),
          start: request.start.toISOString(),
          attendee: {
            name: request.attendeeName || request.attendeeEmail,
            email: request.attendeeEmail,
            timeZone: request.timezone,
            language: 'en',
          },
          // Cal Video is the configured location on the event type; YAD does not
          // override it here.
          metadata: { yad_idempotency_key: request.idempotencyKey },
          bookingFieldsResponses: { notes: request.body.slice(0, 1000) },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 429) return { ok: false, error: 'rate limited by Cal.com', errorCode: 'RATE_LIMITED' };
      if (response.status === 409) {
        return { ok: false, error: 'that slot is no longer available', errorCode: 'CONFLICT' };
      }
      if (!response.ok) {
        const detail = await response.text();
        return {
          ok: false, errorCode: 'PROVIDER_ERROR',
          error: `booking failed (${response.status}): ${detail.slice(0, 300)}`,
        };
      }

      const body = await response.json() as {
        data?: { uid?: string; id?: number; meetingUrl?: string; location?: string; status?: string };
      };
      const uid = body.data?.uid ?? (body.data?.id ? String(body.data.id) : undefined);
      if (!uid) {
        // A 2xx without a booking id is not a confirmed booking.
        return { ok: false, error: 'Cal.com returned no booking id', errorCode: 'PROVIDER_ERROR' };
      }
      if (body.data?.status && !['accepted', 'confirmed'].includes(body.data.status.toLowerCase())) {
        return {
          ok: false, errorCode: 'PROVIDER_ERROR',
          error: `Cal.com returned status "${body.data.status}" rather than a confirmed booking`,
        };
      }

      return {
        ok: true,
        providerEventId: uid,
        webLink: body.data?.meetingUrl ?? body.data?.location,
      };
    } catch (error) {
      return { ok: false, error: `booking error: ${(error as Error).message}`, errorCode: 'PROVIDER_ERROR' };
    }
  },

  async cancelEvent(_calendarUpn: string, providerEventId: string) {
    if (!this.isConfigured()) return { ok: false, error: 'Cal.com is not configured' };
    try {
      const response = await fetch(`${API_BASE}/bookings/${encodeURIComponent(providerEventId)}/cancel`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ cancellationReason: 'Cancelled by Your AI Department' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return response.ok || response.status === 404
        ? { ok: true }
        : { ok: false, error: `cancel failed (${response.status})` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  },
};

/**
 * Turns free slots into busy periods across the requested window, so the rest of the
 * system sees one consistent adapter contract.
 */
function invertToBusy(free: TimeSlot[], request: AvailabilityRequest): TimeSlot[] {
  if (free.length === 0) {
    // Nothing free means the whole window is busy. This is only reached on a
    // successful response, so it is a real answer rather than a failure in disguise.
    return [{ start: request.from, end: request.to }];
  }
  const sorted = [...free].sort((a, b) => a.start.getTime() - b.start.getTime());
  const busy: TimeSlot[] = [];
  let cursor = request.from;

  for (const slot of sorted) {
    if (slot.start.getTime() > cursor.getTime()) {
      busy.push({ start: cursor, end: slot.start });
    }
    if (slot.end.getTime() > cursor.getTime()) cursor = slot.end;
  }
  if (cursor.getTime() < request.to.getTime()) {
    busy.push({ start: cursor, end: request.to });
  }
  return busy;
}
