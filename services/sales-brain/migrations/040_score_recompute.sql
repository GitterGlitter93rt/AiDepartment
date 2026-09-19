-- 040_score_recompute.sql — knowing which scores are stale policy.
--
-- canonical_scores has always carried score_version and nothing ever compared it to
-- the version the code is running. When the four missing recognizers landed, every
-- score in the database became a score produced under rules that no longer exist --
-- and looked exactly like a current one.
--
-- accounts carries the version its projection was written under, so finding the
-- Accounts that need recomputing is an index lookup rather than a join against the
-- whole score history.

alter table accounts
  add column if not exists score_version text;

-- The recompute sweep's own lookup: accounts whose projection predates the running
-- policy. Partial on the ones that have a score at all, because an unscored Account
-- is the research sweep's problem rather than this one's.
create index if not exists accounts_score_version_idx
  on accounts (score_version)
  where manual_tier is not null and merged_into_account_id is null;
