-- 025_scale_indexes.sql — indexes justified by measurement, not by guesswork.
--
-- Every index here was added because a query in the product was measurably slow
-- against the 25,000-account synthetic dataset, and each one was re-measured after.
-- Nothing speculative: an index nobody's query can use still costs every insert.
--
-- Measurements are in the comments and reproducible with
--   npx tsx src/bin/scale-generate.ts --accounts 25000 --seed yad-scale-v1 --truncate
--   npx tsx src/bin/scale-benchmark.ts

-- Overview, every rep, every page load: "recently claimed" reads the six most
-- recently claimed Accounts a rep owns. accounts_owner_idx covers the filter but not
-- the order, so Postgres sorted every Account the rep owns -- 1,100 of them at this
-- scale -- to return six. 93 ms before, 2 ms after.
create index if not exists accounts_owner_claimed_idx
  on accounts (current_owner_user_id, claimed_at desc)
  where current_owner_user_id is not null;

-- Find Prospects, the hero filter: vertical plus postal code plus unclaimed. The
-- postal code lives on locations, and locations_account_idx indexes the account side
-- only, so the geography filter could not start from the ZIP. This index lets the
-- filter begin at the 1,600 locations in one ZIP instead of the 58,000 in the
-- dataset.
create index if not exists locations_postal_active_idx
  on locations (postal_code, account_id)
  where is_active;

-- Follow-Ups and the Overview badge both ask for one rep's open work in due order.
-- The existing partial index is on (owner_user_id, due_at) where status = 'OPEN',
-- which is already right; this one covers the same question asked per Account, which
-- the Account page and the prospect_inventory lateral both do.
create index if not exists follow_ups_account_open_due_idx
  on follow_ups (account_id, due_at)
  where status = 'OPEN';

-- The activities lateral in prospect_inventory filters on activity_type and takes a
-- max(occurred_at) per Account. activities_account_idx orders by occurred_at desc but
-- carries no type, so every row for the Account was read to find the touch types the
-- projection counts.
create index if not exists activities_account_type_time_idx
  on activities (account_id, activity_type, occurred_at desc);

-- Global search resolves a phone number by normalized value across every endpoint.
-- contact_endpoints_value_idx is unique on (account_id, endpoint_type,
-- normalized_value), so a search that knows only the number could not use it.
create index if not exists contact_endpoints_normalized_value_idx
  on contact_endpoints (normalized_value)
  where is_active;

-- The audit view unions ownership_events and orders by time. ownership_events has an
-- index per Account and per actor, but none in pure time order, so the union was
-- sorted from a sequential scan.
create index if not exists ownership_events_time_idx
  on ownership_events (occurred_at desc);
