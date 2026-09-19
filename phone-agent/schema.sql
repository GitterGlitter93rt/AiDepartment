create table if not exists leads (
  id text primary key,
  company_name text not null,
  website text,
  phone text not null,
  city text,
  state text,
  industry text,
  source text,
  consent_status text,
  line_type text,
  timezone text,
  created_at timestamptz not null default now()
);

create table if not exists prospect_dossiers (
  lead_id text primary key references leads(id),
  dossier jsonb not null,
  researched_at timestamptz not null default now()
);

create table if not exists compliance_checks (
  id bigserial primary key,
  lead_id text not null references leads(id),
  decision text not null,
  reasons jsonb not null,
  checked_at timestamptz not null default now()
);

create table if not exists call_attempts (
  id bigserial primary key,
  lead_id text not null references leads(id),
  twilio_call_sid text unique,
  mode text not null,
  started_at timestamptz,
  ended_at timestamptz,
  disposition text,
  summary text,
  transcript_ref text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists suppressions (
  normalized_phone text primary key,
  reason text not null,
  source text not null,
  created_at timestamptz not null default now()
);

create table if not exists call_events (
  id bigserial primary key,
  call_attempt_id bigint references call_attempts(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_call_attempts_lead_started on call_attempts(lead_id, started_at desc);
create index if not exists idx_call_events_attempt on call_events(call_attempt_id, created_at);
