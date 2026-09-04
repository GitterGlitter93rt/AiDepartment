import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetDatabase, makeUser } from './helpers.js';
import { setPilotSwitch } from '../src/domain/pilot.js';
import {
  allowlistInternalNumber, revokeInternalNumber, listInternalNumbers,
  openAudioPilotBatch, stopAudioPilotBatch, prepareInternalCall,
  recordInternalCallResult, reviewInternalCall, batchSummary, releaseInternalCall,
  INTERNAL_TEST_CLEARANCE,
} from '../src/voice/internalPilot.js';
import { mayPlaceCall, type DialControllerConfig } from '../src/voice/dialController.js';

/**
 * The internal audio pilot.
 * Authority: outbound-sales-brain-ai-pilot-release-gates.v1.yaml G19,
 * outbound-sales-brain-shared-twilio-number-dual-service-spec.md §6, §10.
 *
 * This harness exists to make one deliberate call to a handset we own. The tests are
 * mostly about what it refuses.
 */

const TEST_NUMBER = '+19045550199';
const CALLER_ID = '+19046829345';

after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  process.env['OUTBOUND_APPROVED_CALLER_IDS'] = CALLER_ID;
});

async function operator() {
  return makeUser('Pilot Operator', 'SALES_MANAGER');
}

async function armInternalTest(userId: string) {
  await setPilotSwitch({ field: 'outbound_mode', value: 'INTERNAL_TEST',
    actorUserId: userId, reason: 'internal audio pilot' });
  await setPilotSwitch({ field: 'outbound_dial_enabled', value: 'true',
    actorUserId: userId, reason: 'internal audio pilot' });
}

async function seedAccount(name = 'Internal Pilot Fixture Co'): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name, website: 'https://internal-fixture.example.com',
    phone: '904-555-0142', city: 'Jacksonville', state: 'FL', postalCode: '32256',
  }, { discoverySource: 'test' }));
  await query(
    `update accounts set research_fresh_until = now() + interval '7 days',
            last_researched_at = now() where account_id = $1`, [accountId]);
  return accountId;
}

async function allowlist(user: { userId: string }) {
  const result = await allowlistInternalNumber({
    phone: TEST_NUMBER, label: 'Ops test handset',
    justification: 'Michael\'s own mobile, used for the first audio check.',
    actorUserId: user.userId,
  });
  assert.equal(result.ok, true, result.message);
  return result.internalTestNumberId!;
}

// --- the allowlist ------------------------------------------------------------

test('a prospect number cannot enter the allowlist', async () => {
  const user = await operator();
  await seedAccount('Northgate Air');

  const result = await allowlistInternalNumber({
    phone: '904-555-0142', label: 'oops', actorUserId: user.userId,
    justification: 'Trying to add a number that is actually a prospect.',
  });
  assert.equal(result.ok, false);
  assert.match(result.message!, /belongs to Northgate Air/,
    'this is the mechanism behind "no prospect can be dialled"');

  const listed = await listInternalNumbers();
  assert.equal(listed.length, 0);
});

test('an allowlist entry has to say whose handset it is', async () => {
  const user = await operator();
  const result = await allowlistInternalNumber({
    phone: TEST_NUMBER, label: 'test', justification: 'test', actorUserId: user.userId });
  assert.equal(result.ok, false);
  assert.match(result.message!, /whose handset/);
});

test('an allowlisted number is auditable and revocable', async () => {
  const user = await operator();
  const id = await allowlist(user);

  const listed = await listInternalNumbers();
  assert.equal(listed[0]!.label, 'Ops test handset');
  assert.equal(listed[0]!.added_by_name, 'Pilot Operator');
  assert.match(listed[0]!.justification, /own mobile/);

  const audit = await query(
    `select action, reason from audit_log where action = 'internal_pilot.allowlist_number'`);
  assert.equal(audit.rows.length, 1);

  const revoked = await revokeInternalNumber({
    internalTestNumberId: id, actorUserId: user.userId, reason: 'handset returned' });
  assert.equal(revoked.ok, true);
  const after = await listInternalNumbers();
  assert.ok(after[0]!.revoked_at);
});

// --- the batch ------------------------------------------------------------------

test('a batch is small, purposeful, and its ceiling holds', async () => {
  const user = await operator();
  const id = await allowlist(user);

  assert.equal((await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 50, purpose: 'first audio check on our own handset',
    actorUserId: user.userId })).ok, false, 'fifty calls is not an internal test');

  assert.equal((await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 2, purpose: 'short', actorUserId: user.userId })).ok,
    false, 'a batch has to say what it is for');

  const opened = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 2,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });
  assert.equal(opened.ok, true);

  const summary = await batchSummary(opened.batchId!);
  assert.equal(summary.max_calls, 2);
  assert.equal(summary.calls_started, 0, 'opening a batch dials nothing');
  assert.equal(summary.state, 'OPEN');
});

test('a revoked number cannot be used for a new batch', async () => {
  const user = await operator();
  const id = await allowlist(user);
  await revokeInternalNumber({
    internalTestNumberId: id, actorUserId: user.userId, reason: 'handset returned' });

  const result = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 1,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });
  assert.equal(result.ok, false);
  assert.match(result.message!, /revoked/);
});

// --- clearance ---------------------------------------------------------------------

test('nothing is cleared unless the mode is INTERNAL_TEST specifically', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 1,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  // CONTROLLED_PILOT is a production mode, and an internal test must not ride on it.
  await setPilotSwitch({ field: 'outbound_mode', value: 'CONTROLLED_PILOT',
    actorUserId: user.userId, reason: 'test' });
  await setPilotSwitch({ field: 'outbound_dial_enabled', value: 'true',
    actorUserId: user.userId, reason: 'test' });

  const clearance = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(clearance.cleared, false);
  assert.ok(clearance.refusals.includes('MODE_NOT_INTERNAL_TEST'));
});

test('a cleared call carries a precomputed opener and nothing is dialled', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 2,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  const clearance = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });

  assert.equal(clearance.cleared, true, clearance.detail.join(' '));
  assert.equal(clearance.clearance, INTERNAL_TEST_CLEARANCE);
  assert.equal(clearance.callPlan!.toNumber, TEST_NUMBER, 'only the allowlisted handset');
  assert.equal(clearance.callPlan!.fromNumber, CALLER_ID);
  assert.equal(clearance.callPlan!.modeAtStart, 'INTERNAL_TEST');
  assert.equal(clearance.callPlan!.agentProfileId, 'yad-sales-core-v1');
  assert.match(clearance.callPlan!.precomputedOpener, /Your AI Department/);
  assert.match(clearance.callPlan!.precomputedOpener, /cold call/);

  // Preparing is not calling.
  const calls = await query(`select count(*)::int as n from voice_calls`);
  assert.equal(calls.rows[0]!.n, 0);
  const audit = await query(
    `select detail from audit_log where action = 'internal_pilot.prepare_call'`);
  assert.equal(audit.rows[0]!.detail.dialled, false);
});

test('the pilot runs one call at a time', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 3,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  const first = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(first.cleared, true);

  const second = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(second.cleared, false);
  assert.ok(second.refusals.includes('CALL_ALREADY_ACTIVE'));

  // Closing the first frees the slot.
  await recordInternalCallResult({ attemptId: first.attemptId!, outcome: 'CONNECTED' });
  const third = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(third.cleared, true);
});

test('the batch ceiling stops the next call', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 1,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  const first = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  await recordInternalCallResult({ attemptId: first.attemptId!, outcome: 'CONNECTED' });

  const second = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(second.cleared, false);
  assert.ok(second.refusals.includes('BATCH_CEILING_REACHED'));
});

test('stopping the batch refuses every further call', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 5,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  const stopped = await stopAudioPilotBatch({
    batchId: batch.batchId!, actorUserId: user.userId, reason: 'that is enough for today' });
  assert.equal(stopped.ok, true);

  const attempt = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(attempt.cleared, false);
  assert.ok(attempt.refusals.includes('BATCH_NOT_OPEN'));
});

test('a number revoked after the batch opened is refused at dial time', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 2,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  await revokeInternalNumber({
    internalTestNumberId: id, actorUserId: user.userId, reason: 'handset returned' });

  const attempt = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(attempt.cleared, false);
  assert.ok(attempt.refusals.includes('ALLOWLIST_ENTRY_REVOKED'));
});

test('a refused attempt is recorded, so a call that did not happen is auditable', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 1,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  // Mode is OFF: the default.
  const attempt = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(attempt.cleared, false);

  const { rows } = await query<any>(
    `select clearance, refusal_reasons from audio_pilot_attempts
      where audio_pilot_attempt_id = $1`, [attempt.attemptId]);
  assert.equal(rows[0]!.clearance, 'REFUSED');
  assert.ok(rows[0]!.refusal_reasons.includes('MODE_NOT_INTERNAL_TEST'));

  const summary = await batchSummary(batch.batchId!);
  assert.equal(summary.refused, 1);
  assert.equal(summary.calls_started, 0, 'a refusal does not consume the ceiling');
});

// --- the separation that matters -------------------------------------------------

test('an internal test clearance is never production prospect eligibility', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 1,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  const cleared = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(cleared.clearance, 'INTERNAL_TEST_ALLOW');

  // The clearance is not one of the production decisions, and no endpoint was cleared.
  const decisions = await query(
    `select count(*)::int as n from channel_eligibility_decisions where decision = 'ALLOW'`);
  assert.equal(decisions.rows[0]!.n, 0);

  const endpoints = await query(
    `select count(*)::int as n from contact_endpoints where autonomous_ai_voice = 'ALLOW'`);
  assert.equal(endpoints.rows[0]!.n, 0,
    'an internal test must not clear a single prospect endpoint');

  // And the production dial controller still refuses the prospect's own number.
  const { rows } = await query<{ endpoint_id: string }>(
    `select endpoint_id from contact_endpoints where account_id = $1 limit 1`, [accountId]);
  const config: DialControllerConfig = {
    approvedCallerIds: [CALLER_ID], internalTestDestinations: [], agentProfileId: 'yad-sales-core-v1',
  };
  const production = await mayPlaceCall({
    endpointId: rows[0]!.endpoint_id, fromNumber: CALLER_ID, config });
  assert.equal(production.allowed, false);
  assert.ok(production.refusals.includes('DESTINATION_NOT_ELIGIBLE'),
    'the prospect is still not callable, whatever the internal pilot cleared');
});

test('the internal pilot has no queue and selects no prospect', async () => {
  const user = await operator();
  const id = await allowlist(user);
  await seedAccount('Some Prospect');
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 1,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  // The Account is a parameter the operator passes; nothing here picks one, and the
  // destination is the allowlisted handset regardless of which Account is used for
  // the Call Pack.
  const accountId = (await query<{ account_id: string }>(
    `select account_id from accounts limit 1`)).rows[0]!.account_id;
  const clearance = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(clearance.callPlan!.toNumber, TEST_NUMBER,
    'the call goes to our handset, never to the Account whose Call Pack is used');
});

test('no DNC provider is needed for a handset we own', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 1,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  const screened = await query(`select count(*)::int as n from registry_screen_results`);
  assert.equal(screened.rows[0]!.n, 0, 'nothing has been screened');

  const clearance = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(clearance.cleared, true,
    'screening our own handset would tell us nothing; that is why the clearance has '
    + 'its own name');
});

// --- results and review -----------------------------------------------------------

test('latency and barge-in are recorded from the transport, and QA by a person', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 1,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });
  const clearance = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });

  await recordInternalCallResult({
    attemptId: clearance.attemptId!, outcome: 'CONNECTED',
    latencyMarks: { RELAY_SETUP_RECEIVED: 410, FIRST_TEXT_SENT_TO_CONVERSATION_RELAY: 780 },
    bargeInEvents: [{ atMs: 5200, heardChars: 27, abortedMs: 40 }],
  });

  const before = await query<any>(
    `select qa_result from audio_pilot_attempts where audio_pilot_attempt_id = $1`,
    [clearance.attemptId]);
  assert.equal(before.rows[0]!.qa_result, null, 'a call does not score itself');

  await reviewInternalCall({
    attemptId: clearance.attemptId!, qaResult: 'PASS',
    notes: 'Greeting was prompt; barge-in cut cleanly.', actorUserId: user.userId });

  const { rows } = await query<any>(
    `select latency_marks, barge_in_events, outcome, qa_result, reviewed_by
       from audio_pilot_attempts where audio_pilot_attempt_id = $1`, [clearance.attemptId]);
  assert.equal(rows[0]!.latency_marks.RELAY_SETUP_RECEIVED, 410);
  assert.equal(rows[0]!.barge_in_events[0].abortedMs, 40);
  assert.equal(rows[0]!.qa_result, 'PASS');
  assert.ok(rows[0]!.reviewed_by, 'the reviewer is named');
});

test('reviewing a plan without placing it costs neither the slot nor the batch', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 1,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  const planned = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(planned.cleared, true);
  assert.equal((await batchSummary(batch.batchId!)).calls_started, 1,
    'the slot is reserved while the plan is live, so two operators cannot race into it');

  const released = await releaseInternalCall({
    attemptId: planned.attemptId!, reason: 'Plan reviewed; not placed.' });
  assert.equal(released.ok, true);
  assert.equal((await batchSummary(batch.batchId!)).calls_started, 0,
    'looking at a plan must not cost you the call');

  // And the next plan is cleared again.
  const again = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  assert.equal(again.cleared, true, again.detail.join(' '));
});

test('a release only ever applies to a clearance that was never used', async () => {
  const user = await operator();
  const id = await allowlist(user);
  const accountId = await seedAccount();
  await armInternalTest(user.userId);
  const batch = await openAudioPilotBatch({
    internalTestNumberId: id, maxCalls: 2,
    purpose: 'first audio check on our own handset', actorUserId: user.userId });

  const placed = await prepareInternalCall({
    batchId: batch.batchId!, accountId, actorUserId: user.userId });
  await recordInternalCallResult({ attemptId: placed.attemptId!, outcome: 'CONNECTED' });

  const released = await releaseInternalCall({
    attemptId: placed.attemptId!, reason: 'trying to undo a real call' });
  assert.equal(released.ok, false, 'a call that happened cannot be released');
  assert.equal((await batchSummary(batch.batchId!)).calls_started, 1);
});
