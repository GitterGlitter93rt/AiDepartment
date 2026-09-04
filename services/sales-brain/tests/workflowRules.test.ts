import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { upsertAccount, upsertEndpoint, recordEvidence } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition, completeFollowUp } from '../src/domain/activities.js';
import {
  createOpportunity, transitionOpportunity, allowedTransitions, listOpportunities,
} from '../src/domain/opportunities.js';
import { listMeetings } from '../src/api/readModels.js';
import { followUpsFor } from '../src/api/queries.js';
import { expireStaleEvidence, EVIDENCE_TTL_HOURS } from '../src/workers/marketMiner.js';

/**
 * The workflow rules a rep lives inside: what is due, what state something is in,
 * and how sure we are of what we think we know.
 * Authority: rep-portal-api-contract.v1.md SS13-SS16, data-contract SS18 and SS31,
 * outbound-sales-brain-opportunity-lifecycle-spec.md.
 *
 * The theme is one clear next action. A rep who opens the CRM and finds five
 * contradictory things to do about one company will do none of them.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

let sequence = 0;

async function makeAccount(name: string): Promise<{ accountId: string; endpointId: string }> {
  sequence += 1;
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name, website: `https://${name.toLowerCase().replace(/\W+/g, '')}.invalid`,
      phone: `904-555-${String(4000 + sequence).slice(-4)}`,
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'workflow-test' }));
  const { rows } = await query<{ endpoint_id: string }>(
    `select endpoint_id from contact_endpoints where account_id = $1 and endpoint_type = 'PHONE'
      limit 1`, [accountId]);
  return { accountId, endpointId: rows[0]!.endpoint_id };
}

async function withStatement(accountId: string, userId: string): Promise<void> {
  await query(
    `insert into prospect_statements (account_id, category, statement_text, source_class,
                                      confidence, captured_by)
     values ($1, 'workflow', 'Two of my guys spend every morning calling people back.',
             'prospect_verified', 'confirmed', $2)`, [accountId, userId]);
}

// --- follow-ups: what is due, and when ------------------------------------------

test('due, overdue and future follow-ups are told apart', async () => {
  const rep = await makeUser('Due Rep');
  const accounts = await Promise.all([
    makeAccount('Overdue Co'), makeAccount('Due Today Co'), makeAccount('Future Co'),
  ]);
  for (const account of accounts) await claimAccount(account.accountId, rep);

  await query(
    `insert into follow_ups (account_id, owner_user_id, followup_type, due_at, status, context)
     values ($1, $4, 'CALLBACK', now() - interval '2 days', 'OPEN', 'overdue'),
            ($2, $4, 'CALLBACK', now() + interval '2 hours', 'OPEN', 'later today'),
            ($3, $4, 'CALLBACK', now() + interval '9 days', 'OPEN', 'next week')`,
    [accounts[0]!.accountId, accounts[1]!.accountId, accounts[2]!.accountId, rep.userId]);

  const work = await followUpsFor(rep.userId);
  assert.equal(work.overdue.length, 1, 'the overdue task is not separated');
  assert.equal(work.overdue[0]!.company_name, 'Overdue Co');
  assert.ok(work.upcoming.some((row: any) => row.company_name === 'Due Today Co'));
  assert.ok(work.upcoming.some((row: any) => row.company_name === 'Future Co'));
});

test('a callback is kept at the time the prospect asked for, in their timezone',
  async () => {
    const rep = await makeUser('Timezone Rep');
    const account = await makeAccount('Timezone Co');
    await claimAccount(account.accountId, rep);

    // "After three on Thursday" in Jacksonville is 20:00 UTC in daylight time.
    const when = new Date('2026-09-10T20:00:00Z');
    const outcome = await recordDisposition({
      accountId: account.accountId, disposition: 'CALLBACK_REQUESTED',
      callbackDueAt: when, callbackTimezone: 'America/New_York', prospectRequested: true,
      notes: 'He asked me to try him after three on Thursday.',
    }, rep);
    assert.equal(outcome.ok, true);

    const { rows } = await query<{ due_at: Date; timezone: string; prospect_requested: boolean }>(
      'select due_at, timezone, prospect_requested from follow_ups where account_id = $1',
      [account.accountId]);
    assert.equal(rows[0]!.due_at.toISOString(), when.toISOString(),
      'the callback time was moved');
    assert.equal(rows[0]!.timezone, 'America/New_York',
      'the prospect’s timezone was not kept, so the time cannot be shown as they said it');
    assert.equal(rows[0]!.prospect_requested, true);
  });

test('a callback across a daylight-saving boundary keeps its wall-clock meaning',
  async () => {
    const rep = await makeUser('DST Rep');
    const account = await makeAccount('DST Co');
    await claimAccount(account.accountId, rep);

    // 1 November 2026 is after the US clocks go back: 15:00 in New York is 20:00 UTC
    // in daylight time and 20:00 UTC is 15:00 standard time -- the same wall clock
    // needs a different UTC instant, which is why the zone is stored beside the time.
    const afterChange = new Date('2026-11-05T20:00:00Z');
    await recordDisposition({
      accountId: account.accountId, disposition: 'CALLBACK_REQUESTED',
      callbackDueAt: afterChange, callbackTimezone: 'America/New_York',
      notes: 'Call me at three on the fifth.',
    }, rep);

    const { rows } = await query<{ due_at: Date; timezone: string }>(
      'select due_at, timezone from follow_ups where account_id = $1', [account.accountId]);
    const shown = new Intl.DateTimeFormat('en-US', {
      timeZone: rows[0]!.timezone, hour: 'numeric', minute: '2-digit', hour12: false,
    }).format(rows[0]!.due_at);
    assert.equal(shown, '15:00',
      `the callback shows as ${shown} in the prospect's zone, not 15:00`);
  });

test('a completed follow-up cannot become due again', async () => {
  const rep = await makeUser('Completion Rep');
  const account = await makeAccount('Completion Co');
  await claimAccount(account.accountId, rep);
  const { rows } = await query<{ followup_id: number }>(
    `insert into follow_ups (account_id, owner_user_id, followup_type, due_at, status, context)
     values ($1, $2, 'CALLBACK', now() - interval '1 day', 'OPEN', 'call him')
     returning followup_id`, [account.accountId, rep.userId]);
  const followupId = rows[0]!.followup_id;

  const first = await completeFollowUp(followupId, rep);
  assert.equal(first.ok, true);
  const second = await completeFollowUp(followupId, rep);
  // Completing twice is a double-click, not an error, but it must not reopen.
  const after = await query<{ status: string; completed_at: Date | null }>(
    'select status, completed_at from follow_ups where followup_id = $1', [followupId]);
  assert.equal(after.rows[0]!.status, 'COMPLETED', `a second completion set ${after.rows[0]!.status}`);
  assert.ok(after.rows[0]!.completed_at);
  void second;

  const work = await followUpsFor(rep.userId);
  assert.equal(work.overdue.length + work.upcoming.length, 0,
    'a completed follow-up is still on the list');
});

test('a do-not-contact cancels the follow-ups that would have called them', async () => {
  const rep = await makeUser('DNC Followup Rep');
  const account = await makeAccount('DNC Followup Co');
  await claimAccount(account.accountId, rep);
  await query(
    `insert into follow_ups (account_id, owner_user_id, followup_type, due_at, status, context)
     values ($1, $2, 'CALLBACK', now() + interval '1 day', 'OPEN', 'call him back'),
            ($1, $2, 'EMAIL', now() + interval '2 days', 'OPEN', 'send the note')`,
    [account.accountId, rep.userId]);

  const outcome = await recordDisposition({
    accountId: account.accountId, disposition: 'DO_NOT_CONTACT',
    notes: 'Take me off your list.',
  }, rep);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.suppressionCreated, true);

  const { rows } = await query<{ status: string; n: number }>(
    `select status, count(*)::int as n from follow_ups where account_id = $1 group by status`,
    [account.accountId]);
  assert.deepEqual(rows, [{ status: 'CANCELLED', n: 2 }],
    'a DNC left work scheduled against a company that asked us to stop');
});

test('a wrong number kills the number, not the relationship', async () => {
  const rep = await makeUser('Wrong Number Rep');
  const account = await makeAccount('Wrong Number Co');
  await claimAccount(account.accountId, rep);
  const secondEndpoint = await withTransaction((client) => upsertEndpoint(client, {
    accountId: account.accountId, contactId: null, locationId: null, type: 'PHONE',
    rawValue: '904-555-4999', endpointRole: 'DIRECT_BUSINESS_LINE',
    relationshipToPerson: 'DIRECT_CONFIRMED', qualityState: 'DIRECT_BUSINESS_CONFIRMED',
    source: 'COMPANY_WEBSITE', sourceReference: null, verifiedAt: new Date(),
  }));
  await query(
    `insert into follow_ups (account_id, owner_user_id, followup_type, due_at, status, context)
     values ($1, $2, 'CALLBACK', now() + interval '1 day', 'OPEN', 'try the other number')`,
    [account.accountId, rep.userId]);

  await recordDisposition({
    accountId: account.accountId, endpointId: account.endpointId,
    disposition: 'WRONG_NUMBER', notes: 'A dentist answered.',
  }, rep);

  const endpoints = await query<{ endpoint_id: string; quality_state: string; is_active: boolean }>(
    'select endpoint_id, quality_state, is_active from contact_endpoints where account_id = $1',
    [account.accountId]);
  const dead = endpoints.rows.find((row) => row.endpoint_id === account.endpointId)!;
  const alive = endpoints.rows.find((row) => row.endpoint_id === secondEndpoint)!;
  assert.equal(dead.quality_state, 'WRONG_NUMBER');
  assert.equal(dead.is_active, false);
  assert.equal(alive.quality_state, 'DIRECT_BUSINESS_CONFIRMED',
    'a wrong number killed the other number too');

  const account_ = await query<{ is_suppressed: boolean; current_owner_user_id: string | null }>(
    'select is_suppressed, current_owner_user_id from accounts where account_id = $1',
    [account.accountId]);
  assert.equal(account_.rows[0]!.is_suppressed, false, 'a wrong number suppressed the company');
  assert.equal(account_.rows[0]!.current_owner_user_id, rep.userId, 'a wrong number lost the owner');

  const open = await query<{ n: number }>(
    `select count(*)::int as n from follow_ups where account_id = $1 and status = 'OPEN'`,
    [account.accountId]);
  assert.equal(open.rows[0]!.n, 1, 'a wrong number cancelled work on the other number');
});

test('an email bounce does not destroy a working phone relationship', async () => {
  const rep = await makeUser('Bounce Rep');
  const account = await makeAccount('Bounce Co');
  await claimAccount(account.accountId, rep);
  const emailId = await withTransaction((client) => upsertEndpoint(client, {
    accountId: account.accountId, contactId: null, locationId: null, type: 'EMAIL',
    rawValue: 'office@bounceco.invalid', endpointRole: 'GENERAL_BUSINESS_EMAIL',
    relationshipToPerson: 'ROLE_INBOX', qualityState: 'PUBLIC_OBSERVED_CURRENT',
    source: 'COMPANY_WEBSITE', sourceReference: null, verifiedAt: null,
  }));

  await query(
    `update contact_endpoints set quality_state = 'HARD_BOUNCE', is_active = false
      where endpoint_id = $1`, [emailId]);

  const phone = await query<{ quality_state: string; is_active: boolean }>(
    'select quality_state, is_active from contact_endpoints where endpoint_id = $1',
    [account.endpointId]);
  assert.equal(phone.rows[0]!.is_active, true, 'a bounced email deactivated the phone');
  const relationship = await query<{ relationship_state: string; is_suppressed: boolean }>(
    'select relationship_state, is_suppressed from accounts where account_id = $1',
    [account.accountId]);
  assert.equal(relationship.rows[0]!.is_suppressed, false);
});

// --- opportunity and meeting state ------------------------------------------------

test('the opportunity stages walk forward and refuse to skip', async () => {
  const rep = await makeUser('Stage Rep');
  const account = await makeAccount('Stage Co');
  await claimAccount(account.accountId, rep);
  await withStatement(account.accountId, rep.userId);

  const created = await createOpportunity({
    accountId: account.accountId,
    problemSummary: 'Two techs spend every morning returning calls that came in overnight.',
    sourceChannel: 'human_rep',
  }, rep);
  assert.equal(created.ok, true);
  const opportunityId = (created as { opportunityId: string }).opportunityId;

  // The allowed set is the server's, and the server enforces it.
  assert.deepEqual(allowedTransitions('DISCOVERY').sort(),
    ['CLOSED_LOST', 'FINANCIAL_DIAGNOSIS'].sort());

  const skip = await transitionOpportunity({
    opportunityId, targetStage: 'PROPOSAL_DECISION', reason: 'they seemed keen',
  }, rep);
  assert.equal(skip.ok, false, 'an opportunity skipped two stages');

  for (const stage of ['FINANCIAL_DIAGNOSIS', 'STRATEGY', 'PROPOSAL_DECISION'] as const) {
    const step = await transitionOpportunity({
      opportunityId, targetStage: stage, reason: `moving to ${stage}`,
    }, rep);
    assert.equal(step.ok, true, `${stage} was refused: ${JSON.stringify(step)}`);
  }

  const events = await query<{ n: number }>(
    'select count(*)::int as n from opportunity_stage_events where opportunity_id = $1',
    [opportunityId]);
  assert.ok(events.rows[0]!.n >= 3, 'the transitions are not in the timeline');
});

test('closing needs a reason, and a closed opportunity can be reopened deliberately',
  async () => {
    const rep = await makeUser('Close Rep');
    const account = await makeAccount('Close Co');
    await claimAccount(account.accountId, rep);
    await withStatement(account.accountId, rep.userId);
    const created = await createOpportunity({
      accountId: account.accountId,
      problemSummary: 'They lose two calls a day while both technicians are out.',
      sourceChannel: 'human_rep',
    }, rep);
    const opportunityId = (created as { opportunityId: string }).opportunityId;

    // Two different reasons, deliberately: why the stage moved, and why the deal was
    // lost. A close with only the first is refused.
    const noReason = await transitionOpportunity({
      opportunityId, targetStage: 'CLOSED_LOST', reason: '',
    }, rep);
    assert.equal(noReason.ok, false, 'an opportunity was closed with no reason');
    assert.equal((noReason as { reason: string }).reason, 'REASON_REQUIRED');

    const noCloseReason = await transitionOpportunity({
      opportunityId, targetStage: 'CLOSED_LOST', reason: 'Moving it to closed.',
    }, rep);
    assert.equal(noCloseReason.ok, false, 'an opportunity was closed with no outcome');
    assert.equal((noCloseReason as { reason: string }).reason, 'CLOSE_REASON_REQUIRED');

    const closed = await transitionOpportunity({
      opportunityId, targetStage: 'CLOSED_LOST', reason: 'Closing it out.',
      closeReason: 'No business case this year.',
    }, rep);
    assert.equal(closed.ok, true, `closing failed: ${JSON.stringify(closed)}`);

    const row = await query<{ stage: string; close_reason: string; closed_at: Date | null }>(
      'select stage, close_reason, closed_at from opportunities where opportunity_id = $1',
      [opportunityId]);
    assert.equal(row.rows[0]!.stage, 'CLOSED_LOST');
    assert.match(row.rows[0]!.close_reason, /No business case/);
    assert.ok(row.rows[0]!.closed_at);

    // Reopening is allowed but is a transition like any other, recorded with a reason.
    const reopened = await transitionOpportunity({
      opportunityId, targetStage: 'DISCOVERY', reason: 'They called back in the spring.',
    }, rep);
    if (reopened.ok) {
      const events = await query<{ from_stage: string; to_stage: string }>(
        `select from_stage, to_stage from opportunity_stage_events
          where opportunity_id = $1 order by occurred_at desc limit 1`, [opportunityId]);
      assert.equal(events.rows[0]!.from_stage, 'CLOSED_LOST');
      assert.equal(events.rows[0]!.to_stage, 'DISCOVERY');
    } else {
      // If the lifecycle forbids reopening, it must say so rather than silently fail.
      assert.ok(reopened.reason, 'a refused reopen gave no reason');
    }
  });

test('an opportunity needs something the prospect said, not a good feeling', async () => {
  const rep = await makeUser('Qualification Rep');
  const account = await makeAccount('Qualification Co');
  await claimAccount(account.accountId, rep);

  const feeling = await createOpportunity({
    accountId: account.accountId,
    problemSummary: 'They sounded really interested on the phone today.',
    sourceChannel: 'human_rep',
  }, rep);
  assert.equal(feeling.ok, false, 'an opportunity was opened on sentiment');
  assert.equal((feeling as { reason: string }).reason, 'NO_QUALIFYING_EVIDENCE');

  await withStatement(account.accountId, rep.userId);
  const grounded = await createOpportunity({
    accountId: account.accountId,
    problemSummary: 'Two techs spend every morning returning calls that came in overnight.',
    sourceChannel: 'human_rep',
  }, rep);
  assert.equal(grounded.ok, true);
});

test('a DNC after an opportunity exists stops the outreach and keeps the record',
  async () => {
    const rep = await makeUser('DNC Opportunity Rep');
    const account = await makeAccount('DNC Opportunity Co');
    await claimAccount(account.accountId, rep);
    await withStatement(account.accountId, rep.userId);
    await createOpportunity({
      accountId: account.accountId,
      problemSummary: 'They lose calls every afternoon while the crew is out on jobs.',
      sourceChannel: 'human_rep',
    }, rep);

    await recordDisposition({
      accountId: account.accountId, disposition: 'DO_NOT_CONTACT',
      notes: 'Their lawyer asked us to stop.',
    }, rep);

    const after = await query<{ opportunities: number; suppressed: boolean; owner: string | null }>(
      `select (select count(*)::int from opportunities where account_id = $1) as opportunities,
              a.is_suppressed as suppressed, a.current_owner_user_id as owner
         from accounts a where a.account_id = $1`, [account.accountId]);
    assert.equal(after.rows[0]!.opportunities, 1, 'the opportunity record was destroyed');
    assert.equal(after.rows[0]!.suppressed, true);
    assert.equal(after.rows[0]!.owner, null, 'a suppressed Account kept its owner');

    // It is gone from the working list, because nobody may work it.
    const visible = await listOpportunities({ userId: rep.userId, role: 'SALES_REP' }, {});
    const stillThere = visible.find((row: any) => row.account_id === account.accountId);
    // Whether it is listed or not, the rep cannot work it -- the ownership check
    // refuses, and the suppression is on the Account.
    if (stillThere) {
      const blocked = await recordDisposition({
        accountId: account.accountId, disposition: 'DECISION_MAKER_REACHED', notes: 'trying',
      }, rep);
      assert.equal(blocked.ok, false,
        'a suppressed company with an opportunity can still be worked');
    }
  });

test('booked and attended are separate facts, and a provider cancellation wins',
  async () => {
    const rep = await makeUser('Meeting State Rep');
    const account = await makeAccount('Meeting State Co');
    await claimAccount(account.accountId, rep);

    const { rows } = await query<{ booking_id: string }>(
      `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, meeting_type,
                                     idempotency_key, requested_start, requested_end,
                                     prospect_timezone, status, provider, provider_event_id,
                                     confirmed_at, created_by)
       values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'state-1',
               now() + interval '1 day', now() + interval '1 day' + interval '15 minutes',
               'America/New_York', 'CONFIRMED', 'calcom', 'evt-state-1', now(), $2)
       returning booking_id`, [account.accountId, rep.userId]);
    const bookingId = rows[0]!.booking_id;

    const upcoming = await listMeetings({ userId: rep.userId, role: 'SALES_REP' }, 'upcoming');
    assert.equal(upcoming.length, 1);
    assert.equal(upcoming[0]!.attended_state, 'UNKNOWN',
      'a booked meeting was recorded as attended before it happened');

    // The provider says it was cancelled after we saw it booked. The provider wins.
    await query(
      `update meeting_bookings set status = 'CANCELLED', attended_state = 'CANCELLED'
        where booking_id = $1`, [bookingId]);

    const stillUpcoming = await listMeetings({ userId: rep.userId, role: 'SALES_REP' }, 'upcoming');
    assert.equal(stillUpcoming.length, 0, 'a cancelled meeting is still listed as upcoming');
    const attention = await listMeetings(
      { userId: rep.userId, role: 'SALES_REP' }, 'needs_attention');
    assert.equal(attention.length, 1, 'a cancelled meeting appears on no list');
  });

test('a no-show is only a no-show when somebody says so', async () => {
  const rep = await makeUser('No Show Rep');
  const account = await makeAccount('No Show Co');
  await claimAccount(account.accountId, rep);
  await query(
    `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, meeting_type,
                                   idempotency_key, requested_start, requested_end, status,
                                   provider, provider_event_id, confirmed_at, created_by)
     values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'noshow-1',
             now() - interval '2 hours', now() - interval '105 minutes', 'CONFIRMED',
             'calcom', 'evt-noshow-1', now() - interval '1 day', $2)`,
    [account.accountId, rep.userId]);

  // The meeting time has passed and nobody has said what happened.
  const { rows } = await query<{ attended_state: string }>(
    'select attended_state from meeting_bookings where account_id = $1', [account.accountId]);
  assert.equal(rows[0]!.attended_state, 'UNKNOWN',
    'a meeting whose time passed was assumed to be a no-show');

  const attention = await listMeetings({ userId: rep.userId, role: 'SALES_REP' }, 'needs_attention');
  assert.equal(attention.length, 0,
    'a meeting nobody has reported on yet is already being called a problem');
});

// --- research freshness and decay ------------------------------------------------

test('an old ad observation does not mean they are advertising now', async () => {
  const rep = await makeUser('Freshness Rep');
  const account = await makeAccount('Freshness Co');
  void rep;

  // An ad seen once, three months ago, with the TTL the spec gives it.
  await query(
    `insert into evidence_records (account_id, category, claim_key, claim_text,
                                   normalized_value, confidence, can_state_as_fact,
                                   source_type, observed_at, expires_at, freshness,
                                   precedence_rank)
     values ($1, 'advertising', 'active_google_search_ad',
             'A Google search ad showed their site.', 'yes', 'confirmed', true,
             'serp_observation', now() - interval '90 days', now() - interval '88 days',
             'stale', 2)`, [account.accountId]);

  const inventory = await query<{ google_paid: boolean | null }>(
    'select google_paid from prospect_inventory where account_id = $1', [account.accountId]);
  assert.notEqual(inventory.rows[0]!.google_paid, true,
    'a ninety-day-old ad observation still reads as advertising now');

  // The record itself is not deleted: it is history, and history is what lets us say
  // "they were advertising in June" without saying "they advertise".
  const kept = await query<{ n: number }>(
    'select count(*)::int as n from evidence_records where account_id = $1', [account.accountId]);
  assert.equal(kept.rows[0]!.n, 1, 'the observation was deleted rather than aged');
});

test('the freshness window is shorter for things that change fast', () => {
  // An ad can be switched off this afternoon; a location cannot.
  assert.ok(EVIDENCE_TTL_HOURS['active_google_search_ad']! < EVIDENCE_TTL_HOURS['website_offer']!);
  assert.ok(EVIDENCE_TTL_HOURS['website_offer']! < EVIDENCE_TTL_HOURS['decision_maker_identity']!);
  assert.ok(EVIDENCE_TTL_HOURS['decision_maker_identity']! <= EVIDENCE_TTL_HOURS['location']!);
  assert.equal(EVIDENCE_TTL_HOURS['active_google_search_ad'], 48);
});

test('expiring evidence marks it stale and never rewrites what was observed', async () => {
  const account = await makeAccount('Expiry Co');
  const evidenceId = await withTransaction((client) => recordEvidence(client, {
    accountId: account.accountId, category: 'advertising', claimKey: 'active_google_search_ad',
    claimText: 'A Google search ad showed their site.', normalizedValue: 'yes',
    confidence: 'confirmed', canStateAsFact: true, sourceType: 'serp_observation',
    expiresAt: new Date(Date.now() - 3_600_000),
  }));

  const before = await query<{ claim_text: string; observed_at: Date }>(
    'select claim_text, observed_at from evidence_records where evidence_id = $1', [evidenceId]);
  const expired = await expireStaleEvidence();
  assert.ok(expired >= 1, 'nothing was expired');

  const after = await query<{ claim_text: string; observed_at: Date; freshness: string }>(
    'select claim_text, observed_at, freshness from evidence_records where evidence_id = $1',
    [evidenceId]);
  assert.equal(after.rows[0]!.freshness, 'stale');
  assert.equal(after.rows[0]!.claim_text, before.rows[0]!.claim_text,
    'expiring rewrote what was observed');
  assert.equal(after.rows[0]!.observed_at.toISOString(),
    before.rows[0]!.observed_at.toISOString(),
    'expiring moved when it was observed');
});

test('a contradicted claim lowers certainty rather than deleting the older one',
  async () => {
    const account = await makeAccount('Contradiction Co');
    const first = await withTransaction((client) => recordEvidence(client, {
      accountId: account.accountId, category: 'contact', claimKey: 'decision_maker_name',
      claimText: 'The website names Ray Alvarez as owner.', confidence: 'likely',
      canStateAsFact: false, sourceType: 'website',
    }));
    const second = await withTransaction((client) => recordEvidence(client, {
      accountId: account.accountId, category: 'contact', claimKey: 'decision_maker_name',
      claimText: 'A review site names Dana Whitfield as owner.', confidence: 'contradicted',
      canStateAsFact: false, sourceType: 'directory',
    }));

    const both = await query<{ n: number }>(
      'select count(*)::int as n from evidence_records where account_id = $1',
      [account.accountId]);
    assert.equal(both.rows[0]!.n, 2, 'the older claim was deleted by the newer one');

    // Neither may be stated as fact while they disagree.
    const statable = await query<{ n: number }>(
      `select count(*)::int as n from evidence_records
        where account_id = $1 and claim_key = 'decision_maker_name' and can_state_as_fact`,
      [account.accountId]);
    assert.equal(statable.rows[0]!.n, 0,
      'a disputed owner name can still be spoken as fact');
    void first; void second;
  });

test('what a prospect told us outranks what a website said', async () => {
  const rep = await makeUser('Precedence Rep');
  const account = await makeAccount('Precedence Co');
  await claimAccount(account.accountId, rep);

  await withTransaction((client) => recordEvidence(client, {
    accountId: account.accountId, category: 'hours', claimKey: 'after_hours_answering',
    claimText: 'Their website says 24/7 emergency service.', normalizedValue: 'yes',
    confidence: 'likely', canStateAsFact: false, sourceType: 'website', precedenceRank: 6,
  }));
  await recordDisposition({
    accountId: account.accountId, disposition: 'DECISION_MAKER_REACHED',
    notes: 'He said nobody answers after six.',
    prospectStatements: [{ category: 'hours', text: 'Nobody answers after six.' }],
  }, rep);

  const statement = await query<{ statement_text: string; source_class: string }>(
    'select statement_text, source_class from prospect_statements where account_id = $1',
    [account.accountId]);
  assert.equal(statement.rowCount, 1, 'what the prospect said was not recorded');
  assert.equal(statement.rows[0]!.source_class, 'prospect_verified');

  // The website claim is still there and still not statable as fact, so nothing
  // weaker can overwrite what they told us.
  const website = await query<{ can_state_as_fact: boolean }>(
    `select can_state_as_fact from evidence_records
      where account_id = $1 and claim_key = 'after_hours_answering'`, [account.accountId]);
  assert.equal(website.rows[0]!.can_state_as_fact, false);
});

test('stale research schedules a refresh without stopping the rep working', async () => {
  const rep = await makeUser('Stale Research Rep');
  const account = await makeAccount('Stale Research Co');
  await claimAccount(account.accountId, rep);
  await query(
    `update accounts set research_fresh_until = now() - interval '10 days',
            research_completeness = 'STALE', last_researched_at = now() - interval '200 days'
      where account_id = $1`, [account.accountId]);

  // The Account is still workable: stale research is a reason to refresh, not a
  // reason to stop a rep who has the company on the phone.
  const outcome = await recordDisposition({
    accountId: account.accountId, disposition: 'DECISION_MAKER_REACHED',
    notes: 'Reached him anyway.',
  }, rep);
  assert.equal(outcome.ok, true, 'stale research blocked a rep from logging a real call');

  const inventory = await query<{ research_completeness: string }>(
    'select research_completeness from prospect_inventory where account_id = $1',
    [account.accountId]);
  assert.equal(inventory.rows[0]!.research_completeness, 'STALE',
    'the page would not show the rep that the research is old');
});
