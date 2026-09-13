import { config } from '../config.js';
import type {
  AvailabilityRequest, CalendarAdapter, CreateEventRequest, CreateEventResult, TimeSlot,
} from './types.js';

/**
 * Microsoft Graph calendar adapter for michael@youraidepartment.ai.
 * Authority: CLAUDE-CURRENT-TASK.md §T7.
 *
 * Uses the client-credentials flow, which needs an Azure app registration with the
 * `Calendars.ReadWrite` *application* permission and admin consent. Until those
 * exist the adapter reports NOT_CONFIGURED — it never degrades into guessing at
 * availability, because an invented slot becomes a promise on a live call.
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_TIMEOUT_MS = 15_000;

interface CachedToken { token: string; expiresAt: number; }
let cachedToken: CachedToken | null = null;

async function accessToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const { tenantId, clientId, clientSecret } = config.booking;
  if (!tenantId || !clientId || !clientSecret) {
    return { ok: false, error: 'Microsoft Graph is not configured' };
  }
  // Refresh a minute early so a token never expires mid-request.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cachedToken.token };
  }

  try {
    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text();
      // Never log the secret; the error body from Azure can echo request parameters.
      return { ok: false, error: `token request failed (${response.status}): ${detail.slice(0, 200)}` };
    }
    const body = await response.json() as { access_token: string; expires_in: number };
    cachedToken = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return { ok: true, token: cachedToken.token };
  } catch (error) {
    return { ok: false, error: `token request error: ${(error as Error).message}` };
  }
}

export const microsoftGraphAdapter: CalendarAdapter = {
  name: 'microsoft_graph',

  isConfigured(): boolean {
    return config.booking.isConfigured;
  },

  async getBusy(request: AvailabilityRequest) {
    if (!config.booking.isConfigured) {
      return {
        ok: false, busy: [],
        error: 'Microsoft Graph is not configured (MS_GRAPH_TENANT_ID / CLIENT_ID / CLIENT_SECRET)',
        errorCode: 'NOT_CONFIGURED' as const,
      };
    }
    const auth = await accessToken();
    if (!auth.ok) return { ok: false, busy: [], error: auth.error, errorCode: 'AUTH_FAILED' as const };

    try {
      const response = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(request.calendarUpn)}/calendar/getSchedule`, {
        method: 'POST',
        headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          schedules: [request.calendarUpn],
          startTime: { dateTime: request.from.toISOString(), timeZone: 'UTC' },
          endTime: { dateTime: request.to.toISOString(), timeZone: 'UTC' },
          availabilityViewInterval: 15,
        }),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });

      if (response.status === 429) {
        return { ok: false, busy: [], error: 'rate limited by Graph', errorCode: 'RATE_LIMITED' as const };
      }
      if (!response.ok) {
        const detail = await response.text();
        return {
          ok: false, busy: [],
          error: `getSchedule failed (${response.status}): ${detail.slice(0, 200)}`,
          errorCode: 'PROVIDER_ERROR' as const,
        };
      }

      const body = await response.json() as {
        value?: { scheduleItems?: { start: { dateTime: string }; end: { dateTime: string }; status?: string }[] }[];
      };
      const busy: TimeSlot[] = [];
      for (const schedule of body.value ?? []) {
        for (const item of schedule.scheduleItems ?? []) {
          // "free" and "workingElsewhere" do not block a call.
          if (item.status && ['free', 'workingElsewhere'].includes(item.status)) continue;
          busy.push({
            // Graph returns naive local strings for UTC-requested windows.
            start: new Date(`${item.start.dateTime}Z`.replace(/Z+$/, 'Z')),
            end: new Date(`${item.end.dateTime}Z`.replace(/Z+$/, 'Z')),
          });
        }
      }
      return { ok: true, busy };
    } catch (error) {
      return {
        ok: false, busy: [],
        error: `getSchedule error: ${(error as Error).message}`,
        errorCode: 'PROVIDER_ERROR' as const,
      };
    }
  },

  async createEvent(request: CreateEventRequest): Promise<CreateEventResult> {
    if (!config.booking.isConfigured) {
      return { ok: false, error: 'Microsoft Graph is not configured', errorCode: 'NOT_CONFIGURED' };
    }
    const auth = await accessToken();
    if (!auth.ok) return { ok: false, error: auth.error, errorCode: 'AUTH_FAILED' };

    try {
      const response = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(request.calendarUpn)}/events`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${auth.token}`,
          'content-type': 'application/json',
          // Graph honours this for at least a few minutes, so a network retry cannot
          // create a duplicate meeting on Michael's calendar.
          'client-request-id': request.idempotencyKey,
        },
        body: JSON.stringify({
          subject: request.subject,
          body: { contentType: 'text', content: request.body },
          start: { dateTime: request.start.toISOString().replace('Z', ''), timeZone: 'UTC' },
          end: { dateTime: request.end.toISOString().replace('Z', ''), timeZone: 'UTC' },
          location: request.location ? { displayName: request.location } : undefined,
          attendees: request.attendeeEmail
            ? [{
                emailAddress: { address: request.attendeeEmail, name: request.attendeeName ?? undefined },
                type: 'required',
              }]
            : [],
          transactionId: request.idempotencyKey,
        }),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });

      if (response.status === 429) return { ok: false, error: 'rate limited by Graph', errorCode: 'RATE_LIMITED' };
      if (!response.ok) {
        const detail = await response.text();
        return {
          ok: false,
          error: `event creation failed (${response.status}): ${detail.slice(0, 300)}`,
          errorCode: response.status === 409 ? 'CONFLICT' : 'PROVIDER_ERROR',
        };
      }

      const body = await response.json() as { id?: string; webLink?: string };
      if (!body.id) {
        // A 2xx without an id is not a confirmed booking.
        return { ok: false, error: 'Graph returned no event id', errorCode: 'PROVIDER_ERROR' };
      }
      return { ok: true, providerEventId: body.id, webLink: body.webLink };
    } catch (error) {
      return { ok: false, error: `event creation error: ${(error as Error).message}`, errorCode: 'PROVIDER_ERROR' };
    }
  },

  async cancelEvent(calendarUpn: string, providerEventId: string) {
    if (!config.booking.isConfigured) return { ok: false, error: 'Microsoft Graph is not configured' };
    const auth = await accessToken();
    if (!auth.ok) return { ok: false, error: auth.error };
    try {
      const response = await fetch(
        `${GRAPH_BASE}/users/${encodeURIComponent(calendarUpn)}/events/${encodeURIComponent(providerEventId)}`,
        { method: 'DELETE', headers: { authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) },
      );
      return response.ok || response.status === 404
        ? { ok: true }
        : { ok: false, error: `cancel failed (${response.status})` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  },
};

/** Clears the cached token. Tests use this. */
export function resetGraphTokenCache(): void {
  cachedToken = null;
}
