-- 037_market_scheduling.sql — a market that maintains itself.
--
-- saved_markets has carried next_refresh_at since it was written and nothing has
-- ever set it or read it. The miner runs when somebody presses a button; the
-- product is inventory that is already there when a rep arrives in the morning.
--
-- What a scheduler needs beyond what the table had:
--
--   - attempted and succeeded are different facts. A market searched every hour
--     and failing every hour has a recent last_refresh_at and no coverage at all,
--     and the operator could not tell those apart.
--   - consecutive failures, so a provider that is down is backed off rather than
--     hammered once a minute for the rest of the night.
--   - why a market is not running, in words, so "nothing is happening" is never
--     the only thing the page can say.

alter table saved_markets
  add column if not exists enabled boolean not null default true;

-- When a discovery was last attempted, whatever came of it.
alter table saved_markets
  add column if not exists last_attempted_at timestamptz;
-- When one last actually completed with a provider answering.
alter table saved_markets
  add column if not exists last_success_at timestamptz;
alter table saved_markets
  add column if not exists last_outcome text;
alter table saved_markets
  add column if not exists last_outcome_reason text;

-- Backoff. Reset on any answer from a provider, grown on each failure.
alter table saved_markets
  add column if not exists consecutive_failures integer not null default 0;

-- How often this market wants looking at. Null means the system default.
alter table saved_markets
  add column if not exists refresh_interval_hours integer;

-- Why the scheduler is not running this market right now, for the operator.
alter table saved_markets
  add column if not exists blocker_reason text;

-- The scheduler's own lookup: enabled markets that are due, oldest attempt first.
-- Partial so a database full of disabled markets costs nothing to skip.
create index if not exists saved_markets_due_idx
  on saved_markets (next_refresh_at nulls first, last_attempted_at nulls first)
  where enabled;
