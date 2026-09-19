-- 053_location_provenance.sql — a location has to say how it is known.
--
-- `locations` has always held where a company is without holding how anybody knew it.
-- That gap is not theoretical: production holds 66 rows, one for each legacy Roofing
-- Account, every one carrying ZIP 32095 and nothing else -- the ZIP the canary
-- searched. They are typed `service_area`, which reads as something the business
-- declared. No page was read, and no company ever said it.
--
-- V1 stopped writing them. This adds the columns that make the next one impossible to
-- write silently: a row now records what it was read from and when, so a location with
-- no basis is visibly a location nobody can account for.
--
-- The existing 66 rows are deliberately left alone. Labelling them would be a rewrite
-- of production data, and mass historical remediation is not authorised; a null basis
-- is the honest description of a row whose provenance was never recorded, and the
-- remediation preview reads it as exactly that.

alter table locations add column if not exists basis text;
alter table locations add column if not exists source_reference text;
alter table locations add column if not exists first_observed_at timestamptz;
alter table locations add column if not exists last_verified_at timestamptz;

comment on column locations.basis is
  'How this location is known: SCHEMA_ORG_POSTAL_ADDRESS, PAGE_TEXT, SCHEMA_ORG_AREA_SERVED, '
  'IMPORTED, or null for a row written before provenance was recorded. Never the searched geography.';
comment on column locations.source_reference is
  'The URL or document the claim was read from.';

-- A place of business has a street. Without one, "Orlando, FL" is a place name, and a
-- place name is exactly what the searched ZIP was.
--
-- `not valid` on purpose: the constraint governs every future write and does not
-- rewrite or reject the history it inherits. Validating it is a separate decision that
-- belongs with the remediation authorisation, not with this migration.
alter table locations drop constraint if exists locations_physical_needs_street;
alter table locations add constraint locations_physical_needs_street
  check (location_type <> 'physical' or address_line_1 is not null) not valid;

create index if not exists locations_basis_idx on locations(basis) where basis is not null;
