-- 015_import_sessions.sql — browser-driven import wizard.
-- Authority: CLAUDE-EXTERNAL-BLOCKERS-CURRENT.md §2,
-- YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §22.
--
-- Uploading a prospect list should be a normal product workflow, not an SSH task.
-- A session holds the uploaded file and the mapping while the operator reviews the
-- normalization and dedupe preview, and nothing is written to canonical Accounts
-- until they confirm.

create table import_sessions (
  import_session_id  uuid primary key default gen_random_uuid(),
  created_by         uuid not null references users(user_id),
  source_kind        text not null default 'csv'
                     check (source_kind in ('csv','airtable_export','apollo_export','prior_yad_list','other')),
  source_name        text not null,
  file_name          text,
  file_sha256        text,
  row_count          integer not null default 0,
  headers            text[] not null default '{}',
  /* The uploaded rows, held only while the wizard runs. Cleared on confirm or
     expiry so an unconfirmed upload does not linger as a shadow prospect list. */
  raw_rows           jsonb,
  column_map         jsonb,
  default_vertical_profile_id text references vertical_profiles(vertical_profile_id),
  status             text not null default 'UPLOADED'
                     check (status in ('UPLOADED','MAPPED','PREVIEWED','CONFIRMED','CANCELLED','EXPIRED')),
  preview            jsonb,
  import_batch_id    uuid references import_batches(import_batch_id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '24 hours'
);
create trigger import_sessions_updated_at before update on import_sessions
  for each row execute function set_updated_at();
create index import_sessions_creator_idx on import_sessions(created_by, created_at desc);
create index import_sessions_expiry_idx on import_sessions(expires_at) where status not in ('CONFIRMED','CANCELLED');

-- Outreach on import stays impossible at every layer.
alter table import_batches add column import_session_id uuid references import_sessions(import_session_id);
