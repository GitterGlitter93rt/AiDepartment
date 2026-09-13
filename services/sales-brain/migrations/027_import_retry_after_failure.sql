-- 027_import_retry_after_failure.sql — a failed import must not block its own retry.

-- One *successful* import per file, not one attempt per file.
--
-- The batch row is written before the rows are processed, so a run that failed left
-- its hash behind under a unique index and the operator could never retry the same
-- file: they were told it had already been imported, by a batch marked FAILED. The
-- index now ignores failed attempts, which is the rule the guard was always meant to
-- express.
drop index if exists import_batches_sha_idx;
create unique index import_batches_sha_idx on import_batches (file_sha256)
  where file_sha256 is not null and status <> 'FAILED';
