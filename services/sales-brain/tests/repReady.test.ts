import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser, markEntityVerified } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';
import { renderAccountPage } from '../src/web/pages/account.js';
import { readinessFor } from '../src/domain/repReady.js';
import { scoreAccount } from '../src/scoring/score.js';

/**
 * Found is not researched, and researched is not workable.
 * Authority: Issue #3 C / M-16.
 *
 * Discovery finding a company and research finishing with it are different events,
 * and the portal treated the first as though it were the second: a name, a URL and a
 * tier appeared in Find Prospects and a rep opened it to nothing they could act on.
 * The cost is not the wasted click. It is a rep learning the list is unreliable,
 * which is expensive to undo and slow to notice.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(input: {
  name?: string; website?: string | null; phone?: string | null;
  vertical?: string | null; located?: boolean;
} = {}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: input.name ?? `Ready Air ${sequence}`,
    website: input.website === undefined ? `https://ready${sequence}.invalid` : input.website,
    phone: input.phone === undefined ? `904-555-${String(5000 + sequence).slice(-4)}` : input.phone,
    city: input.located === false ? null : 'St. Augustine',
    state: input.located === false ? null : 'FL',
    postalCode: input.located === false ? null : '32095',
    verticalProfileId: input.vertical === undefined ? 'hvac' : input.vertical,
  }, { discoverySource: 'market_miner:dataforseo' }));
  // Stands for a candidate the resolver promoted: the only way a machine
  // makes an Account now.
  await markEntityVerified(accountId);
  return accountId;
}

/** Everything a full research pass would leave behind. */
async function fullyResearched(accountId: string): Promise<void> {
  await query(
    `insert into research_runs (account_id, trigger, started_at, completed_at, status,
                                adapter_results)
     values ($1, 'newly_discovered', now(), now(), 'completed', $2::jsonb)`,
    [accountId, JSON.stringify({ pages_fetched: 4 })]);
  await query(
    `update accounts set last_researched_at = now(),
            research_fresh_until = now() + interval '10 days' where account_id = $1`,
    [accountId]);
  await query(
    `insert into contacts (account_id, full_name, role_category, is_role_placeholder, status)
     values ($1, 'Dana Reyes', 'owner', false, 'ACTIVE')`, [accountId]);
  await query(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, normalized_value, confidence,
        can_state_as_fact, source_type, source_provider, expires_at, freshness)
     values ($1, 'paid_acquisition', 'active_google_search_ad', 'ad seen', 'yes',
             'confirmed', true, 'provider_serp', 'dataforseo',
             now() + interval '48 hours', 'fresh')`, [accountId]);
  await scoreAccount(accountId);
  // Every phone screened against the registry.
  await query(
    `insert into dnc_screen_log (endpoint_id, normalized_value, status, normalized_result,
                                 reason_code, policy_version, screened_at)
     select endpoint_id, normalized_value, 'NO_MATCH', 'CLEAR', 'NOT_LISTED', 'v1', now()
       from contact_endpoints where account_id = $1 and endpoint_type = 'PHONE'`,
    [accountId]);
}

function requirement(readiness: Awaited<ReturnType<typeof readinessFor>>, key: string) {
  const found = readiness!.requirements.find((item) => item.key === key);
  assert.ok(found, `no requirement called ${key}`);
  return found!;
}

// ---------------------------------------------------------------- the contract --

test('a company we have only just found is not rep-ready', async () => {
  const accountId = await account();
  const readiness = (await readinessFor(accountId))!;

  assert.equal(readiness.state, 'RESEARCH_NEEDED',
    'a company discovered seconds ago was offered to a rep as ready to work');
  assert.ok(readiness.missing.length > 0);
  // And it says what is left rather than that the company is bad.
  assert.match(readiness.summary, /still to do before a rep should open this/);
});

test('a fully researched company is rep-ready, and says why', async () => {
  const accountId = await account();
  await fullyResearched(accountId);

  const readiness = (await readinessFor(accountId))!;
  assert.equal(readiness.state, 'REP_READY',
    `still not ready: ${readiness.missing.map((item) => item.key).join(', ')}`);
  assert.deepEqual(readiness.missing, []);
  assert.match(readiness.summary, /identified, located, researched, scored and screened/);
});

test('every requirement that fails explains what would meet it', async () => {
  const accountId = await account({ website: null, phone: null, vertical: null, located: false });
  const readiness = (await readinessFor(accountId))!;

  for (const item of readiness.missing) {
    assert.ok(item.detail.length > 30, `${item.key} fails with no explanation`);
    // Never a verdict on the company: the missing thing is work we have not done.
    assert.doesNotMatch(item.detail, /bad prospect|not worth|poor quality/i, item.key);
  }
});

// -------------------------------------------------- the individual requirements --

test('a heading is not a company', async () => {
  for (const name of ['HVAC Contractors Near You', 'Best Roofing Companies',
    'Plumbing Services', '10 Best AC Repair']) {
    const accountId = await account({ name });
    const readiness = (await readinessFor(accountId))!;
    assert.equal(requirement(readiness, 'identity').met, false,
      `"${name}" was accepted as a company name`);
  }

  const real = await account({ name: 'Coastal Air Conditioning' });
  assert.equal(requirement((await readinessFor(real))!, 'identity').met, true);
});

test('a company we cannot place is not workable by a rep', async () => {
  const accountId = await account({ located: false });
  const geography = requirement((await readinessFor(accountId))!, 'geography');
  assert.equal(geography.met, false);
  assert.match(geography.detail, /called at a sensible hour/,
    'the reason does not say what the missing geography actually costs');
});

test('no vertical means scored against nothing, and the contract says so', async () => {
  const accountId = await account({ vertical: null });
  const vertical = requirement((await readinessFor(accountId))!, 'vertical');
  assert.equal(vertical.met, false);
  assert.match(vertical.detail, /scored against nothing/);
});

test('never having looked for a contact route is different from having failed to find one', async () => {
  const untouched = await account({ phone: null });
  assert.match(requirement((await readinessFor(untouched))!, 'contact_route').detail,
    /Nobody has looked/);

  const searched = await account({ phone: null });
  await query(
    `insert into research_runs (account_id, trigger, started_at, completed_at, status,
                                adapter_results)
     values ($1, 'newly_discovered', now(), now(), 'completed', '{"pages_fetched":3}'::jsonb)`,
    [searched]);
  await query('update accounts set last_researched_at = now() where account_id = $1', [searched]);
  assert.match(requirement((await readinessFor(searched))!, 'contact_route').detail,
    /wider source, not a rep/);
});

test('a named person is not required, but having looked is', async () => {
  const accountId = await account();
  await fullyResearched(accountId);
  await query(`delete from contacts where account_id = $1`, [accountId]);

  // Research ran, so somebody looked; no name was found. That is workable -- most
  // cold calls start with a gatekeeper.
  const readiness = (await readinessFor(accountId))!;
  assert.equal(requirement(readiness, 'decision_maker_attempted').met, true,
    'a company with no named contact was blocked, though research had looked');
  assert.equal(readiness.state, 'REP_READY');
});

test('an unscored company is not ranked as a judgement about it', async () => {
  const accountId = await account();
  const scored = requirement((await readinessFor(accountId))!, 'scored');
  assert.equal(scored.met, false);
  assert.match(scored.detail, /not a judgement about the/);
});

test('an unscreened number is not dialable, and the contract knows it', async () => {
  const accountId = await account();
  await fullyResearched(accountId);
  await query('delete from dnc_screen_log');

  const readiness = (await readinessFor(accountId))!;
  const dnc = requirement(readiness, 'dnc_checked');
  assert.equal(dnc.met, false);
  assert.match(dnc.detail, /fail-closed/);
  assert.equal(readiness.state, 'RESEARCH_NEEDED');
});

// ------------------------------------------------- work items versus verdicts ----

test('a suppressed company is not workable, and is not a research job', async () => {
  const accountId = await account();
  await fullyResearched(accountId);
  await query(
    `update accounts set is_suppressed = true, suppression_summary = 'Asked not to be called'
      where account_id = $1`, [accountId]);

  const readiness = (await readinessFor(accountId))!;
  assert.equal(readiness.state, 'NOT_WORKABLE',
    'a suppressed company sat in the same queue as one waiting for a phone number');
  assert.match(readiness.summary, /Asked not to be called/);
  assert.equal(requirement(readiness, 'not_suppressed').blocking, true);
});

test('a merge tombstone points at the record that survived', async () => {
  const survivor = await account();
  const tombstone = await account();
  await query('update accounts set merged_into_account_id = $2 where account_id = $1',
    [tombstone, survivor]);

  const readiness = (await readinessFor(tombstone))!;
  assert.equal(readiness.state, 'NOT_WORKABLE');
  assert.match(readiness.summary, /surviving Account/);
});

// ------------------------------------------------------------------ on the page --

test('the page tells a rep what is missing rather than showing an empty record', async () => {
  const accountId = await account({ phone: null });
  const manager = await makeUser(`Ready Manager ${Date.now()}`, 'SALES_MANAGER');
  const detail = await getAccountDetail(accountId,
    { userId: manager.userId, role: 'SALES_MANAGER' });
  const page = renderAccountPage(detail!, { ...manager, role: 'SALES_MANAGER' } as any,
    {} as any, undefined);

  assert.match(page, /Research needed before this is worth a call/);
  for (const item of detail!.readiness.missing.slice(0, 3)) {
    assert.ok(page.includes(item.label), `"${item.label}" is not shown to the rep`);
  }
});

test('a ready record does not shout about readiness', async () => {
  const accountId = await account();
  await fullyResearched(accountId);
  const manager = await makeUser(`Ready Manager 2 ${Date.now()}`, 'SALES_MANAGER');
  const detail = await getAccountDetail(accountId,
    { userId: manager.userId, role: 'SALES_MANAGER' });
  const page = renderAccountPage(detail!, { ...manager, role: 'SALES_MANAGER' } as any,
    {} as any, undefined);

  assert.doesNotMatch(page, /Research needed before this is worth a call/,
    'a ready record carries a banner about not being ready');
});
