import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { recordMeetingOutcome } from '../src/booking/service.js';
import { analyticsFunnel } from '../src/api/waveDQueries.js';
import { listMeetings } from '../src/api/readModels.js';
import { resetDatabase } from './helpers.js';

/**
 * What happened at the meeting, said by a person.
 * Authority: Issue #2 section G ("no-show not inferred just because time passed")
 * and section J (every KPI must have a source).
 *
 * `attended_state` existed and nothing wrote it, so the Completed tab was permanently
 * empty and the funnel's attended stage was permanently zero -- a number that could
 * only ever be zero, printed beside numbers that could not.
 *
 * The rule the fix keeps: the clock never decides. A meeting whose time has passed
 * has not been attended; it has only passed.
 */

let app: FastifyInstance;
const PASSWORD = 'meeting-outcome-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

interface Fixture {
  repCookie: string; otherCookie: string;
  repUserId: string; otherUserId: string;
  accountId: string;
}

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  assert.ok(cookie, `sign-in for ${email}`);
  return `yad_sales_session=${cookie!.value}`;
}

async function fixture(): Promise<Fixture> {
  const repUserId = await createUser({
    email: 'host@test.local', displayName: 'Host', role: 'SALES_REP', password: PASSWORD });
  const otherUserId = await createUser({
    email: 'bystander@test.local', displayName: 'Bystander', role: 'SALES_REP', password: PASSWORD });
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Meeting Outcome Co',
      website: 'https://meetingoutcome.example.com',
      phone: '904-555-0207', city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' }));
  return {
    repCookie: await signIn('host@test.local'),
    otherCookie: await signIn('bystander@test.local'),
    repUserId, otherUserId, accountId,
  };
}

let sequence = 0;

async function booking(input: {
  accountId: string; ownerUserId: string; startsInMinutes: number;
}): Promise<string> {
  sequence += 1;
  const { rows } = await query<{ booking_id: string }>(
    `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, requested_start,
                                   requested_end, status, meeting_type, source_channel,
                                   idempotency_key, provider_event_id, confirmed_at)
     values ($1, $2, 'mike@yad.test',
             now() + ($3 || ' minutes')::interval,
             now() + (($3::int + 30) || ' minutes')::interval,
             'CONFIRMED', 'strategy_call', 'portal', $4, 'provider-' || $4, now())
     returning booking_id`,
    [input.accountId, input.ownerUserId, String(input.startsInMinutes),
     `meeting-outcome-${sequence}`],
  );
  return rows[0]!.booking_id;
}

test('a meeting whose time has passed is not attended until somebody says so', async () => {
  const f = await fixture();
  const bookingId = await booking({
    accountId: f.accountId, ownerUserId: f.repUserId, startsInMinutes: -120 });

  const { rows } = await query<{ attended_state: string }>(
    'select attended_state from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(rows[0]!.attended_state, 'UNKNOWN', 'the clock decided nothing');

  const funnel = await analyticsFunnel({
    fromDate: null, toDate: null, ownerUserId: null, verticalProfileId: null,
    marketId: null, channel: null, hook: null, outcome: null } as never);
  assert.equal(Number(funnel.booked), 1);
  assert.equal(Number(funnel.attended), 0);
});

test('the meeting page asks for the outcome once the meeting has passed', async () => {
  const f = await fixture();
  const past = await booking({
    accountId: f.accountId, ownerUserId: f.repUserId, startsInMinutes: -120 });
  const future = await booking({
    accountId: f.accountId, ownerUserId: f.repUserId, startsInMinutes: 120 });

  const asked = await app.inject({
    method: 'GET', url: `/meetings/${past}`, headers: { cookie: f.repCookie } });
  assert.equal(asked.statusCode, 200);
  assert.match(asked.body, /Did this meeting happen\?/);

  const notAsked = await app.inject({
    method: 'GET', url: `/meetings/${future}`, headers: { cookie: f.repCookie } });
  assert.equal(notAsked.statusCode, 200);
  assert.ok(!notAsked.body.includes('Did this meeting happen?'),
    'a meeting that has not happened yet has no outcome to record');
});

test('recording attendance moves the meeting onto the completed tab and into the funnel', async () => {
  const f = await fixture();
  const bookingId = await booking({
    accountId: f.accountId, ownerUserId: f.repUserId, startsInMinutes: -120 });

  const response = await app.inject({
    method: 'POST', url: `/meetings/${bookingId}/outcome`, headers: { cookie: f.repCookie },
    payload: { outcome: 'ATTENDED', notes: 'Good call, sending a proposal' } });
  assert.equal(response.statusCode, 302);

  const completed = await listMeetings(
    { userId: f.repUserId, role: 'SALES_REP' }, 'completed');
  assert.equal(completed.length, 1);

  const funnel = await analyticsFunnel({
    fromDate: null, toDate: null, ownerUserId: null, verticalProfileId: null,
    marketId: null, channel: null, hook: null, outcome: null } as never);
  assert.equal(Number(funnel.attended), 1);

  const activities = await query<{ activity_type: string; notes: string | null }>(
    `select activity_type, notes from activities where account_id = $1
       and activity_type = 'MEETING_OUTCOME'`, [f.accountId]);
  assert.equal(activities.rows.length, 1);
  assert.equal(activities.rows[0]!.notes, 'Good call, sending a proposal');

  const audit = await query(
    `select action from audit_log where action = 'meeting.outcome'`);
  assert.equal(audit.rows.length, 1);
});

test('a no-show puts the meeting in front of a human rather than hiding it', async () => {
  const f = await fixture();
  const bookingId = await booking({
    accountId: f.accountId, ownerUserId: f.repUserId, startsInMinutes: -120 });

  await app.inject({
    method: 'POST', url: `/meetings/${bookingId}/outcome`, headers: { cookie: f.repCookie },
    payload: { outcome: 'NO_SHOW' } });

  const attention = await listMeetings(
    { userId: f.repUserId, role: 'SALES_REP' }, 'needs_attention');
  assert.equal(attention.length, 1);

  const funnel = await analyticsFunnel({
    fromDate: null, toDate: null, ownerUserId: null, verticalProfileId: null,
    marketId: null, channel: null, hook: null, outcome: null } as never);
  assert.equal(Number(funnel.attended), 0, 'a no-show is not an attendance');
});

test('a meeting that has not started yet has no outcome', async () => {
  const f = await fixture();
  const bookingId = await booking({
    accountId: f.accountId, ownerUserId: f.repUserId, startsInMinutes: 120 });

  const result = await recordMeetingOutcome({
    bookingId, outcome: 'ATTENDED',
    actor: { userId: f.repUserId, role: 'SALES_REP' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_YET');

  const { rows } = await query<{ attended_state: string }>(
    'select attended_state from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(rows[0]!.attended_state, 'UNKNOWN');
});

test('another rep cannot record an outcome for a meeting they cannot see', async () => {
  const f = await fixture();
  const bookingId = await booking({
    accountId: f.accountId, ownerUserId: f.repUserId, startsInMinutes: -120 });

  const response = await app.inject({
    method: 'POST', url: `/meetings/${bookingId}/outcome`, headers: { cookie: f.otherCookie },
    payload: { outcome: 'NO_SHOW' } });
  assert.equal(response.statusCode, 404);

  const { rows } = await query<{ attended_state: string }>(
    'select attended_state from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(rows[0]!.attended_state, 'UNKNOWN');
});

test('an outcome that is not one of the two is refused', async () => {
  const f = await fixture();
  const bookingId = await booking({
    accountId: f.accountId, ownerUserId: f.repUserId, startsInMinutes: -120 });

  for (const outcome of ['MAYBE', 'ATTENDED_PROBABLY', '', 'CANCELLED']) {
    const response = await app.inject({
      method: 'POST', url: `/meetings/${bookingId}/outcome`, headers: { cookie: f.repCookie },
      payload: { outcome } });
    assert.equal(response.statusCode, 302, outcome);
  }

  const { rows } = await query<{ attended_state: string }>(
    'select attended_state from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(rows[0]!.attended_state, 'UNKNOWN');
});

test('recording an outcome does not count as contacting the prospect again', async () => {
  const f = await fixture();
  const bookingId = await booking({
    accountId: f.accountId, ownerUserId: f.repUserId, startsInMinutes: -120 });

  const before = await query<{ activity_count: string }>(
    'select activity_count from prospect_inventory where account_id = $1', [f.accountId]);

  await app.inject({
    method: 'POST', url: `/meetings/${bookingId}/outcome`, headers: { cookie: f.repCookie },
    payload: { outcome: 'ATTENDED' } });

  const after = await query<{ activity_count: string }>(
    'select activity_count from prospect_inventory where account_id = $1', [f.accountId]);
  assert.equal(Number(after.rows[0]!.activity_count), Number(before.rows[0]!.activity_count),
    'saying what happened at a meeting is not another attempt to reach them');
});
