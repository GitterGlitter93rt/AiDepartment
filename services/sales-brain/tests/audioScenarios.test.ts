import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import {
  AUDIO_SCENARIOS, runScenario, recordScenarioRun, mediaCaptureAllowed,
} from '../src/voice/audioScenarios.js';
import { HYPOTHESIS_QUESTIONS } from '../src/callbrain/openerSelector.js';
import type { CallPack } from '../src/callbrain/callPack.js';
import type { AvailableTools } from '../src/callbrain/stateMachine.js';

/**
 * The audio regression scenario runner.
 * Authority: outbound-sales-brain-ai-pilot-release-gates.v1.yaml G09-G14, G19;
 * outbound-sales-brain-florida-recording-transcription-policy-research-2026-09.md §10.
 *
 * The pass criteria are settled here, before anybody picks up a phone, so an audio
 * run cannot be graded on how it felt.
 */

const TOOLS: AvailableTools = {
  booking: true, suppression: true, followUp: true, transfer: false, sms: false, email: true,
};

function pack(overrides: Partial<CallPack> = {}): CallPack {
  return {
    callPackId: null, accountId: 'acct-1',
    companyName: 'Northgate Air & Heating', geography: 'Jacksonville, FL', vertical: 'hvac',
    contactName: 'Dana Fielder', contactTitle: 'Owner', contactIsRoleOnly: false, askForRoute: null,
    confirmedFacts: [], importantUnknowns: [],
    primaryHypothesis: 'Paid emergency demand may arrive outside staffed hours.',
    primaryHypothesisCategory: 'after_hours',
    backupHypothesis: 'Unsold replacement estimates may not be followed up consistently.',
    backupHypothesisCategory: 'unsold_estimate_proposal_followup',
    firstQuestion: HYPOTHESIS_QUESTIONS['after_hours']!,
    backupQuestion: HYPOTHESIS_QUESTIONS['unsold_estimate']!,
    likelyObjections: [], knownSystems: [],
    prohibitedClaims: ['Do not state or estimate their advertising spend.'],
    allowedNextSteps: [], commercialTruth: '',
    ...overrides,
  };
}

function booking(options: { slots?: number; failBooking?: boolean } = {}) {
  const all = [
    { token: 's1', spoken: 'today at 4:15 PM', startIso: '2026-09-08T20:15:00Z' },
    { token: 's2', spoken: 'tomorrow at 10:30 AM', startIso: '2026-09-09T14:30:00Z' },
  ];
  return {
    getSlots: () => all.slice(0, options.slots ?? 2),
    book: () => ({ ok: !options.failBooking,
                   error: options.failBooking ? 'provider error' : undefined }),
  };
}

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

test('every scenario the release gates name is defined', () => {
  const ids = AUDIO_SCENARIOS.map((scenario) => scenario.id);
  assert.deepEqual(ids, [
    'hello_initial_answer', 'interruption_during_opener', 'short_yeah_is_not_consent',
    'gatekeeper', 'busy_owner', 'send_email', 'existing_crm', 'existing_receptionist',
    'ai_identity_question', 'booking_request', 'booking_provider_failure', 'wrong_number',
    'dnc', 'phone_pronunciation', 'email_pronunciation', 'time_date_pronunciation',
    'websocket_tool_degradation',
  ]);
  for (const scenario of AUDIO_SCENARIOS) {
    assert.ok(scenario.gateReference.startsWith('G'), `${scenario.id} names its gate`);
    assert.ok(scenario.checks.length > 0, `${scenario.id} has at least one check`);
    for (const check of scenario.checks) {
      assert.ok(check.description.length > 0, `${scenario.id}/${check.id} explains itself`);
    }
  }
});

test('every scenario passes in text, which is the precondition for running it in audio', async () => {
  const failures: string[] = [];
  for (const scenario of AUDIO_SCENARIOS) {
    const outcome = await runScenario({
      scenario, pack: pack(), tools: TOOLS,
      booking: scenario.id === 'booking_provider_failure' ? booking({ failBooking: true })
        : scenario.id === 'websocket_tool_degradation' ? booking({ slots: 0 })
        : booking(),
    });
    if (outcome.result !== 'PASS') {
      failures.push(`${scenario.id}: ${outcome.failedChecks.join(', ')}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('the same checks grade an audio run, and a missing mark is not a pass', async () => {
  const scenario = AUDIO_SCENARIOS.find((row) => row.id === 'hello_initial_answer')!;

  const observed = await runScenario({
    scenario, pack: pack(), tools: TOOLS, booking: booking(), medium: 'AUDIO',
    latencyMarks: { CALL_CONNECTED: 0, WELCOME_GREETING_SENT: 180, WEBSOCKET_CONNECTED: 640 },
  });
  assert.equal(observed.result, 'PASS');
  assert.equal(observed.latencyMarks['WEBSOCKET_CONNECTED'], 640);

  const unobserved = await runScenario({
    scenario, pack: pack(), tools: TOOLS, booking: booking(), medium: 'AUDIO',
    latencyMarks: { CALL_CONNECTED: 0 },
  });
  assert.equal(unobserved.result, 'INCONCLUSIVE',
    'a check that could not be observed has not been met');
  assert.match(unobserved.inconclusiveReason!, /WELCOME_GREETING_SENT/);
});

test('a scenario result stores metrics and a verdict, and has nowhere to put audio', async () => {
  const user = await makeUser('QA Reviewer', 'SALES_MANAGER');
  const scenario = AUDIO_SCENARIOS.find((row) => row.id === 'interruption_during_opener')!;
  const outcome = await runScenario({
    scenario, pack: pack(), tools: TOOLS, booking: booking(), medium: 'AUDIO',
    latencyMarks: { INTERRUPT_RECEIVED: 5200, CLAUDE_ABORTED: 5240 },
    interruptionMarks: [{ atMs: 5200, heardChars: 27, abortedMs: 40 }],
  });
  const runId = await recordScenarioRun({ outcome, actorUserId: user.userId });

  const { rows } = await query<any>(
    `select * from audio_scenario_runs where audio_scenario_run_id = $1`, [runId]);
  const row = rows[0]!;
  assert.equal(row.result, 'PASS');
  assert.equal(row.medium, 'AUDIO');
  assert.equal(row.latency_marks.CLAUDE_ABORTED, 5240);
  assert.equal(row.interruption_marks[0].abortedMs, 40);
  assert.ok(row.state_transitions.length >= 2);

  // The schema has no column that could *hold* audio or a verbatim utterance. An id
  // column named for the table is not content, so only content-bearing types count.
  const columns = await query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
      where table_name = 'audio_scenario_runs'
        and data_type in ('text', 'character varying', 'bytea', 'json', 'jsonb')`);
  const contentColumns = columns.rows.map((column) => column.column_name);
  for (const forbidden of ['recording', 'transcript', 'utterance', 'audio_url', 'media']) {
    assert.equal(contentColumns.some((name) => name.includes(forbidden)), false,
      `audio_scenario_runs has a content column named ${forbidden}, which is where policy leaks`);
  }
  // And nothing bytea at all: that is the only type raw audio would arrive as.
  const binary = await query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_name = 'audio_scenario_runs' and data_type = 'bytea'`);
  assert.equal(binary.rows[0]!.n, 0, 'no binary column, so "debug audio" has nowhere to go');
});

test('a failing scenario names the check, not the words spoken', async () => {
  const scenario = {
    ...AUDIO_SCENARIOS.find((row) => row.id === 'dnc')!,
    // A deliberately impossible check, to see what a failure records.
    checks: [{ id: 'impossible', description: 'Never true', run: () => false }],
  };
  const outcome = await runScenario({ scenario, pack: pack(), tools: TOOLS, booking: booking() });
  assert.equal(outcome.result, 'FAIL');
  assert.deepEqual(outcome.failedChecks, ['impossible']);

  const runId = await recordScenarioRun({ outcome });
  const { rows } = await query<any>(
    `select failed_checks, notes from audio_scenario_runs where audio_scenario_run_id = $1`,
    [runId]);
  assert.deepEqual(rows[0]!.failed_checks, ['impossible']);
  assert.equal(rows[0]!.notes, null, 'no transcript is stored to explain a failure');
});

test('a rerun of the same scenario updates rather than duplicating', async () => {
  const scenario = AUDIO_SCENARIOS.find((row) => row.id === 'dnc')!;
  const first = await runScenario({ scenario, pack: pack(), tools: TOOLS, booking: booking() });
  await recordScenarioRun({ outcome: first });
  await recordScenarioRun({ outcome: first });
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from audio_scenario_runs where scenario_id = 'dnc'`);
  assert.equal(rows[0]!.n, 1);
});

// --- media capture policy ------------------------------------------------------

test('with no consent evidence, nothing may be captured', async () => {
  const { rows } = await query<{ voice_call_id: string }>(
    `insert into voice_calls (direction, agent_profile_id, mode_at_start)
     values ('OUTBOUND', 'yad-sales-core-v1', 'INTERNAL_TEST') returning voice_call_id`);
  const voiceCallId = rows[0]!.voice_call_id;

  for (const mode of ['AUDIO_RECORDING', 'VERBATIM_TRANSCRIPT'] as const) {
    const decision = await mediaCaptureAllowed({ voiceCallId, mode });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /Florida default/);
  }
});

test('consent cannot be granted without naming the party and the language', async () => {
  const { rows } = await query<{ voice_call_id: string }>(
    `insert into voice_calls (direction, agent_profile_id, mode_at_start)
     values ('OUTBOUND', 'yad-sales-core-v1', 'INTERNAL_TEST') returning voice_call_id`);

  await assert.rejects(
    () => query(
      `insert into media_capture_consent
         (voice_call_id, jurisdiction, capture_modes, consent_status, policy_version)
       values ($1, 'US-FL', array['AUDIO_RECORDING'], 'GRANTED', 'v1')`,
      [rows[0]!.voice_call_id]),
    /media_consent_granted_needs_evidence/,
    'staying on the phone is not consent, and the schema will not let it become one');
});

test('consent covers only the modes it names, and a revocation ends it', async () => {
  const { rows } = await query<{ voice_call_id: string }>(
    `insert into voice_calls (direction, agent_profile_id, mode_at_start)
     values ('OUTBOUND', 'yad-sales-core-v1', 'INTERNAL_TEST') returning voice_call_id`);
  const voiceCallId = rows[0]!.voice_call_id;

  await query(
    `insert into media_capture_consent
       (voice_call_id, jurisdiction, capture_modes, consent_status,
        consenting_party_identity_or_role, consent_language_version, consent_obtained_at,
        policy_version)
     values ($1, 'US-FL', array['VERBATIM_TRANSCRIPT'], 'GRANTED',
             'the internal tester, who is us', 'internal-v1', now(), 'fl-recording-v1')`,
    [voiceCallId]);

  assert.equal((await mediaCaptureAllowed({ voiceCallId, mode: 'VERBATIM_TRANSCRIPT' })).allowed,
    true);
  const audio = await mediaCaptureAllowed({ voiceCallId, mode: 'AUDIO_RECORDING' });
  assert.equal(audio.allowed, false);
  assert.match(audio.reason, /not AUDIO_RECORDING/);

  await query(`update media_capture_consent set revoked_at = now()`);
  assert.equal((await mediaCaptureAllowed({ voiceCallId, mode: 'VERBATIM_TRANSCRIPT' })).allowed,
    false);
});
