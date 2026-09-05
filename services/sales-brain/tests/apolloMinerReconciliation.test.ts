import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount, upsertEndpoint } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { createOpportunity } from '../src/domain/opportunities.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters,
  type DiscoveryAdapter, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * A company we already bought, found again by a search provider.
 * Authority: Issue #3 Phase H, Issue #2 EXACT CASE 6.
 *
 * The purchased Apollo roofing list is in the local QA database: 250 rows, 230
 * Accounts, 19 merged, 1 rejected. When the miner searches that market it will find
 * some of those same companies. The rule is that it reconciles into the Account we
 * already hold -- ownership, DNC, notes, opportunities and endpoint state all
 * survive -- while both source facts are kept.
 *
 * Mining may enrich a suppressed Account. It may never unsuppress one.
 */

const APOLLO = 'apollo_purchased_import';
const PROVIDER = 'market_miner:dataforseo';
let manager: Awaited<ReturnType<typeof makeUser>>;
let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  manager = await makeUser('Reconcile Manager', 'SALES_MANAGER');
});

/** An Account as the Apollo import would have left it. */
async function importedAccount(input: {
  name: string; domain: string; phone: string;
}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: input.name,
    website: `https://${input.domain}`,
    phone: input.phone,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: APOLLO }));
  return accountId;
}

function minerFinding(businesses: { name: string; website?: string; phone?: string }[]): DiscoveryAdapter {
  return {
    name: 'dataforseo', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'OK',
        businesses: businesses.map((business) => ({
          name: business.name,
          website: business.website ?? null,
          phone: business.phone ?? null,
          resultType: 'PAID_SEARCH_TEXT',
        })),
        providerRows: businesses.length, rejectedRows: 0, duplicateRows: 0,
      };
    },
  };
}

async function mine(): Promise<Record<string, any>> {
  const job = await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: manager.userId });
  await drainQueue(10);
  const { rows } = await query<Record<string, any>>(
    `select outcome, outcome_reason, progress, job_type, job_id, status, last_error, attempts
       from jobs where job_type = 'market_mine' order by created_at desc limit 1`);
  if (!rows[0]) throw new Error(`no market_mine job; enqueue returned ${JSON.stringify(job)}`);
  return rows[0];
}

test('a company already bought is matched, not created a second time', async () => {
  await importedAccount({
    name: 'Coastal Roofing LLC', domain: 'coastalroof.example.com', phone: '904-555-9001' });

  registerDiscoveryAdapter(minerFinding([
    // The provider spells it differently, as providers do.
    { name: 'Coastal Roofing', website: 'https://coastalroof.example.com', phone: '904-555-9001' },
  ]));

  const job = await mine();
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(progress['matchedExisting'], 1,
    `status=${job['status']} outcome=${job['outcome']} err=${job['last_error']} attempts=${job['attempts']}`);
  assert.equal(progress['discoveredNew'], 0);
  assert.equal(job['outcome'], 'COMPLETED',
    'finding a company we already hold is coverage, not an empty market');

  const { rows } = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(rows[0]!.n, 1, 'the same company exists twice');
});

test('both source facts survive the reconciliation', async () => {
  const accountId = await importedAccount({
    name: 'Sable Run Roofing', domain: 'sablerun.example.com', phone: '904-555-9002' });
  registerDiscoveryAdapter(minerFinding([
    { name: 'Sable Run Roofing', website: 'https://sablerun.example.com' },
  ]));
  await mine();

  const { rows } = await query<{ activity_type: string; source_system: string }>(
    `select activity_type, source_system from activities
      where account_id = $1 and activity_type in ('DISCOVERED','SOURCE_OBSERVED')
      order by activity_type`, [accountId]);

  const facts = rows.map((row) => `${row.activity_type}:${row.source_system}`);
  assert.ok(facts.includes(`DISCOVERED:${APOLLO}`),
    'where the company originally came from was erased');
  assert.ok(facts.includes(`SOURCE_OBSERVED:${PROVIDER}`),
    'that a provider independently found them advertising was not recorded anywhere durable');
});

test('a second sighting by the same source on the same day is not a thousand rows', async () => {
  const accountId = await importedAccount({
    name: 'Repeat Roofing', domain: 'repeatroof.example.com', phone: '904-555-9003' });
  registerDiscoveryAdapter(minerFinding([
    { name: 'Repeat Roofing', website: 'https://repeatroof.example.com' },
  ]));

  await mine();
  await query(`update jobs set status = 'SUCCEEDED', idempotency_key = null`);
  await mine();
  await query(`update jobs set status = 'SUCCEEDED', idempotency_key = null`);
  await mine();

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from activities
      where account_id = $1 and activity_type = 'SOURCE_OBSERVED'`, [accountId]);
  assert.equal(rows[0]!.n, 1, 're-searching a market wrote the same fact three times');
});

test('mining may enrich a suppressed Account and may never unsuppress it', async () => {
  const accountId = await importedAccount({
    name: 'Do Not Call Roofing', domain: 'dnc.example.com', phone: '904-555-9004' });
  const rep = { userId: manager.userId, role: 'SALES_MANAGER' as const, activeClaimTarget: null };
  await claimAccount(accountId, rep, null);
  const dnc = await recordDisposition({
    accountId, disposition: 'DO_NOT_CONTACT', notes: 'Asked never to be called again',
    channel: 'phone',
  }, rep);
  assert.ok(dnc.ok);

  const before = await query<{ is_suppressed: boolean }>(
    'select is_suppressed from accounts where account_id = $1', [accountId]);
  assert.equal(before.rows[0]!.is_suppressed, true);

  registerDiscoveryAdapter(minerFinding([
    { name: 'Do Not Call Roofing', website: 'https://dnc.example.com' },
  ]));
  await mine();

  const after = await query<{ is_suppressed: boolean }>(
    'select is_suppressed from accounts where account_id = $1', [accountId]);
  assert.equal(after.rows[0]!.is_suppressed, true,
    'a discovery run lifted a do-not-contact');

  const suppressions = await query<{ n: number }>(
    `select count(*)::int as n from suppressions where account_id = $1 and is_active`,
    [accountId]);
  assert.equal(suppressions.rows[0]!.n, 1, 'the suppression record itself survived');
});

test('ownership, notes, opportunities and meetings survive being re-discovered', async () => {
  const accountId = await importedAccount({
    name: 'Owned Roofing', domain: 'ownedroof.example.com', phone: '904-555-9005' });
  const repUserId = await createUser({
    email: 'brent.reconcile@test.local', displayName: 'Brent', role: 'SALES_REP',
    password: 'reconcile-password' });
  const rep = { userId: repUserId, role: 'SALES_REP' as const, activeClaimTarget: null };
  await claimAccount(accountId, rep, null);

  await recordDisposition({
    accountId, disposition: 'DECISION_MAKER_REACHED',
    notes: 'Spoke to the owner, they are drowning in after-hours calls',
    channel: 'phone',
  }, rep);
  await query(
    `insert into prospect_statements (account_id, statement_text, category, source_class)
     values ($1, 'We are turning away work because nobody answers at night', 'PROBLEM',
             'prospect_verified')`, [accountId]);
  const opportunity = await createOpportunity({
    accountId,
    problemSummary: 'They are turning away after-hours calls because nobody answers the phone',
    sourceChannel: 'portal',
  }, rep);
  assert.ok(opportunity.ok, opportunity.message);

  registerDiscoveryAdapter(minerFinding([
    { name: 'Owned Roofing', website: 'https://ownedroof.example.com' },
  ]));
  await mine();

  const account = await query<{
    current_owner_user_id: string; relationship_state: string; active_opportunity_id: string;
  }>(
    `select current_owner_user_id, relationship_state, active_opportunity_id
       from accounts where account_id = $1`, [accountId]);
  assert.equal(account.rows[0]!.current_owner_user_id, repUserId, 'the rep lost their account');
  assert.equal(account.rows[0]!.relationship_state, 'ACTIVE_OPPORTUNITY');
  assert.equal(account.rows[0]!.active_opportunity_id, opportunity.opportunityId);

  const notes = await query<{ n: number }>(
    `select count(*)::int as n from activities
      where account_id = $1 and activity_type = 'CALL_ATTEMPT'`, [accountId]);
  assert.equal(notes.rows[0]!.n, 1, 'the conversation history was lost');

  const statements = await query<{ n: number }>(
    'select count(*)::int as n from prospect_statements where account_id = $1', [accountId]);
  assert.equal(statements.rows[0]!.n, 1, "the prospect's own words were lost");
});

test('a wrong number stays wrong after the provider reports it again', async () => {
  const accountId = await importedAccount({
    name: 'Reassigned Roofing', domain: 'reassigned.example.com', phone: '904-555-9006' });

  const { rows: endpoints } = await query<{ endpoint_id: string }>(
    `select endpoint_id from contact_endpoints where account_id = $1`, [accountId]);
  assert.ok(endpoints[0], 'the import created a phone endpoint');
  await query(
    `update contact_endpoints set is_active = false, quality_state = 'WRONG_NUMBER'
      where endpoint_id = $1`, [endpoints[0]!.endpoint_id]);

  registerDiscoveryAdapter(minerFinding([
    // The provider still lists the old number, because a directory does not know.
    { name: 'Reassigned Roofing', website: 'https://reassigned.example.com',
      phone: '904-555-9006' },
  ]));
  await mine();

  const { rows } = await query<{ is_active: boolean; quality_state: string }>(
    `select is_active, quality_state from contact_endpoints where endpoint_id = $1`,
    [endpoints[0]!.endpoint_id]);
  assert.equal(rows[0]!.is_active, false,
    'a provider listing revived a number somebody told us was not theirs');
  assert.equal(rows[0]!.quality_state, 'WRONG_NUMBER');
});

test('a genuinely different company in the same market is a new Account', async () => {
  await importedAccount({
    name: 'Coastal Roofing LLC', domain: 'coastalroof.example.com', phone: '904-555-9007' });
  registerDiscoveryAdapter(minerFinding([
    { name: 'Coastal Roofing', website: 'https://coastalroof.example.com', phone: '904-555-9007' },
    { name: 'Anastasia Island Roofing', website: 'https://anastasia.example.com',
      phone: '904-555-9008' },
  ]));

  const job = await mine();
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(progress['matchedExisting'], 1);
  assert.equal(progress['discoveredNew'], 1,
    'a different company was folded into the one we held');

  const { rows } = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(rows[0]!.n, 2);
});
