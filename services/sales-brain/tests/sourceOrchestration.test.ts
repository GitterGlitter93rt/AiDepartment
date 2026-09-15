import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase, markEntityVerified } from './helpers.js';
import { runOfficialSources } from '../src/sources/run.js';
import { createTsbpeAdapter, createTdlrAdapter, createComptrollerAdapter,
  type Fetcher } from '../src/sources/registry.js';
import { loadSnapshot, currentSnapshot, checksumOf } from '../src/sources/snapshots.js';
import { parseTsbpeDataset } from '../src/sources/adapters/txTsbpe.js';
import type { SourceAdapter, SourceLookupContext } from '../src/sources/types.js';
import * as fixtures from './support/fixtures/sources/index.js';

/**
 * Orchestration, which is mostly about failure.
 *
 * The interesting cases are all the ones where something goes wrong: a source times
 * out, throws, refuses us, or returns two companies it cannot tell apart. In every
 * one of them the account must keep what other sources established, and must never
 * acquire a fact from a record that was not decisively its own.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function seedAccount(input: {
  name: string; city: string; state: string; postalCode: string; vertical: string;
}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: input.name,
    website: `https://src${sequence}.invalid`,
    phone: `512-555-${String(1000 + sequence).slice(-4)}`,
    city: input.city, state: input.state, postalCode: input.postalCode,
    verticalProfileId: input.vertical,
  }, { discoverySource: 'market_miner:test' }));
  await markEntityVerified(accountId);
  return accountId;
}

function context(overrides: Partial<SourceLookupContext> = {}): SourceLookupContext {
  return {
    accountId: 'a', companyName: 'Lone Star Drain Works LLC', stateRegion: 'TX',
    city: 'Austin', postalCode: '78701', domain: null, verticalProfileId: 'plumbing',
    knownPhones: [], streetAddress: null, ...overrides,
  };
}

const fixtureFetcher = (body: string): Fetcher => async (url) =>
  ({ ok: true, body, finalUrl: url });

/** An adapter that behaves badly, to prove misbehaviour is contained. */
function brokenAdapter(behaviour: 'throw' | 'hang'): SourceAdapter {
  return {
    id: 'tx_comptroller', displayName: 'Broken', sourceClass: 'PUBLIC_COMPANY_REGISTRY',
    stage: 'B_public_company_registry', stateRegion: 'TX', timeoutMs: 150,
    availability: () => 'LIVE',
    supports: () => true,
    lookup: async () => {
      if (behaviour === 'throw') throw new Error('source exploded');
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { sourceId: 'tx_comptroller', status: 'MATCHED' as const, reason: 'late',
        sourceReference: null, capturedAt: new Date(), facts: [], people: [], endpoints: [] };
    },
  };
}

// ------------------------------------------------------------ snapshot store --

test('a dataset is loaded once and serves every account', async () => {
  const records = parseTsbpeDataset(fixtures.TSBPE_DATASET);
  const { snapshot, created } = await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET,
    records: records.map((record) => ({
      matchCompanyName: record.companyName, matchPersonName: record.licenseeName,
      licenseNumber: record.licenseNumber, city: record.city, stateRegion: 'TX',
      payload: record as unknown as Record<string, unknown>,
    })),
    sourceReference: 'https://tsbpe.texas.gov/example-dataset',
  });
  assert.equal(created, true);
  assert.equal(snapshot.recordCount, 4);
  assert.equal(snapshot.state, 'CURRENT');

  // Two accounts, one download.
  const adapter = createTsbpeAdapter();
  const first = await adapter.lookup(context());
  const second = await adapter.lookup(context());
  assert.equal(first.status, 'MATCHED');
  assert.equal(second.status, 'MATCHED');
  assert.equal(first.fromSnapshot?.snapshotId, second.fromSnapshot?.snapshotId);
});

test('loading identical content twice does not look like a refresh', async () => {
  const load = async () => loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET, records: [],
  });
  const first = await load();
  const second = await load();
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.snapshot.snapshotId, second.snapshot.snapshotId,
    'the same bytes produced a second snapshot');
});

test('a new snapshot supersedes the old one without deleting it', async () => {
  await loadSnapshot({ sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET, records: [] });
  await loadSnapshot({ sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DUPLICATE_COMPANY, records: [] });

  const { rows } = await query<{ state: string }>(
    `select state from source_snapshots where source_id = 'tx_tsbpe' order by created_at`);
  assert.deepEqual(rows.map((row) => row.state), ['SUPERSEDED', 'CURRENT'],
    'the previous snapshot was lost, so an earlier run cannot be explained');
});

test('a snapshot answer is dated from the download, not from now', async () => {
  const records = parseTsbpeDataset(fixtures.TSBPE_DATASET);
  await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET,
    records: records.map((record) => ({
      matchCompanyName: record.companyName, licenseNumber: record.licenseNumber,
      city: record.city, stateRegion: 'TX',
      payload: record as unknown as Record<string, unknown>,
    })),
  });
  // Age the snapshot as though it were downloaded months ago.
  await query(`update source_snapshots set downloaded_at = now() - interval '120 days'`);

  const result = await createTsbpeAdapter().lookup(context());
  assert.equal(result.status, 'MATCHED');
  const ageDays = (Date.now() - result.capturedAt.getTime()) / 86_400_000;
  assert.ok(ageDays > 100,
    'a four-month-old cached licence was presented as captured today');
});

test('no snapshot means we could not look, not that they are unlicensed', async () => {
  const result = await createTsbpeAdapter().lookup(context());
  assert.equal(result.status, 'SOURCE_UNAVAILABLE');
  assert.notEqual(result.status, 'NO_MATCH');
  assert.match(result.reason, /says nothing about the company/i);
});

test('one snapshot lookup does not read the whole dataset per account', async () => {
  const records = parseTsbpeDataset(fixtures.TSBPE_DATASET);
  await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET,
    records: records.map((record) => ({
      matchCompanyName: record.companyName, licenseNumber: record.licenseNumber,
      city: record.city, stateRegion: 'TX',
      payload: record as unknown as Record<string, unknown>,
    })),
  });
  const result = await createTsbpeAdapter().lookup(context());
  assert.equal(result.status, 'MATCHED');
  // Only the matched company's licences come back, not the other companies'.
  assert.ok(result.facts.every((fact) =>
    !fact.claimText.includes('GULF COAST') && !fact.claimText.includes('BLUEBONNET')),
  'another company’s licences were attached');
});

// ------------------------------------------------------------- orchestration --

test('a source that throws is recorded, and costs the account nothing', async () => {
  const result = await runOfficialSources({
    context: context(),
    adapters: [brokenAdapter('throw')],
  });
  const outcome = result.outcomes[0]!;
  assert.equal(outcome.status, 'SOURCE_UNAVAILABLE');
  assert.match(outcome.reason, /could not be read/i);
  assert.equal(result.facts.length, 0);
});

test('a source that hangs loses to its own clock', async () => {
  const startedAt = Date.now();
  const result = await runOfficialSources({
    context: context(), adapters: [brokenAdapter('hang')],
  });
  assert.ok(Date.now() - startedAt < 3_000, 'a hanging source held the research run open');
  assert.equal(result.outcomes[0]!.status, 'SOURCE_UNAVAILABLE');
  assert.match(result.outcomes[0]!.reason, /did not answer within/);
});

test('one source failing does not erase what another established', async () => {
  const records = parseTsbpeDataset(fixtures.TSBPE_DATASET);
  await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET,
    records: records.map((record) => ({
      matchCompanyName: record.companyName, licenseNumber: record.licenseNumber,
      city: record.city, stateRegion: 'TX',
      payload: record as unknown as Record<string, unknown>,
    })),
  });

  const result = await runOfficialSources({
    context: context(),
    adapters: [brokenAdapter('throw'), createTsbpeAdapter()],
  });
  assert.ok(result.facts.length > 0,
    'a licence that was successfully verified was lost because another source failed');
  assert.ok(result.people.some((person) => person.personName === 'JORDAN OKAFOR'));
  assert.equal(result.outcomes.length, 2);
});

test('an ambiguous match writes nothing at all', async () => {
  const records = parseTsbpeDataset(fixtures.TSBPE_DUPLICATE_COMPANY);
  await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DUPLICATE_COMPANY,
    records: records.map((record) => ({
      matchCompanyName: record.companyName, licenseNumber: record.licenseNumber,
      city: record.city, stateRegion: 'TX',
      payload: record as unknown as Record<string, unknown>,
    })),
  });

  const result = await runOfficialSources({
    context: context({ companyName: 'Statewide Plumbing Co', city: null, postalCode: null }),
    adapters: [createTsbpeAdapter()],
  });
  assert.equal(result.outcomes[0]!.status, 'AMBIGUOUS');
  assert.equal(result.facts.length, 0, 'an ambiguous match wrote facts');
  assert.equal(result.people.length, 0, 'an ambiguous match wrote people');
});

test('a paid source is refused without a request being made', async () => {
  const { createSosDirectAdapter } = await import('../src/sources/registry.js');
  const adapter = createSosDirectAdapter();
  assert.equal(adapter.availability(), 'DISABLED_PAID_SOURCE');
  const result = await runOfficialSources({ context: context(), adapters: [adapter] });
  // `supports` is false, so it is not even consulted.
  assert.equal(result.outcomes.length, 0);
  const direct = await adapter.lookup(context());
  assert.equal(direct.status, 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS');
  assert.match(direct.reason, /no spending is authorised/i);
});

test('a feature-flagged source makes no live call while its flag is unset', async () => {
  let fetched = false;
  const fetcher: Fetcher = async (url) => {
    fetched = true;
    return { ok: true, body: fixtures.COMPTROLLER_ACTIVE, finalUrl: url };
  };
  const result = await createComptrollerAdapter(fetcher).lookup(context());
  assert.equal(fetched, false, 'a disabled source made an HTTP request');
  assert.equal(result.status, 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS');
});

test('Texas roofing is not sent to a licence source at all', async () => {
  const result = await runOfficialSources({
    context: context({ verticalProfileId: 'roofing', companyName: 'Hill Country Roofing' }),
    adapters: [createTdlrAdapter(fixtureFetcher(fixtures.TDLR_HVAC_RESULTS)),
      createTsbpeAdapter()],
  });
  assert.equal(result.outcomes.length, 0, 'a trade Texas does not license was looked up anyway');
  const skipped = result.stagesSkipped
    .find((entry) => entry.stage === 'C_public_license_registry')!;
  assert.match(skipped.reason, /does not license roofing contractors statewide/i,
    'the skip reason did not say why there was nothing to look for');
});

test('a research context is built from the account, never from a searched ZIP', async () => {
  const accountId = await seedAccount({
    name: 'Lone Star Drain Works LLC', city: 'Austin', state: 'TX',
    postalCode: '78701', vertical: 'plumbing' });
  const { rows } = await query<{ city: string; postal_code: string; state_region: string }>(
    'select city, postal_code, state_region from locations where account_id = $1', [accountId]);
  assert.equal(rows[0]!.city, 'Austin');
  assert.equal(rows[0]!.postal_code, '78701');
  assert.equal(rows[0]!.state_region, 'TX');
});

test('checksums distinguish datasets', () => {
  assert.notEqual(checksumOf(fixtures.TSBPE_DATASET), checksumOf(fixtures.TSBPE_DUPLICATE_COMPANY));
  assert.equal(checksumOf(fixtures.TSBPE_DATASET), checksumOf(fixtures.TSBPE_DATASET));
});

test('currentSnapshot returns nothing before anything is loaded', async () => {
  assert.equal(await currentSnapshot('tx_tsbpe', 'licensees'), null);
});

// ------------------------------------------------- queueing research, once --

test('a newly discovered account queues research once, however often it is asked',
  async () => {
    const { enqueueAccountResearch } = await import('../src/workers/enqueue.js');
    const accountId = await seedAccount({
      name: 'Queue Once Plumbing', city: 'Austin', state: 'TX',
      postalCode: '78701', vertical: 'plumbing' });

    const first = await enqueueAccountResearch(accountId, null, 'newly_discovered');
    const second = await enqueueAccountResearch(accountId, null, 'newly_discovered');
    const third = await enqueueAccountResearch(accountId, null, 'scheduled_refresh');

    assert.equal(first.created, true);
    assert.equal(second.created, false, 'a repeated event queued a second research job');
    assert.equal(third.created, false,
      'a different trigger queued a duplicate job for the same account');

    const { rows } = await query<{ n: number }>(
      `select count(*)::int as n from jobs
        where job_type = 'account_research' and account_id = $1`, [accountId]);
    assert.equal(rows[0]!.n, 1, 'more than one research job exists for one account');
  });

test('research is retry-safe: a finished account can be researched again later',
  async () => {
    const { enqueueAccountResearch } = await import('../src/workers/enqueue.js');
    const accountId = await seedAccount({
      name: 'Retry Safe Plumbing', city: 'Austin', state: 'TX',
      postalCode: '78701', vertical: 'plumbing' });

    await enqueueAccountResearch(accountId, null, 'newly_discovered');
    // The first run finishes.
    await query(
      `update jobs set status = 'SUCCEEDED', completed_at = now()
        where job_type = 'account_research' and account_id = $1`, [accountId]);

    const later = await enqueueAccountResearch(accountId, null, 'scheduled_refresh');
    assert.equal(later.created, true,
      'an account could never be re-researched after its first run completed');
  });
