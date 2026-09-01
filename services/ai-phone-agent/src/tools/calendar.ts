// Calendar tool with a clean adapter boundary.
//
// The interface is what the agent depends on. Two implementations sit
// behind it: a deterministic mock (default, no credentials needed) and
// a real Google Calendar adapter driven by an OAuth refresh token.
// Wiring the live YAD calendar later is a credentials change, not a
// code change.

export interface AvailabilitySlot {
  start: string; // ISO 8601
  end: string;
}

export interface CheckAvailabilityInput {
  dateRange: { from: string; to: string };
  durationMinutes: number;
  timezone: string;
}

export interface BookAppointmentInput {
  title: string;
  start: string;
  end: string;
  attendeeName?: string;
  attendeeEmail?: string;
  attendeePhone?: string;
  notes?: string;
  timezone?: string;
  createMeetLink?: boolean;
}

export interface BookedAppointment {
  id: string;
  start: string;
  end: string;
  htmlLink?: string;
  meetLink?: string;
  mocked: boolean;
}

export interface CalendarTool {
  checkAvailability(input: CheckAvailabilityInput): Promise<AvailabilitySlot[]>;
  bookAppointment(input: BookAppointmentInput): Promise<BookedAppointment>;
}

/** Business hours used by the mock, in the caller's local terms. */
const MOCK_HOURS = [9, 10, 11, 13, 14, 15, 16];

/**
 * Deterministic mock. Offers plausible weekday business-hours slots so
 * a full booking conversation can be demonstrated end to end with no
 * Google credentials. Deterministic on purpose — tests assert on it.
 */
export function createMockCalendar(now: () => Date = () => new Date()): CalendarTool {
  const booked = new Set<string>();
  return {
    async checkAvailability({ dateRange, durationMinutes }) {
      const from = new Date(dateRange.from);
      const to = new Date(dateRange.to);
      const slots: AvailabilitySlot[] = [];
      const cursor = new Date(Math.max(from.getTime(), now().getTime()));
      cursor.setMinutes(0, 0, 0);

      for (let day = 0; day < 14 && slots.length < 12; day++) {
        const d = new Date(cursor);
        d.setDate(d.getDate() + day);
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) continue; // weekdays only
        for (const hour of MOCK_HOURS) {
          const start = new Date(d);
          start.setUTCHours(hour, 0, 0, 0);
          if (start.getTime() < now().getTime() || start > to) continue;
          const end = new Date(start.getTime() + durationMinutes * 60_000);
          const key = start.toISOString();
          if (booked.has(key)) continue;
          slots.push({ start: key, end: end.toISOString() });
          if (slots.length >= 12) break;
        }
      }
      return slots;
    },

    async bookAppointment(input) {
      booked.add(new Date(input.start).toISOString());
      return {
        id: `mock-${Buffer.from(input.start).toString('hex').slice(0, 12)}`,
        start: input.start,
        end: input.end,
        htmlLink: 'https://calendar.google.com/mock-event',
        meetLink: input.createMeetLink ? 'https://meet.google.com/mock-demo-link' : undefined,
        mocked: true,
      };
    },
  };
}

export interface GoogleCalendarOptions {
  calendarId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}

/** Live Google Calendar adapter. Exchanges the refresh token for a
 * short-lived access token on demand; nothing is cached to disk. */
export function createGoogleCalendar(opts: GoogleCalendarOptions): CalendarTool {
  const doFetch = opts.fetchImpl ?? fetch;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 30_000) return token.value;
    const res = await doFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        refresh_token: opts.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`google oauth ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return token.value;
  }

  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(opts.calendarId)}`;

  return {
    async checkAvailability({ dateRange, durationMinutes, timezone }) {
      const at = await accessToken();
      const res = await doFetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          timeMin: dateRange.from,
          timeMax: dateRange.to,
          timeZone: timezone,
          items: [{ id: opts.calendarId }],
        }),
      });
      if (!res.ok) throw new Error(`google freebusy ${res.status}`);
      const data = (await res.json()) as { calendars: Record<string, { busy: { start: string; end: string }[] }> };
      const busy = data.calendars?.[opts.calendarId]?.busy ?? [];

      // Walk business hours and drop anything overlapping a busy block.
      const slots: AvailabilitySlot[] = [];
      const cursor = new Date(dateRange.from);
      const end = new Date(dateRange.to);
      while (cursor < end && slots.length < 12) {
        const dow = cursor.getUTCDay();
        if (dow !== 0 && dow !== 6) {
          for (const hour of MOCK_HOURS) {
            const s = new Date(cursor);
            s.setUTCHours(hour, 0, 0, 0);
            const e = new Date(s.getTime() + durationMinutes * 60_000);
            if (s < new Date(dateRange.from) || e > end) continue;
            const clash = busy.some((b) => s < new Date(b.end) && e > new Date(b.start));
            if (!clash) slots.push({ start: s.toISOString(), end: e.toISOString() });
          }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return slots;
    },

    async bookAppointment(input) {
      const at = await accessToken();
      const body: Record<string, unknown> = {
        summary: input.title,
        description: input.notes ?? '',
        start: { dateTime: input.start, timeZone: input.timezone ?? 'UTC' },
        end: { dateTime: input.end, timeZone: input.timezone ?? 'UTC' },
      };
      // Google emails the invitation to attendees — that is the
      // confirmation email, which is why this service has no mail server.
      if (input.attendeeEmail) body.attendees = [{ email: input.attendeeEmail, displayName: input.attendeeName }];
      if (input.createMeetLink) {
        body.conferenceData = { createRequest: { requestId: `yad-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
      }
      const url = `${base}/events?sendUpdates=all${input.createMeetLink ? '&conferenceDataVersion=1' : ''}`;
      const res = await doFetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`google events ${res.status}`);
      const data = (await res.json()) as { id: string; htmlLink?: string; hangoutLink?: string };
      return {
        id: data.id, start: input.start, end: input.end,
        htmlLink: data.htmlLink, meetLink: data.hangoutLink, mocked: false,
      };
    },
  };
}
