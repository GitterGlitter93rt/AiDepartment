-- 022_dnc_registry.sql — National DNC registry snapshots and membership.
-- Authority: outbound-sales-brain-ftc-dnc-ingestion-contract.v1.yaml.
--
-- The registry is purpose-limited screening data. It is not prospect enrichment, it
-- is never rep- or Sales-AI-visible, and a NO_MATCH from it is only an input — it
-- cannot on its own make a number callable by an AI.
--
-- The schema carries the properties the contract asks for rather than trusting code:
--   * a batch has an identity, so the same one cannot apply twice;
--   * membership is scoped to a snapshot, so a malformed batch cannot corrupt the
--     current one — it simply never becomes current;
--   * a subscription records which area codes are in scope, so a number outside it
--     produces NOT_APPLICABLE rather than a false NO_MATCH.

create table dnc_subscriptions (
  subscription_id   uuid primary key default gen_random_uuid(),
  source_id         text not null default 'FTC_NATIONAL_DNC',
  -- Non-secret organisation reference only. The credential lives in the environment.
  organization_reference_nonsecret text,
  credential_env_var text,
  subscribed_area_codes text[] not null default '{}',
  effective_at      timestamptz,
  renews_at         timestamptz,
  status            text not null default 'PENDING'
                    check (status in ('PENDING','ACTIVE','SUSPENDED','EXPIRED')),
  last_verified_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table dnc_snapshots (
  snapshot_id       uuid primary key default gen_random_uuid(),
  source_id         text not null default 'FTC_NATIONAL_DNC',
  subscription_id   uuid references dnc_subscriptions(subscription_id),
  data_kind         text not null check (data_kind in ('FULL_LIST','CHANGE_LIST')),
  -- Batch identity, so a repeated change batch cannot apply twice.
  batch_reference   text not null,
  checksum          text,
  source_generated_at timestamptz,
  downloaded_at     timestamptz not null default now(),
  validated_at      timestamptz,
  applied_at        timestamptz,
  subscribed_area_codes text[] not null default '{}',
  record_count      integer,
  state             text not null default 'DOWNLOADED'
                    check (state in ('DOWNLOADED','VALIDATED','APPLIED','CURRENT',
                                     'SUPERSEDED','REJECTED')),
  rejected_reason   text,
  unique (source_id, batch_reference)
);
create index dnc_snapshots_state_idx on dnc_snapshots(state, downloaded_at desc);

-- Only one snapshot is current at a time, which is what "the registry as of now"
-- means. A malformed batch never reaches this state.
create unique index dnc_snapshots_one_current
  on dnc_snapshots((true)) where state = 'CURRENT';

create table dnc_membership (
  snapshot_id       uuid not null references dnc_snapshots(snapshot_id) on delete cascade,
  normalized_value  text not null,
  primary key (snapshot_id, normalized_value)
);
create index dnc_membership_value_idx on dnc_membership(normalized_value);

-- Every screen, for audit correlation to the endpoint and the eligibility decision.
create table dnc_screen_log (
  dnc_screen_id     bigserial primary key,
  endpoint_id       uuid references contact_endpoints(endpoint_id) on delete set null,
  normalized_value  text not null,
  snapshot_id       uuid references dnc_snapshots(snapshot_id) on delete set null,
  status            text not null
                    check (status in ('MATCH','NO_MATCH','NOT_APPLICABLE','UNKNOWN',
                                      'ERROR_RETRYABLE','ERROR_BLOCKING')),
  normalized_result text not null,
  reason_code       text not null,
  policy_version    text not null,
  provider_reference text,
  screened_at       timestamptz not null default now()
);
create index dnc_screen_log_endpoint_idx on dnc_screen_log(endpoint_id, screened_at desc);
