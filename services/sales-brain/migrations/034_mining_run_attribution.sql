-- 034_mining_run_attribution.sql — tracing an observation and a cost to the run.
--
-- search_observations and provider_usage both carry mining_job_id, referencing a
-- mining_jobs table that nothing has ever written a row to. Every observation was
-- therefore stored with a null there, and every provider cost was unattributable:
-- the Mining page could show what a run did, and separately show what the provider
-- charged, with no way to connect the two.
--
-- The queue job IS the mining run. Pointing at it directly is simpler than keeping
-- a parallel record in step, and it is the id the operator already sees on the
-- Mining page.

alter table search_observations
  add column if not exists job_id uuid references jobs(job_id) on delete set null;
create index if not exists search_observations_run_idx on search_observations(job_id);

alter table provider_usage
  add column if not exists job_id uuid references jobs(job_id) on delete set null;
create index if not exists provider_usage_run_idx on provider_usage(job_id, requested_at desc);

-- Why the provider call happened, alongside what it cost. A refused call and a
-- successful one both belong in the usage record, or a failing provider looks free.
alter table provider_usage
  add column if not exists geography_value text;
alter table provider_usage
  add column if not exists vertical_profile_id text;

-- A provider that accepted an asynchronous task and has not answered yet is neither
-- a success nor a failure: the money is spent and the results are still coming. It
-- had nowhere to be recorded, so it was reported as a zero-result search.
alter table jobs drop constraint if exists jobs_outcome_check;
alter table jobs add constraint jobs_outcome_check check (outcome is null or outcome in (
  'COMPLETED',
  'DISCOVERY_BLOCKED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_PENDING',
  'PARTIAL',
  'NOTHING_TO_DO',
  'ZERO_RESULTS',
  'FAILED'
));
