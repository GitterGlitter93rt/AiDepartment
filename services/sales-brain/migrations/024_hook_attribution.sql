-- 024_hook_attribution.sql — one row per outbound attempt, with everything needed to
-- compare hooks without changing five variables at once.
-- Authority: outbound-sales-brain-sales-ai-metric-definitions.v1.yaml,
-- outbound-sales-brain-sales-ai-hook-selection-matrix.v1.yaml.
--
-- The point of this table is that a comparison is only as good as its cohort. Every
-- dimension the metric definitions call for is stored on the attempt, so a variant
-- can be compared inside a cohort rather than across the whole book.
--
-- Two properties are in the schema rather than the code:
--   1. base events are stored as facts with their own timestamps, so a rate always
--      has a numerator and a denominator that can be recounted;
--   2. downstream quality lands on the same row, so "booked" can never be the last
--      word about whether a hook worked.

create table hook_attempts (
  hook_attempt_id   uuid primary key default gen_random_uuid(),
  account_id        uuid references accounts(account_id) on delete set null,
  contact_id        uuid references contacts(contact_id),
  endpoint_id       uuid references contact_endpoints(endpoint_id) on delete set null,
  voice_call_id     uuid references voice_calls(voice_call_id) on delete set null,
  call_pack_id      uuid references call_packs(call_pack_id),

  -- What was tried. These are the experiment dimensions.
  opener_version    text not null,
  opener_frame      text not null,
  hook_family       text,
  hypothesis_category text,
  -- Which evidence records the opener leaned on, so a claim can be traced back.
  evidence_ids      uuid[] not null default '{}',
  stakeholder_route text,
  contact_route_class text,
  vertical_profile_id text,
  market_id         uuid references saved_markets(market_id) on delete set null,
  -- Local hour bucket, because when you call changes who answers.
  time_bucket       text,
  agent_profile_id  text not null,
  model_version     text,
  prompt_version    text,
  tier              text,
  advertiser_evidence_class text,
  research_completeness_band text,
  pilot_batch_id    uuid references audio_pilot_batches(audio_pilot_batch_id) on delete set null,
  campaign_id       uuid references email_campaigns(email_campaign_id) on delete set null,

  attempted_at      timestamptz not null default now(),

  -- Base events, per the metric definitions. Null means it did not happen; a
  -- timestamp means it did, and when.
  connected_at            timestamptz,
  human_answered_at       timestamptz,
  right_stakeholder_at    timestamptz,
  gatekeeper_route_at     timestamptz,
  first_question_answered_at timestamptz,
  useful_fact_at          timestamptz,
  problem_supported_at    timestamptz,
  strategy_offer_at       timestamptz,
  strategy_accepted_at    timestamptz,
  strategy_booked_at      timestamptz,
  meeting_attended_at     timestamptz,
  opportunity_created_at  timestamptz,
  closed_won_at           timestamptz,
  dnc_at                  timestamptz,
  wrong_number_at         timestamptz,
  no_sale_at              timestamptz,

  conversation_outcome text,
  -- Downstream quality, entered by the person who took the meeting. A booking with a
  -- quality score of one is a worse result than no booking at all.
  michael_quality_score integer check (michael_quality_score between 1 and 5),
  quality_scored_at timestamptz,
  stakeholder_fit   text check (stakeholder_fit in
                     ('DECISION_MAKER','PROCESS_OWNER','INFLUENCER','WRONG_STAKEHOLDER','UNKNOWN')),
  problem_confirmed_at_meeting text check (problem_confirmed_at_meeting in
                     ('CONFIRMED','PARTIALLY_CONFIRMED','NOT_CONFIRMED','NOT_EVALUATED')),

  -- A booking that was later cancelled or rescheduled is not two bookings.
  booking_id        uuid references meeting_bookings(booking_id) on delete set null,
  superseded_by     uuid references hook_attempts(hook_attempt_id),

  notes             text,
  constraint hook_quality_needs_attendance
    check (michael_quality_score is null or meeting_attended_at is not null)
);
create index hook_attempts_variant_idx
  on hook_attempts(opener_version, opener_frame, attempted_at desc);
create index hook_attempts_cohort_idx
  on hook_attempts(vertical_profile_id, market_id, tier, attempted_at desc);
create index hook_attempts_account_idx on hook_attempts(account_id, attempted_at desc);
