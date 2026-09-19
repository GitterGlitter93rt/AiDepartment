import { pool, query } from '../db/pool.js';
import { resolveCandidates, type CandidateObservation } from '../discovery/resolve.js';
import { registrableDomain } from '../discovery/sourceClass.js';
import type { NormalizedResultType } from '../discovery/observation.js';

/**
 * What a discovery run would have produced under the promotion rules.
 *
 * The canary created 65 Accounts from one search and 19 of them were not companies.
 * Those Accounts exist. Nothing here deletes them, merges them, suppresses them or
 * edits them: the tool reads the observations that run wrote, runs today's resolver
 * over them, and prints the difference between what is in the database and what the
 * rules say should be.
 *
 * Dry run is the only mode that exists in this file. An apply mode is a separate
 * piece of work with its own review, because changing 65 Accounts on the strength of
 * a rule change is exactly the kind of bulk edit that needs a person who has read the
 * output first. `--dry-run` is therefore mandatory rather than a default: a flag that
 * defaults to safe is one somebody can forget is there.
 *
 *   npm run discovery:reprocess -- --job <id> --dry-run
 *
 * No provider is called. No research is queued. Nothing is written.
 */

interface Args { jobId: string | null; dryRun: boolean; }

function parseArgs(argv: string[]): Args {
  let jobId: string | null = null;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--job') { jobId = argv[index + 1] ?? null; index += 1; continue; }
    if (arg === '--dry-run') { dryRun = true; continue; }
  }
  return { jobId, dryRun };
}

/** The stored vocabulary, back into the resolver's. */
const RESULT_TYPE: Record<string, NormalizedResultType> = {
  paid_search: 'PAID_SEARCH_TEXT',
  local_service_ad: 'LOCAL_SERVICES_AD',
  sponsored_local: 'PAID_LOCAL',
  local_result: 'MAPS_LOCAL',
  organic: 'ORGANIC',
  directory_result: 'ORGANIC',
  transparency_ad: 'PAID_SEARCH_TEXT',
};

export interface ReprocessReport {
  jobId: string;
  observations: number;
  accountsFromThisRun: number;
  candidates: number;
  verified: number;
  needsReview: number;
  rejected: number;
  /** Accounts this run created that the rules would not promote today. */
  accountsThatWouldNotPromote: { accountId: string; name: string; reason: string }[];
  /** Identities the run never made an Account for, which the rules would promote. */
  wouldNowPromote: string[];
}

export async function reprocessJob(jobId: string): Promise<ReprocessReport> {
  const { rows: observationRows } = await query<{
    observed_name: string | null; observed_domain: string | null;
    observed_phone: string | null; observed_location: string | null;
    result_type: string | null; position: number | null; landing_url: string | null;
    account_id: string | null;
  }>(
    `select observed_name, observed_domain, observed_phone, observed_location,
            result_type, position, landing_url, account_id
       from search_observations
      where job_id = $1
      order by position nulls last`, [jobId]);

  const observations: CandidateObservation[] = observationRows.map((row) => ({
    resultType: RESULT_TYPE[row.result_type ?? ''] ?? 'ORGANIC',
    observedName: row.observed_name,
    observedDomain: row.observed_domain,
    observedPhone: row.observed_phone,
    // The stored column held the searched geography for these rows, which is exactly
    // the confusion this remediation removed. It is not read back as a business
    // address: a reprocess that re-used it would re-derive the original mistake.
    observedBusinessAddress: null,
    landingUrl: row.landing_url,
    position: row.position,
  }));

  const candidates = resolveCandidates(observations);
  const verifiedIdentities = new Set(
    candidates.filter((candidate) => candidate.status === 'VERIFIED')
      .map((candidate) => candidate.identity));

  // Accounts this run actually created, with the identity each was created under.
  const { rows: accountRows } = await query<{
    account_id: string; canonical_name: string; canonical_domain: string | null;
    phone: string | null;
  }>(
    `select distinct a.account_id, a.canonical_name, a.canonical_domain,
            (select e.normalized_value from contacts c
               join contact_endpoints e on e.contact_id = c.contact_id
              where c.account_id = a.account_id and e.endpoint_type = 'PHONE'
              order by e.created_at limit 1) as phone
       from accounts a
       join search_observations o on o.account_id = a.account_id
      where o.job_id = $1`, [jobId]);

  const accountsThatWouldNotPromote: ReprocessReport['accountsThatWouldNotPromote'] = [];
  const heldIdentities = new Set<string>();
  for (const account of accountRows) {
    const identity = registrableDomain(account.canonical_domain)
      ?? (account.phone?.trim() || null);
    if (identity) heldIdentities.add(identity);
    const candidate = candidates.find((row) => row.identity === identity);
    if (!identity || !candidate || candidate.status !== 'VERIFIED') {
      accountsThatWouldNotPromote.push({
        accountId: account.account_id,
        name: account.canonical_name,
        reason: candidate
          ? `${candidate.status}: ${candidate.reasons[0] ?? 'not promotable'}`
          : 'no identity in this run resolves to this Account',
      });
    }
  }

  return {
    jobId,
    observations: observationRows.length,
    accountsFromThisRun: accountRows.length,
    candidates: candidates.length,
    verified: candidates.filter((candidate) => candidate.status === 'VERIFIED').length,
    needsReview: candidates.filter((candidate) => candidate.status === 'NEEDS_REVIEW').length,
    rejected: candidates.filter((candidate) => candidate.status === 'REJECTED').length,
    accountsThatWouldNotPromote,
    wouldNowPromote: [...verifiedIdentities].filter((identity) => !heldIdentities.has(identity)),
  };
}

export function renderReprocessReport(report: ReprocessReport): string {
  const lines = [
    `Discovery reprocess (dry run) for job ${report.jobId}`,
    '',
    `  observations on record          ${report.observations}`,
    `  Accounts this run is linked to  ${report.accountsFromThisRun}`,
    '',
    '  Under the current rules those observations resolve to:',
    `    identities                    ${report.candidates}`,
    `    verified                      ${report.verified}`,
    `    needs review                  ${report.needsReview}`,
    `    rejected                      ${report.rejected}`,
    '',
    `  Accounts that would not be promoted today: ${report.accountsThatWouldNotPromote.length}`,
  ];
  for (const account of report.accountsThatWouldNotPromote.slice(0, 100)) {
    lines.push(`    ${account.accountId}  ${account.name.slice(0, 50)}`);
    lines.push(`      ${account.reason}`);
  }
  if (report.accountsThatWouldNotPromote.length > 100) {
    lines.push(`    ... and ${report.accountsThatWouldNotPromote.length - 100} more`);
  }
  lines.push('');
  lines.push(`  Identities that would promote and have no Account: ${report.wouldNowPromote.length}`);
  for (const identity of report.wouldNowPromote.slice(0, 50)) lines.push(`    ${identity}`);
  lines.push('');
  lines.push('  Nothing was changed. No Account was created, edited, merged, suppressed');
  lines.push('  or deleted, no research was queued and no provider was called.');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobId) {
    console.error('Usage: npm run discovery:reprocess -- --job <id> --dry-run');
    process.exitCode = 2;
    return;
  }
  if (!args.dryRun) {
    // Deliberately not a default. This tool exists to be read before anything is
    // decided, and an apply mode does not exist yet: refusing here is the difference
    // between "we have not built it" and "we built it and hoped nobody ran it".
    console.error('--dry-run is required. This tool has no apply mode.');
    process.exitCode = 2;
    return;
  }
  console.log(renderReprocessReport(await reprocessJob(args.jobId)));
}

if (process.argv[1] && process.argv[1].includes('discovery-reprocess')) {
  await main();
  await pool.end();
}
