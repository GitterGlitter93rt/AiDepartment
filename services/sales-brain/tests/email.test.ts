import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount, upsertEndpoint } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { searchProspects } from '../src/domain/search.js';
import { selectEligibleForCampaign, buildExportPayload } from '../src/email/eligibility.js';
import { classifyReply, ingestEvent } from '../src/email/inbound.js';
import { resetDatabase, makeUser } from './helpers.js';

/** Authority: outbound-sales-brain-smartlead-sync-spec.md §20 acceptance tests. */

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function seedAccount(options: {
  name: string; email?: string | null; quality?: string; role?: string;
} ): Promise<string> {
  return withTransaction(async (client) => {
    const { accountId } = await upsertAccount(client, {
      canonicalName: options.name,
      website: `https://${options.name.toLowerCase().replace(/\W+/g, '')}.example.com`,
      phone: '904-555-0100', city: 'Jacksonville', state: 'FL',
    }, { discoverySource: 'test' });
    await client.query(
      `update accounts set research_fresh_until = now() + interval '3 days',
              last_researched_at = now() where account_id = $1`, [accountId]);
    if (options.email) {
      await upsertEndpoint(client, {
        accountId, contactId: null, locationId: null, type: 'EMAIL',
        rawValue: options.email,
        endpointRole: options.role ?? 'DIRECT_PERSON_EMAIL',
        relationshipToPerson: 'UNVERIFIED',
        qualityState: options.quality ?? 'PUBLIC_OBSERVED_CURRENT',
        source: 'COMPANY_WEBSITE', sourceReference: null,
      });
    }
    return accountId;
  });
}

async function makeCampaign(minimumQuality = 'PUBLIC_OBSERVED_CURRENT'): Promise<string> {
  const { rows } = await query<{ email_campaign_id: string }>(
    `insert into email_campaigns (name, minimum_email_quality, status)
     values ('Test campaign', $1, 'ACTIVE') returning email_campaign_id`, [minimumQuality]);
  return rows[0]!.email_campaign_id;
}

async function enroll(campaignId: string, accountId: string, email: string): Promise<string> {
  const { rows } = await query<{ enrollment_id: string }>(
    `insert into email_enrollments (email_campaign_id, account_id, endpoint_id, normalized_email,
                                    provider_lead_id, status)
     select $1, $2, e.endpoint_id, $3, 'lead-1', 'SENT'
       from contact_endpoints e
      where e.account_id = $2 and e.endpoint_type = 'EMAIL' limit 1
     returning enrollment_id`,
    [campaignId, accountId, email]);
  return rows[0]!.enrollment_id;
}

// --- eligibility -------------------------------------------------------------

test('§20.1 an account with an active opportunity is not exported to a cold sequence', async () => {
  const campaign = await makeCampaign();
  const normal = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  const opportunity = await seedAccount({ name: 'Riverbend Air', email: 'riley@riverbend.example.com' });
  const client = await seedAccount({ name: 'Sable Air', email: 'sam@sable.example.com' });
  await query(`update accounts set relationship_state = 'ACTIVE_OPPORTUNITY' where account_id = $1`, [opportunity]);
  await query(`update accounts set relationship_state = 'CLIENT' where account_id = $1`, [client]);

  const report = await selectEligibleForCampaign({
    emailCampaignId: campaign, accountIds: [normal, opportunity, client],
  });

  assert.equal(report.eligible.length, 1);
  assert.equal(report.eligible[0]!.accountId, normal);
  assert.equal(report.shortfallBreakdown['ACTIVE_OPPORTUNITY'], 1);
  assert.equal(report.shortfallBreakdown['CLIENT'], 1);
});

test('a suppressed account is never exported', async () => {
  const rep = await makeUser('Rep A');
  const campaign = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', notes: 'remove us' }, rep);

  const report = await selectEligibleForCampaign({ emailCampaignId: campaign, accountIds: [accountId] });
  assert.equal(report.eligible.length, 0);
  assert.equal(report.shortfallBreakdown['SUPPRESSED'], 1);
});

test('a guessed email is never exported, and the shortfall is reported honestly', async () => {
  const campaign = await makeCampaign();
  const good = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  const guessed = await seedAccount({
    name: 'Riverbend Air', email: 'riley.marsh@riverbend.example.com', quality: 'GUESSED_UNVERIFIED',
  });
  const none = await seedAccount({ name: 'Sable Air', email: null });

  const report = await selectEligibleForCampaign({
    emailCampaignId: campaign, accountIds: [good, guessed, none],
  });

  assert.equal(report.requested, 3);
  assert.equal(report.eligible.length, 1, 'only the verifiable address qualifies');
  assert.equal(report.shortfall, 2);
  assert.equal(report.shortfallBreakdown['GUESSED_EMAIL'], 1);
  assert.equal(report.shortfallBreakdown['NO_ELIGIBLE_EMAIL'], 1);
  // The point: 1 is returned, not 3 padded out with guesses.
});

test('a campaign requiring verified addresses does not accept weaker ones', async () => {
  const campaign = await makeCampaign('PROVIDER_VERIFIED');
  const weak = await seedAccount({
    name: 'Northgate Air', email: 'info@northgate.example.com', quality: 'DOMAIN_VALID_UNVERIFIED',
  });
  const strong = await seedAccount({
    name: 'Riverbend Air', email: 'riley@riverbend.example.com', quality: 'PROVIDER_VERIFIED',
  });

  const report = await selectEligibleForCampaign({
    emailCampaignId: campaign, accountIds: [weak, strong], minimumEmailQuality: 'PROVIDER_VERIFIED',
  });
  assert.equal(report.eligible.length, 1);
  assert.equal(report.eligible[0]!.accountId, strong);
  assert.equal(report.shortfallBreakdown['EMAIL_QUALITY_BELOW_MINIMUM'], 1);
});

test('stale research blocks a personalized export', async () => {
  const campaign = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  await query(`update accounts set research_fresh_until = now() - interval '1 day'`);
  const report = await selectEligibleForCampaign({ emailCampaignId: campaign, accountIds: [accountId] });
  assert.equal(report.shortfallBreakdown['RESEARCH_STALE'], 1);
});

test('the export payload carries correlation ids and nothing internal', async () => {
  const campaign = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  const report = await selectEligibleForCampaign({ emailCampaignId: campaign, accountIds: [accountId] });
  const payload = buildExportPayload(report.eligible[0]!, 'enr-1', campaign, { hook: 'after hours' });

  assert.equal(payload.yad_account_id, accountId);
  assert.equal(payload.yad_enrollment_id, 'enr-1');
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ['dnc', 'transcript', 'prompt', 'suppression', 'revenue']) {
    assert.equal(serialized.includes(forbidden), false, `export must not carry "${forbidden}"`);
  }
});

// --- reply classification ----------------------------------------------------

test('replies classify into the spec classes, defaulting to human review', () => {
  assert.equal(classifyReply('Please unsubscribe me from this list.'), 'UNSUBSCRIBE_OPT_OUT');
  assert.equal(classifyReply('I am out of the office until the 14th.'), 'OUT_OF_OFFICE');
  assert.equal(classifyReply('Dana no longer works at the company.'), 'WRONG_PERSON');
  assert.equal(classifyReply('You should talk to Sarah, she runs operations.'), 'CORRECT_PERSON_REFERRAL');
  assert.equal(classifyReply('Not interested, thanks.'), 'NOT_INTERESTED');
  assert.equal(classifyReply('We already have a system for that.'), 'ALREADY_SOLVED');
  assert.equal(classifyReply('Circle back next quarter.'), 'TIMING_LATER');
  assert.equal(classifyReply('Can you send me some more information?'), 'SEND_INFO');
  assert.equal(classifyReply("Interested — let's set up a time."), 'POSITIVE_INTEREST');
  // Anything ambiguous goes to a person rather than being guessed at.
  assert.equal(classifyReply('Hmm.'), 'OTHER_REVIEW');
});

// --- inbound events ----------------------------------------------------------

test('§20.2 a positive reply pauses the sequence and creates a human task', async () => {
  const rep = await makeUser('Rep A');
  const campaign = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  await claimAccount(accountId, rep);
  const enrollmentId = await enroll(campaign, accountId, 'dana@northgate.example.com');

  const result = await ingestEvent({
    provider: 'smartlead', providerEventId: 'evt-1', eventType: 'REPLIED',
    enrollmentId, replyText: "Interested — let's set up a time to talk.",
  });

  assert.equal(result.replyClass, 'POSITIVE_INTEREST');
  assert.ok(result.actions.includes('sequence_stop_queued'));
  assert.ok(result.actions.includes('human_follow_up_created'));

  const enrollment = await query<{ status: string }>(
    'select status from email_enrollments where enrollment_id = $1', [enrollmentId]);
  assert.equal(enrollment.rows[0]!.status, 'STOPPED', 'contradictory cold outreach stops');

  const account = await query<{ relationship_state: string }>(
    'select relationship_state from accounts where account_id = $1', [accountId]);
  assert.equal(account.rows[0]!.relationship_state, 'POSITIVE_REPLY');

  const followUp = await query<{ owner_user_id: string }>(
    'select owner_user_id from follow_ups where account_id = $1', [accountId]);
  assert.equal(followUp.rows[0]!.owner_user_id, rep.userId, 'it lands with the owner, not a queue');
});

test('§20.3 an unsubscribe reaches suppression and stops the sequence', async () => {
  await makeUser('Manager', 'SALES_MANAGER');
  const campaign = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  const enrollmentId = await enroll(campaign, accountId, 'dana@northgate.example.com');

  const result = await ingestEvent({
    provider: 'smartlead', providerEventId: 'evt-2', eventType: 'UNSUBSCRIBED',
    enrollmentId, email: 'dana@northgate.example.com',
  });
  assert.ok(result.actions.includes('email_suppression_created'));

  const suppression = await query<{ scope: string; suppression_type: string }>(
    'select scope, suppression_type from suppressions where account_id = $1', [accountId]);
  assert.equal(suppression.rows[0]!.scope, 'EMAIL');
  assert.equal(suppression.rows[0]!.suppression_type, 'EMAIL_UNSUBSCRIBE');

  // Email-scoped by default: an email opt-out is not automatically a phone DNC.
  const account = await query<{ is_suppressed: boolean }>(
    'select is_suppressed from accounts where account_id = $1', [accountId]);
  assert.equal(account.rows[0]!.is_suppressed, false,
    'an email unsubscribe does not silently become an account-wide DNC');
});

test('§20.4 a hard bounce kills the address but keeps the Account', async () => {
  const campaign = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  const enrollmentId = await enroll(campaign, accountId, 'dana@northgate.example.com');

  const result = await ingestEvent({
    provider: 'smartlead', providerEventId: 'evt-3', eventType: 'BOUNCED',
    enrollmentId, bounceType: 'hard', email: 'dana@northgate.example.com',
  });
  assert.ok(result.actions.includes('endpoint_marked_hard_bounce'));

  const endpoint = await query<{ quality_state: string; is_active: boolean }>(
    `select quality_state, is_active from contact_endpoints where account_id = $1`, [accountId]);
  assert.equal(endpoint.rows[0]!.quality_state, 'HARD_BOUNCE');
  assert.equal(endpoint.rows[0]!.is_active, false);

  const account = await query<{ is_suppressed: boolean; relationship_state: string }>(
    'select is_suppressed, relationship_state from accounts where account_id = $1', [accountId]);
  assert.equal(account.rows[0]!.is_suppressed, false, 'the company is still a prospect');
  assert.notEqual(account.rows[0]!.relationship_state, 'DISQUALIFIED');
});

test('§20.5 a referral creates no invented email address', async () => {
  await makeUser('Manager', 'SALES_MANAGER');
  const campaign = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  const enrollmentId = await enroll(campaign, accountId, 'dana@northgate.example.com');

  const before = await query<{ n: number }>(
    `select count(*)::int as n from contact_endpoints where account_id = $1`, [accountId]);

  const result = await ingestEvent({
    provider: 'smartlead', providerEventId: 'evt-4', eventType: 'REPLIED',
    enrollmentId, replyText: 'You should talk to Sarah Mills, she runs operations here.',
  });
  assert.equal(result.replyClass, 'CORRECT_PERSON_REFERRAL');
  assert.ok(result.actions.includes('referral_captured_no_email_invented'));
  assert.ok(result.actions.includes('human_follow_up_created'));

  const after = await query<{ n: number }>(
    `select count(*)::int as n from contact_endpoints where account_id = $1`, [accountId]);
  assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'no address was manufactured for Sarah');
});

test('§20.6 a duplicate webhook changes state exactly once', async () => {
  const campaign = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  const enrollmentId = await enroll(campaign, accountId, 'dana@northgate.example.com');

  const first = await ingestEvent({
    provider: 'smartlead', providerEventId: 'evt-5', eventType: 'BOUNCED',
    enrollmentId, bounceType: 'hard',
  });
  const second = await ingestEvent({
    provider: 'smartlead', providerEventId: 'evt-5', eventType: 'BOUNCED',
    enrollmentId, bounceType: 'hard',
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  const events = await query<{ n: number }>('select count(*)::int as n from email_events');
  assert.equal(events.rows[0]!.n, 1);
});

test('an event that matches no enrollment is rejected rather than guessed at', async () => {
  const result = await ingestEvent({
    provider: 'smartlead', providerEventId: 'evt-6', eventType: 'REPLIED',
    email: 'stranger@nowhere.example.com', replyText: 'Who is this?',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /no enrollment matched/);
});

test('a positive reply surfaces on the owner\'s prospect list, not only in email', async () => {
  const rep = await makeUser('Rep A');
  const campaign = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'dana@northgate.example.com' });
  await claimAccount(accountId, rep);
  const enrollmentId = await enroll(campaign, accountId, 'dana@northgate.example.com');
  await ingestEvent({
    provider: 'smartlead', providerEventId: 'evt-7', eventType: 'REPLIED',
    enrollmentId, replyText: 'Yes, interested, please book a time.',
  });

  const positive = await searchProspects({ ownership: 'MINE', myProspectsFilter: 'POSITIVE_REPLY' }, rep);
  assert.equal(positive.total, 1, 'email and phone share one Account memory');
  assert.equal(positive.results[0]!.account_id, accountId);
});

// --- Smartlead export and the durable outbox ---------------------------------

import {
  createSmartleadClient, drainEmailOutbox, enqueueCampaignExport,
  type SmartleadConfig, type Transport as SmartleadTransport,
} from '../src/email/smartlead.js';

const SMARTLEAD_READY: SmartleadConfig = {
  apiKey: 'sk-not-a-real-key', baseUrl: 'https://provider.test/api/v1', enabled: true,
};

function smartleadTransport(options: {
  ok?: boolean; status?: number; body?: unknown; onCall?: (url: string, body: string) => void;
} = {}): SmartleadTransport {
  return async (url, init) => {
    options.onCall?.(url, init.body);
    return {
      ok: options.ok !== false,
      status: options.status ?? 200,
      json: async () => options.body ?? { upload_count: 1, leads: [] },
    };
  };
}

/** Links a campaign to a provider campaign, which the drain requires. */
async function linkProvider(campaignId: string): Promise<void> {
  await query(
    `update email_campaigns set provider_campaign_id = 'prov-1' where email_campaign_id = $1`,
    [campaignId]);
}

test('enrolling queues an export and sends nothing by itself', async () => {
  const campaignId = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'owner@northgate.example.com' });

  const report = await enqueueCampaignExport({ campaignId, accountIds: [accountId] });
  assert.equal(report.enrolled, 1);

  const enrollment = await query(
    `select status, exported_at, provider_lead_id from email_enrollments`);
  assert.equal(enrollment.rows[0]!.status, 'PENDING_EXPORT',
    'a queued export is not an export');
  assert.equal(enrollment.rows[0]!.exported_at, null);

  const outbox = await query(`select operation, status from email_outbox`);
  assert.equal(outbox.rows[0]!.operation, 'EXPORT');
  assert.equal(outbox.rows[0]!.status, 'PENDING');
});

test('the same account is never enrolled twice in one campaign', async () => {
  const campaignId = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'owner@northgate.example.com' });

  await enqueueCampaignExport({ campaignId, accountIds: [accountId] });
  const second = await enqueueCampaignExport({ campaignId, accountIds: [accountId] });

  assert.equal(second.enrolled, 0);
  assert.equal(second.eligible, 0, 'an already-enrolled account is not eligible again');
  assert.ok((second.rejections['ALREADY_ENROLLED'] ?? 0) >= 1,
    'the report says why, rather than showing an unexplained shortfall');
  const rows = await query(`select count(*)::int as n from email_outbox`);
  assert.equal(rows.rows[0]!.n, 1, 'a second enqueue must not queue a second send');
});

test('an outage delays a send and never duplicates one', async () => {
  const campaignId = await makeCampaign();
  await linkProvider(campaignId);
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'owner@northgate.example.com' });
  await enqueueCampaignExport({ campaignId, accountIds: [accountId] });

  let calls = 0;
  const failing = createSmartleadClient({
    config: SMARTLEAD_READY,
    transport: smartleadTransport({ ok: false, status: 503, onCall: () => { calls += 1; } }),
  });
  const first = await drainEmailOutbox({ client: failing });
  assert.equal(first.sent, 0);
  assert.equal(first.failed, 1);
  assert.equal(calls, 1);

  // The row is still pending, but backed off: an immediate re-drain must not retry.
  const immediate = await drainEmailOutbox({ client: failing });
  assert.equal(immediate.sent + immediate.failed, 0, 'a failure backs off rather than hot-looping');
  assert.equal(calls, 1);

  const state = await query(`select status, attempts, last_error from email_outbox`);
  assert.equal(state.rows[0]!.status, 'PENDING');
  assert.equal(state.rows[0]!.attempts, 1);
  assert.match(state.rows[0]!.last_error, /HTTP_503/);

  const enrollment = await query(`select status from email_enrollments`);
  assert.equal(enrollment.rows[0]!.status, 'PENDING_EXPORT',
    'a failed send must not mark the prospect exported');
});

test('a successful send records the provider id against our enrollment, not the address', async () => {
  const campaignId = await makeCampaign();
  await linkProvider(campaignId);
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'owner@northgate.example.com' });
  await enqueueCampaignExport({ campaignId, accountIds: [accountId] });

  const { rows } = await query<{ enrollment_id: string }>(`select enrollment_id from email_enrollments`);
  const enrollmentId = rows[0]!.enrollment_id;

  let sentBody = '';
  const client = createSmartleadClient({
    config: SMARTLEAD_READY,
    transport: smartleadTransport({
      onCall: (_url, body) => { sentBody = body; },
      body: { upload_count: 1, leads: [
        { email: 'owner@northgate.example.com', lead_id: 5150,
          custom_fields: { yad_enrollment_id: enrollmentId } },
      ] },
    }),
  });

  const report = await drainEmailOutbox({ client });
  assert.equal(report.sent, 1);

  const enrollment = await query(
    `select status, provider_lead_id, exported_at from email_enrollments`);
  assert.equal(enrollment.rows[0]!.status, 'EXPORTED');
  assert.equal(enrollment.rows[0]!.provider_lead_id, '5150');
  assert.ok(enrollment.rows[0]!.exported_at);

  // Correlation travels with the lead, and nothing internal does.
  assert.match(sentBody, new RegExp(enrollmentId));
  assert.equal(/dnc|suppression_reason|transcript|prompt/i.test(sentBody), false,
    'nothing internal is exported to the provider');
});

test('the credential never appears in the outbox, the enrollment or a report', async () => {
  const campaignId = await makeCampaign();
  await linkProvider(campaignId);
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'owner@northgate.example.com' });
  const report = await enqueueCampaignExport({ campaignId, accountIds: [accountId] });

  const outbox = await query(`select payload from email_outbox`);
  const serialized = JSON.stringify({ report, outbox: outbox.rows });
  assert.equal(serialized.includes(SMARTLEAD_READY.apiKey!), false);
});

test('without a credential the queue waits rather than failing', async () => {
  const campaignId = await makeCampaign();
  await linkProvider(campaignId);
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'owner@northgate.example.com' });
  await enqueueCampaignExport({ campaignId, accountIds: [accountId] });

  const unconfigured = createSmartleadClient({
    config: { ...SMARTLEAD_READY, apiKey: null },
    transport: () => { throw new Error('the provider must not be called'); },
  });
  const report = await drainEmailOutbox({ client: unconfigured });
  assert.equal(report.skipped, 1);
  assert.equal(report.failed, 0, 'waiting for a credential is not a failure');

  const outbox = await query(`select status, attempts from email_outbox`);
  assert.equal(outbox.rows[0]!.status, 'PENDING');
  assert.equal(outbox.rows[0]!.attempts, 0, 'waiting does not burn a retry');
});

test('a campaign with no provider campaign linked fails loudly, not silently', async () => {
  const campaignId = await makeCampaign();
  const accountId = await seedAccount({ name: 'Northgate Air', email: 'owner@northgate.example.com' });
  await enqueueCampaignExport({ campaignId, accountIds: [accountId] });

  const client = createSmartleadClient({
    config: SMARTLEAD_READY, transport: smartleadTransport() });
  const report = await drainEmailOutbox({ client });
  assert.equal(report.failed, 1);

  const outbox = await query(`select last_error from email_outbox`);
  assert.match(outbox.rows[0]!.last_error, /CAMPAIGN_NOT_LINKED_TO_PROVIDER/);
});

test('a suppressed account is not enrolled, and its shortfall is reported', async () => {
  const campaignId = await makeCampaign();
  const good = await seedAccount({ name: 'Northgate Air', email: 'owner@northgate.example.com' });
  const bad = await seedAccount({ name: 'Palmetto Plumbing', email: 'owner@palmetto.example.com' });
  await query(`update accounts set is_suppressed = true where account_id = $1`, [bad]);

  const report = await enqueueCampaignExport({ campaignId, accountIds: [good, bad] });
  assert.equal(report.enrolled, 1);
  assert.equal(report.shortfall, 1);
  assert.ok(Object.keys(report.rejections).length > 0,
    'the shortfall says why, rather than being padded');
});
