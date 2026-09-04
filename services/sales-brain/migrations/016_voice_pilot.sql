-- 016_voice_pilot.sql — Sales AI pilot control plane and call review.
-- Authority: outbound-sales-brain-shared-twilio-number-dual-service-spec.md §6-§7,
-- YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §17-§18,
-- yad-sales-crm-page-acceptance-matrix.v1.yaml (/ai/pilot, /calls/:callId).
--
-- Two rules are enforced here rather than left to the UI:
--   1. Adding a prospect to the pilot must never dial. Candidacy and dialling are
--      separate states, and the dial state can only be reached through a preflight.
--   2. A mode change affects new calls only. Every call snapshots the profile and
--      mode it started under, so an operator toggle cannot rewrite a live session.

-- One row. The operator's switches, held separately rather than as one ambiguous
-- AI ON/OFF, so inbound can stay up while outbound is disabled.
create table voice_pilot_state (
  singleton              boolean primary key default true check (singleton),
  outbound_mode          text not null default 'OFF'
                         check (outbound_mode in ('OFF','INTERNAL_TEST','CONTROLLED_PILOT','ENABLED_BY_POLICY')),
  inbound_receptionist   boolean not null default true,
  outbound_dial_enabled  boolean not null default false,
  auto_book_enabled      boolean not null default false,
  warm_transfer_enabled  boolean not null default false,
  -- The pilot starts at one call at a time. Raising it is an operator decision.
  max_concurrency        integer not null default 1 check (max_concurrency between 0 and 20),
  stop_reason            text,
  updated_by             uuid references users(user_id),
  updated_at             timestamptz not null default now()
);
insert into voice_pilot_state (singleton) values (true) on conflict do nothing;

create table voice_pilot_state_events (
  event_id     bigserial primary key,
  actor_user_id uuid references users(user_id),
  field        text not null,
  old_value    text,
  new_value    text,
  reason       text not null,
  occurred_at  timestamptz not null default now()
);
create index voice_pilot_state_events_time_idx on voice_pilot_state_events(occurred_at desc);

-- A candidate is a prospect an operator has queued for review. It carries the
-- eligibility result that was true when it was added, and the immutable Call Pack
-- reference, so the preview cannot drift from what would actually be spoken.
create table pilot_candidates (
  pilot_candidate_id uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(account_id) on delete cascade,
  contact_id         uuid references contacts(contact_id),
  endpoint_id        uuid references contact_endpoints(endpoint_id),
  call_pack_id       uuid references call_packs(call_pack_id),
  -- Never 'DIALLING' by insertion: reaching that state requires a preflight row.
  state              text not null default 'CANDIDATE'
                     check (state in ('CANDIDATE','PREFLIGHT_PASSED','PREFLIGHT_FAILED',
                                      'QUEUED','CALLED','REMOVED')),
  eligibility_at_add text not null
                     check (eligibility_at_add in ('ALLOW','REVIEW_REQUIRED','BLOCK','UNKNOWN')),
  eligibility_reason text,
  evaluated_at       timestamptz,
  added_by           uuid not null references users(user_id),
  added_at           timestamptz not null default now(),
  removed_at         timestamptz
);
create index pilot_candidates_state_idx on pilot_candidates(state, added_at desc);
-- One live candidacy per Account. Re-adding a removed or completed one is allowed.
create unique index pilot_candidates_one_active_per_account
  on pilot_candidates(account_id)
  where state in ('CANDIDATE','PREFLIGHT_PASSED','QUEUED');

-- One row per voice call, inbound or outbound. `agent_profile_id` and `mode_at_start`
-- are the immutable snapshot the dual-service spec §7 requires.
create table voice_calls (
  voice_call_id      uuid primary key default gen_random_uuid(),
  direction          text not null check (direction in ('INBOUND','OUTBOUND')),
  agent_profile_id   text not null,
  prompt_version     text,
  mode_at_start      text not null,
  account_id         uuid references accounts(account_id) on delete set null,
  contact_id         uuid references contacts(contact_id),
  endpoint_id        uuid references contact_endpoints(endpoint_id),
  call_pack_id       uuid references call_packs(call_pack_id),
  provider_call_sid  text unique,
  from_number        text,
  to_number          text,
  started_at         timestamptz not null default now(),
  connected_at       timestamptz,
  ended_at           timestamptz,
  duration_seconds   integer,
  outcome            text check (outcome in ('CONNECTED','NO_ANSWER','VOICEMAIL','BUSY',
                                             'FAILED','DECLINED','GATEKEEPER','WRONG_NUMBER',
                                             'DNC','BOOKED','CALLBACK','NO_SALE')),
  readiness_decision text,
  disposition        text,
  -- Measured, not claimed: what the runtime could actually observe.
  latency_ms         jsonb not null default '{}'::jsonb,
  -- QA is entered by a reviewer; a call is never self-scored.
  qa_score           integer check (qa_score between 0 and 100),
  qa_hard_failure    boolean not null default false,
  qa_categories      jsonb not null default '{}'::jsonb,
  root_cause         text check (root_cause in ('research','contact_data','opener','dialogue',
                                                'model','stt','tts','latency','telephony',
                                                'booking','policy','other')),
  reviewer_notes     text,
  reviewed_by        uuid references users(user_id),
  reviewed_at        timestamptz,
  review_action      text check (review_action in ('KEEP','RETEST','NEEDS_SCRIPT_CHANGE','RUNTIME_ISSUE')),
  recording_url      text,
  created_at         timestamptz not null default now()
);
create index voice_calls_started_idx on voice_calls(started_at desc);
create index voice_calls_account_idx on voice_calls(account_id, started_at desc);
create index voice_calls_review_idx on voice_calls(reviewed_at nulls first, started_at desc);

-- The transcript, with speaker separation. Turns are append-only: a reviewer may add
-- notes on the call, never edit what was said.
create table voice_call_turns (
  turn_id        bigserial primary key,
  voice_call_id  uuid not null references voice_calls(voice_call_id) on delete cascade,
  turn_index     integer not null,
  speaker        text not null check (speaker in ('AGENT','PROSPECT','SYSTEM')),
  text           text not null,
  offset_ms      integer,
  interrupted    boolean not null default false,
  component_id   text,
  unique (voice_call_id, turn_index)
);

-- State transitions and tool calls, for the review timeline. Never chain-of-thought.
create table voice_call_events (
  event_id       bigserial primary key,
  voice_call_id  uuid not null references voice_calls(voice_call_id) on delete cascade,
  occurred_at    timestamptz not null default now(),
  offset_ms      integer,
  kind           text not null check (kind in ('STATE','TOOL_CALL','TOOL_RESULT','LATENCY',
                                               'INTERRUPT','POLICY','ERROR')),
  label          text not null,
  detail         jsonb not null default '{}'::jsonb
);
create index voice_call_events_call_idx on voice_call_events(voice_call_id, occurred_at);
