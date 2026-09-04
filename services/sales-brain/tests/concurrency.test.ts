import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { resetDatabase, makeUser } from './helpers.js';
import { upsertAccount, upsertEndpoint } from '../src/domain/accounts.js';
import {
  claimAccount, claimAccounts, releaseAccount, reassignAccount, assertCanWorkAccount,
} from '../src/domain/ownership.js';
import { createOpportunity } from '../src/domain/opportunities.js';
import { recordDisposition, addNote } from '../src/domain/activities.js';

/**
 * Ownership under real concurrency.
 * Authority: rep-ownership-data-model.md §14-§15 (atomic claim, exactly one owner),
 * SALES-TEAM-ACCESS-CURRENT.md §19 (suppression wins).
 *
 * These run genuinely parallel transactions against the database rather than
 * sequential calls that only look concurrent, so the guarantee under test is the
 * database's and not the test's.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

let sequence = 0;

async function makeAccount(name: string): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name,
      website: `https://${name.toLowerCase().replace(/\W+/g, '')}.invalid`,
      phone: `904-555-${String(2000 + sequence).slice(-4)}`,
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'concurrency-test' }));
  return accountId;
}

async function ownershipState(accountId: string) {
  const { rows } = await query<{
    ownership_state: string; current_owner_user_id: string | null; is_suppressed: boolean;
    claimed_events: number; released_events: number; reassigned_events: number;
  }>(
    `select a.ownership_state, a.current_owner_user_id, a.is_suppressed,
            (select count(*)::int from ownership_events e
              where e.account_id = a.account_id and e.event_type = 'CLAIMED') as claimed_events,
            (select count(*)::int from ownership_events e
              where e.account_id = a.account_id and e.event_type = 'RELEASED') as released_events,
            (select count(*)::int from ownership_events e
              where e.account_id = a.account_id and e.event_type = 'REASSIGNED') as reassigned_events
       from accounts a where a.account_id = $1`, [accountId]);
  return rows[0]!;
}

// --- two and ten reps, one Account ---------------------------------------------

test('two reps claiming the same Account at once: exactly one wins', async () => {
  const accountId = await makeAccount('Simultaneous Two');
  const first = await makeUser('Race Rep One');
  const second = await makeUser('Race Rep Two');

  const [a, b] = await Promise.all([
    claimAccount(accountId, first),
    claimAccount(accountId, second),
  ]);

  const winners = [a, b].filter((outcome) => outcome.ok);
  assert.equal(winners.length, 1, `${winners.length} claims succeeded`);
  const loser = [a, b].find((outcome) => !outcome.ok)!;
  assert.equal(loser.reason, 'ALREADY_CLAIMED');
  assert.ok(loser.ownerUserId, 'the loser is told who does own it');

  const state = await ownershipState(accountId);
  assert.equal(state.ownership_state, 'CLAIMED');
  assert.equal(state.current_owner_user_id, winners[0]!.ownerUserId);
  assert.equal(state.claimed_events, 1, 'the ownership ledger recorded the claim once');
});

test('ten reps claiming the same Account at once: exactly one wins', async () => {
  const accountId = await makeAccount('Simultaneous Ten');
  const reps = await Promise.all(
    Array.from({ length: 10 }, (_, i) => makeUser(`Stampede Rep ${i}`)));

  const outcomes = await Promise.all(reps.map((rep) => claimAccount(accountId, rep)));

  const winners = outcomes.filter((outcome) => outcome.ok);
  assert.equal(winners.length, 1, `${winners.length} of ten claims succeeded`);
  for (const loser of outcomes.filter((outcome) => !outcome.ok)) {
    assert.equal(loser.reason, 'ALREADY_CLAIMED');
    assert.equal(loser.ownerUserId, winners[0]!.ownerUserId,
      'every loser is told the same owner');
  }
  const state = await ownershipState(accountId);
  assert.equal(state.claimed_events, 1, 'ten contenders wrote more than one claim event');
});

test('ten reps bulk-claiming overlapping sets each get a disjoint result', async () => {
  const accountIds: string[] = [];
  for (let i = 0; i < 12; i += 1) accountIds.push(await makeAccount(`Bulk Contest ${i}`));
  const reps = await Promise.all(
    Array.from({ length: 10 }, (_, i) => makeUser(`Bulk Rep ${i}`)));

  const results = await Promise.all(reps.map((rep) => claimAccounts(accountIds, rep)));

  const claimedBy = new Map<string, string>();
  for (const [index, result] of results.entries()) {
    for (const outcome of result.results.filter((o) => o.ok)) {
      assert.equal(claimedBy.has(outcome.accountId), false,
        `${outcome.accountId} was claimed by two reps`);
      claimedBy.set(outcome.accountId, reps[index]!.userId);
    }
  }
  assert.equal(claimedBy.size, accountIds.length,
    'not every Account ended up owned exactly once');

  for (const accountId of accountIds) {
    const state = await ownershipState(accountId);
    assert.equal(state.claimed_events, 1, `${accountId} has ${state.claimed_events} claim events`);
    assert.equal(state.current_owner_user_id, claimedBy.get(accountId));
  }
});

// --- stale page state ----------------------------------------------------------

test('a rep claiming from a stale page is refused, not silently given the Account',
  async () => {
    const accountId = await makeAccount('Stale Page Co');
    const early = await makeUser('Early Rep');
    const late = await makeUser('Late Rep');

    const beforeClaim = await claimAccount(accountId, early);
    assert.equal(beforeClaim.ok, true);

    const stale = await claimAccount(accountId, late);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'ALREADY_CLAIMED');
    assert.equal(stale.ownerUserId, early.userId, 'the refusal names the real owner');

    const state = await ownershipState(accountId);
    assert.equal(state.current_owner_user_id, early.userId);
    assert.equal(state.claimed_events, 1);
  });

test('a manager reassigning while a rep is working does not lose the ledger', async () => {
  const accountId = await makeAccount('Reassign Under Foot');
  const rep = await makeUser('Working Rep');
  const other = await makeUser('Receiving Rep');
  const manager = await makeUser('Reassigning Manager', 'SALES_MANAGER');
  await claimAccount(accountId, rep);

  const [reassigned, noted] = await Promise.all([
    reassignAccount(accountId, other.userId, manager, 'Rebalancing the patch.'),
    addNote(accountId, 'The rep was mid-sentence.', rep),
  ]);
  assert.equal(reassigned.ok, true);

  const state = await ownershipState(accountId);
  assert.equal(state.current_owner_user_id, other.userId);
  assert.equal(state.claimed_events, 1);
  assert.equal(state.reassigned_events, 1, 'the reassignment is in the ledger exactly once');

  const notes = await query<{ n: number }>(
    `select count(*)::int as n from activities
      where account_id = $1 and activity_type = 'NOTE'`, [accountId]);
  // The two now serialise on the Account row, so the outcome is deterministic rather
  // than depending on which transaction happened to commit first. Whichever way it
  // goes, the rep is told: a note is either written or refused with a reason. It is
  // never accepted and dropped, which is what a silent race would have produced.
  if (noted.ok) {
    assert.equal(notes.rows[0]!.n, 1, 'the note was accepted and then lost');
  } else {
    assert.equal(noted.reason, 'NOT_OWNER',
      `the note was refused for ${noted.reason} rather than the ownership change`);
    assert.equal(notes.rows[0]!.n, 0);
  }

  const permitted = await withTransaction((client) =>
    assertCanWorkAccount(client, accountId, rep));
  assert.equal(permitted.ok, false, 'the previous owner can still work the Account');
});

// --- suppression racing a claim ------------------------------------------------

test('suppression arriving during a claim wins, whichever order they commit',
  async () => {
    const problems: string[] = [];

    // The interleaving is not deterministic, and a rule that only holds in one order
    // is not a rule, so the race is run repeatedly.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await resetDatabase();
      const accountId = await makeAccount(`Suppression Race ${attempt}`);
      const rep = await makeUser('Racing Rep');

      const suppress = query(
        `insert into suppressions (scope, account_id, suppression_type, source, reason)
         values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'Asked to be removed.')`,
        [accountId]);
      const claim = claimAccount(accountId, rep);
      const [, outcome] = await Promise.all([suppress, claim]);

      const state = await ownershipState(accountId);
      if (!state.is_suppressed) problems.push(`attempt ${attempt}: not suppressed`);
      if (state.current_owner_user_id !== null) {
        problems.push(`attempt ${attempt}: still owned by ${state.current_owner_user_id} `
          + `(claim ${outcome.ok ? 'succeeded' : 'refused'}, state ${state.ownership_state})`);
      }
      if (state.ownership_state !== 'SUPPRESSED') {
        problems.push(`attempt ${attempt}: ownership_state is ${state.ownership_state}`);
      }
    }
    assert.deepEqual(problems, []);
  });

test('an endpoint-level DNC during a claim stops the number, not the company', async () => {
  const accountId = await makeAccount('Endpoint DNC Race');
  const rep = await makeUser('Endpoint Rep');
  const endpointId = await withTransaction((client) => upsertEndpoint(client, {
    accountId, contactId: null, locationId: null, type: 'PHONE', rawValue: '904-555-0133',
    endpointRole: 'MAIN_BUSINESS_LINE', relationshipToPerson: 'COMPANY_ROUTE',
    qualityState: 'CURRENT_BUSINESS_CONFIRMED', source: 'COMPANY_WEBSITE',
    sourceReference: null, verifiedAt: new Date(),
  }));

  const [, outcome] = await Promise.all([
    query(`insert into suppressions (scope, account_id, endpoint_id, suppression_type,
                                     source, reason)
           values ('ENDPOINT', $1, $2, 'DNC', 'registry', 'On a registry.')`,
      [accountId, endpointId]),
    claimAccount(accountId, rep),
  ]);

  assert.equal(outcome.ok, true, 'an endpoint-level DNC blocked the whole Account');
  const state = await ownershipState(accountId);
  assert.equal(state.is_suppressed, false);
  const endpoint = await query<{ is_suppressed: boolean }>(
    'select is_suppressed from contact_endpoints where endpoint_id = $1', [endpointId]);
  assert.equal(endpoint.rows[0]!.is_suppressed, true, 'the number is not suppressed');
});

// --- opportunity racing ownership ----------------------------------------------

test('an opportunity created at the instant ownership changes belongs to one owner',
  async () => {
    const accountId = await makeAccount('Opportunity Race Co');
    const rep = await makeUser('Opportunity Rep');
    const other = await makeUser('Other Owner');
    const manager = await makeUser('Race Manager', 'SALES_MANAGER');
    await claimAccount(accountId, rep);
    await query(
      `insert into prospect_statements (account_id, category, statement_text, source_class,
                                        confidence, captured_by)
       values ($1, 'workflow', 'He said the phone rings out most afternoons.',
               'prospect_verified', 'confirmed', $2)`, [accountId, rep.userId]);

    const [created, reassigned] = await Promise.all([
      createOpportunity({
        accountId,
        problemSummary: 'He said the phone rings out most afternoons and nobody calls back.',
        sourceChannel: 'human_rep',
      }, rep),
      reassignAccount(accountId, other.userId, manager, 'Simultaneous rebalance.'),
    ]);
    assert.equal(reassigned.ok, true);

    const opportunities = await query(
      `select opportunity_id, owner_user_id from opportunities where account_id = $1`,
      [accountId]);
    if (created.ok) {
      assert.equal(opportunities.rowCount, 1, 'more than one opportunity for one Account');
      const account = await query<{ active_opportunity_id: string | null }>(
        'select active_opportunity_id from accounts where account_id = $1', [accountId]);
      assert.equal(account.rows[0]!.active_opportunity_id,
        (created as { opportunityId: string }).opportunityId,
        'the Account does not point at its own opportunity');
    } else {
      assert.equal(opportunities.rowCount, 0,
        'the opportunity was refused and written anyway');
    }
  });

test('two outcomes recorded at once produce two activities and one relationship state',
  async () => {
    const accountId = await makeAccount('Double Disposition');
    const rep = await makeUser('Disposition Rep');
    await claimAccount(accountId, rep);

    const [first, second] = await Promise.all([
      recordDisposition({ accountId, disposition: 'NO_ANSWER', notes: 'rang out' }, rep),
      recordDisposition({ accountId, disposition: 'GATEKEEPER', notes: 'front desk' }, rep),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    const activities = await query<{ n: number }>(
      `select count(*)::int as n from activities
        where account_id = $1 and activity_type = 'CALL_ATTEMPT'`, [accountId]);
    assert.equal(activities.rows[0]!.n, 2, 'an outcome was lost');

    const account = await query<{ relationship_state: string }>(
      'select relationship_state from accounts where account_id = $1', [accountId]);
    assert.ok(['CONTACTED', 'ENGAGED'].includes(account.rows[0]!.relationship_state),
      `relationship_state is ${account.rows[0]!.relationship_state}`);
  });

// --- release racing a protected relationship ------------------------------------

test('a promised callback racing a release is never left with nobody to keep it',
  async () => {
    // Before assertCanWorkAccount took the row lock, this left an orphan: the
    // release counted open callbacks in its own transaction while the disposition
    // wrote one from another, and neither blocked the other. Eight runs in twelve
    // ended with an OPEN prospect-requested callback on an Account with no owner.
    const problems: string[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await resetDatabase();
      const accountId = await makeAccount(`Callback Protection Race ${attempt}`);
      const rep = await makeUser('Callback Rep');
      await claimAccount(accountId, rep);

      const [callback, released] = await Promise.all([
        recordDisposition({
          accountId, disposition: 'CALLBACK_REQUESTED', prospectRequested: true,
          callbackDueAt: new Date(Date.now() + 86_400_000),
          notes: 'He asked me to try him Thursday.',
        }, rep),
        releaseAccount(accountId, rep, 'Not my vertical.'),
      ]);

      const state = await ownershipState(accountId);
      const followUp = await query<{ status: string; owner_user_id: string }>(
        `select status, owner_user_id from follow_ups
          where account_id = $1 and prospect_requested`, [accountId]);

      if (callback.ok && released.ok && followUp.rows[0]?.status === 'OPEN'
          && state.current_owner_user_id === null) {
        problems.push(`attempt ${attempt}: a promised callback is owned by nobody`);
      }
      if (callback.ok && !released.ok && released.reason !== 'PROTECTED_RELATIONSHIP') {
        problems.push(`attempt ${attempt}: refused for ${released.reason}`);
      }
      if (!callback.ok && !released.ok) {
        problems.push(`attempt ${attempt}: both operations failed`);
      }
    }
    assert.deepEqual(problems, []);
  });

test('mixed concurrent operations on one Account do not deadlock', async () => {
  // Locking the Account row in assertCanWorkAccount added a lock to every activity
  // write, so the ordering rule -- Account first, then anything else -- is worth
  // proving rather than asserting in a comment.
  const accountId = await makeAccount('Deadlock Probe Co');
  const rep = await makeUser('Probe Rep');
  const manager = await makeUser('Probe Manager', 'SALES_MANAGER');
  const other = await makeUser('Probe Other');
  await claimAccount(accountId, rep);
  await query(
    `insert into prospect_statements (account_id, category, statement_text, source_class,
                                      confidence, captured_by)
     values ($1, 'workflow', 'They said calls go to voicemail after five.',
             'prospect_verified', 'confirmed', $2)`, [accountId, rep.userId]);

  const errors: string[] = [];
  const attempt = async (label: string, work: () => Promise<unknown>) => {
    try { await work(); } catch (error) {
      errors.push(`${label}: ${(error as Error).message}`);
    }
  };

  // Everything at once, in both lock orders, several times over.
  for (let round = 0; round < 4; round += 1) {
    await Promise.all([
      attempt('note', () => addNote(accountId, `Round ${round}.`, rep)),
      attempt('disposition', () => recordDisposition(
        { accountId, disposition: 'NO_ANSWER', notes: 'rang out' }, rep)),
      attempt('reassign', () => reassignAccount(accountId, other.userId, manager, 'Churn.')),
      attempt('reassign back', () => reassignAccount(accountId, rep.userId, manager, 'Back.')),
      attempt('opportunity', () => createOpportunity({
        accountId,
        problemSummary: 'They said calls go to voicemail after five and nobody rings back.',
        sourceChannel: 'human_rep',
      }, rep)),
      attempt('research', () => query(
        `update accounts set last_researched_at = now() where account_id = $1`, [accountId])),
    ]);
  }

  const deadlocks = errors.filter((message) => /deadlock/i.test(message));
  assert.deepEqual(deadlocks, [], `deadlocks: ${deadlocks.join('; ')}`);
  // Anything else that failed is reported, so a new error class cannot hide here.
  assert.deepEqual(errors, [], `unexpected failures: ${errors.join('; ')}`);
});

// --- import racing ownership ----------------------------------------------------

test('an import that rediscovers an owned Account does not reset its ownership',
  async () => {
    const accountId = await makeAccount('Rediscovered Co');
    const rep = await makeUser('Owning Rep');
    await claimAccount(accountId, rep);
    await query(
      `insert into activities (account_id, activity_type, channel, actor_user_id, notes)
       values ($1, 'CALL_ATTEMPT', 'phone', $2, 'Spoke to the owner.')`,
      [accountId, rep.userId]);
    const original = await query<{ phone: string }>(
      `select normalized_value as phone from contact_endpoints
        where account_id = $1 and endpoint_type = 'PHONE' limit 1`, [accountId]);

    const [, again] = await Promise.all([
      addNote(accountId, 'Rep working it now.', rep),
      withTransaction((client) => upsertAccount(client, {
        canonicalName: 'Rediscovered Co', website: 'https://rediscoveredco.invalid',
        phone: original.rows[0]?.phone ?? null,
        city: 'Jacksonville', state: 'FL', postalCode: '32256',
      }, { discoverySource: 'second-import' })),
    ]);

    assert.equal(again.accountId, accountId, 'the import forked a second Account');
    const state = await ownershipState(accountId);
    assert.equal(state.current_owner_user_id, rep.userId, 'an import cleared the owner');
    assert.equal(state.claimed_events, 1);

    const history = await query<{ n: number }>(
      `select count(*)::int as n from activities where account_id = $1`, [accountId]);
    assert.ok(history.rows[0]!.n >= 2, 'the import discarded history');
  });

// --- the claim ceiling under concurrency ---------------------------------------

test('the anti-hoarding ceiling holds when a rep claims in parallel', async () => {
  // This failed before the per-rep lock: eight simultaneous claims each locked a
  // different Account row, each counted zero, and all eight succeeded against a
  // ceiling of three.
  const rep = await makeUser('Hoarding Rep');
  await query('update users set active_claim_target = 3 where user_id = $1', [rep.userId]);
  const accountIds: string[] = [];
  for (let i = 0; i < 8; i += 1) accountIds.push(await makeAccount(`Ceiling ${i}`));

  const outcomes = await Promise.all(
    accountIds.map((accountId) => claimAccount(accountId, { ...rep, activeClaimTarget: 3 })));

  const claimed = outcomes.filter((outcome) => outcome.ok).length;
  const owned = await query<{ n: number }>(
    'select count(*)::int as n from accounts where current_owner_user_id = $1', [rep.userId]);
  assert.equal(claimed, 3, `the ceiling is three and ${claimed} parallel claims succeeded`);
  assert.equal(owned.rows[0]!.n, 3, 'the accounts table and the outcomes disagree');
  assert.equal(outcomes.filter((o) => o.reason === 'CLAIM_LIMIT').length, 5);
});

test('the ceiling also holds through the bulk claim path', async () => {
  // Bulk claim runs one transaction per Account on purpose, so that a few conflicts
  // do not lose the successes. That is exactly what made it a way around the ceiling.
  const rep = await makeUser('Bulk Hoarding Rep');
  await query('update users set active_claim_target = 3 where user_id = $1', [rep.userId]);
  const accountIds: string[] = [];
  for (let i = 0; i < 8; i += 1) accountIds.push(await makeAccount(`Bulk Ceiling ${i}`));

  const result = await claimAccounts(accountIds, { ...rep, activeClaimTarget: 3 });
  assert.equal(result.claimed, 3, `${result.claimed} of eight were claimed past a ceiling of three`);
  assert.equal(result.requested, 8);
});

test('the ceiling is read from the database, not from a stale session', async () => {
  const rep = await makeUser('Stale Session Rep');
  await query('update users set active_claim_target = 1 where user_id = $1', [rep.userId]);
  const accountIds: string[] = [];
  for (let i = 0; i < 4; i += 1) accountIds.push(await makeAccount(`Stale Ceiling ${i}`));

  // The session was minted when the ceiling was 250. The database says one.
  const result = await claimAccounts(accountIds, { ...rep, activeClaimTarget: 250 });
  assert.equal(result.claimed, 1,
    `a stale session claimed ${result.claimed} against a database ceiling of one`);
});

test('the per-rep lock does not make two different reps queue behind each other',
  async () => {
    const a = await makeUser('Parallel Rep A');
    const b = await makeUser('Parallel Rep B');
    const first = await makeAccount('Parallel One');
    const second = await makeAccount('Parallel Two');

    const started = Date.now();
    const [one, two] = await Promise.all([
      claimAccount(first, a), claimAccount(second, b),
    ]);
    const elapsed = Date.now() - started;

    assert.equal(one.ok, true);
    assert.equal(two.ok, true);
    // Two reps contend for nothing, so this is a few milliseconds. A regression that
    // locked something global would show up here as serialisation.
    assert.ok(elapsed < 1_000, `two independent claims took ${elapsed} ms`);
  });

// --- research worker racing a rep ----------------------------------------------

test('a research refresh and a rep’s note do not overwrite each other', async () => {
  const accountId = await makeAccount('Concurrent Research Co');
  const rep = await makeUser('Noting Rep');
  await claimAccount(accountId, rep);

  await Promise.all([
    query(
      `update accounts set last_researched_at = now(),
              research_fresh_until = now() + interval '30 days',
              research_completeness = 'GOOD'
        where account_id = $1`, [accountId]),
    addNote(accountId, 'Owner said call back after the season.', rep),
    query(
      `insert into evidence_records (account_id, category, claim_key, claim_text,
                                     confidence, can_state_as_fact, source_type)
       values ($1, 'hours', 'after_hours_answering', 'Site says 24/7.', 'likely', false,
               'website')`, [accountId]),
  ]);

  const after = await query<{
    research_completeness: string; owner: string | null; notes: number; evidence: number;
  }>(
    `select a.research_completeness, a.current_owner_user_id as owner,
            (select count(*)::int from activities t
              where t.account_id = a.account_id and t.activity_type = 'NOTE') as notes,
            (select count(*)::int from evidence_records e
              where e.account_id = a.account_id) as evidence
       from accounts a where a.account_id = $1`, [accountId]);
  const row = after.rows[0]!;
  assert.equal(row.research_completeness, 'GOOD', 'the refresh was lost');
  assert.equal(row.owner, rep.userId, 'the refresh cleared the owner');
  assert.equal(row.notes, 1, 'the note was lost');
  assert.equal(row.evidence, 1, 'the evidence was lost');
});

// --- the database's own guarantee ----------------------------------------------

test('the claim really does serialize: a held row lock makes it wait', async () => {
  const accountId = await makeAccount('Lock Proof Co');
  const first = await makeUser('Lock Rep One');
  const second = await makeUser('Lock Rep Two');

  // A separate client holds the row lock. If the claim did not take the lock it
  // would return immediately, and a second claim could then see stale state.
  const holder = new pg.Client({ connectionString: config.databaseUrl });
  await holder.connect();
  await holder.query('begin');
  await holder.query('select account_id from accounts where account_id = $1 for update',
    [accountId]);

  let settled = false;
  const claim = claimAccount(accountId, first).then((outcome) => {
    settled = true;
    return outcome;
  });
  await new Promise((resolve) => { setTimeout(resolve, 250); });
  assert.equal(settled, false,
    'the claim returned while another transaction held the row lock');

  await holder.query('commit');
  await holder.end();

  const outcome = await claim;
  assert.equal(outcome.ok, true);
  const late = await claimAccount(accountId, second);
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'ALREADY_CLAIMED');
});
