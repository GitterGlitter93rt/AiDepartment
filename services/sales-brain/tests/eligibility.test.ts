import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount, upsertEndpoint } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import {
  evaluateAndStore, preflightCall, explain, POLICY_VERSION,
} from '../src/compliance/eligibility.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Phone channel eligibility.
 * Authority: outbound-sales-brain-global-phone-channel-eligibility-dnc-spec.md,
 * §19 hard fails and §20 acceptance examples.
 */

/** Tuesday 2026-09-08, 10:00 America/New_York — comfortably inside the calling window. */
const DURING_HOURS = new Date('2026-09-08T14:00:00Z');

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function seedEndpoint(options: {
  role?: string; quality?: string; lineType?: string; timezone?: string;
} = {}): Promise<{ accountId: string; endpointId: string }> {
  return withTransaction(async (client) => {
    const { accountId } = await upsertAccount(client, {
      canonicalName: 'Northgate Air', website: 'https://northgate.example.com',
      city: 'Jacksonville', state: 'FL', timezone: options.timezone ?? 'America/New_York',
    }, { discoverySource: 'test' });
    const endpointId = await upsertEndpoint(client, {
      accountId, contactId: null, locationId: null, type: 'PHONE',
      rawValue: '904-555-0100',
      endpointRole: options.role ?? 'MAIN_BUSINESS_LINE',
      relationshipToPerson: 'COMPANY_ROUTE',
      qualityState: options.quality ?? 'CURRENT_BUSINESS_CONFIRMED',
      source: 'COMPANY_WEBSITE', sourceReference: null,
    });
    if (options.lineType) {
      await client.query('update contact_endpoints set line_type = $2 where endpoint_id = $1',
        [endpointId, options.lineType]);
    }
    return { accountId, endpointId: endpointId! };
  });
}

async function screen(endpointId: string, result: string, registry = 'us_national_dnc'): Promise<void> {
  const { rows } = await query<{ normalized_value: string }>(
    'select normalized_value from contact_endpoints where endpoint_id = $1', [endpointId]);
  await query(
    `insert into registry_screen_results (endpoint_id, normalized_value, registry, provider,
                                          result, expires_at)
     values ($1,$2,$3,'test-provider',$4, now() + interval '30 days')`,
    [endpointId, rows[0]!.normalized_value, registry, result],
  );
}

// --- §19 the headline hard fail ----------------------------------------------

test('human and AI eligibility are separate decisions, never one CALL_READY flag', async () => {
  const { endpointId } = await seedEndpoint({ lineType: 'landline' });
  await screen(endpointId, 'NO_MATCH');
  const result = await evaluateAndStore(endpointId, DURING_HOURS);

  assert.equal(result!.humanManualCall, 'ALLOW');
  // AI voice stays blocked because the pilot gate has not been reached, even though
  // the endpoint is otherwise perfectly clean.
  assert.equal(result!.autonomousAiVoice, 'BLOCK');
  assert.ok(result!.reasonCodes.includes('AI_VOICE_PILOT_DISABLED'));

  const stored = await query<{ human_manual_call: string; autonomous_ai_voice: string }>(
    'select human_manual_call, autonomous_ai_voice from contact_endpoints where endpoint_id = $1',
    [endpointId]);
  assert.notEqual(stored.rows[0]!.human_manual_call, stored.rows[0]!.autonomous_ai_voice,
    'the two decisions genuinely differ and are stored separately');
});

test('§20 Example A — business line, human allowed, AI not approved', async () => {
  const { endpointId } = await seedEndpoint({ role: 'MAIN_BUSINESS_LINE', lineType: 'landline' });
  await screen(endpointId, 'NO_MATCH');
  const human = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL', DURING_HOURS);
  const ai = await preflightCall(endpointId, 'AUTONOMOUS_AI_VOICE', DURING_HOURS);

  assert.equal(human.allowed, true);
  assert.equal(ai.allowed, false);
  assert.ok(human.decisionId, 'the authorizing decision is recorded');
});

test('§20 Example B — a YAD DNC blocks every phone channel', async () => {
  const rep = await makeUser('Rep A');
  const { accountId, endpointId } = await seedEndpoint({ lineType: 'landline' });
  await screen(endpointId, 'NO_MATCH');
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', endpointId, notes: 'remove us' }, rep);

  const human = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL');
  const ai = await preflightCall(endpointId, 'AUTONOMOUS_AI_VOICE');
  assert.equal(human.allowed, false);
  assert.equal(ai.allowed, false);
  assert.match(human.message, /asked not to be contacted|suppressed/i);
});

test('a YAD DNC applies to a rep cell call, not only to Twilio', async () => {
  // The hard fail this guards: "Twilio-only DNC list while rep cell calls ignore
  // the same YAD suppression."
  const rep = await makeUser('Rep A');
  const { accountId, endpointId } = await seedEndpoint({ lineType: 'landline' });
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', endpointId }, rep);

  const manual = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL');
  assert.equal(manual.allowed, false, 'the same suppression governs the human channel');
});

test('a screening failure never becomes a clean result', async () => {
  const { endpointId } = await seedEndpoint({ lineType: 'landline' });
  await screen(endpointId, 'SCREEN_FAILED');
  const result = await evaluateAndStore(endpointId);

  assert.notEqual(result!.humanManualCall, 'ALLOW', 'a failed screen is not an allow');
  assert.equal(result!.humanManualCall, 'REVIEW_REQUIRED');
  assert.equal(result!.autonomousAiVoice, 'BLOCK');
  assert.ok(result!.reasonCodes.includes('REGISTRY_SCREEN_FAILED'));
});

test('an unscreened personal mobile is not callable by anyone yet', async () => {
  const { endpointId } = await seedEndpoint({
    role: 'MOBILE_UNKNOWN_USE', quality: 'PUBLIC_OBSERVED_UNVERIFIED', lineType: 'mobile',
  });
  const result = await evaluateAndStore(endpointId);
  assert.equal(result!.humanManualCall, 'REVIEW_REQUIRED');
  assert.equal(result!.autonomousAiVoice, 'BLOCK');
});

test('a registry match on a non-business number blocks both channels', async () => {
  const { endpointId } = await seedEndpoint({
    role: 'MOBILE_UNKNOWN_USE', lineType: 'mobile',
  });
  await screen(endpointId, 'MATCH');
  const result = await evaluateAndStore(endpointId);
  assert.equal(result!.humanManualCall, 'BLOCK');
  assert.equal(result!.autonomousAiVoice, 'BLOCK');
});

test('registry membership never leaks into rep-facing text', () => {
  // Purpose limitation (§6): a registry result may gate a call and nothing else.
  const message = explain('BLOCK', ['REGISTRY_RESTRICTED'], null);
  assert.doesNotMatch(message, /registry|do not call list|dnc list|national/i);
  assert.match(message, /restrictions apply/i);
});

test('outside the local calling window is a timing block with a reopen time', async () => {
  const { endpointId } = await seedEndpoint({ lineType: 'landline', timezone: 'America/New_York' });
  await screen(endpointId, 'NO_MATCH');

  // 03:00 America/New_York on the same Tuesday. Nothing about the machine's own
  // clock affects this.
  const middleOfTheNight = new Date('2026-09-08T07:00:00Z');
  const result = await evaluateAndStore(endpointId, middleOfTheNight);

  assert.ok(result!.reasonCodes.includes('OUTSIDE_CALLING_WINDOW'));
  assert.equal(result!.humanManualCall, 'REVIEW_REQUIRED');
  assert.equal(result!.autonomousAiVoice, 'BLOCK');
  assert.ok(result!.nextHumanEligibleAt, 'a reopen time is supplied rather than a bare block');
  assert.ok(result!.nextHumanEligibleAt! > middleOfTheNight);

  // And the same endpoint is callable during business hours.
  const daytime = await evaluateAndStore(endpointId, DURING_HOURS);
  assert.equal(daytime!.humanManualCall, 'ALLOW');
});

test('a recent attempt enforces a cooldown', async () => {
  const rep = await makeUser('Rep A');
  const { accountId, endpointId } = await seedEndpoint({ lineType: 'landline' });
  await screen(endpointId, 'NO_MATCH');
  const first = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL', DURING_HOURS);
  assert.equal(first.allowed, true);

  await query(
    `insert into contact_attempts (account_id, endpoint_id, actor_user_id, channel,
                                   eligibility_decision_id)
     values ($1,$2,$3,'HUMAN_MANUAL_CALL',$4)`,
    [accountId, endpointId, rep.userId, first.decisionId],
  );
  // The attempt must be recent relative to the fixed clock these tests use.
  await query('update contact_attempts set started_at = $1', [DURING_HOURS]);

  const second = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL', DURING_HOURS);
  assert.equal(second.allowed, false);
  assert.ok(second.reasonCodes.includes('ATTEMPT_COOLDOWN'));
  assert.ok(second.nextEligibleAt);
});

test('a phone attempt cannot be recorded without an authorizing decision', async () => {
  const { accountId, endpointId } = await seedEndpoint({ lineType: 'landline' });
  await assert.rejects(
    () => query(
      `insert into contact_attempts (account_id, endpoint_id, channel)
       values ($1,$2,'HUMAN_MANUAL_CALL')`,
      [accountId, endpointId],
    ),
    /contact_attempts_phone_requires_decision/,
    'the schema refuses an unauthorized call record',
  );
});

test('every decision records the policy version that produced it', async () => {
  const { endpointId } = await seedEndpoint({ lineType: 'landline' });
  await evaluateAndStore(endpointId);
  const { rows } = await query<{ policy_version: string; channel: string }>(
    'select policy_version, channel from channel_eligibility_decisions where endpoint_id = $1',
    [endpointId]);
  assert.equal(rows.length, 2, 'one decision per channel');
  for (const row of rows) assert.equal(row.policy_version, POLICY_VERSION);
});

test('decision history is append-only', async () => {
  const { endpointId } = await seedEndpoint({ lineType: 'landline' });
  await evaluateAndStore(endpointId);
  await assert.rejects(
    () => query(`update channel_eligibility_decisions set decision = 'ALLOW' where endpoint_id = $1`,
      [endpointId]),
    /append-only/,
  );
});

test('the preflight recomputes rather than trusting a stored decision', async () => {
  const rep = await makeUser('Rep A');
  const { accountId, endpointId } = await seedEndpoint({ lineType: 'landline' });
  await screen(endpointId, 'NO_MATCH');

  const before = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL', DURING_HOURS);
  assert.equal(before.allowed, true);

  // Suppression arrives after the stored decision was written.
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', endpointId }, rep);

  const after = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL', DURING_HOURS);
  assert.equal(after.allowed, false, 'the stale ALLOW is not reused');
});

test('a blocked account keeps its identity so rediscovery cannot resurrect it', async () => {
  // §4: do not throw prospects away.
  const rep = await makeUser('Rep A');
  const { accountId, endpointId } = await seedEndpoint({ lineType: 'landline' });
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', endpointId }, rep);

  const account = await query<{ canonical_name: string; canonical_domain: string }>(
    'select canonical_name, canonical_domain from accounts where account_id = $1', [accountId]);
  assert.equal(account.rows[0]!.canonical_name, 'Northgate Air', 'identity is preserved');
  assert.ok(account.rows[0]!.canonical_domain, 'the website is preserved');

  const rediscovered = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Northgate Air', website: 'https://northgate.example.com', phone: '904-555-0100',
    }, { discoverySource: 'market_miner' }));
  assert.equal(rediscovered.accountId, accountId);

  const preflight = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL');
  assert.equal(preflight.allowed, false, 'rediscovery does not make it callable again');
});

// --- the portal cannot be used to bypass the gate ----------------------------

test('the API refuses to start a call on a blocked endpoint', async () => {
  const { buildServer } = await import('../src/api/server.js');
  const { createUser } = await import('../src/domain/auth.js');
  const app = await buildServer();
  try {
    await createUser({
      email: 'rep@test.local', displayName: 'Rep', role: 'SALES_REP', password: 'preflight-test-pw',
    });
    const login = await app.inject({
      method: 'POST', url: '/login', payload: { email: 'rep@test.local', password: 'preflight-test-pw' },
    });
    const cookie = `yad_sales_session=${login.cookies.find((c) => c.name === 'yad_sales_session')!.value}`;

    const { accountId, endpointId } = await seedEndpoint({ lineType: 'landline' });
    const rep = { userId: (await query<{ user_id: string }>(
      `select user_id from users where email_normalized = 'rep@test.local'`)).rows[0]!.user_id,
      role: 'SALES_REP' as const, activeClaimTarget: null };
    await claimAccount(accountId, rep);
    await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', endpointId }, rep);

    const response = await app.inject({
      method: 'POST', url: `/api/accounts/${accountId}/start-call`,
      headers: { cookie }, payload: { endpointId },
    });
    assert.equal(response.statusCode, 403, 'a rep cannot self-override a block');
    assert.match(response.json().message, /not to be contacted|suppressed/i);

    const attempts = await query<{ n: number }>('select count(*)::int as n from contact_attempts');
    assert.equal(attempts.rows[0]!.n, 0, 'no attempt was recorded');
  } finally {
    await app.close();
  }
});
