-- 009_email_sync.sql — email execution channel state.
-- Authority: outbound-sales-brain-smartlead-sync-spec.md.
--
-- Smartlead executes YAD's email strategy; it is never the master prospect database.
-- Everything here correlates back to a canonical Account and Contact so a reply
-- lands in the same memory as a phone call or a field visit.

create table email_campaigns (
  email_campaign_id  uuid primary key default gen_random_uuid(),
  name               text not null,
  provider           text not null default 'smartlead',
  provider_campaign_id text,
  vertical_profile_id text references vertical_profiles(vertical_profile_id),
  hook_family        text,
  status             text not null default 'DRAFT'
                     check (status in ('DRAFT','ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
  -- Which endpoint qualities this campaign will accept. A campaign requiring
  -- verified addresses must never be silently topped up with guesses.
  minimum_email_quality text not null default 'PUBLIC_OBSERVED_CURRENT',
  created_by         uuid references users(user_id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger email_campaigns_updated_at before update on email_campaigns
  for each row execute function set_updated_at();

-- One row per Account/Contact placed into a campaign. This is the correlation
-- record: a reply is never matched on email address alone (spec §4).
create table email_enrollments (
  enrollment_id      uuid primary key default gen_random_uuid(),
  email_campaign_id  uuid not null references email_campaigns(email_campaign_id) on delete cascade,
  account_id         uuid not null references accounts(account_id) on delete cascade,
  contact_id         uuid references contacts(contact_id) on delete set null,
  endpoint_id        uuid references contact_endpoints(endpoint_id) on delete set null,
  normalized_email   text not null,
  provider_lead_id   text,
  -- Exactly what was sent, so an outcome attributes to a real strategy (spec §12).
  subject_variant    text,
  personalized_line  text,
  cta_variant        text,
  call_pack_id       uuid references call_packs(call_pack_id) on delete set null,
  discovery_source   text,
  status             text not null default 'PENDING_EXPORT'
                     check (status in ('PENDING_EXPORT','EXPORTED','SENT','DELIVERED','BOUNCED',
                                       'REPLIED','UNSUBSCRIBED','PAUSED','STOPPED','FAILED')),
  exported_at        timestamptz,
  last_event_at      timestamptz,
  stop_reason        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger email_enrollments_updated_at before update on email_enrollments
  for each row execute function set_updated_at();
-- One live enrollment per contact per campaign; duplicates are a spec §14 failure.
create unique index email_enrollments_unique_live
  on email_enrollments(email_campaign_id, account_id, normalized_email)
  where status not in ('STOPPED','FAILED','UNSUBSCRIBED');
create index email_enrollments_account_idx on email_enrollments(account_id);
create index email_enrollments_provider_idx on email_enrollments(provider_lead_id)
  where provider_lead_id is not null;

-- Append-only provider event log. Idempotent by provider event id (spec §17).
create table email_events (
  email_event_id     uuid primary key default gen_random_uuid(),
  enrollment_id      uuid references email_enrollments(enrollment_id) on delete cascade,
  account_id         uuid references accounts(account_id) on delete cascade,
  provider           text not null default 'smartlead',
  provider_event_id  text,
  event_type         text not null
                     check (event_type in ('CAMPAIGN_ASSIGNED','SENT','DELIVERED','OPENED',
                                           'BOUNCED','REPLIED','UNSUBSCRIBED','COMPLAINT',
                                           'SEQUENCE_STOPPED','CAMPAIGN_COMPLETE')),
  reply_class        text check (reply_class in ('POSITIVE_INTEREST','QUESTION','SEND_INFO',
                                                 'CORRECT_PERSON_REFERRAL','TIMING_LATER',
                                                 'ALREADY_SOLVED','NOT_INTERESTED',
                                                 'UNSUBSCRIBE_OPT_OUT','WRONG_PERSON',
                                                 'WRONG_COMPANY','OUT_OF_OFFICE','BOUNCE',
                                                 'OTHER_REVIEW')),
  reply_excerpt      text,
  payload            jsonb not null default '{}'::jsonb,
  occurred_at        timestamptz not null default now(),
  received_at        timestamptz not null default now()
);
-- A replayed webhook must change state once, not twice.
create unique index email_events_provider_idx on email_events(provider, provider_event_id)
  where provider_event_id is not null;
create index email_events_account_idx on email_events(account_id, occurred_at desc);

-- Durable outbox so a provider outage cannot lose an export or duplicate one (spec §17).
create table email_outbox (
  outbox_id          bigserial primary key,
  enrollment_id      uuid not null references email_enrollments(enrollment_id) on delete cascade,
  operation          text not null check (operation in ('EXPORT','PAUSE','STOP','UPDATE')),
  payload            jsonb not null default '{}'::jsonb,
  status             text not null default 'PENDING'
                     check (status in ('PENDING','SENT','FAILED','ABANDONED')),
  attempts           integer not null default 0,
  last_error         text,
  run_after          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);
create index email_outbox_pending_idx on email_outbox(status, run_after) where status = 'PENDING';
