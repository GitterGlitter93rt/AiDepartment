-- 019_internal_audio_pilot.sql — internal audio pilot allowlist and batches.
-- Authority: outbound-sales-brain-shared-twilio-number-dual-service-spec.md §6, §10;
-- outbound-sales-brain-ai-pilot-release-gates.v1.yaml G19.
--
-- This exists so the first audio call can be made to a number we own, deliberately,
-- one at a time, without any part of it resembling prospect calling.
--
-- Three guarantees are in the schema rather than in code, so they hold against code
-- that has not been written yet:
--
--   1. an allowlist entry names a number we control and says who vouched for it;
--   2. a batch has an operator-set ceiling, and it is small;
--   3. an internal test clearance is a different kind of thing from production
--      eligibility — it lives in its own table, with its own vocabulary, and no
--      production query reads it.

create table internal_test_numbers (
  internal_test_number_id uuid primary key default gen_random_uuid(),
  normalized_value  text not null unique,
  display_value     text not null,
  label             text not null,
  -- Who vouched for it. An allowlist without an owner is not an allowlist.
  added_by          uuid not null references users(user_id),
  -- Why this number is safe to call: whose handset it is.
  justification     text not null check (length(trim(justification)) >= 10),
  added_at          timestamptz not null default now(),
  revoked_at        timestamptz,
  revoked_by        uuid references users(user_id),
  revoked_reason    text,
  constraint internal_test_revocation_complete
    check ((revoked_at is null and revoked_by is null)
        or (revoked_at is not null and revoked_by is not null and revoked_reason is not null))
);

-- A batch is one operator sitting down to make a small number of calls.
create table audio_pilot_batches (
  audio_pilot_batch_id uuid primary key default gen_random_uuid(),
  created_by        uuid not null references users(user_id),
  purpose           text not null check (length(trim(purpose)) >= 10),
  internal_test_number_id uuid not null references internal_test_numbers(internal_test_number_id),
  -- Small on purpose. Raising it is an explicit operator act, and it still cannot
  -- exceed what the check allows.
  max_calls         integer not null check (max_calls between 1 and 10),
  calls_started     integer not null default 0,
  state             text not null default 'OPEN'
                    check (state in ('OPEN','PAUSED','STOPPED','COMPLETE')),
  stopped_reason    text,
  created_at        timestamptz not null default now(),
  closed_at         timestamptz,
  constraint audio_pilot_within_ceiling check (calls_started <= max_calls)
);
create index audio_pilot_batches_state_idx on audio_pilot_batches(state, created_at desc);

-- One row per attempt, whether or not it was permitted. A refusal is evidence too.
create table audio_pilot_attempts (
  audio_pilot_attempt_id uuid primary key default gen_random_uuid(),
  audio_pilot_batch_id uuid not null references audio_pilot_batches(audio_pilot_batch_id)
                       on delete cascade,
  voice_call_id     uuid references voice_calls(voice_call_id) on delete set null,
  requested_by      uuid not null references users(user_id),
  requested_at      timestamptz not null default now(),
  -- INTERNAL_TEST_ALLOW is deliberately not one of the production decisions. Nothing
  -- may read this column and conclude a prospect may be called.
  clearance         text not null
                    check (clearance in ('INTERNAL_TEST_ALLOW','REFUSED')),
  refusal_reasons   text[] not null default '{}',
  -- The opener is computed before the call and stored, so what was spoken is known
  -- even if research changes afterwards.
  precomputed_opener text,
  call_pack_id      uuid references call_packs(call_pack_id),
  -- Filled in after the call from the transport's own telemetry.
  latency_marks     jsonb not null default '{}'::jsonb,
  barge_in_events   jsonb not null default '[]'::jsonb,
  outcome           text,
  qa_result         text check (qa_result in ('PASS','FAIL','INCONCLUSIVE')),
  qa_notes          text,
  reviewed_by       uuid references users(user_id),
  reviewed_at       timestamptz
);
create index audio_pilot_attempts_batch_idx
  on audio_pilot_attempts(audio_pilot_batch_id, requested_at desc);

-- One active internal call at a time, enforced by the database rather than by hope.
create unique index audio_pilot_one_active_call
  on audio_pilot_attempts((true))
  where clearance = 'INTERNAL_TEST_ALLOW' and outcome is null;
