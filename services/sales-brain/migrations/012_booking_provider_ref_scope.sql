-- 012_booking_provider_ref_scope.sql
--
-- The provider-reference uniqueness must apply only to LIVE bookings. A rescheduled
-- or cancelled row legitimately keeps the provider id it had, and must not block the
-- booking that replaced it — some providers reuse the same uid across a reschedule.
drop index if exists meeting_bookings_provider_ref_idx;

create unique index meeting_bookings_live_provider_ref_idx
  on meeting_bookings(provider, provider_event_id)
  where provider_event_id is not null
    and status in ('PENDING', 'CONFIRMED');
