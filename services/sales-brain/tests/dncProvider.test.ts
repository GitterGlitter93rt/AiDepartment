import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import {
  createRegistryDncProvider, createFixtureDncProvider, ingestFullList, ingestChangeList,
} from '../src/compliance/dncProvider.js';

/**
 * National DNC screening.
 * Authority: outbound-sales-brain-ftc-dnc-ingestion-contract.v1.yaml acceptance_fixtures,
 * outbound-sales-brain-dnc-provider-benchmark-plan.md §3.
 *
 * The ten acceptance fixtures from the contract, plus the rule that matters most: a
 * provider outage must never look like a clean number.
 */

const ON_LIST = '+19045551212';
const OFF_LIST = '+19045550100';
const OUT_OF_SCOPE = '+13055550199';
const POLICY = 'phone-eligibility-v1';

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function subscription(areaCodes: string[] = []): Promise<string> {
  const { rows } = await query<{ subscription_id: string }>(
    `insert into dnc_subscriptions
       (organization_reference_nonsecret, credential_env_var, subscribed_area_codes,
        status, effective_at)
     values ('YAD-ORG-REF', 'DNC_SUBSCRIPTION_CREDENTIAL', $1, 'ACTIVE', now())
     returning subscription_id`, [areaCodes]);
  return rows[0]!.subscription_id;
}

const provider = () => createRegistryDncProvider({
  env: { DNC_PROVIDER: 'ftc_national_dnc',
         DNC_SUBSCRIPTION_CREDENTIAL_ENV: 'DNC_SUBSCRIPTION_CREDENTIAL' } as NodeJS.ProcessEnv,
});

// --- the ten acceptance fixtures ---------------------------------------------

test('full_bootstrap_success: the snapshot becomes current and is queryable', async () => {
  const subscriptionId = await subscription(['904']);
  const result = await ingestFullList({
    subscriptionId, batchReference: 'full-2026-09-01', numbers: [ON_LIST],
    areaCodes: ['904'] });
  assert.equal(result.ok, true);
  assert.equal(result.applied, 1);

  const { rows } = await query<{ state: string }>(
    `select state from dnc_snapshots where snapshot_id = $1`, [result.snapshotId]);
  assert.equal(rows[0]!.state, 'CURRENT');

  const screen = await provider().screen({
    normalizedPhone: ON_LIST, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY });
  assert.equal(screen.status, 'MATCH');
  assert.equal(screen.normalizedResult, 'DNC_MATCH');
});

test('repeated_change_batch: applied once, with no duplicate membership', async () => {
  const subscriptionId = await subscription(['904']);
  await ingestFullList({ subscriptionId, batchReference: 'full-1', numbers: [ON_LIST],
    areaCodes: ['904'] });

  const first = await ingestChangeList({
    subscriptionId, batchReference: 'change-1',
    changes: [{ operation: 'ADD', normalizedPhone: OFF_LIST }] });
  const second = await ingestChangeList({
    subscriptionId, batchReference: 'change-1',
    changes: [{ operation: 'ADD', normalizedPhone: OFF_LIST }] });

  assert.equal(first.applied, 1);
  assert.equal(second.applied, 0, 'the same validated batch does not apply twice');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from dnc_membership where normalized_value = $1`, [OFF_LIST]);
  assert.equal(rows[0]!.n, 1, 'a repeated add does not duplicate membership');
});

test('add_then_delete: the number ends up absent, and the audit survives', async () => {
  const subscriptionId = await subscription(['904']);
  await ingestFullList({ subscriptionId, batchReference: 'full-1', numbers: [ON_LIST],
    areaCodes: ['904'] });
  await ingestChangeList({ subscriptionId, batchReference: 'change-add',
    changes: [{ operation: 'ADD', normalizedPhone: OFF_LIST }] });
  await ingestChangeList({ subscriptionId, batchReference: 'change-del',
    changes: [{ operation: 'DELETE', normalizedPhone: OFF_LIST }] });
  // A repeated delete does not create negative membership.
  await ingestChangeList({ subscriptionId, batchReference: 'change-del-2',
    changes: [{ operation: 'DELETE', normalizedPhone: OFF_LIST }] });

  const screen = await provider().screen({
    normalizedPhone: OFF_LIST, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY });
  assert.equal(screen.status, 'NO_MATCH');

  const batches = await query<{ n: number }>(
    `select count(*)::int as n from dnc_snapshots where data_kind = 'CHANGE_LIST'`);
  assert.equal(batches.rows[0]!.n, 3, 'every batch is recorded, including the repeat');
});

test('malformed_change_file: the prior snapshot stays current and nothing is applied', async () => {
  const subscriptionId = await subscription(['904']);
  const full = await ingestFullList({
    subscriptionId, batchReference: 'full-1', numbers: [ON_LIST], areaCodes: ['904'] });

  const bad = await ingestChangeList({
    subscriptionId, batchReference: 'change-bad',
    changes: [
      { operation: 'ADD', normalizedPhone: OFF_LIST },
      { operation: 'ADD', normalizedPhone: 'not a phone number' },
    ] });
  assert.equal(bad.ok, false);
  assert.match(bad.reason!, /none of it was applied/);

  const current = await query<{ snapshot_id: string }>(
    `select snapshot_id from dnc_snapshots where state = 'CURRENT'`);
  assert.equal(current.rows[0]!.snapshot_id, full.snapshotId);

  const absent = await query<{ n: number }>(
    `select count(*)::int as n from dnc_membership where normalized_value = $1`, [OFF_LIST]);
  assert.equal(absent.rows[0]!.n, 0, 'the good half of a bad batch is not half-applied');
});

test('sync_timeout: an empty full list is a bad download, not an empty registry', async () => {
  const subscriptionId = await subscription(['904']);
  const full = await ingestFullList({
    subscriptionId, batchReference: 'full-1', numbers: [ON_LIST], areaCodes: ['904'] });

  const empty = await ingestFullList({
    subscriptionId, batchReference: 'full-empty', numbers: [], areaCodes: ['904'] });
  assert.equal(empty.ok, false);
  assert.match(empty.reason!, /bad download/);

  const current = await query<{ snapshot_id: string }>(
    `select snapshot_id from dnc_snapshots where state = 'CURRENT'`);
  assert.equal(current.rows[0]!.snapshot_id, full.snapshotId, 'last known good is preserved');
});

test('stale_blocking_before_ai_call: a stale registry fails closed', async () => {
  const subscriptionId = await subscription(['904']);
  await ingestFullList({ subscriptionId, batchReference: 'full-1', numbers: [ON_LIST],
    areaCodes: ['904'] });
  await query(`update dnc_snapshots set downloaded_at = now() - interval '200 days'`);

  const screen = await provider().screen({
    normalizedPhone: OFF_LIST, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY });
  assert.equal(screen.status, 'ERROR_BLOCKING');
  assert.equal(screen.normalizedResult, 'REQUIRED_SCREEN_UNAVAILABLE');
  assert.equal(screen.conclusive, false,
    'a screen that could not run is not evidence the number is clean');
});

test('area_code_not_subscribed: not applicable, never a false no-match', async () => {
  const subscriptionId = await subscription(['904']);
  await ingestFullList({ subscriptionId, batchReference: 'full-1', numbers: [ON_LIST],
    areaCodes: ['904'] });

  const screen = await provider().screen({
    normalizedPhone: OUT_OF_SCOPE, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY });
  assert.equal(screen.status, 'NOT_APPLICABLE');
  assert.equal(screen.normalizedResult, 'SCREEN_NOT_AVAILABLE_FOR_SCOPE');
  assert.notEqual(screen.status as string, 'NO_MATCH',
    'saying "not on the list" about a list we did not read is a false negative with a '
    + 'person on the other end of it');
  assert.equal(screen.conclusive, false);
});

test('registry_no_match_other_policy_missing: a no-match is an input, not a permission', async () => {
  const subscriptionId = await subscription(['904']);
  await ingestFullList({ subscriptionId, batchReference: 'full-1', numbers: [ON_LIST],
    areaCodes: ['904'] });

  const screen = await provider().screen({
    normalizedPhone: OFF_LIST, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY });
  assert.equal(screen.status, 'NO_MATCH');

  // Nothing was cleared for AI voice by that screen.
  const decisions = await query<{ n: number }>(
    `select count(*)::int as n from channel_eligibility_decisions where decision = 'ALLOW'`);
  assert.equal(decisions.rows[0]!.n, 0);
  const endpoints = await query<{ n: number }>(
    `select count(*)::int as n from contact_endpoints where autonomous_ai_voice = 'ALLOW'`);
  assert.equal(endpoints.rows[0]!.n, 0);
});

test('restored_old_backup: a restored snapshot has its age revalidated', async () => {
  const subscriptionId = await subscription(['904']);
  await ingestFullList({ subscriptionId, batchReference: 'full-old', numbers: [ON_LIST],
    areaCodes: ['904'] });
  // A restore brings back rows with their original timestamps.
  await query(`update dnc_snapshots set downloaded_at = now() - interval '90 days'`);

  const freshness = await provider().freshness();
  assert.notEqual(freshness.state, 'CURRENT',
    'age is recomputed from the data, not assumed from the fact it is in the table');
});

test('no snapshot at all fails closed rather than passing', async () => {
  const screen = await provider().screen({
    normalizedPhone: OFF_LIST, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY });
  assert.equal(screen.status, 'ERROR_BLOCKING');
  assert.equal(screen.reasonCode, 'no_current_snapshot');
});

// --- audit, and the fixture provider ------------------------------------------

test('every screen is logged for correlation to the endpoint and the decision', async () => {
  const subscriptionId = await subscription(['904']);
  await ingestFullList({ subscriptionId, batchReference: 'full-1', numbers: [ON_LIST],
    areaCodes: ['904'] });

  await provider().screen({
    normalizedPhone: ON_LIST, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY });
  const { rows } = await query<any>(
    `select status, reason_code, policy_version, snapshot_id from dnc_screen_log`);
  assert.equal(rows[0]!.status, 'MATCH');
  assert.equal(rows[0]!.policy_version, POLICY);
  assert.ok(rows[0]!.snapshot_id, 'which snapshot answered is part of the record');
});

test('a malformed number is never screened clean', async () => {
  const subscriptionId = await subscription(['904']);
  await ingestFullList({ subscriptionId, batchReference: 'full-1', numbers: [ON_LIST],
    areaCodes: ['904'] });

  const screen = await provider().screen({
    normalizedPhone: 'call the office', channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY });
  assert.equal(screen.status, 'ERROR_BLOCKING');
  assert.equal(screen.reasonCode, 'phone_format_invalid');
});

test('the fixture provider covers the same cases with no subscription', async () => {
  const ok = createFixtureDncProvider({ members: [ON_LIST] });
  assert.equal((await ok.screen({
    normalizedPhone: ON_LIST, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY })).status,
    'MATCH');
  assert.equal((await ok.screen({
    normalizedPhone: OFF_LIST, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY })).status,
    'NO_MATCH');

  for (const behaviour of ['outage', 'stale_blocking', 'unconfigured'] as const) {
    const broken = createFixtureDncProvider({ members: [ON_LIST], behaviour });
    const screen = await broken.screen({
      normalizedPhone: OFF_LIST, channel: 'AUTONOMOUS_AI_VOICE', policyVersion: POLICY });
    assert.equal(screen.status, 'ERROR_BLOCKING', behaviour);
    assert.equal(screen.conclusive, false,
      `a ${behaviour} provider must not look like a clean number`);
  }
});

test('the registry provider reports unconfigured without a credential reference', () => {
  const bare = createRegistryDncProvider({ env: {} as NodeJS.ProcessEnv });
  assert.equal(bare.isConfigured(), false);
  const halfway = createRegistryDncProvider({
    env: { DNC_PROVIDER: 'ftc_national_dnc' } as NodeJS.ProcessEnv });
  assert.equal(halfway.isConfigured(), false,
    'naming a provider is not the same as having a subscription credential');
});
