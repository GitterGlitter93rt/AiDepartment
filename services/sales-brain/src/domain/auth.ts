import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { pool, query } from '../db/pool.js';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;

export type Role = 'SALES_REP' | 'SALES_MANAGER' | 'RESEARCH_OPS' | 'ADMIN';

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  activeClaimTarget: number | null;
}

/** scrypt via node:crypto — no native bcrypt build, which matters on this aarch64 box. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

/**
 * The cookie carries a random token; the database stores only its SHA-256.
 * A database read therefore cannot be replayed as a session.
 */
function sessionIdFor(token: string): string {
  return createHash('sha256').update(token).update(config.portal.sessionSecret).digest('hex');
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined } = {},
): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.portal.sessionTtlHours * 3_600_000);
  await query(
    `insert into sessions (session_id, user_id, expires_at, user_agent, ip)
     values ($1, $2, $3, $4, $5)`,
    [sessionIdFor(token), userId, expiresAt, meta.userAgent ?? null, meta.ip ?? null],
  );
  await query('update users set last_login_at = now() where user_id = $1', [userId]);
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await query<{
    user_id: string; email: string; display_name: string; role: Role; active_claim_target: number | null;
  }>(
    `update sessions s set last_seen_at = now()
       from users u
      where s.session_id = $1
        and s.user_id = u.user_id
        and s.revoked_at is null
        and s.expires_at > now()
        and u.is_active
     returning u.user_id, u.email, u.display_name, u.role, u.active_claim_target`,
    [sessionIdFor(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    activeClaimTarget: row.active_claim_target,
  };
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await query('update sessions set revoked_at = now() where session_id = $1 and revoked_at is null', [
    sessionIdFor(token),
  ]);
}

export interface LoginResult {
  ok: boolean;
  user?: SessionUser;
  reason?: 'INVALID_CREDENTIALS' | 'DISABLED';
}

export async function authenticate(email: string, password: string): Promise<LoginResult> {
  const { rows } = await query<{
    user_id: string; email: string; display_name: string; role: Role;
    password_hash: string | null; is_active: boolean; active_claim_target: number | null;
  }>(
    `select user_id, email, display_name, role, password_hash, is_active, active_claim_target
       from users where email_normalized = $1`,
    [email.trim().toLowerCase()],
  );
  const row = rows[0];

  // Always run a verify so a missing user and a wrong password cost the same time.
  const passwordOk = await verifyPassword(password, row?.password_hash ?? null);
  if (!row || !passwordOk) return { ok: false, reason: 'INVALID_CREDENTIALS' };
  if (!row.is_active) return { ok: false, reason: 'DISABLED' };

  return {
    ok: true,
    user: {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      activeClaimTarget: row.active_claim_target,
    },
  };
}

export async function createUser(input: {
  email: string;
  displayName: string;
  role: Role;
  password: string;
  activeClaimTarget?: number | null;
}): Promise<string> {
  const passwordHash = await hashPassword(input.password);
  const { rows } = await query<{ user_id: string }>(
    `insert into users (email, email_normalized, display_name, role, password_hash, active_claim_target)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (email_normalized) do update
        set display_name = excluded.display_name,
            role = excluded.role,
            password_hash = excluded.password_hash,
            active_claim_target = excluded.active_claim_target,
            is_active = true
     returning user_id`,
    [
      input.email.trim(),
      input.email.trim().toLowerCase(),
      input.displayName,
      input.role,
      passwordHash,
      input.activeClaimTarget ?? null,
    ],
  );
  return rows[0]!.user_id;
}

export async function purgeExpiredSessions(): Promise<number> {
  const result = await pool.query('delete from sessions where expires_at < now() - interval \'7 days\'');
  return result.rowCount ?? 0;
}

// --- RBAC ------------------------------------------------------------------
// Enforced server-side on every route (rep-portal-api-contract.v1.md §1, §21).

export type Permission =
  | 'search_inventory' | 'browse_markets' | 'claim_accounts' | 'work_owned_accounts'
  | 'create_disposition' | 'create_callback' | 'create_dnc' | 'remove_dnc'
  | 'assign_accounts' | 'reassign_accounts' | 'release_any_account'
  | 'configure_markets' | 'request_market_refresh' | 'request_contact_research'
  | 'view_team_ownership' | 'export_inventory' | 'manage_users' | 'run_imports'
  | 'rescreen_channel_eligibility';

const REP_PERMISSIONS: Permission[] = [
  'search_inventory', 'browse_markets', 'claim_accounts', 'work_owned_accounts',
  'create_disposition', 'create_callback', 'create_dnc', 'request_contact_research',
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...REP_PERMISSIONS,
  'assign_accounts', 'reassign_accounts', 'release_any_account', 'configure_markets',
  'request_market_refresh', 'view_team_ownership', 'export_inventory', 'run_imports',
  'rescreen_channel_eligibility',
];

const RESEARCH_OPS_PERMISSIONS: Permission[] = [
  'search_inventory', 'browse_markets', 'configure_markets', 'request_market_refresh',
  'request_contact_research', 'run_imports', 'rescreen_channel_eligibility',
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SALES_REP: REP_PERMISSIONS,
  SALES_MANAGER: MANAGER_PERMISSIONS,
  RESEARCH_OPS: RESEARCH_OPS_PERMISSIONS,
  // remove_dnc is deliberately admin-only: reps may add DNC, never lift it
  // (rep-inventory-contract.v1.yaml rep_permissions.may_not).
  ADMIN: [...MANAGER_PERMISSIONS, 'remove_dnc', 'manage_users'],
};

export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isManager(role: Role): boolean {
  return role === 'SALES_MANAGER' || role === 'ADMIN';
}
