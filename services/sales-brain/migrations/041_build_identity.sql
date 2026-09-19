-- Which build each worker is running.
--
-- The API and the worker are separate processes restarted separately, so a deploy
-- that misses one leaves two builds against one database. Every symptom of that
-- shows up somewhere other than the version skew that caused it, and the runner's
-- own "no handler" message already guesses at this cause without being able to
-- check it.
alter table worker_instances add column if not exists build_sha text;
alter table worker_instances add column if not exists migrations_expected integer;
