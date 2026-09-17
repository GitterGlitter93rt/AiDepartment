-- 056 — one failed fetch is not the end of research
--
-- V2 established that a site we could not read is never evidence against a company. It
-- left the other half undone: the Account simply kept its unreadable state for ever,
-- because research ran once and never again. 53 Accounts sat that way.
--
-- A recovery campaign retries on an hourly cadence for up to ten attempts, and it lives
-- in the database rather than in a timer: the existing job queue already gives durable
-- scheduling through run_after, survives restarts and deployments, and dedupes claims
-- through for-update-skip-locked. An in-memory timer would lose every campaign on the
-- next deploy, which is the failure this is meant to end.

create table if not exists website_recovery_campaigns (
  campaign_id         uuid primary key default gen_random_uuid(),
  account_id          uuid not null references accounts(account_id) on delete cascade,
  original_url        text,
  state               text not null default 'ACTIVE',
  attempts_made       integer not null default 0,
  max_attempts        integer not null default 10,
  next_attempt_at     timestamptz,
  recovered_url       text,
  recovered_on_attempt integer,
  -- A redirect to another registrable domain is a lead, never a rewrite. Held here
  -- until company identity, phone or address corroborates it.
  candidate_domain    text,
  candidate_basis     text,
  last_source_state   text,
  last_failure_reason text,
  outcome_reason      text,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint website_recovery_state_known check (state in (
    'ACTIVE', 'RECOVERED', 'EXHAUSTED', 'TERMINAL', 'DISALLOWED', 'CANCELLED')),
  constraint website_recovery_attempts_bounded check (
    attempts_made >= 0 and attempts_made <= max_attempts and max_attempts between 1 and 24)
);

-- One live campaign per Account. This is what stops two workers, two sweeps or two
-- deploys from running the same ten hours of retries twice over.
create unique index if not exists website_recovery_one_active_per_account
  on website_recovery_campaigns (account_id) where state = 'ACTIVE';
create index if not exists website_recovery_due
  on website_recovery_campaigns (next_attempt_at) where state = 'ACTIVE';

create table if not exists website_recovery_attempts (
  attempt_id      uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references website_recovery_campaigns(campaign_id) on delete cascade,
  account_id      uuid not null references accounts(account_id) on delete cascade,
  attempt_number  integer not null,
  -- Which of the finite candidate hosts this row is about.
  variant         text not null,
  requested_url   text not null,
  final_url       text,
  redirect_chain  jsonb not null default '[]'::jsonb,
  http_status     integer,
  source_state    text not null,
  failure_reason  text,
  dns_result      text,
  tls_result      text,
  content_type    text,
  bytes_received  integer,
  observed_at     timestamptz not null default now(),
  constraint website_recovery_variant_known check (variant in (
    'STORED', 'HTTPS_APEX', 'HTTPS_WWW', 'HTTP_APEX', 'HTTP_WWW'))
);

-- The same URL is never probed twice within one attempt, so a retried job that partly
-- completed cannot double-count its own work.
create unique index if not exists website_recovery_attempt_url_once
  on website_recovery_attempts (campaign_id, attempt_number, requested_url);
create index if not exists website_recovery_attempts_by_account
  on website_recovery_attempts (account_id, observed_at desc);

comment on table website_recovery_campaigns is
  'An hourly, bounded retry of a website we could not read. Never evidence against the '
  'company: an exhausted campaign routes the Account to alternative sources and review, '
  'and never to suppression.';
comment on column website_recovery_campaigns.candidate_domain is
  'A registrable domain a redirect landed on, held as a candidate. Promoting it to the '
  'Account canonical domain requires corroboration and never happens automatically.';
