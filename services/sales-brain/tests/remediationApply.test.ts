import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase } from './helpers.js';
import { applyForAccount, planRemediation, proposeTrimmedName } from '../src/remediation/apply.js';
import {
  identityFromJsonLd, identityFromMeta, identityFromTitle,
} from '../src/resolver/siteIdentity.js';

/**
 * SB-V2-1b — the apply half, authorised on 2026-09-17.
 *
 * What it may do is narrow and every instrument is reversible. These tests hold the
 * narrowness: that a name is only ever trimmed to one the evidence already holds, that a
 * non-company is suppressed rather than deleted, that raw evidence survives, that an
 * Account a person has worked is never touched automatically, and that every change
 * leaves an audit row carrying what it was before.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

// ------------------------------------------------------------- what a site says

test('a site names itself in the three places worth believing', () => {
  assert.equal(identityFromJsonLd([{
    '@type': 'LocalBusiness', name: 'Southern Air',
  }]), 'Southern Air');

  assert.equal(
    identityFromMeta('<meta property="og:site_name" content="Today&#39;s Homeowner">'),
    'Today&#39;s Homeowner');

  // A title segment is the weakest, so it is only taken when the domain agrees.
  assert.equal(
    identityFromTitle('<title>HVAC Services in St. Augustine, FL - Southern Air</title>',
      'southernair.com'),
    'Southern Air');
  assert.equal(
    identityFromTitle('<title>10 Best Roofers in St. Augustine, FL</title>',
      'todayshomeowner.com'),
    null);
});

// --------------------------------------------------------------- what a name may become

test('a name is only ever trimmed to one the stored name already contains', () => {
  // The case Michael named.
  const trimmed = proposeTrimmedName({
    canonicalName: 'HVAC Services in St. Augustine, FL - Palatka - Southern Air',
    canonicalDomain: 'southernair.com',
    candidateNames: [],
    siteIdentity: { name: 'Southern Air', basis: 'basis=SCHEMA_ORG_NAME' },
  });
  assert.equal(trimmed?.name, 'Southern Air');

  // A site name the stored name does not contain is a different company or a rename,
  // and either needs a person.
  const different = proposeTrimmedName({
    canonicalName: '10 Best Roofers in St. Augustine, FL',
    canonicalDomain: 'todayshomeowner.com',
    candidateNames: [],
    siteIdentity: { name: "Today's Homeowner", basis: 'basis=OG_SITE_NAME' },
  });
  assert.equal(different, null);

  // And production's own trap: a resolver candidate naming another city is refused,
  // because the stored name does not contain it.
  const otherCity = proposeTrimmedName({
    canonicalName: 'Orlando HVAC Services',
    canonicalDomain: 'example.invalid',
    candidateNames: [{ name: 'HVAC Service Areas Near Tampa, FL', basis: 'own_site_title' }],
  });
  assert.equal(otherCity, null);
});

// ------------------------------------------------------------------ what is applied

async function seed(name: string, options: {
  domain?: string | null; vertical?: string | null;
} = {}): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: options.domain === null ? null : `https://${options.domain ?? 'seed.invalid'}`,
    phone: `407-555-${String(1000 + Math.floor(Math.random() * 8999)).slice(-4)}`,
    verticalProfileId: options.vertical ?? null,
  }, { discoverySource: 'import' }));
  return accountId;
}

test('a non-company is suppressed, and its evidence is still there afterwards', async () => {
  const accountId = await seed('An 82-year-old Vietnam veteran in St. Augustine says he\'s ...',
    { domain: null });
  await query(
    `insert into search_observations (provider, source_type, observed_name, result_type,
                                      retention_class, account_id, query, observed_at)
     values ('dataforseo','discovery',$2,'organic','transient',$1,'roofing contractor 32095', now())`,
    [accountId, 'An 82-year-old Vietnam veteran in St. Augustine says he\'s ...']);

  const plan = await planRemediation();
  const change = plan.changes.find((entry) => entry.accountId === accountId
    && entry.action === 'SUPPRESS_NON_COMPANY');
  assert.ok(change, 'an article headline with no domain was not proposed for suppression');

  const result = await applyForAccount(accountId, [change!]);
  assert.equal(result.applied.length, 1);

  const { rows } = await query<{
    is_suppressed: boolean; entity_status: string; observations: number; audit: number;
  }>(
    `select a.is_suppressed, a.entity_status,
            (select count(*) from search_observations where account_id = a.account_id)::int as observations,
            (select count(*) from audit_log where subject_id = a.account_id::text)::int as audit
       from accounts a where a.account_id = $1`, [accountId]);
  assert.equal(rows[0]!.is_suppressed, true);
  assert.equal(rows[0]!.entity_status, 'rejected');
  assert.equal(rows[0]!.observations, 1, 'suppression deleted the evidence behind it');
  assert.equal(rows[0]!.audit, 1, 'a change was made with no audit row');

  // And it is reversible: deactivating the suppression puts the Account back.
  await query(`update suppressions set is_active = false where account_id = $1`, [accountId]);
  const { rows: after } = await query<{ is_suppressed: boolean }>(
    'select is_suppressed from accounts where account_id = $1', [accountId]);
  assert.equal(after[0]!.is_suppressed, false);
});

test('an Account a person has worked is never changed automatically', async () => {
  const accountId = await seed('10 Best Roofers in Somewhere, FL', { domain: 'directory.invalid' });
  const { rows: user } = await query<{ user_id: string }>(
    `insert into users (email, email_normalized, display_name, role, password_hash)
     values ('rep@apply.invalid','rep@apply.invalid','A Rep','SALES_REP','x')
     returning user_id`);
  await query(
    `insert into activities (account_id, activity_type, actor_user_id, notes, occurred_at)
     values ($1, 'NOTE', $2, 'called, asked for a callback', now())`,
    [accountId, user[0]!.user_id]);

  const plan = await planRemediation();
  assert.equal(plan.changes.some((entry) => entry.accountId === accountId), false,
    'a worked Account was planned for an automatic change');
  assert.ok(plan.protectedByHumanActivity.includes(accountId));

  // And even handed a change directly, the transaction re-checks and refuses.
  const forced = await applyForAccount(accountId, [{
    accountId, companyName: 'x', action: 'CLEAR_UNSUPPORTED_VERTICAL',
    code: 'VERTICAL_FROM_QUERY_ONLY', reason: 'forced',
    before: {}, after: {},
  }]);
  assert.equal(forced.applied.length, 0);
  assert.match(forced.skipped[0]!.why, /human sales activity/);
});

test('an unsupported trade is cleared, never replaced with a guess', async () => {
  const accountId = await seed('U-Haul Neighborhood Dealer', {
    domain: 'uhaul.invalid', vertical: 'hvac' });
  await query(
    `insert into search_observations (provider, source_type, observed_name, result_type,
                                      retention_class, account_id, query, observed_at)
     values ('dataforseo','discovery','U-Haul Neighborhood Dealer','organic','transient',$1,
             'HVAC contractor 33127', now())`, [accountId]);

  const plan = await planRemediation();
  const change = plan.changes.find((entry) => entry.accountId === accountId
    && entry.action === 'CLEAR_UNSUPPORTED_VERTICAL');
  assert.ok(change, 'a trade held up by nothing but the query was not proposed for clearing');
  await applyForAccount(accountId, [change!]);

  const { rows } = await query<{ vertical: string | null; suppressed: boolean }>(
    `select primary_vertical_profile_id as vertical, is_suppressed as suppressed
       from accounts where account_id = $1`, [accountId]);
  assert.equal(rows[0]!.vertical, null, 'the unsupported trade survived');
  assert.equal(rows[0]!.suppressed, false,
    'a real company was suppressed when only its trade was unsupported');
});

test('every change carries what it was before', async () => {
  const accountId = await seed('Some Category Page in Miami, FL', { domain: 'listings.invalid',
    vertical: 'hvac' });
  await query(
    `insert into search_observations (provider, source_type, observed_name, result_type,
                                      retention_class, account_id, query, observed_at)
     values ('dataforseo','discovery','Some Category Page in Miami, FL','organic','transient',$1,
             'HVAC contractor 33133', now())`, [accountId]);

  const plan = await planRemediation();
  const changes = plan.changes.filter((entry) => entry.accountId === accountId);
  assert.ok(changes.length > 0);
  await applyForAccount(accountId, changes);

  const { rows } = await query<{ action: string; detail: Record<string, unknown> }>(
    `select action, detail from audit_log where subject_id = $1 order by audit_id`, [accountId]);
  assert.equal(rows.length, changes.length);
  for (const row of rows) {
    assert.match(row.action, /^v2_remediation\./);
    assert.ok('before' in row.detail, 'an audit row does not say what it changed from');
    assert.ok('after' in row.detail);
  }
});
