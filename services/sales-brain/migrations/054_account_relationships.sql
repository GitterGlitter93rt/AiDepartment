-- 054_account_relationships.sql — two companies that share a person are still two companies.
--
-- The schema can say that two rows are the same company (`account_merges`) and it can
-- say nothing at all about two companies that are genuinely separate and share a
-- person, an address, a licence or a phone number. That gap is where the real-world
-- case lands:
--
--   SUNBRIGHT HVAC LLC holds a Florida certified air-conditioning licence qualified by
--   a named person. A public contractor profile lists the same person, at the same
--   address, for MR AC OF ORLANDO INC.
--
-- Merging them would be wrong -- they are two entities, with two filings -- and
-- dropping the link throws away the only route anybody has to a decision maker. So the
-- relationship is recorded between them, with what it rests on.
--
-- The rules this table exists to hold, which a caller must not be trusted to remember:
--
--   * one weak signal alone is not a relationship. A shared address alone is a business
--     park; a shared common name alone is a coincidence. `basis` names the combination,
--     so a row that cannot say what agreed cannot be written.
--   * a relationship is never a merge. RELATED_BUSINESS does not become "same company"
--     by being confident; that is what `account_merges` is for, and it needs its own
--     evidence and its own review.
--   * a role is never promoted. A qualifier is not an owner, a registered agent is not
--     an owner, and an officer is not an owner unless the record says so.

create table if not exists account_relationships (
  account_relationship_id uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  -- Null when the other side is not in inventory. The name is recorded either way,
  -- because "this company is linked to one we do not hold" is itself worth knowing.
  related_account_id uuid references accounts(account_id) on delete set null,
  related_name     text not null,
  relationship_type text not null check (relationship_type in (
    'RELATED_BUSINESS',
    'HISTORICAL_BUSINESS_ASSOCIATION',
    'SHARED_LICENSE_QUALIFIER',
    'SHARED_OFFICER',
    'SHARED_REGISTERED_AGENT',
    'PREDECESSOR_ENTITY',
    'SUCCESSOR_ENTITY',
    'PARENT_ENTITY',
    'SUBSIDIARY_ENTITY'
  )),
  -- What agreed, in the order it was found: 'same_person+same_street_address'.
  -- Two signals minimum, enforced below.
  basis            text not null,
  confidence       text not null default 'LOW' check (confidence in ('HIGH','MEDIUM','LOW')),
  -- The official record that says so.
  evidence_id      uuid references evidence_records(evidence_id) on delete set null,
  source_reference text,
  first_observed_at timestamptz not null default now(),
  last_verified_at  timestamptz not null default now(),
  notes            text,
  unique (account_id, related_name, relationship_type)
);

-- A relationship names at least two things that agreed. The separator is what makes
-- the count checkable in the database rather than in whichever caller wrote the row.
alter table account_relationships drop constraint if exists account_relationships_two_signals;
alter table account_relationships add constraint account_relationships_two_signals
  check (basis like '%+%');

-- A company is not related to itself.
alter table account_relationships drop constraint if exists account_relationships_not_self;
alter table account_relationships add constraint account_relationships_not_self
  check (related_account_id is null or related_account_id <> account_id);

create index if not exists account_relationships_account_idx
  on account_relationships(account_id);
create index if not exists account_relationships_related_idx
  on account_relationships(related_account_id) where related_account_id is not null;

-- Person roles the official sources actually produce.
--
-- Added rather than folded into an existing value: an authorised member of an LLC, a
-- founder and a responsible master licensee are three different claims, and collapsing
-- them into 'officer' would lose exactly the distinction a rep needs when deciding who
-- to ask for. `former` already exists and stays what it is.
alter table contacts drop constraint if exists contacts_company_relationship_check;
alter table contacts add constraint contacts_company_relationship_check
  check (company_relationship in (
    'employee', 'officer', 'member_manager', 'owner', 'registered_agent',
    'license_qualifier', 'former', 'unknown',
    -- New in V2.
    'founder',
    'authorized_member',
    'responsible_master_licensee',
    'license_holder',
    'related_business_contact'
  ));
