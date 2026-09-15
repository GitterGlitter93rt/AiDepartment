-- 053_official_source_snapshots.sql — one download, many accounts.
--
-- The Texas plumbing board publishes who every Responsible Master Plumber is, and
-- that single fact is the most valuable thing this product can put in front of a rep
-- working Texas plumbing: a named, state-verified individual attached to the company,
-- usually a principal. The naive way to get it is to query the board once per
-- account, which is fragile, slow, rude to a state system, and produces a different
-- answer depending on when each account happened to be researched.
--
-- So official bulk data is modelled the way the DNC registry already is: a snapshot
-- is downloaded once, checksummed, indexed, and matched against every account that
-- needs it. `dnc_snapshots` proved the shape; this generalises it to any official
-- dataset.
--
-- The column that matters most here is `downloaded_at`. A snapshot is only ever as
-- fresh as its download, and the read model must say so: presenting a six-month-old
-- cached row as "verified today" is the same class of lie as the PROVIDER_PENDING
-- banner that claimed a provider owed us results. Freshness is a property of the
-- snapshot, not of the moment we happened to read it.

create table if not exists source_snapshots (
  snapshot_id         uuid primary key default gen_random_uuid(),
  -- The governed source this came from: 'tx_tsbpe' and the like.
  source_id           text not null,
  -- Which dataset of that source, since one authority may publish several.
  dataset             text not null,
  -- The official URL or data-request reference this was obtained from.
  source_reference    text,
  -- Content hash, so the same file loaded twice is recognised rather than duplicated.
  checksum            text not null,
  -- When the publisher says the data was produced, when the file says so. Distinct
  -- from downloaded_at: a file fetched today can be a quarter old.
  source_generated_at timestamptz,
  downloaded_at       timestamptz not null default now(),
  record_count        integer not null default 0,
  -- Which parser read it. A reparse under new rules is a new snapshot, not a silent
  -- reinterpretation of the old one.
  parser_version      text not null,
  state               text not null default 'LOADED'
                      check (state in ('LOADED','CURRENT','SUPERSEDED','REJECTED')),
  rejected_reason     text,
  notes               text,
  created_at          timestamptz not null default now(),
  -- Loading the identical file twice is a no-op, not a second snapshot.
  unique (source_id, dataset, checksum)
);

-- Exactly one snapshot per dataset is the one being read, which is what "the
-- register as of now" means. Same guarantee dnc_snapshots makes.
create unique index if not exists source_snapshots_one_current
  on source_snapshots(source_id, dataset) where state = 'CURRENT';
create index if not exists source_snapshots_recent_idx
  on source_snapshots(source_id, dataset, downloaded_at desc);

-- The normalized rows of a snapshot, indexed for matching rather than for browsing.
--
-- `payload` keeps the record exactly as parsed so a later reconciliation can read a
-- field this migration did not anticipate, while the extracted columns beside it are
-- the ones matching actually joins on.
create table if not exists source_snapshot_records (
  record_id          bigserial primary key,
  snapshot_id        uuid not null references source_snapshots(snapshot_id) on delete cascade,
  -- normalizeCompanyName() output, so matching does not re-derive it per lookup.
  match_company_name text,
  match_person_name  text,
  license_number     text,
  city               text,
  state_region       text,
  payload            jsonb not null default '{}'::jsonb
);

create index if not exists source_snapshot_records_company_idx
  on source_snapshot_records(snapshot_id, match_company_name)
  where match_company_name is not null;
create index if not exists source_snapshot_records_person_idx
  on source_snapshot_records(snapshot_id, match_person_name)
  where match_person_name is not null;
create index if not exists source_snapshot_records_licence_idx
  on source_snapshot_records(snapshot_id, license_number)
  where license_number is not null;
