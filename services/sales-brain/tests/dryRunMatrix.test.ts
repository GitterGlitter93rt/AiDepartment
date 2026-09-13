import './setup.js';
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { runDryRunMatrix, type MatrixReport } from '../src/release/dryRunMatrix.js';

/**
 * The credential-free end-to-end matrix.
 * Authority: outbound-sales-brain-end-to-end-simulation-spec.md.
 *
 * Twenty situations, most of which should end in a refusal. The matrix is run once
 * and inspected, because building twenty accounts is the expensive part.
 */

let report: MatrixReport;

before(async () => { await resetDatabase(); report = await runDryRunMatrix(); });
after(async () => { await pool.end(); });

test('every class passes, and every class ran', () => {
  const failed = report.classes.filter((row) => row.status !== 'PASS');
  assert.deepEqual(failed.map((row) => `${row.id}: ${row.failed.join(', ')}`), []);
  assert.equal(report.classes.length, 20);
  assert.equal(report.status, 'PASS');
});

test('the matrix covers the twenty classes the plan names', () => {
  assert.deepEqual(report.classes.map((row) => row.id), [
    'great_prospect_human_allowed_ai_review', 'great_prospect_ai_blocked',
    'gatekeeper_only_route', 'strong_pain_hypothesis', 'weak_unsupported_hypothesis',
    'no_decision_maker_identity', 'named_dm_no_direct_endpoint', 'positive_smartlead_reply',
    'existing_strategy_meeting', 'existing_opportunity', 'dnc_suppressed', 'wrong_number',
    'stale_research', 'calling_window_closed', 'provider_unavailable', 'booking_succeeds',
    'booking_fails', 'send_email_request', 'callback_after_outbound', 'strong_process_no_need',
  ]);
});

test('every class proves the whole chain, not just the end of it', () => {
  const required = ['account_evidence_score', 'call_pack', 'channel_eligibility', 'crm_state'];
  for (const row of report.classes) {
    const stages = row.stages.map((stage) => stage.stage);
    for (const stage of required) {
      assert.ok(stages.includes(stage), `${row.id} is missing the ${stage} link`);
    }
  }
});

test('nothing in the matrix manufactured production clearance', () => {
  for (const row of report.classes) {
    const eligibility = row.stages.find((stage) => stage.stage === 'channel_eligibility');
    if (!eligibility?.evidence) continue;
    assert.notEqual(eligibility.evidence['aiVoice'], 'ALLOW',
      `${row.id} cleared AI voice, and no screening provider is configured`);
  }
});

test('the matrix logged no contact attempt of its own', async () => {
  // The one class that seeds an attempt does so deliberately, to test a callback.
  const { rows } = await query<{ n: number; sources: string[] }>(
    `select count(*)::int as n, array_agg(distinct channel) as sources from contact_attempts`);
  assert.ok(rows[0]!.n <= 1, `${rows[0]!.n} contact attempts exist`);
});

test('every voice call the matrix made is labelled as a dry run', async () => {
  const { rows } = await query<{ mode_at_start: string; n: number }>(
    `select mode_at_start, count(*)::int as n from voice_calls
      where direction = 'OUTBOUND' group by 1`);
  for (const row of rows) {
    assert.equal(row.mode_at_start, 'DRY_RUN',
      'an outbound call in the matrix must be labelled a dry run');
  }
});

test('a confirmed booking exists only where the provider confirmed one', async () => {
  const { rows } = await query<any>(
    `select status, provider_event_id from meeting_bookings`);
  for (const row of rows) {
    if (row.status === 'CONFIRMED') {
      assert.ok(row.provider_event_id,
        'a booking is confirmed only when the provider returned an event id');
    }
  }
});

test('the suppressed class is callable by nobody', () => {
  const suppressed = report.classes.find((row) => row.id === 'dnc_suppressed')!;
  assert.equal(suppressed.assertions['not_callable'], true);
  assert.equal(suppressed.assertions['suppression_on_file'], true);
});

test('the callback class never reaches the cold opener', () => {
  const callback = report.classes.find((row) => row.id === 'callback_after_outbound')!;
  assert.equal(callback.assertions['receptionist_profile_only'], true);
  assert.equal(callback.assertions['not_a_cold_opener'], true);
  assert.equal(callback.assertions['attached_to_the_account'], true);
});

test('a hook is never claimed from evidence that expired', () => {
  const stale = report.classes.find((row) => row.id === 'stale_research')!;
  assert.equal(stale.assertions['expired_advertising_not_used_as_a_hook'], true);
});

test('a closed calling window is a refusal with a reason', () => {
  const window = report.classes.find((row) => row.id === 'calling_window_closed')!;
  assert.equal(window.assertions['window_closed_is_a_refusal'], true);
});

test('the whole matrix is offline', () => {
  assert.equal(report.offline, true);
});
