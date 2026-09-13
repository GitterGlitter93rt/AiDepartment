import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { evaluateReleaseGates } from '../src/release/gates.js';
import { runDryRun } from '../src/release/dryRun.js';

/**
 * Release readiness.
 * Authority: outbound-sales-brain-ai-pilot-release-gates.v1.yaml.
 *
 * The gate evaluation exists so a release state cannot be declared from confidence,
 * and the dry run exists so the whole path can be exercised without a credential and
 * without a real prospect.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

test('every gate reports a status from the approved vocabulary', async () => {
  const report = await evaluateReleaseGates({ evaluator: 'test' });
  const allowed = new Set(['PASS', 'FAIL', 'BLOCKED_EXTERNAL', 'NOT_TESTED', 'NOT_APPLICABLE']);
  for (const gate of report.gates) {
    assert.ok(allowed.has(gate.status), `${gate.gateId} reported ${gate.status}`);
    assert.ok(gate.notes.length > 0, `${gate.gateId} has no evidence note`);
    assert.ok(gate.evaluatedAt && gate.versionOrCommit,
      `${gate.gateId} is missing its evidence record fields`);
  }
  assert.ok(report.gates.length >= 20, 'every gate in the matrix is evaluated');
});

test('an external blocker is never counted as a pass', async () => {
  const report = await evaluateReleaseGates({ evaluator: 'test' });
  const blocked = report.gates.filter((gate) => gate.status === 'BLOCKED_EXTERNAL');
  assert.ok(blocked.length > 0, 'this machine has no provider credentials');
  for (const gate of blocked) {
    assert.notEqual(gate.status as string, 'PASS');
    assert.ok(gate.blockerId, `${gate.gateId} is blocked with no blocker id to chase`);
  }
});

test('a real pilot cannot be declared eligible on this machine', async () => {
  const report = await evaluateReleaseGates({ evaluator: 'test' });
  assert.notEqual(report.classification, 'REAL_AI_PILOT_ELIGIBLE',
    'no screening provider, no caller ID and no approval — eligibility would be a lie');
  assert.ok(report.classificationReasons.length > 0, 'and it says why');
});

test('the report names the blockers, each once', async () => {
  const report = await evaluateReleaseGates({ evaluator: 'test' });
  const ids = report.blockers.map((blocker) => blocker.blockerId);
  assert.deepEqual(ids, [...new Set(ids)], 'a blocker is listed once, not per gate');
  assert.ok(ids.includes('B-DNC-PROVIDER'));
  assert.ok(ids.includes('B-CALCOM-CREDENTIAL'));
  for (const blocker of report.blockers) {
    assert.ok(blocker.needed.length > 0, `${blocker.blockerId} does not say what is needed`);
    assert.ok(blocker.gateIds.length > 0, 'and which gates it holds up');
  }
  const dnc = report.blockers.find((blocker) => blocker.blockerId === 'B-DNC-PROVIDER')!;
  assert.ok(dnc.gateIds.length >= 2,
    'one missing provider holds up more than one gate, and the report says so');
});

test('the gate evaluation carries no credential into the report', async () => {
  process.env['CALCOM_API_KEY'] = 'sk-live-should-never-be-in-a-report';
  try {
    const report = await evaluateReleaseGates({ evaluator: 'test' });
    assert.equal(JSON.stringify(report).includes('sk-live-should-never-be-in-a-report'), false);
  } finally {
    delete process.env['CALCOM_API_KEY'];
  }
});

// --- the dry run --------------------------------------------------------------

test('the whole path runs end to end without a credential or a real prospect', async () => {
  const report = await runDryRun();

  assert.equal(report.offline, true);
  assert.equal(report.status, 'PASS', JSON.stringify(report.stages, null, 2));

  const stages = report.stages.map((stage) => stage.stage);
  assert.deepEqual(stages, [
    'researched_account', 'call_pack', 'line_type_screening', 'channel_eligibility',
    'sales_ai_conversation', 'provider_tools', 'crm_outcome', 'meeting_or_followup',
  ], 'every stage of the path is exercised, in order');
});

test('the dry run does not manufacture AI-voice clearance', async () => {
  const report = await runDryRun();
  const eligibility = report.stages.find((stage) => stage.stage === 'channel_eligibility')!;
  assert.equal(eligibility.evidence!['aiVoice'] === 'ALLOW', false,
    'a dry run that clears a number for AI voice with no screening provider is worthless');
  assert.equal(eligibility.status, 'PASS',
    'and refusing to clear it is the correct outcome, not a failure');

  const lineType = report.stages.find((stage) => stage.stage === 'line_type_screening')!;
  assert.equal(lineType.evidence!['lineType'], 'UNKNOWN');
});

test('the dry run speaks no time the mock calendar did not return', async () => {
  const report = await runDryRun();
  const tools = report.stages.find((stage) => stage.stage === 'provider_tools')!;
  assert.deepEqual(tools.evidence!['inventedTime'], []);
  assert.ok((tools.evidence!['offered'] as string[]).length > 0);
});

test('the dry run leaves a reviewable call behind', async () => {
  const report = await runDryRun();
  assert.ok(report.voiceCallId);

  const { rows } = await query<any>(
    `select c.outcome, c.ended_at, c.agent_profile_id, c.mode_at_start,
            (select count(*)::int from voice_call_turns t
              where t.voice_call_id = c.voice_call_id) as turns
       from voice_calls c where c.voice_call_id = $1`, [report.voiceCallId]);
  assert.ok(rows[0]!.outcome, 'the call has an outcome');
  assert.ok(rows[0]!.ended_at, 'and it is closed');
  assert.equal(rows[0]!.agent_profile_id, 'yad-sales-core-v1');
  assert.equal(rows[0]!.mode_at_start, 'DRY_RUN', 'the run is labelled as a dry run');
  assert.ok(rows[0]!.turns >= 2);
});

test('the dry run contacts nobody real', async () => {
  const report = await runDryRun();
  const { rows } = await query<any>(
    `select count(*)::int as n from contact_attempts`);
  assert.equal(rows[0]!.n, 0, 'no contact attempt was logged against any real prospect');

  const account = await query<any>(
    `select canonical_name from accounts where account_id = $1`, [report.accountId]);
  assert.match(account.rows[0]!.canonical_name, /Dry Run/,
    'the only Account it touched is the one it created');
});
