import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { drainQueue, recordHeartbeat } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import '../src/workers/contactResearch.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters, storedResultType,
  type DiscoveryAdapter, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch, discoveryFingerprint } from '../src/workers/enqueue.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { createDataForSeoAdapter, type DataForSeoConfig } from '../src/miner/dataForSeoAdapter.js';
import { pendingProviderTasks } from '../src/miner/providerTasks.js';
import { reconcileMissingResearch } from '../src/workers/researchReconcile.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * The failures we actually had.
 * Authority: Issue #3 Phase T.
 *
 * Every one of these was observed on this machine or found by reading this code
 * during the audit. They are covered in depth by the suite that fixed each one; this
 * file exists so that the list of things that must never happen again is readable in
 * one place, named after what went wrong rather than after the module it lives in.
 *
 * If one of these fails, something the operator already caught us doing has come
 * back.
 */

let manager: Awaited<ReturnType<typeof makeUser>>;
let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  manager = await makeUser('Regression Manager', 'SALES_MANAGER');
});

async function mine(zip = '32095'): Promise<Record<string, any>> {
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: zip,
    marketId: null, requestedBy: manager.userId });
  await drainQueue(20);
  const { rows } = await query<Record<string, any>>(
    'select outcome, outcome_reason, progress from jobs where job_id = $1', [job.jobId]);
  return rows[0]!;
}

function adapter(result: Partial<DiscoveryResult> & { status: DiscoveryResult['status'] }): DiscoveryAdapter {
  return {
    name: 'dataforseo', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        businesses: [], providerRows: 0, rejectedRows: 0, duplicateRows: 0, ...result };
    },
  };
}

// 1 ---------------------------------------------------------------------------
test('1. ZIP 32095 with no discovery adapter is not a zero-result search', async () => {
  // Observed live: "Researching 32095 now" then "Succeeded, 0 found", with no
  // provider registered. The operator concluded 32095 had no businesses in it.
  const job = await mine('32095');
  assert.equal(job['outcome'], 'DISCOVERY_BLOCKED');
  assert.notEqual(job['outcome'], 'ZERO_RESULTS');
  assert.match(String(job['outcome_reason']), /No search provider is configured/);
});

// 2 ---------------------------------------------------------------------------
test('2. a worker service that is running an older build is not healthy', async () => {
  await recordHeartbeat({ processed: 1 });
  const { rows } = await query<{ filename: string }>(
    'select filename from schema_migrations order by filename desc limit 1');
  await query('delete from schema_migrations where filename = $1', [rows[0]!.filename]);
  try {
    const snapshot = await operationalSnapshot();
    assert.equal(snapshot.checks.find((c) => c.id === 'schema')!.state, 'BLOCKED',
      'systemd said active, the database said otherwise, and the page said fine');
  } finally {
    await resetDatabase();
  }
});

// 3 ---------------------------------------------------------------------------
test('3. a queued job with no worker reads blocked, not healthy', async () => {
  await query(
    `insert into jobs (job_type, status, payload) values ('market_mine','QUEUED','{}'::jsonb)`);
  const snapshot = await operationalSnapshot();
  assert.equal(snapshot.checks.find((c) => c.id === 'worker')!.state, 'BLOCKED',
    'zero stranded jobs was read as a healthy queue');
});

// 4 ---------------------------------------------------------------------------
test('4. a provider task outlives the worker and is collected, not re-bought', async () => {
  let submissions = 0;
  registerDiscoveryAdapter({
    name: 'dataforseo', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      submissions += 1;
      return { status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0,
        duplicateRows: 0, providerTaskId: 'historical-task' };
    },
    async collect(taskId: string): Promise<DiscoveryResult> {
      return {
        status: 'OK',
        businesses: [{ name: 'Collected After Restart', website: null, phone: '904-555-1101' }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, providerTaskId: taskId,
      };
    },
  });

  const first = await mine();
  assert.equal(first['outcome'], 'PROVIDER_PENDING');
  assert.equal((await pendingProviderTasks('dataforseo')).length, 1);

  const second = await mine();
  assert.equal(second['outcome'], 'COMPLETED');
  assert.equal(submissions, 1, 'the same search was purchased twice');
});

// 5 ---------------------------------------------------------------------------
test('5. a provider that searched and found nothing is a genuine zero', async () => {
  registerDiscoveryAdapter(adapter({ status: 'ZERO_RESULTS' }));
  const job = await mine();
  assert.equal(job['outcome'], 'ZERO_RESULTS');
});

// 6 ---------------------------------------------------------------------------
test('6. a provider that found only companies we hold is coverage, not zero', async () => {
  sequence += 1;
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Already Ours', website: `https://hist${sequence}.invalid`,
    phone: '904-555-1201', city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: 'apollo_purchased_import' }));

  registerDiscoveryAdapter(adapter({
    status: 'OK', providerRows: 1,
    businesses: [{ name: 'Already Ours', website: null, phone: '904-555-1201' }],
  }));

  const job = await mine();
  assert.equal(job['outcome'], 'COMPLETED');
  const progress = job['progress'] as Record<string, number>;
  assert.equal(progress['matchedExisting'], 1);
  assert.equal(progress['discoveredNew'], 0);
});

// 7 ---------------------------------------------------------------------------
test('7. a provider finding an Apollo company keeps one Account and both sources', async () => {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Dual Provenance Co', website: `https://hist${sequence}.invalid`,
    phone: '904-555-1301', city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: 'apollo_purchased_import' }));

  registerDiscoveryAdapter(adapter({
    status: 'OK', providerRows: 1,
    businesses: [{ name: 'Dual Provenance Co', website: null, phone: '904-555-1301' }],
  }));
  await mine();

  const { rows: accounts } = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(accounts[0]!.n, 1);

  const { rows: facts } = await query<{ activity_type: string; source_system: string }>(
    `select activity_type, source_system from activities
      where account_id = $1 and activity_type in ('DISCOVERED','SOURCE_OBSERVED')`, [accountId]);
  const seen = facts.map((row) => `${row.activity_type}:${row.source_system}`);
  assert.ok(seen.includes('DISCOVERED:apollo_purchased_import'));
  assert.ok(seen.some((fact) => fact.startsWith('SOURCE_OBSERVED:market_miner:')));
});

// 8 ---------------------------------------------------------------------------
test('8. the provider is not asked for "advertiser_first hvac 32095"', async () => {
  const captured: any[] = [];
  const config: DataForSeoConfig = {
    login: 'u', password: 'p', baseUrl: 'https://api.example.invalid/v3', mode: 'live',
    governanceReviewed: true, enabled: true, maxQueriesPerRun: 25, resultDepth: 100,
    maxRetries: 0, maxPollAttempts: 1, pollIntervalMs: 0,
  };
  const provider = createDataForSeoAdapter({
    config,
    transport: async (_url: string, init: any) => {
      captured.push(JSON.parse(init.body)[0]);
      return { ok: true, status: 200,
        json: async () => ({ tasks: [{ id: 't', status_code: 20000, result: [] }] }) };
    },
    sleep: async () => {},
  });

  await provider.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville, FL',
    miningMode: 'advertiser_first', queryBudget: 5,
  });

  assert.equal(captured.length, 1);
  assert.ok(!/advertiser_first/.test(captured[0].keyword),
    'the strategy name was sent as a search term');
  assert.equal(captured[0].keyword, 'AC repair');
  assert.equal(captured[0].location_name, 'Jacksonville,Florida,United States');
});

// 9 ---------------------------------------------------------------------------
test('9. spellings of one market are one paid request', () => {
  const fingerprints = new Set([
    'Jacksonville, FL', 'jacksonville, fl', ' Jacksonville , Florida ',
  ].map((value) => discoveryFingerprint({
    geographyType: 'city', geographyValue: value, verticalProfileId: 'hvac' })));
  assert.equal(fingerprints.size, 1, [...fingerprints].join(' | '));
});

// 10 --------------------------------------------------------------------------
test('10. a discovered Account is researched rather than left as a name', async () => {
  registerDiscoveryAdapter(adapter({
    status: 'OK', providerRows: 1,
    businesses: [{ name: 'Gets Researched', website: null, phone: '904-555-1401' }],
  }));
  await mine();

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'account_research'`);
  assert.equal(rows[0]!.n, 1);
});

// 11 --------------------------------------------------------------------------
test('11. an Account whose research is RUNNING is not queued behind itself', async () => {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Being Researched', website: `https://hist${sequence}.invalid`,
    phone: '904-555-1501', city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await query(
    `update accounts set created_at = now() - interval '1 hour' where account_id = $1`,
    [accountId]);
  await query(
    `insert into jobs (job_type, account_id, status, payload, idempotency_key)
     values ('account_research', $1, 'RUNNING', '{}'::jsonb, $2)`,
    [accountId, `account_research:${accountId}`]);

  assert.equal((await reconcileMissingResearch()).queued, 0,
    'a leased research job was duplicated by the sweep');
});

// 12 --------------------------------------------------------------------------
test('12. an operator can retry an Account the sweep is holding back', async () => {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Held Back', website: `https://hist${sequence}.invalid`,
    phone: '904-555-1601', city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await query(
    `update accounts set created_at = now() - interval '1 hour' where account_id = $1`,
    [accountId]);
  await query(
    `insert into jobs (job_type, account_id, status, payload, completed_at, attempts, max_attempts)
     values ('account_research', $1, 'FAILED', '{}'::jsonb, now(), 3, 3)`, [accountId]);

  assert.equal((await reconcileMissingResearch()).queued, 0);
  const { enqueueAccountResearch } = await import('../src/workers/enqueue.js');
  const manual = await enqueueAccountResearch(accountId, manager.userId, 'human_requested');
  assert.equal(manual.created, true, 'held became unretryable');
});

// 13 --------------------------------------------------------------------------
test('13. a discovery-triggered research run is not recorded as human requested', async () => {
  registerDiscoveryAdapter(adapter({
    status: 'OK', providerRows: 1,
    businesses: [{ name: 'Trigger Check Co', website: null, phone: '904-555-1701' }],
  }));
  await mine();
  await drainQueue(20);

  const { rows } = await query<{ trigger: string }>(
    `select r.trigger from research_runs r join accounts a on a.account_id = r.account_id
      where a.canonical_name = 'Trigger Check Co'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.trigger, 'newly_discovered');
});

// 14 --------------------------------------------------------------------------
test('14. a real provider result type is one the database accepts', async () => {
  // Every value the DataForSEO adapter produces was rejected by the check
  // constraint, so the first row of the first real discovery would have thrown.
  for (const [adapterWord, stored] of [
    ['PAID_SEARCH_TEXT', 'paid_search'],
    ['PAID_LOCAL', 'sponsored_local'],
    ['LOCAL_SERVICES_AD', 'local_service_ad'],
    ['MAPS_LOCAL', 'local_result'],
    ['ORGANIC', 'organic'],
  ] as const) {
    assert.equal(storedResultType(adapterWord), stored, adapterWord);
  }

  registerDiscoveryAdapter(adapter({
    status: 'OK', providerRows: 1,
    businesses: [{
      name: 'Typed Result Co', website: null, phone: '904-555-1801',
      resultType: 'PAID_SEARCH_TEXT',
    }],
  }));
  const job = await mine();
  assert.equal(job['outcome'], 'COMPLETED', 'ingestion threw on the provider result type');

  const { rows } = await query<{ result_type: string }>(
    'select result_type from search_observations');
  assert.equal(rows[0]!.result_type, 'paid_search');
});

// 15 --------------------------------------------------------------------------
test('15. the miner KPI counts what the miner writes', async () => {
  const { miningKpis } = await import('../src/api/waveCQueries.js');
  registerDiscoveryAdapter(adapter({
    status: 'OK', providerRows: 1,
    businesses: [{ name: 'Counted Co', website: null, phone: '904-555-1901' }],
  }));
  await mine();

  const kpis = await miningKpis();
  assert.equal(kpis.discoveredByMinerToday, 1,
    'the KPI matched bare provider names and the miner writes market_miner:<provider>');
});
