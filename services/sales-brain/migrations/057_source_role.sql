-- 057 — what a source is, recorded next to what we did about it
--
-- `source_class` ended with a fallthrough that called any unrecognised row OFFICIAL_SITE,
-- and 2,002 of 3,006 production discovery candidates carry that class -- among them a
-- directory, a moving company and a state licensing portal. The role model replaces the
-- default with a conclusion, and the conclusion has to be stored next to the row it was
-- reached about, or the next audit has to guess again.
--
-- Both columns are kept. `source_class` is what the historical estate was judged by and
-- rewriting it would destroy the record of how these Accounts arrived.

alter table discovery_candidates
  add column if not exists source_role text,
  add column if not exists source_role_confidence text,
  add column if not exists source_role_reasons text[];

alter table search_observations
  add column if not exists source_role text;

comment on column discovery_candidates.source_role is
  'The evidence-based role from src/discovery/sourceRole.ts. COMPANY_OWNED_SITE here is '
  'a conclusion that was positively evidenced, unlike source_class OFFICIAL_SITE, which '
  'was the value assigned when nothing matched.';

-- Reading up to five pages of results costs real money, and whether it is worth it is a
-- question about ranks: a fact first found at rank 37 is the argument for paying for
-- page four, and a run of pages that produce nothing is the argument against.
create table if not exists serp_audits (
  audit_id        uuid primary key default gen_random_uuid(),
  account_id      uuid references accounts(account_id) on delete cascade,
  query           text not null,
  provider        text,
  job_id          uuid,
  pages_requested integer not null default 1,
  results_seen    integer not null default 0,
  results_opened  integer not null default 0,
  facts_found     integer not null default 0,
  cost_usd        numeric(10,4),
  created_at      timestamptz not null default now()
);

create table if not exists serp_audit_results (
  result_id      uuid primary key default gen_random_uuid(),
  audit_id       uuid not null references serp_audits(audit_id) on delete cascade,
  rank           integer not null,
  url            text not null,
  title          text,
  source_role    text not null,
  role_confidence text,
  opened         boolean not null default false,
  open_state     text,
  facts_found    integer not null default 0,
  fact_kinds     text[] not null default '{}',
  provenance     text,
  observed_at    timestamptz not null default now()
);

create unique index if not exists serp_audit_result_rank_once
  on serp_audit_results (audit_id, rank);
create index if not exists serp_audit_results_by_role
  on serp_audit_results (source_role, rank);

-- Which page of a company's own site a fact came from, so "the homepage said nothing and
-- /our-team named the owner" is answerable rather than inferred.
alter table evidence_records
  add column if not exists source_page_url text,
  add column if not exists source_rank integer,
  add column if not exists fact_provenance text;

comment on column evidence_records.source_page_url is
  'The exact page a fact was read from. A homepage and a /leadership page are different '
  'evidence about whether deep crawling is worth its bandwidth.';
comment on column evidence_records.source_rank is
  'The organic result rank a fact was first found at, where it came from a search.';
