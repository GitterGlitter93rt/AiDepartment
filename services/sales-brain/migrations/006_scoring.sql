-- 006_scoring.sql — CanonicalScore, hypotheses, Call Pack.
-- Canonical authority: data-contract §16-§20, score-recognition-policy.md.
--
-- Never award points for `unknown`; research completeness is a separate axis
-- and never subtracts fit points (data-contract §16).

create table canonical_scores (
  canonical_score_id uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  research_run_id  uuid references research_runs(research_run_id) on delete set null,
  score_version    text not null,
  total_points     integer not null,
  tier             text not null check (tier in ('A','B','C','D')),
  components       jsonb not null default '[]'::jsonb,  -- {rule_id, description, points_possible,
                                                        --  points_awarded, evidence_ids[], reason}
  calculated_at    timestamptz not null default now()
);
create index canonical_scores_account_idx on canonical_scores(account_id, calculated_at desc);

create table research_completeness (
  research_completeness_id uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  research_run_id  uuid references research_runs(research_run_id) on delete set null,
  numeric_score    integer not null,
  label            text not null check (label in ('complete','good','partial','thin','stale')),
  components       jsonb not null default '[]'::jsonb,
  generated_at     timestamptz not null default now()
);
create index research_completeness_account_idx on research_completeness(account_id, generated_at desc);

-- A hypothesis is not a factual claim about the prospect (data-contract §18).
create table opportunity_hypotheses (
  opportunity_hypothesis_id uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  category         text not null
                   check (category in ('missed_call','after_hours','speed_to_lead','follow_up',
                                       'unsold_estimate','crm_workflow','attribution','website_conversion',
                                       'paid_acquisition','reactivation','employee_capacity','reporting',
                                       'integration','appointment_no_show','customer_communication','other')),
  hypothesis_text  text not null,
  supporting_evidence_ids uuid[] not null default '{}',
  missing_fact_questions  text[] not null default '{}',
  confidence       text not null default 'unknown'
                   check (confidence in ('confirmed','likely','unknown','contradicted')),
  priority         integer not null default 100,
  generated_by     text not null default 'deterministic',
  is_current       boolean not null default true,
  generated_at     timestamptz not null default now()
);
create index opportunity_hypotheses_account_idx
  on opportunity_hypotheses(account_id, priority) where is_current;

create table offer_hypotheses (
  offer_hypothesis_id uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  offer_family     text not null
                   check (offer_family in ('ai_department_assessment','strategy_call','executive_ai_strategy',
                                           'ai_implementation','ai_growth_systems','managed_ai_department',
                                           'google_ads','meta_ads','seo','crm_system','ai_phone_agent',
                                           'workflow_automation','ai_training','ai_workshop',
                                           'executive_ai_coaching','no_sale_measure_first')),
  rank             integer not null default 1,
  reason           text,
  supporting_opportunity_ids uuid[] not null default '{}',
  required_discovery_questions text[] not null default '{}',
  commercial_truth_reference text,
  must_not_promise text[] not null default '{}',
  is_current       boolean not null default true,
  generated_at     timestamptz not null default now()
);
create index offer_hypotheses_account_idx on offer_hypotheses(account_id, rank) where is_current;

-- CALL PACK — immutable after generation (data-contract §20). Material research
-- change produces a new pack rather than an edit.
create table call_packs (
  call_pack_id     uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  contact_id       uuid references contacts(contact_id) on delete set null,
  research_run_id  uuid references research_runs(research_run_id) on delete set null,
  canonical_score_id uuid references canonical_scores(canonical_score_id) on delete set null,
  manual_snapshot_id text,
  vertical_profile_id text references vertical_profiles(vertical_profile_id),
  generated_at     timestamptz not null default now(),
  expires_at       timestamptz,
  company_summary  text,
  top_confirmed_facts   jsonb not null default '[]'::jsonb,
  important_unknowns    jsonb not null default '[]'::jsonb,
  primary_hypothesis    text,
  backup_hypothesis     text,
  primary_offer_hypothesis text,
  primary_hook     text,
  backup_hook      text,
  recommended_opener text,
  first_questions  jsonb not null default '[]'::jsonb,
  likely_objections jsonb not null default '[]'::jsonb,
  known_system_signals jsonb not null default '[]'::jsonb,
  advertising_evidence_summary text,
  prohibited_claims jsonb not null default '[]'::jsonb,
  allowed_next_steps jsonb not null default '[]'::jsonb,
  commercial_truth_summary text,
  context_version  text not null default 'v1'
);
create index call_packs_account_idx on call_packs(account_id, generated_at desc);

create or replace function call_packs_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'call_packs are immutable: generate a new pack instead of editing %', old.call_pack_id
    using errcode = 'restrict_violation';
end;
$$;
create trigger call_packs_no_update before update on call_packs
  for each row execute function call_packs_immutable();

-- Knowledge snapshot: which Sales Manual commit a Call Pack was built from.
create table knowledge_snapshots (
  manual_snapshot_id text primary key,
  source_commit_sha text,
  source_paths     text[] not null default '{}',
  index_version    text,
  chunking_version text,
  embedding_model  text,
  generated_at     timestamptz not null default now()
);
