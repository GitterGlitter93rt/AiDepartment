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
