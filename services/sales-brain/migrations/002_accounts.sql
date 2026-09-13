-- 002_accounts.sql — Account / Location / Domain / Contact / Endpoint / SourceIdentity.
-- Canonical authority: outbound-sales-brain-data-contract.md §3-§8,
-- outbound-sales-brain-rep-ownership-data-model.md §2-§6,
-- outbound-sales-brain-contact-endpoint-quality-spec.md.

-- ---------------------------------------------------------------------------
-- ACCOUNT — the ownership unit (rep-ownership-data-model §1).
-- ---------------------------------------------------------------------------
create table accounts (
  account_id            uuid primary key default gen_random_uuid(),
  canonical_name        text not null,
  normalized_name       text not null,          -- lowercased, punctuation/suffix stripped
  legal_name            text,
  dba_names             text[] not null default '{}',
  account_type          text not null default 'unknown'
                        check (account_type in ('independent_business','multi_location_business',
                                                'franchise_location_group','franchise_corporate',
                                                'enterprise','unknown')),
  parent_account_id     uuid references accounts(account_id),
  industry_code         text,
  primary_vertical_profile_id text references vertical_profiles(vertical_profile_id),
  canonical_domain      text,                   -- denormalized from domains for fast filtering

  -- Lifecycle / relationship. Separate from ownership_state on purpose
  -- (rep-ownership-data-model §3: "do not encode every lifecycle concept into one enum").
  relationship_state    text not null default 'COLD'
                        check (relationship_state in ('COLD','CONTACTED','ENGAGED','CALLBACK_REQUESTED',
                                                      'POSITIVE_REPLY','MEETING_SCHEDULED','ACTIVE_OPPORTUNITY',
                                                      'PROPOSAL','CLIENT','DISQUALIFIED')),
  -- Ownership. current_owner_user_id is denormalized for filtering; ownership_events is the history.
  ownership_state       text not null default 'UNCLAIMED'
                        check (ownership_state in ('UNCLAIMED','CLAIMED','MANAGER_ASSIGNED',
                                                   'ACTIVE_RELATIONSHIP','ACTIVE_OPPORTUNITY',
                                                   'CLIENT','SUPPRESSED')),
  current_owner_user_id uuid references users(user_id),
  ownership_updated_at  timestamptz,
  claimed_at            timestamptz,

  -- Maintained by trigger from the suppressions table; never set directly.
  is_suppressed         boolean not null default false,
  suppression_summary   text,

  -- Scoring projection. Canonical history stays in canonical_scores.
  manual_score          integer,
  manual_tier           text check (manual_tier in ('A','B','C','D')),
  advertiser_strength   text check (advertiser_strength in ('NONE','WEAK','MODERATE','STRONG')),
  research_completeness text check (research_completeness in ('COMPLETE','GOOD','PARTIAL','THIN','STALE')),
  research_fresh_until  timestamptz,
  last_researched_at    timestamptz,

  employee_size_band    text,
  location_count_confirmed integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Ownership invariant, enforced by the database rather than by the API alone:
  -- an owner exists exactly when the state says one should.
  constraint accounts_owner_state_consistent check (
    (ownership_state in ('UNCLAIMED','SUPPRESSED') and current_owner_user_id is null)
    or (ownership_state not in ('UNCLAIMED','SUPPRESSED') and current_owner_user_id is not null)
  )
);
create trigger accounts_updated_at before update on accounts
  for each row execute function set_updated_at();

create index accounts_owner_idx        on accounts(current_owner_user_id) where current_owner_user_id is not null;
create index accounts_ownership_idx    on accounts(ownership_state);
create index accounts_relationship_idx on accounts(relationship_state);
create index accounts_vertical_idx     on accounts(primary_vertical_profile_id);
create index accounts_tier_idx         on accounts(manual_tier, manual_score desc);
create index accounts_normalized_name_idx on accounts(normalized_name);
create unique index accounts_canonical_domain_idx on accounts(canonical_domain) where canonical_domain is not null;
create index accounts_freshness_idx    on accounts(research_fresh_until);

-- ---------------------------------------------------------------------------
-- LOCATION (data-contract §4). Service-area businesses may have no street address.
-- ---------------------------------------------------------------------------
create table locations (
  location_id     uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(account_id) on delete cascade,
  name            text,
  address_line_1  text,
  address_line_2  text,
  city            text,
  state_region    text,
  postal_code     text,                          -- ZIP / ZCTA
  country_code    text not null default 'US',
  latitude        double precision,
  longitude       double precision,
  timezone        text,                          -- IANA identifier
  location_type   text not null default 'unknown'
                  check (location_type in ('physical','service_area','mailing','virtual','unknown')),
  service_area_text text,
  is_headquarters boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger locations_updated_at before update on locations
  for each row execute function set_updated_at();
create index locations_account_idx on locations(account_id);
create index locations_zip_idx     on locations(postal_code) where postal_code is not null;
create index locations_city_idx    on locations(lower(city), state_region);
create index locations_state_idx   on locations(state_region);

-- ---------------------------------------------------------------------------
-- DOMAIN (data-contract §5). A lead-gen landing domain is not the canonical domain.
-- ---------------------------------------------------------------------------
create table account_domains (
  domain_id          uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(account_id) on delete cascade,
  hostname           text not null,
  canonical_url      text,
  domain_role        text not null default 'unknown'
                     check (domain_role in ('primary','campaign','landing_page','location_subdomain',
                                            'third_party_booking','lead_generator_possible','unknown')),
  verification_status text not null default 'unverified'
                     check (verification_status in ('verified','unverified','unreachable','conflicted')),
  first_seen_at      timestamptz not null default now(),
  last_verified_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger account_domains_updated_at before update on account_domains
  for each row execute function set_updated_at();
create unique index account_domains_host_idx on account_domains(account_id, hostname);
create index account_domains_hostname_idx on account_domains(hostname);

-- ---------------------------------------------------------------------------
-- CONTACT (data-contract §7, decision-maker resolution spec §3 DecisionMakerIdentity).
-- Role confidence, employer confidence and currentness stay separate dimensions —
-- they are never collapsed into one number (resolution spec §13).
-- ---------------------------------------------------------------------------
create table contacts (
  contact_id       uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  location_id      uuid references locations(location_id) on delete set null,
  first_name       text,
  last_name        text,
  full_name        text,
  raw_title        text,
  role_category    text not null default 'unknown'
                   check (role_category in ('owner','founder','president','ceo','general_manager',
                                            'operations','service_manager','marketing','sales',
                                            'office_manager','intake','administrator','registered_agent',
                                            'license_qualifier','unknown')),
  -- Registered agent and license qualifier are relationship classes, NOT sales roles
  -- (resolution spec §8 and §9). They are recorded, never promoted to owner.
  company_relationship text not null default 'unknown'
                   check (company_relationship in ('employee','officer','member_manager','owner',
                                                   'registered_agent','license_qualifier','former',
                                                   'unknown')),
  scope            text not null default 'ACCOUNT'
                   check (scope in ('ACCOUNT','REGION','LOCATION','MARKET')),
  employer_match   text not null default 'UNCERTAIN'
                   check (employer_match in ('CONFIRMED','LIKELY','UNCERTAIN','HISTORICAL','CONFLICTED')),
  role_match       text not null default 'WEAK'
                   check (role_match in ('PRIMARY_PROCESS_OWNER','STRONG_STAKEHOLDER','VALID_FALLBACK','WEAK')),
  currentness      text not null default 'UNKNOWN'
                   check (currentness in ('FRESH','AGING','STALE','UNKNOWN')),
  role_confidence  text not null default 'UNKNOWN_ROLE'
                   check (role_confidence in ('CONFIRMED_CURRENT_ROLE','LIKELY_CURRENT_ROLE',
                                              'HISTORICAL_ROLE','ROLE_ONLY_TARGET','UNKNOWN_ROLE')),
  decision_maker_priority integer not null default 100,   -- lower = better target for the hypothesis
  authority_class  text,
  is_role_placeholder boolean not null default false,     -- true = "target the Operations role", no named person
  status           text not null default 'ACTIVE'
                   check (status in ('ACTIVE','LEFT_COMPANY','SUPERSEDED','REJECTED')),
  source_provider  text,
  source_reference text,
  observed_at      timestamptz,
  last_verified_at timestamptz,
  refresh_due_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger contacts_updated_at before update on contacts
  for each row execute function set_updated_at();
create index contacts_account_idx on contacts(account_id, decision_maker_priority);
create index contacts_active_idx  on contacts(account_id) where status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- ENDPOINT — phone and email in one table (rep-ownership-data-model §6).
-- Endpoint quality is independent of account fit and of role confidence
-- (contact-endpoint-quality-spec §1). A main line is never a person's direct line.
-- ---------------------------------------------------------------------------
create table contact_endpoints (
  endpoint_id      uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(account_id) on delete cascade,
  contact_id       uuid references contacts(contact_id) on delete set null,
  location_id      uuid references locations(location_id) on delete set null,
  endpoint_type    text not null check (endpoint_type in ('PHONE','EMAIL')),
  normalized_value text not null,               -- E.164 for phone, lowercased address for email
  display_value    text not null,
  extension        text,

  -- Semantic type. Phone types from endpoint-quality-spec §3, email types from §9.
  endpoint_role    text not null default 'UNKNOWN_PHONE_TYPE'
                   check (endpoint_role in (
                     'MAIN_BUSINESS_LINE','DIRECT_BUSINESS_LINE','LOCATION_BUSINESS_LINE','EXTENSION',
                     'MOBILE_ASSERTED_BUSINESS','MOBILE_UNKNOWN_USE','TOLL_FREE_BUSINESS',
                     'CALL_TRACKING_NUMBER','UNKNOWN_PHONE_TYPE',
                     'DIRECT_PERSON_EMAIL','ROLE_EMAIL','GENERAL_BUSINESS_EMAIL','LOCATION_EMAIL',
                     'UNKNOWN_EMAIL_TYPE')),

  -- Quality state. Phone states from §4, email states from §10.
  quality_state    text not null default 'UNKNOWN'
                   check (quality_state in (
                     'CURRENT_BUSINESS_CONFIRMED','DIRECT_BUSINESS_CONFIRMED','PROVIDER_ASSERTED_CURRENT',
                     'PUBLIC_OBSERVED_UNVERIFIED','STALE','UNKNOWN','WRONG_NUMBER','DISCONNECTED',
                     'REASSIGNED_NUMBER_RISK','SUPPRESSED',
                     'YAD_CONFIRMED_DELIVERABLE','PROVIDER_VERIFIED','DOMAIN_VALID_UNVERIFIED',
                     'PUBLIC_OBSERVED_CURRENT','GUESSED_UNVERIFIED','HARD_BOUNCE',
                     'SOFT_BOUNCE_REVIEW','MAILBOX_FULL_OR_TEMPORARY')),

  -- How this endpoint relates to the named person (resolution spec §13).
  relationship_to_person text not null default 'UNVERIFIED'
                   check (relationship_to_person in ('DIRECT_CONFIRMED','DIRECT_PROVIDER_ASSERTED',
                                                     'COMPANY_ROUTE','LOCATION_ROUTE','ROLE_INBOX','UNVERIFIED')),
  endpoint_source  text not null default 'UNKNOWN'
                   check (endpoint_source in ('COMPANY_WEBSITE','COMPANY_SCHEMA','PUBLIC_REGISTRY',
                                              'PUBLIC_LICENSE','PUBLIC_DIRECTORY','SEARCH_INDEXED',
                                              'PROSPECT_SUPPLIED','GATEKEEPER_SUPPLIED','IMPORT',
                                              'PAID_PROVIDER','INFERRED_PATTERN','UNKNOWN')),
  source_reference text,                        -- URL or provider record reference
  observed_at      timestamptz,
  verified_at      timestamptz,
  freshness        text not null default 'unknown'
                   check (freshness in ('fresh','aging','stale','unknown')),
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  failure_reason   text,
  is_suppressed    boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger contact_endpoints_updated_at before update on contact_endpoints
  for each row execute function set_updated_at();
-- One row per distinct value per account: rediscovery updates, it does not duplicate.
create unique index contact_endpoints_value_idx
  on contact_endpoints(account_id, endpoint_type, normalized_value);
create index contact_endpoints_account_idx on contact_endpoints(account_id) where is_active;
create index contact_endpoints_contact_idx on contact_endpoints(contact_id);
create index contact_endpoints_value_lookup on contact_endpoints(endpoint_type, normalized_value);

-- ---------------------------------------------------------------------------
-- SOURCE IDENTITY (data-contract §8). Makes dedupe and merges reversible.
-- ---------------------------------------------------------------------------
create table source_identities (
  source_identity_id  uuid primary key default gen_random_uuid(),
  provider            text not null,
  provider_entity_type text not null,
  provider_native_id  text not null,
  account_id          uuid not null references accounts(account_id) on delete cascade,
  location_id         uuid references locations(location_id) on delete set null,
  retention_class     text not null default 'durable'
                      check (retention_class in ('durable','durable_with_license','transient',
                                                 'identifier_only','do_not_store_raw')),
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now()
);
create unique index source_identities_native_idx
  on source_identities(provider, provider_entity_type, provider_native_id);
create index source_identities_account_idx on source_identities(account_id);

-- Merge history so an entity merge can be explained and reversed.
create table account_merges (
  merge_id        bigserial primary key,
  surviving_account_id uuid not null references accounts(account_id),
  merged_account_id    uuid not null,
  match_rule      text not null,
  detail          jsonb not null default '{}'::jsonb,
  actor_user_id   uuid references users(user_id),
  occurred_at     timestamptz not null default now()
);
