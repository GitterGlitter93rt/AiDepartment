import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { upsertAccount, upsertEndpoint } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { mergeAccounts } from '../src/domain/merge.js';
import {
  resolveInboundMode, spokenAge, type InboundResolution,
} from '../src/inbound/resolver.js';
import {
  EVIDENCE_RULES, canEstablishCallback, evidenceRank, evidenceRule, isFresh,
} from '../src/inbound/evidence.js';

/**
 * Deterministic inbound mode resolution.
 * Authority: YAD-VOICE-INBOUND-OUTBOUND-ROUTING-AUTHORITY.md SS1, SS4, SS5, SS6.
 *
 * The model never answers the question this module answers, so every branch of it
 * has to be provable here. The bias throughout is towards INBOUND_GENERAL: greeting
 * a stranger as somebody we know is a lie about a person, and treating a known
 * prospect as a stranger is a wasted sentence.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

const NOW = new Date('2026-09-10T15:00:00Z');
let sequence = 0;

interface Fixture {
  accountId: string;
  endpointId: string;
  phone: string;
  repId: string;
}

/** One Account with a main line, and a rep who owns it. */
async function seedAccount(name: string, options: {
  phone?: string; claimed?: boolean; city?: string; postalCode?: string;
} = {}): Promise<Fixture> {
  sequence += 1;
  const phone = options.phone ?? `904-555-${String(1000 + sequence).slice(-4)}`;
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name,
      website: `https://${name.toLowerCase().replace(/\W+/g, '')}${sequence}.invalid`,
      phone, city: options.city ?? 'Jacksonville', state: 'FL',
      postalCode: options.postalCode ?? '32256',
    }, { discoverySource: 'inbound-test' }));
  const rep = await makeUser(`Inbound Rep ${sequence}`);
  if (options.claimed !== false) await claimAccount(accountId, rep);
  const { rows } = await query<{ endpoint_id: string }>(
    `select endpoint_id from contact_endpoints
      where account_id = $1 and endpoint_type = 'PHONE' order by created_at limit 1`,
    [accountId]);
  return { accountId, endpointId: rows[0]!.endpoint_id, phone, repId: rep.userId };
}

/** An outbound attempt, with the eligibility decision the schema requires. */
async function recordOutboundAttempt(fixture: Fixture, input: {
  minutesAgo: number; disposition?: string | null;
}): Promise<void> {
  const { rows } = await query<{ decision_id: string }>(
    `insert into channel_eligibility_decisions (endpoint_id, account_id, channel, decision,
                                                reason_codes, policy_version)
     values ($1, $2, 'HUMAN_MANUAL_CALL', 'ALLOW', array['TEST'], 'v1')
     returning decision_id`, [fixture.endpointId, fixture.accountId]);
  await query(
    `insert into contact_attempts (account_id, endpoint_id, actor_user_id, channel,
                                   eligibility_decision_id, started_at, completed_at,
                                   disposition)
     values ($1, $2, $3, 'HUMAN_MANUAL_CALL', $4,
             $5::timestamptz - ($6::text || ' minutes')::interval,
             case when $7::text is null then null else
               $5::timestamptz - ($6::text || ' minutes')::interval end,
             $7)`,
    [fixture.accountId, fixture.endpointId, fixture.repId, rows[0]!.decision_id,
     NOW, String(input.minutesAgo), input.disposition ?? null]);
}

async function resolve(phone: string, now = NOW): Promise<InboundResolution> {
  return resolveInboundMode({ fromNumber: phone, toNumber: '+19046829345', now });
}

// --- the ladder itself ------------------------------------------------------------

test('the evidence ladder is ordered strongest first and every rule explains itself', () => {
  const strengths = EVIDENCE_RULES.map((rule) => rule.strength);
  const order = ['HIGHEST', 'MEDIUM', 'WEAK'];
  let seen = 0;
  for (const strength of strengths) {
    const rank = order.indexOf(strength);
    assert.ok(rank >= seen, `${strength} appears after a weaker rule`);
    seen = rank;
  }
  for (const rule of EVIDENCE_RULES) {
    assert.ok(rule.rationale.length > 40, `${rule.kind} has no rationale worth reading`);
  }
  // Only the top two strengths can put a call into callback mode.
  assert.equal(canEstablishCallback('REQUESTED_CALLBACK'), true);
  assert.equal(canEstablishCallback('RECENT_OUTBOUND_ATTEMPT'), true);
  assert.equal(canEstablishCallback('STALE_OUTBOUND_ATTEMPT'), false);
  assert.equal(canEstablishCallback('FUZZY_COMPANY_ASSOCIATION'), false);
  assert.ok(evidenceRank('REQUESTED_CALLBACK') < evidenceRank('RECENT_OUTBOUND_ATTEMPT'));
});

test('a signal with no expiry never goes stale, and one with an expiry does', () => {
  const longAgo = new Date(NOW.getTime() - 400 * 86_400_000);
  assert.equal(evidenceRule('ACTIVE_OPPORTUNITY').freshnessHours, null);
  assert.equal(isFresh('ACTIVE_OPPORTUNITY', longAgo, NOW), true);
  assert.equal(isFresh('RECENT_OUTBOUND_ATTEMPT', longAgo, NOW), false);
  assert.equal(isFresh('RECENT_OUTBOUND_ATTEMPT',
    new Date(NOW.getTime() - 3_600_000), NOW), true);
});

// --- the freshness ladder, measured at each step ----------------------------------

test('a missed call becomes a callback for two days and then stops', async () => {
  const cases: [number, string, string][] = [
    [5, 'INBOUND_CALLBACK', 'five minutes'],
    [60, 'INBOUND_CALLBACK', 'one hour'],
    [60 * 24, 'INBOUND_CALLBACK', 'one day'],
    [60 * 47, 'INBOUND_CALLBACK', 'just inside two days'],
    [60 * 49, 'INBOUND_GENERAL', 'just outside two days'],
    [60 * 24 * 7, 'INBOUND_GENERAL', 'seven days'],
    [60 * 24 * 30, 'INBOUND_GENERAL', 'thirty days'],
  ];
  const problems: string[] = [];
  for (const [minutesAgo, expected, label] of cases) {
    await resetDatabase();
    const fixture = await seedAccount('Freshness Co');
    await recordOutboundAttempt(fixture, { minutesAgo, disposition: 'NO_ANSWER' });
    const resolution = await resolve(fixture.phone);
    if (resolution.mode !== expected) {
      problems.push(`${label}: ${resolution.mode}, expected ${expected} `
        + `(evidence ${resolution.decidingEvidence})`);
    }
  }
  assert.deepEqual(problems, []);
});

test('a call that connected stays a callback for a week', async () => {
  const cases: [number, string][] = [
    [60 * 24 * 3, 'INBOUND_CALLBACK'],
    [60 * 24 * 6, 'INBOUND_CALLBACK'],
    [60 * 24 * 8, 'INBOUND_GENERAL'],
  ];
  const problems: string[] = [];
  for (const [minutesAgo, expected] of cases) {
    await resetDatabase();
    const fixture = await seedAccount('Connected Co');
    await recordOutboundAttempt(fixture, { minutesAgo, disposition: 'GATEKEEPER' });
    const resolution = await resolve(fixture.phone);
    if (resolution.mode !== expected) {
      problems.push(`${minutesAgo / 1440} days: ${resolution.mode}, expected ${expected}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('an ancient missed call does not make a number a callback for ever', async () => {
  const fixture = await seedAccount('Ancient Attempt Co');
  await recordOutboundAttempt(fixture, { minutesAgo: 60 * 24 * 240, disposition: 'NO_ANSWER' });

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_GENERAL');
  assert.ok(resolution.reasonCodes.includes('known_account_no_fresh_relationship'));
  assert.match(resolution.ambiguityReason ?? '', /outside the window/);
  // And it says nothing about the company.
  assert.equal(resolution.companyName, null);
  assert.deepEqual(resolution.facts, []);
});

test('an old relationship with an open opportunity is still a callback', async () => {
  const fixture = await seedAccount('Old But Live Co');
  await recordOutboundAttempt(fixture, { minutesAgo: 60 * 24 * 300, disposition: 'NO_ANSWER' });
  await query(
    `insert into opportunities (account_id, owner_user_id, title, stage, problem_summary,
                                source_channel, created_at)
     values ($1, $2, 'Old But Live', 'DISCOVERY',
             'They lose calls every afternoon while the crew is out on jobs.',
             'human_rep', now() - interval '200 days')`,
    [fixture.accountId, fixture.repId]);

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_CALLBACK');
  assert.equal(resolution.decidingEvidence, 'ACTIVE_OPPORTUNITY');
  assert.equal(resolution.nextAction, 'ROUTE_TO_OWNER');
});

test('an old call with a meeting in the diary is still a callback', async () => {
  const fixture = await seedAccount('Meeting Ahead Co');
  await recordOutboundAttempt(fixture, { minutesAgo: 60 * 24 * 120, disposition: 'NO_ANSWER' });
  await query(
    `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, meeting_type,
                                   idempotency_key, requested_start, requested_end, status,
                                   provider, provider_event_id, confirmed_at, created_by)
     values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'inbound-1',
             $3::timestamptz + interval '2 days',
             $3::timestamptz + interval '2 days' + interval '15 minutes',
             'CONFIRMED', 'calcom', 'evt-inbound-1', now(), $2)`,
    [fixture.accountId, fixture.repId, NOW]);

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_CALLBACK');
  assert.equal(resolution.decidingEvidence, 'CONFIRMED_UPCOMING_MEETING');
  assert.equal(resolution.nextAction, 'CONFIRM_EXISTING_MEETING');
});

test('a meeting that has already passed does not make every later call a callback',
  async () => {
    const fixture = await seedAccount('Past Meeting Co');
    await query(
      `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, meeting_type,
                                     idempotency_key, requested_start, requested_end, status,
                                     provider, provider_event_id, confirmed_at, created_by)
       values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'inbound-past',
               $3::timestamptz - interval '90 days',
               $3::timestamptz - interval '90 days' + interval '15 minutes',
               'CONFIRMED', 'calcom', 'evt-past', now(), $2)`,
      [fixture.accountId, fixture.repId, NOW]);

    const resolution = await resolve(fixture.phone);
    assert.equal(resolution.mode, 'INBOUND_GENERAL',
      'a meeting three months in the past kept the number in callback mode');
  });

test('a requested callback works before and after the time they asked for', async () => {
  const cases: [string, string][] = [
    ['-2 hours', 'INBOUND_CALLBACK'],
    ['+2 hours', 'INBOUND_CALLBACK'],
    ['-40 days', 'INBOUND_GENERAL'],
  ];
  const problems: string[] = [];
  for (const [offset, expected] of cases) {
    await resetDatabase();
    const fixture = await seedAccount('Requested Callback Co');
    await query(
      `insert into follow_ups (account_id, owner_user_id, followup_type, due_at, status,
                               prospect_requested, context)
       values ($1, $2, 'CALLBACK', $3::timestamptz + $4::interval, 'OPEN', true,
               'He asked me to try him after three.')`,
      [fixture.accountId, fixture.repId, NOW, offset]);
    const resolution = await resolve(fixture.phone);
    if (resolution.mode !== expected) {
      problems.push(`${offset}: ${resolution.mode}, expected ${expected}`);
    }
    if (expected === 'INBOUND_CALLBACK') {
      if (resolution.nextAction !== 'ACKNOWLEDGE_REQUESTED_CALLBACK') {
        problems.push(`${offset}: next action ${resolution.nextAction}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('a positive email reply followed by a call is a callback', async () => {
  const fixture = await seedAccount('Replied Co');
  const { rows: campaign } = await query<{ email_campaign_id: string }>(
    `insert into email_campaigns (name, provider, status)
     values ('inbound test', 'smartlead', 'ACTIVE') returning email_campaign_id`);
  const { rows: enrollment } = await query<{ enrollment_id: string }>(
    `insert into email_enrollments (email_campaign_id, account_id, normalized_email, status)
     values ($1, $2, 'ray@replied.invalid', 'REPLIED') returning enrollment_id`,
    [campaign[0]!.email_campaign_id, fixture.accountId]);
  await query(
    `insert into email_events (enrollment_id, account_id, provider, provider_event_id,
                               event_type, reply_class, occurred_at)
     values ($1, $2, 'smartlead', 'inbound-reply-1', 'REPLIED', 'POSITIVE_INTEREST',
             $3::timestamptz - interval '2 days')`,
    [enrollment[0]!.enrollment_id, fixture.accountId, NOW]);

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_CALLBACK');
  assert.equal(resolution.decidingEvidence, 'POSITIVE_REPLY');
  assert.ok(resolution.facts.some((fact) => fact.key === 'positive_reply'));
});

test('a negative email reply is not a callback signal', async () => {
  const fixture = await seedAccount('Not Interested Co');
  const { rows: campaign } = await query<{ email_campaign_id: string }>(
    `insert into email_campaigns (name, provider, status)
     values ('inbound test 2', 'smartlead', 'ACTIVE') returning email_campaign_id`);
  const { rows: enrollment } = await query<{ enrollment_id: string }>(
    `insert into email_enrollments (email_campaign_id, account_id, normalized_email, status)
     values ($1, $2, 'ray@notinterested.invalid', 'REPLIED') returning enrollment_id`,
    [campaign[0]!.email_campaign_id, fixture.accountId]);
  await query(
    `insert into email_events (enrollment_id, account_id, provider, provider_event_id,
                               event_type, reply_class, occurred_at)
     values ($1, $2, 'smartlead', 'inbound-reply-2', 'REPLIED', 'NOT_INTERESTED',
             $3::timestamptz - interval '1 day')`,
    [enrollment[0]!.enrollment_id, fixture.accountId, NOW]);

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_GENERAL',
    '"not interested" was treated as a reason to greet them as a live prospect');
});

// --- ambiguity ---------------------------------------------------------------------

test('a number that reaches two companies is never attributed to one of them',
  async () => {
    const shared = '904-555-2200';
    await seedAccount('Shared Desk Plumbing', { phone: shared });
    const second = await seedAccount('Shared Desk Roofing');
    await withTransaction((client) => upsertEndpoint(client, {
      accountId: second.accountId, contactId: null, locationId: null, type: 'PHONE',
      rawValue: shared, endpointRole: 'MAIN_BUSINESS_LINE',
      relationshipToPerson: 'COMPANY_ROUTE', qualityState: 'CURRENT_BUSINESS_CONFIRMED',
      source: 'COMPANY_WEBSITE', sourceReference: null, verifiedAt: new Date(),
    }));

    const resolution = await resolve(shared);
    assert.equal(resolution.mode, 'INBOUND_GENERAL');
    assert.equal(resolution.accountId, null, 'one of two companies was named anyway');
    assert.equal(resolution.matchedAccountCount, 2);
    assert.match(resolution.ambiguityReason ?? '', /2 different Accounts/);
    assert.ok(resolution.withheld.some((item) => item.key === 'account_identity'));
  });

test('an unknown number gets general handling and no invented history', async () => {
  await seedAccount('Somebody Else Co');
  const resolution = await resolve('+19045559999');
  assert.equal(resolution.mode, 'INBOUND_GENERAL');
  assert.equal(resolution.accountId, null);
  assert.equal(resolution.companyName, null);
  assert.deepEqual(resolution.facts, []);
  assert.deepEqual(resolution.reasonCodes, ['caller_number_not_held']);
  assert.equal(resolution.matchedAccountCount, 0);
});

test('a number is matched on its digits, not on a suffix that happens to line up',
  async () => {
    // 555-0142 is a real endpoint. 1-555-0142 shares its last seven digits and is a
    // different line; a suffix match would treat them as the same number.
    await seedAccount('Suffix Co', { phone: '904-555-0142' });
    const wrong = await resolve('+12105550142');
    assert.equal(wrong.mode, 'INBOUND_GENERAL', 'a different area code matched');
    const right = await resolve('+19045550142');
    assert.equal(right.mode, 'INBOUND_GENERAL');
    // Right number, no relationship signal yet -- but it did find the Account.
    assert.equal(right.matchedAccountCount, 1);
  });

test('the country code is not required to agree', async () => {
  const fixture = await seedAccount('Country Code Co', { phone: '904-555-2300' });
  await recordOutboundAttempt(fixture, { minutesAgo: 30, disposition: 'NO_ANSWER' });
  for (const form of ['+19045552300', '9045552300', '(904) 555-2300', '904.555.2300']) {
    const resolution = await resolve(form);
    assert.equal(resolution.mode, 'INBOUND_CALLBACK', `${form} did not match`);
  }
});

// --- suppression -------------------------------------------------------------------

test('a suppressed company is answered, without a word about our outreach', async () => {
  const fixture = await seedAccount('Suppressed Callback Co');
  await recordOutboundAttempt(fixture, { minutesAgo: 20, disposition: 'DO_NOT_CONTACT' });
  await query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'Asked us to stop.')`,
    [fixture.accountId]);

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_GENERAL',
    'a suppressed company was greeted as a live prospect');
  assert.equal(resolution.suppression, 'ACCOUNT_DNC');
  assert.equal(resolution.nextAction, 'ANSWER_WITHOUT_SALES_CONTEXT');
  assert.equal(resolution.companyName, null, 'the company was named to a suppressed caller');
  assert.deepEqual(resolution.facts, []);
  assert.ok(resolution.withheld.some((item) => item.key === 'outbound_history'));
  assert.ok(resolution.reasonCodes.includes('answered_without_sales_context'));
});

test('suppression outranks an open opportunity', async () => {
  const fixture = await seedAccount('Suppressed With Opportunity Co');
  await query(
    `insert into opportunities (account_id, owner_user_id, title, stage, problem_summary,
                                source_channel)
     values ($1, $2, 'Open', 'DISCOVERY',
             'They lose calls every afternoon while the crew is out.', 'human_rep')`,
    [fixture.accountId, fixture.repId]);
  await query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'Their lawyer wrote to us.')`,
    [fixture.accountId]);

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.suppression, 'ACCOUNT_DNC');
  assert.equal(resolution.mode, 'INBOUND_GENERAL');
  assert.equal(resolution.nextAction, 'ANSWER_WITHOUT_SALES_CONTEXT');
});

test('an endpoint suppression does not silence the whole company', async () => {
  const fixture = await seedAccount('Endpoint Suppressed Co');
  const second = await withTransaction((client) => upsertEndpoint(client, {
    accountId: fixture.accountId, contactId: null, locationId: null, type: 'PHONE',
    rawValue: '904-555-2400', endpointRole: 'DIRECT_BUSINESS_LINE',
    relationshipToPerson: 'DIRECT_CONFIRMED', qualityState: 'DIRECT_BUSINESS_CONFIRMED',
    source: 'COMPANY_WEBSITE', sourceReference: null, verifiedAt: new Date(),
  }));
  await recordOutboundAttempt(fixture, { minutesAgo: 30, disposition: 'NO_ANSWER' });
  await query(
    `insert into suppressions (scope, account_id, endpoint_id, normalized_value,
                               suppression_type, source, reason)
     values ('ENDPOINT', $1, $2, '+19045552400', 'DNC', 'registry', 'On a registry.')`,
    [fixture.accountId, second]);

  // The main line is not the suppressed one, so a callback on it still resolves.
  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_CALLBACK');
  assert.equal(resolution.suppression, 'NONE');
});

// --- wrong numbers -----------------------------------------------------------------

test('a number recorded as wrong carries no company forward', async () => {
  const fixture = await seedAccount('Wrong Number Co');
  await recordOutboundAttempt(fixture, { minutesAgo: 20, disposition: 'WRONG_NUMBER' });
  await query(
    `update contact_endpoints set quality_state = 'WRONG_NUMBER', is_active = false
      where endpoint_id = $1`, [fixture.endpointId]);

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_GENERAL');
  assert.equal(resolution.endpointState, 'WRONG_NUMBER');
  assert.equal(resolution.accountId, null,
    'the company was named to whoever now holds the number');
  assert.equal(resolution.nextAction, 'CONFIRM_WRONG_NUMBER');
  assert.ok(resolution.withheld.some((item) => item.key === 'outbound_history'));
});

test('a wrong number on one endpoint does not kill the company’s other line',
  async () => {
    const fixture = await seedAccount('Two Line Co');
    const direct = await withTransaction((client) => upsertEndpoint(client, {
      accountId: fixture.accountId, contactId: null, locationId: null, type: 'PHONE',
      rawValue: '904-555-2500', endpointRole: 'DIRECT_BUSINESS_LINE',
      relationshipToPerson: 'DIRECT_CONFIRMED', qualityState: 'DIRECT_BUSINESS_CONFIRMED',
      source: 'COMPANY_WEBSITE', sourceReference: null, verifiedAt: new Date(),
    }));
    await recordOutboundAttempt(fixture, { minutesAgo: 30, disposition: 'NO_ANSWER' });
    await query(
      `update contact_endpoints set quality_state = 'WRONG_NUMBER', is_active = false
        where endpoint_id = $1`, [fixture.endpointId]);
    void direct;

    const good = await resolve('904-555-2500');
    assert.equal(good.mode, 'INBOUND_CALLBACK',
      'a wrong number on the main line took the direct line down with it');
    assert.equal(good.endpointState, 'ACTIVE');
  });

// --- merged accounts ----------------------------------------------------------------

test('a number on a merged Account resolves to the survivor', async () => {
  const manager = await makeUser('Merge Manager', 'SALES_MANAGER');
  const survivor = await seedAccount('Survivor Co');
  const merged = await seedAccount('Merged Co', { city: 'Orange Park', postalCode: '32073' });
  await recordOutboundAttempt(merged, { minutesAgo: 30, disposition: 'NO_ANSWER' });

  const result = await mergeAccounts({
    survivingAccountId: survivor.accountId, mergedAccountId: merged.accountId,
    reason: 'Same company, two records.', keepOwnerUserId: survivor.repId,
  }, manager);
  assert.equal(result.ok, true, `merge refused: ${JSON.stringify(result)}`);

  // The endpoint moved to the survivor with everything else, so the number now
  // resolves there -- and the attempt that came with it is still recent.
  const resolution = await resolve(merged.phone);
  assert.equal(resolution.mode, 'INBOUND_CALLBACK');
  assert.equal(resolution.accountId, survivor.accountId,
    'a callback resolved to a tombstone rather than the surviving company');
  assert.equal(resolution.companyName, 'Survivor Co');
  assert.equal(resolution.matchedAccountCount, 1,
    'the tombstone and the survivor were counted as two companies');
});

test('a two-hop merge chain resolves to the last survivor', async () => {
  const manager = await makeUser('Chain Manager', 'SALES_MANAGER');
  const first = await seedAccount('Chain One');
  const second = await seedAccount('Chain Two', { city: 'Orange Park', postalCode: '32073' });
  const third = await seedAccount('Chain Three', { city: 'St. Augustine', postalCode: '32084' });
  await recordOutboundAttempt(first, { minutesAgo: 30, disposition: 'NO_ANSWER' });

  await mergeAccounts({ survivingAccountId: second.accountId,
    mergedAccountId: first.accountId, reason: 'Same company.',
    keepOwnerUserId: second.repId }, manager);
  await mergeAccounts({ survivingAccountId: third.accountId,
    mergedAccountId: second.accountId, reason: 'Also the same company.',
    keepOwnerUserId: third.repId }, manager);

  const resolution = await resolve(first.phone);
  assert.equal(resolution.accountId, third.accountId);
  assert.equal(resolution.companyName, 'Chain Three');
});

test('a suppression on the merged record follows into the survivor’s callbacks',
  async () => {
    const manager = await makeUser('Suppression Merge Manager', 'SALES_MANAGER');
    const survivor = await seedAccount('Clean Survivor');
    const merged = await seedAccount('Suppressed Source',
      { city: 'Orange Park', postalCode: '32073' });
    await recordOutboundAttempt(survivor, { minutesAgo: 20, disposition: 'NO_ANSWER' });
    await query(
      `insert into suppressions (scope, account_id, suppression_type, source, reason)
       values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'Asked us to stop.')`,
      [merged.accountId]);

    const result = await mergeAccounts({
      survivingAccountId: survivor.accountId, mergedAccountId: merged.accountId,
      reason: 'Same company; the suppressed record is the same business.',
      keepOwnerUserId: survivor.repId,
    }, manager);
    assert.equal(result.ok, true, `merge refused: ${JSON.stringify(result)}`);

    const resolution = await resolve(survivor.phone);
    assert.equal(resolution.suppression, 'ACCOUNT_DNC',
      'a merge lost the suppression and the survivor was greeted as a prospect');
    assert.equal(resolution.mode, 'INBOUND_GENERAL');
  });

// --- multi-contact and multi-location ------------------------------------------------

test('a company main line names the company but never the caller', async () => {
  const fixture = await seedAccount('Main Line Co');
  await recordOutboundAttempt(fixture, { minutesAgo: 15, disposition: 'NO_ANSWER' });
  await query(
    `insert into contacts (account_id, full_name, raw_title, role_category,
                           company_relationship, decision_maker_priority)
     values ($1, 'Ray Alvarez', 'Owner', 'owner', 'owner', 1)`, [fixture.accountId]);

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_CALLBACK');
  assert.equal(resolution.contactId, null, 'the main line was attributed to a person');
  assert.equal(resolution.contactName, null);
  assert.ok(resolution.withheld.some((item) => item.key === 'contact_identity'));
  assert.equal(resolution.facts.some((fact) => fact.statement.includes('Ray Alvarez')), false,
    'the owner was named although the main line says nothing about who called');
});

test('a personal line attached to a contact names that contact', async () => {
  const fixture = await seedAccount('Direct Line Co');
  const { rows: contact } = await query<{ contact_id: string }>(
    `insert into contacts (account_id, full_name, raw_title, role_category,
                           company_relationship, decision_maker_priority)
     values ($1, 'Dana Whitfield', 'Owner', 'owner', 'owner', 1) returning contact_id`,
    [fixture.accountId]);
  await withTransaction((client) => upsertEndpoint(client, {
    accountId: fixture.accountId, contactId: contact[0]!.contact_id, locationId: null,
    type: 'PHONE', rawValue: '904-555-2600', endpointRole: 'DIRECT_BUSINESS_LINE',
    relationshipToPerson: 'DIRECT_CONFIRMED', qualityState: 'DIRECT_BUSINESS_CONFIRMED',
    source: 'COMPANY_WEBSITE', sourceReference: null, verifiedAt: new Date(),
  }));
  await recordOutboundAttempt(fixture, { minutesAgo: 15, disposition: 'NO_ANSWER' });

  const resolution = await resolve('904-555-2600');
  assert.equal(resolution.mode, 'INBOUND_CALLBACK');
  assert.equal(resolution.contactName, 'Dana Whitfield');
  assert.ok(resolution.facts.some((fact) => fact.key === 'contact_identity'));
});

test('two locations of one company are one company, not an ambiguity', async () => {
  const fixture = await seedAccount('Two Location Co');
  const { rows: location } = await query<{ location_id: string }>(
    `insert into locations (account_id, name, city, state_region, postal_code,
                            country_code, location_type, is_active)
     values ($1, 'Southside branch', 'Jacksonville', 'FL', '32257', 'US', 'physical', true)
     returning location_id`, [fixture.accountId]);
  await withTransaction((client) => upsertEndpoint(client, {
    accountId: fixture.accountId, contactId: null, locationId: location[0]!.location_id,
    type: 'PHONE', rawValue: '904-555-2700', endpointRole: 'LOCATION_BUSINESS_LINE',
    relationshipToPerson: 'LOCATION_ROUTE', qualityState: 'CURRENT_BUSINESS_CONFIRMED',
    source: 'COMPANY_WEBSITE', sourceReference: null, verifiedAt: new Date(),
  }));
  await recordOutboundAttempt(fixture, { minutesAgo: 15, disposition: 'NO_ANSWER' });

  const resolution = await resolve('904-555-2700');
  assert.equal(resolution.mode, 'INBOUND_CALLBACK');
  assert.equal(resolution.matchedAccountCount, 1);
  assert.equal(resolution.accountId, fixture.accountId);
});

test('one owner with three separate companies is three companies', async () => {
  // The same person, the same mobile, three businesses. The number is ambiguous
  // whatever the graph says about who owns what.
  const mobile = '904-555-2800';
  const first = await seedAccount('Alvarez HVAC');
  for (const name of ['Alvarez Plumbing', 'Alvarez Electric']) {
    const other = await seedAccount(name, { city: 'Orange Park', postalCode: '32073' });
    await withTransaction((client) => upsertEndpoint(client, {
      accountId: other.accountId, contactId: null, locationId: null, type: 'PHONE',
      rawValue: mobile, endpointRole: 'MOBILE_ASSERTED_BUSINESS',
      relationshipToPerson: 'DIRECT_PROVIDER_ASSERTED',
      qualityState: 'PROVIDER_ASSERTED_CURRENT', source: 'PAID_PROVIDER',
      sourceReference: null, verifiedAt: null,
    }));
  }
  await withTransaction((client) => upsertEndpoint(client, {
    accountId: first.accountId, contactId: null, locationId: null, type: 'PHONE',
    rawValue: mobile, endpointRole: 'MOBILE_ASSERTED_BUSINESS',
    relationshipToPerson: 'DIRECT_PROVIDER_ASSERTED',
    qualityState: 'PROVIDER_ASSERTED_CURRENT', source: 'PAID_PROVIDER',
    sourceReference: null, verifiedAt: null,
  }));

  const resolution = await resolve(mobile);
  assert.equal(resolution.mode, 'INBOUND_GENERAL');
  assert.equal(resolution.matchedAccountCount, 3);
  assert.match(resolution.ambiguityReason ?? '', /3 different Accounts/);
});

// --- what the resolution may say --------------------------------------------------

test('nothing in a callback resolution is research, score or hypothesis', async () => {
  const fixture = await seedAccount('Research Leak Co');
  await recordOutboundAttempt(fixture, { minutesAgo: 15, disposition: 'NO_ANSWER' });
  await query(
    `update accounts set manual_tier = 'A', manual_score = 14,
            advertiser_strength = 'STRONG' where account_id = $1`, [fixture.accountId]);
  await query(
    `insert into opportunity_hypotheses (account_id, category, hypothesis_text,
                                         missing_fact_questions, confidence, priority,
                                         generated_by, is_current)
     values ($1, 'after_hours', 'They may be losing after-hours calls.',
             array['Who picks up after five?'], 'unknown', 1, 'deterministic', true)`,
    [fixture.accountId]);
  await query(
    `insert into evidence_records (account_id, category, claim_key, claim_text,
                                   normalized_value, confidence, can_state_as_fact,
                                   source_type)
     values ($1, 'advertising', 'active_google_search_ad',
             'A Google search ad showed their site.', 'yes', 'confirmed', true,
             'serp_observation')`, [fixture.accountId]);

  const resolution = await resolve(fixture.phone);
  // The statements only -- a timestamp legitimately contains digits, and matching a
  // bare number against the whole serialised object tests nothing.
  const spoken = resolution.facts.map((fact) => fact.statement).join(' ');
  for (const forbidden of ['hypothesis', 'after-hours', 'after hours', 'Google', 'ad',
                           'Tier', 'score', 'STRONG', 'advertis']) {
    assert.equal(spoken.toLowerCase().includes(forbidden.toLowerCase()), false,
      `a callback fact carries "${forbidden}": ${spoken}`);
  }
  assert.ok(resolution.withheld.some((item) => item.key === 'research_and_hypothesis'));
});

test('a missed call is never described as a conversation', async () => {
  const fixture = await seedAccount('Voicemail Only Co');
  await recordOutboundAttempt(fixture, { minutesAgo: 25, disposition: 'VOICEMAIL' });

  const resolution = await resolve(fixture.phone);
  assert.equal(resolution.mode, 'INBOUND_CALLBACK');
  const spoken = resolution.facts.map((fact) => fact.statement).join(' ');
  assert.equal(/we spoke|we talked|you told us|discussed/i.test(spoken), false,
    `a voicemail was described as a conversation: ${spoken}`);
  assert.ok(resolution.withheld.some((item) => item.key === 'conversation_content'));
});

test('every fact carries how sure we are, and unknown is preferred to inferred',
  async () => {
    const fixture = await seedAccount('Confidence Co');
    await recordOutboundAttempt(fixture, { minutesAgo: 10, disposition: 'NO_ANSWER' });
    const resolution = await resolve(fixture.phone);
    for (const fact of resolution.facts) {
      assert.ok(['OBSERVED', 'INFERRED', 'UNKNOWN'].includes(fact.confidence),
        `${fact.key} has confidence ${fact.confidence}`);
    }
    // Nothing in a callback is inferred: every fact is a row in the database.
    assert.equal(resolution.facts.some((fact) => fact.confidence === 'INFERRED'), false,
      'a callback fact was inferred rather than observed');
    assert.ok(resolution.withheld.length >= 2, 'nothing was declared unknown');
  });

test('the resolution is deterministic: the same inputs give the same answer',
  async () => {
    const fixture = await seedAccount('Deterministic Co');
    await recordOutboundAttempt(fixture, { minutesAgo: 30, disposition: 'NO_ANSWER' });
    const first = await resolve(fixture.phone);
    const second = await resolve(fixture.phone);
    assert.deepEqual(
      { ...first, resolvedAt: '' }, { ...second, resolvedAt: '' },
      'two resolutions of one call differed');
  });

test('spoken ages read like a person said them', () => {
  const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
  assert.equal(spokenAge(at(1), NOW), 'a moment ago');
  assert.equal(spokenAge(at(14), NOW), '14 minutes ago');
  assert.equal(spokenAge(at(60), NOW), 'about an hour ago');
  assert.equal(spokenAge(at(60 * 5), NOW), 'about 5 hours ago');
  assert.equal(spokenAge(at(60 * 24), NOW), 'yesterday');
  assert.equal(spokenAge(at(60 * 24 * 3), NOW), '3 days ago');
  assert.equal(spokenAge(at(60 * 24 * 21), NOW), '3 weeks ago');
  assert.equal(spokenAge(at(60 * 24 * 400), NOW), 'a while ago');
  // Never a negative age, whatever the clock does.
  assert.equal(spokenAge(new Date(NOW.getTime() + 60_000), NOW), 'a moment ago');
});
