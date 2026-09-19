import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { upsertAccount, upsertEndpoint } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { createOpportunity } from '../src/domain/opportunities.js';
import { mergeAccounts, resolveAccountId } from '../src/domain/merge.js';
import { searchProspects } from '../src/domain/search.js';

/**
 * Merging two records that turned out to be one company.
 * Authority: data-contract SS7 (identity resolution), rep-ownership-data-model.md SS12.
 *
 * Automatic resolution is deliberately conservative, so duplicates reach a human.
 * What matters here is that the human's decision loses nothing: not the suppression,
 * not the promised callback, not the opportunity, not the timeline, and not the id
 * that has already been in somebody's URL bar.
 *
 * Unmerge is not supported, and the last test in this file says so rather than
 * pretending otherwise.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

let sequence = 0;

async function makeAccount(name: string, overrides: {
  city?: string; postalCode?: string; domain?: string;
} = {}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name,
      website: overrides.domain ?? `https://merge${sequence}.invalid`,
      phone: `904-555-${String(5000 + sequence).slice(-4)}`,
      city: overrides.city ?? 'Jacksonville', state: 'FL',
      postalCode: overrides.postalCode ?? '32256',
    }, { discoverySource: 'merge-test' }));
  return accountId;
}

async function withStatement(accountId: string, userId: string): Promise<void> {
  await query(
    `insert into prospect_statements (account_id, category, statement_text, source_class,
                                      confidence, captured_by)
     values ($1, 'workflow', 'Two of my guys spend every morning calling people back.',
             'prospect_verified', 'confirmed', $2)`, [accountId, userId]);
}

// --- who may merge, and on what grounds -------------------------------------------

test('a rep cannot merge, because a merge moves somebody else’s book', async () => {
  const rep = await makeUser('Merging Rep');
  const surviving = await makeAccount('Survivor Co');
  const merged = await makeAccount('Duplicate Co');

  const result = await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same company, two spellings.',
  }, rep);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
});

test('a merge without a reason is refused', async () => {
  const manager = await makeUser('Merge Manager', 'SALES_MANAGER');
  const surviving = await makeAccount('Reason Survivor');
  const merged = await makeAccount('Reason Duplicate');

  const result = await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged, reason: '   ',
  }, manager);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'REASON_REQUIRED');
});

test('nothing merges because one field matched', async () => {
  // Two businesses at one phone number: a strip mall, an answering service, a shared
  // reception desk. Automatic resolution leaves them alone, which is what makes the
  // manual merge necessary and safe.
  await withTransaction(async (client) => {
    await upsertAccount(client, {
      canonicalName: 'Shared Line Plumbing', website: 'https://sharedplumbing.invalid',
      phone: '904-555-6001', city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'merge-test' });
    await upsertAccount(client, {
      canonicalName: 'Shared Line Roofing', website: 'https://sharedroofing.invalid',
      phone: '904-555-6001', city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'merge-test' });
  });
  const { rows } = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(rows[0]!.n, 2, 'a shared phone number merged two companies automatically');
});

// --- what a merge must not lose ----------------------------------------------------

test('a merge moves the whole record and loses nothing', async () => {
  const manager = await makeUser('Moving Manager', 'SALES_MANAGER');
  const rep = await makeUser('Moving Rep');
  // Two genuinely separate records: the same normalised name in the same city would
  // have been resolved into one Account at write time, which is the automatic
  // resolution working. What reaches a manual merge is a pair the resolver left
  // alone -- here, a trading name in a different city.
  const surviving = await makeAccount('Coastal Air & Heat');
  const merged = await makeAccount('Alvarez Comfort Services',
    { domain: 'https://coastalairheat2.invalid', city: 'Orange Park', postalCode: '32073' });

  await claimAccount(merged, rep);
  await withStatement(merged, rep.userId);
  await recordDisposition({
    accountId: merged, disposition: 'CALLBACK_REQUESTED', prospectRequested: true,
    callbackDueAt: new Date(Date.now() + 86_400_000),
    notes: 'He asked me to try him Thursday.',
  }, rep);
  const opportunity = await createOpportunity({
    accountId: merged,
    problemSummary: 'Two techs spend every morning returning calls from overnight.',
    sourceChannel: 'human_rep',
  }, rep);
  assert.equal(opportunity.ok, true);
  await query(
    `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, meeting_type,
                                   idempotency_key, requested_start, requested_end, status,
                                   provider, provider_event_id, confirmed_at, created_by)
     values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'merge-1',
             now() + interval '1 day', now() + interval '1 day' + interval '15 minutes',
             'CONFIRMED', 'calcom', 'evt-merge-1', now(), $2)`, [merged, rep.userId]);
  await withTransaction((client) => upsertEndpoint(client, {
    accountId: merged, contactId: null, locationId: null, type: 'EMAIL',
    rawValue: 'office@coastalairheat2.invalid', endpointRole: 'GENERAL_BUSINESS_EMAIL',
    relationshipToPerson: 'ROLE_INBOX', qualityState: 'PUBLIC_OBSERVED_CURRENT',
    source: 'COMPANY_WEBSITE', sourceReference: null, verifiedAt: null,
  }));

  const result = await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same company: same owner, same address, the LLC is the trading name.',
    matchRule: 'manual_review',
  }, manager);
  assert.equal(result.ok, true, `merge refused: ${JSON.stringify(result)}`);

  const after = await query<{
    statements: number; followups: number; opportunities: number; meetings: number;
    endpoints: number; activities: number; ownership_events: number;
  }>(
    `select (select count(*)::int from prospect_statements where account_id = $1) as statements,
            (select count(*)::int from follow_ups where account_id = $1 and status = 'OPEN') as followups,
            (select count(*)::int from opportunities where account_id = $1) as opportunities,
            (select count(*)::int from meeting_bookings where account_id = $1) as meetings,
            (select count(*)::int from contact_endpoints where account_id = $1) as endpoints,
            (select count(*)::int from activities where account_id = $1) as activities,
            (select count(*)::int from ownership_events where account_id = $1) as ownership_events`,
    [surviving]);
  const row = after.rows[0]!;
  assert.equal(row.statements, 1, 'what the prospect said was lost');
  assert.equal(row.followups, 1, 'the promised callback was lost');
  assert.equal(row.opportunities, 1, 'the opportunity was lost');
  assert.equal(row.meetings, 1, 'the confirmed meeting was lost');
  assert.ok(row.endpoints >= 3, `only ${row.endpoints} endpoints moved`);
  assert.ok(row.activities >= 2, 'the timeline was lost');
  assert.ok(row.ownership_events >= 1, 'the ownership history was lost');

  // Nothing is left pointing at the merged record.
  const orphans = await query<{ n: number }>(
    `select (select count(*)::int from follow_ups where account_id = $1)
          + (select count(*)::int from opportunities where account_id = $1)
          + (select count(*)::int from prospect_statements where account_id = $1)
          + (select count(*)::int from contact_endpoints where account_id = $1) as n`,
    [merged]);
  assert.equal(orphans.rows[0]!.n, 0, 'rows were left pointing at the merged record');
});

test('the survivor inherits the owner when only one record was claimed', async () => {
  const manager = await makeUser('Owner Manager', 'SALES_MANAGER');
  const rep = await makeUser('Owning Rep');
  const surviving = await makeAccount('Unclaimed Survivor');
  const merged = await makeAccount('Claimed Duplicate');
  await claimAccount(merged, rep);

  const result = await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Two records, one company.',
  }, manager);
  assert.equal(result.ok, true);

  const after = await query<{ ownership_state: string; current_owner_user_id: string | null }>(
    'select ownership_state, current_owner_user_id from accounts where account_id = $1',
    [surviving]);
  assert.equal(after.rows[0]!.current_owner_user_id, rep.userId,
    'the rep who was working the company lost it in the merge');
  assert.equal(after.rows[0]!.ownership_state, 'CLAIMED');
});

test('two owners is a decision a manager has to make, not a default', async () => {
  const manager = await makeUser('Deciding Manager', 'SALES_MANAGER');
  const first = await makeUser('First Owner');
  const second = await makeUser('Second Owner');
  const surviving = await makeAccount('Contested Survivor');
  const merged = await makeAccount('Contested Duplicate');
  await claimAccount(surviving, first);
  await claimAccount(merged, second);

  const refused = await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same company, both reps found it.',
  }, manager);
  assert.equal(refused.ok, false, 'a merge silently took a rep’s Account');
  assert.equal(refused.reason, 'OWNER_CONFLICT');
  assert.match(refused.message ?? '', /tell the other rep/i);

  // And the owner named has to be one of the two.
  const wrongOwner = await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same company.', keepOwnerUserId: manager.userId,
  }, manager);
  assert.equal(wrongOwner.ok, false);

  const decided = await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same company; giving it to the rep who spoke to them.',
    keepOwnerUserId: second.userId,
  }, manager);
  assert.equal(decided.ok, true);

  const after = await query<{ current_owner_user_id: string }>(
    'select current_owner_user_id from accounts where account_id = $1', [surviving]);
  assert.equal(after.rows[0]!.current_owner_user_id, second.userId);

  // The change of hands is in the ownership ledger, not only in the merge record.
  const events = await query<{ event_type: string; reason: string }>(
    `select event_type, reason from ownership_events
      where account_id = $1 and event_type = 'REASSIGNED'`, [surviving]);
  assert.equal(events.rowCount, 1, 'the merge moved ownership without an ownership event');
  assert.match(events.rows[0]!.reason, /Merged with/);
});

test('a suppression on either record survives the merge', async () => {
  const manager = await makeUser('Suppression Manager', 'SALES_MANAGER');
  const rep = await makeUser('Suppression Rep');
  const surviving = await makeAccount('Workable Survivor');
  const merged = await makeAccount('Suppressed Duplicate');
  await claimAccount(surviving, rep);
  await query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'Asked us to stop.')`, [merged]);

  const result = await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same company under two names.',
  }, manager);
  assert.equal(result.ok, true);

  const after = await query<{ is_suppressed: boolean; ownership_state: string;
                             current_owner_user_id: string | null }>(
    `select is_suppressed, ownership_state, current_owner_user_id
       from accounts where account_id = $1`, [surviving]);
  assert.equal(after.rows[0]!.is_suppressed, true,
    'a merge resurrected a company that had asked us to stop');
  assert.equal(after.rows[0]!.ownership_state, 'SUPPRESSED');
  assert.equal(after.rows[0]!.current_owner_user_id, null,
    'a suppressed company kept an owner after a merge');

  // And it is out of claimable inventory.
  const search = await searchProspects({ ownership: 'UNCLAIMED', page: 1, pageSize: 50 },
    { userId: rep.userId, role: 'SALES_REP' });
  assert.equal(search.results.some((row) => row.account_id === surviving), false,
    'a suppressed company came back as claimable inventory after a merge');
});

test('the merged record keeps its id and redirects', async () => {
  const manager = await makeUser('Redirect Manager', 'SALES_MANAGER');
  const surviving = await makeAccount('Redirect Survivor');
  const merged = await makeAccount('Redirect Duplicate');

  await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'One company, two records.',
  }, manager);

  // The id still resolves -- it has been in URLs and in other systems' records of us.
  const resolved = await resolveAccountId(pool, merged);
  assert.equal(resolved, surviving, 'a merged id no longer resolves to anything');
  assert.equal(await resolveAccountId(pool, surviving), surviving);

  // And the tombstone is out of every working surface.
  const inventory = await query<{ n: number }>(
    'select count(*)::int as n from prospect_inventory where account_id = $1', [merged]);
  assert.equal(inventory.rows[0]!.n, 0, 'a merged record is still in the prospect list');
});

test('a chain of merges resolves to the last survivor', async () => {
  const manager = await makeUser('Chain Manager', 'SALES_MANAGER');
  const first = await makeAccount('Chain One');
  const second = await makeAccount('Chain Two');
  const third = await makeAccount('Chain Three');

  await mergeAccounts({ survivingAccountId: second, mergedAccountId: first,
    reason: 'Same company.' }, manager);
  await mergeAccounts({ survivingAccountId: third, mergedAccountId: second,
    reason: 'Also the same company.' }, manager);

  assert.equal(await resolveAccountId(pool, first), third,
    'a two-hop merge chain does not resolve');
  assert.equal(await resolveAccountId(pool, second), third);
});

test('a merged record cannot be merged again', async () => {
  const manager = await makeUser('Double Merge Manager', 'SALES_MANAGER');
  const surviving = await makeAccount('Double Survivor');
  const merged = await makeAccount('Double Duplicate');
  const other = await makeAccount('Double Other');

  await mergeAccounts({ survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same company.' }, manager);
  const again = await mergeAccounts({ survivingAccountId: other, mergedAccountId: merged,
    reason: 'Trying again.' }, manager);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'ALREADY_MERGED');
});

test('a manager can see why two records were considered one company', async () => {
  const manager = await makeUser('Explaining Manager', 'SALES_MANAGER');
  const rep = await makeUser('Explaining Rep');
  const surviving = await makeAccount('Explained Survivor');
  const merged = await makeAccount('Explained Duplicate');
  await claimAccount(merged, rep);
  await recordDisposition({
    accountId: merged, disposition: 'NO_ANSWER', notes: 'rang out',
  }, rep);

  await mergeAccounts({
    survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same licence number on the state register.', matchRule: 'manual_review',
  }, manager);

  const { rows } = await query<{
    reason: string; match_rule: string; moved_counts: Record<string, number>;
    detail: Record<string, unknown>; actor_user_id: string;
  }>('select * from account_merges where surviving_account_id = $1', [surviving]);
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.reason, /licence number/);
  assert.equal(rows[0]!.match_rule, 'manual_review');
  assert.equal(rows[0]!.actor_user_id, manager.userId);
  assert.ok(Object.keys(rows[0]!.moved_counts).length > 0, 'nothing recorded about what moved');
  assert.ok(rows[0]!.moved_counts['activities']! >= 1);
  assert.equal((rows[0]!.detail as { merged_name: string }).merged_name, 'Explained Duplicate');

  // And it is in the audit trail a manager reads.
  const audit = await query<{ action: string; reason: string }>(
    `select action, reason from audit_log where action = 'account.merge'`);
  assert.equal(audit.rowCount, 1);
  assert.match(audit.rows[0]!.reason, /licence number/);
});

test('the survivor keeps the better score and the fresher research', async () => {
  const manager = await makeUser('Scoring Manager', 'SALES_MANAGER');
  const surviving = await makeAccount('Thin Survivor');
  const merged = await makeAccount('Researched Duplicate');
  await query(
    `update accounts set manual_score = 4, manual_tier = 'C',
            last_researched_at = now() - interval '200 days' where account_id = $1`, [surviving]);
  await query(
    `update accounts set manual_score = 13, manual_tier = 'A',
            last_researched_at = now() - interval '2 days',
            research_fresh_until = now() + interval '20 days' where account_id = $1`, [merged]);

  await mergeAccounts({ survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'One company; the second record is the researched one.' }, manager);

  const after = await query<{ manual_score: number; manual_tier: string;
                             last_researched_at: Date }>(
    'select manual_score, manual_tier, last_researched_at from accounts where account_id = $1',
    [surviving]);
  assert.equal(after.rows[0]!.manual_score, 13, 'the better score was discarded');
  assert.equal(after.rows[0]!.manual_tier, 'A', 'the better tier was discarded');
  assert.ok(Date.now() - after.rows[0]!.last_researched_at.getTime() < 5 * 86_400_000,
    'the fresher research date was discarded');
});

test('the survivor keeps the further-along relationship state', async () => {
  const manager = await makeUser('Relationship Manager', 'SALES_MANAGER');
  const rep = await makeUser('Relationship Rep');
  const surviving = await makeAccount('Cold Survivor');
  const merged = await makeAccount('Engaged Duplicate');
  await claimAccount(merged, rep);
  await recordDisposition({
    accountId: merged, disposition: 'DECISION_MAKER_REACHED', notes: 'spoke to the owner',
  }, rep);

  await mergeAccounts({ survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same company.' }, manager);

  const after = await query<{ relationship_state: string }>(
    'select relationship_state from accounts where account_id = $1', [surviving]);
  assert.equal(after.rows[0]!.relationship_state, 'ENGAGED',
    'a merge reset a company we had spoken to back to cold');
});

// --- the honest limit ---------------------------------------------------------------

test('unmerge is not supported, and nothing pretends it is', async () => {
  // Undoing a merge honestly would mean knowing which of the survivor's rows came
  // from which original after both have been worked -- and a call logged tomorrow
  // belongs to neither. An unmerge would restore a fiction or silently drop work.
  // What exists instead is the record of what happened.
  const module = await import('../src/domain/merge.js');
  const exported = Object.keys(module);
  for (const name of ['unmergeAccounts', 'splitAccount', 'undoMerge', 'revertMerge']) {
    assert.equal(exported.includes(name), false,
      `${name} exists; if unmerge is now supported this test should test it`);
  }

  // And the thing that is offered is complete enough to repair by hand: the
  // tombstone, the counts, the reason and the actor.
  const manager = await makeUser('Honest Manager', 'SALES_MANAGER');
  const surviving = await makeAccount('Honest Survivor');
  const merged = await makeAccount('Honest Duplicate');
  await mergeAccounts({ survivingAccountId: surviving, mergedAccountId: merged,
    reason: 'Same company.' }, manager);

  const record = await query<{ merged_account_id: string; moved_counts: Record<string, number>;
                              reason: string; actor_user_id: string }>(
    'select merged_account_id, moved_counts, reason, actor_user_id from account_merges');
  assert.equal(record.rowCount, 1);
  assert.equal(record.rows[0]!.merged_account_id, merged);
  const tombstone = await query<{ canonical_name: string; merged_into_account_id: string;
                                 merged_at: Date }>(
    'select canonical_name, merged_into_account_id, merged_at from accounts where account_id = $1',
    [merged]);
  assert.equal(tombstone.rows[0]!.canonical_name, 'Honest Duplicate',
    'the merged record lost its own name, so the repair would be guesswork');
  assert.equal(tombstone.rows[0]!.merged_into_account_id, surviving);
  assert.ok(tombstone.rows[0]!.merged_at);
});
