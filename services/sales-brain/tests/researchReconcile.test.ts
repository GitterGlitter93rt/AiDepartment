import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import '../src/workers/contactResearch.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters,
  type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch, enqueueAccountResearch } from '../src/workers/enqueue.js';
import {
  reconcileMissingResearch, strandedResearchCount,
  STRANDED_AFTER_MINUTES, RETRY_AFTER_FAILURE_HOURS,
} from '../src/workers/researchReconcile.js';
import { researchTrigger } from '../src/workers/contactResearch.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Companies discovered and then forgotten.
 * Authority: Issue #3 Phase I.
 *
 * Discovery creates Accounts one transaction at a time and queues their research
 * afterwards. A worker that dies in between leaves companies that exist, have never
 * been researched, have no research queued, and have nothing that will ever notice
 * -- a name and a phone number in inventory for ever.
 */

let manager: Awaited<ReturnType<typeof makeUser>>;
let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  manager = await makeUser('Reconcile Ops', 'SALES_MANAGER');
});

/** An Account exactly as discovery leaves it, with its provenance activity. */
async function discoveredAccount(name: string, options: {
  ageMinutes?: number; source?: string;
} = {}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: `https://reconcile${sequence}.invalid`,
    phone: `904-555-${String(4000 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: options.source ?? 'market_miner:dataforseo' }));

  const age = options.ageMinutes ?? STRANDED_AFTER_MINUTES + 5;
  await query(
    `update accounts set created_at = now() - ($2 || ' minutes')::interval
      where account_id = $1`, [accountId, String(age)]);
  return accountId;
}

test('a discovered Account whose research was never queued is found and queued', async () => {
  const accountId = await discoveredAccount('Stranded Roofing');

  assert.equal(await strandedResearchCount(), 1,
    'the crash left a company nothing was going to look at again');

  const result = await reconcileMissingResearch();
  assert.equal(result.stranded, 1);
  assert.equal(result.queued, 1);

  const { rows } = await query<{ job_type: string; status: string; payload: any }>(
    `select job_type, status, payload from jobs where account_id = $1`, [accountId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.job_type, 'account_research');
  assert.equal(rows[0]!.payload.trigger, 'newly_discovered');
});

test('an Account still inside its grace period is left alone', async () => {
  // Discovery queues research immediately after the transaction. A sweep that fires
  // in that window would race it for no reason.
  await discoveredAccount('Just Created Roofing', { ageMinutes: 0 });
  assert.equal(await strandedResearchCount(), 0);
  assert.equal((await reconcileMissingResearch()).queued, 0);
});

test('an Account that already has research queued is not queued again', async () => {
  const accountId = await discoveredAccount('Already Queued Roofing');
  await enqueueAccountResearch(accountId, null, 'newly_discovered');

  assert.equal(await strandedResearchCount(), 0);
  const result = await reconcileMissingResearch();
  assert.equal(result.queued, 0);

  const { rows } = await query<{ n: number }>(
    'select count(*)::int as n from jobs where account_id = $1', [accountId]);
  assert.equal(rows[0]!.n, 1, 'the sweep queued a second research job for one account');
});

test('an Account whose research is running is not queued behind itself', async () => {
  // QUEUED is not the only in-flight state. A worker holding the lease has the job
  // RUNNING, and a sweep that only looked for QUEUED would queue a second one
  // alongside the one already doing the work.
  const accountId = await discoveredAccount('In Flight Roofing');
  await query(
    `insert into jobs (job_type, account_id, status, payload, idempotency_key)
     values ('account_research', $1, 'RUNNING', '{}'::jsonb, $2)`,
    [accountId, `account_research:${accountId}`]);

  assert.equal(await strandedResearchCount(), 0);
  assert.equal((await reconcileMissingResearch()).queued, 0);

  const { rows } = await query<{ n: number }>(
    'select count(*)::int as n from jobs where account_id = $1', [accountId]);
  assert.equal(rows[0]!.n, 1);
});

test('an operator can still retry an Account the sweep is holding back', async () => {
  // Held is not abandoned. The loop stops; the ability to try again does not.
  const accountId = await discoveredAccount('Held Roofing');
  await query(
    `insert into jobs (job_type, account_id, status, payload, completed_at, attempts, max_attempts)
     values ('account_research', $1, 'FAILED', '{}'::jsonb, now(), 3, 3)`, [accountId]);

  const held = await reconcileMissingResearch();
  assert.equal(held.queued, 0);
  assert.equal(held.heldAfterFailure, 1);

  // A person asking for it by hand is not the sweep, and is not refused.
  const manual = await enqueueAccountResearch(accountId, manager.userId, 'human_requested');
  assert.equal(manual.created, true, 'an operator could not retry a held account');

  const { rows } = await query<{ status: string; payload: any }>(
    `select status, payload from jobs where account_id = $1 and status = 'QUEUED'`, [accountId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.payload.trigger, 'human_requested');
});

test('an Account that has been researched is not researched again', async () => {
  const accountId = await discoveredAccount('Done Roofing');
  await query(
    `insert into research_runs (account_id, trigger, status, completed_at)
     values ($1, 'newly_discovered', 'completed', now())`, [accountId]);
  await query('update accounts set last_researched_at = now() where account_id = $1', [accountId]);

  assert.equal(await strandedResearchCount(), 0);
  assert.equal((await reconcileMissingResearch()).queued, 0);
});

test('an imported Account is not researched by the sweep', async () => {
  // A list the operator chose to load is theirs to decide about. Researching two
  // hundred and thirty companies because a CSV landed is a spending decision, not a
  // repair.
  await discoveredAccount('Imported Roofing', { source: 'import' });
  await discoveredAccount('Apollo Roofing', { source: 'apollo_purchased_import' });

  assert.equal(await strandedResearchCount(), 0);
  assert.equal((await reconcileMissingResearch()).queued, 0);
});

test('a suppressed Account is not researched', async () => {
  const accountId = await discoveredAccount('Suppressed Roofing');
  await query('update accounts set is_suppressed = true where account_id = $1', [accountId]);

  assert.equal(await strandedResearchCount(), 0);
  assert.equal((await reconcileMissingResearch()).queued, 0);
});

test('a merged Account is not researched', async () => {
  const survivor = await discoveredAccount('Survivor Roofing');
  const tombstone = await discoveredAccount('Tombstone Roofing');
  await query(
    'update accounts set merged_into_account_id = $2 where account_id = $1',
    [tombstone, survivor]);

  assert.equal(await strandedResearchCount(), 1, 'only the survivor is stranded');
  const result = await reconcileMissingResearch();
  assert.equal(result.queued, 1);

  const { rows } = await query<{ n: number }>(
    'select count(*)::int as n from jobs where account_id = $1', [tombstone]);
  assert.equal(rows[0]!.n, 0, 'a tombstone is a redirect, not a company to research');
});

test('a permanently failing Account is not re-queued every sweep for ever', async () => {
  const accountId = await discoveredAccount('Broken Roofing');
  await query(
    `insert into jobs (job_type, account_id, status, payload, completed_at, attempts, max_attempts)
     values ('account_research', $1, 'FAILED', '{}'::jsonb, now(), 3, 3)`, [accountId]);

  const result = await reconcileMissingResearch();
  assert.equal(result.queued, 0, 'the sweep would re-queue a broken account every 15 minutes');
  assert.equal(result.heldAfterFailure, 1);
  assert.equal(result.stranded, 1,
    'it is still counted as stranded, because an operator needs to see it');
});

test('a failure old enough to be worth retrying is retried', async () => {
  const accountId = await discoveredAccount('Old Failure Roofing');
  await query(
    `insert into jobs (job_type, account_id, status, payload, completed_at, attempts, max_attempts)
     values ('account_research', $1, 'FAILED', '{}'::jsonb,
             now() - ($2 || ' hours')::interval, 3, 3)`,
    [accountId, String(RETRY_AFTER_FAILURE_HOURS + 1)]);

  const result = await reconcileMissingResearch();
  assert.equal(result.queued, 1);
  assert.equal(result.heldAfterFailure, 0);
});

test('the sweep is safe to run twice in a row', async () => {
  await discoveredAccount('Twice Roofing');
  const first = await reconcileMissingResearch();
  const second = await reconcileMissingResearch();

  assert.equal(first.queued, 1);
  assert.equal(second.queued, 0, 'the second pass queued the same work again');
});

test('the operations panel says when companies are stranded', async () => {
  const clean = await operationalSnapshot();
  assert.equal(clean.checks.find((check) => check.id === 'research_backlog')!.state, 'OK');

  await discoveredAccount('Visible Stranded Roofing');
  const stranded = await operationalSnapshot();
  const check = stranded.checks.find((item) => item.id === 'research_backlog')!;
  assert.equal(check.state, 'ATTENTION');
  assert.match(check.value, /1 stranded/);
  assert.match(check.detail ?? '', /never been researched/);
});

// ------------------------------------------------------- what caused a run --

test('a research run records what actually asked for it', () => {
  // Every run ever written said `human_requested`, whatever caused it, so "research
  // runs completed today" could not be attributed to anything.
  assert.equal(researchTrigger('newly_discovered'), 'newly_discovered');
  assert.equal(researchTrigger('scheduled_refresh'), 'scheduled_refresh');
  assert.equal(researchTrigger('discovered'), 'newly_discovered',
    "the miner's own word maps onto the column's vocabulary");
  assert.equal(researchTrigger('human_requested'), 'human_requested');
  assert.equal(researchTrigger('something-nobody-defined'), 'human_requested',
    'an unknown label falls back rather than failing a research run over a word');
  assert.equal(researchTrigger(null), 'human_requested');
});

test('a discovered company is researched under the trigger that discovered it', async () => {
  registerDiscoveryAdapter({
    name: 'trigger-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'OK',
        businesses: [{ name: 'Triggered Roofing', website: null, phone: '904-555-4901' }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0,
      };
    },
  });

  const job = await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: manager.userId });
  assert.ok(job.created);
  await drainQueue(10);

  const { rows } = await query<{ trigger: string }>(
    `select r.trigger from research_runs r
       join accounts a on a.account_id = r.account_id
      where a.canonical_name = 'Triggered Roofing'`);
  assert.equal(rows.length, 1, 'the discovered company was never researched');
  assert.equal(rows[0]!.trigger, 'newly_discovered',
    'a nightly sweep, a discovery and a rep pressing a button all recorded the same way');
});
