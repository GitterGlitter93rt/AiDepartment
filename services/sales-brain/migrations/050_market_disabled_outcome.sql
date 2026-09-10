-- 050_market_disabled_outcome.sql — pausing a market is not a job that failed.
--
-- `enabled` was read once, by the scheduler, when a refresh was queued. A market
-- switched off after that went on buying searches: the handler never looked again,
-- so a paused market could still spend money for as long as its queued run took to
-- reach the front of the worker's queue -- and a plan of N searches submitted all N.
--
-- The handler now re-asks immediately before each not-yet-accepted submission, which
-- needs somewhere to record what happened. The existing values will not carry it:
--
--   ZERO_RESULTS       says the provider was asked and this market is empty. Nobody
--                      was asked, and the market is not empty.
--   PROVIDER_UNAVAILABLE  blames a provider that was never called.
--   DISCOVERY_BLOCKED  is closest -- it is already how "our own ceiling stopped the
--                      call" is recorded -- but the operations page counts it as
--                      `blocked_jobs_today`, "a job that could not do what was
--                      asked". Reusing it would mean an operator pausing four
--                      markets watched their own deliberate decision arrive as four
--                      blocked jobs, and the one number on that page that means
--                      something is wrong would stop meaning it.
--
-- So it gets its own value. What it must never imply: that a search already paid for
-- was abandoned. `provider_tasks` rows are untouched by a market being switched off,
-- a PENDING task stays PENDING and is still collected on the next run, and the
-- job-level outcome reports PROVIDER_PENDING ahead of this when one is still owed.

alter table jobs drop constraint if exists jobs_outcome_check;
alter table jobs add constraint jobs_outcome_check check (outcome is null or outcome in (
  'COMPLETED',
  'DISCOVERY_BLOCKED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_PENDING',
  'PARTIAL',
  'NOTHING_TO_DO',
  'ZERO_RESULTS',
  -- The saved market was switched off before a new search could be submitted, so
  -- nothing was bought. Our decision, taken after the run was already queued.
  'MARKET_DISABLED',
  'FAILED'
));
