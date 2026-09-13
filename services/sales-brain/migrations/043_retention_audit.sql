-- Somewhere for a future retention run to record what it did.
--
-- Written before any deletion path exists, on purpose. A run that deletes rows and
-- keeps no account of it cannot be checked afterwards, and "how many observations did
-- we drop last month" is a question somebody will ask the first time a rep says a
-- company's history looks short. The table is here so the answer exists from the
-- first run rather than from the first time it is missed.
--
-- No policy is set and nothing prunes anything today, so this stays empty.
create table if not exists retention_runs (
  retention_run_id  uuid primary key default gen_random_uuid(),
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  -- Who approved the policy this run applied. A deletion nobody approved is a
  -- deletion nobody can answer for.
  policy_approved_by text not null,
  policy_snapshot   jsonb not null,
  dry_run           boolean not null default true,
  status            text not null default 'RUNNING'
    check (status in ('RUNNING','COMPLETED','FAILED','REFUSED')),
  error_summary     text
);

create table if not exists retention_run_tables (
  retention_run_table_id uuid primary key default gen_random_uuid(),
  retention_run_id  uuid not null references retention_runs(retention_run_id) on delete cascade,
  table_name        text not null,
  keep_days         integer,
  rows_before       bigint not null,
  rows_older        bigint not null,
  rows_protected    bigint not null,
  rows_deleted      bigint not null default 0,
  bytes_estimated   bigint not null default 0
);

create index if not exists retention_run_tables_run_idx
  on retention_run_tables (retention_run_id);
