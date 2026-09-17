-- 055 — a worker process says how many jobs it is actually running
--
-- `WORKER_CONCURRENCY` has been declared in config.ts and read by nothing since it was
-- written, so the worker leased one job at a time whatever the value said. Scaling the
-- V2 estate rebuild meant starting extra processes by hand.
--
-- Making the setting real makes one heartbeat row cover several jobs at once, and
-- `current_job_id` can only name one of them. An operator watching a four-lane worker
-- would see one job and infer three idle lanes, which is the same class of mistake as
-- the setting that did nothing.

alter table worker_instances
  add column if not exists concurrency integer not null default 1,
  add column if not exists current_job_ids uuid[] not null default '{}';

comment on column worker_instances.concurrency is
  'How many jobs this process leases at once. 1 is the historical behaviour.';
comment on column worker_instances.current_job_ids is
  'Every job this process holds right now. current_job_id remains the oldest of them '
  'so that read models written before concurrency existed keep working.';
