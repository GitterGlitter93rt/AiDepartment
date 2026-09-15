import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase, markEntityVerified } from './helpers.js';
import { sourceAttemptsFor } from '../src/domain/sourceAudit.js';

/**
 * Why is this panel empty?
 *
 * Four answers, and an empty panel says all of them at once: we looked and there is
 * none; we could not look; this state issues none; we found several and could not tell
 * them apart. Only the first is a finding about the company. A rep who cannot tell
 * them apart will either trust nothing or trust everything, and both are wrong.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function accountWithRun(outcomes: unknown[], completedAt = 'now()'): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Audit Co ${sequence}`,
    website: `https://audit${sequence}.invalid`,
    phone: `512-555-${String(5000 + sequence).slice(-4)}`,
    city: 'Austin', state: 'TX', postalCode: '78701', verticalProfileId: 'plumbing',
  }, { discoverySource: 'market_miner:test' }));
  await markEntityVerified(accountId);
  await query(
    `insert into research_runs (account_id, trigger, status, adapter_results, completed_at)
     values ($1, 'newly_discovered', 'completed', $2::jsonb, ${completedAt})`,
    [accountId, JSON.stringify({ official_sources: outcomes })]);
  return accountId;
}

test('a source that searched and found nothing is a finding about the company', async () => {
  const accountId = await accountWithRun([{
    sourceId: 'tx_comptroller', displayName: 'Texas Comptroller', status: 'NO_MATCH' }]);
  const [attempt] = await sourceAttemptsFor(accountId);
  assert.equal(attempt!.status, 'NO_MATCH');
  assert.equal(attempt!.aboutTheCompany, true);
  assert.match(attempt!.summary, /holds no record under this name/i);
  assert.match(attempt!.summary, /different legal name/i,
    'a rep was told "no record" without the reason that usually explains it');
});

test('a source that could not be reached says nothing about the company', async () => {
  const accountId = await accountWithRun([{
    sourceId: 'tx_tsbpe', displayName: 'Texas plumbing board',
    status: 'SOURCE_UNAVAILABLE' }]);
  const [attempt] = await sourceAttemptsFor(accountId);
  assert.equal(attempt!.aboutTheCompany, false,
    'our own outage was presented as a finding about the prospect');
  assert.match(attempt!.summary, /says nothing about the company/i);
});

test('a trade the state does not license is not a gap', async () => {
  const accountId = await accountWithRun([{
    sourceId: 'tx_tdlr', displayName: 'TDLR', status: 'NOT_APPLICABLE_STATEWIDE' }]);
  const [attempt] = await sourceAttemptsFor(accountId);
  assert.equal(attempt!.aboutTheCompany, false);
  assert.match(attempt!.summary, /nothing to verify/i);
});

test('an ambiguous result explains that nothing was attached', async () => {
  const accountId = await accountWithRun([{
    sourceId: 'fl_dbpr', displayName: 'Florida DBPR', status: 'AMBIGUOUS' }]);
  const [attempt] = await sourceAttemptsFor(accountId);
  assert.equal(attempt!.aboutTheCompany, true);
  assert.match(attempt!.summary, /nothing was attached/i,
    'a rep could not tell whether an ambiguous match had written anything');
});

test('findings sort above the things we could not do', async () => {
  const accountId = await accountWithRun([
    { sourceId: 'tx_tsbpe', displayName: 'Plumbing board', status: 'SOURCE_UNAVAILABLE' },
    { sourceId: 'tx_comptroller', displayName: 'Comptroller', status: 'MATCHED' },
  ]);
  const attempts = await sourceAttemptsFor(accountId);
  assert.equal(attempts[0]!.status, 'MATCHED',
    'what a source concluded was buried under what another could not do');
});

test('a cached answer says which download it came from', async () => {
  const downloadedAt = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const accountId = await accountWithRun([{
    sourceId: 'tx_tsbpe', displayName: 'Plumbing board', status: 'MATCHED',
    snapshotDownloadedAt: downloadedAt }]);
  const [attempt] = await sourceAttemptsFor(accountId);
  assert.ok(attempt!.snapshotDownloadedAt, 'a cached answer lost its download date');
  const ageDays = (Date.now() - attempt!.snapshotDownloadedAt!.getTime()) / 86_400_000;
  assert.ok(ageDays > 40, 'a six-week-old dataset was presented as checked just now');
});

test('only the newest run is read, because an account is not a changelog', async () => {
  const accountId = await accountWithRun(
    [{ sourceId: 'fl_dbpr', displayName: 'DBPR', status: 'NO_MATCH' }],
    `now() - interval '30 days'`);
  await query(
    `insert into research_runs (account_id, trigger, status, adapter_results, completed_at)
     values ($1, 'scheduled_refresh', 'completed', $2::jsonb, now())`,
    [accountId, JSON.stringify({ official_sources: [
      { sourceId: 'fl_dbpr', displayName: 'DBPR', status: 'MATCHED' }] })]);

  const attempts = await sourceAttemptsFor(accountId);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]!.status, 'MATCHED', 'a superseded answer was still being shown');
});

test('an unrecognised status is dropped rather than rendered raw', async () => {
  const accountId = await accountWithRun([
    { sourceId: 'fl_dbpr', displayName: 'DBPR', status: 'SOMETHING_NEW' },
    { sourceId: 'tx_comptroller', displayName: 'Comptroller', status: 'MATCHED' },
  ]);
  const attempts = await sourceAttemptsFor(accountId);
  assert.equal(attempts.length, 1, 'an internal status leaked into rep-facing language');
});

test('an account nobody researched reports no attempts rather than failing', async () => {
  const attempts = await sourceAttemptsFor('00000000-0000-0000-0000-000000000000');
  assert.deepEqual(attempts, []);
});
