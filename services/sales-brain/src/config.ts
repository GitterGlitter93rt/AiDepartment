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
function bool(key: string, fallback = false): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
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
    port: Number(optional('SALES_PORTAL_PORT', '8080')),
    bind: optional('SALES_PORTAL_BIND', '127.0.0.1'),
    sessionSecret: required('SESSION_SECRET'),
    sessionCookieSecure: bool('SESSION_COOKIE_SECURE', false),
    sessionTtlHours: Number(optional('SESSION_TTL_HOURS', '12')),
  },

  /**
   * PUBLIC_ONLY is the V1 default. Apollo is an optional adapter, never a prerequisite
   * (public-decision-maker-resolution-spec §2, §19).
   */
  contactEnrichmentMode: optional('CONTACT_ENRICHMENT_MODE', 'PUBLIC_ONLY') as ContactEnrichmentMode,
  apolloApiKey: optional('APOLLO_API_KEY'),

  booking: {
    tenantId: optional('MS_GRAPH_TENANT_ID'),
    clientId: optional('MS_GRAPH_CLIENT_ID'),
    clientSecret: optional('MS_GRAPH_CLIENT_SECRET'),
    calendarUpn: optional('BOOKING_CALENDAR_UPN', 'michael@youraidepartment.ai'),
    timezone: optional('BOOKING_TIMEZONE', 'America/New_York'),
    get isConfigured(): boolean {
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
    concurrency: Number(optional('WORKER_CONCURRENCY', '2')),
    pollIntervalMs: Number(optional('WORKER_POLL_INTERVAL_MS', '2000')),
    leaseSeconds: Number(optional('WORKER_LEASE_SECONDS', '300')),
    userAgent: optional(
      'RESEARCH_USER_AGENT',
      'YourAIDepartment-Research/0.1 (+https://youraidepartment.ai; business research)',
    ),
  },
} as const;
