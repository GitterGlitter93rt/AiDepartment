-- 020_media_capture_policy.sql — media capture consent, and QA that works without it.
-- Authority: outbound-sales-brain-florida-recording-transcription-policy-research-2026-09.md
-- §4, §5, §6, §9, §10.
--
-- Florida default: no durable audio and no verbatim transcript unless consent evidence
-- exists under the reviewed rule. The schema is built so the conservative answer is
-- the one you get by doing nothing:
--
--   * a capture mode is permitted only when a consent row says so;
--   * the consent row cannot be written by inference — it names the party, the
--     language version and the policy version that allowed it;
--   * scenario QA stores metrics and structured outcomes, with no column that can
--     hold audio or a verbatim utterance.

create table media_capture_consent (
  media_consent_id  uuid primary key default gen_random_uuid(),
  voice_call_id     uuid references voice_calls(voice_call_id) on delete cascade,
  account_id        uuid references accounts(account_id) on delete set null,
  contact_id        uuid references contacts(contact_id),
  jurisdiction      text not null,
  capture_modes     text[] not null default '{}',
  consent_status    text not null
                    check (consent_status in ('GRANTED','REFUSED','UNKNOWN','REVOKED')),
  -- Who agreed, and in what words. "They stayed on the phone" is not any of these.
  consenting_party_identity_or_role text,
  consent_language_version text,
  consent_obtained_at timestamptz,
  source_call_event_id bigint,
  policy_version    text not null,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint media_consent_granted_needs_evidence
    check (consent_status <> 'GRANTED'
        or (consenting_party_identity_or_role is not null
            and consent_language_version is not null
            and consent_obtained_at is not null))
);
create index media_capture_consent_call_idx on media_capture_consent(voice_call_id);

-- One row per scenario run in an audio regression pass. No audio, no utterances: the
-- columns available are metrics, marks and a structured verdict, so "debug audio
-- under another name" has nowhere to go.
create table audio_scenario_runs (
  audio_scenario_run_id uuid primary key default gen_random_uuid(),
  audio_pilot_attempt_id uuid references audio_pilot_attempts(audio_pilot_attempt_id)
                         on delete cascade,
  scenario_id       text not null,
  gate_reference    text,
  ran_at            timestamptz not null default now(),
  ran_by            uuid references users(user_id),
  /** TEXT means the scenario was exercised in text; AUDIO means over a real call. */
  medium            text not null default 'TEXT' check (medium in ('TEXT','AUDIO')),
  result            text not null check (result in ('PASS','FAIL','INCONCLUSIVE','NOT_RUN')),
  -- Deterministic checks the runner made, as {check: boolean}.
  checks            jsonb not null default '{}'::jsonb,
  -- Timeline marks in milliseconds, per the QA-without-recording list.
  latency_marks     jsonb not null default '{}'::jsonb,
  interruption_marks jsonb not null default '[]'::jsonb,
  tool_events       jsonb not null default '[]'::jsonb,
  state_transitions jsonb not null default '[]'::jsonb,
  -- Structured outcome only. A failure names the check, not the words spoken.
  failed_checks     text[] not null default '{}',
  notes             text,
  unique (audio_pilot_attempt_id, scenario_id, medium)
);
create index audio_scenario_runs_scenario_idx on audio_scenario_runs(scenario_id, ran_at desc);
