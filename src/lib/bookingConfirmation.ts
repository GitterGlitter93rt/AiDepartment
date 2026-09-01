// Pure, testable logic for the /booking-confirmed/ page. Kept separate
// from the page's own <script> so it can be unit tested directly
// (browser-only globals like window.location and sessionStorage stay in
// the page itself; everything here operates on plain values).

export const ALLOWED_BOOKING_TYPES = ['strategy', 'enterprise', 'training', 'executive_advisory', 'comprehensive_audit'] as const;
export type BookingType = (typeof ALLOWED_BOOKING_TYPES)[number];

/** Candidate query-parameter names for Cal.com's forwarded booking
 * identifier. The exact name should be confirmed against Cal.com's
 * live redirect behavior at configuration time (see the Sprint 12.5
 * manual setup report) — checked defensively here so the page still
 * works correctly even if the assumption is slightly off. */
// bookingUid is the parameter name identified in Cal.com's current
// official documentation for the successful-booking redirect and is
// checked first. The remaining candidates are retained as defensive
// fallbacks only, in case Cal.com's actual behavior for a specific
// event/redirect configuration differs — removing them would trade a
// working safety net for no real benefit. One live, real test booking
// against production should still be used to confirm which parameter
// name actually arrives in practice before treating this as fully
// verified (see docs/cal-booking-webhook.md and the Sprint 12.5 manual
// setup report).
export const UID_PARAM_CANDIDATES = ['bookingUid', 'uid', 'booking_uid', 'bookingId'];

/** Extract a non-empty booking UID from the success-page query
 * parameters, or null if none of the candidate parameter names are
 * present with a non-empty value. */
export function getBookingUid(params: URLSearchParams): string | null {
  for (const key of UID_PARAM_CANDIDATES) {
    const val = params.get(key);
    if (val && val.trim().length > 0) return val.trim();
  }
  return null;
}

/** Validate the booking_type query parameter against the known-safe
 * enum. Invalid or missing values return null (fail safe) rather than
 * throwing — the event can still fire without a booking_type. */
export function getBookingType(params: URLSearchParams): BookingType | null {
  const raw = params.get('booking_type');
  if (raw && (ALLOWED_BOOKING_TYPES as readonly string[]).includes(raw)) {
    return raw as BookingType;
  }
  return null;
}

/** Decide whether booking_confirmed should fire, given the current
 * UID and the list of UIDs already seen this session. Also returns the
 * updated "seen" list (capped to the most recent 20 entries) so the
 * caller can persist it. Pure function — no storage access here. */
export function evaluateBookingConfirmedFiring(
  uid: string | null,
  previouslySeen: string[],
): { shouldFire: boolean; updatedSeen: string[] } {
  if (!uid) {
    return { shouldFire: false, updatedSeen: previouslySeen };
  }
  const alreadySeen = previouslySeen.includes(uid);
  if (alreadySeen) {
    return { shouldFire: false, updatedSeen: previouslySeen };
  }
  const updatedSeen = [...previouslySeen, uid].slice(-20);
  return { shouldFire: true, updatedSeen };
}

/** Build the exact, non-PII dataLayer event payload for a confirmed
 * booking. Never includes attendee email/phone/name, meeting notes, or
 * the booking title — only a fixed source label and (when valid) the
 * booking type. */
export function buildBookingConfirmedEvent(bookingType: BookingType | null): Record<string, string> {
  const payload: Record<string, string> = { event: 'booking_confirmed', booking_source: 'cal.com' };
  if (bookingType) payload.booking_type = bookingType;
  return payload;
}
