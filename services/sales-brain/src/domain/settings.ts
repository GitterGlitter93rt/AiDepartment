import { query } from '../db/pool.js';

/**
 * Settings & Integrations.
 *
 * Nothing in this module can return a secret, because nothing stores one. The table
 * holds non-secret configuration and the *name* of the environment variable a
 * credential is read from; whether that variable is populated is checked from the
 * process environment at read time and reported as a boolean.
 */

export interface IntegrationView {
  key: string;
  displayName: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secretEnvVar: string | null;
  secretPresent: boolean;
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
    lastCheckAt: row.last_check_at,
    lastCheckStatus: row.last_check_status,
    lastCheckDetail: row.last_check_detail,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
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
