import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount, claimAccounts, releaseAccount, reassignAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { searchProspects } from '../src/domain/search.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * The acceptance data tests required before rollout
 * (rep-ownership-data-model.md §20, rep-portal-api-contract.v1.md §22).
 */

let repA: Awaited<ReturnType<typeof makeUser>>;
let repB: Awaited<ReturnType<typeof makeUser>>;
let manager: Awaited<ReturnType<typeof makeUser>>;

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });

beforeEach(async () => {
  await resetDatabase();
  repA = await makeUser('Rep A');
  repB = await makeUser('Rep B');
  manager = await makeUser('Sales Manager', 'SALES_MANAGER');
});

async function seedAccount(overrides: Record<string, unknown> = {}): Promise<string> {
  return withTransaction(async (client) => {
    const result = await upsertAccount(
      client,
      {
        canonicalName: 'ABC Air Conditioning LLC',
        website: 'https://www.abcair.com',
        phone: '904-555-0100',
        city: 'Jacksonville', state: 'FL', postalCode: '32256',
        verticalProfileId: null,
        ...overrides,
      } as never,
      { discoverySource: 'test' },
    );
    return result.accountId;
  });
}

test('duplicate discovery from two sources resolves to one Account', async () => {
  const first = await seedAccount();

  // Same company arrives later from an import with a differently punctuated name,
  // no website, and the same phone number.
  const second = await withTransaction((client) =>
    upsertAccount(
      client,
      {
        canonicalName: 'A.B.C. Air Conditioning, Inc.',
        phone: '(904) 555-0100',
        city: 'Jacksonville', state: 'FL', postalCode: '32256',
      },
      { discoverySource: 'import' },
    ),
  );

  assert.equal(second.created, false, 'second discovery must not create a new Account');
  assert.equal(second.accountId, first);
  assert.equal(second.matchRule, 'phone_and_name');

  const { rows } = await pool.query('select count(*)::int as n from accounts');
  assert.equal(rows[0].n, 1, 'exactly one canonical Account');
});

test('domain match resolves identity even when the name is written differently', async () => {
  const first = await seedAccount();
  const second = await withTransaction((client) =>
    upsertAccount(
      client,
      { canonicalName: 'ABC Heating and Air', website: 'http://abcair.com/contact' },
      { discoverySource: 'market_miner' },
    ),
  );
  assert.equal(second.accountId, first);
  assert.equal(second.matchRule, 'domain');
});

test('CONCURRENCY: two reps claiming the same Account produce exactly one owner', async () => {
  const accountId = await seedAccount();

  // Fire both claims at once against the same row.
  const [outcomeA, outcomeB] = await Promise.all([
    claimAccount(accountId, repA),
    claimAccount(accountId, repB),
  ]);

  const winners = [outcomeA, outcomeB].filter((o) => o.ok);
  const losers = [outcomeA, outcomeB].filter((o) => !o.ok);
  assert.equal(winners.length, 1, 'exactly one claim may succeed');
  assert.equal(losers.length, 1);
  assert.equal(losers[0]!.reason, 'ALREADY_CLAIMED');
  assert.ok(losers[0]!.ownerDisplayName, 'the loser is told who owns it');

  const { rows } = await pool.query(
    'select current_owner_user_id, ownership_state from accounts where account_id = $1', [accountId],
  );
  assert.equal(rows[0].ownership_state, 'CLAIMED');
  assert.equal(rows[0].current_owner_user_id, winners[0]!.ownerUserId);

  // Exactly one successful claim is recorded in history.
  const events = await pool.query(
    `select count(*)::int as n from ownership_events where account_id = $1 and event_type = 'CLAIMED'`,
    [accountId],
  );
  assert.equal(events.rows[0].n, 1, 'audit history records one successful claim only');
});

test('bulk claim: conflicts do not roll back the successful claims', async () => {
  const ids: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    ids.push(await seedAccount({
      canonicalName: `Company ${i}`, website: `https://company${i}.com`, phone: `904-555-01${10 + i}`,
    }));
  }
  // Rep B takes two of them first.
  await claimAccount(ids[1]!, repB);
  await claimAccount(ids[3]!, repB);

  const result = await claimAccounts(ids, repA);
  assert.equal(result.requested, 5);
  assert.equal(result.claimed, 3, '22-of-25 semantics: unrelated successes survive a conflict');
  assert.equal(result.conflicts, 2);
  assert.deepEqual(
    result.results.filter((r) => !r.ok).map((r) => r.reason),
    ['ALREADY_CLAIMED', 'ALREADY_CLAIMED'],
  );
});

test('DNC survives rediscovery and never returns as claimable cold inventory', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, repA);

  const { rows: endpointRows } = await pool.query(
    `select endpoint_id from contact_endpoints where account_id = $1 and endpoint_type = 'PHONE'`,
    [accountId],
  );
  const result = await recordDisposition(
    { accountId, disposition: 'DO_NOT_CONTACT', endpointId: endpointRows[0].endpoint_id,
      notes: 'Asked to be removed' },
    repA,
  );
  assert.equal(result.ok, true);
  assert.equal(result.suppressionCreated, true);

  const { rows: after } = await pool.query(
    'select is_suppressed, ownership_state, current_owner_user_id from accounts where account_id = $1',
    [accountId],
  );
  assert.equal(after[0].is_suppressed, true);
  assert.equal(after[0].ownership_state, 'SUPPRESSED');
  assert.equal(after[0].current_owner_user_id, null);

  // A brand new discovery of the same business must not resurrect it.
  const rediscovered = await withTransaction((client) =>
    upsertAccount(
      client,
      { canonicalName: 'ABC Air Conditioning', website: 'https://abcair.com', phone: '904-555-0100' },
      { discoverySource: 'market_miner' },
    ),
  );
  assert.equal(rediscovered.accountId, accountId, 'rediscovery resolves to the same Account');

  const stillSuppressed = await pool.query(
    'select is_suppressed from accounts where account_id = $1', [accountId],
  );
  assert.equal(stillSuppressed.rows[0].is_suppressed, true, 'a new source must never reset suppression');

  // And it must not be claimable or visible as cold inventory.
  const claimAttempt = await claimAccount(accountId, repB);
  assert.equal(claimAttempt.ok, false);
  assert.equal(claimAttempt.reason, 'SUPPRESSED');

  const search = await searchProspects({ ownership: 'UNCLAIMED' }, repB);
  assert.equal(search.total, 0, 'suppressed Accounts never appear in unclaimed inventory');
});

test('a client Account is not generic cold inventory', async () => {
  const accountId = await seedAccount();
  await pool.query(`update accounts set relationship_state = 'CLIENT' where account_id = $1`, [accountId]);

  const attempt = await claimAccount(accountId, repA);
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'CLIENT');

  const search = await searchProspects({ ownership: 'UNCLAIMED' }, repA);
  assert.equal(search.total, 0);
});

test('cross-vertical rediscovery keeps the original owner', async () => {
  const accountId = await seedAccount({ verticalProfileId: null });
  await claimAccount(accountId, repA);

  // The same company turns up again through a plumbing campaign.
  const again = await withTransaction((client) =>
    upsertAccount(
      client,
      { canonicalName: 'ABC Air Conditioning LLC', website: 'https://abcair.com', verticalProfileId: null },
      { discoverySource: 'market_miner_plumbing' },
    ),
  );
  assert.equal(again.accountId, accountId);

  const claimAttempt = await claimAccount(accountId, repB);
  assert.equal(claimAttempt.ok, false);
  assert.equal(claimAttempt.reason, 'ALREADY_CLAIMED');
  assert.equal(claimAttempt.ownerDisplayName, 'Rep A');
});

test('a wrong number kills the endpoint, not the Account, and stays dead on rediscovery', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, repA);
  const { rows } = await pool.query(
    `select endpoint_id from contact_endpoints where account_id = $1 and endpoint_type = 'PHONE'`,
    [accountId],
  );
  const endpointId = rows[0].endpoint_id;

  await recordDisposition({ accountId, disposition: 'WRONG_NUMBER', endpointId }, repA);

  const afterDisposition = await pool.query(
    'select quality_state, is_active from contact_endpoints where endpoint_id = $1', [endpointId],
  );
  assert.equal(afterDisposition.rows[0].quality_state, 'WRONG_NUMBER');
  assert.equal(afterDisposition.rows[0].is_active, false);

  // The Account itself is still a prospect.
  const account = await pool.query('select relationship_state from accounts where account_id = $1', [accountId]);
  assert.notEqual(account.rows[0].relationship_state, 'DISQUALIFIED');

  // Re-crawling the site and finding the same number must not silently revive it.
  await withTransaction((client) =>
    upsertAccount(
      client,
      { canonicalName: 'ABC Air Conditioning LLC', website: 'https://abcair.com', phone: '904-555-0100' },
      { discoverySource: 'market_miner' },
    ),
  );
  const afterRediscovery = await pool.query(
    'select quality_state from contact_endpoints where endpoint_id = $1', [endpointId],
  );
  assert.equal(afterRediscovery.rows[0].quality_state, 'WRONG_NUMBER',
    'a rep-marked wrong number is not resurrected by a new crawl');
});

test('a requested callback protects ownership from release', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, repA);

  const dueAt = new Date(Date.now() + 86_400_000);
  const result = await recordDisposition(
    { accountId, disposition: 'CALLBACK_REQUESTED', callbackDueAt: dueAt, prospectRequested: true,
      notes: 'Call back Thursday morning' },
    repA,
  );
  assert.equal(result.ok, true);
  assert.ok(result.followupId);

  const release = await releaseAccount(accountId, repA, 'cleaning up my list');
  assert.equal(release.ok, false);
  assert.equal(release.reason, 'PROTECTED_RELATIONSHIP');
  assert.equal(release.protectedBy, 'CALLBACK_REQUESTED');
});

test('release returns an unprotected Account to inventory', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, repA);
  const release = await releaseAccount(accountId, repA, 'not my territory');
  assert.equal(release.ok, true);

  const { rows } = await pool.query(
    'select ownership_state, current_owner_user_id from accounts where account_id = $1', [accountId],
  );
  assert.equal(rows[0].ownership_state, 'UNCLAIMED');
  assert.equal(rows[0].current_owner_user_id, null);

  const reclaim = await claimAccount(accountId, repB);
  assert.equal(reclaim.ok, true);
});

test('ownership cannot be bypassed by a rep who does not own the Account', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, repA);

  // Rep B posts a disposition straight at the account id.
  const attempt = await recordDisposition(
    { accountId, disposition: 'DECISION_MAKER_REACHED', notes: 'sneaking in' }, repB,
  );
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'NOT_OWNER');

  const release = await releaseAccount(accountId, repB);
  assert.equal(release.ok, false);
  assert.equal(release.reason, 'NOT_OWNER');

  const reassign = await reassignAccount(accountId, repB.userId, repB, 'give it to me');
  assert.equal(reassign.ok, false);
  assert.equal(reassign.reason, 'PERMISSION_DENIED');
});

test('manager reassignment is audited and preserves prior owner history', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, repA);

  const result = await reassignAccount(accountId, repB.userId, manager, 'Rep A moved territory');
  assert.equal(result.ok, true);

  const { rows } = await pool.query(
    'select current_owner_user_id, ownership_state from accounts where account_id = $1', [accountId],
  );
  assert.equal(rows[0].current_owner_user_id, repB.userId);
  assert.equal(rows[0].ownership_state, 'MANAGER_ASSIGNED');

  const events = await pool.query(
    'select event_type, previous_owner_user_id, new_owner_user_id, reason from ownership_events where account_id = $1 order by occurred_at',
    [accountId],
  );
  assert.equal(events.rows.length, 2);
  assert.equal(events.rows[1].event_type, 'REASSIGNED');
  assert.equal(events.rows[1].previous_owner_user_id, repA.userId, 'prior owner history is preserved');
  assert.equal(events.rows[1].reason, 'Rep A moved territory');

  const audit = await pool.query(
    `select action from audit_log where subject_id = $1 and action = 'account.reassign'`, [accountId],
  );
  assert.equal(audit.rows.length, 1, 'privileged action is audited');
});

test('ownership history is append-only', async () => {
  const accountId = await seedAccount();
  await claimAccount(accountId, repA);
  await assert.rejects(
    () => pool.query(`update ownership_events set reason = 'rewritten' where account_id = $1`, [accountId]),
    /append-only/,
  );
});

test('the claim ceiling is enforced inside the transaction', async () => {
  const limited = await makeUser('Capped Rep');
  await pool.query('update users set active_claim_target = 2 where user_id = $1', [limited.userId]);
  const actor = { ...limited, activeClaimTarget: 2 };

  const ids: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    ids.push(await seedAccount({
      canonicalName: `Capped Co ${i}`, website: `https://capped${i}.com`, phone: `904-555-02${10 + i}`,
    }));
  }
  const result = await claimAccounts(ids, actor);
  assert.equal(result.claimed, 2);
  assert.equal(result.results.filter((r) => r.reason === 'CLAIM_LIMIT').length, 2);
});

test('CONCURRENCY (heavy): eight simultaneous claimers still yield one owner', async () => {
  const accountId = await seedAccount();
  const contenders = await Promise.all(
    Array.from({ length: 8 }, (_, i) => makeUser(`Contender ${i}`)),
  );

  const outcomes = await Promise.all(contenders.map((rep) => claimAccount(accountId, rep)));
  assert.equal(outcomes.filter((o) => o.ok).length, 1, 'exactly one of eight claims wins');
  assert.equal(outcomes.filter((o) => o.reason === 'ALREADY_CLAIMED').length, 7);

  const events = await pool.query(
    `select count(*)::int as n from ownership_events where account_id = $1 and event_type = 'CLAIMED'`,
    [accountId],
  );
  assert.equal(events.rows[0].n, 1);
});
