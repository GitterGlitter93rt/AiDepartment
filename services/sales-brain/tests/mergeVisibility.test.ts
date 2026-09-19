import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { mergeAccounts } from '../src/domain/merge.js';
import { searchProspects } from '../src/domain/search.js';
import { globalSearch, analyticsFunnel, analyticsBreakdown } from '../src/api/waveDQueries.js';
import { addCandidate } from '../src/domain/pilot.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * What a merged Account is allowed to look like afterwards.
 * Authority: Issue #2 sections I and J.
 *
 * A merge leaves a tombstone: the old id keeps working as a redirect so a link
 * somebody already sent still opens the company. prospect_inventory drops those rows,
 * so every list was right. The counters were not: the search total, the analytics
 * funnel and the breakdowns all read `accounts` directly and counted the tombstone as
 * a second company, and global search returned it as its own result -- carrying the
 * owner and the suppression flag it held before the merge, so a company put under Do
 * Not Contact could appear twice, once marked and once not.
 *
 * One rule: a tombstone is a redirect, never a row in a count and never a hit.
 */

let app: FastifyInstance;
let manager: Awaited<ReturnType<typeof makeUser>>;
let sequence = 0;

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  manager = await makeUser('Merge Manager', 'SALES_MANAGER');
});

async function makeAccount(name: string): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name,
      website: `https://mergevis${sequence}.invalid`,
      phone: `904-555-${String(6000 + sequence).slice(-4)}`,
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'merge-visibility-test' }));
  return accountId;
}

async function mergeInto(survivor: string, merged: string): Promise<void> {
  const result = await mergeAccounts({
    survivingAccountId: survivor, mergedAccountId: merged,
    reason: 'One company, two records.', keepOwnerUserId: null,
  }, manager);
  assert.ok(result.ok, `merge refused: ${JSON.stringify(result)}`);
}

test('the search total does not count a record that no longer exists', async () => {
  const survivor = await makeAccount('Northgate Air');
  const duplicate = await makeAccount('Northgate Air and Heating');
  await makeAccount('Riverbend Plumbing');

  const before = await searchProspects({ pageSize: 50 }, manager);
  assert.equal(before.total, 3);
  assert.equal(before.results.length, 3);

  await mergeInto(survivor, duplicate);

  const after = await searchProspects({ pageSize: 50 }, manager);
  assert.equal(after.results.length, 2, 'the list already dropped the tombstone');
  assert.equal(after.total, 2,
    'and the total above the list must agree with the rows underneath it');
});

test('global search returns one hit for a company that was merged', async () => {
  const survivor = await makeAccount('Coastal Roofing Northside');
  const duplicate = await makeAccount('Coastal Roofing Southbank');
  await mergeInto(survivor, duplicate);

  const hits = await globalSearch('coastal roofing', 25, { userId: manager.userId });
  assert.equal(hits.length, 1, `search returned ${hits.map((h) => h.companyName).join(', ')}`);
  assert.equal(hits[0]!.accountId, survivor, 'and it is the record that survived');
});

test('a merged record does not carry its old suppression state into search', async () => {
  const survivor = await makeAccount('Sable Run Roofing Mandarin');
  const duplicate = await makeAccount('Sable Run Roofing Westside');
  await mergeInto(survivor, duplicate);

  // The survivor is put under Do Not Contact after the merge.
  await query('update accounts set is_suppressed = true where account_id = $1', [survivor]);

  const hits = await globalSearch('sable run', 25, { userId: manager.userId });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.isSuppressed, true,
    'a tombstone that still reads unsuppressed is a second, unmarked copy of a DNC company');
});

test('a chain of merges still resolves to one company', async () => {
  const first = await makeAccount('Chain One');
  const second = await makeAccount('Chain Two');
  const third = await makeAccount('Chain Three');
  await mergeInto(second, first);
  await mergeInto(third, second);

  const hits = await globalSearch('chain', 25, { userId: manager.userId });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.accountId, third);
});

test('the analytics funnel does not count a merge as a second company', async () => {
  const survivor = await makeAccount('Funnel Survivor');
  const duplicate = await makeAccount('Funnel Duplicate');

  const before = await analyticsFunnel({
    fromDate: null, toDate: null, ownerUserId: null, verticalProfileId: null,
    marketId: null, channel: null, hook: null, outcome: null,
  } as never);
  assert.equal(Number(before.researched), 2);

  await mergeInto(survivor, duplicate);

  const after = await analyticsFunnel({
    fromDate: null, toDate: null, ownerUserId: null, verticalProfileId: null,
    marketId: null, channel: null, hook: null, outcome: null,
  } as never);
  assert.equal(Number(after.researched), 1,
    'every stage of the funnel was inflated by the number of merges the team had done');
});

test('an analytics breakdown does not count a merge as a second company', async () => {
  const survivor = await makeAccount('Breakdown Survivor');
  const duplicate = await makeAccount('Breakdown Duplicate');
  await mergeInto(survivor, duplicate);

  for (const dimension of ['vertical', 'owner'] as const) {
    const rows = await analyticsBreakdown(dimension);
    const total = rows.reduce((sum, row) => sum + Number(row.accounts), 0);
    assert.equal(total, 1, `${dimension} breakdown counted the tombstone`);
  }
});

test('a merged record cannot be added to the pilot list', async () => {
  const survivor = await makeAccount('Pilot Survivor');
  const duplicate = await makeAccount('Pilot Duplicate');
  await mergeInto(survivor, duplicate);

  const result = await addCandidate({ accountId: duplicate, actorUserId: manager.userId });
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /merged/i);

  const rows = await query('select pilot_candidate_id from pilot_candidates');
  assert.equal(rows.rows.length, 0);
});

test('the old id still opens the company it became', async () => {
  const survivor = await makeAccount('Redirect Survivor');
  const duplicate = await makeAccount('Redirect Duplicate');
  await mergeInto(survivor, duplicate);

  await createUser({
    email: 'merge.reader@test.local', displayName: 'Reader', role: 'SALES_MANAGER',
    password: 'merge-visibility-password' });
  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'merge.reader@test.local', password: 'merge-visibility-password' } });
  const cookie = `yad_sales_session=${login.cookies.find((c) => c.name === 'yad_sales_session')!.value}`;

  const response = await app.inject({
    method: 'GET', url: `/accounts/${duplicate}`, headers: { cookie } });
  assert.equal(response.statusCode, 301,
    'a link somebody already sent must still reach the company');
  assert.equal(response.headers.location, `/accounts/${survivor}`);
});


test('a merge leaves the surviving company with one head office', async () => {
  const survivor = await makeAccount('Head Office Survivor');
  const duplicate = await makeAccount('Head Office Duplicate');
  await query('update locations set is_headquarters = true where account_id = any($1)',
    [[survivor, duplicate]]);

  await mergeInto(survivor, duplicate);

  const { rows } = await query<{ headquarters: string }>(
    `select count(*) filter (where is_headquarters)::int as headquarters
       from locations where account_id = $1`, [survivor]);
  assert.equal(Number(rows[0]!.headquarters), 1,
    'two head offices make every join on that flag return the company twice');

  const hits = await globalSearch('head office', 25, { userId: manager.userId });
  assert.equal(hits.length, 1);
});
