import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  reconcileMissingResearch, strandedResearchCount, scoreUnscoredResearched,
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

// ------------------------------------------------- every automated source -------

test('a company found by business listings is rescued, not stranded for ever', async () => {
  // The sweep matched 'market_miner:%' alone. When business listings became a second
  // discovery source, a company it found and failed to queue research for was
  // invisible to the very sweep that exists to catch exactly that -- the crash
  // window reopened for the new source, in silence.
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Listings Stranded Co', website: 'https://listingsstranded.invalid',
    phone: '904-555-9401', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'listings:fixture' }));
  await query(
    `update accounts set created_at = now() - interval '2 hours' where account_id = $1`,
    [accountId]);

  const result = await reconcileMissingResearch();
  assert.ok(result.stranded >= 1,
    'a company discovered by a listings source was never seen by the sweep');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs
      where account_id = $1 and job_type in ('account_research','contact_research')`,
    [accountId]);
  assert.equal(rows[0]!.n, 1, 'no research was queued for the stranded company');
});

test('every automated discovery source the product writes is covered by the sweep', async () => {
  // The durable half of the fix. A third source added later gets the same defect
  // unless somebody remembers this predicate, so the prefixes are enumerated in code
  // and checked against what the product actually writes.
  const { AUTOMATED_DISCOVERY_PREFIXES } = await import('../src/domain/discoverySources.js');
  const sources = new Set<string>();
  for (const file of ['../src/workers/marketMiner.ts', '../src/miner/listingsIngest.ts']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const match of text.matchAll(/discoverySource: `([a-z_]+):/g)) {
      sources.add(`${match[1]!}:`);
    }
  }
  assert.ok(sources.size >= 2, `found only ${[...sources].join(', ')}`);

  const uncovered = [...sources].filter(
    (source) => !(AUTOMATED_DISCOVERY_PREFIXES as readonly string[]).includes(source));
  assert.deepEqual(uncovered, [],
    `these discovery sources create Accounts the stranded-research sweep will never `
    + `rescue: ${uncovered.join(', ')}`);
});

test('an imported company is still the operator’s decision, not the sweep’s', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Imported Co', website: 'https://importedco.invalid',
    phone: '904-555-9402', city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: 'import' }));
  await query(
    `update accounts set created_at = now() - interval '2 hours' where account_id = $1`,
    [accountId]);

  const result = await reconcileMissingResearch();
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where account_id = $1`, [accountId]);
  assert.equal(rows[0]!.n, 0,
    'the sweep queued research for a company an operator chose to add themselves');
  assert.ok(result.stranded >= 0);
});

// ------------------------------------------ researched, and never scored -------

/**
 * The gap between the two sweeps.
 *
 * `reconcileMissingResearch` covers Accounts with no research at all.
 * `recomputeStaleScores` covers Accounts that already have a tier under an older
 * ruleset. An Account researched and then not scored fell between them and stayed
 * there -- unranked, so no rep ever saw it -- while the doctor told the operator the
 * worker would back-fill it on its sweep. Nothing did.
 *
 * Scoring runs after the research transaction commits, deliberately, so a scoring
 * fault cannot roll back a crawl. The gap is the ordinary outcome of that fault.
 */
async function researchedAccount(name: string): Promise<string> {
  const accountId = await discoveredAccount(name);
  await query(
    `update accounts set last_researched_at = now(),
            research_fresh_until = now() + interval '30 days'
      where account_id = $1`, [accountId]);
  return accountId;
}

test('a company we researched and never scored is picked up and scored', async () => {
  const accountId = await researchedAccount('Unscored Roofing');
  const before = await query<{ tier: string | null }>(
    'select manual_tier as tier from accounts where account_id = $1', [accountId]);
  assert.equal(before.rows[0]!.tier, null, 'the fixture is already scored');

  const result = await scoreUnscoredResearched();
  assert.ok(result.unscored >= 1);
  assert.ok(result.scored >= 1, 'nothing back-filled the score the doctor promises');

  const after = await query<{ tier: string | null; version: string | null }>(
    'select manual_tier as tier, score_version as version from accounts where account_id = $1',
    [accountId]);
  assert.ok(after.rows[0]!.tier, 'the Account is still unranked, so no rep will see it');
  assert.ok(after.rows[0]!.version, 'a score with no policy version cannot be compared');
});

test('a company nothing has researched is not counted as a scoring failure', async () => {
  // The other half, and the one the live box was actually in: the doctor counted
  // every Account without a tier and called them researched companies with no score.
  // Six of them had never been looked at. A false alarm sends an operator to fix a
  // scoring step for companies no scoring step has reached.
  await discoveredAccount('Never Researched Roofing');

  const result = await scoreUnscoredResearched();
  assert.equal(result.unscored, 0, 'an unresearched company was queued for scoring');

  const { captureDiagnostics, diagnose } = await import('../src/release/doctor.js');
  const state = await captureDiagnostics();
  assert.ok(state.scoring.unscored > 0, 'the fixture no longer tests the distinction');
  assert.equal(state.scoring.researchedUnscored, 0);
  assert.ok(!diagnose(state).some((item) => item.category === 'SCORING_FAILED'),
    'a company nobody has researched was reported as a scoring failure');
});

test('the back-fill leaves suppressed and merged companies alone', async () => {
  const suppressed = await researchedAccount('Suppressed Roofing');
  await query('update accounts set is_suppressed = true where account_id = $1', [suppressed]);
  const merged = await researchedAccount('Merged Roofing');
  const survivor = await researchedAccount('Survivor Roofing');
  await query('update accounts set merged_into_account_id = $2 where account_id = $1',
    [merged, survivor]);

  const result = await scoreUnscoredResearched();
  assert.equal(result.unscored, 1, 'a suppressed or merged company was queued for scoring');

  const { rows } = await query<{ tier: string | null }>(
    'select manual_tier as tier from accounts where account_id = any($1)',
    [[suppressed, merged]]);
  for (const row of rows) {
    assert.equal(row.tier, null, 'scoring reached a company it must not touch');
  }
});
