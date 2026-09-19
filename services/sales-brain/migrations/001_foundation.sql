-- 001_foundation.sql — users, sessions, audit, shared helpers.
-- Canonical authority: outbound-sales-brain-data-contract.md,
-- outbound-sales-brain-edge-xpert-sales-portal-deployment-spec.md §8.

create extension if not exists pgcrypto;

-- Every mutable table carries updated_at; one trigger function maintains it.
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users and roles. Deployment spec §8: individual accounts, no shared password.
-- ---------------------------------------------------------------------------
create table users (
  user_id           uuid primary key default gen_random_uuid(),
  email             text not null,
  email_normalized  text not null unique,
  display_name      text not null,
  role              text not null check (role in ('SALES_REP','SALES_MANAGER','RESEARCH_OPS','ADMIN')),
  password_hash     text,                       -- null until the user sets a password
  password_algo     text not null default 'scrypt',
  is_active         boolean not null default true,
  -- Manager-configurable anti-hoarding target (browse/claim spec §7). Null = use global default.
  active_claim_target integer,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

create table sessions (
  session_id    text primary key,               -- opaque high-entropy token id
  user_id       uuid not null references users(user_id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  user_agent    text,
  ip            inet,
  revoked_at    timestamptz
);
create index sessions_user_idx on sessions(user_id) where revoked_at is null;
create index sessions_expiry_idx on sessions(expires_at) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Audit log for privileged actions (API contract §21).
-- Append-only: no update path is ever granted to the application.
-- ---------------------------------------------------------------------------
create table audit_log (
  audit_id      bigserial primary key,
  actor_user_id uuid references users(user_id),
  action        text not null,
  subject_type  text,
  subject_id    text,
  reason        text,
  detail        jsonb not null default '{}'::jsonb,
  ip            inet,
  occurred_at   timestamptz not null default now()
);
create index audit_log_subject_idx on audit_log(subject_type, subject_id, occurred_at desc);
create index audit_log_actor_idx on audit_log(actor_user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Reference: vertical profiles, sourced from docs/09-software/vertical-profiles/.
-- Versioned so a Call Pack can pin the profile version it was built from.
-- ---------------------------------------------------------------------------
create table vertical_profiles (
  vertical_profile_id text primary key,          -- e.g. 'hvac'
  display_name        text not null,
  profile_version     text not null,
  is_active           boolean not null default true,
  definition          jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger vertical_profiles_updated_at before update on vertical_profiles
  for each row execute function set_updated_at();
