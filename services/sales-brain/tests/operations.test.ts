import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { resetDatabase } from './helpers.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { operationalSnapshot } from '../src/api/operations.js';

/**
 * The questions an operator has on a Monday morning.
 * Authority: outbound-sales-brain-edge-xpert-sales-portal-deployment-spec.md SS11-SS13.
 *
 * Not a second monitoring product: one panel over the tables the product already
 * keeps. What matters is that each answer is a count of rows that exist, that a
 * question we cannot answer says UNKNOWN rather than zero, and that the one line
 * about outbound AI cannot read OK while a real call has been placed.
 */

let app: FastifyInstance;
const PASSWORD = 'operations-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

let sequence = 0;
async function makeAccount(name: string): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name, website: `https://${name.toLowerCase().replace(/\W+/g, '')}.invalid`,
      phone: `904-555-${String(7000 + sequence).slice(-4)}`,
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'ops-test' }));
  return accountId;
}

function check(snapshot: Awaited<ReturnType<typeof operationalSnapshot>>, id: string) {
  const found = snapshot.checks.find((row) => row.id === id);
  assert.ok(found, `no check with id ${id}`);
  return found!;
}

test('every question an operator has is answered', async () => {
  const snapshot = await operationalSnapshot();
  const questions = snapshot.checks.map((row) => row.id);
  for (const required of [
    'database', 'worker', 'queue', 'inventory_freshness', 'unclaimed', 'providers',
    'spend', 'imports', 'replies', 'followups', 'bookings', 'outbound_ai', 'reps',
    'duplicates',
  ]) {
    assert.ok(questions.includes(required), `nothing answers "${required}"`);
  }
  for (const row of snapshot.checks) {
    assert.ok(row.question.endsWith('?'), `${row.id} is not phrased as a question`);
    assert.ok(row.value.length > 0, `${row.id} has no answer`);
  }
});

test('an empty database says unknown, not healthy', async () => {
  const snapshot = await operationalSnapshot();
  assert.equal(check(snapshot, 'inventory_freshness').state, 'UNKNOWN',
    'no inventory reported as fresh inventory');
  assert.equal(check(snapshot, 'unclaimed').state, 'UNKNOWN');
  assert.equal(check(snapshot, 'reps').state, 'UNKNOWN');
  // The database answering is knowable, and is OK.
  assert.equal(check(snapshot, 'database').state, 'OK');
});

test('a stranded job shows as a stranded job', async () => {
  const accountId = await makeAccount('Stranded Job Co');
  await query(
    `insert into jobs (job_type, payload, account_id, status, leased_by, leased_until,
                       attempts)
     values ('account_research', '{}'::jsonb, $1, 'RUNNING', 'dead-worker',
             now() - interval '10 minutes', 1)`, [accountId]);

  const snapshot = await operationalSnapshot();
  const worker = check(snapshot, 'worker');
  assert.equal(worker.state, 'ATTENTION');
  assert.match(worker.value, /1 stranded/);
});

test('a queue that is backing up says how far behind it is', async () => {
  const accountId = await makeAccount('Backed Up Co');
  await query(
    `insert into jobs (job_type, payload, account_id, status, run_after)
     values ('account_research', '{}'::jsonb, $1, 'QUEUED', now() - interval '2 hours')`,
    [accountId]);

  const snapshot = await operationalSnapshot();
  const queue = check(snapshot, 'queue');
  assert.notEqual(queue.state, 'OK', 'a two-hour-old queued job reads as healthy');
  assert.match(queue.value, /1 queued/);
  assert.match(queue.value, /1[0-9]{2} min|12[0-9] min/);
});

test('a prospect waiting a day for an answer is the loudest thing on the page',
  async () => {
    const accountId = await makeAccount('Waiting Reply Co');
    const { rows: campaign } = await query<{ email_campaign_id: string }>(
      `insert into email_campaigns (name, provider, status) values ('ops', 'smartlead', 'ACTIVE')
       returning email_campaign_id`);
    const { rows: enrollment } = await query<{ enrollment_id: string }>(
      `insert into email_enrollments (email_campaign_id, account_id, normalized_email, status)
       values ($1, $2, 'someone@waitingreply.invalid', 'REPLIED') returning enrollment_id`,
      [campaign[0]!.email_campaign_id, accountId]);
    await query(
      `insert into email_events (enrollment_id, account_id, provider, provider_event_id,
                                 event_type, reply_class, occurred_at)
       values ($1, $2, 'smartlead', 'ops-1', 'REPLIED', 'QUESTION', now() - interval '3 days')`,
      [enrollment[0]!.enrollment_id, accountId]);

    const snapshot = await operationalSnapshot();
    const replies = check(snapshot, 'replies');
    assert.equal(replies.state, 'ATTENTION');
    assert.match(replies.value, /1 unanswered/);
    assert.match(replies.detail ?? '', /most expensive/i);
  });

test('a reply that was answered is not still waiting', async () => {
  const accountId = await makeAccount('Answered Reply Co');
  const { rows: campaign } = await query<{ email_campaign_id: string }>(
    `insert into email_campaigns (name, provider, status) values ('ops2', 'smartlead', 'ACTIVE')
     returning email_campaign_id`);
  const { rows: enrollment } = await query<{ enrollment_id: string }>(
    `insert into email_enrollments (email_campaign_id, account_id, normalized_email, status)
     values ($1, $2, 'someone@answeredreply.invalid', 'REPLIED') returning enrollment_id`,
    [campaign[0]!.email_campaign_id, accountId]);
  await query(
    `insert into email_events (enrollment_id, account_id, provider, provider_event_id,
                               event_type, reply_class, occurred_at)
     values ($1, $2, 'smartlead', 'ops-2', 'REPLIED', 'QUESTION', now() - interval '3 days')`,
    [enrollment[0]!.enrollment_id, accountId]);
  const rep = await createUser({
    email: 'ops.rep@test.local', displayName: 'Ops Rep', role: 'SALES_REP', password: PASSWORD });
  await query(
    `insert into activities (account_id, activity_type, channel, actor_user_id, notes,
                             occurred_at)
     values ($1, 'EMAIL_SENT', 'email', $2, 'Answered them.', now() - interval '1 day')`,
    [accountId, rep]);

  const snapshot = await operationalSnapshot();
  assert.equal(check(snapshot, 'replies').state, 'OK',
    'a reply that was answered is still counted as waiting');
});

test('a booking stuck pending is visible before anyone asks', async () => {
  const accountId = await makeAccount('Stuck Booking Co');
  const rep = await createUser({
    email: 'ops.booking@test.local', displayName: 'Booking Rep', role: 'SALES_REP',
    password: PASSWORD });
  await query(
    `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, meeting_type,
                                   idempotency_key, requested_start, requested_end, status,
                                   provider, created_by, created_at)
     values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'ops-stuck',
             now() + interval '1 day', now() + interval '1 day' + interval '15 minutes',
             'PENDING', 'calcom', $2, now() - interval '2 hours')`, [accountId, rep]);

  const snapshot = await operationalSnapshot();
  const bookings = check(snapshot, 'bookings');
  assert.equal(bookings.state, 'ATTENTION');
  assert.match(bookings.detail ?? '', /may believe/i);
});

test('the outbound AI line cannot read OK while a live call exists', async () => {
  const clean = await operationalSnapshot();
  assert.equal(check(clean, 'outbound_ai').state, 'OK');
  assert.match(check(clean, 'outbound_ai').value, /mode OFF/);

  const accountId = await makeAccount('Live Call Co');
  await query(
    `insert into voice_calls (direction, agent_profile_id, mode_at_start, account_id,
                              from_number, to_number, started_at, outcome)
     values ('OUTBOUND', 'yad-sales-core-v1', 'CONTROLLED_PILOT', $1, '+19045550100',
             '+19045550101', now(), 'CONNECTED')`, [accountId]);

  const after = await operationalSnapshot();
  const outbound = check(after, 'outbound_ai');
  assert.equal(outbound.state, 'BLOCKED',
    'a live call was placed and the operations panel still says outbound AI is off');
  assert.match(outbound.detail ?? '', /not dry runs/);
});

test('the outbound AI line reads the switches, not a hope', async () => {
  await query(`update voice_pilot_state set outbound_mode = 'INTERNAL_TEST'`);
  const snapshot = await operationalSnapshot();
  const outbound = check(snapshot, 'outbound_ai');
  assert.equal(outbound.state, 'BLOCKED');
  assert.match(outbound.value, /INTERNAL_TEST/);
});

test('duplicates are reported as a number to watch, not as a fault', async () => {
  // Two companies can share a name legitimately.
  await makeAccount('Summit Roofing');
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Summit Roofing', website: 'https://summitroofing2.invalid',
    phone: '904-555-7999', city: 'Orange Park', state: 'FL', postalCode: '32073',
  }, { discoverySource: 'ops-test' }));

  const snapshot = await operationalSnapshot();
  const duplicates = check(snapshot, 'duplicates');
  assert.match(duplicates.value, /1 name/);
  assert.match(duplicates.detail ?? '', /legitimately/i);
});

test('the panel is on the page an operator opens', async () => {
  await createUser({
    email: 'ops.manager@test.local', displayName: 'Ops Manager', role: 'SALES_MANAGER',
    password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'ops.manager@test.local', password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session');
  const page = await app.inject({
    method: 'GET', url: '/research-health', headers: { cookie: `yad_sales_session=${cookie!.value}` } });

  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Operations/);
  assert.match(page.body, /Are outbound AI calls off\?/);
  assert.match(page.body, /Is anyone waiting on a reply\?/);
  assert.match(page.body, /Are jobs backing up\?/);
  // And the table scrolls on a phone like every other table.
  assert.match(page.body, /class="table-wrap"/);
});

test('a rep cannot read the operations panel', async () => {
  await createUser({
    email: 'ops.plainrep@test.local', displayName: 'Plain Rep', role: 'SALES_REP',
    password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'ops.plainrep@test.local', password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session');
  const page = await app.inject({
    method: 'GET', url: '/research-health',
    headers: { cookie: `yad_sales_session=${cookie!.value}` } });
  assert.equal(page.statusCode, 403);
});

test('the snapshot is one round trip, whatever the scale', async () => {
  for (let i = 0; i < 40; i += 1) await makeAccount(`Round Trip ${i}`);
  const started = Date.now();
  const snapshot = await operationalSnapshot();
  const elapsed = Date.now() - started;
  assert.ok(snapshot.checks.length >= 14);
  assert.ok(elapsed < 2_000, `the operations snapshot took ${elapsed} ms`);
});
