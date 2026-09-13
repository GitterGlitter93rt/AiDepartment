-- 051_entity_resolution.sql — a search result is not a business.
--
-- The first real canary turned 113 SERP rows into 65 Accounts, of which 19 were not
-- companies at all -- Yelp, News4Jax, a GAF dealer locator, a Reddit thread, an HTTP
-- 500 error page -- and all 65 were named after a page title rather than a business.
-- Research then crawled a lead-generation directory as one contractor's official site
-- and attributed its phone number and financing copy to that contractor.
--
-- Every gate on the way in was a shape test: does this row have a domain, or a name
-- and a phone. A Yelp search page has all three. Nothing asked whether the row
-- referred to an operating business, because there was nowhere to put the answer.
--
-- This migration is additive. No existing row is deleted and no existing Account is
-- declared valid or invalid by it.

-- --------------------------------------------------------------- candidates ----
--
-- The layer that was missing. One row per identity resolved out of one run, holding
-- the promotion decision and why. A rejected candidate keeps its provenance: the
-- point is to be able to answer "what did this search actually find" later, including
-- for the rows that correctly became nothing.
create table if not exists discovery_candidates (
  candidate_id      uuid primary key default gen_random_uuid(),
  job_id            uuid references jobs(job_id) on delete set null,
  vertical_profile_id text,
  -- Registrable domain, or the phone when a listing carried no site.
  identity          text not null,
  source_class      text not null check (source_class in (
                      'BUSINESS_LISTING','OFFICIAL_SITE','DIRECTORY','MARKETPLACE',
                      'PUBLISHER','LISTICLE','SOCIAL','VIDEO','FORUM',
                      'MANUFACTURER_LOCATOR','UNKNOWN')),
  entity_status     text not null check (entity_status in
                      ('VERIFIED','NEEDS_REVIEW','REJECTED')),
  resolved_name     text,
  -- How the name was arrived at, so no surface implies more than we know.
  name_basis        text not null default 'unresolved'
                      check (name_basis in ('provider_listing','own_site_title','domain','unresolved')),
  observed_domain   text,
  observed_phone    text,
  observed_location text,
  observation_count integer not null default 1,
  -- Bounded operator-readable sentences. Never provider text, never a stack trace.
  reasons           text[] not null default '{}',
  -- The geography this run was searching. Discovery provenance, never an address.
  discovered_for_geography_type text,
  discovered_for_geography      text,
  account_id        uuid references accounts(account_id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists discovery_candidates_job_idx on discovery_candidates(job_id);
create index if not exists discovery_candidates_status_idx
  on discovery_candidates(entity_status, created_at desc);
create index if not exists discovery_candidates_identity_idx on discovery_candidates(identity);

-- ------------------------------------------------------------- account status ----
--
-- Deliberately NOT defaulted to VERIFIED.
--
-- Everything already in the table arrived before there was a promotion gate, so
-- calling it verified would launder exactly the junk this work exists to stop.
-- Calling it rejected would break imports and manual entry, which never came from a
-- SERP row and were never the problem. `legacy_unverified` says what is true: nothing
-- has judged these yet.
alter table accounts add column if not exists entity_status text not null
  default 'legacy_unverified'
  check (entity_status in ('legacy_unverified','verified','needs_review','quarantined','rejected'));

alter table accounts add column if not exists entity_status_basis text;
alter table accounts add column if not exists entity_status_at timestamptz;

create index if not exists accounts_entity_status_idx on accounts(entity_status)
  where merged_into_account_id is null;

-- ----------------------------------------------------- discovery provenance ----
--
-- "Found while researching 32095" is not "located in 32095", and the miner used to
-- write the second when it only knew the first: with no address from the provider it
-- copied the searched ZIP into locations.postal_code, so 65 of 65 canary Accounts
-- claimed a physical address nobody had observed.
--
-- account_market_membership already records this for a saved market. An ad-hoc run
-- has no market row to point at, so the context lives here as well.
alter table accounts add column if not exists discovered_for_geography_type text;
alter table accounts add column if not exists discovered_for_geography text;

comment on column accounts.discovered_for_geography is
  'The geography a discovery run was searching when this Account was found. '
  'Discovery provenance only: it is not evidence of where the business is.';
