import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';
import { resetDatabase, markEntityVerified } from './helpers.js';

/**
 * The top row of the contact list is what a rep dials.
 *
 * The order read `endpoint_role` and nothing else, so a DIRECT_BUSINESS_LINE that is
 * disconnected sorted above a confirmed main line, and a suppressed endpoint sat in
 * the middle of the list rather than at the end. An ordering that ignores whether the
 * number still works is an ordering that hands a rep a dead line first.
 */

let viewer: { userId: string; role: 'SALES_MANAGER' };
let accountId: string;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  const userId = await createUser({
    email: 'endpoint.rank@test.local', displayName: 'Rank', role: 'SALES_MANAGER',
    password: 'endpoint-rank-password-not-a-secret' });
  viewer = { userId, role: 'SALES_MANAGER' };
  const created = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Southern Air', website: 'https://southernair.example',
    phone: '407-555-0150', city: 'Orlando', state: 'FL', postalCode: '32801',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:dataforseo' }));
  accountId = created.accountId;
  await markEntityVerified(accountId);
  // upsertAccount records the primary phone as an endpoint; this suite decides the
  // order itself, so it starts from an empty list.
  await query('delete from contact_endpoints where account_id = $1', [accountId]);
});

async function addEndpoint(input: {
  value: string; type?: 'PHONE' | 'EMAIL'; role: string; quality?: string;
  suppressed?: boolean; active?: boolean;
}): Promise<void> {
  await query(
    `insert into contact_endpoints
       (account_id, endpoint_type, normalized_value, display_value, endpoint_role,
        quality_state, is_suppressed, is_active)
     values ($1,$2,$3,$3,$4,$5,$6,$7)`,
    [accountId, input.type ?? 'PHONE', input.value, input.role,
     input.quality ?? 'UNKNOWN', input.suppressed ?? false, input.active ?? true]);
}

async function order(): Promise<string[]> {
  const detail = await getAccountDetail(accountId, viewer);
  assert.ok(detail, 'the account has no detail');
  return detail.accountEndpoints.map((endpoint) => endpoint.display_value);
}

test('a dead direct line does not outrank a working main line', async () => {
  await addEndpoint({ value: '+14075550001', role: 'DIRECT_BUSINESS_LINE',
    quality: 'DISCONNECTED' });
  await addEndpoint({ value: '+14075550002', role: 'MAIN_BUSINESS_LINE',
    quality: 'CURRENT_BUSINESS_CONFIRMED' });

  const ranked = await order();
  assert.equal(ranked[0], '+14075550002',
    'a disconnected number was the first thing offered to a rep');
  assert.equal(ranked[1], '+14075550001');
});

test('a wrong number and a reassigned number go to the end', async () => {
  await addEndpoint({ value: '+14075550010', role: 'DIRECT_BUSINESS_LINE',
    quality: 'WRONG_NUMBER' });
  await addEndpoint({ value: '+14075550011', role: 'DIRECT_BUSINESS_LINE',
    quality: 'REASSIGNED_NUMBER_RISK' });
  await addEndpoint({ value: '+14075550012', role: 'MOBILE_UNKNOWN_USE',
    quality: 'PUBLIC_OBSERVED_UNVERIFIED' });

  assert.equal((await order())[0], '+14075550012',
    'a known-bad number outranked a merely unverified one');
});

test('a suppressed endpoint is last, whatever its role says', async () => {
  await addEndpoint({ value: '+14075550020', role: 'DIRECT_BUSINESS_LINE',
    quality: 'DIRECT_BUSINESS_CONFIRMED', suppressed: true });
  await addEndpoint({ value: '+14075550021', role: 'CALL_TRACKING_NUMBER',
    quality: 'UNKNOWN' });

  const ranked = await order();
  assert.equal(ranked[ranked.length - 1], '+14075550020',
    'a suppressed number was not sorted to the end');
});

test('an inactive endpoint is last too', async () => {
  await addEndpoint({ value: '+14075550030', role: 'DIRECT_BUSINESS_LINE',
    quality: 'DIRECT_BUSINESS_CONFIRMED', active: false });
  await addEndpoint({ value: '+14075550031', role: 'MAIN_BUSINESS_LINE', quality: 'UNKNOWN' });

  assert.equal((await order())[0], '+14075550031',
    'an inactive endpoint was offered first');
});

test('a campaign number ranks below the company own lines', async () => {
  // A tracking number can stop pointing at the company when the campaign ends, and
  // calling it tells the advertiser we called.
  await addEndpoint({ value: '+18005550040', role: 'CALL_TRACKING_NUMBER', quality: 'UNKNOWN' });
  await addEndpoint({ value: '+14075550041', role: 'MAIN_BUSINESS_LINE', quality: 'UNKNOWN' });
  await addEndpoint({ value: '+18885550042', role: 'TOLL_FREE_BUSINESS', quality: 'UNKNOWN' });

  const ranked = await order();
  assert.equal(ranked[ranked.length - 1], '+18005550040',
    'a call tracking number outranked the company own lines');
});

test('the role order within working numbers is still the intended one', async () => {
  await addEndpoint({ value: '+14075550050', role: 'MAIN_BUSINESS_LINE', quality: 'UNKNOWN' });
  await addEndpoint({ value: '+14075550051', role: 'DIRECT_BUSINESS_LINE', quality: 'UNKNOWN' });
  await addEndpoint({ value: '+14075550052', role: 'MOBILE_ASSERTED_BUSINESS', quality: 'UNKNOWN' });

  assert.deepEqual(await order(),
    ['+14075550051', '+14075550052', '+14075550050']);
});

test('a confirmed value beats a guessed one at the same role', async () => {
  await addEndpoint({ value: 'guess@southernair.example', type: 'EMAIL',
    role: 'ROLE_EMAIL', quality: 'GUESSED_UNVERIFIED' });
  await addEndpoint({ value: 'dispatch@southernair.example', type: 'EMAIL',
    role: 'ROLE_EMAIL', quality: 'YAD_CONFIRMED_DELIVERABLE' });

  assert.equal((await order())[0], 'dispatch@southernair.example',
    'a guessed address was offered before a confirmed one');
});

test('a bounced address is not offered first', async () => {
  await addEndpoint({ value: 'bounced@southernair.example', type: 'EMAIL',
    role: 'DIRECT_PERSON_EMAIL', quality: 'HARD_BOUNCE' });
  await addEndpoint({ value: 'office@southernair.example', type: 'EMAIL',
    role: 'GENERAL_BUSINESS_EMAIL', quality: 'DOMAIN_VALID_UNVERIFIED' });

  assert.equal((await order())[0], 'office@southernair.example',
    'a hard-bounced address was offered before a working one');
});
