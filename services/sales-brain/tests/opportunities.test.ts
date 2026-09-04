import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import {
  allowedTransitions, createOpportunity, getOpportunity, listOpportunities, transitionOpportunity,
} from '../src/domain/opportunities.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Opportunity qualification and stage discipline.
 * Authority: outbound-sales-brain-opportunity-qualification-spec.md,
 * YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §14 ("Cold prospects do not belong in
 * opportunity pipeline before meaningful qualification").
 */

let rep: Awaited<ReturnType<typeof makeUser>>;
let other: Awaited<ReturnType<typeof makeUser>>;
let manager: Awaited<ReturnType<typeof makeUser>>;

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  rep = await makeUser('Rep A');
  other = await makeUser('Rep B');
  manager = await makeUser('Manager', 'SALES_MANAGER');
});

async function seedAccount(name = 'Northgate Air'): Promise<string> {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name, website: `https://${name.toLowerCase().replace(/\W+/g, '')}.example.com`,
      phone: '904-555-0100', city: 'Jacksonville', state: 'FL',
    }, { discoverySource: 'test' }));
  return accountId;
}

/** A real conversation: the prospect said something we recorded. */
async function withConversation(accountId: string): Promise<void> {
  await query(
    `insert into prospect_statements (account_id, category, statement_text, source_class, confidence)
     values ($1,'workflow','After six they go to voicemail and we pick them up in the morning.',
             'prospect_verified','confirmed')`,
    [accountId]);
}

test('positive sentiment alone is not an opportunity', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);

  const result = await createOpportunity({
    accountId, problemSummary: 'They seemed really interested and friendly on the call.',
  }, rep);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_QUALIFYING_EVIDENCE');
  assert.match(result.message ?? '', /not qualification/i);

  const { rows } = await query('select count(*)::int as n from opportunities');
  assert.equal(rows[0].n, 0);
});

test('an opportunity needs a stated problem, not a placeholder', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  await withConversation(accountId);

  const tooShort = await createOpportunity({ accountId, problemSummary: 'interested' }, rep);
  assert.equal(tooShort.ok, false);
  assert.equal(tooShort.reason, 'PROBLEM_REQUIRED');
  assert.match(tooShort.message ?? '', /not a feeling/i);
});

test('a real conversation plus a stated problem opens an opportunity', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  await withConversation(accountId);

  const result = await createOpportunity({
    accountId,
    problemSummary: 'After-hours emergency calls go to voicemail and are picked up the next morning.',
    desiredOutcome: 'Answer or capture every after-hours emergency call.',
  }, rep);

  assert.equal(result.ok, true);
  const detail = await getOpportunity(result.opportunityId!, rep);
  assert.equal(detail!.opportunity.stage, 'DISCOVERY');
  assert.equal(detail!.stageEvents.length, 1, 'the opening transition is recorded');

  const account = await query<{ relationship_state: string; active_opportunity_id: string }>(
    'select relationship_state, active_opportunity_id from accounts where account_id = $1', [accountId]);
  assert.equal(account.rows[0]!.relationship_state, 'ACTIVE_OPPORTUNITY');
  assert.equal(account.rows[0]!.active_opportunity_id, result.opportunityId);
});

test('a booked meeting also qualifies as evidence of a real conversation', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'DECISION_MAKER_REACHED', notes: 'Spoke to Dana' }, rep);

  const result = await createOpportunity({
    accountId, problemSummary: 'Estimates are not consistently followed up after the first call.',
  }, rep);
  assert.equal(result.ok, true);
});

test('a suppressed account can never have an opportunity', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  await withConversation(accountId);
  await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', notes: 'remove us' }, rep);

  const result = await createOpportunity({
    accountId, problemSummary: 'After-hours calls go to voicemail every night.',
  }, rep);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SUPPRESSED');
});

test('only one open opportunity per account', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  await withConversation(accountId);

  const first = await createOpportunity({
    accountId, problemSummary: 'After-hours calls go to voicemail every night.',
  }, rep);
  assert.equal(first.ok, true);

  const second = await createOpportunity({
    accountId, problemSummary: 'A different problem they also mentioned in passing.',
  }, rep);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'ALREADY_OPEN');
});

test('a rep cannot open an opportunity on an account they do not own', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, other);
  await withConversation(accountId);

  const result = await createOpportunity({
    accountId, problemSummary: 'After-hours calls go to voicemail every night.',
  }, rep);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_OWNER');
});

// --- stage discipline --------------------------------------------------------

async function openOpportunity(): Promise<{ accountId: string; opportunityId: string }> {
  const accountId = await seedAccount();
  await claimAccount(accountId, rep);
  await withConversation(accountId);
  const result = await createOpportunity({
    accountId, problemSummary: 'After-hours emergency calls go to voicemail overnight.',
  }, rep);
  return { accountId, opportunityId: result.opportunityId! };
}

test('a stage cannot skip a step', async () => {
  const { opportunityId } = await openOpportunity();

  const skip = await transitionOpportunity({
    opportunityId, targetStage: 'PROPOSAL_DECISION', reason: 'feels ready',
  }, rep);
  assert.equal(skip.ok, false);
  assert.equal(skip.reason, 'ILLEGAL_TRANSITION');
  assert.match(skip.message ?? '', /Discovery to Proposal/);

  // The legal step works.
  const step = await transitionOpportunity({
    opportunityId, targetStage: 'FINANCIAL_DIAGNOSIS', reason: 'They gave me call volume and job value.',
  }, rep);
  assert.equal(step.ok, true);
});

test('a stage change requires a reason and is audited', async () => {
  const { opportunityId } = await openOpportunity();

  const noReason = await transitionOpportunity({
    opportunityId, targetStage: 'FINANCIAL_DIAGNOSIS', reason: '   ',
  }, rep);
  assert.equal(noReason.ok, false);
  assert.equal(noReason.reason, 'REASON_REQUIRED');

  await transitionOpportunity({
    opportunityId, targetStage: 'FINANCIAL_DIAGNOSIS', reason: 'They gave me the numbers.',
  }, rep);

  const audit = await query<{ reason: string; detail: any }>(
    `select reason, detail from audit_log where action = 'opportunity.transition'`);
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0]!.detail.from, 'DISCOVERY');
  assert.equal(audit.rows[0]!.detail.to, 'FINANCIAL_DIAGNOSIS');
});

test('closing requires a close reason', async () => {
  const { opportunityId } = await openOpportunity();

  const noClose = await transitionOpportunity({
    opportunityId, targetStage: 'CLOSED_LOST', reason: 'Moving on',
  }, rep);
  assert.equal(noClose.ok, false);
  assert.equal(noClose.reason, 'CLOSE_REASON_REQUIRED');

  const closed = await transitionOpportunity({
    opportunityId, targetStage: 'CLOSED_LOST', reason: 'Moving on',
    closeReason: 'They handle it in house and are happy with it.',
  }, rep);
  assert.equal(closed.ok, true);
});

test('closing won makes the account a client and frees the pipeline slot', async () => {
  const { accountId, opportunityId } = await openOpportunity();
  for (const [stage, reason] of [
    ['FINANCIAL_DIAGNOSIS', 'Numbers gathered'],
    ['STRATEGY', 'Scope agreed'],
    ['PROPOSAL_DECISION', 'Proposal sent'],
  ] as const) {
    const step = await transitionOpportunity({ opportunityId, targetStage: stage, reason }, rep);
    assert.equal(step.ok, true, `${stage} should be legal`);
  }
  const won = await transitionOpportunity({
    opportunityId, targetStage: 'CLOSED_WON', reason: 'Signed', closeReason: 'Signed the implementation.',
  }, rep);
  assert.equal(won.ok, true);

  const account = await query<{ relationship_state: string; active_opportunity_id: string | null }>(
    'select relationship_state, active_opportunity_id from accounts where account_id = $1', [accountId]);
  assert.equal(account.rows[0]!.relationship_state, 'CLIENT');
  assert.equal(account.rows[0]!.active_opportunity_id, null);

  // A closed opportunity cannot move again.
  assert.deepEqual(allowedTransitions('CLOSED_WON'), []);
});

test('a non-owner cannot move a stage, a manager can', async () => {
  const { opportunityId } = await openOpportunity();

  const bystander = await transitionOpportunity({
    opportunityId, targetStage: 'FINANCIAL_DIAGNOSIS', reason: 'moving it',
  }, other);
  assert.equal(bystander.ok, false);
  assert.equal(bystander.reason, 'NOT_OWNER');

  const byManager = await transitionOpportunity({
    opportunityId, targetStage: 'FINANCIAL_DIAGNOSIS', reason: 'Reviewed with the rep',
  }, manager);
  assert.equal(byManager.ok, true);
});

test('stage history is append-only', async () => {
  const { opportunityId } = await openOpportunity();
  await assert.rejects(
    () => query(`update opportunity_stage_events set reason = 'rewritten' where opportunity_id = $1`,
      [opportunityId]),
    /append-only/,
  );
});

test('a rep sees only their pipeline; a manager sees the team', async () => {
  const mine = await openOpportunity();
  const theirsAccount = await seedAccount('Riverbend Plumbing');
  await claimAccount(theirsAccount, other);
  await withConversation(theirsAccount);
  await createOpportunity({
    accountId: theirsAccount, problemSummary: 'Quotes go unfollowed after the first call.',
  }, other);

  const repView = await listOpportunities(rep);
  assert.equal(repView.length, 1);
  assert.equal(repView[0]!.opportunity_id, mine.opportunityId);

  const managerView = await listOpportunities(manager);
  assert.equal(managerView.length, 2);
});

test('a value figure cannot be recorded without a basis', async () => {
  const { opportunityId } = await openOpportunity();
  await assert.rejects(
    () => query('update opportunities set value_amount = 25000 where opportunity_id = $1',
      [opportunityId]),
    /opportunities_value_needs_basis/,
    'an unexplained number is exactly the kind of figure that becomes a claim later',
  );
});
