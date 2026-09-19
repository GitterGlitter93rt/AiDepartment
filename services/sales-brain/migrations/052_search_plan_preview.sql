-- 052_search_plan_preview.sql — a paid search is reviewed before it is bought.
--
-- `POST /api/mining/jobs` took a vertical and a geography and submitted chargeable
-- provider tasks. Nobody saw the queries first, nothing recorded what was shown, and
-- there was no way afterwards to tell what a person had agreed to pay for: the run
-- reported what it bought, which is not the same thing as what was authorised.
--
-- A plan is built server-side, shown, and hashed over every field that changes what
-- is bought. Confirmation carries the plan id and that hash and nothing else, so a
-- client cannot substitute queries between review and submission -- and when the plan
-- would now be different, the hash no longer matches and the submission is refused
-- rather than quietly buying something else.
create table if not exists search_plan_previews (
  plan_id       uuid primary key default gen_random_uuid(),
  -- sha256 over the canonical plan. Recomputed at confirmation, never trusted.
  plan_hash     text not null,
  -- Exactly what was shown, so a refusal can say what changed.
  plan          jsonb not null,
  requested_by  uuid references users(user_id) on delete set null,
  created_at    timestamptz not null default now(),
  -- Short: a plan is a quote for a market's current state, and the state moves.
  expires_at    timestamptz not null,
  -- Set when this plan was used to submit. A plan buys at most one run.
  consumed_at   timestamptz,
  consumed_job_id uuid references jobs(job_id) on delete set null
);
create index if not exists search_plan_previews_expiry_idx
  on search_plan_previews(expires_at);
