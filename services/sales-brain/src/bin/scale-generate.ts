import '../synthetic/scaleSetup.js';
import { runMigrations } from '../db/migrate.js';
import { pool } from '../db/pool.js';
import { generateDataset } from '../synthetic/generator.js';
import { syncVerticalProfiles } from '../domain/verticals.js';

/**
 * Fills the scale database with a deterministic synthetic dataset.
 *
 *   npx tsx src/bin/scale-generate.ts --accounts 25000 --seed yad-scale-v1 [--truncate]
 *
 * Writes nothing that can be mistaken for outreach: no contact_attempts, no
 * email_outbox, no provider_usage. Every domain is `.invalid` and every phone is a
 * 555 number, so nothing generated here can be reached.
 */

function argument(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
}

const accounts = Number(argument('accounts', '25000'));
const seed = argument('seed', 'yad-scale-v1')!;
const chunkSize = Number(argument('chunk', '500'));
const truncate = process.argv.includes('--truncate');

await runMigrations((message) => console.log(`[migrate] ${message}`));

if (truncate) {
  console.log('[scale] truncating the scale database');
  await pool.query(`
    truncate table
      audit_log, ownership_events, activities, follow_ups, suppressions, prospect_statements,
      evidence_records, search_observations, research_runs, canonical_scores,
      research_completeness, opportunity_hypotheses, offer_hypotheses, call_packs,
      meeting_bookings, opportunity_stage_events, opportunities, booking_events,
      import_rows, import_batches, import_sessions, jobs, mining_jobs, provider_usage,
      account_market_membership, saved_markets, search_contexts, source_identities,
      account_merges, hook_attempts, pilot_candidates, voice_call_turns, voice_call_events,
      audio_pilot_attempts, audio_pilot_batches, internal_test_numbers,
      line_type_screen_results, audio_scenario_runs, media_capture_consent,
      dnc_screen_log, dnc_membership, dnc_snapshots, dnc_subscriptions,
      channel_eligibility_decisions, registry_screen_results, contact_attempts,
      email_events, email_enrollments, email_outbox, email_campaigns,
      voice_calls, voice_pilot_state_events,
      contact_endpoints, contacts, account_domains, locations, accounts, sessions, users
    restart identity cascade`);
  await pool.query(`insert into voice_pilot_state (singleton) values (true) on conflict do nothing`);
}

// The vertical registry is reference data, not fixture data: the generator points at
// real profile ids so a filtered query behaves the way it will in production.
const profiles = await syncVerticalProfiles();
console.log(`[scale] ${profiles} vertical profiles in the registry`);

console.log(`[scale] generating ${accounts} accounts with seed "${seed}"`);
const started = Date.now();
const ledger = await generateDataset({
  accounts, seed, chunkSize,
  onProgress: (done, total) => {
    if (done % 5_000 === 0 || done === total) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`[scale] ${done}/${total} accounts (${rate.toFixed(0)}/s)`);
    }
  },
});

console.log(JSON.stringify({
  seed: ledger.seed,
  elapsedSeconds: Math.round(ledger.elapsedMs / 100) / 10,
  accounts: ledger.accounts,
  claimed: ledger.claimedAccounts,
  unclaimed: ledger.unclaimedAccounts,
  suppressed: ledger.suppressedAccounts,
  locations: ledger.locations,
  contacts: ledger.contacts,
  endpoints: ledger.endpoints,
  evidence: ledger.evidenceRecords,
  activities: ledger.activities,
  followUps: ledger.followUps,
  opportunities: ledger.opportunities,
  meetings: ledger.meetings,
  enrollments: ledger.emailEnrollments,
  calls: ledger.voiceCalls,
  hookAttempts: ledger.hookAttempts,
  duplicatePairs: ledger.duplicatePairs,
  sharedPhonePairs: ledger.sharedPhonePairs,
}, null, 2));

await pool.end();
