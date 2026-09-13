-- 023_dnc_integration_row.sql — the DNC provider appears on the settings page.
--
-- It was the one blocker with no row of its own, which meant the page that lists what
-- is missing did not list the thing blocking the most gates.

alter table integration_settings drop constraint if exists integration_settings_integration_key_check;
alter table integration_settings add constraint integration_settings_integration_key_check
  check (integration_key in ('calcom','smartlead','twilio_voice','dataforseo',
                             'anthropic','crm','notifications','dnc'));

insert into integration_settings (integration_key, display_name, secret_env_var)
values ('dnc', 'National DNC screening', 'DNC_SUBSCRIPTION_CREDENTIAL')
on conflict do nothing;
