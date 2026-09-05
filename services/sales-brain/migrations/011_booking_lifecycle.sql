-- 011_booking_lifecycle.sql — booking lifecycle mirrored from the provider.
-- Authority: outbound-sales-brain-calcom-strategy-call-booking-spec.md §12-§16.
--
-- Cal.com remains the source of truth for a booking it created. YAD stores the
-- provider ids and mirrors current state; it never creates a second event when the
-- existing one can be rescheduled through the provider (§14).

alter table meeting_bookings
  add column event_type_id text,
  add column meeting_location_type text not null default 'cal_video',
  add column source_channel text not null default 'portal'
    check (source_channel in ('portal','ai_call','human_rep','email','inbound')),
  add column source_session_id text,
  add column rescheduled_from_booking_id uuid references meeting_bookings(booking_id),
  add column cancelled_at timestamptz,
  add column cancellation_reason text,
  add column attended_state text not null default 'UNKNOWN'
    check (attended_state in ('UNKNOWN','ATTENDED','NO_SHOW','CANCELLED')),
  add column prep_brief jsonb;

-- Relax the status check to cover the full provider lifecycle.
alter table meeting_bookings drop constraint if exists meeting_bookings_status_check;
alter table meeting_bookings add constraint meeting_bookings_status_check
  check (status in ('PENDING','CONFIRMED','FAILED','CANCELLED','RESCHEDULED','COMPLETED','NO_SHOW'));

-- One live confirmed booking per provider reference.
create unique index meeting_bookings_provider_ref_idx
  on meeting_bookings(provider, provider_event_id)
  where provider_event_id is not null;

-- Append-only provider event log. Idempotent by provider event id, so a replayed
-- webhook mirrors state once (§12).
create table booking_events (
  booking_event_id   bigserial primary key,
  booking_id         uuid references meeting_bookings(booking_id) on delete cascade,
  account_id         uuid references accounts(account_id) on delete cascade,
  provider           text not null default 'calcom',
  provider_event_id  text,
  provider_booking_id text,
  event_type         text not null
                     check (event_type in ('BOOKING_CREATED','BOOKING_RESCHEDULED','BOOKING_CANCELLED',
                                           'BOOKING_REJECTED','MEETING_ENDED','NO_SHOW_RECORDED',
                                           'BOOKING_PAYMENT_INITIATED','UNKNOWN')),
  payload            jsonb not null default '{}'::jsonb,
  occurred_at        timestamptz not null default now(),
  received_at        timestamptz not null default now(),
  applied            boolean not null default false,
  apply_error        text
);
create unique index booking_events_provider_idx
  on booking_events(provider, provider_event_id) where provider_event_id is not null;
create index booking_events_booking_idx on booking_events(booking_id, occurred_at desc);
