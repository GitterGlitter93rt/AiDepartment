-- 026_import_session_running.sql — a confirm that is under way is a state of its own.
--
-- Confirming an import runs the whole file inline in the HTTP request. Measured at
-- 95 rows a second, a ten-thousand row list holds that request open for about a
-- hundred seconds, which is longer than a default reverse-proxy read timeout. The
-- rep then sees a gateway error while the import is still running, and pressing the
-- button again started a *second* import of the same file: the guard against
-- double-confirm only looked at CONFIRMED, which is not set until the first run
-- finishes.
--
-- RUNNING lets the confirm claim the session atomically before it does any work, so
-- the second press is refused whatever the first one is doing.

alter table import_sessions drop constraint if exists import_sessions_status_check;
alter table import_sessions add constraint import_sessions_status_check
  check (status in ('UPLOADED','MAPPED','PREVIEWED','RUNNING','CONFIRMED','CANCELLED','EXPIRED'));

-- When a confirm started, so a session stuck in RUNNING can be told from one that is
-- legitimately still going.
alter table import_sessions add column if not exists confirm_started_at timestamptz;
