import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Loads .env without a dependency. Values already present in the real environment win,
 * so systemd/compose overrides beat the file.
 */
function loadEnvFile(): void {
  const envPath = resolve(packageRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvFile();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable ${key}. See .env.example.`);
  return value;
}
function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}
const TRUE_WORDS = new Set(['true', '1', 'yes', 'on']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'off']);

/**
 * A flag, read the same way everywhere.
 *
 * There were two dialects. `bool()` accepted true, 1 and yes; nine other places
 * compared against the string 'true'. Both read OUTBOUND_DIAL_ENABLED, so `=1`
 * armed outbound dialling while the release manifest and the exposure preflight
 * each reported it disabled -- true of the code and false of the screen, on the one
 * flag where that gap can put a call on a real phone.
 *
 * Anything unrecognised throws rather than defaulting. A flag is set by hand in a
 * file, and a value nobody can interpret must not be interpreted: silently reading
 * `disabled?` as false is how a deliberate setting becomes a surprise.
 */
export function flag(
  key: string, fallback = false, env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(value)) return true;
  if (FALSE_WORDS.has(value)) return false;
  throw new Error(
    `Environment variable ${key} is set to "${raw}", which is not a yes or a no. `
    + `Use one of ${[...TRUE_WORDS].join(', ')} or ${[...FALSE_WORDS].join(', ')}.`);
}

/**
 * A number, read the same way everywhere, refusing anything that is not one.
 *
 * `Number('$20')` is NaN, and every comparison against NaN is false. So a spend
 * ceiling written the way a person writes money did not cap anything: the guard
 * `spent + assumed > budget` was false, and the ceiling reported itself as unset.
 * The same coercion sat under the DNC snapshot staleness block and a webhook's
 * replay window, so one typo could remove a money limit, a compliance limit or a
 * replay defence, and each of them by staying quiet.
 *
 * Unset still means the fallback -- that part was deliberate and is unchanged.
 * Unreadable now stops the process instead, naming the variable and its value.
 */
export function numeric(
  key: string, fallback: number,
  options: { min?: number; max?: number; env?: NodeJS.ProcessEnv } = {},
): number {
  const env = options.env ?? process.env;
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    throw new Error(
      `Environment variable ${key} is set to "${raw}", which is not a number. `
      + 'Write it as digits only, with no currency symbol, unit or separator.');
  }
  const min = options.min ?? 0;
  if (value < min) {
    throw new Error(
      `Environment variable ${key} is set to "${raw}", which is below the smallest `
      + `value that means anything here (at least ${min}).`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(
      `Environment variable ${key} is set to "${raw}", which is above the largest `
      + `value this accepts (at most ${options.max}).`);
  }
  return value;
}

function bool(key: string, fallback = false): boolean {
  return flag(key, fallback);
}

export type ContactEnrichmentMode =
  | 'PUBLIC_ONLY'
  | 'PUBLIC_THEN_PAID'
  | 'PAID_ALLOWED_FOR_TIER_A'
  | 'IMPORT_ONLY';

export const config = {
  packageRoot,
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',

  databaseUrl: required('DATABASE_URL'),

  portal: {
    port: numeric('SALES_PORTAL_PORT', 8080, { min: 1, max: 65535 }),
    bind: optional('SALES_PORTAL_BIND', '127.0.0.1'),
    sessionSecret: required('SESSION_SECRET'),
    sessionCookieSecure: bool('SESSION_COOKIE_SECURE', false),
    sessionTtlHours: numeric('SESSION_TTL_HOURS', 12, { min: 1 }),
  },

  /**
   * PUBLIC_ONLY is the V1 default. Apollo is an optional adapter, never a prerequisite
   * (public-decision-maker-resolution-spec §2, §19).
   */
  contactEnrichmentMode: optional('CONTACT_ENRICHMENT_MODE', 'PUBLIC_ONLY') as ContactEnrichmentMode,
  apolloApiKey: optional('APOLLO_API_KEY'),

  booking: {
    /**
     * Cal.com is the booking authority (calcom-strategy-call-booking-spec §1). It
     * owns availability, invites, reminders and cancellation, and syncs the event to
     * Michael's Outlook. The Graph adapter below stays available as a fallback but
     * must never create a second event for the same meeting.
     */
    provider: optional('BOOKING_PROVIDER', 'calcom'),
    calcomApiKey: optional('CALCOM_API_KEY'),
    calcomEventTypeId: optional('CALCOM_EVENT_TYPE_ID'),
    calcomWebhookSecret: optional('CALCOM_WEBHOOK_SECRET'),
    tenantId: optional('MS_GRAPH_TENANT_ID'),
    clientId: optional('MS_GRAPH_CLIENT_ID'),
    clientSecret: optional('MS_GRAPH_CLIENT_SECRET'),
    calendarUpn: optional('BOOKING_CALENDAR_UPN', 'michael@youraidepartment.ai'),
    timezone: optional('BOOKING_TIMEZONE', 'America/New_York'),
    get isConfigured(): boolean {
      if (optional('BOOKING_PROVIDER', 'calcom') === 'calcom') {
        return Boolean(optional('CALCOM_API_KEY') && optional('CALCOM_EVENT_TYPE_ID'));
      }
      return Boolean(
        optional('MS_GRAPH_TENANT_ID') && optional('MS_GRAPH_CLIENT_ID') && optional('MS_GRAPH_CLIENT_SECRET'),
      );
    },
  },

  /**
   * Outbound kill switches. Both stay false until the controlled pilot gate is
   * explicitly approved (CLAUDE-CURRENT-TASK.md §5).
   */
  outbound: {
    dialEnabled: bool('OUTBOUND_DIAL_ENABLED', false),
    emailEnabled: bool('OUTBOUND_EMAIL_ENABLED', false),
  },

  worker: {
    concurrency: numeric('WORKER_CONCURRENCY', 2, { min: 1 }),
    pollIntervalMs: numeric('WORKER_POLL_INTERVAL_MS', 2000, { min: 100 }),
    leaseSeconds: numeric('WORKER_LEASE_SECONDS', 300, { min: 10 }),
    userAgent: optional(
      'RESEARCH_USER_AGENT',
      'YourAIDepartment-Research/0.1 (+https://youraidepartment.ai; business research)',
    ),
  },
} as const;
