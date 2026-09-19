-- 017_integration_settings.sql — Settings & Integrations.
-- Authority: YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §25,
-- yad-sales-crm-page-acceptance-matrix.v1.yaml (/settings).
--
-- Secrets are write-only. This table deliberately has no column that can hold one:
-- it stores non-secret configuration, where the secret lives (an environment variable
-- name), and enough metadata to prove a credential was set without revealing it.

create table integration_settings (
  integration_key   text primary key
                    check (integration_key in ('calcom','smartlead','twilio_voice','dataforseo',
                                               'anthropic','crm','notifications')),
  display_name      text not null,
  enabled           boolean not null default false,
  -- Non-secret configuration only: event type ids, base URLs, calendar targets.
  config            jsonb not null default '{}'::jsonb,
  -- Where the credential is read from at runtime. Never the credential itself.
  secret_env_var    text,
  secret_present    boolean not null default false,
  secret_last4      text check (secret_last4 is null or length(secret_last4) <= 4),
  secret_set_at     timestamptz,
  last_check_at     timestamptz,
  last_check_status text check (last_check_status in ('OK','DEGRADED','FAILED','NOT_CONFIGURED')),
  last_check_detail text,
  updated_by        uuid references users(user_id),
  updated_at        timestamptz not null default now()
);

insert into integration_settings (integration_key, display_name, secret_env_var) values
  ('calcom',       'Cal.com scheduling',   'CALCOM_API_KEY'),
  ('smartlead',    'Smartlead email',      'SMARTLEAD_API_KEY'),
  ('twilio_voice', 'Twilio voice',         'TWILIO_AUTH_TOKEN'),
  ('dataforseo',   'DataForSEO research',  'DATAFORSEO_PASSWORD'),
  ('anthropic',    'Anthropic',            'ANTHROPIC_API_KEY'),
  ('crm',          'CRM export',           null),
  ('notifications','Notifications',        null)
on conflict do nothing;

create trigger integration_settings_updated_at before update on integration_settings
  for each row execute function set_updated_at();
