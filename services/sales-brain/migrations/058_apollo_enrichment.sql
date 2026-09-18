-- 058 — Apollo as a licensed contact provider, after our own research and never instead of it
--
-- The resolver has reserved a place for this since it was written: LICENSED_CONTACT_PROVIDER
-- sits at priority 70, below every first-party and public source, and Stage H of contact
-- research is the paid slot that has always been skipped. This is what fills it.
--
-- Two things the schema has to make impossible rather than merely discourage. A worker
-- restart must not buy the same enrichment twice, which is what the idempotency index is
-- for. And an Apollo answer must never be mistaken for the company speaking about itself,
-- which is why nothing here writes into the first-party evidence path.

create table if not exists apollo_requests (
  apollo_request_id   uuid primary key default gen_random_uuid(),
  account_id          uuid references accounts(account_id) on delete cascade,
  contact_id          uuid references contacts(contact_id) on delete set null,

  -- What was asked, and in which mode. Both matter for cost.
  operation           text not null,
  request_mode        text not null,

  /*
   * The deterministic name of this piece of work.
   *
   * Built from the inputs that materially change the answer -- the Account, its resolved
   * domain, the person, the mode and the fields asked for -- so that the same question
   * asked twice is recognised as the same question. In-memory de-duping cannot do this:
   * two workers on one queue are two processes, and a restart is a third.
   */
  idempotency_key     text not null,
  input_fingerprint   text not null,

  apollo_person_id        text,
  apollo_organization_id  text,
  -- Apollo's own request_id, which is how a webhook or a poll is correlated back.
  provider_request_id     text,

  http_status         integer,
  provider_status     text,
  match_confidence    text,

  /*
   * Whether this call could charge, and what it did charge.
   *
   * Apollo documents "1 credit for demographics or email, plus 8 if a mobile phone is
   * returned", and charges nothing when match_confidence is none. Where the response does
   * not state a number we record an estimate and say that is what it is. A fabricated
   * credit count is worse than an absent one, because it reconciles against nothing.
   */
  credit_consuming    text not null default 'UNKNOWN',
  credits_charged     numeric(10,2),
  credits_estimated   numeric(10,2),

  result_classification text not null default 'IN_FLIGHT',
  fields_gained       text[] not null default '{}',
  error_classification text,
  notes               text,

  requested_at        timestamptz not null default now(),
  completed_at        timestamptz,

  constraint apollo_operation_known check (operation in (
    'PEOPLE_SEARCH', 'PEOPLE_MATCH', 'BULK_PEOPLE_MATCH', 'ORGANIZATION_ENRICH')),
  constraint apollo_mode_known check (request_mode in (
    'SEARCH_ONLY', 'ENRICH_DEMOGRAPHIC', 'ENRICH_EMAIL', 'ENRICH_PHONE',
    'WATERFALL_EMAIL', 'WATERFALL_PHONE', 'ORGANIZATION')),
  constraint apollo_credit_consuming_known check (credit_consuming in ('YES', 'NO', 'UNKNOWN')),
  constraint apollo_result_known check (result_classification in (
    'IN_FLIGHT', 'MATCHED', 'NO_MATCH', 'AMBIGUOUS', 'ERROR', 'SKIPPED'))
);

/*
 * One paid question, once.
 *
 * Deliberately covers IN_FLIGHT as well as the settled answers. A worker inserts its row
 * before it calls Apollo, so a second worker asking the same question at the same moment
 * conflicts and stands down rather than both discovering afterwards that they each paid.
 * ERROR is excluded so that a timeout or a 500 can be retried.
 */
create unique index if not exists apollo_request_one_per_question
  on apollo_requests (idempotency_key)
  where result_classification in ('IN_FLIGHT', 'MATCHED', 'NO_MATCH');

create index if not exists apollo_requests_by_account
  on apollo_requests (account_id, requested_at desc);
create index if not exists apollo_requests_by_provider_request
  on apollo_requests (provider_request_id) where provider_request_id is not null;

-- When each Account should be asked about again, and what it said last time.
create table if not exists apollo_account_state (
  account_id            uuid primary key references accounts(account_id) on delete cascade,
  status                text not null default 'APOLLO_ELIGIBLE',
  eligibility_reason    text,

  apollo_organization_id text,
  apollo_person_id       text,
  match_confidence       text,
  /* The inputs the last decision was made on. When they change, the answer may too. */
  input_fingerprint      text,

  last_checked_at        timestamptz,
  last_enriched_at       timestamptz,
  next_check_at          timestamptz,
  last_result            text,
  consecutive_no_match   integer not null default 0,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint apollo_status_known check (status in (
    'APOLLO_NOT_NEEDED', 'APOLLO_ELIGIBLE', 'APOLLO_QUEUED', 'APOLLO_SEARCHED',
    'APOLLO_MATCHED', 'APOLLO_ENRICHED', 'APOLLO_NO_MATCH', 'APOLLO_AMBIGUOUS',
    'APOLLO_STALE', 'APOLLO_RETRY_SCHEDULED', 'APOLLO_PROVIDER_ERROR',
    'APOLLO_PERMISSION_ERROR'))
);

create index if not exists apollo_account_state_due
  on apollo_account_state (next_check_at)
  where status not in ('APOLLO_NOT_NEEDED', 'APOLLO_PERMISSION_ERROR');

-- Provider identifiers on the records they belong to, so a later run recognises the same
-- person rather than matching them again by name.
alter table contacts
  add column if not exists apollo_person_id text,
  add column if not exists apollo_organization_id text;
create index if not exists contacts_apollo_person on contacts (apollo_person_id)
  where apollo_person_id is not null;

comment on table apollo_requests is
  'Every Apollo call, whether it charged or not. The idempotency index is what stops a '
  'worker restart buying the same answer twice.';
comment on column apollo_requests.credits_charged is
  'What Apollo said it charged, where it says. Null means unknown, never zero.';
comment on table apollo_account_state is
  'When an Account is next worth asking Apollo about. A daily sweep reads next_check_at; '
  'only Accounts that are due produce a provider call.';
