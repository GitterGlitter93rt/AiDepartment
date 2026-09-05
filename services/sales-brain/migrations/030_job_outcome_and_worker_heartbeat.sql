-- 030_job_outcome_and_worker_heartbeat.sql — telling the operator what actually happened.
--
-- Two defects from the live operator session, both of the same shape: a technical
-- success reported as a business success.
--
-- A market search for ZIP 32095 showed "Researching 32095 now", then a job marked
-- SUCCEEDED, then "0 found". All three were true of the code and none of them was
-- true of what the operator asked for: no discovery provider is registered, so no
-- new business could have been found. A queue status answers "did the handler
-- return", which is not the question a person looking at a mining page is asking.
--
-- And a job sat QUEUED with no worker process running while Research Health read
-- green, because "0 stranded" was inferred to mean healthy. A queue with nobody
-- serving it is not healthy; it is stopped.

-- What the job actually achieved, separate from whether it ran. `status` stays the
-- queue's business; `outcome` is the operator's.
alter table jobs add column if not exists outcome text;
alter table jobs drop constraint if exists jobs_outcome_check;
alter table jobs add constraint jobs_outcome_check check (outcome is null or outcome in (
  -- The work the caller asked for was done.
  'COMPLETED',
  -- Ran, but a capability it needed was unavailable. The reason says which.
  'DISCOVERY_BLOCKED',
  'PROVIDER_UNAVAILABLE',
  -- Ran and did part of the work.
  'PARTIAL',
  -- Ran, and there was correctly nothing to do.
  'NOTHING_TO_DO',
  -- Ran and produced a genuine zero: the provider was asked and returned nothing.
  'ZERO_RESULTS',
  'FAILED'
));

-- Why, in a sentence an operator reads. Never a stack trace.
alter table jobs add column if not exists outcome_reason text;

create index if not exists jobs_outcome_idx on jobs (outcome, completed_at desc)
  where outcome is not null;

-- ---------------------------------------------------------------------------
-- Worker liveness. A heartbeat is the only honest way to answer "is anything
-- serving this queue": inferring it from the absence of stranded jobs says a queue
-- nobody has touched is healthy.
-- ---------------------------------------------------------------------------
create table if not exists worker_instances (
  worker_id        text primary key,
  hostname         text not null,
  pid              integer not null,
  -- What this worker can actually run. A worker with no handler for market_mine is
  -- not a worker that can mine, however alive it is.
  handlers         text[] not null default '{}',
  started_at       timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  -- Set when the worker stops on purpose, so a clean shutdown is not an outage.
  stopped_at       timestamptz,
  jobs_processed   bigint not null default 0,
  last_job_at      timestamptz
);

create index if not exists worker_instances_heartbeat_idx
  on worker_instances (last_heartbeat_at desc);

comment on table worker_instances is
  'One row per worker process, heartbeated while it runs. A queue with no live '
  'worker must never read healthy.';
