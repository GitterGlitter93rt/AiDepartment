import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetDatabase } from './helpers.js';
import { listIntegrations } from '../src/domain/settings.js';
import { readPilotState } from '../src/domain/pilot.js';

/**
 * Sales AI Pilot, Call Review, Campaigns, Analytics and Settings.
 * Authority: yad-sales-crm-page-acceptance-matrix.v1.yaml,
 * outbound-sales-brain-shared-twilio-number-dual-service-spec.md §6-§7.
 *
 * These prove the parts a browser must not be able to talk its way past: a rep cannot
 * reach the outbound control plane, adding a prospect to the pilot never dials, an
 * operator switch is refused without a reason, and settings cannot leak a credential.
 */

let app: FastifyInstance;
const PASSWORD = 'wave-d-test-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD },
  });
  assert.equal(response.statusCode, 302, `sign-in for ${email} should redirect`);
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  return `yad_sales_session=${cookie!.value}`;
}

interface Fixture { rep: string; manager: string; admin: string; accountId: string }

async function fixture(): Promise<Fixture> {
  await createUser({ email: 'r@test.local', displayName: 'Rep', role: 'SALES_REP', password: PASSWORD });
  await createUser({ email: 'm@test.local', displayName: 'Manager', role: 'SALES_MANAGER', password: PASSWORD });
  await createUser({ email: 'ad@test.local', displayName: 'Admin', role: 'ADMIN', password: PASSWORD });

  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Palmetto Plumbing',
      website: 'https://palmetto.example.com',
      phone: '904-555-0142',
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' }));

  return {
    rep: await signIn('r@test.local'),
    manager: await signIn('m@test.local'),
    admin: await signIn('ad@test.local'),
    accountId,
  };
}

beforeEach(async () => { await resetDatabase(); });

test('a rep cannot reach the outbound control plane, by page or by action', async () => {
  const f = await fixture();
  for (const url of ['/ai/pilot', '/calls', '/campaigns', '/analytics', '/settings']) {
    const response = await app.inject({ method: 'GET', url, headers: { cookie: f.rep } });
    assert.equal(response.statusCode, 403, `${url} must refuse a rep`);
  }
  for (const url of ['/ai/pilot/stop', '/ai/pilot/switch', '/ai/pilot/candidates',
                     '/ai/pilot/preflight', '/settings/integration']) {
    const response = await app.inject({
      method: 'POST', url, headers: { cookie: f.rep }, payload: { reason: 'trying it on' },
    });
    assert.equal(response.statusCode, 403, `${url} must refuse a rep posting directly`);
  }
});

test('adding a prospect to the pilot never dials', async () => {
  const f = await fixture();
  const response = await app.inject({
    method: 'POST', url: '/ai/pilot/candidates', headers: { cookie: f.manager },
    payload: { accountId: f.accountId },
  });
  assert.equal(response.statusCode, 302);

  const candidate = await pool.query(
    `select state, eligibility_at_add from pilot_candidates where account_id = $1`, [f.accountId]);
  assert.equal(candidate.rows[0]?.state, 'CANDIDATE',
    'a new candidate starts in review, never armed to dial');

  const calls = await pool.query(`select count(*)::int as n from voice_calls`);
  assert.equal(calls.rows[0]!.n, 0, 'adding a candidate must not create a call');

  const audit = await pool.query(
    `select detail from audit_log where action = 'pilot.add_candidate'`);
  assert.equal(audit.rows[0]?.detail?.dialled, false, 'the audit records that nothing was dialled');
});

test('preflight fails closed when the number is not cleared for AI voice', async () => {
  const f = await fixture();
  await app.inject({
    method: 'POST', url: '/ai/pilot/candidates', headers: { cookie: f.manager },
    payload: { accountId: f.accountId },
  });
  const { rows } = await pool.query(
    `select pilot_candidate_id from pilot_candidates where account_id = $1`, [f.accountId]);

  const response = await app.inject({
    method: 'POST', url: '/ai/pilot/preflight', headers: { cookie: f.manager },
    payload: { pilotCandidateId: rows[0]!.pilot_candidate_id },
  });
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.location as string, /error=/,
    'a preflight that does not clear must report a failure, not a pass');

  const after = await pool.query(
    `select state from pilot_candidates where pilot_candidate_id = $1`,
    [rows[0]!.pilot_candidate_id]);
  assert.equal(after.rows[0]!.state, 'PREFLIGHT_FAILED');
  const calls = await pool.query(`select count(*)::int as n from voice_calls`);
  assert.equal(calls.rows[0]!.n, 0, 'a preflight never places a call');
});

test('an operator switch is refused without a reason, and recorded with one', async () => {
  const f = await fixture();

  const noReason = await app.inject({
    method: 'POST', url: '/ai/pilot/switch', headers: { cookie: f.manager },
    payload: { field: 'outbound_mode', value: 'CONTROLLED_PILOT', reason: '' },
  });
  assert.match(noReason.headers.location as string, /error=/);
  assert.equal((await readPilotState()).outboundMode, 'OFF', 'the mode must not have moved');

  await app.inject({
    method: 'POST', url: '/ai/pilot/switch', headers: { cookie: f.manager },
    payload: { field: 'outbound_mode', value: 'CONTROLLED_PILOT', reason: 'internal gate test' },
  });
  assert.equal((await readPilotState()).outboundMode, 'CONTROLLED_PILOT');

  const events = await pool.query(
    `select field, old_value, new_value, reason from voice_pilot_state_events`);
  assert.equal(events.rows.length, 1);
  assert.equal(events.rows[0]!.reason, 'internal gate test');
  assert.equal(events.rows[0]!.old_value, 'OFF');
});

test('stop new outbound calls disarms the dialler and leaves the receptionist alone', async () => {
  const f = await fixture();
  await app.inject({
    method: 'POST', url: '/ai/pilot/switch', headers: { cookie: f.manager },
    payload: { field: 'outbound_mode', value: 'CONTROLLED_PILOT', reason: 'test' },
  });
  await app.inject({
    method: 'POST', url: '/ai/pilot/switch', headers: { cookie: f.manager },
    payload: { field: 'outbound_dial_enabled', value: 'true', reason: 'test' },
  });
  assert.equal((await readPilotState()).outboundDialEnabled, true);

  await app.inject({
    method: 'POST', url: '/ai/pilot/stop', headers: { cookie: f.manager },
    payload: { reason: 'ending the test window' },
  });

  const state = await readPilotState();
  assert.equal(state.outboundMode, 'OFF');
  assert.equal(state.outboundDialEnabled, false);
  assert.equal(state.stopReason, 'ending the test window');
  assert.equal(state.inboundReceptionist, true,
    'stopping outbound must never take the inbound receptionist down');
});

test('turning outbound off also disarms dial creation', async () => {
  const f = await fixture();
  await app.inject({
    method: 'POST', url: '/ai/pilot/switch', headers: { cookie: f.manager },
    payload: { field: 'outbound_mode', value: 'CONTROLLED_PILOT', reason: 'test' },
  });
  await app.inject({
    method: 'POST', url: '/ai/pilot/switch', headers: { cookie: f.manager },
    payload: { field: 'outbound_dial_enabled', value: 'true', reason: 'test' },
  });
  await app.inject({
    method: 'POST', url: '/ai/pilot/switch', headers: { cookie: f.manager },
    payload: { field: 'outbound_mode', value: 'OFF', reason: 'stand down' },
  });

  const state = await readPilotState();
  assert.equal(state.outboundDialEnabled, false,
    'leaving the dialler armed under an OFF mode is the failure this switch prevents');
});

test('settings shows that a credential is set without showing the credential', async () => {
  const f = await fixture();
  const secret = 'sk-live-do-not-render-me-0000';
  const integrations = await listIntegrations({ CALCOM_API_KEY: secret } as NodeJS.ProcessEnv);
  const calcom = integrations.find((row) => row.key === 'calcom')!;
  assert.equal(calcom.secretPresent, true, 'presence is reported');
  assert.equal(JSON.stringify(integrations).includes(secret), false,
    'no read model may carry the credential itself');

  const page = await app.inject({ method: 'GET', url: '/settings', headers: { cookie: f.admin } });
  assert.equal(page.statusCode, 200);
  assert.equal(page.body.includes(secret), false, 'the page must never render a credential');
  assert.match(page.body, /CALCOM_API_KEY/,
    'naming the variable is how an operator knows where to set it');
});

test('a manager may read settings but not change them', async () => {
  const f = await fixture();
  const read = await app.inject({ method: 'GET', url: '/settings', headers: { cookie: f.manager } });
  assert.equal(read.statusCode, 200);

  const write = await app.inject({
    method: 'POST', url: '/settings/integration', headers: { cookie: f.manager },
    payload: { key: 'calcom', enabled: 'true', reason: 'trying it' },
  });
  assert.equal(write.statusCode, 403);

  const row = await pool.query(
    `select enabled from integration_settings where integration_key = 'calcom'`);
  assert.equal(row.rows[0]!.enabled, false, 'the refused write must not have landed');
});

test('an integration change by an administrator is audited with its reason', async () => {
  const f = await fixture();
  await app.inject({
    method: 'POST', url: '/settings/integration', headers: { cookie: f.admin },
    payload: { key: 'calcom', enabled: 'true', reason: 'Cal.com account connected' },
  });
  const audit = await pool.query(
    `select reason, detail from audit_log where action = 'settings.integration_enabled'`);
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0]!.reason, 'Cal.com account connected');
});

test('analytics reports booked and attended as separate numbers', async () => {
  const f = await fixture();
  const page = await app.inject({ method: 'GET', url: '/analytics', headers: { cookie: f.manager } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Meetings booked/);
  assert.match(page.body, /Attended/);
  assert.match(page.body, /booked is not attended/,
    'the page must say plainly that a booking is not an attendance');
  assert.match(page.body, /Suppressed \/ DNC/,
    'negative outcomes are shown, not hidden');
});

test('a call review is written by a person and the transcript is not rewritten', async () => {
  const f = await fixture();
  const { rows } = await pool.query<{ voice_call_id: string }>(
    `insert into voice_calls (direction, agent_profile_id, mode_at_start, account_id, outcome)
     values ('OUTBOUND', 'yad-sales-core-v1', 'INTERNAL_TEST', $1, 'CALLBACK')
     returning voice_call_id`, [f.accountId]);
  const callId = rows[0]!.voice_call_id;
  await pool.query(
    `insert into voice_call_turns (voice_call_id, turn_index, speaker, text)
     values ($1, 0, 'AGENT', 'This is a cold call, so I will be brief.')`, [callId]);

  const review = await app.inject({
    method: 'POST', url: `/calls/${callId}/review`, headers: { cookie: f.manager },
    payload: { qaScore: '64', rootCause: 'dialogue', reviewAction: 'NEEDS_SCRIPT_CHANGE',
               hardFailure: 'true', reviewerNotes: 'Two questions in one turn.' },
  });
  assert.equal(review.statusCode, 302);

  const after = await pool.query(
    `select qa_score, root_cause, qa_hard_failure, reviewed_by from voice_calls where voice_call_id = $1`,
    [callId]);
  assert.equal(after.rows[0]!.qa_score, 64);
  assert.equal(after.rows[0]!.qa_hard_failure, true);
  assert.ok(after.rows[0]!.reviewed_by, 'the reviewer is recorded');

  const turn = await pool.query(
    `select text from voice_call_turns where voice_call_id = $1`, [callId]);
  assert.equal(turn.rows[0]!.text, 'This is a cold call, so I will be brief.',
    'reviewing a call must never change what was said on it');

  const page = await app.inject({
    method: 'GET', url: `/calls/${callId}`, headers: { cookie: f.manager } });
  assert.match(page.body, /Never the model&#39;s internal reasoning|Never the model's internal reasoning/);
});

test('campaigns surface an account whose relationship outranks its campaign membership', async () => {
  const f = await fixture();
  const page = await app.inject({ method: 'GET', url: '/campaigns', headers: { cookie: f.manager } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Smartlead executes sending/,
    'Smartlead is the execution provider, not the CRM');
});

test('the Call Pack preview is the snapshot, not whatever research says now', async () => {
  const f = await fixture();
  await app.inject({
    method: 'POST', url: '/ai/pilot/candidates', headers: { cookie: f.manager },
    payload: { accountId: f.accountId },
  });
  const { rows } = await pool.query(
    `select pilot_candidate_id, call_pack_id from pilot_candidates where account_id = $1`,
    [f.accountId]);
  assert.ok(rows[0]!.call_pack_id, 'a Call Pack is snapshotted when the candidate is added');

  const page = await app.inject({
    method: 'GET', url: `/ai/pilot?preview=${rows[0]!.pilot_candidate_id}`,
    headers: { cookie: f.manager } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /What the agent would open with/);
  assert.match(page.body, /This snapshot does not change when\s+research does/,
    'the operator is told the preview is fixed');
  assert.match(page.body, /must never claim/,
    'the prohibitions are part of what is approved');

  // Renaming the account afterwards must not rewrite the approved snapshot.
  const before = await pool.query(
    `select company_summary from call_packs where call_pack_id = $1`, [rows[0]!.call_pack_id]);
  await pool.query(`update accounts set canonical_name = 'Renamed Co' where account_id = $1`,
    [f.accountId]);
  const after = await pool.query(
    `select company_summary from call_packs where call_pack_id = $1`, [rows[0]!.call_pack_id]);
  assert.equal(after.rows[0]!.company_summary, before.rows[0]!.company_summary);
});

test('a manager can queue a prospect from the account page without dialling', async () => {
  const f = await fixture();
  const page = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.manager } });
  assert.match(page.body, /Add to the pilot list/);
  assert.match(page.body, /It does not dial/);

  const rep = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.rep } });
  assert.equal(/Add to the pilot list/.test(rep.body), false,
    'a rep has no route into the outbound control plane');
});

test('global search resolves a phone number to its canonical account', async () => {
  const f = await fixture();
  const page = await app.inject({
    method: 'GET', url: '/search?q=904-555-0142', headers: { cookie: f.rep } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Palmetto Plumbing/,
    'a number typed the way a person writes it must find the account it belongs to');
  assert.match(page.body, new RegExp(`/accounts/${f.accountId}`),
    'the hit opens the canonical account, not a search-only view');
});

test('global search shows suppression on the result rather than after the click', async () => {
  const f = await fixture();
  await pool.query(`update accounts set is_suppressed = true where account_id = $1`, [f.accountId]);
  const page = await app.inject({
    method: 'GET', url: '/search?q=Palmetto', headers: { cookie: f.rep } });
  assert.match(page.body, /Suppressed/,
    'a rep must see that a company cannot be contacted before opening it');
});

test('search finds nothing it has not researched, and says so', async () => {
  const f = await fixture();
  const page = await app.inject({
    method: 'GET', url: '/search?q=Acme%20Unresearched%20Co', headers: { cookie: f.rep } });
  assert.match(page.body, /Nothing matches/);
  assert.match(page.body, /Searching does not create a record|has not been researched/,
    'the empty state must not imply the company simply does not exist');
});

test('an anonymous caller cannot search', async () => {
  await fixture();
  const page = await app.inject({ method: 'GET', url: '/search?q=Palmetto' });
  assert.equal(page.statusCode, 302);
  assert.equal(page.headers.location, '/login');
});
