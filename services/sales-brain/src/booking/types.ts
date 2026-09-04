/**
 * Provider-neutral calendar booking.
 * Authority: CLAUDE-CURRENT-TASK.md §T7, outbound-sales-brain-action-tools-spec.md.
 *
 * One rule shapes this whole module: a booking may be described as confirmed only
 * after the provider confirms creation. Everything else — the slot search, the
 * offer, the prospect's agreement — is provisional.
 */

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface AvailabilityRequest {
  calendarUpn: string;
  /** Search window. The adapter must not invent slots outside it. */
  from: Date;
  to: Date;
  durationMinutes: number;
  /** IANA timezone the working-hours policy is expressed in. */
  timezone: string;
}

export interface AvailabilityResult {
  ok: boolean;
  slots: TimeSlot[];
  /** Set when availability could not be read. Never treat this as "free". */
  error?: string;
  errorCode?: 'NOT_CONFIGURED' | 'AUTH_FAILED' | 'PROVIDER_ERROR' | 'RATE_LIMITED';
}

export interface CreateEventRequest {
  calendarUpn: string;
  subject: string;
  body: string;
  start: Date;
  end: Date;
  timezone: string;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  location?: string | null;
  /** Sent to the provider so a retried call cannot create a second event. */
  idempotencyKey: string;
}

export interface CreateEventResult {
  ok: boolean;
  providerEventId?: string;
  webLink?: string;
  error?: string;
  errorCode?: 'NOT_CONFIGURED' | 'AUTH_FAILED' | 'CONFLICT' | 'PROVIDER_ERROR' | 'RATE_LIMITED';
}

/**
 * Every calendar provider implements this. The booking service never learns which
 * one it is talking to, so Outlook can be swapped without touching the policy that
 * decides which slots are acceptable to offer.
 */
export interface CalendarAdapter {
  readonly name: string;
  isConfigured(): boolean;
  /** Busy periods within the window. Returning `ok: false` must never read as "free". */
  getBusy(request: AvailabilityRequest): Promise<{ ok: boolean; busy: TimeSlot[]; error?: string; errorCode?: AvailabilityResult['errorCode'] }>;
  createEvent(request: CreateEventRequest): Promise<CreateEventResult>;
  cancelEvent?(calendarUpn: string, providerEventId: string): Promise<{ ok: boolean; error?: string }>;
}
