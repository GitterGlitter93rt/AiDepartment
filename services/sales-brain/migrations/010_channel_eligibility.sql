-- 010_channel_eligibility.sql — per-channel phone eligibility and registry screening.
-- Authority: outbound-sales-brain-global-phone-channel-eligibility-dnc-spec.md.
--
-- One ambiguous CALL_READY flag is a release hard fail (§19). A number a human may
-- dial is not automatically a number an AI may dial, and the two decisions are
-- stored, filtered and displayed separately.
--
-- Registry data is purpose-limited (§6): it may gate a call and nothing else. It is
-- never used to score, enrich or personalize, and it is never exposed as a fact
-- about the business.

alter table contact_endpoints
  add column line_type text not null default 'unknown'
    check (line_type in ('landline','mobile','voip','toll_free','unknown')),
  add column line_type_source text,
  -- Current decisions, denormalized for filtering. History lives in the decision table.
  add column human_manual_call text not null default 'REVIEW_REQUIRED'
    check (human_manual_call in ('ALLOW','BLOCK','REVIEW_REQUIRED','NOT_APPLICABLE')),
  add column autonomous_ai_voice text not null default 'BLOCK'
    check (autonomous_ai_voice in ('ALLOW','BLOCK','REVIEW_REQUIRED','NOT_APPLICABLE')),
  add column eligibility_reason_codes text[] not null default '{}',
  add column eligibility_evaluated_at timestamptz,
  add column eligibility_policy_version text,
  add column next_human_eligible_at timestamptz,
  add column next_ai_eligible_at timestamptz;

create index contact_endpoints_human_eligible_idx
  on contact_endpoints(account_id) where human_manual_call = 'ALLOW';
create index contact_endpoints_ai_eligible_idx
  on contact_endpoints(account_id) where autonomous_ai_voice = 'ALLOW';

-- Append-only decision snapshots. A call must be traceable to the decision that
-- authorized it, including the policy version in force at the time.
create table channel_eligibility_decisions (
  decision_id        bigserial primary key,
  endpoint_id        uuid not null references contact_endpoints(endpoint_id) on delete cascade,
  account_id         uuid not null references accounts(account_id) on delete cascade,
  channel            text not null check (channel in ('HUMAN_MANUAL_CALL','AUTONOMOUS_AI_VOICE','SMS')),
  decision           text not null check (decision in ('ALLOW','BLOCK','REVIEW_REQUIRED','NOT_APPLICABLE')),
  reason_codes       text[] not null default '{}',
  policy_version     text not null,
  line_type          text,
  jurisdiction       text,
  local_time_evaluated timestamptz,
  next_eligible_at   timestamptz,
  evaluated_at       timestamptz not null default now(),
  expires_at         timestamptz,
  -- Set when a decision authorized a specific attempt.
  used_for_attempt_id bigint
);
create index channel_eligibility_endpoint_idx
  on channel_eligibility_decisions(endpoint_id, channel, evaluated_at desc);

create or replace function channel_eligibility_append_only() returns trigger language plpgsql as $$
begin
  -- Only the attempt back-reference may ever be filled in afterwards.
  if new.endpoint_id is distinct from old.endpoint_id
    or new.channel is distinct from old.channel
    or new.decision is distinct from old.decision
    or new.policy_version is distinct from old.policy_version
    or new.evaluated_at is distinct from old.evaluated_at
  then
    raise exception 'channel_eligibility_decisions is append-only' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create trigger channel_eligibility_no_rewrite before update on channel_eligibility_decisions
  for each row execute function channel_eligibility_append_only();

-- Registry screening results. Purpose-limited: gate a call, nothing else.
create table registry_screen_results (
  screen_id          bigserial primary key,
  endpoint_id        uuid not null references contact_endpoints(endpoint_id) on delete cascade,
  normalized_value   text not null,
  registry           text not null,            -- e.g. 'us_national_dnc', 'fl_state_dnc'
  provider           text not null,
  -- SCREEN_FAILED is a distinct outcome. Converting a failure to NO_MATCH is a
  -- release hard fail (§19), so the schema makes the two impossible to confuse.
  result             text not null
                     check (result in ('MATCH','NO_MATCH','SCREEN_FAILED','NOT_SCREENED','EXEMPT')),
  screened_at        timestamptz not null default now(),
  expires_at         timestamptz,
  provider_reference text,
  error_detail       text
);
create index registry_screen_endpoint_idx on registry_screen_results(endpoint_id, registry, screened_at desc);
create index registry_screen_value_idx on registry_screen_results(normalized_value, registry);

-- Which contact modes a campaign is actually authorized to use.
alter table mining_jobs
  add column authorized_channels text[] not null default '{}';

-- Recorded outreach attempts, so a pre-action decision ties to what happened.
create table contact_attempts (
  attempt_id         bigserial primary key,
  account_id         uuid not null references accounts(account_id) on delete cascade,
  contact_id         uuid references contacts(contact_id) on delete set null,
  endpoint_id        uuid references contact_endpoints(endpoint_id) on delete set null,
  actor_user_id      uuid references users(user_id),
  channel            text not null check (channel in ('HUMAN_MANUAL_CALL','AUTONOMOUS_AI_VOICE','SMS','EMAIL','FIELD')),
  -- Which decision authorized this attempt. Null is only valid for non-phone channels.
  eligibility_decision_id bigint references channel_eligibility_decisions(decision_id),
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  disposition        text,
  activity_id        bigint references activities(activity_id) on delete set null,
  notes              text,
  constraint contact_attempts_phone_requires_decision check (
    channel not in ('HUMAN_MANUAL_CALL','AUTONOMOUS_AI_VOICE')
    or eligibility_decision_id is not null
  )
);
create index contact_attempts_account_idx on contact_attempts(account_id, started_at desc);
create index contact_attempts_actor_idx on contact_attempts(actor_user_id, started_at desc);
