import { query } from '../db/pool.js';

/**
 * Settings & Integrations.
 *
 * Nothing in this module can return a secret, because nothing stores one. The table
 * holds non-secret configuration and the *name* of the environment variable a
 * credential is read from; whether that variable is populated is checked from the
 * process environment at read time and reported as a boolean.
 */

export interface RequiredSetting {
  name: string;
  present: boolean;
  /** Whether the value itself may ever be displayed. */
  secret: boolean;
  purpose: string;
}

export interface IntegrationView {
  key: string;
  displayName: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secretEnvVar: string | null;
  secretPresent: boolean;
  /** Every value this integration needs, and whether this server has it. */
  required: RequiredSetting[];
  /** Just the names of the missing ones, for the operator's to-do list. */
  missing: string[];
  lastCheckAt: Date | null;
  lastCheckStatus: 'OK' | 'DEGRADED' | 'FAILED' | 'NOT_CONFIGURED' | null;
  lastCheckDetail: string | null;
  updatedAt: Date;
  updatedByName: string | null;
}

export async function listIntegrations(env: NodeJS.ProcessEnv = process.env): Promise<IntegrationView[]> {
  const { rows } = await query<any>(
    `select s.integration_key, s.display_name, s.enabled, s.config, s.secret_env_var,
            s.last_check_at, s.last_check_status, s.last_check_detail, s.updated_at,
            u.display_name as updated_by_name
       from integration_settings s
       left join users u on u.user_id = s.updated_by
      order by s.display_name`,
  );
  return rows.map((row) => ({
    key: row.integration_key,
    displayName: row.display_name,
    enabled: row.enabled,
    config: row.config ?? {},
    secretEnvVar: row.secret_env_var,
    // Presence only. The value is never read into a response.
    secretPresent: Boolean(row.secret_env_var && (env[row.secret_env_var] ?? '').trim().length > 0),
    required: requiredFor(row.integration_key, env),
    missing: requiredFor(row.integration_key, env)
      .filter((setting) => !setting.present).map((setting) => setting.name),
    lastCheckAt: row.last_check_at,
    lastCheckStatus: row.last_check_status,
    lastCheckDetail: row.last_check_detail,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
  }));
}

/**
 * Everything an integration needs before it can work, named exactly.
 *
 * An operator adding a credential should not have to read the source to find out
 * what else is missing — a Cal.com key with no event type id is still not a working
 * calendar, and saying "not configured" for both is not help.
 */
const REQUIREMENTS: Record<string, Omit<RequiredSetting, 'present'>[]> = {
  calcom: [
    { name: 'CALCOM_API_KEY', secret: true, purpose: 'Server API key from the Cal.com account' },
    { name: 'CALCOM_EVENT_TYPE_ID', secret: false,
      purpose: 'The YAD 15-Minute AI Strategy Call event type' },
    { name: 'BOOKING_CALENDAR_UPN', secret: false,
      purpose: "The calendar bookings land on, e.g. michael@youraidepartment.ai" },
    { name: 'BOOKING_PROVIDER', secret: false, purpose: "Set to 'calcom' to make it the authority" },
  ],
  smartlead: [
    { name: 'SMARTLEAD_API_KEY', secret: true, purpose: 'Server API key' },
    { name: 'SMARTLEAD_ENABLED', secret: false, purpose: "Set to 'true' to allow exports to send" },
  ],
  twilio_voice: [
    { name: 'TWILIO_ACCOUNT_SID', secret: false, purpose: 'Account the number belongs to' },
    { name: 'TWILIO_AUTH_TOKEN', secret: true, purpose: 'Validates inbound webhook signatures' },
    { name: 'OUTBOUND_APPROVED_CALLER_IDS', secret: false,
      purpose: 'YAD numbers that may be presented as caller ID' },
    { name: 'TWILIO_LOOKUP_ENABLED', secret: false,
      purpose: "Set to 'true' to allow paid line-type screening" },
  ],
  dataforseo: [
    { name: 'DATAFORSEO_LOGIN', secret: false, purpose: 'Provider login' },
    { name: 'DATAFORSEO_PASSWORD', secret: true, purpose: 'Provider password' },
    { name: 'DATAFORSEO_GOVERNANCE_REVIEWED', secret: false,
      purpose: "Set to 'true' only once the source governance review is signed off" },
    { name: 'DATAFORSEO_ENABLED', secret: false, purpose: "Set to 'true' to allow discovery" },
  ],
  anthropic: [
    { name: 'ANTHROPIC_API_KEY', secret: true, purpose: 'Model access' },
  ],
  dnc: [
    { name: 'DNC_PROVIDER', secret: false,
      purpose: "Which screening source, e.g. 'ftc_national_dnc'" },
    { name: 'DNC_SUBSCRIPTION_CREDENTIAL_ENV', secret: false,
      purpose: 'Name of the variable holding the subscription credential' },
    { name: 'DNC_SUBSCRIPTION_CREDENTIAL', secret: true,
      purpose: 'The registry subscription credential itself' },
  ],
};

function requiredFor(key: string, env: NodeJS.ProcessEnv): RequiredSetting[] {
  return (REQUIREMENTS[key] ?? []).map((setting) => ({
    ...setting,
    present: (env[setting.name] ?? '').trim().length > 0,
  }));
}

export async function setIntegrationEnabled(input: {
  key: string; enabled: boolean; actorUserId: string; reason: string;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.reason.trim()) return { ok: false, message: 'A reason is required.' };
  const { rowCount } = await query(
    `update integration_settings set enabled = $2, updated_by = $3, updated_at = now()
      where integration_key = $1`,
    [input.key, input.enabled, input.actorUserId],
  );
  if (!rowCount) return { ok: false, message: 'Unknown integration.' };
  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, detail)
     values ($1, 'settings.integration_enabled', 'integration', $2, $3, $4::jsonb)`,
    [input.actorUserId, input.key, input.reason, JSON.stringify({ enabled: input.enabled })],
  );
  return { ok: true };
}

/**
 * Runs a connection check for one integration and records the result.
 *
 * The check asks each provider's own adapter whether it is actually usable, rather
 * than only whether an environment variable is set — a credential that is present
 * but rejected, or a provider still waiting on its source-governance review, must
 * not show as connected.
 *
 * No provider response body reaches the operator: the detail is a business message.
 */
export async function testIntegration(input: {
  key: string; actorUserId: string; env?: NodeJS.ProcessEnv;
}): Promise<{ status: 'OK' | 'DEGRADED' | 'FAILED' | 'NOT_CONFIGURED'; detail: string }> {
  const env = input.env ?? process.env;
  const result = await checkIntegration(input.key, env);
  await recordIntegrationCheck({ key: input.key, status: result.status, detail: result.detail });
  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, detail)
     values ($1, 'settings.integration_test', 'integration', $2, $3::jsonb)`,
    [input.actorUserId, input.key, JSON.stringify({ status: result.status })],
  );
  return result;
}

async function checkIntegration(key: string, env: NodeJS.ProcessEnv): Promise<{
  status: 'OK' | 'DEGRADED' | 'FAILED' | 'NOT_CONFIGURED'; detail: string;
}> {
  // Where a provider validator exists it is the authority: it asks the provider
  // whether the credential works *and* whether what it points at exists, which
  // "is the variable set" cannot answer.
  const validated = await validateOne(key, env);
  if (validated) return validated;

  switch (key) {
    case 'calcom': {
      const { currentCalendarAdapter } = await import('../booking/service.js');
      const adapter = currentCalendarAdapter();
      if (!adapter.isConfigured()) {
        return { status: 'NOT_CONFIGURED',
          detail: 'No scheduling credential is set, so no time can be offered or booked.' };
      }
      const busy = await adapter.getBusy({
        calendarUpn: env['BOOKING_CALENDAR_UPN'] ?? '',
        from: new Date(), to: new Date(Date.now() + 24 * 60 * 60 * 1000),
        durationMinutes: 15, timezone: env['BOOKING_TIMEZONE'] ?? 'America/New_York',
      });
      return busy.ok
        ? { status: 'OK', detail: 'The calendar answered a real availability request.' }
        : { status: 'FAILED', detail: 'The calendar is configured but did not answer.' };
    }
    case 'smartlead': {
      const { createSmartleadClient } = await import('../email/smartlead.js');
      return createSmartleadClient().isConfigured()
        ? { status: 'OK', detail: 'A credential is set and email export is enabled.' }
        : { status: 'NOT_CONFIGURED',
            detail: 'Email export is off or has no credential, so the outbox will hold.' };
    }
    case 'dataforseo': {
      const { createDataForSeoAdapter, dataForSeoConfig } = await import('../miner/dataForSeoAdapter.js');
      const config = dataForSeoConfig(env);
      if (!config.governanceReviewed) {
        return { status: 'NOT_CONFIGURED',
          detail: 'The source governance review is not recorded, so discovery may not run.' };
      }
      return createDataForSeoAdapter({ config }).isConfigured()
        ? { status: 'OK', detail: 'Reviewed, credentialed and enabled.' }
        : { status: 'NOT_CONFIGURED', detail: 'Reviewed, but no credential or not enabled.' };
    }
    case 'twilio_voice': {
      const present = Boolean((env['TWILIO_AUTH_TOKEN'] ?? '').trim());
      return present
        ? { status: 'OK', detail: 'A credential is set. Outbound is still governed by the pilot switches.' }
        : { status: 'NOT_CONFIGURED', detail: 'No voice credential is set on this server.' };
    }
    case 'anthropic': {
      const present = Boolean((env['ANTHROPIC_API_KEY'] ?? '').trim());
      return present
        ? { status: 'OK', detail: 'A credential is set.' }
        : { status: 'NOT_CONFIGURED', detail: 'No credential is set on this server.' };
    }
    default:
      return { status: 'NOT_CONFIGURED', detail: 'This integration has no connection test.' };
  }
}

/** Maps a provider validation onto the operator-facing status the page shows. */
async function validateOne(key: string, env: NodeJS.ProcessEnv): Promise<{
  status: 'OK' | 'DEGRADED' | 'FAILED' | 'NOT_CONFIGURED'; detail: string;
} | null> {
  const {
    validateCalcom, validateDataForSeo, validateSmartlead, validateTwilio, validateDncProvider,
  } = await import('../providers/validation.js');

  const validator = {
    calcom: validateCalcom,
    dataforseo: validateDataForSeo,
    smartlead: validateSmartlead,
    twilio_voice: validateTwilio,
    dnc: validateDncProvider,
  }[key];
  if (!validator) return null;

  const result = await validator({ env });
  // Every problem, not just the first. A missing password must not hide the fact that
  // the governance review is also outstanding — the operator needs the whole list to
  // fix it in one pass.
  const problems = result.checks.filter((check) => check.status !== 'OK'
    && check.status !== 'NOT_APPLICABLE');
  const detail = problems.length > 0
    ? problems.map((check) => check.detail).join(' ')
    : result.checks.map((check) => check.detail).join(' ') || 'Validated.';

  const status = result.status === 'OK' ? 'OK' as const
    : result.status === 'AUTH_FAILED' || result.status === 'ENTITY_NOT_FOUND' ? 'FAILED' as const
    : result.status === 'UNREACHABLE' ? 'DEGRADED' as const
    : 'NOT_CONFIGURED' as const;
  return { status, detail };
}

/**
 * Record the outcome of a connection test. The detail column is operator-facing text,
 * so callers must pass a business message, never a provider response body.
 */
export async function recordIntegrationCheck(input: {
  key: string; status: 'OK' | 'DEGRADED' | 'FAILED' | 'NOT_CONFIGURED'; detail: string;
}): Promise<void> {
  await query(
    `update integration_settings
        set last_check_at = now(), last_check_status = $2, last_check_detail = $3
      where integration_key = $1`,
    [input.key, input.status, input.detail.slice(0, 300)],
  );
}
