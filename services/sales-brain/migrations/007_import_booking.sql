-- 007_import_booking.sql — list import provenance and strategy-call bookings.
-- Canonical authority: market-miner-lead-import-export-spec.md,
-- outbound-sales-brain-seed-inventory-import-rollout-spec.md,
-- CLAUDE-CURRENT-TASK.md §T7.

-- ---------------------------------------------------------------------------
-- IMPORT — an imported list is a source, not a separate database.
-- Every row keeps its original payload so a bad mapping can be re-examined
-- without re-uploading the file.
-- ---------------------------------------------------------------------------
create table import_batches (
  import_batch_id  uuid primary key default gen_random_uuid(),
  source_name      text not null,               -- e.g. 'airtable-brent-2026-08', 'jacksonville-hvac.csv'
  source_kind      text not null default 'csv'
                   check (source_kind in ('csv','airtable_export','apollo_export','manual','other')),
  file_name        text,
  file_sha256      text,
  row_count        integer not null default 0,
  accounts_created integer not null default 0,
  accounts_matched integer not null default 0,
  rows_rejected    integer not null default 0,
  rows_suppressed  integer not null default 0,
  status           text not null default 'PENDING'
                   check (status in ('PENDING','RUNNING','COMPLETED','FAILED')),
  -- Import never triggers outreach (CLAUDE-CURRENT-TASK.md §T3).
  outreach_on_import boolean not null default false check (outreach_on_import = false),
  default_vertical_profile_id text references vertical_profiles(vertical_profile_id),
  notes            text,
  created_by       uuid references users(user_id),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create unique index import_batches_sha_idx on import_batches(file_sha256) where file_sha256 is not null;

create table import_rows (
  import_row_id    bigserial primary key,
  import_batch_id  uuid not null references import_batches(import_batch_id) on delete cascade,
  row_number       integer not null,
  raw              jsonb not null,
  normalized       jsonb,
  outcome          text not null default 'PENDING'
                   check (outcome in ('PENDING','CREATED','MATCHED','REJECTED','SUPPRESSED')),
  match_rule       text,
  account_id       uuid references accounts(account_id) on delete set null,
  reject_reason    text,
  processed_at     timestamptz
);
create index import_rows_batch_idx on import_rows(import_batch_id, outcome);
create index import_rows_account_idx on import_rows(account_id);

-- ---------------------------------------------------------------------------
-- MEETING BOOKING — provider-neutral. Outlook/Graph is the first adapter.
-- A booking may only be spoken as confirmed once the provider confirms creation
-- (CLAUDE-CURRENT-TASK.md §8 hard constraint), which is why provider_event_id
-- and confirmed_at are separate from the request fields.
-- ---------------------------------------------------------------------------
create table meeting_bookings (
  booking_id       uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  contact_id       uuid references contacts(contact_id) on delete set null,
  activity_id      bigint references activities(activity_id) on delete set null,
  owner_user_id    uuid references users(user_id),
  -- Whose calendar the meeting lands on. Default target is Michael's mailbox.
  calendar_upn     text not null,
  meeting_type     text not null default 'strategy_call'
                   check (meeting_type in ('strategy_call','discovery','follow_up','demo')),
  -- Idempotency: one logical booking attempt never creates two calendar events.
  idempotency_key  text not null,
  requested_start  timestamptz not null,
  requested_end    timestamptz not null,
  prospect_timezone text,
  attendee_name    text,
  attendee_email   text,
  attendee_phone   text,
  agenda_note      text,
  status           text not null default 'PENDING'
                   check (status in ('PENDING','CONFIRMED','FAILED','CANCELLED','RESCHEDULED')),
  provider         text not null default 'microsoft_graph',
  provider_event_id text,
  provider_web_link text,
  confirmed_at     timestamptz,
  failure_reason   text,
  created_by       uuid references users(user_id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- The database refuses to record a confirmed booking without provider proof.
  constraint meeting_bookings_confirmation_requires_provider check (
    status <> 'CONFIRMED' or (provider_event_id is not null and confirmed_at is not null)
  )
);
create trigger meeting_bookings_updated_at before update on meeting_bookings
  for each row execute function set_updated_at();
create unique index meeting_bookings_idempotency_idx on meeting_bookings(idempotency_key);
create index meeting_bookings_account_idx on meeting_bookings(account_id, created_at desc);
create index meeting_bookings_calendar_idx on meeting_bookings(calendar_upn, requested_start);
