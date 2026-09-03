import { execSync } from 'node:child_process';
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { createUser } from '../src/domain/auth.js';

/**
 * Tests run against a dedicated database so they never touch working inventory.
 * TEST_DATABASE_URL is set by tests/setup before src/config is imported.
 */
export async function resetDatabase(): Promise<void> {
  await runMigrations(() => {});
  // Truncate in one statement so FK order does not matter.
  await pool.query(`
    truncate table
      audit_log, ownership_events, activities, follow_ups, suppressions, prospect_statements,
      evidence_records, search_observations, research_runs, canonical_scores, research_completeness,
      opportunity_hypotheses, offer_hypotheses, call_packs, meeting_bookings,
      import_rows, import_batches, jobs, mining_jobs, provider_usage,
      account_market_membership, saved_markets, search_contexts, source_identities, account_merges,
      contact_endpoints, contacts, account_domains, locations, accounts, sessions, users
    restart identity cascade
  `);
}

export async function makeUser(
  displayName: string,
  role: 'SALES_REP' | 'SALES_MANAGER' | 'RESEARCH_OPS' | 'ADMIN' = 'SALES_REP',
): Promise<{ userId: string; role: typeof role; activeClaimTarget: number | null; displayName: string }> {
  const email = `${displayName.toLowerCase().replace(/\W+/g, '.')}@test.youraidepartment.ai`;
  const userId = await createUser({ email, displayName, role, password: 'test-password-not-a-secret' });
  return { userId, role, activeClaimTarget: null, displayName };
}

export { pool, pg, execSync };
