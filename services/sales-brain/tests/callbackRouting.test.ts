import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetDatabase, makeUser } from './helpers.js';
import {
  routeInboundCall, recordInboundCall, captureCallbackIntent,
  INBOUND_PROFILE, CALLBACK_WINDOW_DAYS,
} from '../src/voice/callbackRouter.js';

/**
 * Inbound callback routing on the shared number.
 * Authority: outbound-sales-brain-shared-twilio-number-dual-service-spec.md §3, §7, §8.
 *
 * The rule the whole file exists to protect: a prospect returning our call is
 * answering us, not being approached. The cold script must never start.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

const PHONE = '904-555-0142';
const E164 = '+19045550142';

async function seedProspect(options: { name?: string } = {}): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: options.name ?? 'Riverbend Roofing',
    website: 'https://riverbend.example.com',
    phone: PHONE, city: 'Jacksonville', state: 'FL', postalCode: '32256',
  }, { discoverySource: 'test' }));
  return accountId;
}

/**
 * An outbound attempt of the kind that would make a callback meaningful.
 *
 * A phone attempt cannot exist without the eligibility decision that permitted it —
 * the database refuses one — so the decision is written first, exactly as the real
 * call path does.
 */
async function recordOutboundAttempt(accountId: string, options: {
  daysAgo?: number; disposition?: string;
} = {}): Promise<void> {
  const { rows } = await query<{ endpoint_id: string }>(
    `select endpoint_id from contact_endpoints
      where account_id = $1 and endpoint_type = 'PHONE' limit 1`, [accountId]);
  const endpointId = rows[0]!.endpoint_id;

  const decision = await query<{ decision_id: string }>(
    `insert into channel_eligibility_decisions
       (endpoint_id, account_id, channel, decision, reason_codes, policy_version)
     values ($1, $2, 'HUMAN_MANUAL_CALL', 'ALLOW', array['BUSINESS_LINE_VERIFIED'],
             'phone-eligibility-v1')
     returning decision_id`,
    [endpointId, accountId],
  );

  await query(
    `insert into contact_attempts
       (account_id, endpoint_id, channel, eligibility_decision_id, started_at, disposition)
     values ($1, $2, 'HUMAN_MANUAL_CALL', $3,
             now() - ($4::text || ' days')::interval, $5)`,
    [accountId, endpointId, decision.rows[0]!.decision_id, String(options.daysAgo ?? 1),
     options.disposition ?? 'NO_ANSWER'],
  );
}

test('a returning prospect never reaches the cold-call agent', async () => {
  const accountId = await seedProspect();
  await recordOutboundAttempt(accountId);

  const decision = await routeInboundCall({ fromNumber: E164 });
  assert.equal(decision.agentProfileId, INBOUND_PROFILE);
  assert.notEqual(decision.agentProfileId, 'yad-sales-core-v1' as never);
  assert.equal(decision.route, 'CAPTURE_CALLBACK_INTENT');
  assert.ok(decision.reasonCodes.includes('returning_our_call'));
});

test('the callback attaches to the canonical Account', async () => {
  const accountId = await seedProspect();
  await recordOutboundAttempt(accountId);

  const decision = await routeInboundCall({ fromNumber: '(904) 555-0142' });
  assert.equal(decision.accountId, accountId,
    'a number typed the way a person writes it still resolves');
  assert.equal(decision.companyName, 'Riverbend Roofing');

  const voiceCallId = await recordInboundCall({
    decision, fromNumber: E164, toNumber: '+19046829345' });
  const { rows } = await query(
    `select direction, account_id, agent_profile_id, mode_at_start
       from voice_calls where voice_call_id = $1`, [voiceCallId]);
  assert.equal(rows[0]!.direction, 'INBOUND');
  assert.equal(rows[0]!.account_id, accountId);
  assert.equal(rows[0]!.agent_profile_id, INBOUND_PROFILE);
});

test('a suppressed company is answered without any reference to our outreach', async () => {
  const accountId = await seedProspect();
  await recordOutboundAttempt(accountId);
  await query(`update accounts set is_suppressed = true where account_id = $1`, [accountId]);

  const decision = await routeInboundCall({ fromNumber: E164 });
  assert.equal(decision.route, 'SUPPRESSED_NO_PITCH');
  assert.equal(decision.spokenContext, '',
    'a company that told us to stop must not hear that we called');
  assert.equal(decision.offerTransfer, false);
  assert.ok(decision.reasonCodes.includes('no_outbound_context_spoken'));
});

test('a number recorded as a wrong number carries no relationship forward', async () => {
  const accountId = await seedProspect();
  await recordOutboundAttempt(accountId, { disposition: 'WRONG_NUMBER' });

  const decision = await routeInboundCall({ fromNumber: E164 });
  assert.equal(decision.route, 'WRONG_NUMBER_NO_HISTORY');
  assert.equal(decision.accountId, null,
    'whoever holds this handset is not the company we were calling');
  assert.equal(decision.companyName, null);
  assert.equal(decision.spokenContext, '');
});

test('a caller with a confirmed meeting is handled as a meeting, not a lead', async () => {
  const accountId = await seedProspect();
  const owner = await makeUser('Owner Rep', 'SALES_REP');
  await recordOutboundAttempt(accountId);
  await query(
    `update accounts set current_owner_user_id = $2, ownership_state = 'CLAIMED',
            claimed_at = now() where account_id = $1`,
    [accountId, owner.userId]);
  await query(
    `insert into meeting_bookings
       (account_id, owner_user_id, calendar_upn, meeting_type, idempotency_key,
        requested_start, requested_end, status, provider, provider_event_id, confirmed_at)
     values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'idem-callback-1',
             now() + interval '2 days', now() + interval '2 days' + interval '15 minutes',
             'CONFIRMED', 'calcom', 'evt-1', now())`,
    [accountId, owner.userId]);

  const decision = await routeInboundCall({ fromNumber: E164 });
  assert.equal(decision.route, 'CONFIRM_EXISTING_MEETING');
  assert.equal(decision.offerTransfer, true);
  assert.match(decision.spokenContext, /confirmed strategy call/);
});

test('a caller with an open opportunity goes to the person who owns it', async () => {
  const accountId = await seedProspect();
  const owner = await makeUser('Dana Rep', 'SALES_REP');
  await query(
    `update accounts set current_owner_user_id = $2, ownership_state = 'CLAIMED',
            claimed_at = now() where account_id = $1`,
    [accountId, owner.userId]);
  await query(
    `insert into opportunities
       (account_id, owner_user_id, title, stage, problem_summary, source_channel)
     values ($1, $2, 'Riverbend Roofing — after-hours cover', 'DISCOVERY',
             'Missed after-hours calls go to an answering service that only takes messages.',
             'human_call')`,
    [accountId, owner.userId]);

  const decision = await routeInboundCall({ fromNumber: E164 });
  assert.equal(decision.route, 'ROUTE_TO_OWNER');
  assert.equal(decision.ownerName, 'Dana Rep');
  assert.equal(decision.offerTransfer, true);
  assert.match(decision.spokenContext, /already working with Dana Rep/);
});

test('an unknown caller gets ordinary intake and no invented history', async () => {
  await seedProspect();
  const decision = await routeInboundCall({ fromNumber: '+12125550000' });
  assert.equal(decision.route, 'ORDINARY_INTAKE');
  assert.equal(decision.accountId, null);
  assert.equal(decision.companyName, null);
  assert.equal(decision.spokenContext, '');
  assert.ok(decision.reasonCodes.includes('caller_not_recognised'));
});

test('an old outbound attempt is not treated as a callback', async () => {
  const accountId = await seedProspect();
  await recordOutboundAttempt(accountId, { daysAgo: CALLBACK_WINDOW_DAYS + 5 });

  const decision = await routeInboundCall({ fromNumber: E164 });
  assert.equal(decision.route, 'ORDINARY_INTAKE');
  assert.ok(decision.reasonCodes.includes('known_account_no_recent_outbound'),
    'the Account is recognised, but the call is not a callback');
});

test('the spoken context never carries research, scores or the sales hypothesis', async () => {
  const accountId = await seedProspect();
  await recordOutboundAttempt(accountId);
  await query(
    `update accounts set manual_tier = 'A', manual_score = 14 where account_id = $1`, [accountId]);
  await query(
    `insert into offer_hypotheses (account_id, offer_family, rank, reason, is_current)
     values ($1, 'ai_phone_agent', 1, 'Emergency service with no after-hours cover', true)`,
    [accountId]);

  const decision = await routeInboundCall({ fromNumber: E164 });
  const spoken = decision.spokenContext;
  assert.equal(/tier|score|hypothes|phone agent|emergency service/i.test(spoken), false,
    'the receptionist may say we called, not what we think about them');
  assert.match(spoken, /We called Riverbend Roofing recently/);
});

test('every inbound route is recorded, including one that recognised nobody', async () => {
  const decision = await routeInboundCall({ fromNumber: '+12125550000' });
  const voiceCallId = await recordInboundCall({
    decision, fromNumber: '+12125550000', toNumber: '+19046829345' });

  const { rows } = await query(
    `select kind, label, detail from voice_call_events where voice_call_id = $1`, [voiceCallId]);
  assert.equal(rows[0]!.kind, 'POLICY');
  assert.match(rows[0]!.label, /ORDINARY_INTAKE/);
  assert.equal(rows[0]!.detail.spokeOutboundContext, false,
    'the record says whether outbound context was spoken');
});

test('a shared number keeps inbound and outbound as separate calls', async () => {
  const accountId = await seedProspect();
  await recordOutboundAttempt(accountId);
  const decision = await routeInboundCall({ fromNumber: E164 });
  await recordInboundCall({ decision, fromNumber: E164, toNumber: '+19046829345' });

  await query(
    `insert into voice_calls (direction, agent_profile_id, mode_at_start, account_id,
                              from_number, to_number)
     values ('OUTBOUND', 'yad-sales-core-v1', 'INTERNAL_TEST', $1, '+19046829345', $2)`,
    [accountId, E164]);

  const { rows } = await query<{ direction: string; agent_profile_id: string }>(
    `select direction, agent_profile_id from voice_calls where account_id = $1
      order by direction`, [accountId]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.direction, 'INBOUND');
  assert.equal(rows[0]!.agent_profile_id, INBOUND_PROFILE);
  assert.equal(rows[1]!.direction, 'OUTBOUND');
  assert.equal(rows[1]!.agent_profile_id, 'yad-sales-core-v1');
});

test('a callback becomes work for the owner, in the caller\'s words', async () => {
  const accountId = await seedProspect();
  const owner = await makeUser('Dana Rep', 'SALES_REP');
  await query(
    `update accounts set current_owner_user_id = $2, ownership_state = 'CLAIMED',
            claimed_at = now() where account_id = $1`, [accountId, owner.userId]);
  await recordOutboundAttempt(accountId);

  const decision = await routeInboundCall({ fromNumber: E164 });
  const voiceCallId = await recordInboundCall({
    decision, fromNumber: E164, toNumber: '+19046829345' });
  const result = await captureCallbackIntent({
    decision, voiceCallId,
    callerStatement: 'Somebody called about our lead follow-up. What was that about?',
  });

  assert.equal(result.ok, true);
  const { rows } = await query(
    `select owner_user_id, followup_type, context, prospect_requested, status
       from follow_ups where account_id = $1`, [accountId]);
  assert.equal(rows[0]!.owner_user_id, owner.userId, 'it lands with the person who owns it');
  assert.equal(rows[0]!.followup_type, 'CALLBACK');
  assert.equal(rows[0]!.status, 'OPEN');
  assert.match(rows[0]!.context, /What was that about\?/,
    'the caller is quoted rather than summarised into something they did not say');
});

test('a callback from an unclaimed prospect is not dropped', async () => {
  const accountId = await seedProspect();
  await recordOutboundAttempt(accountId);

  const decision = await routeInboundCall({ fromNumber: E164 });
  const voiceCallId = await recordInboundCall({
    decision, fromNumber: E164, toNumber: '+19046829345' });
  const result = await captureCallbackIntent({
    decision, voiceCallId, callerStatement: 'Returning a call.' });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'recorded_on_account_pending_owner');

  // A follow-up always belongs to somebody, so none is invented for an unowned
  // Account. The callback lives on the Account instead, in a protected state.
  const followUps = await query(`select count(*)::int as n from follow_ups`);
  assert.equal(followUps.rows[0]!.n, 0);

  const account = await query(
    `select relationship_state from accounts where account_id = $1`, [accountId]);
  assert.equal(account.rows[0]!.relationship_state, 'CALLBACK_REQUESTED',
    'the callback is visible in inventory and cannot be quietly recycled');

  const activity = await query(
    `select activity_type, notes from activities where account_id = $1
       and activity_type = 'CALLBACK_REQUESTED'`, [accountId]);
  assert.match(activity.rows[0]!.notes, /Returning a call/);
});

test('a suppressed caller produces no sales follow-up', async () => {
  const accountId = await seedProspect();
  await recordOutboundAttempt(accountId);
  await query(`update accounts set is_suppressed = true where account_id = $1`, [accountId]);

  const decision = await routeInboundCall({ fromNumber: E164 });
  const voiceCallId = await recordInboundCall({
    decision, fromNumber: E164, toNumber: '+19046829345' });
  const result = await captureCallbackIntent({
    decision, voiceCallId, callerStatement: 'Why did you call me?' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'account_suppressed');
  const { rows } = await query(`select count(*)::int as n from follow_ups`);
  assert.equal(rows[0]!.n, 0);
});
