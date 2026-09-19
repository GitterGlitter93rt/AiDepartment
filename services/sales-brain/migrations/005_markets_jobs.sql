-- 005_markets_jobs.sql — Saved Markets, market membership, search context,
-- and the durable job queue. Canonical authority:
-- rep-ownership-data-model.md §7-§9, rep-inventory-browse-claim-spec.md §2, §11,
-- outbound-sales-brain-job-queue-spec.md, data-contract §9, §33.

-- ---------------------------------------------------------------------------
-- SAVED MARKET — reusable mining/inventory configuration.
-- Counts shown in the UI are derived from Accounts, never stored as sole truth.
-- ---------------------------------------------------------------------------
create table saved_markets (
  market_id        uuid primary key default gen_random_uuid(),
  name             text not null,
  vertical_profile_id text references vertical_profiles(vertical_profile_id),
  geography_type   text not null
                   check (geography_type in ('zip_zcta','city','county','state','radius','custom')),
  geography_definition jsonb not null default '{}'::jsonb,
  mining_mode      text not null default 'advertiser_first'
                   check (mining_mode in ('advertiser_first','advertisers_only','full_local_market',
                                          'no_verified_website','weak_website','imported_list')),
  target_inventory_depth integer,
  status           text not null default 'ACTIVE'
                   check (status in ('ACTIVE','SATURATED','REFRESHING','PAUSED')),
  saturation_state text,
  last_mined_at    timestamptz,
  last_refresh_at  timestamptz,
  next_refresh_at  timestamptz,
  created_by       uuid references users(user_id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger saved_markets_updated_at before update on saved_markets
  for each row execute function set_updated_at();

-- One Account may belong to many markets and still be one Account with one owner
-- (rep-ownership-data-model §9).
create table account_market_membership (
  account_id       uuid not null references accounts(account_id) on delete cascade,
  market_id        uuid not null references saved_markets(market_id) on delete cascade,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  discovery_source text,
  current_relevance text not null default 'CURRENT'
                   check (current_relevance in ('CURRENT','AGING','NO_LONGER_MATCHING')),
  primary key (account_id, market_id)
);
create index account_market_membership_market_idx on account_market_membership(market_id);

-- ---------------------------------------------------------------------------
-- SEARCH CONTEXT — why an Account was surfaced when a rep claimed it.
-- ---------------------------------------------------------------------------
create table search_contexts (
  search_context_id uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(user_id) on delete cascade,
  vertical_profile_id text,
  geography        jsonb not null default '{}'::jsonb,
  mining_mode      text,
  filters          jsonb not null default '{}'::jsonb,
  sort             text,
  result_count     integer,
  created_at       timestamptz not null default now()
);
create index search_contexts_user_idx on search_contexts(user_id, created_at desc);

alter table ownership_events
  add constraint ownership_events_search_context_fk
  foreign key (search_context_id) references search_contexts(search_context_id) on delete set null;

-- ---------------------------------------------------------------------------
-- JOB QUEUE — in Postgres, not Redis. The deployment spec permits a separate
-- queue component only if the implementation needs one; leased rows are enough
-- and they keep durable job state in the same backup as everything else.
-- ---------------------------------------------------------------------------
create table jobs (
  job_id           uuid primary key default gen_random_uuid(),
  job_type         text not null,
  -- Two jobs with the same idempotency key never both run: repeated button
  -- clicks must not launch duplicate provider spend (API contract §5).
  idempotency_key  text,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'QUEUED'
                   check (status in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  priority         integer not null default 100,
  run_after        timestamptz not null default now(),
  attempts         integer not null default 0,
  max_attempts     integer not null default 3,
  leased_by        text,
  leased_until     timestamptz,
  last_error       text,
  progress         jsonb not null default '{}'::jsonb,
  requested_by     uuid references users(user_id),
  account_id       uuid references accounts(account_id) on delete cascade,
  market_id        uuid references saved_markets(market_id) on delete set null,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz
);
create unique index jobs_idempotency_idx on jobs(idempotency_key)
  where idempotency_key is not null and status in ('QUEUED','RUNNING');
create index jobs_pickup_idx on jobs(status, run_after, priority)
  where status in ('QUEUED','RUNNING');
create index jobs_account_idx on jobs(account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- MINING JOB — the campaign-level record a job may serve (data-contract §9).
-- ---------------------------------------------------------------------------
create table mining_jobs (
  mining_job_id    uuid primary key default gen_random_uuid(),
  name             text,
  market_id        uuid references saved_markets(market_id) on delete set null,
  vertical_profile_id text references vertical_profiles(vertical_profile_id),
  geography_selector jsonb not null default '{}'::jsonb,
  mining_mode      text,
  target_inventory_count integer,
  minimum_yad_tier text check (minimum_yad_tier in ('A','B','C','D')),
  required_signals text[] not null default '{}',
  excluded_signals text[] not null default '{}',
  query_budget     integer,
  provider_budget_usd numeric(10,2),
  research_depth   text,
  contact_enrichment_mode text not null default 'PUBLIC_ONLY'
                   check (contact_enrichment_mode in ('PUBLIC_ONLY','PUBLIC_THEN_PAID',
                                                      'PAID_ALLOWED_FOR_TIER_A','IMPORT_ONLY')),
  status           text not null default 'QUEUED'
                   check (status in ('QUEUED','RUNNING','COMPLETED','PAUSED','FAILED','CANCELLED')),
  pause_reason     text,
  accounts_discovered integer not null default 0,
  created_by       uuid references users(user_id),
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz
);
create index mining_jobs_market_idx on mining_jobs(market_id, created_at desc);

alter table search_observations
  add constraint search_observations_mining_job_fk
  foreign key (mining_job_id) references mining_jobs(mining_job_id) on delete set null;

-- ---------------------------------------------------------------------------
-- PROVIDER USAGE (data-contract §33) — cost per discovered prospect / per meeting.
-- ---------------------------------------------------------------------------
create table provider_usage (
  provider_usage_id uuid primary key default gen_random_uuid(),
  provider         text not null,
  operation        text not null,
  mining_job_id    uuid references mining_jobs(mining_job_id) on delete set null,
  research_run_id  uuid references research_runs(research_run_id) on delete set null,
  account_id       uuid references accounts(account_id) on delete set null,
  requested_at     timestamptz not null default now(),
  completed_at     timestamptz,
  units            numeric(12,4) not null default 1,
  estimated_cost_usd numeric(10,4) not null default 0,
  actual_cost_usd  numeric(10,4),
  status           text not null default 'ok',
  error_code       text
);
create index provider_usage_provider_idx on provider_usage(provider, requested_at desc);
