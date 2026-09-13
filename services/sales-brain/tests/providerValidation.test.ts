import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import {
  validateCalcom, validateDataForSeo, validateSmartlead, validateTwilio,
  validateApprovedCallerIds, validateDncProvider, validateAllProviders,
  type Transport,
} from '../src/providers/validation.js';

/**
 * Provider validation.
 * Authority: CLAUDE-EXTERNAL-BLOCKERS-CURRENT.md §8.
 *
 * Each validator answers two questions separately, because they fail differently: is
 * the credential good, and does the thing it points at exist. "Connected" for a key
 * pointing at a deleted campaign is how a pilot finds out on a live call.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

function transport(routes: Record<string, { ok?: boolean; status?: number; body?: unknown }>): Transport {
  return async (url) => {
    const match = Object.keys(routes).find((pattern) => url.includes(pattern));
    const route = match ? routes[match]! : { ok: false, status: 404, body: {} };
    return {
      ok: route.ok !== false, status: route.status ?? 200, json: async () => route.body ?? {},
    };
  };
}

// --- Cal.com -------------------------------------------------------------------

test('Cal.com without configuration names every value it needs', async () => {
  const result = await validateCalcom({ env: {} as NodeJS.ProcessEnv });
  assert.equal(result.status, 'MISSING_CONFIG');
  assert.deepEqual(result.missing,
    ['CALCOM_API_KEY', 'CALCOM_EVENT_TYPE_ID', 'BOOKING_CALENDAR_UPN']);
});

test('an authenticated Cal.com key pointing at a missing event type is not connected', async () => {
  const result = await validateCalcom({
    env: { CALCOM_API_KEY: 'k', CALCOM_EVENT_TYPE_ID: '999',
           BOOKING_CALENDAR_UPN: 'michael@youraidepartment.ai' } as NodeJS.ProcessEnv,
    transport: transport({ '/me': { ok: true, body: {} } }),
  });
  assert.equal(result.status, 'ENTITY_NOT_FOUND');
  const eventType = result.checks.find((check) => check.id === 'event_type')!;
  assert.match(eventType.detail, /books nothing/);
});

test('a rejected Cal.com key is reported as an auth failure, not as unreachable', async () => {
  const result = await validateCalcom({
    env: { CALCOM_API_KEY: 'bad', CALCOM_EVENT_TYPE_ID: '1',
           BOOKING_CALENDAR_UPN: 'x@y.z' } as NodeJS.ProcessEnv,
    transport: transport({ '/me': { ok: false, status: 401 } }),
  });
  assert.equal(result.status, 'AUTH_FAILED');
});

test('a valid Cal.com setup reports the event type, its length and its location', async () => {
  const result = await validateCalcom({
    env: { CALCOM_API_KEY: 'k', CALCOM_EVENT_TYPE_ID: '42',
           BOOKING_CALENDAR_UPN: 'michael@youraidepartment.ai' } as NodeJS.ProcessEnv,
    transport: transport({
      '/me': { ok: true, body: {} },
      '/event-types/42': { ok: true, body: { data: {
        title: 'YAD 15-Minute AI Strategy Call', lengthInMinutes: 15,
        locations: [{ type: 'integrations:daily' }] } } },
    }),
  });
  assert.equal(result.status, 'OK');
  assert.match(result.checks.find((check) => check.id === 'event_type')!.detail,
    /15-Minute AI Strategy Call, 15 minutes/);
});

test('a Cal.com event type of the wrong length is a configuration mistake worth naming', async () => {
  const result = await validateCalcom({
    env: { CALCOM_API_KEY: 'k', CALCOM_EVENT_TYPE_ID: '42',
           BOOKING_CALENDAR_UPN: 'x@y.z' } as NodeJS.ProcessEnv,
    transport: transport({
      '/me': { ok: true, body: {} },
      '/event-types/42': { ok: true, body: { data: { lengthInMinutes: 60,
        locations: [{ type: 'integrations:daily' }] } } },
    }),
  });
  assert.equal(result.status, 'ENTITY_NOT_FOUND');
  assert.match(result.checks.find((check) => check.id === 'event_length')!.detail,
    /60 minutes; the strategy call is 15/);
});

test('a Cal.com event type with no video location has nowhere to meet', async () => {
  const result = await validateCalcom({
    env: { CALCOM_API_KEY: 'k', CALCOM_EVENT_TYPE_ID: '42',
           BOOKING_CALENDAR_UPN: 'x@y.z' } as NodeJS.ProcessEnv,
    transport: transport({
      '/me': { ok: true, body: {} },
      '/event-types/42': { ok: true, body: { data: { lengthInMinutes: 15, locations: [] } } },
    }),
  });
  assert.equal(result.status, 'MISSING_CONFIG');
  assert.ok(result.missing.includes('Cal Video location'));
});

// --- DataForSEO -------------------------------------------------------------------

test('the DataForSEO governance review is its own gate, separate from the credential', async () => {
  const result = await validateDataForSeo({
    env: { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p' } as NodeJS.ProcessEnv,
    transport: transport({ '/appendix/user_data': { ok: true,
      body: { tasks: [{ result: [{ money: { balance: 12.5 } }] }] } } }),
  });
  assert.equal(result.status, 'MISSING_CONFIG');
  const governance = result.checks.find((check) => check.id === 'governance_review')!;
  assert.match(governance.detail, /may not run even/);
  // The credential itself did validate, and says so separately.
  assert.equal(result.checks.find((check) => check.id === 'credential')!.status, 'OK');
});

test('a DataForSEO account with no balance is reported, not treated as ready', async () => {
  const result = await validateDataForSeo({
    env: { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p',
           DATAFORSEO_GOVERNANCE_REVIEWED: 'true' } as NodeJS.ProcessEnv,
    transport: transport({ '/appendix/user_data': { ok: true,
      body: { tasks: [{ result: [{ money: { balance: 0 } }] }] } } }),
  });
  assert.equal(result.status, 'MISSING_CONFIG');
  assert.match(result.checks.find((check) => check.id === 'balance')!.detail, /no balance/);
});

// --- Smartlead ---------------------------------------------------------------------

test('a Smartlead key linked to a deleted campaign is not connected', async () => {
  await query(
    `insert into email_campaigns (name, status, provider_campaign_id)
     values ('Cold sequence', 'ACTIVE', '777')`);
  const result = await validateSmartlead({
    env: { SMARTLEAD_API_KEY: 'k' } as NodeJS.ProcessEnv,
    transport: transport({ '/campaigns': { ok: true, body: [{ id: 1, name: 'Something else' }] } }),
  });
  assert.equal(result.status, 'ENTITY_NOT_FOUND');
  assert.match(result.checks.find((check) => check.id === 'campaign_links')!.detail,
    /777 which do not exist/);
});

test('a Smartlead key with every linked campaign present is connected', async () => {
  await query(
    `insert into email_campaigns (name, status, provider_campaign_id)
     values ('Cold sequence', 'ACTIVE', '777')`);
  const result = await validateSmartlead({
    env: { SMARTLEAD_API_KEY: 'k' } as NodeJS.ProcessEnv,
    transport: transport({ '/campaigns': { ok: true, body: [{ id: 777, name: 'Cold sequence' }] } }),
  });
  assert.equal(result.status, 'OK');
});

test('a Smartlead key with nothing linked says nothing can be sent', async () => {
  const result = await validateSmartlead({
    env: { SMARTLEAD_API_KEY: 'k' } as NodeJS.ProcessEnv,
    transport: transport({ '/campaigns': { ok: true, body: [] } }),
  });
  assert.equal(result.status, 'NOT_APPLICABLE');
  assert.match(result.checks.find((check) => check.id === 'campaign_links')!.detail,
    /nothing can be sent/);
});

// --- Twilio and the caller ID -------------------------------------------------------

test('Twilio validation checks the account, its status and who owns the caller ID', async () => {
  const result = await validateTwilio({
    env: { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't',
           OUTBOUND_APPROVED_CALLER_IDS: '+19046829345' } as NodeJS.ProcessEnv,
    transport: transport({
      '/Accounts/AC1.json': { ok: true, body: { status: 'active', friendly_name: 'YAD' } },
      '/IncomingPhoneNumbers.json': { ok: true,
        body: { incoming_phone_numbers: [{ phone_number: '+19046829345' }] } },
    }),
  });
  assert.equal(result.status, 'OK');
  assert.match(result.checks.find((check) => check.id === 'caller_id_ownership')!.detail,
    /belongs to this Twilio account/);
});

test('a caller ID that is not on the account is refused', async () => {
  const result = await validateTwilio({
    env: { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't',
           OUTBOUND_APPROVED_CALLER_IDS: '+19045550100' } as NodeJS.ProcessEnv,
    transport: transport({
      '/Accounts/AC1.json': { ok: true, body: { status: 'active' } },
      '/IncomingPhoneNumbers.json': { ok: true,
        body: { incoming_phone_numbers: [{ phone_number: '+19046829345' }] } },
    }),
  });
  assert.equal(result.status, 'ENTITY_NOT_FOUND');
  assert.match(result.checks.find((check) => check.id === 'caller_id_ownership')!.detail,
    /not a number on this Twilio account/);
});

test('a suspended Twilio account cannot place a call', async () => {
  const result = await validateTwilio({
    env: { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't',
           OUTBOUND_APPROVED_CALLER_IDS: '+19046829345' } as NodeJS.ProcessEnv,
    transport: transport({
      '/Accounts/AC1.json': { ok: true, body: { status: 'suspended' } },
      '/IncomingPhoneNumbers.json': { ok: true, body: { incoming_phone_numbers: [] } },
    }),
  });
  assert.equal(result.status, 'AUTH_FAILED');
  assert.match(result.checks.find((check) => check.id === 'account_status')!.detail, /suspended/);
});

test('caller ID configuration catches the mistakes that make the rule unenforceable', () => {
  assert.equal(validateApprovedCallerIds({} as NodeJS.ProcessEnv)[0]!.status, 'MISSING_CONFIG');
  assert.match(validateApprovedCallerIds(
    { OUTBOUND_APPROVED_CALLER_IDS: 'the main line' } as NodeJS.ProcessEnv)[0]!.detail,
    /Not a dialable number/);

  // A long list of caller IDs is what number rotation looks like.
  const rotating = validateApprovedCallerIds({
    OUTBOUND_APPROVED_CALLER_IDS: '+19041110000,+19042220000,+19043330000,+19044440000',
  } as NodeJS.ProcessEnv)[0]!;
  assert.equal(rotating.status, 'MISSING_CONFIG');
  assert.match(rotating.detail, /Rotating numbers to simulate proximity is not permitted/);

  assert.equal(validateApprovedCallerIds(
    { OUTBOUND_APPROVED_CALLER_IDS: '+19046829345' } as NodeJS.ProcessEnv)[0]!.status, 'OK');
});

// --- DNC ----------------------------------------------------------------------------

test('DNC validation reports the provider, the credential, the subscription and the snapshot', async () => {
  const bare = await validateDncProvider({ env: {} as NodeJS.ProcessEnv });
  assert.equal(bare.status, 'MISSING_CONFIG');
  assert.ok(bare.missing.includes('DNC_PROVIDER'));

  const named = await validateDncProvider({
    env: { DNC_PROVIDER: 'ftc_national_dnc' } as NodeJS.ProcessEnv });
  assert.equal(named.status, 'MISSING_CONFIG');
  const snapshot = named.checks.find((check) => check.id === 'snapshot')!;
  assert.equal(snapshot.status, 'ENTITY_NOT_FOUND');
  assert.match(snapshot.detail, /fails closed/);
});

// --- the whole set -------------------------------------------------------------------

test('validating everything on this machine reports every provider and no secret', async () => {
  const results = await validateAllProviders({
    env: { CALCOM_API_KEY: 'sk-should-not-appear' } as NodeJS.ProcessEnv });
  assert.deepEqual(results.map((result) => result.provider),
    ['calcom', 'dataforseo', 'smartlead', 'twilio_voice', 'dnc']);
  assert.equal(results.every((result) => result.status !== 'OK'), true,
    'nothing is configured on this machine, and nothing claims to be');
  assert.equal(JSON.stringify(results).includes('sk-should-not-appear'), false);
});
