import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { searchProspects } from '../src/domain/search.js';
import { resetDatabase, markEntityVerified } from './helpers.js';

/**
 * Finding a company you already know the name of.
 *
 * The search box compared `like '%term%'` against the name and the domain, so it only
 * found a company spelled exactly as we stored it. One hyphen was enough to lose it:
 * "Del Aire" does not match "Del-Air Heating & Air Conditioning", and "Del-Air" does
 * not match "Del Aire Plumbing". A rep looking up a company they are about to call is
 * told we do not have it, and then either creates it again or concludes the market is
 * empty.
 *
 * A phone number and an email address are how a rep identifies a company after a
 * missed call or a reply, and neither was searchable at all.
 */

let viewer: { userId: string; role: 'SALES_MANAGER' };
let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  sequence = 0;
  const userId = await createUser({
    email: 'company.search@test.local', displayName: 'Search', role: 'SALES_MANAGER',
    password: 'company-search-password-not-a-secret' });
  viewer = { userId, role: 'SALES_MANAGER' };
});

async function seed(name: string, website?: string): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: website ?? `https://company${sequence}.example-co`,
    phone: `904-555-${String(7000 + sequence).slice(-4)}`,
    city: 'Orlando', state: 'FL', postalCode: '32801',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await markEntityVerified(accountId);
  return accountId;
}

async function found(text: string): Promise<string[]> {
  const response = await searchProspects({ text, page: 1, pageSize: 50 }, viewer);
  return response.results.map((row) => row.company_name).sort();
}

test('a hyphen does not hide a company', async () => {
  await seed('Del-Air Heating & Air Conditioning');

  // What the rep types, in each of the ways they might reasonably type it.
  for (const typed of ['Del Aire', 'Del-Air', 'del air', 'DelAir', 'Del  Air']) {
    const names = await found(typed);
    assert.deepEqual(names, ['Del-Air Heating & Air Conditioning'],
      `"${typed}" did not find the company`);
  }
});

test('and it does not hide the other one either', async () => {
  await seed('Del Aire Plumbing');
  for (const typed of ['Del-Air', 'Del Aire', 'delaire']) {
    assert.deepEqual(await found(typed), ['Del Aire Plumbing'], `"${typed}" missed it`);
  }
});

test('an ampersand, a period and a comma stop mattering', async () => {
  await seed('St. Johns Heating & Air, Inc.');
  for (const typed of ['St Johns Heating and Air', 'st.johns', 'St Johns', 'stjohns heating']) {
    const names = await found(typed);
    assert.ok(names.includes('St. Johns Heating & Air, Inc.'),
      `"${typed}" did not find the company`);
  }
});

test('a partial name still works', async () => {
  await seed('Coastal Climate Control');
  assert.deepEqual(await found('coastal'), ['Coastal Climate Control']);
  assert.deepEqual(await found('climate'), ['Coastal Climate Control']);
});

test('a different company is still a different company', async () => {
  await seed('Del-Air Heating & Air Conditioning');
  await seed('Bayside Cooling');

  assert.deepEqual(await found('Del Aire'), ['Del-Air Heating & Air Conditioning'],
    'punctuation-insensitive matching started matching everything');
  assert.deepEqual(await found('Bayside'), ['Bayside Cooling']);
  assert.deepEqual(await found('Nonexistent Roofing'), [],
    'a company we do not have was reported as found');
});

test('a domain still finds its company', async () => {
  await seed('Southern Air', 'https://southernair.example-co');
  assert.deepEqual(await found('southernair.example-co'), ['Southern Air']);
  assert.deepEqual(await found('southernair'), ['Southern Air']);
});

test('a phone number finds the company, however it is written', async () => {
  const accountId = await seed('Gulf Coast Heating and Air');
  await query(
    `insert into contact_endpoints
       (account_id, endpoint_type, normalized_value, display_value, endpoint_role)
     values ($1, 'PHONE', '+14075550150', '(407) 555-0150', 'MAIN_BUSINESS_LINE')`,
    [accountId]);

  // A missed call gives a rep the number, not the name, and never in one format.
  for (const typed of ['4075550150', '(407) 555-0150', '407-555-0150', '+1 407 555 0150']) {
    assert.deepEqual(await found(typed), ['Gulf Coast Heating and Air'],
      `"${typed}" did not find the company`);
  }
});

test('a short run of digits is not treated as a phone number', async () => {
  // "555" in a company name must not turn into a phone lookup across the table.
  const accountId = await seed('Gulf Coast Heating and Air');
  await query(
    `insert into contact_endpoints
       (account_id, endpoint_type, normalized_value, display_value, endpoint_role)
     values ($1, 'PHONE', '+14075550150', '(407) 555-0150', 'MAIN_BUSINESS_LINE')`,
    [accountId]);
  assert.deepEqual(await found('555'), [], 'three digits matched a phone number');
});

test('an email address finds the company that published it', async () => {
  const accountId = await seed('Southern Air', 'https://southernair.example-co');
  await query(
    `insert into contact_endpoints
       (account_id, endpoint_type, normalized_value, display_value, endpoint_role)
     values ($1, 'EMAIL', 'dispatch@southernair.example-co', 'dispatch@southernair.example-co',
             'ROLE_EMAIL')`,
    [accountId]);

  assert.deepEqual(await found('dispatch@southernair.example-co'), ['Southern Air']);
});

test('search still refuses to show a suppressed company', async () => {
  // The single most important filter in the system must survive a widened match.
  const accountId = await seed('Del-Air Heating & Air Conditioning');
  await query('update accounts set is_suppressed = true where account_id = $1', [accountId]);
  assert.deepEqual(await found('Del Aire'), [],
    'a suppressed company was returned by the search box');
});
