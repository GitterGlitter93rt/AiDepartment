import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import {
  refreshDuplicateQueue, openDuplicateCandidates, decideDuplicate, duplicateQueueCounts,
} from '../src/domain/duplicateReview.js';
import { operationalSnapshot } from '../src/api/operations.js';

/**
 * The near-misses identity resolution refuses to merge, put in front of a person.
 * Authority: Issue #3 K.
 *
 * Resolution is conservative on purpose: two roofers on one answering-service number
 * are usually two companies, and merging them would put one rep's call history on
 * another rep's prospect. Its own comment has always said a weak match "must create a
 * review case, never an automatic merge" -- and nothing created one, so the
 * near-misses simply became two Accounts with nothing pointing them out.
 *
 * Meanwhile the operations page counted accounts sharing a normalized name. A number
 * an operator cannot act on is a number they stop reading: "7 possible duplicates",
 * for ever, going nowhere.
 *
 * What makes a queue finite is a decision that is remembered. Most of this file is
 * about that: "not a duplicate" has to mean the pair never comes back, or the queue
 * is the same count with more clicks.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

/**
 * Creates an Account without letting resolution collapse it into an existing one.
 *
 * Two companies with the same name in the same place cannot be created through
 * `upsertAccount`: rule five merges them on normalized name plus geography, which is
 * correct. The collision this queue exists for arrives later -- a company gains a
 * city from a listings source and only then collides with a record resolution never
 * compared it against. So the fixture creates them apart and brings them together,
 * which is the sequence that happens in the real system.
 */
async function account(input: {
  name: string; website?: string | null; phone?: string | null;
  city?: string | null; state?: string | null;
}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: input.name,
    website: input.website ?? null,
    phone: input.phone ?? null,
    // Created with no geography, so resolution has nothing to merge on.
    city: null, state: null, postalCode: null,
    verticalProfileId: 'roofing',
  }, { discoverySource: `import-${sequence}` }));

  const city = input.city === undefined ? 'St. Augustine' : input.city;
  const state = input.state === undefined ? 'FL' : input.state;
  if (city || state) {
    await query(
      `insert into locations (account_id, location_type, city, state_region, postal_code)
       values ($1, 'service_area', $2, $3, '32095')`, [accountId, city, state]);
  }
  return accountId;
}

// ------------------------------------------------------- what gets queued -------

test('two companies with the same name in the same place are queued', async () => {
  await account({ name: 'Salazar Roofing', website: 'https://salazar-a.invalid' });
  await account({ name: 'Salazar Roofing', website: 'https://salazar-b.invalid' });

  const result = await refreshDuplicateQueue();
  assert.equal(result.queued, 1, `queued ${result.queued} of ${result.found} found`);

  const [candidate] = await openDuplicateCandidates();
  assert.equal(candidate!.candidateRule, 'same_name_same_place');
  assert.ok(candidate!.evidenceFor.some((reason) => /Identical company name/.test(reason)));
  assert.ok(candidate!.evidenceAgainst.some((reason) => /Different websites/.test(reason)),
    'the case against was not put, so a person has only half the picture');
});

test('two names on one phone line are queued with the case against stated', async () => {
  await account({ name: 'Ace Plumbing', phone: '904-555-0500' });
  await account({ name: 'Ace Roofing', phone: '904-555-0500' });

  await refreshDuplicateQueue();
  const candidate = (await openDuplicateCandidates())
    .find((entry) => entry.candidateRule === 'shared_phone_different_names')!;
  assert.ok(candidate, 'a shared line between two trades was not raised at all');
  assert.ok(candidate.evidenceAgainst.some(
    (reason) => /strip mall, a shared office or an answering service/.test(reason)),
    'the queue presents a shared phone as evidence of one business');
});

test('a name contained in another, in one place, is queued', async () => {
  await account({ name: 'Roofing' });
  await account({ name: 'Salazar Roofing and Repair' });

  await refreshDuplicateQueue();
  const candidate = (await openDuplicateCandidates())
    .find((entry) => entry.candidateRule === 'name_subset_same_place')!;
  assert.ok(candidate, 'the heading-absorbs-a-real-company case was not raised');
  assert.ok(candidate.evidenceFor.some((reason) => /is contained in/.test(reason)));
});

test('two live Accounts cannot share a domain at all', async () => {
  // Checked rather than assumed while building the platform-page candidate rule:
  // `accounts.canonical_domain` has a unique index, so a second Account on one domain
  // is either resolved onto the first or refused by the database. The rule is kept in
  // the vocabulary and never produced, and the wording that would present a shared
  // Facebook page as evidence of one company stays as a guard.
  const a = await account({ name: 'Domain One', website: 'https://shared-domain.invalid' });
  const b = await account({ name: 'Domain Two', website: 'https://shared-domain.invalid' });
  assert.equal(a, b,
    'two Accounts were created on one domain, so the domain rule is not resolving');

  await assert.rejects(
    () => query(
      `insert into accounts (canonical_name, normalized_name, canonical_domain)
       values ('Forced Collision', 'forced collision', 'shared-domain.invalid')`),
    /unique|duplicate key/i,
    'the database allowed two Accounts to claim one domain');
});

test('companies in different cities with one name are not queued', async () => {
  await account({ name: 'Premier Roofing', city: 'St. Augustine', state: 'FL' });
  await account({ name: 'Premier Roofing', city: 'Austin', state: 'TX' });

  const result = await refreshDuplicateQueue();
  assert.equal(result.queued, 0,
    'two independent firms sharing a name across states were queued as duplicates');
});

test('a suppressed company is never offered for merging', async () => {
  const a = await account({ name: 'Quiet Roofing', website: 'https://quiet-a.invalid' });
  await account({ name: 'Quiet Roofing', website: 'https://quiet-b.invalid' });
  await query(
    `update accounts set is_suppressed = true, suppression_summary = 'asked not to'
      where account_id = $1`, [a]);

  const result = await refreshDuplicateQueue();
  assert.equal(result.queued, 0,
    'a company that asked not to be contacted was offered up for merging');
});

// ------------------------------------------------- a decision that is remembered --

test('"not a duplicate" is remembered, so the pair never comes back', async () => {
  await account({ name: 'Twin Roofing', website: 'https://twin-a.invalid' });
  await account({ name: 'Twin Roofing', website: 'https://twin-b.invalid' });
  await refreshDuplicateQueue();

  const [candidate] = await openDuplicateCandidates();
  const manager = await makeUser(`Dup Manager ${Date.now()}`, 'SALES_MANAGER');
  const decided = await decideDuplicate({
    duplicateReviewId: candidate!.duplicateReviewId,
    decision: 'NOT_DUPLICATE', decidedBy: manager.userId,
    decidedByRole: 'SALES_MANAGER', note: 'Two brothers, two businesses.',
  });
  assert.equal(decided.ok, true, decided.reason);

  assert.deepEqual(await openDuplicateCandidates(), [],
    'the queue still shows a pair somebody has already judged');

  // And a later sweep does not raise it again, which is the whole point.
  const again = await refreshDuplicateQueue();
  assert.equal(again.queued, 0);
  assert.equal(again.alreadyDecided, 1);
  assert.deepEqual(await openDuplicateCandidates(), [],
    'a decision was forgotten, so the operator judges the same pair every week');
});

test('a decision is written to the audit trail with its note', async () => {
  await account({ name: 'Audit Roofing', website: 'https://audit-a.invalid' });
  await account({ name: 'Audit Roofing', website: 'https://audit-b.invalid' });
  await refreshDuplicateQueue();
  const [candidate] = await openDuplicateCandidates();
  const manager = await makeUser(`Dup Audit ${Date.now()}`, 'SALES_MANAGER');

  await decideDuplicate({
    duplicateReviewId: candidate!.duplicateReviewId, decision: 'NOT_DUPLICATE',
    decidedBy: manager.userId, decidedByRole: 'SALES_MANAGER', note: 'Different owners.',
  });

  const { rows } = await query<{ action: string; detail: any }>(
    `select action, detail from audit_log where subject_type = 'duplicate_review'`);
  assert.equal(rows[0]!.action, 'duplicate.not_duplicate');
  assert.match(String(rows[0]!.detail.note), /Different owners/);
});

test('deciding a pair twice is refused rather than silently repeated', async () => {
  await account({ name: 'Once Roofing', website: 'https://once-a.invalid' });
  await account({ name: 'Once Roofing', website: 'https://once-b.invalid' });
  await refreshDuplicateQueue();
  const [candidate] = await openDuplicateCandidates();
  const manager = await makeUser(`Dup Twice ${Date.now()}`, 'SALES_MANAGER');

  await decideDuplicate({
    duplicateReviewId: candidate!.duplicateReviewId, decision: 'NOT_DUPLICATE',
    decidedBy: manager.userId, decidedByRole: 'SALES_MANAGER' });
  const second = await decideDuplicate({
    duplicateReviewId: candidate!.duplicateReviewId, decision: 'MERGED',
    decidedBy: manager.userId, decidedByRole: 'SALES_MANAGER',
    survivingAccountId: candidate!.accountAId });

  assert.equal(second.ok, false);
  assert.match(second.reason!, /already decided/);
});

// ---------------------------------------------------------------- merging -------

test('a merge from the queue goes through the manager gate, not around it', async () => {
  const a = await account({ name: 'Gate Roofing', website: 'https://gate-a.invalid' });
  await account({ name: 'Gate Roofing', website: 'https://gate-b.invalid' });
  await refreshDuplicateQueue();
  const [candidate] = await openDuplicateCandidates();

  const rep = await makeUser(`Dup Rep ${Date.now()}`, 'SALES_REP');
  const refused = await decideDuplicate({
    duplicateReviewId: candidate!.duplicateReviewId, decision: 'MERGED',
    decidedBy: rep.userId, decidedByRole: 'SALES_REP', survivingAccountId: a });

  assert.equal(refused.ok, false,
    'a rep merged two Accounts from the review queue, moving another rep’s work');
  assert.match(refused.reason!, /manager/i);

  // And the pair is still open, because nothing was decided.
  assert.equal((await openDuplicateCandidates()).length, 1);
});

test('a merge has to say which of the two survives', async () => {
  await account({ name: 'Survive Roofing', website: 'https://survive-a.invalid' });
  await account({ name: 'Survive Roofing', website: 'https://survive-b.invalid' });
  await refreshDuplicateQueue();
  const [candidate] = await openDuplicateCandidates();
  const manager = await makeUser(`Dup Survive ${Date.now()}`, 'SALES_MANAGER');

  const noSurvivor = await decideDuplicate({
    duplicateReviewId: candidate!.duplicateReviewId, decision: 'MERGED',
    decidedBy: manager.userId, decidedByRole: 'SALES_MANAGER' });
  assert.equal(noSurvivor.ok, false);
  assert.match(noSurvivor.reason!, /which of the two survives/);

  const wrongSurvivor = await decideDuplicate({
    duplicateReviewId: candidate!.duplicateReviewId, decision: 'MERGED',
    decidedBy: manager.userId, decidedByRole: 'SALES_MANAGER',
    survivingAccountId: '00000000-0000-0000-0000-000000000000' });
  assert.equal(wrongSurvivor.ok, false,
    'a merge named a survivor that is not one of the pair');
});

test('a merge from the queue leaves a tombstone and the queue empty', async () => {
  const a = await account({ name: 'Merge Roofing', website: 'https://merge-a.invalid' });
  const b = await account({ name: 'Merge Roofing', website: 'https://merge-b.invalid' });
  await refreshDuplicateQueue();
  const [candidate] = await openDuplicateCandidates();
  const manager = await makeUser(`Dup Merge ${Date.now()}`, 'SALES_MANAGER');

  const merged = await decideDuplicate({
    duplicateReviewId: candidate!.duplicateReviewId, decision: 'MERGED',
    decidedBy: manager.userId, decidedByRole: 'SALES_MANAGER',
    survivingAccountId: candidate!.accountAId, note: 'One company, entered twice.' });
  assert.equal(merged.ok, true, merged.reason);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts
      where account_id in ($1, $2) and merged_into_account_id is not null`, [a, b]);
  assert.equal(rows[0]!.n, 1, 'the merge left no redirect behind');
  assert.deepEqual(await openDuplicateCandidates(), []);

  const counts = await duplicateQueueCounts();
  assert.equal(counts.merged, 1);
  assert.equal(counts.open, 0);
});

test('a rep’s claim survives a merge decided from the queue', async () => {
  const a = await account({ name: 'Claimed Roofing', website: 'https://claimed-a.invalid' });
  await account({ name: 'Claimed Roofing', website: 'https://claimed-b.invalid' });
  const rep = await makeUser(`Dup Claim Rep ${Date.now()}`, 'SALES_REP');
  await claimAccount(a, { userId: rep.userId, role: 'SALES_REP', activeClaimTarget: null });

  await refreshDuplicateQueue();
  const [candidate] = await openDuplicateCandidates();
  const manager = await makeUser(`Dup Claim Manager ${Date.now()}`, 'SALES_MANAGER');
  await decideDuplicate({
    duplicateReviewId: candidate!.duplicateReviewId, decision: 'MERGED',
    decidedBy: manager.userId, decidedByRole: 'SALES_MANAGER', survivingAccountId: a });

  const { rows } = await query<{ current_owner_user_id: string | null }>(
    'select current_owner_user_id from accounts where account_id = $1', [a]);
  assert.equal(rows[0]!.current_owner_user_id, rep.userId,
    'merging from the queue took the surviving company away from the rep working it');
});

// -------------------------------------------------------------- the panel -------

test('the operations page reports what is waiting, not what merely looks alike', async () => {
  await account({ name: 'Panel Roofing', website: 'https://panel-a.invalid' });
  await account({ name: 'Panel Roofing', website: 'https://panel-b.invalid' });
  await refreshDuplicateQueue();

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'duplicate_queue')!;
  assert.match(check.value, /1 pair\(s\) to judge/);
  assert.match(check.detail!, /the queue empties rather than resetting/,
    'the panel does not say that a decision is remembered');
});

test('an empty queue says what has already been settled', async () => {
  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'duplicate_queue')!;
  assert.equal(check.state, 'OK');
  assert.match(check.value, /nothing waiting/);
  assert.match(check.detail!, /never asked about again/);
});
