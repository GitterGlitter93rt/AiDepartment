import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase, markEntityVerified } from './helpers.js';
import { sourceHealth } from '../src/domain/sourceHealth.js';
import { loadSnapshot } from '../src/sources/snapshots.js';

/**
 * The fleet view, for whoever has to fix things.
 *
 * Different audience from the per-account panel and different failure modes: an
 * operator needs to see a source that has answered "could not look" two hundred times,
 * and a rep never should.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function runWithOutcomes(outcomes: unknown[], ageDays = 1): Promise<void> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Health Co ${sequence}`,
    website: `https://health${sequence}.invalid`,
    phone: `512-555-${String(6000 + sequence).slice(-4)}`,
    city: 'Austin', state: 'TX', postalCode: '78701', verticalProfileId: 'plumbing',
  }, { discoverySource: 'market_miner:test' }));
  await markEntityVerified(accountId);
  await query(
    `insert into research_runs (account_id, trigger, status, adapter_results, completed_at)
     values ($1,'newly_discovered','completed',$2::jsonb, now() - ($3 || ' days')::interval)`,
    [accountId, JSON.stringify({ official_sources: outcomes }), String(ageDays)]);
}

test('every governed source appears, whether or not it has ever run', async () => {
  const health = await sourceHealth();
  const ids = health.map((entry) => entry.sourceId);
  for (const expected of ['fl_sunbiz', 'fl_dbpr', 'tx_comptroller', 'tx_tdlr',
    'tx_tsbpe', 'tx_state_bar', 'tx_sosdirect']) {
    assert.ok(ids.includes(expected), `${expected} is invisible to operators`);
  }
});

test('the paid source is shown as never called, by design', async () => {
  const sos = (await sourceHealth()).find((entry) => entry.sourceId === 'tx_sosdirect')!;
  assert.equal(sos.enabled, false);
  assert.equal(sos.governanceStatus, 'DISABLED_PAID_SOURCE');
  assert.match(sos.verdict, /never called, by design/i);
  assert.equal(sos.lookups, 0);
});

test('a blocked source says its parser is ready if access changes', async () => {
  const sunbiz = (await sourceHealth()).find((entry) => entry.sourceId === 'fl_sunbiz')!;
  assert.equal(sunbiz.governanceStatus, 'BLOCKED');
  assert.match(sunbiz.verdict, /does not permit automated access/i);
  assert.match(sunbiz.verdict, /ready if that changes/i);
});

test('a flagged-off source is described as one sign-off away', async () => {
  const tdlr = (await sourceHealth()).find((entry) => entry.sourceId === 'tx_tdlr')!;
  assert.equal(tdlr.enabled, false);
  assert.match(tdlr.verdict, /switched off|sign-off/i);
});

test('lookup outcomes are counted per source', async () => {
  await runWithOutcomes([
    { sourceId: 'tx_comptroller', status: 'MATCHED' },
    { sourceId: 'tx_tsbpe', status: 'SOURCE_UNAVAILABLE' },
  ]);
  await runWithOutcomes([
    { sourceId: 'tx_comptroller', status: 'AMBIGUOUS' },
    { sourceId: 'tx_tsbpe', status: 'SOURCE_UNAVAILABLE' },
  ]);

  const health = await sourceHealth();
  const comptroller = health.find((entry) => entry.sourceId === 'tx_comptroller')!;
  assert.equal(comptroller.counts.MATCHED, 1);
  assert.equal(comptroller.counts.AMBIGUOUS, 1);
  assert.equal(comptroller.lookups, 2);
  assert.ok(comptroller.lastMatchedAt, 'the last successful match was not recorded');

  const tsbpe = health.find((entry) => entry.sourceId === 'tx_tsbpe')!;
  assert.equal(tsbpe.counts.SOURCE_UNAVAILABLE, 2);
  assert.ok(tsbpe.lastUnavailableAt);
});

test('outcomes outside the window are not counted', async () => {
  await runWithOutcomes([{ sourceId: 'tx_comptroller', status: 'MATCHED' }], 90);
  const comptroller = (await sourceHealth(30))
    .find((entry) => entry.sourceId === 'tx_comptroller')!;
  assert.equal(comptroller.lookups, 0, 'a three-month-old run was reported as recent');
});

test('a snapshot-backed source with no dataset says every lookup cannot look', async () => {
  const tsbpe = (await sourceHealth()).find((entry) => entry.sourceId === 'tx_tsbpe')!;
  assert.ok(tsbpe.snapshot, 'a snapshot-backed source reported no snapshot state');
  assert.equal(tsbpe.snapshot!.state, 'MISSING');
});

test('a loaded dataset shows its record count and parser version', async () => {
  await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v3',
    content: 'License Number,License Type,Licensee Name\nM-1,Responsible Master Plumber,A B',
    records: [{ matchCompanyName: 'X', licenseNumber: 'M-1', payload: { a: 1 } }],
  });
  const tsbpe = (await sourceHealth()).find((entry) => entry.sourceId === 'tx_tsbpe')!;
  assert.equal(tsbpe.snapshot!.recordCount, 1);
  assert.equal(tsbpe.snapshot!.parserVersion, 'v3');
  assert.equal(tsbpe.snapshot!.state, 'CURRENT');
});

test('the health read is one query however many sources there are', async () => {
  // Guards the shape rather than the timing: a loop-per-source page gets slower every
  // week as runs accumulate, and that is not visible until it is.
  await runWithOutcomes([
    { sourceId: 'tx_comptroller', status: 'MATCHED' },
    { sourceId: 'tx_tdlr', status: 'NO_MATCH' },
    { sourceId: 'fl_dbpr', status: 'SOURCE_UNAVAILABLE' },
  ]);
  const { SOURCE_GOVERNANCE } = await import('../src/sources/governance.js');
  const health = await sourceHealth();
  // Against the governance list rather than a number, so adding a source does not
  // silently drop it from the operator view and leave a passing test behind.
  assert.equal(health.length, SOURCE_GOVERNANCE.length);
  assert.equal(health.find((e) => e.sourceId === 'tx_tdlr')!.counts.NO_MATCH, 1);
  assert.equal(health.find((e) => e.sourceId === 'fl_dbpr')!.counts.SOURCE_UNAVAILABLE, 1);
});
