-- 039_coverage_indexes.sql — the counts behind Find Prospects.
--
-- Coverage counting moved off prospect_inventory and onto the base tables, which is
-- what made it fast; these are what keep it fast as the tables grow.
--
-- The geography predicates are existence tests against locations, so the useful
-- index is the one that answers "is there an active location for this account in
-- this ZIP" without reading the account's other locations.

create index if not exists locations_postal_active_idx
  on locations (postal_code, account_id) where is_active;
create index if not exists locations_city_active_idx
  on locations (lower(city), state_region, account_id) where is_active;
create index if not exists locations_state_active_idx
  on locations (state_region, account_id) where is_active;

-- The tier-filter count asks for accounts with no tier. Partial, because the answer
-- is only ever needed for the unscored ones.
create index if not exists accounts_unscored_idx
  on accounts (primary_vertical_profile_id)
  where manual_tier is null and not is_suppressed and merged_into_account_id is null;

-- "Has this company ever been checked for advertising", which is a not-exists over
-- three claim keys.
create index if not exists evidence_ad_claims_idx
  on evidence_records (account_id)
  where claim_key in ('active_google_search_ad','active_local_service_ad','active_meta_ad');

-- The last completed discovery for a market. Without this the discovery-state read
-- scans every job the system has ever run.
create index if not exists jobs_market_geography_idx
  on jobs ((payload->>'geography_value'), completed_at desc)
  where job_type = 'market_mine';
