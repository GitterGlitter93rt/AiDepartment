import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles, profileContentHash } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/contactResearch.js';
import { enqueueAccountResearch } from '../src/workers/enqueue.js';
import {
  releaseManifest, compareManifests, renderManifest,
} from '../src/release/manifest.js';
import { resetBuildIdentity } from '../src/release/identity.js';

/**
 * What this build is, as distinct from what state it is in.
 * Authority: Issue #3 R.
 *
 * The doctor answers "what is happening now". This answers "what is running", which
 * is the other half of the only question worth asking after something goes wrong:
 * what changed between the run that worked and the run that did not.
 *
 * The part nobody was tracking is the vertical profiles. Each decides which terms are
 * searched, which signals score and which results are excluded -- and
 * `profile_version` is a hand-maintained string that still reads 1.0.0 on every
 * profile in the repository, including the ones edited in this campaign to add causes
 * and mark inherent events. `research_runs.vertical_profile_version` was null on
 * every row, so which profile produced a piece of evidence was unrecorded.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => {
  delete process.env['BUILD_SHA']; resetBuildIdentity(); await pool.end();
});
beforeEach(async () => {
  await resetDatabase(); await syncVerticalProfiles(); resetBuildIdentity();
});

// -------------------------------------------------- the profile nobody tracked --

test('a profile edit is visible even though its declared version never moves', async () => {
  const before = await releaseManifest();
  const roofing = before.verticals.find((entry) => entry.id === 'roofing')!;
  assert.equal(roofing.declaredVersion, '1.0.0',
    'the fixture no longer demonstrates the problem');

  // An edit of exactly the kind this campaign made: a term added to the taxonomy.
  await query(
    `update vertical_profiles
        set definition = jsonb_set(definition,
              '{profile,search_taxonomy,core_queries}',
              (definition->'profile'->'search_taxonomy'->'core_queries')
                || '[{"query":"roof inspection","family":"core","intent_weight":3,
                      "priority":4,"recommended_for_paid_serp":false}]'::jsonb)
      where vertical_profile_id = 'roofing'`);

  const after = await releaseManifest();
  const changes = compareManifests(before, after);
  assert.ok(changes.some((change) => /vertical roofing edited/.test(change)),
    `a profile edit was invisible: ${changes.join('; ') || 'no changes reported'}`);
  assert.ok(changes.some((change) => /search terms 7 -> 8/.test(change)),
    'the comparison does not say what about the profile changed');
  assert.ok(changes.some((change) => /still declared 1\.0\.0/.test(change)),
    'the comparison does not point out that the declared version did not move');
});

test('the content hash changes with the definition and nothing else', () => {
  const base = { profile: { search_taxonomy: { core_queries: [{ query: 'roofer' }] } } };
  const same = { profile: { search_taxonomy: { core_queries: [{ query: 'roofer' }] } } };
  const different = { profile: { search_taxonomy: { core_queries: [{ query: 'roofers' }] } } };

  assert.equal(profileContentHash(base), profileContentHash(same));
  assert.notEqual(profileContentHash(base), profileContentHash(different));
});

test('a research run records which profile produced its evidence', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Manifest Co', website: 'https://manifestco.invalid',
    phone: '904-555-0701', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));
  await enqueueAccountResearch(accountId, null, 'newly_discovered');
  await drainQueue();

  const { rows } = await query<{ vertical_profile_version: string | null }>(
    'select vertical_profile_version from research_runs where account_id = $1', [accountId]);
  assert.ok(rows[0], 'no research run was recorded');
  assert.ok(rows[0]!.vertical_profile_version,
    'the column that has always existed is still null, so which profile produced this '
    + 'evidence is unrecorded');
  // Both halves: the declared version for a human, the hash for the truth.
  assert.match(rows[0]!.vertical_profile_version!, /^1\.0\.0\+[0-9a-f]{12}$/);
});

// ----------------------------------------------------------- what it compares ---

test('a scoring policy change says the scores are not comparable', async () => {
  const before = await releaseManifest();
  // Derived from the current version rather than written out. This test named the
  // next version as a literal -- 'module-4c-v3' -- and when the scoring policy
  // actually reached v3 the "after" manifest stopped differing from the "before"
  // one, so the version-change branch was never taken and the test passed on the
  // fingerprint branch instead. It went on asserting a sentence that was true for
  // the wrong reason, which is the failure mode a version-comparison test exists to
  // catch and the last one it should have.
  const nextVersion = `${before.scoring.policyVersion}-successor`;
  assert.notEqual(nextVersion, before.scoring.policyVersion,
    'the changed-to version is the current one, so nothing about a change is tested');
  const after = {
    ...before,
    scoring: { policyVersion: nextVersion, rulesFingerprint: 'different' },
  };
  const changes = compareManifests(before, after);
  assert.ok(changes.some((change) => /not comparable/.test(change)),
    'a policy change was reported without saying what it costs');
  // And it names both sides, so an operator reading the diff knows which way it moved.
  assert.ok(changes.some((change) =>
    change.includes(before.scoring.policyVersion) && change.includes(nextVersion)),
    'the report does not say which policy became which');
});

test('rules changing without the version moving is called out as the worse case', async () => {
  const before = await releaseManifest();
  const after = {
    ...before,
    scoring: { policyVersion: before.scoring.policyVersion, rulesFingerprint: 'edited' },
  };
  const changes = compareManifests(before, after);
  assert.ok(changes.some((change) => /without the policy version changing/.test(change)),
    'the one case nothing else in the system would catch was not reported');
});

test('a credential appearing or disappearing is a change worth seeing', async () => {
  const before = await releaseManifest({ ...process.env, DATAFORSEO_PASSWORD: '' });
  const after = await releaseManifest({
    ...process.env, DATAFORSEO_PASSWORD: 'now-configured' });
  const changes = compareManifests(before, after);
  assert.ok(changes.some((change) => /DATAFORSEO_PASSWORD configured/.test(change)));
});

test('a safety flag moving is reported plainly', async () => {
  const before = await releaseManifest({ ...process.env, OUTBOUND_DIAL_ENABLED: 'false' });
  const after = await releaseManifest({ ...process.env, OUTBOUND_DIAL_ENABLED: 'true' });
  const changes = compareManifests(before, after);
  assert.ok(changes.some((change) => /outbound dialling false -> true/.test(change)),
    'the dialler being armed was not reported as a change');
});

test('two identical builds compare as unchanged', async () => {
  const manifest = await releaseManifest();
  assert.deepEqual(compareManifests(manifest, { ...manifest }), []);
});

// ------------------------------------------------------------- what it carries ---

test('the manifest names credentials without carrying them', async () => {
  const manifest = await releaseManifest({
    ...process.env,
    DATAFORSEO_PASSWORD: 'manifest-secret-value',
    SESSION_SECRET: 'manifest-session-secret',
  });
  const serialized = JSON.stringify(manifest) + renderManifest(manifest);

  assert.ok(!serialized.includes('manifest-secret-value'),
    'the manifest carries a credential value');
  assert.ok(!serialized.includes('manifest-session-secret'));
  assert.equal(manifest.credentials.find(
    (entry) => entry.name === 'DATAFORSEO_PASSWORD')!.present, true,
    'the manifest cannot say whether a credential is configured');
});

test('the manifest says when nothing prunes anything', async () => {
  const manifest = await releaseManifest({ ...process.env, RETENTION_POLICY_PATH: '' });
  assert.equal(manifest.safety.retentionPolicySupplied, false);
  assert.match(renderManifest(manifest), /nothing prunes anything/);
});

test('a schema the database has not caught up with is on the manifest', async () => {
  const manifest = await releaseManifest();
  assert.equal(manifest.schemaDrift.pending.length, 0,
    `this database is behind the build: ${manifest.schemaDrift.pending.join(', ')}`);
  assert.equal(manifest.build.migrationsApplied, manifest.build.migrationsShipped);
});

test('every active vertical is on the manifest with its counts', async () => {
  const manifest = await releaseManifest();
  const { rows } = await query<{ n: number }>(
    'select count(*)::int as n from vertical_profiles where is_active');
  assert.equal(manifest.verticals.length, rows[0]!.n);

  for (const entry of manifest.verticals) {
    assert.ok(entry.searchTerms > 0, `${entry.id} has no search terms`);
    assert.ok(entry.signalRules > 0, `${entry.id} declares no signals`);
    assert.ok(entry.negativeTerms > 0, `${entry.id} declares no exclusions`);
    assert.match(entry.contentHash, /^[0-9a-f]{12}$/);
  }
});
