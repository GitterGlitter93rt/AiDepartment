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
      pilot_candidates, voice_call_turns, voice_call_events,
      audio_pilot_attempts, audio_pilot_batches, internal_test_numbers,
      line_type_screen_results, audio_scenario_runs, media_capture_consent,
      dnc_screen_log, dnc_membership, dnc_snapshots, dnc_subscriptions,
      voice_calls, voice_pilot_state_events,
      contact_endpoints, contacts, account_domains, locations, accounts, sessions, users
    restart identity cascade
  `);

  // Truncating `users` cascades into every table that references it, which includes
  // the operator state and the integration registry. Both are configuration rather
  // than data, so they are restored to the state a fresh install ships with.
  await pool.query(`insert into voice_pilot_state (singleton) values (true) on conflict do nothing`);
  await pool.query(`
    insert into integration_settings (integration_key, display_name, secret_env_var) values
      ('calcom',       'Cal.com scheduling',   'CALCOM_API_KEY'),
      ('smartlead',    'Smartlead email',      'SMARTLEAD_API_KEY'),
      ('twilio_voice', 'Twilio voice',         'TWILIO_AUTH_TOKEN'),
      ('dataforseo',   'DataForSEO research',  'DATAFORSEO_PASSWORD'),
      ('anthropic',    'Anthropic',            'ANTHROPIC_API_KEY'),
      ('crm',          'CRM export',           null),
      ('notifications','Notifications',        null),
      ('dnc',          'National DNC screening','DNC_SUBSCRIPTION_CREDENTIAL')
    on conflict do nothing`);
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
