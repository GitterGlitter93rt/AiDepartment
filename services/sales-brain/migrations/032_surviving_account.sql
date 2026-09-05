-- 032_surviving_account.sql — reading forwards through a merge.
--
-- merged_chain() walks downwards: a surviving Account and everything folded into it.
-- Several readers need the opposite direction -- given any id, which record is the
-- company now? Global search was returning merged tombstones as separate hits, so a
-- company merged yesterday appeared twice, the second time carrying the owner and
-- the suppression flag it had before the merge.

create or replace function surviving_account(root uuid)
returns uuid language sql stable as $$
  with recursive walk as (
    select a.account_id, a.merged_into_account_id, 0 as hops
      from accounts a where a.account_id = root
    union all
    -- A chain longer than a handful means something is wrong; stop rather than loop.
    select a.account_id, a.merged_into_account_id, w.hops + 1
      from accounts a join walk w on a.account_id = w.merged_into_account_id
     where w.hops < 10
  )
  select account_id from walk where merged_into_account_id is null limit 1
$$;
