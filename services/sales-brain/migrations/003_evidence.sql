-- 003_evidence.sql — provenance. ResearchRun / EvidenceRecord / SearchObservation /
-- ProspectStatement. Canonical authority: data-contract §10-§14, §26, §34.
--
-- Evidence is append-only. A contradiction creates a NEW record and points the old
-- one at it; history is never destroyed (data-contract §2, §13).

create table research_runs (
  research_run_id  uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  trigger          text not null
                   check (trigger in ('newly_discovered','refresh_before_call','scheduled_refresh',
                                      'human_requested','campaign_expansion','stale_evidence','import')),
  vertical_profile_id      text references vertical_profiles(vertical_profile_id),
  vertical_profile_version text,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  status           text not null default 'running'
                   check (status in ('running','completed','partial','failed')),
  adapter_results  jsonb not null default '[]'::jsonb,
  cost_total_usd   numeric(10,4) not null default 0,
  error_summary    jsonb not null default '[]'::jsonb,
  requested_by     uuid references users(user_id)
);
create index research_runs_account_idx on research_runs(account_id, started_at desc);

-- ---------------------------------------------------------------------------
-- EVIDENCE RECORD — the claim-control object (data-contract §12).
-- can_state_as_fact is what gates whether a rep or agent may say a thing out loud.
-- ---------------------------------------------------------------------------
create table evidence_records (
  evidence_id      uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  location_id      uuid references locations(location_id) on delete set null,
  contact_id       uuid references contacts(contact_id) on delete set null,
  endpoint_id      uuid references contact_endpoints(endpoint_id) on delete set null,
  research_run_id  uuid references research_runs(research_run_id) on delete set null,
  category         text not null,
  claim_key        text not null,               -- e.g. 'active_google_search_ad', 'decision_maker_name'
  claim_text       text not null,
  normalized_value text,                        -- 'yes' | 'no_confirmed' | 'unknown' | a scalar
  confidence       text not null default 'unknown'
                   check (confidence in ('confirmed','likely','unknown','contradicted')),
  can_state_as_fact boolean not null default false,
  source_provider  text,
  source_type      text not null,
  source_reference text,
  observed_at      timestamptz not null default now(),
  expires_at       timestamptz,
  freshness        text not null default 'unknown'
                   check (freshness in ('fresh','aging','stale','unknown')),
  retention_class  text not null default 'durable'
                   check (retention_class in ('durable','durable_with_license','transient',
                                              'identifier_only','do_not_store_raw')),
  independently_verified boolean not null default false,
  supersedes_evidence_id      uuid references evidence_records(evidence_id),
  contradicted_by_evidence_id uuid references evidence_records(evidence_id),
  -- Evidence precedence rank (data-contract §13). Lower number outranks higher.
  precedence_rank  integer not null default 9,
  notes            text,
  created_at       timestamptz not null default now()
);
create index evidence_account_claim_idx on evidence_records(account_id, claim_key, observed_at desc);
create index evidence_run_idx           on evidence_records(research_run_id);
create index evidence_contact_idx       on evidence_records(contact_id) where contact_id is not null;
create index evidence_live_idx          on evidence_records(account_id, claim_key)
  where contradicted_by_evidence_id is null;

-- Immutability guard: only the two pointer columns may ever change on evidence.
-- Rewriting history so an old call appears to have used research it did not have
-- is a hard fail (data-contract §34).
create or replace function evidence_records_append_only() returns trigger language plpgsql as $$
begin
  if row(new.*) is distinct from row(old.*) then
    if new.account_id      is distinct from old.account_id
      or new.claim_key     is distinct from old.claim_key
      or new.claim_text    is distinct from old.claim_text
      or new.normalized_value is distinct from old.normalized_value
      or new.confidence    is distinct from old.confidence
      or new.source_type   is distinct from old.source_type
      or new.source_reference is distinct from old.source_reference
      or new.observed_at   is distinct from old.observed_at
      or new.can_state_as_fact is distinct from old.can_state_as_fact
    then
      raise exception 'evidence_records is append-only: create a superseding record instead of editing %',
        old.evidence_id using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger evidence_records_append_only before update on evidence_records
  for each row execute function evidence_records_append_only();

-- ---------------------------------------------------------------------------
-- SEARCH OBSERVATION (data-contract §10). Deliberately separate from Evidence:
-- six observations of the same advertiser stay six observations of one Account.
-- ---------------------------------------------------------------------------
create table search_observations (
  observation_id   uuid primary key default gen_random_uuid(),
  mining_job_id    uuid,
  provider         text not null,
  source_type      text not null,
  query            text,
  search_cell_id   text,
  observed_at      timestamptz not null default now(),
  provider_native_id text,
  observed_name    text,
  observed_domain  text,
  observed_phone   text,
  observed_location text,
  result_type      text check (result_type in ('paid_search','local_service_ad','sponsored_local',
                                               'organic','local_result','transparency_ad','directory_result')),
  position         integer,
  ad_format        text,
  advertised_service text,
  ad_headline      text,
  landing_url      text,
  retention_class  text not null default 'transient',
  raw_payload      jsonb,
  account_id       uuid references accounts(account_id) on delete set null
);
create index search_observations_account_idx on search_observations(account_id, observed_at desc);
create index search_observations_job_idx     on search_observations(mining_job_id);

-- ---------------------------------------------------------------------------
-- PROSPECT STATEMENT (data-contract §26). What the prospect actually said.
-- Outranks public hypotheses; retained verbatim.
-- ---------------------------------------------------------------------------
create table prospect_statements (
  prospect_statement_id uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  contact_id       uuid references contacts(contact_id) on delete set null,
  activity_id      bigint,                      -- FK added in 004 once activities exists
  category         text not null,
  statement_text   text not null,               -- the prospect's own wording, unparaphrased
  normalized_value text,
  source_class     text not null default 'prospect_verified'
                   check (source_class in ('prospect_verified','prospect_estimate','gatekeeper_supplied')),
  confidence       text not null default 'confirmed'
                   check (confidence in ('confirmed','likely','unknown','contradicted')),
  captured_at      timestamptz not null default now(),
  supersedes_statement_id uuid references prospect_statements(prospect_statement_id),
  captured_by      uuid references users(user_id)
);
create index prospect_statements_account_idx on prospect_statements(account_id, captured_at desc);
