-- 035_provider_tasks.sql — a paid search that survives the worker dying.
--
-- DataForSEO Standard accepts a task, charges for it, and answers later. The task id
-- lived in a local variable inside one job, so a worker that died between submitting
-- and collecting lost the search entirely -- and the next run submitted another one,
-- paying twice for the same market. The poll is bounded, so this was not an edge
-- case: any task slower than the poll window was abandoned and re-bought.
--
-- The task is durable now. A run finds an outstanding task for the same request and
-- collects it rather than submitting a second.

create table if not exists provider_tasks (
  provider_task_id   uuid primary key default gen_random_uuid(),
  provider           text not null,
  -- The provider's own id. Unique per provider: it is what we go back with.
  provider_native_id text not null,
  -- The run that submitted it. Kept for attribution after the job is long finished.
  job_id             uuid references jobs(job_id) on delete set null,
  -- The normalized discovery request, so a later run recognises its own task.
  fingerprint        text not null,
  operation          text not null default 'serp.discover',
  status             text not null default 'PENDING'
                     check (status in ('PENDING','COLLECTED','FAILED','ABANDONED')),
  submitted_at       timestamptz not null default now(),
  last_polled_at     timestamptz,
  poll_attempts      integer not null default 0,
  collected_at       timestamptz,
  cost_usd           numeric(10,4),
  error_code         text,
  -- What was asked for, so a collection can be normalized in the same terms.
  request            jsonb not null default '{}'::jsonb,

  -- One row per provider task. A retry that re-submits the same id updates rather
  -- than duplicating.
  unique (provider, provider_native_id)
);

-- The two lookups: "is there an outstanding task for this request", and "what is
-- still owed to us by this provider".
create index if not exists provider_tasks_open_idx on provider_tasks(provider, fingerprint)
  where status = 'PENDING';
create index if not exists provider_tasks_pending_idx on provider_tasks(provider, submitted_at)
  where status = 'PENDING';
