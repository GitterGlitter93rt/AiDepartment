import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { resetDatabase } from './helpers.js';
import { seedPilotDemo, DEMO_MARKER } from '../src/synthetic/demoFixture.js';

/**
 * The flow a human rep actually walks, end to end, through the real HTTP surface.
 * Authority: CLAUDE-CRM-UI-LATEST-ADDENDUM.md SS8 (hero proof).
 *
 *   login -> Find Prospects -> HVAC + 32256 + advertisers first + Tier B+ + unclaimed
 *   -> inspect -> claim -> My Prospects -> Account -> why reach out -> who to ask for
 *   -> what to say first -> what channel is allowed -> log an outcome -> follow-up
 *   -> positive reply -> opportunity -> meeting
 *
 * Human reps can be useful long before an AI places a call, so this is the flow that
 * has to work first. Every assertion is about what a rep can understand from the
 * page, not only about what the database holds.
 */

let app: FastifyInstance;
const PASSWORD = 'pilot-flow-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  assert.equal(response.statusCode, 302, `sign-in for ${email}`);
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  assert.ok(cookie, 'no session cookie');
  return `yad_sales_session=${cookie!.value}`;
}

async function pilotFixture() {
  const repId = await createUser({
    email: 'brent@demo.invalid', displayName: 'Demo Rep', role: 'SALES_REP', password: PASSWORD });
  const managerId = await createUser({
    email: 'manager@demo.invalid', displayName: 'Demo Manager', role: 'SALES_MANAGER',
    password: PASSWORD });
  const seeded = await seedPilotDemo({ ownerUserId: null, managerUserId: managerId });
  return { repId, managerId, rep: await signIn('brent@demo.invalid'), ...seeded };
}

test('the demo fixture is unmistakably synthetic', async () => {
  const fixture = await pilotFixture();
  assert.ok(fixture.accountIds.length >= 8);

  const { rows } = await query<{ canonical_name: string; canonical_domain: string | null }>(
    'select canonical_name, canonical_domain from accounts');
  for (const row of rows) {
    assert.match(row.canonical_domain ?? '.invalid', /\.invalid$/,
      `${row.canonical_name} has a domain that could resolve`);
  }
  const phones = await query<{ normalized_value: string }>(
    `select normalized_value from contact_endpoints where endpoint_type = 'PHONE'`);
  for (const row of phones.rows) {
    assert.match(row.normalized_value, /^\+1\d{3}555\d{4}$/,
      `${row.normalized_value} is not a 555 number`);
  }
  const provenance = await query<{ n: number }>(
    `select count(*)::int as n from source_identities where provider <> $1`, [DEMO_MARKER]);
  assert.equal(provenance.rows[0]!.n, 0, 'a demo Account is not marked as demo data');
});

test('the hero flow: find, inspect, claim, work, follow up', async () => {
  const f = await pilotFixture();

  // --- Find Prospects, with the filters a rep actually sets --------------------
  const find = await app.inject({
    method: 'GET',
    url: '/find?vertical=hvac&where=32256&ownership=UNCLAIMED&tier=B&ad=google_paid',
    headers: { cookie: f.rep },
  });
  assert.equal(find.statusCode, 200);
  assert.match(find.body, /Coastal Air/, 'the target company is not in the filtered results');
  // The filters did something: a C-tier non-advertiser is excluded.
  assert.equal(/Budget Handyman/.test(find.body), false,
    'a C-tier non-advertiser survived a Tier B+ advertisers-first filter');

  // A rep can tell why each row is here before opening anything.
  assert.match(find.body, /Google|LSA|advertis/i, 'the advertising evidence is not visible');
  assert.match(find.body, /Tier|A ·|B ·/, 'the fit tier is not visible');

  // --- Inspect the drawer -------------------------------------------------------
  const drawer = await app.inject({
    method: 'GET', url: `/accounts/${f.targetAccountId}/panel`, headers: { cookie: f.rep } });
  assert.equal(drawer.statusCode, 200);
  assert.match(drawer.body, /Coastal Air/);
  assert.match(drawer.body, /Ray Alvarez/, 'the drawer does not say who to ask for');

  // --- Claim -------------------------------------------------------------------
  const claim = await app.inject({
    method: 'POST', url: `/api/accounts/${f.targetAccountId}/claim`,
    headers: { cookie: f.rep, 'content-type': 'application/json' },
    payload: {},
  });
  assert.equal(claim.statusCode, 200, `claim failed: ${claim.body}`);
  const claimResult = claim.json() as { ok: boolean; ownerUserId: string };
  assert.equal(claimResult.ok, true, `claim refused: ${claim.body}`);
  assert.equal(claimResult.ownerUserId, f.repId);

  // --- My Prospects -------------------------------------------------------------
  const mine = await app.inject({
    method: 'GET', url: '/prospects', headers: { cookie: f.rep } });
  assert.equal(mine.statusCode, 200);
  assert.match(mine.body, /Coastal Air/, 'the claimed Account is not on My Prospects');

  // --- The Account page: can a rep understand this company? ---------------------
  const account = await app.inject({
    method: 'GET', url: `/accounts/${f.targetAccountId}`, headers: { cookie: f.rep } });
  assert.equal(account.statusCode, 200);
  const page = account.body;

  // Why this company.
  assert.match(page, /Why reach out/i, 'the page does not say why this company');
  assert.match(page, /losing after-hours calls|after five/i,
    'the hypothesis is not on the page');
  assert.match(page, /hypothesis to test on the call, not a fact/i,
    'the hypothesis is not marked as a hypothesis');

  // What evidence we have, and what we may not claim.
  assert.match(page, /Signals/i, 'the evidence is not shown');
  assert.match(page, /Active Google Search Ad/i, 'the advertising evidence is not shown');
  assert.match(page, /Do not claim/i, 'the page does not say what must not be claimed');

  // Who to ask for.
  assert.match(page, /Ray Alvarez/);
  assert.match(page, /Main line — ask for Ray Alvarez/,
    'the page does not tell the rep who to ask for on a company route');

  // What to say first.
  assert.match(page, /Suggested first question/i, 'there is no first question');
  assert.match(page, /Who picks up after five/i);

  // What channel is allowed, and why not.
  assert.match(page, /Human call allowed|Review required|Do not call/,
    'the page does not say whether the number may be called');
  assert.match(page, /AI voice off/, 'the page does not say AI voice is off');

  // --- Log an outcome -----------------------------------------------------------
  const disposition = await app.inject({
    method: 'POST', url: `/accounts/${f.targetAccountId}/disposition`,
    headers: { cookie: f.rep },
    payload: {
      disposition: 'DECISION_MAKER_REACHED',
      notes: 'Ray said two techs spend the morning calling people back off the voicemail.',
      statementCategory: 'workflow',
      statementText: 'Two of my guys spend every morning calling people back.',
    },
  });
  assert.ok(disposition.statusCode === 302 || disposition.statusCode === 200,
    `logging an outcome answered ${disposition.statusCode}`);

  const afterCall = await query<{ relationship_state: string; activities: number }>(
    `select a.relationship_state,
            (select count(*)::int from activities t where t.account_id = a.account_id
              and t.activity_type = 'CALL_ATTEMPT') as activities
       from accounts a where a.account_id = $1`, [f.targetAccountId]);
  assert.equal(afterCall.rows[0]!.relationship_state, 'ENGAGED',
    'reaching the decision maker did not move the relationship');
  assert.equal(afterCall.rows[0]!.activities, 1);

  // --- Create a follow-up --------------------------------------------------------
  const followUp = await app.inject({
    method: 'POST', url: `/accounts/${f.targetAccountId}/disposition`,
    headers: { cookie: f.rep },
    payload: {
      disposition: 'CALLBACK_REQUESTED',
      callbackDueAt: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16),
      notes: 'He asked me to call back Thursday after three.',
    },
  });
  assert.ok(followUp.statusCode === 302 || followUp.statusCode === 200);

  const followUps = await app.inject({
    method: 'GET', url: '/follow-ups', headers: { cookie: f.rep } });
  assert.match(followUps.body, /Coastal Air/, 'the callback is not on Follow-Ups');
  assert.match(followUps.body, /Thursday after three|call back/i,
    'the follow-up does not carry what the prospect said');

  // One clear next action, not five contradictory ones.
  const openWork = await query<{ n: number }>(
    `select count(*)::int as n from follow_ups
      where account_id = $1 and status = 'OPEN'`, [f.targetAccountId]);
  assert.equal(openWork.rows[0]!.n, 1,
    `the rep has ${openWork.rows[0]!.n} open tasks on one Account`);
});

test('the relationship proof: reply, opportunity, meeting', async () => {
  const f = await pilotFixture();
  await app.inject({
    method: 'POST', url: `/api/accounts/${f.targetAccountId}/claim`,
    headers: { cookie: f.rep, 'content-type': 'application/json' }, payload: {} });

  // A positive reply arrives from the email sequence.
  await query(
    `insert into email_events (enrollment_id, account_id, provider, provider_event_id,
                               event_type, reply_class, reply_excerpt, occurred_at)
     values ($1, $2, 'smartlead', 'demo-reply-1', 'REPLIED', 'POSITIVE_INTEREST',
             'What would this cost for a company our size?', now())`,
    [f.enrollmentId, f.targetAccountId]);
  await query(
    `update email_enrollments set status = 'REPLIED' where enrollment_id = $1`,
    [f.enrollmentId]);
  await query(
    `update accounts set relationship_state = 'POSITIVE_REPLY' where account_id = $1`,
    [f.targetAccountId]);

  const replies = await app.inject({
    method: 'GET', url: '/replies', headers: { cookie: f.rep } });
  assert.equal(replies.statusCode, 200);
  assert.match(replies.body, /Coastal Air/, 'the positive reply is not in the inbox');
  assert.match(replies.body, /cost for a company our size/,
    'the reply does not show what they actually wrote');

  // The rep records what was said, then opens an opportunity.
  await query(
    `insert into prospect_statements (account_id, category, statement_text, source_class,
                                      confidence, captured_by)
     values ($1, 'workflow', 'Two of my guys spend every morning calling people back.',
             'prospect_verified', 'confirmed', $2)`, [f.targetAccountId, f.repId]);

  const opportunity = await app.inject({
    method: 'POST', url: `/accounts/${f.targetAccountId}/opportunity`,
    headers: { cookie: f.rep },
    payload: {
      problemSummary: 'Two techs spend every morning returning calls that came in overnight.',
      desiredOutcome: 'Someone answers after hours so the calls stop piling up.',
    },
  });
  assert.ok(opportunity.statusCode === 302 || opportunity.statusCode === 200,
    `opening an opportunity answered ${opportunity.statusCode}`);

  const opportunities = await app.inject({
    method: 'GET', url: '/opportunities', headers: { cookie: f.rep } });
  assert.match(opportunities.body, /Coastal Air/, 'the opportunity is not on the list');

  // A meeting is booked. It is only confirmed when the provider confirms.
  const { rows: opp } = await query<{ opportunity_id: string }>(
    'select opportunity_id from opportunities where account_id = $1', [f.targetAccountId]);
  assert.equal(opp.length, 1);

  await query(
    `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, meeting_type,
                                   idempotency_key, requested_start, requested_end,
                                   prospect_timezone, status, provider, created_by)
     values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'demo-booking-1',
             now() + interval '2 days', now() + interval '2 days' + interval '15 minutes',
             'America/New_York', 'PENDING', 'calcom', $2)`,
    [f.targetAccountId, f.repId]);

  const pending = await app.inject({
    method: 'GET', url: '/meetings', headers: { cookie: f.rep } });
  assert.equal(/Coastal Air/.test(pending.body), false,
    'a booking the provider has not confirmed is listed as upcoming');

  await query(
    `update meeting_bookings set status = 'CONFIRMED', provider_event_id = 'evt-demo-1',
            confirmed_at = now() where account_id = $1`, [f.targetAccountId]);

  const confirmed = await app.inject({
    method: 'GET', url: '/meetings', headers: { cookie: f.rep } });
  assert.match(confirmed.body, /Coastal Air/, 'the confirmed meeting is not on the list');
  assert.match(confirmed.body, /\b(?:ET|EDT|EST)\b/,
    'the meeting does not say which timezone the time is in');
});

test('the rep is never offered an action the server would refuse', async () => {
  const f = await pilotFixture();

  // A suppressed company: visible, marked, and offering nothing.
  const suppressed = await app.inject({
    method: 'GET', url: `/accounts/${f.suppressedAccountId}`, headers: { cookie: f.rep } });
  assert.equal(suppressed.statusCode, 200);
  assert.match(suppressed.body, /[Ss]uppressed|Do not contact|DNC/,
    'a DNC company does not say so on its own page');
  assert.equal(/href="tel:/.test(suppressed.body), false,
    'a suppressed company offers a dial link');

  // And the server refuses if the browser tries anyway.
  const dial = await app.inject({
    method: 'POST', url: `/accounts/${f.suppressedAccountId}/disposition`,
    headers: { cookie: f.rep },
    payload: { disposition: 'DECISION_MAKER_REACHED', notes: 'trying it on' } });
  assert.notEqual(dial.statusCode, 200);
  const activities = await query<{ n: number }>(
    `select count(*)::int as n from activities where account_id = $1
       and activity_type = 'CALL_ATTEMPT'`, [f.suppressedAccountId]);
  assert.equal(activities.rows[0]!.n, 0, 'an outcome was logged against a DNC company');
});

test('a rep can see what is missing, not just what is known', async () => {
  const f = await pilotFixture();
  // The thin Account: no research, no contact, no evidence.
  const page = await app.inject({
    method: 'GET', url: `/accounts/${f.thinAccountId}`, headers: { cookie: f.rep } });
  assert.equal(page.statusCode, 200);

  assert.equal(/badge-tier-[ABCD]/.test(page.body), false,
    'an unresearched company was given a fit tier');
  assert.match(page.body, /Unscored/, 'the page does not say it is unscored');
  assert.match(page.body, /No research|not researched|Unknown|no evidence|Named person not verified/i,
    'the page does not say what is missing');
  // And it does not invent a first question from nothing.
  assert.equal(/Suggested first question[\s\S]{0,200}Who picks up after five/.test(page.body), false,
    'a first question was offered for a company we know nothing about');
});
