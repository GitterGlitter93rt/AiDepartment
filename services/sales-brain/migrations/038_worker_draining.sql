-- 038_worker_draining.sql — a worker between "running" and "stopped".
--
-- SIGTERM sets a flag; the loop finishes its current job and exits. In between, the
-- worker is neither running normally nor stopped: it is draining. Nothing recorded
-- that, so the operations panel showed a worker taking no new work as perfectly
-- healthy, and an operator watching a restart could not tell a drain that was
-- finishing cleanly from one that had wedged on a job that would not end.
--
-- The state matters most in the case it was invented for: a worker asked to stop
-- while inside a long provider call. It is alive, it is heartbeating, and it will
-- never pick up the queued work behind it.

alter table worker_instances
  add column if not exists draining_since timestamptz;

-- What it was doing when it was asked to stop, so a drain that does not finish
-- names the job holding it up rather than leaving an operator to guess.
alter table worker_instances
  add column if not exists current_job_id uuid;
