import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetDatabase, makeUser } from './helpers.js';
import { mayPlaceCall, openCallRecord, recordDialRefusal,
         type DialControllerConfig } from '../src/voice/dialController.js';
import { setPilotSwitch } from '../src/domain/pilot.js';

/**
 * The outbound dial controller.
 * Authority: outbound-sales-brain-shared-twilio-number-dual-service-spec.md §6, §7, §9, §10;
 * outbound-sales-brain-voice-runtime-reuse-audit.md §3.
 *
 * Every rule is proved without placing a call, which is the point of keeping the
 * controller free of transport.
 */

const CONFIG: DialControllerConfig = {
  approvedCallerIds: ['+19046829345'],
  internalTestDestinations: ['+19045550199'],
  agentProfileId: 'yad-sales-core-v1',
};

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function endpointFor(phone: string): Promise<{ endpointId: string; accountId: string }> {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Riverbend Roofing',
      website: 'https://riverbend.example.com',
      phone,
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' }));

  const { rows } = await pool.query<{ endpoint_id: string }>(
    `select endpoint_id from contact_endpoints
      where account_id = $1 and endpoint_type = 'PHONE' limit 1`, [accountId]);
  return { endpointId: rows[0]!.endpoint_id, accountId };
}

/** Puts the operator switches where a call would otherwise be permitted. */
async function armOutbound(mode: 'INTERNAL_TEST' | 'CONTROLLED_PILOT' = 'CONTROLLED_PILOT') {
  const user = await makeUser('Ops Manager', 'SALES_MANAGER');
  await setPilotSwitch({ field: 'outbound_mode', value: mode,
    actorUserId: user.userId, reason: 'test' });
  await setPilotSwitch({ field: 'outbound_dial_enabled', value: 'true',
    actorUserId: user.userId, reason: 'test' });
  return user;
}

test('a call is refused while outbound is off, whatever else is true', async () => {
  const { endpointId } = await endpointFor('904-555-0142');
  const decision = await mayPlaceCall({
    endpointId, fromNumber: '+19046829345', config: CONFIG });

  assert.equal(decision.allowed, false);
  assert.ok(decision.refusals.includes('OUTBOUND_MODE_OFF'));
  assert.ok(decision.refusals.includes('DIAL_CREATION_DISABLED'));
});

test('an unapproved caller ID is refused rather than dialled', async () => {
  await armOutbound();
  const { endpointId } = await endpointFor('904-555-0142');

  const decision = await mayPlaceCall({
    endpointId, fromNumber: '+19045550100', config: CONFIG });
  assert.ok(decision.refusals.includes('CALLER_ID_NOT_APPROVED'),
    'presenting a number YAD does not control is never permitted');
});

test('internal test mode may only reach an allow-listed internal number', async () => {
  await armOutbound('INTERNAL_TEST');
  const { endpointId } = await endpointFor('904-555-0142');

  const decision = await mayPlaceCall({
    endpointId, fromNumber: '+19046829345', config: CONFIG });
  assert.ok(decision.refusals.includes('INTERNAL_TEST_DESTINATION_NOT_ALLOWLISTED'),
    'an internal test must not reach a real prospect');
});

test('destination eligibility is re-checked at dial time, not read from a stored decision', async () => {
  await armOutbound();
  const { endpointId } = await endpointFor('904-555-0142');

  // Nothing has screened this number, so AI voice is not cleared for it.
  const decision = await mayPlaceCall({
    endpointId, fromNumber: '+19046829345', config: CONFIG });
  assert.ok(decision.refusals.includes('DESTINATION_NOT_ELIGIBLE'));

  // Even if a stale ALLOW is written straight onto the endpoint, the controller
  // recomputes and still refuses.
  await pool.query(
    `update contact_endpoints set autonomous_ai_voice = 'ALLOW', eligibility_evaluated_at = now()
      where endpoint_id = $1`, [endpointId]);
  const again = await mayPlaceCall({
    endpointId, fromNumber: '+19046829345', config: CONFIG });
  assert.ok(again.refusals.includes('DESTINATION_NOT_ELIGIBLE'),
    'a stored ALLOW must not be trusted in place of a live check');
});

test('the concurrency cap counts open calls, and blocks the next one', async () => {
  const user = await armOutbound();
  const { endpointId, accountId } = await endpointFor('904-555-0142');

  await openCallRecord({
    agentProfileId: 'yad-sales-core-v1', modeAtStart: 'CONTROLLED_PILOT',
    endpointId, accountId, fromNumber: '+19046829345', toNumber: '+19045550142',
  }, {});

  const decision = await mayPlaceCall({
    endpointId, fromNumber: '+19046829345', config: CONFIG });
  assert.ok(decision.refusals.includes('CONCURRENCY_CAP_REACHED'),
    'the pilot starts at one call at a time');

  // A finished call frees the slot; a call that merely started does not.
  await pool.query(`update voice_calls set ended_at = now()`);
  const after = await mayPlaceCall({
    endpointId, fromNumber: '+19046829345', config: CONFIG });
  assert.equal(after.refusals.includes('CONCURRENCY_CAP_REACHED'), false);
  await recordDialRefusal({ endpointId, decision, actorUserId: user.userId });
});

test('a refused call is still explainable afterwards', async () => {
  const user = await makeUser('Manager Two', 'SALES_MANAGER');
  const { endpointId } = await endpointFor('904-555-0142');
  const decision = await mayPlaceCall({
    endpointId, fromNumber: '+19045550100', config: CONFIG });
  await recordDialRefusal({ endpointId, decision, actorUserId: user.userId });

  const { rows } = await pool.query(
    `select reason, detail from audit_log where action = 'voice.dial_refused'`);
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.reason, /OUTBOUND_MODE_OFF/);
  assert.equal(rows[0]!.detail.mode, 'OFF');
});

test('a permitted call is created with the mode it started under', async () => {
  await armOutbound();
  const { endpointId, accountId } = await endpointFor('904-555-0142');
  const user = await makeUser('Manager Three', 'SALES_MANAGER');

  const voiceCallId = await openCallRecord({
    agentProfileId: 'yad-sales-core-v1', modeAtStart: 'CONTROLLED_PILOT',
    endpointId, accountId, fromNumber: '+19046829345', toNumber: '+19045550142',
  }, { providerCallSid: 'CA-test-1' });

  // The operator stands outbound down after the call has started.
  await setPilotSwitch({ field: 'outbound_mode', value: 'OFF',
    actorUserId: user.userId, reason: 'stand down' });

  const { rows } = await pool.query(
    `select mode_at_start, agent_profile_id from voice_calls where voice_call_id = $1`,
    [voiceCallId]);
  assert.equal(rows[0]!.mode_at_start, 'CONTROLLED_PILOT',
    'a toggle applies to new calls only; it must not rewrite a call already running');
  assert.equal(rows[0]!.agent_profile_id, 'yad-sales-core-v1');
});

// ------------------------------------------------- the live turn producer ----

import { setCalendarAdapter } from '../src/booking/service.js';
import { zonedTimeToUtc } from '../src/booking/policy.js';
import type { CalendarAdapter, CreateEventResult } from '../src/booking/types.js';
import {
  beginSalesCall, finishSalesCall, nextSalesTurn,
} from '../src/voice/salesTurnProducer.js';
import { buildCallPack } from '../src/callbrain/callPack.js';

function calendar(options: { createResult?: CreateEventResult } = {}): CalendarAdapter {
  return {
    name: 'fake_calendar',
    isConfigured: () => true,
    async getBusy() { return { ok: true, busy: [] }; },
    async createEvent() {
      return options.createResult
        ?? { ok: true, providerEventId: 'evt-live-1', webLink: 'https://cal.example/evt-live-1' };
    },
  };
}

/** A Tuesday at 08:00 New York, so a same-day slot genuinely exists. */
const CALL_TIME = () => zonedTimeToUtc(2026, 9, 8, 8, 0, 'America/New_York');

async function liveCall(accountId: string) {
  const { rows } = await pool.query<{ voice_call_id: string }>(
    `insert into voice_calls (direction, agent_profile_id, mode_at_start, account_id)
     values ('OUTBOUND', 'yad-sales-core-v1', 'INTERNAL_TEST', $1)
     returning voice_call_id`, [accountId]);
  return rows[0]!.voice_call_id;
}

test('a live call speaks no time the calendar did not offer', async () => {
  setCalendarAdapter(calendar());
  const { accountId } = await endpointFor('904-555-0142');
  const voiceCallId = await liveCall(accountId);

  const { session } = await beginSalesCall({ voiceCallId, accountId, now: CALL_TIME });
  const said: string[] = [];
  for (const utterance of [
    'We miss calls when the crews are out.',
    'Nobody picks them up until the next morning.',
    'Yeah, that is probably worth looking at.',
    'Sure, that works.',
  ]) {
    said.push((await nextSalesTurn(session, utterance)).say);
  }

  const offered = session.state.offeredSlots.map((slot) => slot.spoken);
  const spokenTimes = said.join(' ').match(/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi) ?? [];
  for (const time of spokenTimes) {
    assert.ok(offered.some((slot) => slot.includes(time)),
      `the agent said ${time}, which the calendar never offered`);
  }
  assert.ok(offered.length > 0, 'availability was actually checked');
});

test('a provider failure is never spoken as a confirmed booking', async () => {
  setCalendarAdapter(calendar({
    createResult: { ok: false, error: 'calendar rejected the event', errorCode: 'PROVIDER_ERROR' },
  }));
  const { accountId } = await endpointFor('904-555-0142');
  const voiceCallId = await liveCall(accountId);

  const { session } = await beginSalesCall({ voiceCallId, accountId, now: CALL_TIME });
  await nextSalesTurn(session, 'We miss calls when the crews are out.');
  await nextSalesTurn(session, 'Nobody picks them up until the next morning.');
  await nextSalesTurn(session, 'Yeah, that is probably worth looking at.');
  await nextSalesTurn(session, 'Sure, that works.');

  const slot = session.state.offeredSlots[0];
  assert.ok(slot, 'a slot was offered');
  const picked = await nextSalesTurn(session, `${slot!.spoken} works.`);
  const withEmail = await nextSalesTurn(session, 'dana@riverbend.example.com');
  const everything = `${picked.say} ${withEmail.say}`;

  assert.equal(/you'?re (?:confirmed|booked|all set)|it'?s in the calendar/i.test(everything), false,
    'a failed booking must never be spoken as confirmed');
  assert.match(everything, /tentative|have it confirmed/i,
    'the prospect is told the confirmation is still pending');
  assert.notEqual(session.state.memory.booking.providerStatus, 'confirmed');
});

test('the transcript and the outcome survive the call', async () => {
  setCalendarAdapter(calendar());
  const { accountId } = await endpointFor('904-555-0142');
  const voiceCallId = await liveCall(accountId);

  const { session } = await beginSalesCall({ voiceCallId, accountId, now: CALL_TIME });
  await nextSalesTurn(session, 'Take us off your list.');
  const outcome = await finishSalesCall(session);

  assert.equal(outcome, 'DNC', 'a do-not-contact request is the outcome, whatever else happened');

  const turns = await pool.query(
    `select speaker, text from voice_call_turns where voice_call_id = $1 order by turn_index`,
    [voiceCallId]);
  assert.ok(turns.rows.length >= 3, 'the opener, the prospect and the reply are all stored');
  assert.equal(turns.rows[0]!.speaker, 'AGENT');
  assert.equal(turns.rows[1]!.text, 'Take us off your list.');

  const call = await pool.query(
    `select outcome, disposition, ended_at from voice_calls where voice_call_id = $1`, [voiceCallId]);
  assert.equal(call.rows[0]!.outcome, 'DNC');
  assert.equal(call.rows[0]!.disposition, 'DO_NOT_CONTACT');
  assert.ok(call.rows[0]!.ended_at, 'the call is closed');
});

test('a call cannot start without a researched Call Pack', async () => {
  const { accountId } = await endpointFor('904-555-0142');
  const voiceCallId = await liveCall(accountId);
  const pack = await buildCallPack(accountId);
  // The fixture account has enough to build one; the guard is what happens when it
  // does not, which is the case this asserts.
  assert.ok(pack, 'the fixture account can produce a Call Pack');

  await assert.rejects(
    () => beginSalesCall({
      voiceCallId, accountId: '00000000-0000-0000-0000-000000000000', now: CALL_TIME }),
    /No Call Pack|not started/i,
    'without a researched basis the agent has nothing truthful to open with');
});

// ------------------------------------------- the relay producer adapter ------

import { createSalesRelayProducer } from '../src/voice/relayProducer.js';

test('the relay producer speaks the opener once and answers each turn', async () => {
  setCalendarAdapter(calendar());
  const { accountId } = await endpointFor('904-555-0142');
  const voiceCallId = await liveCall(accountId);

  const producer = await createSalesRelayProducer({ voiceCallId, accountId });
  const opening = await producer.opening();
  assert.match(opening, /Your AI Department/);
  assert.match(opening, /cold call/, 'the call is disclosed as cold in the opener');

  const controller = new AbortController();
  const turn = await producer.respond('We miss calls when the crews are out.', controller.signal);
  assert.ok(turn.say.length > 0);
  assert.equal(turn.terminal, false);
});

test('a turn abandoned mid-production is never returned to be spoken', async () => {
  setCalendarAdapter(calendar());
  const { accountId } = await endpointFor('904-555-0142');
  const voiceCallId = await liveCall(accountId);
  const producer = await createSalesRelayProducer({ voiceCallId, accountId });

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => producer.respond('Go on then.', controller.signal),
    /aborted/,
    'the caller moved on; speaking this would be talking over them');
});

test('a call that ends twice keeps the outcome the conversation reached', async () => {
  setCalendarAdapter(calendar());
  const { accountId } = await endpointFor('904-555-0142');
  const voiceCallId = await liveCall(accountId);
  const producer = await createSalesRelayProducer({ voiceCallId, accountId });

  await producer.respond('Take us off your list.', new AbortController().signal);
  await producer.finish('completed');
  await producer.finish('caller_hung_up');

  const { rows } = await pool.query(
    `select outcome from voice_calls where voice_call_id = $1`, [voiceCallId]);
  assert.equal(rows[0]!.outcome, 'DNC',
    'a hang-up after the call ended must not overwrite what happened on it');

  const events = await pool.query(
    `select count(*)::int as n from voice_call_events
      where voice_call_id = $1 and label like 'Caller hung up%'`, [voiceCallId]);
  assert.equal(events.rows[0]!.n, 0, 'and must not record a second ending');
});
