-- 018_line_type_screening.sql — line type screening results, cached.
-- Authority: outbound-sales-brain-twilio-lookup-line-type-adapter-spec.md §7, §11, §12.
--
-- Line type is an input to policy, never an outcome. This table records what a
-- provider said and when, so the eligibility engine can decide; it stores no
-- decision of its own.
--
-- Two things the schema makes impossible rather than merely discouraged:
--   1. a provider error becoming a line type — ERROR is a status, and the line type
--      stays UNKNOWN, so an outage cannot be inferred into 'landline';
--   2. a stale result passing as current — every row carries refresh_by, and a
--      lookup without one cannot be treated as fresh.

create table line_type_screen_results (
  line_type_screen_id   bigserial primary key,
  endpoint_id           uuid references contact_endpoints(endpoint_id) on delete cascade,
  normalized_value      text not null,
  provider_id           text not null default 'TWILIO_LOOKUP_V2',
  data_package          text not null default 'LINE_TYPE_INTELLIGENCE',
  status                text not null
                        check (status in ('SUCCESS','INVALID_NUMBER','AUTH_FAILED','RATE_LIMITED',
                                          'UNSUPPORTED_COVERAGE','TIMEOUT','PROVIDER_ERROR')),
  -- The YAD enum. UNKNOWN is a real answer from a successful lookup, not an error.
  normalized_line_type  text not null default 'UNKNOWN'
                        check (normalized_line_type in ('LANDLINE','MOBILE','FIXED_VOIP',
                                                        'NON_FIXED_VOIP','PERSONAL','TOLL_FREE',
                                                        'PREMIUM','SHARED_COST','UNIVERSAL_ACCESS',
                                                        'VOICEMAIL','PAGER','UNKNOWN')),
  -- Kept so a provider changing its vocabulary is visible rather than silently
  -- collapsing into our enum.
  provider_original_type text,
  carrier_name          text,
  mobile_country_code   text,
  mobile_network_code   text,
  error_code            text,
  checked_at            timestamptz not null default now(),
  refresh_by            timestamptz not null,
  provider_request_reference text,
  -- Cost accounting per §13. A cache hit costs nothing and says so.
  was_cache_hit         boolean not null default false,
  cost_usd              numeric(10,6) not null default 0,
  -- A provider error must never carry a line type other than UNKNOWN.
  constraint line_type_error_stays_unknown
    check (status = 'SUCCESS' or normalized_line_type = 'UNKNOWN')
);

create index line_type_screen_value_idx
  on line_type_screen_results(normalized_value, provider_id, data_package, checked_at desc);
create index line_type_screen_endpoint_idx
  on line_type_screen_results(endpoint_id, checked_at desc);
