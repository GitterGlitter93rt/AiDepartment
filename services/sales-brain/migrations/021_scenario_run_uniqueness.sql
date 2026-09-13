-- 021_scenario_run_uniqueness.sql — a scenario run is unique even with no attempt.
--
-- The original unique index covered (attempt, scenario, medium). A scenario run made
-- outside a pilot attempt has a null attempt, and null is never equal to null in a
-- unique index, so re-running one inserted a second row instead of updating the
-- first. A regression suite that silently accumulates duplicate results reports a
-- history nobody asked for and hides the current answer.

create unique index audio_scenario_runs_standalone
  on audio_scenario_runs(scenario_id, medium)
  where audio_pilot_attempt_id is null;
