-- 049_lead_response_probe.sql — measuring what happens to a new lead, once, provably.
--
-- `speed_to_lead` fires today from ad presence and the vertical profiles then forbid
-- saying anything about actual response time
-- (`must_not_claim: [current_response_time_without_measurement]`). The prohibition is
-- right, because nothing measured it. These tables are the measurement.
--
-- Two properties are structural rather than conventional, because both are things a
-- later reader would otherwise "fix":
--
--   `execution_mode` separates a simulated probe from a live one at the row level.
--   Dry-run rows are real rows -- the state machine, the allocator and the
--   attribution ladder all run on them -- and they must never reach a rep as
--   measured evidence. The reader in domain code filters to LIVE by default; the
--   operator packet asks for DRY_RUN explicitly.
--
--   `business_hours_adjusted_seconds` is nullable and `business_hours_source`
--   defaults to NONE. Nothing in this system holds published business hours, so the
--   honest adjusted figure is usually absent. Absent is not zero, and it is not an
--   assumed nine-to-five.

-- ---------------------------------------------------------------------------
-- Registered probe identities.
--
-- A form asking for a name gets a fictitious one from a small approved set, never a
-- real person's, and never invented per-probe. Versioned so "who did we appear to
-- be" is answerable months later.
-- ---------------------------------------------------------------------------
create table if not exists probe_identities (
  probe_identity_id uuid primary key default gen_random_uuid(),
  full_name         text not null,
  version           integer not null default 1,
  is_active         boolean not null default true,
  -- Who approved this identity for use. Product decision, not an engineering one.
  approved_by       text,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (full_name, version)
);

comment on table probe_identities is
  'Approved fictitious identities for probe form fields. Never a real unrelated '
  'person, an employee without approval, a competitor, a customer, or anyone '
  'associated with the target company.';

-- ---------------------------------------------------------------------------
-- The shared Twilio pool.
--
-- One number services many simultaneously open probes. The number is transport; the
-- probe is the identity. Nothing may infer an Account from a number alone.
-- ---------------------------------------------------------------------------
create table if not exists probe_pool_numbers (
  pool_number_id  uuid primary key default gen_random_uuid(),
  e164            text not null unique,
  twilio_sid      text unique,
  -- Preferred market, used only to break ties among non-colliding candidates.
  market_affinity text,
  status          text not null default 'ACTIVE'
                  check (status in ('ACTIVE','QUARANTINED','RELEASED')),
  -- Attribution-quality guard, separate from collision. Collision protects the
  -- number-match rungs; this protects the "which company are you calling from"
  -- rung, which resolves cleanly against fifteen candidates and less cleanly
  -- against two hundred.
  max_concurrent_open_probes integer not null default 25
                  check (max_concurrent_open_probes > 0),
  -- A closed probe's number is not reused immediately: a late response must
  -- attribute to the probe that earned it, not to whoever inherited the number.
  quarantined_until timestamptz,
  execution_mode  text not null default 'DRY_RUN'
                  check (execution_mode in ('DRY_RUN','LIVE')),
  created_at      timestamptz not null default now()
);

create index if not exists probe_pool_numbers_available_idx
  on probe_pool_numbers (status, execution_mode) where status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- The probe ledger. One row per probe, and the durable identity of the whole
-- subsystem.
-- ---------------------------------------------------------------------------
create table if not exists lead_response_probes (
  probe_id          uuid primary key default gen_random_uuid(),
  -- The canonical Account. No second prospect database: this references accounts,
  -- and readers resolve it through resolveAccountId() so a merge cannot orphan a probe.
  account_id        uuid not null references accounts(account_id) on delete cascade,

  -- Selection provenance: why this company, and from what observation.
  geography_type    text,
  geography_value   text,
  vertical_profile_id text,
  discovery_observation_id uuid references search_observations(observation_id) on delete set null,
  paid_ad_evidence_ids uuid[] not null default '{}',
  -- The passive funnel observation this probe was built from, so the form we
  -- submitted is the one that was audited. No FK: that table does not exist yet.
  target_funnel_observation_id uuid,
  target_form_url   text,

  -- Transport and submitted identity.
  assigned_pool_number_id uuid references probe_pool_numbers(pool_number_id) on delete restrict,
  submitted_identity_id   uuid references probe_identities(probe_identity_id) on delete restrict,
  -- Opaque, single-use, never sequential: this token is handed to a third party and
  -- must not leak probe volume or ordering.
  probe_token       text not null unique,
  submitted_email_alias text,
  submitted_at      timestamptz,
  -- Proves what was submitted without storing a re-submittable payload.
  submitted_payload_digest text,
  submitted_payload_summary jsonb not null default '{}'::jsonb,
  -- Recorded verbatim. V1 checks nothing: a mandatory consent gate makes the form
  -- ineligible rather than being reinterpreted.
  consent_checkboxes_presented jsonb not null default '[]'::jsonb,
  consent_checkboxes_checked   jsonb not null default '[]'::jsonb,

  -- Identity snapshot at submission. Snapshotted because attribution must survive a
  -- later merge, rename or phone edit.
  account_name_at_submission   text,
  account_domain_at_submission text,
  account_phones_at_submission text[] not null default '{}',
  account_alternate_phones_at_submission text[] not null default '{}',
  -- What would make this probe ambiguous against another. Snapshotted for the same
  -- reason, and read by the allocator.
  collision_keys    text[] not null default '{}',

  status            text not null default 'PLANNED'
                    check (status in (
                      'PLANNED','AUTHORIZED','SUBMITTING','SUBMITTED',
                      'AUTO_ACKNOWLEDGED','RESPONDED','ATTRIBUTED','AMBIGUOUS',
                      'NO_RESPONSE_WINDOW_1','NO_RESPONSE_FINAL','CANCELLED','FAILED'
                    )),
  -- Why a probe is not eligible, or why it failed. A fact about the form or about
  -- us, never about the company.
  ineligible_reason text,

  attribution_state text not null default 'UNATTRIBUTED'
                    check (attribution_state in ('UNATTRIBUTED','ATTRIBUTED','AMBIGUOUS','CONTESTED')),
  attribution_confidence text not null default 'NONE'
                    check (attribution_confidence in ('HIGH','MEDIUM','LOW','NONE')),
  attribution_evidence jsonb not null default '[]'::jsonb,

  -- Six distinct milestones. None substitutes for another, and an automated
  -- acknowledgement is never human follow-up.
  first_automated_sms_at   timestamptz,
  first_automated_sms_event_id uuid,
  first_human_sms_at       timestamptz,
  first_human_sms_event_id uuid,
  first_automated_call_at  timestamptz,
  first_automated_call_event_id uuid,
  first_human_call_at      timestamptz,
  first_human_call_event_id uuid,
  first_email_response_at  timestamptz,
  first_email_response_event_id uuid,
  first_meaningful_contact_at timestamptz,
  first_meaningful_contact_event_id uuid,

  elapsed_to_first_response_seconds  integer,
  elapsed_to_first_meaningful_seconds integer,
  -- Null when hours are unknown. Never zero as a stand-in.
  business_hours_adjusted_seconds    integer,
  business_hours_source text not null default 'NONE'
                    check (business_hours_source in ('PUBLISHED_WEBSITE_HOURS','OPERATOR_CONFIRMED','NONE')),
  business_hours    jsonb,
  submitted_outside_business_hours boolean,

  final_outcome     text,
  window_1_closed_at    timestamptz,
  window_final_closed_at timestamptz,
  -- No re-probe before this instant. Enforced as a precondition, not a suggestion.
  cooldown_until    timestamptz,

  authorized_by     uuid references users(user_id) on delete set null,
  authorized_at     timestamptz,

  execution_mode    text not null default 'DRY_RUN'
                    check (execution_mode in ('DRY_RUN','LIVE')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One open probe per Account, enforced here rather than in application logic. The
-- resting state for a deferred probe is PLANNED, so PLANNED counts as open: two
-- planned probes for one company is the duplicate this prevents.
create unique index if not exists probe_one_open_per_account_idx
  on lead_response_probes (account_id)
  where status in ('PLANNED','AUTHORIZED','SUBMITTING','SUBMITTED',
                   'AUTO_ACKNOWLEDGED','RESPONDED');

-- Mirrors AWAITING_RESPONSE_STATUSES in src/probe/states.ts. NO_RESPONSE_WINDOW_1
-- is included because window 1 closing is provisional: a late callback must still
-- find its probe.
create index if not exists probe_open_on_number_idx
  on lead_response_probes (assigned_pool_number_id)
  where status in ('SUBMITTED','AUTO_ACKNOWLEDGED','RESPONDED','NO_RESPONSE_WINDOW_1');

create index if not exists probe_account_idx on lead_response_probes (account_id, created_at desc);
create index if not exists probe_collision_keys_idx on lead_response_probes using gin (collision_keys);

comment on column lead_response_probes.execution_mode is
  'DRY_RUN rows are real rows that never happened to a real company. They exercise '
  'the state machine, allocator and attribution ladder, and they must never reach a '
  'rep as measured evidence: probeEvidenceFor() filters to LIVE unless a caller '
  'explicitly asks for simulated rows.';

comment on column lead_response_probes.business_hours_adjusted_seconds is
  'Null when this Account''s business hours are not known, which is the normal case. '
  'Null renders as "not available", never as zero and never as an assumed 9-5.';

-- ---------------------------------------------------------------------------
-- Every inbound event on a pool number, attributed or not.
--
-- An unattributable event is data about our attribution, not a fact about anybody.
-- It is still stored, because an AMBIGUOUS verdict is only reviewable if the
-- candidates were written down.
-- ---------------------------------------------------------------------------
create table if not exists probe_inbound_events (
  event_id        uuid primary key default gen_random_uuid(),
  -- Twilio CallSid or MessageSid. The idempotency key: a redelivered webhook is the
  -- same event, not a second response.
  provider_sid    text not null unique,
  channel         text not null check (channel in ('CALL','SMS','EMAIL')),
  from_number     text,
  from_number_raw text,
  from_email      text,
  to_number       text,
  pool_number_id  uuid references probe_pool_numbers(pool_number_id) on delete set null,
  occurred_at     timestamptz not null,
  received_at     timestamptz not null default now(),
  -- The inbound message itself, and the only place this subsystem keeps third-party
  -- prose. It is kept because it *is* the evidence: a self-identifying SMS is an
  -- attribution rung, and the body is what the cross-probe automation fingerprint is
  -- computed from. Without it an AMBIGUOUS verdict is unreviewable.
  --
  -- Bounded on purpose. `tests/retention.test.ts` exists to stop the schema quietly
  -- becoming a store of somebody else's content -- a scraped page, a provider
  -- response, a transcript -- and it was right to flag this column. The answer is a
  -- limit rather than a rename: an SMS fits well inside 2000 characters, and an email
  -- is truncated to a classification excerpt on the way in rather than archived here.
  message_body    text check (message_body is null or char_length(message_body) <= 2000),
  -- Normalized body, so the same template across two probes is recognisable. This is
  -- the cheapest strong automation signal the pool produces, and it improves as the
  -- pool runs.
  body_fingerprint text,
  call_disposition text,

  actor_type      text not null default 'UNKNOWN'
                  check (actor_type in ('HUMAN','AUTOMATED','UNKNOWN')),
  actor_type_evidence jsonb not null default '[]'::jsonb,
  -- Structured answer to the one neutral identification question, when asked.
  identification_answer text,

  attributed_probe_id uuid references lead_response_probes(probe_id) on delete set null,
  attribution_tier    text,
  attribution_confidence text not null default 'NONE'
                  check (attribution_confidence in ('HIGH','MEDIUM','LOW','NONE')),
  attribution_evidence jsonb not null default '[]'::jsonb,
  -- Every probe that stayed plausible, kept even when one won.
  candidate_probe_ids uuid[] not null default '{}',

  execution_mode  text not null default 'DRY_RUN'
                  check (execution_mode in ('DRY_RUN','LIVE')),
  created_at      timestamptz not null default now()
);

create index if not exists probe_events_probe_idx on probe_inbound_events (attributed_probe_id, occurred_at);
create index if not exists probe_events_fingerprint_idx on probe_inbound_events (body_fingerprint)
  where body_fingerprint is not null;
create index if not exists probe_events_pool_idx on probe_inbound_events (pool_number_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- State history. Never overwritten: a probe's path is evidence too.
-- ---------------------------------------------------------------------------
create table if not exists probe_state_events (
  probe_state_event_id bigserial primary key,
  probe_id        uuid not null references lead_response_probes(probe_id) on delete cascade,
  from_status     text,
  to_status       text not null,
  reason          text,
  actor           text,
  occurred_at     timestamptz not null default now()
);

create index if not exists probe_state_events_probe_idx on probe_state_events (probe_id, probe_state_event_id);

-- ---------------------------------------------------------------------------
-- "Do not audit us again" is narrower than "do not contact us".
--
-- Reuses the existing suppression machinery rather than adding a second suppression
-- concept. PROBE_AUDIT suppresses probing only; a company that also asks not to be
-- contacted gets ordinary DNC treatment alongside it.
-- ---------------------------------------------------------------------------
alter table suppressions drop constraint if exists suppressions_suppression_type_check;
alter table suppressions add constraint suppressions_suppression_type_check
  check (suppression_type in (
    'DNC','EMAIL_UNSUBSCRIBE','LEGAL_POLICY','CLIENT_NO_COLD_OUTREACH',
    'WRONG_ENTITY','OTHER_APPROVED',
    -- Do not audit/test us again. Does not by itself stop ordinary sales outreach.
    'PROBE_AUDIT'
  ));
