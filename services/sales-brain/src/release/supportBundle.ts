import { query } from '../db/pool.js';
import { redactSecrets } from '../workers/redaction.js';
import { captureDiagnostics, diagnose, type Diagnostics, type Diagnosis } from './doctor.js';
import { releaseManifest, type ReleaseManifest } from './manifest.js';
import { planRetention, type RetentionPlan } from '../retention/plan.js';
import { exposurePreflight, type PreflightReport } from './exposurePreflight.js';

/**
 * Everything somebody would ask for, in one file, safe to hand over.
 *
 * Five reports already exist and an operator with a broken system should not have to
 * know which of them to run. But concatenating them is not the point: the thing
 * support actually asks for first is "what was the error", and not one of the five
 * carries error text. They report counts, and a count cannot tell you that a
 * provider rejected a credential or that a page returned HTML where JSON was
 * expected.
 *
 * Error text is also where a secret leaks. An exception from a database driver
 * carries the connection string; a provider client puts the Authorization header in
 * its message. So every string that came from an exception goes through the same
 * redaction the worker already applies before storing a failure, and the bundle is
 * checked as a whole rather than per report.
 *
 * What it deliberately does not carry: company names, phone numbers, email
 * addresses, page content. A support bundle is about the machine. Somebody
 * diagnosing a queue does not need to know who the prospects are, and a file that
 * travels by email should not contain them.
 */

export interface SupportBundle {
  generatedAt: string;
  manifest: ReleaseManifest;
  diagnostics: Diagnostics;
  diagnoses: Diagnosis[];
  retention: RetentionPlan;
  preflight: PreflightReport;
  /** Recent failures, with their error text redacted. */
  recentFailures: {
    jobType: string; status: string; attempts: number; outcome: string | null;
    completedAt: Date | null; error: string | null;
    /** A handler's own account of what went wrong, when it gave one. */
    outcomeReason: string | null;
  }[];
  /** Provider errors by code and count. Codes, never bodies. */
  providerErrors: { provider: string; errorCode: string; n: number }[];
  /** What the schema looks like, so a support reader can spot a partial migration. */
  tableCounts: { table: string; rows: number }[];
}

/**
 * Tables whose row counts say something about the machine rather than about the
 * prospects. `accounts` is a count, which is fine; the names are not here.
 */
const COUNTED_TABLES = [
  'accounts', 'contacts', 'contact_endpoints', 'evidence_records', 'research_runs',
  'search_observations', 'jobs', 'provider_tasks', 'provider_usage',
  'duplicate_reviews', 'saved_markets', 'worker_instances', 'schema_migrations',
];

export async function supportBundle(): Promise<SupportBundle> {
  const diagnostics = await captureDiagnostics();

  const { rows: failures } = await query<{
    job_type: string; status: string; attempts: number; outcome: string | null;
    completed_at: Date | null; last_error: string | null; outcome_reason: string | null;
  }>(
    `select job_type, status, attempts, outcome, outcome_reason, completed_at, last_error
       from jobs
      where status = 'FAILED' or last_error is not null
         or outcome in ('PARTIAL', 'FAILED', 'PROVIDER_UNAVAILABLE')
      order by coalesce(completed_at, created_at) desc
      limit 25`);

  const { rows: providerErrors } = await query<{
    provider: string; error_code: string; n: number;
  }>(
    `select provider, error_code, count(*)::int as n
       from provider_usage
      where error_code is not null
        and requested_at > now() - interval '7 days'
      group by provider, error_code
      order by count(*) desc limit 20`);

  const tableCounts: { table: string; rows: number }[] = [];
  for (const table of COUNTED_TABLES) {
    try {
      const { rows } = await query<{ n: number }>(
        `select count(*)::int as n from ${table}`);
      tableCounts.push({ table, rows: rows[0]!.n });
    } catch {
      // A table that does not exist is itself worth reporting: it means this build
      // and this database disagree, which the manifest also says.
      tableCounts.push({ table, rows: -1 });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    manifest: await releaseManifest(),
    diagnostics,
    diagnoses: diagnose(diagnostics),
    retention: await planRetention(),
    preflight: await exposurePreflight(),
    recentFailures: failures.map((row) => ({
      jobType: row.job_type,
      status: row.status,
      attempts: row.attempts,
      outcome: row.outcome,
      completedAt: row.completed_at,
      // The two fields in this bundle that came from an exception. Redacted on read
      // as well as on write: rows written before that filter existed are still here.
      error: row.last_error === null ? null : redactSecrets(row.last_error).slice(0, 600),
      outcomeReason: row.outcome_reason === null
        ? null : redactSecrets(row.outcome_reason).slice(0, 600),
    })),
    providerErrors: providerErrors.map((row) => ({
      provider: row.provider, errorCode: row.error_code, n: row.n,
    })),
    tableCounts,
  };
}

export function renderSupportBundle(bundle: SupportBundle): string {
  const lines = ['', 'SALES BRAIN SUPPORT BUNDLE', `  ${bundle.generatedAt}`, ''];

  lines.push('  what it looks like');
  for (const diagnosis of bundle.diagnoses) {
    lines.push(`     [${diagnosis.category}] ${diagnosis.finding}`);
  }
  lines.push('');

  lines.push(`  build ${bundle.manifest.build.sha}, `
    + `${bundle.manifest.build.migrationsApplied} of `
    + `${bundle.manifest.build.migrationsShipped
      ?? 'an unknown number of'} migrations applied, `
    + `scoring ${bundle.manifest.scoring.policyVersion}`);
  lines.push(`  workers ${bundle.diagnostics.workers.online} online, `
    + `queue ${bundle.diagnostics.queue.queued} waiting, `
    + `${bundle.diagnostics.queue.failed24h} failed today`);
  lines.push('');

  if (bundle.recentFailures.length > 0) {
    lines.push('  recent failures (error text redacted)');
    for (const failure of bundle.recentFailures.slice(0, 10)) {
      lines.push(`     ${failure.jobType} ${failure.status} `
        + `after ${failure.attempts} attempt(s)`);
      if (failure.error) lines.push(`        ${failure.error.slice(0, 200)}`);
      if (failure.outcomeReason) {
        lines.push(`        ${failure.outcomeReason.slice(0, 200)}`);
      }
    }
    lines.push('');
  }

  if (bundle.providerErrors.length > 0) {
    lines.push('  provider errors this week (codes only)');
    for (const error of bundle.providerErrors) {
      lines.push(`     ${error.provider} ${error.errorCode}: ${error.n}`);
    }
    lines.push('');
  }

  lines.push('  row counts');
  for (const entry of bundle.tableCounts) {
    lines.push(`     ${entry.table.padEnd(24)} ${entry.rows === -1
      ? 'MISSING — this build and this database disagree' : entry.rows}`);
  }
  lines.push('');
  lines.push('  No credentials, company names, phone numbers, email addresses or page');
  lines.push('  content appear in this bundle. It is about the machine.');
  lines.push('');
  return lines.join('\n');
}
