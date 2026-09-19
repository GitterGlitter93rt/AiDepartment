import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import {
  createTwilioLookupAdapter, normalizeLineType, lineTypeUsageSummary,
  type LineTypeConfig, type Transport,
} from '../src/compliance/lineType.js';

/**
 * The Twilio Lookup line-type adapter.
 * Authority: outbound-sales-brain-twilio-lookup-line-type-adapter-spec.md
 * §4, §5, §7, §9, §11, §12, §13.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

const READY: LineTypeConfig = {
  accountSid: 'AC-test', authToken: 'token-not-a-real-one',
  baseUrl: 'https://lookups.test/v2', enabled: true, cacheDays: 90, costPerLookupUsd: 0.008,
};

function transport(body: unknown, options: { ok?: boolean; status?: number } = {}): Transport {
  return async () => ({
    ok: options.ok !== false, status: options.status ?? 200, json: async () => body,
  });
}

test('provider vocabulary maps to ours, and an unseen value is not guessed', () => {
  assert.equal(normalizeLineType('landline'), 'LANDLINE');
  assert.equal(normalizeLineType('nonFixedVoip'), 'NON_FIXED_VOIP');
  assert.equal(normalizeLineType('uan'), 'UNIVERSAL_ACCESS');
  assert.equal(normalizeLineType('somethingTwilioAddedToday'), 'UNKNOWN');
  assert.equal(normalizeLineType(null), 'UNKNOWN');
});

test('a successful lookup keeps the provider original alongside ours', async () => {
  const adapter = createTwilioLookupAdapter({
    config: READY,
    transport: transport({
      phone_number: '+19045550142', valid: true,
      line_type_intelligence: {
        type: 'fixedVoip', carrier_name: 'Some Carrier',
        mobile_country_code: '310', mobile_network_code: '260',
      },
    }),
  });

  const result = await adapter.screen({ phone: '904-555-0142' });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.normalizedLineType, 'FIXED_VOIP');
  assert.equal(result.providerOriginalType, 'fixedVoip',
    'a provider changing its vocabulary must be visible, not silently collapsed');
  assert.equal(result.carrierName, 'Some Carrier');
  assert.equal(result.costUsd, 0.008);
});

test('type=unknown from a successful lookup is an answer, not an error', async () => {
  const adapter = createTwilioLookupAdapter({
    config: READY,
    transport: transport({ valid: true, line_type_intelligence: { type: 'unknown' } }),
  });
  const result = await adapter.screen({ phone: '+19045550142' });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.normalizedLineType, 'UNKNOWN');
  assert.notEqual(result.status, 'PROVIDER_ERROR',
    'recording it as an error would make a rescreen look overdue forever');
});

test('a provider outage never becomes a line type', async () => {
  for (const [status, expected] of [[401, 'AUTH_FAILED'], [429, 'RATE_LIMITED'],
                                    [500, 'PROVIDER_ERROR']] as [number, string][]) {
    await resetDatabase();
    const adapter = createTwilioLookupAdapter({
      config: READY, transport: transport({}, { ok: false, status }) });
    const result = await adapter.screen({ phone: '+19045550142' });
    assert.equal(result.status, expected);
    assert.equal(result.normalizedLineType, 'UNKNOWN',
      'inferring landline from an outage is how a mobile gets auto-dialled');
  }
});

test('the database refuses a line type on a failed lookup', async () => {
  await assert.rejects(
    () => query(
      `insert into line_type_screen_results
         (normalized_value, status, normalized_line_type, refresh_by)
       values ('+19045550142', 'PROVIDER_ERROR', 'LANDLINE', now() + interval '90 days')`),
    /line_type_error_stays_unknown/,
    'the rule holds even against code that has not been written yet');
});

test('an unparseable number is refused before it costs anything', async () => {
  let called = 0;
  const adapter = createTwilioLookupAdapter({
    config: READY,
    transport: async () => { called += 1; return { ok: true, status: 200, json: async () => ({}) }; },
  });
  const result = await adapter.screen({ phone: 'not a phone number' });
  assert.equal(called, 0, 'paying to be told a string is not a number is waste');
  assert.equal(result.status, 'INVALID_NUMBER');
  assert.equal(result.costUsd, 0);
});

test('a fresh result is reused, and the second lookup is free', async () => {
  let calls = 0;
  const adapter = createTwilioLookupAdapter({
    config: READY,
    transport: async () => {
      calls += 1;
      return { ok: true, status: 200,
        json: async () => ({ valid: true, line_type_intelligence: { type: 'landline' } }) };
    },
  });

  const first = await adapter.screen({ phone: '+19045550142' });
  const second = await adapter.screen({ phone: '(904) 555-0142' });

  assert.equal(calls, 1, 'the same number in a different format is the same number');
  assert.equal(second.wasCacheHit, true);
  assert.equal(second.costUsd, 0);
  assert.equal(second.normalizedLineType, first.normalizedLineType);
});

test('a stale result is not reused', async () => {
  let calls = 0;
  const adapter = createTwilioLookupAdapter({
    config: READY,
    transport: async () => {
      calls += 1;
      return { ok: true, status: 200,
        json: async () => ({ valid: true, line_type_intelligence: { type: 'mobile' } }) };
    },
  });
  await adapter.screen({ phone: '+19045550142' });
  await query(`update line_type_screen_results set refresh_by = now() - interval '1 day'`);
  await adapter.screen({ phone: '+19045550142' });
  assert.equal(calls, 2, 'an expired result is a reason to rescreen, not to assume');
});

test('an unconfigured adapter answers UNKNOWN and calls nobody', async () => {
  const adapter = createTwilioLookupAdapter({
    config: { ...READY, enabled: false },
    transport: async () => { throw new Error('must not be called'); },
  });
  assert.equal(adapter.isConfigured(), false);
  const result = await adapter.screen({ phone: '+19045550142' });
  assert.equal(result.normalizedLineType, 'UNKNOWN');
  assert.equal(result.errorCode, 'NOT_CONFIGURED');
});

test('usage is accounted, with cache hits costing nothing', async () => {
  const adapter = createTwilioLookupAdapter({
    config: READY,
    transport: transport({ valid: true, line_type_intelligence: { type: 'landline' } }),
  });
  await adapter.screen({ phone: '+19045550142' });
  await adapter.screen({ phone: '+19045550142' });
  await adapter.screen({ phone: 'rubbish' });

  const summary = await lineTypeUsageSummary();
  assert.equal(summary.requests, 3);
  assert.equal(summary.cache_hits, 1);
  assert.equal(Number(summary.costUsd.toFixed(4)), 0.008,
    'one paid lookup, one free cache hit, one refused before it cost anything');
  assert.deepEqual(summary.distribution, [{ line_type: 'LANDLINE', n: 1 }]);
});

test('a line type is an input to policy, and this module writes no decision', async () => {
  const adapter = createTwilioLookupAdapter({
    config: READY,
    transport: transport({ valid: true, line_type_intelligence: { type: 'mobile' } }),
  });
  await adapter.screen({ phone: '+19045550142' });

  // A mobile result proves telecom service, not that the number is personal, that it
  // belongs to the named contact, or that consent exists.
  const decisions = await query(`select count(*)::int as n from channel_eligibility_decisions`);
  assert.equal(decisions.rows[0]!.n, 0, 'screening decides nothing on its own');
  const endpoints = await query(
    `select count(*)::int as n from contact_endpoints where autonomous_ai_voice <> 'REVIEW_REQUIRED'`);
  assert.equal(endpoints.rows[0]!.n, 0);
});
