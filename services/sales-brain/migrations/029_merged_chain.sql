-- 029_merged_chain.sql — reading history across a merge without rewriting it.

-- An Account and everything merged into it, for reading the two append-only ledgers.
-- Evidence and ownership events keep pointing at the record they were written
-- against -- rewriting a row's account_id would be editing history, and the triggers
-- refuse it -- so a merged company's history is followed rather than moved.
create or replace function merged_chain(root uuid)
returns table (account_id uuid) language sql stable as $$
  with recursive chain as (
    select a.account_id from accounts a where a.account_id = root
    union all
    select a.account_id from accounts a join chain c on a.merged_into_account_id = c.account_id
  )
  select chain.account_id from chain
$$;
