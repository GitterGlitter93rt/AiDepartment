import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import {
  createDataForSeoAdapter, dedupeCandidates, normalizeResponse,
  type DataForSeoConfig, type ProviderResponse, type Transport,
} from '../src/miner/dataForSeoAdapter.js';
import {
  handleSmartleadWebhook, signSmartleadBody, toInboundEvent,
  verifySmartleadSignature, type SmartleadWebhookConfig,
} from '../src/email/smartleadWebhook.js';
import {
  createTwilioLookupAdapter, endpointLineTypeFor, normalizeLineType,
  type LineTypeConfig,
} from '../src/compliance/lineType.js';
import { withTransaction } from '../src/db/pool.js';
import { upsertAccount, upsertEndpoint } from '../src/domain/accounts.js';

/**
 * Provider contract hardening, against fixtures rather than providers.
 * Authority: market-miner-serp-provider-selection-current.md,
 * outbound-sales-brain-smartlead-sync-spec.md §5-§11, §17, §20.
 *
 * These cover the parts that only show themselves when the credential arrives: the
 * queued mode that answers with a task id rather than results, the transient failure
 * that deserves one more try, the same company appearing twice on one page, and a
 * webhook that changes a relationship on the strength of an unverified POST.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

const BASE: DataForSeoConfig = {
  login: 'login', password: 'password', baseUrl: 'https://provider.test/v3',
  mode: 'standard', governanceReviewed: true, enabled: true, maxQueriesPerRun: 25,
  resultDepth: 100, maxRetries: 2, maxPollAttempts: 3, pollIntervalMs: 1,
};
const noSleep = async () => {};

const LOOKUP: LineTypeConfig = {
  accountSid: 'AC-test', authToken: 'token', baseUrl: 'https://lookups.test/v2',
  enabled: true, cacheDays: 90, costPerLookupUsd: 0.008,
};

/** One Account with one phone endpoint, so a screen has somewhere to land. */
async function seedEndpoint(endpointRole: string): Promise<{ accountId: string; endpointId: string }> {
  return withTransaction(async (client) => {
    const { accountId } = await upsertAccount(client, {
      canonicalName: 'Lookup Fixture Co', website: 'https://lookup.example.com',
      phone: '904-555-0177', city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' });
    const endpointId = (await upsertEndpoint(client, {
      accountId, contactId: null, locationId: null, type: 'PHONE', rawValue: '904-555-0177',
      endpointRole: endpointRole as never, relationshipToPerson: 'UNVERIFIED',
      qualityState: 'PUBLIC_OBSERVED_UNVERIFIED', source: 'PUBLIC_DIRECTORY',
      sourceReference: null, verifiedAt: null,
    }))!;
    return { accountId, endpointId };
  });
}

const REQUEST = {
  // 'postal_code' was never a geography type this system searches: the miner uses
  // 'zip_zcta', and the adapter passed whatever it was given straight to the provider.
  verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32256',
  miningMode: 'advertisers_first', queryBudget: 5,
};

function taskCreated(id = 'task-1'): ProviderResponse {
  return { status_code: 20000, cost: 0.0031, tasks: [{ id, status_code: 20100 }] };
}

function taskDone(id = 'task-1', items: Record<string, unknown>[] = [
  { type: 'paid', rank_absolute: 1, title: 'Northgate Air', domain: 'northgateair.com',
    url: 'https://northgateair.com/ac', advertiser_id: 'adv-9' },
]): ProviderResponse {
  return {
    status_code: 20000, cost: 0.0031,
    tasks: [{
      id, status_code: 20000, cost: 0.0031,
      result: [{ keyword: 'ac repair 32256', location_name: 'Jacksonville,Florida,United States',
                 datetime: '2026-09-04 10:00:00 +00:00', items: items as never }],
    }],
  };
}

/** Records every call so the test can assert which endpoints were used, and how often. */
function recordingTransport(
  responder: (url: string, call: number) => { ok?: boolean; status?: number; body?: ProviderResponse;
                                             headers?: Record<string, string>; throws?: boolean },
): { transport: Transport; calls: { url: string; method: string; body?: string }[] } {
  const calls: { url: string; method: string; body?: string }[] = [];
  const transport: Transport = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    const answer = responder(url, calls.length);
    if (answer.throws) throw new Error('socket hang up');
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      json: async () => answer.body ?? {},
      headers: { get: (name: string) => answer.headers?.[name.toLowerCase()] ?? null },
    };
  };
  return { transport, calls };
}

// --- DataForSEO: the queued mode actually collects its results -----------------

test('standard mode posts a task and then collects it', async () => {
  const { transport, calls } = recordingTransport((url) =>
    url.includes('task_post') ? { body: taskCreated() } : { body: taskDone() });
  const adapter = createDataForSeoAdapter({ config: BASE, transport, sleep: noSleep });

  const found = await adapter.discover(REQUEST);
  assert.equal(found.status, 'OK');
  assert.equal(found.businesses.length, 1, 'the queued task was never collected');
  assert.equal(found.businesses[0]!.website, 'https://northgateair.com');

  assert.match(calls[0]!.url, /task_post/);
  assert.match(calls[1]!.url, /task_get\/advanced\/task-1/);
  assert.equal(calls[1]!.method, 'GET');
  // Live is a different endpoint, not a priority on the queued one.
  assert.equal(calls.some((call) => call.url.includes('/live/')), false);
});

test('an acknowledgement with no results is never treated as an empty SERP', async () => {
  // The task stays queued for every poll. Nothing is invented and the reason is
  // recorded, so a run that found nothing can be told apart from one that failed.
  const { transport, calls } = recordingTransport((url) =>
    url.includes('task_post') ? { body: taskCreated() } : { body: { tasks: [{ id: 'task-1', status_code: 40602 }] } });
  const adapter = createDataForSeoAdapter({ config: BASE, transport, sleep: noSleep });

  const found = await adapter.discover(REQUEST);
  assert.deepEqual(found.businesses, []);
  // The money is spent and the answer is still coming. Reporting that as a market
  // with nothing in it was the defect: PENDING is a third thing, and the task id
  // comes back so the next run collects this search rather than buying another.
  assert.equal(found.status, 'PENDING');
  assert.equal(found.providerTaskId, 'task-1');
  assert.equal(calls.filter((call) => call.url.includes('task_get')).length, BASE.maxPollAttempts,
    'the poll is bounded by configuration, not by hope');

  const usage = await query<{ status: string; error_code: string; operation: string }>(
    'select status, error_code, operation from provider_usage order by requested_at desc limit 1');
  assert.equal(usage.rows[0]!.status, 'FAILED');
  assert.equal(usage.rows[0]!.error_code, 'TASK_NOT_READY');
});

test('a task that errored stops the poll instead of running it out', async () => {
  const { transport, calls } = recordingTransport((url) =>
    url.includes('task_post') ? { body: taskCreated() }
      : { body: { tasks: [{ id: 'task-1', status_code: 40501, status_message: 'invalid field' }] } });
  const adapter = createDataForSeoAdapter({ config: BASE, transport, sleep: noSleep });

  const errored = await adapter.discover(REQUEST);
  assert.deepEqual(errored.businesses, []);
  assert.equal(errored.status, 'MALFORMED',
    'a task the provider rejected is not a market with nothing in it');
  assert.equal(calls.filter((call) => call.url.includes('task_get')).length, 1,
    'a permanent task error was polled again');
  const usage = await query<{ error_code: string }>(
    'select error_code from provider_usage order by requested_at desc limit 1');
  assert.equal(usage.rows[0]!.error_code, 'TASK_40501');
});

test('live mode reads results from the response it gets', async () => {
  const { transport, calls } = recordingTransport(() => ({ body: taskDone() }));
  const adapter = createDataForSeoAdapter({
    config: { ...BASE, mode: 'live' }, transport, sleep: noSleep });

  const found = await adapter.discover(REQUEST);
  assert.equal(found.businesses.length, 1);
  assert.equal(calls.length, 1, 'live mode should be one request');
  assert.match(calls[0]!.url, /serp\/google\/organic\/live\/advanced/);
  const usage = await query<{ operation: string; status: string }>(
    'select operation, status from provider_usage order by requested_at desc limit 1');
  assert.equal(usage.rows[0]!.operation, 'serp.discover.live');
  assert.equal(usage.rows[0]!.status, 'OK');
});

test('depth is requested, and stays inside what the provider accepts', async () => {
  const { transport, calls } = recordingTransport(() => ({ body: taskDone() }));
  const adapter = createDataForSeoAdapter({
    config: { ...BASE, mode: 'live', resultDepth: 5_000 }, transport, sleep: noSleep });
  await adapter.discover(REQUEST);

  const sent = JSON.parse(calls[0]!.body!) as { depth: number }[];
  assert.equal(sent[0]!.depth, 700, 'an out-of-range depth was sent to the provider as given');

  const shallow = recordingTransport(() => ({ body: taskDone() }));
  await createDataForSeoAdapter({
    config: { ...BASE, mode: 'live', resultDepth: 1 }, transport: shallow.transport, sleep: noSleep,
  }).discover(REQUEST);
  assert.equal((JSON.parse(shallow.calls[0]!.body!) as { depth: number }[])[0]!.depth, 10);
});

// --- DataForSEO: retries ------------------------------------------------------

test('a 429 is retried, and the provider’s own Retry-After is honoured', async () => {
  const waited: number[] = [];
  const { transport, calls } = recordingTransport((url, call) =>
    call === 1 ? { ok: false, status: 429, headers: { 'retry-after': '2' } }
      : { body: taskDone() });
  const adapter = createDataForSeoAdapter({
    config: { ...BASE, mode: 'live' }, transport,
    sleep: async (ms) => { waited.push(ms); },
  });

  const found = await adapter.discover(REQUEST);
  assert.equal(found.businesses.length, 1, 'a throttled call was not retried');
  assert.equal(calls.length, 2);
  assert.deepEqual(waited, [2_000], 'we waited less than the provider asked for');
});

test('a 401 is not retried: repeating it only spends money', async () => {
  const { transport, calls } = recordingTransport(() => ({ ok: false, status: 401 }));
  const adapter = createDataForSeoAdapter({
    config: { ...BASE, mode: 'live' }, transport, sleep: noSleep });

  const refused = await adapter.discover(REQUEST);
  assert.deepEqual(refused.businesses, []);
  assert.equal(refused.status, 'CREDENTIALS_INVALID',
    'a rejected credential is a fact about us, not about the market');
  assert.equal(calls.length, 1, 'an authentication failure was retried');
  const usage = await query<{ error_code: string }>(
    'select error_code from provider_usage order by requested_at desc limit 1');
  assert.equal(usage.rows[0]!.error_code, 'HTTP_401');
});

test('retries are bounded, and the exhaustion is recorded', async () => {
  const { transport, calls } = recordingTransport(() => ({ ok: false, status: 503 }));
  const adapter = createDataForSeoAdapter({
    config: { ...BASE, mode: 'live', maxRetries: 2 }, transport, sleep: noSleep });

  const exhausted = await adapter.discover(REQUEST);
  assert.deepEqual(exhausted.businesses, []);
  assert.equal(exhausted.status, 'OUTAGE', 'a provider that is down is not an empty market');
  assert.equal(calls.length, 3, 'one attempt plus two retries');
  const usage = await query<{ status: string; units: number; error_code: string }>(
    'select status, units, error_code from provider_usage order by requested_at desc limit 1');
  assert.equal(usage.rows[0]!.status, 'FAILED');
  assert.equal(Number(usage.rows[0]!.units), 3, 'every attempt is accounted for');
  assert.equal(usage.rows[0]!.error_code, 'HTTP_503');
});

test('a dropped socket is retried like any other transient failure', async () => {
  const { transport, calls } = recordingTransport((_url, call) =>
    call === 1 ? { throws: true } : { body: taskDone() });
  const adapter = createDataForSeoAdapter({
    config: { ...BASE, mode: 'live' }, transport, sleep: noSleep });

  assert.equal((await adapter.discover(REQUEST)).businesses.length, 1);
  assert.equal(calls.length, 2);
});

// --- DataForSEO: one company per page, not one per row ------------------------

test('a business that buys the ad and also ranks organically is one candidate', () => {
  const response = taskDone('task-1', [
    { type: 'paid', rank_absolute: 1, title: 'Northgate Air', domain: 'northgateair.com',
      url: 'https://northgateair.com/ac', advertiser_id: 'adv-9' },
    { type: 'organic', rank_absolute: 4, title: 'Northgate Air & Heating',
      domain: 'northgateair.com', url: 'https://northgateair.com' },
    { type: 'organic', rank_absolute: 5, title: 'Palmetto Plumbing',
      domain: 'palmettoplumbing.com' },
  ]);
  const candidates = dedupeCandidates(normalizeResponse(response, { query: 'ac repair' }));

  assert.equal(candidates.length, 2, 'the same domain produced two candidates');
  const northgate = candidates.find((c) => c.website === 'https://northgateair.com');
  assert.equal(northgate!.resultType, 'PAID_SEARCH_TEXT',
    'the paid observation is the interesting one and must win');
  assert.equal(northgate!.landingUrl, 'https://northgateair.com/ac',
    'the ad landing page was lost in the merge');
});

test('two organic rows for one domain keep the higher position', () => {
  const response = taskDone('task-1', [
    { type: 'organic', rank_absolute: 7, title: 'Deep Link', domain: 'coastalair.com',
      url: 'https://coastalair.com/blog' },
    { type: 'organic', rank_absolute: 2, title: 'Coastal Air', domain: 'coastalair.com',
      url: 'https://coastalair.com' },
  ]);
  const candidates = dedupeCandidates(normalizeResponse(response, { query: 'ac repair' }));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.name, 'Coastal Air');
});

test('a row with nothing to identify it is dropped, not given a made-up identity', () => {
  const response = taskDone('task-1', [
    { type: 'organic', rank_absolute: 1, title: 'No Domain And No Phone' },
    { type: 'paid', rank_absolute: 2, title: 'Phone Only Ads', phone: '(904) 555-0150' },
  ]);
  const candidates = dedupeCandidates(normalizeResponse(response, { query: 'ac repair' }));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.phone, '(904) 555-0150');
  assert.equal(candidates[0]!.website, null);
});

// --- Smartlead: a reply changes a relationship, so prove it came from them -----

const SECRET: SmartleadWebhookConfig = { secret: 'webhook-secret', toleranceSeconds: 300 };
const NOW = new Date('2026-09-04T12:00:00Z');
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));

function signed(body: unknown, at = TIMESTAMP) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    headers: {
      'x-smartlead-signature': signSmartleadBody(rawBody, at, SECRET.secret!),
      'x-smartlead-timestamp': at,
    } as Record<string, string>,
  };
}

test('a correctly signed request verifies', () => {
  const { rawBody, headers } = signed({ event_type: 'EMAIL_REPLY' });
  const result = verifySmartleadSignature({
    rawBody, signature: headers['x-smartlead-signature'],
    timestamp: headers['x-smartlead-timestamp'], config: SECRET, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'OK');
});

test('the signature is over the bytes received, not over a re-serialised object', () => {
  // Same data, different key order and whitespace: a check that re-serialises would
  // accept this, and would then also reject legitimate requests it reordered.
  const original = '{"event_type":"EMAIL_REPLY","lead_id":7}';
  const reordered = '{ "lead_id": 7, "event_type": "EMAIL_REPLY" }';
  const signature = signSmartleadBody(original, TIMESTAMP, SECRET.secret!);

  assert.equal(verifySmartleadSignature({
    rawBody: original, signature, timestamp: TIMESTAMP, config: SECRET, now: NOW }).ok, true);
  assert.equal(verifySmartleadSignature({
    rawBody: reordered, signature, timestamp: TIMESTAMP, config: SECRET, now: NOW }).ok, false);
});

test('an unsigned, wrongly signed or truncated signature is refused', () => {
  const { rawBody, headers } = signed({ event_type: 'EMAIL_REPLY' });
  const good = headers['x-smartlead-signature']!;
  for (const [label, signature] of [
    ['missing', undefined],
    ['empty', ''],
    ['wrong', 'a'.repeat(64)],
    ['truncated', good.slice(0, 32)],
    ['not hex', 'z'.repeat(64)],
    ['prefixed with someone else’s scheme', `sha1=${good}`],
  ] as const) {
    const result = verifySmartleadSignature({
      rawBody, signature, timestamp: TIMESTAMP, config: SECRET, now: NOW });
    assert.equal(result.ok, false, `a ${label} signature was accepted`);
  }
  // The sha256= prefix the provider may send is accepted.
  assert.equal(verifySmartleadSignature({
    rawBody, signature: `sha256=${good}`, timestamp: TIMESTAMP, config: SECRET, now: NOW }).ok, true);
});

test('a captured request cannot be replayed later, even with a valid signature', () => {
  const oldTimestamp = String(Math.floor(NOW.getTime() / 1000) - 3_600);
  const { rawBody, headers } = signed({ event_type: 'EMAIL_REPLY' }, oldTimestamp);
  const result = verifySmartleadSignature({
    rawBody, signature: headers['x-smartlead-signature'],
    timestamp: oldTimestamp, config: SECRET, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'TIMESTAMP_OUTSIDE_TOLERANCE');

  // A clock a little ahead of ours is tolerated; hours ahead is not.
  const slightlyAhead = String(Math.floor(NOW.getTime() / 1000) + 60);
  const ahead = signed({ event_type: 'EMAIL_REPLY' }, slightlyAhead);
  assert.equal(verifySmartleadSignature({
    rawBody: ahead.rawBody, signature: ahead.headers['x-smartlead-signature'],
    timestamp: slightlyAhead, config: SECRET, now: NOW }).ok, true);
});

test('the timestamp must be inside the signed material, or moving it would be free', () => {
  const body = '{"event_type":"EMAIL_REPLY"}';
  const signature = signSmartleadBody(body, TIMESTAMP, SECRET.secret!);
  // An attacker who replays the body with a fresh timestamp must fail the signature.
  const fresher = String(Math.floor(NOW.getTime() / 1000) + 10);
  assert.equal(verifySmartleadSignature({
    rawBody: body, signature, timestamp: fresher, config: SECRET, now: NOW }).ok, false);
});

test('no secret configured refuses the request rather than trusting it', async () => {
  const { rawBody, headers } = signed({ event_type: 'EMAIL_REPLY' });
  const handled = await handleSmartleadWebhook({
    rawBody, headers, config: { secret: null, toleranceSeconds: 300 }, now: NOW });
  assert.equal(handled.status, 503, 'an unverifiable webhook was accepted');
  assert.equal(handled.body.ok, false);
  assert.equal(handled.body.outcome, 'NOT_CONFIGURED');
});

test('an unverified webhook never reaches ingestion', async () => {
  let reached = false;
  const { rawBody } = signed({ event_type: 'EMAIL_REPLY', reply_body: 'remove me' });
  const handled = await handleSmartleadWebhook({
    rawBody,
    headers: { 'x-smartlead-signature': 'b'.repeat(64), 'x-smartlead-timestamp': TIMESTAMP },
    config: SECRET, now: NOW,
    ingest: async () => { reached = true; throw new Error('must not be called'); },
  });
  assert.equal(handled.status, 401);
  assert.equal(reached, false, 'a forged reply reached the CRM');
});

test('the rejection says which check failed and nothing about our data', async () => {
  const { rawBody, headers } = signed({ event_type: 'EMAIL_REPLY', lead_email: 'ray@coastal.test' });
  const handled = await handleSmartleadWebhook({
    rawBody, headers: { ...headers, 'x-smartlead-signature': 'c'.repeat(64) },
    config: SECRET, now: NOW });
  const serialised = JSON.stringify(handled.body);
  assert.equal(/coastal\.test|enrollment|account|secret|webhook-secret/i.test(serialised), false,
    `the rejection leaks something: ${serialised}`);
});

test('an event type we do not know is not guessed into one we do', () => {
  assert.equal(toInboundEvent({ event_type: 'SOMETHING_NEW' }), null);
  assert.equal(toInboundEvent({}), null);
  assert.equal(toInboundEvent({ event_type: 'EMAIL_REPLY' })!.eventType, 'REPLIED');
  assert.equal(toInboundEvent({ event_type: 'email_reply' })!.eventType, 'REPLIED');
  assert.equal(toInboundEvent({ event_type: 'LEAD_UNSUBSCRIBED' })!.eventType, 'UNSUBSCRIBED');
});

test('an unhandled event type is accepted once rather than retried forever', async () => {
  const { rawBody, headers } = signed({ event_type: 'SOMETHING_NEW' });
  const handled = await handleSmartleadWebhook({
    rawBody, headers, config: SECRET, now: NOW,
    ingest: async () => { throw new Error('must not be called'); } });
  assert.equal(handled.status, 202);
  assert.equal(handled.body.outcome, 'EVENT_TYPE_NOT_HANDLED');
});

test('the provider’s own event id carries through, so a retry applies once', async () => {
  const event = toInboundEvent({
    event_type: 'EMAIL_REPLY', webhook_id: 'wh-77', lead_id: 42,
    lead_email: 'ray@coastal.test', reply_body: 'Sounds interesting, what does it cost?',
    custom_fields: { yad_enrollment_id: '00000000-0000-0000-0000-000000000001' },
  })!;
  assert.equal(event.providerEventId, 'wh-77');
  assert.equal(event.providerLeadId, '42');
  assert.equal(event.enrollmentId, '00000000-0000-0000-0000-000000000001');
  assert.match(event.replyText!, /what does it cost/);

  // And the handler passes the duplicate verdict straight through.
  const { rawBody, headers } = signed({ event_type: 'EMAIL_REPLY', webhook_id: 'wh-77' });
  const handled = await handleSmartleadWebhook({
    rawBody, headers, config: SECRET, now: NOW,
    ingest: async () => ({
      ok: true, duplicate: true, enrollmentId: null, accountId: null,
      replyClass: null, actions: [], reason: 'event already ingested' }) });
  assert.equal(handled.status, 200);
  assert.equal(handled.body.duplicate, true);
  assert.equal(handled.body.outcome, 'DUPLICATE');
});

test('an HTML-only reply is read as words, not stored as markup', () => {
  const event = toInboundEvent({
    event_type: 'EMAIL_REPLY',
    reply_message: { html: '<div><p>Take me off&nbsp;this list</p></div>' },
  })!;
  assert.equal(/[<>]/.test(event.replyText!), false);
  assert.match(event.replyText!, /Take me off/);
});

test('a body that is not JSON is refused after the signature, not before', async () => {
  const rawBody = 'not json at all';
  const headers = {
    'x-smartlead-signature': signSmartleadBody(rawBody, TIMESTAMP, SECRET.secret!),
    'x-smartlead-timestamp': TIMESTAMP,
  };
  const handled = await handleSmartleadWebhook({ rawBody, headers, config: SECRET, now: NOW });
  assert.equal(handled.status, 400);
  assert.equal(handled.body.outcome, 'BODY_NOT_JSON');
});

test('an event that matches no enrollment is accepted without saying so', async () => {
  const { rawBody, headers } = signed({ event_type: 'EMAIL_REPLY', lead_email: 'nobody@nowhere.test' });
  const handled = await handleSmartleadWebhook({
    rawBody, headers, config: SECRET, now: NOW,
    ingest: async () => ({
      ok: false, duplicate: false, enrollmentId: null, accountId: null, replyClass: null,
      actions: [], reason: 'no enrollment matched this event' }) });
  assert.equal(handled.status, 202, 'an uncorrelated event should not be retried forever');
  assert.equal(handled.body.outcome, 'NOT_CORRELATED');
  assert.equal(/no enrollment/.test(JSON.stringify(handled.body)), false,
    'the response tells a caller whether an address is in our list');
});

// --- Twilio Lookup: every type in the provider's vocabulary -------------------

test('every line type the provider can return maps to something we chose', async () => {
  // Twilio's documented vocabulary. A value we have not seen becomes UNKNOWN; none
  // of them is rounded up to a handset we cannot prove.
  const expected: [string, string, string][] = [
    ['landline', 'LANDLINE', 'landline'],
    ['mobile', 'MOBILE', 'mobile'],
    ['fixedVoip', 'FIXED_VOIP', 'voip'],
    ['nonFixedVoip', 'NON_FIXED_VOIP', 'voip'],
    ['tollFree', 'TOLL_FREE', 'toll_free'],
    // A follow-me service is not a handset, and a pager is not either.
    ['personal', 'PERSONAL', 'unknown'],
    ['premium', 'PREMIUM', 'unknown'],
    ['sharedCost', 'SHARED_COST', 'unknown'],
    ['uan', 'UNIVERSAL_ACCESS', 'unknown'],
    ['voicemail', 'VOICEMAIL', 'unknown'],
    ['pager', 'PAGER', 'unknown'],
    ['unknown', 'UNKNOWN', 'unknown'],
    ['someNewTypeTwilioAdds', 'UNKNOWN', 'unknown'],
  ];
  for (const [provider, normalized, endpointValue] of expected) {
    assert.equal(normalizeLineType(provider), normalized, `provider type ${provider}`);
    assert.equal(endpointLineTypeFor(normalizeLineType(provider) as never), endpointValue,
      `endpoint projection for ${provider}`);
  }
});

test('a screened line type reaches the thing that decides whether we may dial', async () => {
  const { accountId, endpointId } = await seedEndpoint('MOBILE_UNKNOWN_USE');

  const adapter = createTwilioLookupAdapter({
    config: LOOKUP,
    transport: async () => ({
      ok: true, status: 200,
      json: async () => ({
        phone_number: '+19045550177', valid: true,
        line_type_intelligence: { type: 'mobile', carrier_name: 'Verizon' },
      }),
    }),
  });
  const result = await adapter.screen({ phone: '+19045550177', endpointId });
  assert.equal(result.normalizedLineType, 'MOBILE');

  // The screen is only useful if channel eligibility can see it.
  const { rows } = await query<{ line_type: string; line_type_source: string }>(
    'select line_type, line_type_source from contact_endpoints where endpoint_id = $1',
    [endpointId]);
  assert.equal(rows[0]!.line_type, 'mobile',
    'the screened type never reached the endpoint the policy reads');
  assert.equal(rows[0]!.line_type_source, 'TWILIO_LOOKUP_V2');
  void accountId;
});

test('a failed screen never overwrites a line type we already knew', async () => {
  const { endpointId } = await seedEndpoint('DIRECT_BUSINESS_LINE');
  await query(
    `update contact_endpoints set line_type = 'landline', line_type_source = 'TWILIO_LOOKUP_V2'
      where endpoint_id = $1`, [endpointId]);

  const adapter = createTwilioLookupAdapter({
    config: LOOKUP,
    transport: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  const result = await adapter.screen({ phone: '+19045550177', endpointId });
  assert.equal(result.status, 'PROVIDER_ERROR');
  assert.equal(result.normalizedLineType, 'UNKNOWN');

  const { rows } = await query<{ line_type: string }>(
    'select line_type from contact_endpoints where endpoint_id = $1', [endpointId]);
  assert.equal(rows[0]!.line_type, 'landline',
    'an outage erased a line type we had already established');
});

test('each provider failure maps to the status that describes it', async () => {
  const cases: [number, string][] = [
    [401, 'AUTH_FAILED'], [403, 'AUTH_FAILED'], [429, 'RATE_LIMITED'],
    [404, 'INVALID_NUMBER'], [500, 'PROVIDER_ERROR'], [502, 'PROVIDER_ERROR'],
  ];
  for (const [status, expected] of cases) {
    const adapter = createTwilioLookupAdapter({
      config: LOOKUP,
      transport: async () => ({ ok: false, status, json: async () => ({}) }),
    });
    const result = await adapter.screen({ phone: '+1904555018' + (status % 10) });
    assert.equal(result.status, expected, `HTTP ${status}`);
    assert.equal(result.normalizedLineType, 'UNKNOWN',
      `HTTP ${status} produced a line type`);
  }
});

test('carrier data missing for a country is not the same as a known unknown', async () => {
  // Twilio answers 200 with an error_code inside the field. Recording that as a
  // success caches a non-answer for the whole refresh window.
  const adapter = createTwilioLookupAdapter({
    config: LOOKUP,
    transport: async () => ({
      ok: true, status: 200,
      json: async () => ({
        phone_number: '+61255501234', valid: true,
        line_type_intelligence: { error_code: 60600 },
      }),
    }),
  });
  const result = await adapter.screen({ phone: '+61255501234' });
  assert.equal(result.status, 'UNSUPPORTED_COVERAGE');
  assert.equal(result.normalizedLineType, 'UNKNOWN');
  assert.equal(result.errorCode, 'PROVIDER_60600');

  // And it is not served back out of the cache as though it were an answer.
  let calls = 0;
  const again = createTwilioLookupAdapter({
    config: LOOKUP,
    transport: async () => {
      calls += 1;
      return { ok: true, status: 200,
        json: async () => ({ phone_number: '+61255501234', valid: true,
                             line_type_intelligence: { error_code: 60600 } }) };
    },
  });
  await again.screen({ phone: '+61255501234' });
  assert.equal(calls, 1, 'a non-answer was cached as if it were a result');
});

test('a successful type=unknown is cached, because asking again will not help', async () => {
  let calls = 0;
  const adapter = createTwilioLookupAdapter({
    config: LOOKUP,
    transport: async () => {
      calls += 1;
      return { ok: true, status: 200,
        json: async () => ({ phone_number: '+19045550199', valid: true,
                             line_type_intelligence: { type: 'unknown' } }) };
    },
  });
  const first = await adapter.screen({ phone: '+19045550199' });
  assert.equal(first.status, 'SUCCESS');
  assert.equal(first.normalizedLineType, 'UNKNOWN');
  const second = await adapter.screen({ phone: '+19045550199' });
  assert.equal(second.wasCacheHit, true);
  assert.equal(second.costUsd, 0);
  assert.equal(calls, 1);
});
