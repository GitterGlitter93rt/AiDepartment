import { query } from '../db/pool.js';
import { isManager, type Role } from './auth.js';

/**
 * Who may see and change a meeting booking.
 *
 * The meetings list already answered this question -- a rep sees a booking they own
 * or one on an Account they own, a manager sees the team's -- but only for the list.
 * The detail page, the prep-brief endpoint, reschedule and cancel each asked a
 * narrower question ("are you signed in?") and got a wider answer. One rule, in one
 * place, so a list and a detail page cannot disagree again.
 *
 * The rule is the meetings list's rule, deliberately: each detail view mirrors the
 * list it is reached from, so a record a rep cannot see in a list is not readable by
 * guessing its URL either.
 */
export interface BookingViewer {
  userId: string;
  role: Role;
}

export type BookingAccess = 'VISIBLE' | 'NOT_FOUND' | 'FORBIDDEN';

/**
 * A booking a viewer may not see is reported NOT_FOUND to them, never FORBIDDEN:
 * "you are not allowed to see this one" confirms the id exists. FORBIDDEN is
 * returned only where the caller already legitimately knows the record is there.
 */
export async function bookingAccessFor(
  bookingId: string, viewer: BookingViewer,
): Promise<BookingAccess> {
  const { rows } = await query<{ owner_user_id: string | null; account_owner: string | null }>(
    `select b.owner_user_id, a.current_owner_user_id as account_owner
       from meeting_bookings b
       join accounts a on a.account_id = b.account_id
      where b.booking_id = $1`,
    [bookingId],
  );
  const booking = rows[0];
  if (!booking) return 'NOT_FOUND';
  if (isManager(viewer.role)) return 'VISIBLE';
  if (booking.owner_user_id === viewer.userId) return 'VISIBLE';
  if (booking.account_owner === viewer.userId) return 'VISIBLE';
  return 'FORBIDDEN';
}

/** True when this viewer may read the booking at all. */
export async function canViewBooking(
  bookingId: string, viewer: BookingViewer,
): Promise<boolean> {
  return (await bookingAccessFor(bookingId, viewer)) === 'VISIBLE';
}
