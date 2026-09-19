-- 004_ownership.sql — ownership events, activity timeline, follow-ups, suppression.
-- Canonical authority: rep-ownership-data-model.md §4, §10-§13,
-- rep-portal-api-contract.v1.md §13-§18.

-- ---------------------------------------------------------------------------
-- OWNERSHIP EVENTS — append-only history. accounts.current_owner_user_id is a
-- projection of this; the history is what an audit reads.
-- ---------------------------------------------------------------------------
create table ownership_events (
  ownership_event_id bigserial primary key,
  account_id       uuid not null references accounts(account_id) on delete cascade,
  event_type       text not null
                   check (event_type in ('CLAIMED','RELEASED','MANAGER_ASSIGNED','REASSIGNED',
                                         'OWNERSHIP_PROTECTED','OWNERSHIP_ENDED')),
  previous_owner_user_id uuid references users(user_id),
  new_owner_user_id      uuid references users(user_id),
  actor_user_id    uuid not null references users(user_id),
  reason           text,
  search_context_id uuid,                       -- why this Account was surfaced when claimed
  occurred_at      timestamptz not null default now()
);
create index ownership_events_account_idx on ownership_events(account_id, occurred_at desc);
create index ownership_events_actor_idx   on ownership_events(actor_user_id, occurred_at desc);

create or replace function ownership_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'ownership_events is append-only' using errcode = 'restrict_violation';
end;
$$;
create trigger ownership_events_no_update before update or delete on ownership_events
  for each row execute function ownership_events_append_only();

-- ---------------------------------------------------------------------------
-- ACTIVITY / TIMELINE (rep-ownership-data-model §10, API contract §18).
-- Structured records. Free-form notes supplement state; they never replace it.
-- ---------------------------------------------------------------------------
create table activities (
  activity_id      bigserial primary key,
  account_id       uuid not null references accounts(account_id) on delete cascade,
  contact_id       uuid references contacts(contact_id) on delete set null,
  endpoint_id      uuid references contact_endpoints(endpoint_id) on delete set null,
  actor_user_id    uuid references users(user_id),
  owner_user_id    uuid references users(user_id),
  activity_type    text not null
                   check (activity_type in ('DISCOVERED','RESEARCHED','SCORE_CHANGED','CONTACT_ENRICHED',
                                            'CLAIMED','RELEASED','REASSIGNED','CALL_ATTEMPT','VOICEMAIL',
                                            'EMAIL_SENT','EMAIL_REPLY','FIELD_VISIT','CALLBACK_REQUESTED',
                                            'MEETING_SCHEDULED','MEETING_BOOKING_FAILED','DNC','WRONG_ENDPOINT',
                                            'NOTE','OPPORTUNITY_CREATED','IMPORTED')),
  channel          text check (channel in ('phone','sms','email','human_field','system','other')),
  -- Rep-facing disposition (API contract §13). Null for system activities.
  disposition      text check (disposition in ('NO_ANSWER','VOICEMAIL','GATEKEEPER','DECISION_MAKER_REACHED',
                                               'SEND_INFORMATION','CALLBACK_REQUESTED','POSSIBLE_OPPORTUNITY',
                                               'MEETING_SCHEDULED','NOT_A_FIT','WRONG_NUMBER','DO_NOT_CONTACT')),
  occurred_at      timestamptz not null default now(),
  payload          jsonb not null default '{}'::jsonb,
  notes            text,
  source_system    text not null default 'sales_portal',
  created_at       timestamptz not null default now()
);
create index activities_account_idx on activities(account_id, occurred_at desc);
create index activities_owner_idx   on activities(owner_user_id, occurred_at desc);
create index activities_type_idx    on activities(activity_type, occurred_at desc);

alter table prospect_statements
  add constraint prospect_statements_activity_fk
  foreign key (activity_id) references activities(activity_id) on delete set null;

-- ---------------------------------------------------------------------------
-- FOLLOW-UPS / CALLBACKS (rep-ownership-data-model §11).
-- A prospect-requested callback is a protected relationship state.
-- ---------------------------------------------------------------------------
create table follow_ups (
  followup_id      bigserial primary key,
  account_id       uuid not null references accounts(account_id) on delete cascade,
  contact_id       uuid references contacts(contact_id) on delete set null,
  owner_user_id    uuid not null references users(user_id),
  followup_type    text not null
                   check (followup_type in ('CALLBACK','EMAIL','RESEARCH','MEETING_PREP','GENERAL',
                                            'BOOKING_RECOVERY')),
  due_at           timestamptz not null,
  timezone         text,
  status           text not null default 'OPEN' check (status in ('OPEN','COMPLETED','CANCELLED')),
  prospect_requested boolean not null default false,
  created_from_activity_id bigint references activities(activity_id) on delete set null,
  context          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create trigger follow_ups_updated_at before update on follow_ups
  for each row execute function set_updated_at();
create index follow_ups_owner_due_idx on follow_ups(owner_user_id, due_at) where status = 'OPEN';
create index follow_ups_account_idx   on follow_ups(account_id) where status = 'OPEN';

-- ---------------------------------------------------------------------------
-- SUPPRESSION (data-contract §29, rep-ownership-data-model §12).
-- Exists independently of ownership. A new discovery source never resets it.
-- ---------------------------------------------------------------------------
create table suppressions (
  suppression_id   uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('ACCOUNT','CONTACT','ENDPOINT','EMAIL','PHONE','CAMPAIGN')),
  account_id       uuid references accounts(account_id) on delete cascade,
  contact_id       uuid references contacts(contact_id) on delete set null,
  endpoint_id      uuid references contact_endpoints(endpoint_id) on delete set null,
  -- Raw value kept so suppression survives even if the endpoint row is later removed
  -- or the same number is rediscovered under a different Account.
  normalized_value text,
  suppression_type text not null
                   check (suppression_type in ('DNC','EMAIL_UNSUBSCRIBE','LEGAL_POLICY',
                                               'CLIENT_NO_COLD_OUTREACH','WRONG_ENTITY','OTHER_APPROVED')),
  source           text not null,
  reason           text,
  created_by       uuid references users(user_id),
  source_activity_id bigint references activities(activity_id) on delete set null,
  effective_at     timestamptz not null default now(),
  expires_at       timestamptz,                 -- normally null: DNC does not auto-expire
  is_active        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now()
);
create index suppressions_account_idx on suppressions(account_id) where is_active;
create index suppressions_value_idx   on suppressions(normalized_value) where is_active;
create index suppressions_endpoint_idx on suppressions(endpoint_id) where is_active;

-- Keep accounts.is_suppressed and endpoint suppression in step with the truth table,
-- so a suppressed Account can never leak into claimable cold inventory through a
-- forgotten join (SALES-TEAM-ACCESS-CURRENT.md §19 hard fail).
create or replace function suppressions_sync_flags() returns trigger language plpgsql as $$
declare
  target_account uuid := coalesce(new.account_id, old.account_id);
  target_endpoint uuid := coalesce(new.endpoint_id, old.endpoint_id);
begin
  if target_account is not null then
    update accounts a set
      is_suppressed = exists (
        select 1 from suppressions s
        where s.account_id = a.account_id and s.is_active
          and s.scope in ('ACCOUNT','CONTACT')
          and (s.expires_at is null or s.expires_at > now())
      ),
      suppression_summary = (
        select string_agg(distinct s.suppression_type, ', ')
        from suppressions s
        where s.account_id = a.account_id and s.is_active
          and (s.expires_at is null or s.expires_at > now())
      )
    where a.account_id = target_account;

    -- A suppressed Account cannot stay claimable cold inventory.
    update accounts set ownership_state = 'SUPPRESSED', current_owner_user_id = null,
                        ownership_updated_at = now()
    where account_id = target_account and is_suppressed and ownership_state = 'UNCLAIMED';
  end if;

  if target_endpoint is not null then
    update contact_endpoints e set is_suppressed = exists (
      select 1 from suppressions s
      where s.endpoint_id = e.endpoint_id and s.is_active
        and (s.expires_at is null or s.expires_at > now())
    ) where e.endpoint_id = target_endpoint;
  end if;

  return null;
end;
$$;
create trigger suppressions_sync after insert or update or delete on suppressions
  for each row execute function suppressions_sync_flags();
