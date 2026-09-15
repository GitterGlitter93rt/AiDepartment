import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { loadSnapshot, currentSnapshot } from '../src/sources/snapshots.js';
import { snapshotHealth, snapshotHistory, snapshotPolicyFor, allSnapshotHealth }
  from '../src/sources/snapshotPolicy.js';
import { parseTsbpeDataset } from '../src/sources/adapters/txTsbpe.js';
import * as fixtures from './support/fixtures/sources/index.js';

/**
 * A snapshot is the one place old data looks exactly like new data.
 *
 * A licence row read out of a file downloaded in March is indistinguishable, at the
 * point of use, from one read this morning. Everything here exists to keep the
 * difference visible.
 */

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

function records() {
  return parseTsbpeDataset(fixtures.TSBPE_DATASET).map((record) => ({
    matchCompanyName: record.companyName, matchPersonName: record.licenseeName,
    licenseNumber: record.licenseNumber, city: record.city, stateRegion: 'TX',
    payload: record as unknown as Record<string, unknown>,
  }));
}

test('a dataset nobody has loaded is missing, not empty', async () => {
  const health = await snapshotHealth('tx_tsbpe', 'licensees');
  assert.equal(health.state, 'MISSING');
  assert.match(health.summary, /not the same as a company having no licence/i);
  assert.ok(health.howToObtain, 'an operator was told it is missing and not how to fix it');
  assert.match(health.howToObtain!, /public information request|data extract/i);
});

test('a fresh load is current and counts what it indexed', async () => {
  const result = await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET, records: records() });
  assert.equal(result.created, true);
  assert.deepEqual(result.rejected, []);

  const health = await snapshotHealth('tx_tsbpe', 'licensees');
  assert.equal(health.state, 'CURRENT');
  assert.equal(health.recordCount, 4);
  assert.equal(health.parserVersion, 'v1');
  assert.ok(health.nextRefreshDue);
});

test('rows nothing can match are rejected with a count, not silently indexed',
  async () => {
    const result = await loadSnapshot({
      sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
      content: 'unique-content-for-this-test',
      records: [
        ...records(),
        { payload: { note: 'no keys at all' } },
        { payload: {} , matchCompanyName: '  ' },
      ],
    });
    assert.ok(result.rejected.length > 0, 'unmatchable rows were indexed silently');
    const total = result.rejected.reduce((sum, entry) => sum + entry.count, 0);
    assert.equal(total, 2);
    // record_count reflects what was indexed, not what was parsed.
    assert.equal(result.snapshot.recordCount, 4,
      'the record count included rows nothing can ever match');
  });

test('the data date is preferred over the download date when the publisher gives one',
  async () => {
    const published = new Date(Date.now() - 200 * 86_400_000);
    await loadSnapshot({
      sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
      content: fixtures.TSBPE_DATASET, records: records(),
      sourceGeneratedAt: published });

    const health = await snapshotHealth('tx_tsbpe', 'licensees');
    assert.equal(health.state, 'STALE',
      'a file downloaded today but published 200 days ago was reported as current');
    assert.ok(health.ageDays! > 190, 'the age was taken from the download, not the data');
    assert.match(health.summary, /published/i);
  });

test('a dataset past its refresh window says so before it is unusable', async () => {
  await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET, records: records() });
  await query(`update source_snapshots set downloaded_at = now() - interval '45 days'`);

  const health = await snapshotHealth('tx_tsbpe', 'licensees');
  assert.equal(health.state, 'DUE_REFRESH');
  assert.match(health.summary, /due a refresh/i);
});

test('a stale dataset still answers, and says how old it is', async () => {
  await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET, records: records() });
  await query(`update source_snapshots set downloaded_at = now() - interval '200 days'`);

  const health = await snapshotHealth('tx_tsbpe', 'licensees');
  assert.equal(health.state, 'STALE');
  assert.match(health.summary, /still returned and are marked stale/i,
    'a stale dataset was described as unusable rather than as old');
  // Still readable: withholding a known licence helps nobody.
  assert.ok(await currentSnapshot('tx_tsbpe', 'licensees'));
});

test('loading the same bytes twice does not look like a refresh', async () => {
  const first = await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET, records: records() });
  const second = await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET, records: records() });
  assert.equal(second.created, false);
  assert.equal(first.snapshot.snapshotId, second.snapshot.snapshotId);
});

test('a superseded snapshot stays readable as history', async () => {
  await loadSnapshot({ sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET, records: records() });
  await loadSnapshot({ sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v2',
    content: fixtures.TSBPE_DUPLICATE_COMPANY, records: [] });

  const history = await snapshotHistory('tx_tsbpe', 'licensees');
  assert.equal(history.length, 2);
  assert.equal(history[0]!.state, 'CURRENT');
  assert.equal(history[0]!.parserVersion, 'v2');
  assert.equal(history[1]!.state, 'SUPERSEDED',
    'the file an earlier account was researched against was thrown away');
});

test('two concurrent loads leave exactly one current snapshot', async () => {
  // The advisory lock serialises them; without it both can supersede the other.
  const [a, b] = await Promise.all([
    loadSnapshot({ sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
      content: fixtures.TSBPE_DATASET, records: records() }),
    loadSnapshot({ sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
      content: fixtures.TSBPE_DUPLICATE_COMPANY, records: [] }),
  ]);
  assert.ok(a.created && b.created);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from source_snapshots
      where source_id = 'tx_tsbpe' and dataset = 'licensees' and state = 'CURRENT'`);
  assert.equal(rows[0]!.n, 1, 'concurrent loads left the dataset with no single current file');
});

test('every policy tells a human exactly what to ask for', () => {
  for (const sourceId of ['tx_tsbpe', 'fl_dbpr']) {
    const policy = snapshotPolicyFor(sourceId, 'licensees')!;
    assert.ok(policy, `${sourceId} has no snapshot policy`);
    assert.ok(policy.howToObtain.length > 120,
      `${sourceId}: "how to obtain" is too vague to act on`);
    assert.ok(policy.refreshDays > 0 && policy.staleAfterDays > policy.refreshDays,
      `${sourceId}: stale must be later than due-refresh`);
  }
});

test('health is reported for every dataset the product can load', async () => {
  const health = await allSnapshotHealth();
  assert.equal(health.length, 2);
  assert.ok(health.every((entry) => entry.state === 'MISSING'));
});
