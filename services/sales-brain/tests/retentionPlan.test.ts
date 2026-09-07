import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { loadPolicy, PRUNABLE_TABLES, NO_POLICY } from '../src/retention/policy.js';
import { planRetention, renderRetentionPlan } from '../src/retention/plan.js';

/**
 * What a retention run would delete, and what it must never touch.
 * Authority: Issue #3 I. INPUT-006 remains Michael's decision.
 *
 * Nothing prunes anything in this system today, and every observation carries a
 * `retention_class` no code reads. The machinery to change that is worth building
 * before the decision arrives; the decision is not mine to take while nobody is
 * watching, so this ships with no periods set and no code that deletes a row.
 *
 * The protection is the point. A row that is old is not a row nobody needs: a stored
 * score cites the evidence ids that produced it, so pruning that evidence leaves
 * every lineage pointing at nothing and a rep asking "why is this company Tier A"
 * gets a number with no reasons. A provider task still owed to us is a search we paid
 * for and have not read. How a claimed company was found is a question the prospect
 * may ask on the call.
 */

let scratch: string;

before(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  scratch = mkdtempSync(join(tmpdir(), 'retention-'));
});
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

function policyFile(body: unknown): string {
  const path = join(scratch, `policy-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

async function observedAccount(options: {
  claimed?: boolean; suppressed?: boolean; ageDays?: number;
} = {}): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Retention Co ${Math.random().toString(36).slice(2, 8)}`,
    website: `https://retention${Math.random().toString(36).slice(2, 8)}.invalid`,
    phone: null, city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:fixture' }));

  await query(
    `insert into search_observations (provider, source_type, observed_name, account_id,
                                      result_type, retention_class, observed_at)
     values ('fixture', 'discovery', 'Retention Co', $1, 'paid_search', 'transient',
             now() - ($2 || ' days')::interval)`,
    [accountId, String(options.ageDays ?? 400)]);

  if (options.claimed) {
    const rep = await makeUser(`Retention Rep ${Math.random().toString(36).slice(2, 8)}`,
      'SALES_REP');
    await claimAccount(accountId,
      { userId: rep.userId, role: 'SALES_REP', activeClaimTarget: null });
  }
  if (options.suppressed) {
    await query(
      `update accounts set is_suppressed = true, suppression_summary = 'asked not to'
        where account_id = $1`, [accountId]);
  }
  return accountId;
}

function tablePlan(plan: Awaited<ReturnType<typeof planRetention>>, table: string) {
  const found = plan.tables.find((entry) => entry.table === table);
  assert.ok(found, `no plan for ${table}`);
  return found!;
}

// ------------------------------------------------- no policy, no deletions ------

test('with no policy the plan is an inventory that deletes nothing', async () => {
  await observedAccount();
  const plan = await planRetention(NO_POLICY);

  assert.equal(plan.inventoryOnly, true);
  assert.equal(plan.totalDeletable, 0);
  assert.equal(plan.policyApprovedBy, null);

  const rendered = renderRetentionPlan(plan);
  assert.match(rendered, /Nothing would be deleted/);
  assert.match(rendered, /INPUT-006/,
    'the plan does not say where the missing decision lives');
});

test('the age buckets show the shape before anybody picks a period', async () => {
  await observedAccount({ ageDays: 400 });
  await observedAccount({ ageDays: 40 });
  await observedAccount({ ageDays: 2 });

  const observations = tablePlan(await planRetention(NO_POLICY), 'search_observations');
  const bucket = (label: string) =>
    observations.ageBuckets.find((entry) => entry.label === label)!.n;
  assert.equal(bucket('over a year'), 1);
  assert.ok(bucket('30-90 days') >= 1);
  assert.equal(observations.keepDays, null);
  assert.equal(observations.deletable, 0);
});

test('there is no code in this build that deletes a retained row', () => {
  // Not a flag that refuses. No path at all: an engine that can act on a policy
  // nobody has written is one typo from deleting the provenance behind every score.
  const files = readdirSync(new URL('../src/retention/', import.meta.url).pathname);
  for (const file of files) {
    const text = readFileSync(
      new URL(`../src/retention/${file}`, import.meta.url).pathname, 'utf8');
    assert.doesNotMatch(text, /\bdelete\s+from\b/i,
      `${file} contains a delete statement`);
    assert.doesNotMatch(text, /\btruncate\b/i, `${file} contains a truncate`);
  }
  const cli = readFileSync(
    new URL('../src/bin/retention-plan.ts', import.meta.url).pathname, 'utf8');
  assert.doesNotMatch(cli, /--apply|--execute|--force/,
    'the CLI advertises an apply path that should not exist yet');
});

// -------------------------------------------------------- what is protected ----

test('the provenance under a claimed company is protected from any period', async () => {
  await observedAccount({ claimed: true, ageDays: 400 });
  const path = policyFile({
    approvedBy: 'michael', tables: [
      { table: 'search_observations', timestamp: 'observed_at', keepDays: 30 }],
  });
  const { policy, error } = await loadPolicy(path);
  assert.equal(error, null);

  const observations = tablePlan(await planRetention(policy), 'search_observations');
  assert.equal(observations.olderThanPolicy, 1);
  assert.equal(observations.protectedRows, 1,
    'how a rep’s own claimed company was found would have been deleted');
  assert.equal(observations.deletable, 0);
  assert.match(observations.protectionReason!, /claimed by a rep or suppressed/);
});

test('the provenance under a suppressed company is protected too', async () => {
  await observedAccount({ suppressed: true, ageDays: 400 });
  const { policy } = await loadPolicy(policyFile({
    approvedBy: 'michael', tables: [
      { table: 'search_observations', timestamp: 'observed_at', keepDays: 30 }],
  }));

  const observations = tablePlan(await planRetention(policy), 'search_observations');
  assert.equal(observations.deletable, 0,
    'the record of how we found somebody who asked not to be contacted would have '
    + 'been deleted, leaving no answer to why we ever called');
});

test('an ordinary old observation is deletable once a period exists', async () => {
  await observedAccount({ ageDays: 400 });
  const { policy } = await loadPolicy(policyFile({
    approvedBy: 'michael', tables: [
      { table: 'search_observations', timestamp: 'observed_at', keepDays: 30 }],
  }));

  const observations = tablePlan(await planRetention(policy), 'search_observations');
  assert.equal(observations.deletable, 1,
    'a plan with a period proposed deleting nothing, so the engine does nothing');
  assert.ok(observations.estimatedReclaimedBytes >= 0);
});

test('a provider task the provider still owes us is never deletable', async () => {
  await query(
    `insert into provider_tasks (provider, provider_native_id, fingerprint, status,
                                 submitted_at)
     values ('fixture', 'owed-1', 'fp-owed', 'PENDING', now() - interval '400 days'),
            ('fixture', 'done-1', 'fp-done', 'COLLECTED', now() - interval '400 days')`);
  const { policy } = await loadPolicy(policyFile({
    approvedBy: 'michael', tables: [
      { table: 'provider_tasks', timestamp: 'submitted_at', keepDays: 30 }],
  }));

  const tasks = tablePlan(await planRetention(policy), 'provider_tasks');
  assert.equal(tasks.olderThanPolicy, 2);
  assert.equal(tasks.protectedRows, 1);
  assert.equal(tasks.deletable, 1, 'a search we paid for and never read would have been '
    + 'deleted along with the closed one');
  assert.match(tasks.protectionReason!, /still owes us/);
});

test('the current score is never deletable, however old', async () => {
  const accountId = await observedAccount();
  await query(
    `insert into canonical_scores (account_id, score_version, total_points, tier,
                                   components, calculated_at)
     values ($1, 'v1', 4, 'C', '[]'::jsonb, now() - interval '500 days'),
            ($1, 'v2', 7, 'B', '[]'::jsonb, now() - interval '400 days')`, [accountId]);
  const { policy } = await loadPolicy(policyFile({
    approvedBy: 'michael', tables: [
      { table: 'canonical_scores', timestamp: 'calculated_at', keepDays: 30 }],
  }));

  const scores = tablePlan(await planRetention(policy), 'canonical_scores');
  assert.equal(scores.olderThanPolicy, 2);
  assert.equal(scores.protectedRows, 1, 'the score every page reads would have been deleted');
  assert.equal(scores.deletable, 1);
});

test('a research run still cited by evidence is protected', async () => {
  const accountId = await observedAccount();
  const { rows } = await query<{ research_run_id: string }>(
    `insert into research_runs (account_id, trigger, started_at, completed_at, status)
     values ($1, 'newly_discovered', now() - interval '400 days',
             now() - interval '400 days', 'completed')
     returning research_run_id`, [accountId]);
  await query(
    `insert into evidence_records (account_id, research_run_id, category, claim_key,
                                   claim_text, confidence, can_state_as_fact, source_type)
     values ($1, $2, 'urgency', 'emergency_24_7_service', '24/7 on the site',
             'confirmed', true, 'first_party')`, [accountId, rows[0]!.research_run_id]);

  const { policy } = await loadPolicy(policyFile({
    approvedBy: 'michael', tables: [
      { table: 'research_runs', timestamp: 'started_at', keepDays: 30 }],
  }));
  const runs = tablePlan(await planRetention(policy), 'research_runs');
  assert.equal(runs.protectedRows, 1,
    'a run that evidence still cites as its source would have been deleted, leaving '
    + 'the evidence pointing at nothing');
  assert.equal(runs.deletable, 0);
});

test('an unreconciled provider charge is protected from the cost record being pruned', async () => {
  await query(
    `insert into provider_usage (provider, operation, requested_at, completed_at, units,
                                 estimated_cost_usd, actual_cost_usd, status)
     values ('fixture', 'serp.discover', now() - interval '400 days', now(), 1, 0.05,
             null, 'OK'),
            ('fixture', 'serp.discover', now() - interval '400 days', now(), 1, 0.05,
             0.006, 'OK')`);
  const { policy } = await loadPolicy(policyFile({
    approvedBy: 'michael', tables: [
      { table: 'provider_usage', timestamp: 'requested_at', keepDays: 30 }],
  }));

  const usage = tablePlan(await planRetention(policy), 'provider_usage');
  assert.equal(usage.protectedRows, 1);
  assert.match(usage.protectionReason!, /invoice has not been reconciled/);
});

// ------------------------------------------------------------- the policy file --

test('a policy nobody approved is refused', async () => {
  const { policy, error } = await loadPolicy(policyFile({
    tables: [{ table: 'jobs', timestamp: 'created_at', keepDays: 7 }],
  }));
  assert.match(error!, /who approved it/);
  assert.equal(policy, NO_POLICY);
  assert.match(renderRetentionPlan(await planRetention(policy, error)), /REFUSED/);
});

test('a policy naming a table that is not prunable is refused entirely', async () => {
  // Not partly applied: a config that half-parses is a config that deletes the wrong
  // things.
  const { error } = await loadPolicy(policyFile({
    approvedBy: 'michael',
    tables: [{ table: 'accounts', timestamp: 'created_at', keepDays: 30 }],
  }));
  assert.match(error!, /not prunable and never will be/);
  assert.match(error!, /out of reach of a mistake in a policy/);
});

test('malformed JSON is refused rather than half-read', async () => {
  const path = join(scratch, 'broken.json');
  writeFileSync(path, '{ "approvedBy": "michael", ');
  const { error } = await loadPolicy(path);
  assert.match(error!, /not readable JSON/);
});

test('a policy naming three tables leaves the rest keeping everything', async () => {
  const { policy, error } = await loadPolicy(policyFile({
    approvedBy: 'michael',
    tables: [{ table: 'jobs', timestamp: 'created_at', keepDays: 7 }],
  }));
  assert.equal(error, null);
  assert.equal(policy.tables.length, PRUNABLE_TABLES.length);
  for (const entry of policy.tables) {
    if (entry.table === 'jobs') assert.equal(entry.keepDays, 7);
    else assert.equal(entry.keepDays, null,
      `${entry.table} was given a period nobody asked for`);
  }
});

test('the tables a policy may never reach are the ones that hold the business', () => {
  const prunable = new Set(PRUNABLE_TABLES.map((entry) => entry.table));
  for (const table of ['accounts', 'contacts', 'contact_endpoints', 'activities',
    'evidence_records', 'audit_log', 'suppressions', 'meeting_bookings',
    'opportunities', 'account_merges']) {
    assert.ok(!prunable.has(table),
      `${table} can be pruned from a config file, and it holds the business`);
  }
});

// ------------------------------------------------------------------ the audit ---

test('there is somewhere for a future run to record what it did', async () => {
  // Built before any deletion path exists. "How many observations did we drop last
  // month" is a question somebody asks the first time a company's history looks
  // short, and the answer should exist from the first run rather than from the first
  // time it is missed.
  const { rows } = await query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('retention_runs',
        'retention_run_tables') order by table_name`);
  assert.deepEqual(rows.map((row) => row.table_name),
    ['retention_run_tables', 'retention_runs']);

  const { rows: columns } = await query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_name = 'retention_runs'`);
  const names = columns.map((row) => row.column_name);
  assert.ok(names.includes('policy_approved_by'),
    'a deletion run could be recorded without saying who approved it');
  assert.ok(names.includes('policy_snapshot'));
  assert.ok(names.includes('dry_run'));

  const { rows: empty } = await query<{ n: number }>(
    'select count(*)::int as n from retention_runs');
  assert.equal(empty[0]!.n, 0, 'something has already run a retention pass');
});
