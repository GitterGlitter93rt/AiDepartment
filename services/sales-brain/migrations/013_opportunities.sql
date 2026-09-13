-- 013_opportunities.sql — qualified pipeline.
-- Authority: outbound-sales-brain-opportunity-qualification-spec.md,
-- outbound-sales-brain-account-opportunity-lifecycle-spec.md,
-- YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §14-§15.
--
-- "Cold prospects do not belong in opportunity pipeline before meaningful
-- qualification." An opportunity requires a stated problem, not positive sentiment.

create table opportunities (
  opportunity_id     uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(account_id) on delete cascade,
  contact_id         uuid references contacts(contact_id) on delete set null,
  owner_user_id      uuid not null references users(user_id),
  title              text not null,
  stage              text not null default 'DISCOVERY'
                     check (stage in ('DISCOVERY','FINANCIAL_DIAGNOSIS','STRATEGY',
                                      'PROPOSAL_DECISION','CLOSED_WON','CLOSED_LOST')),
  -- The problem in the prospect's terms. An opportunity cannot exist without one.
  problem_summary    text not null,
  desired_outcome    text,
  confirmed_workflow text,
  /* Economic inputs the prospect actually supplied, each with its source, so an
     illustrative assumption can never be mistaken for something they said. */
  business_case_inputs jsonb not null default '[]'::jsonb,
  unknowns           text[] not null default '{}',
  stakeholders       jsonb not null default '[]'::jsonb,
  strategy_notes     text,
  next_step          text,
  next_step_at       timestamptz,
  -- Only recorded when it is legitimately known; never estimated to look better.
  value_amount       numeric(12,2),
  value_basis        text,
  source_channel     text,
  source_activity_id bigint references activities(activity_id) on delete set null,
  source_booking_id  uuid references meeting_bookings(booking_id) on delete set null,
  close_reason       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  closed_at          timestamptz,

  constraint opportunities_problem_required check (length(btrim(problem_summary)) >= 10),
  constraint opportunities_closed_needs_reason check (
    stage not in ('CLOSED_WON','CLOSED_LOST') or close_reason is not null
  ),
  constraint opportunities_value_needs_basis check (
    value_amount is null or value_basis is not null
  )
);
create trigger opportunities_updated_at before update on opportunities
  for each row execute function set_updated_at();
create index opportunities_owner_idx on opportunities(owner_user_id, stage);
create index opportunities_account_idx on opportunities(account_id);
create index opportunities_stage_idx on opportunities(stage, updated_at desc);
-- One live opportunity per Account: a second one is a data-entry mistake, not a deal.
create unique index opportunities_one_live_per_account
  on opportunities(account_id) where stage not in ('CLOSED_WON','CLOSED_LOST');

-- Append-only stage history. No browser-only drag/drop mutation.
create table opportunity_stage_events (
  stage_event_id     bigserial primary key,
  opportunity_id     uuid not null references opportunities(opportunity_id) on delete cascade,
  from_stage         text,
  to_stage           text not null,
  reason             text not null,
  actor_user_id      uuid not null references users(user_id),
  occurred_at        timestamptz not null default now()
);
create index opportunity_stage_events_idx on opportunity_stage_events(opportunity_id, occurred_at desc);

create or replace function opportunity_stage_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'opportunity_stage_events is append-only' using errcode = 'restrict_violation';
end;
$$;
create trigger opportunity_stage_events_no_rewrite before update or delete on opportunity_stage_events
  for each row execute function opportunity_stage_events_append_only();

alter table accounts add column active_opportunity_id uuid references opportunities(opportunity_id);
