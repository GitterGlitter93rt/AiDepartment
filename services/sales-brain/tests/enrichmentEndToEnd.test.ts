import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase, markEntityVerified, makeUser } from './helpers.js';
import { runContactResearch } from '../src/workers/contactResearch.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';
import { renderAccountBody } from '../src/web/pages/account.js';
import { resetFetchState } from '../src/resolver/fetcher.js';
import { loadSnapshot } from '../src/sources/snapshots.js';
import { parseTsbpeDataset } from '../src/sources/adapters/txTsbpe.js';
import * as fixtures from './support/fixtures/sources/index.js';

/**
 * The whole chain, once.
 *
 * Discovery → research → official sources → evidence → fact model → the page a rep
 * reads. Every piece is unit-tested; this is the test that fails when they are each
 * correct and wired to nothing. What it asserts is the product brief: can a rep open
 * one account and answer who they are, whether they are real, who to ask for and what
 * to pitch.
 */

let realFetch: typeof globalThis.fetch;
let sequence = 0;

const SITE = `<!doctype html><html><head>
<title>Lone Star Drain Works | Austin Plumbing</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Emergency plumbing, drain cleaning and water heaters in Austin since 2009.">
<script src="https://www.googletagmanager.com/gtag/js?id=AW-4455667"></script>
<script src="https://cdn.callrail.com/companies/9/x/12/swap.js"></script>
</head><body>
<h1>Lone Star Drain Works</h1>
<p>Family owned and operated, proudly serving Austin since 2009.</p>
<p>Open 24/7 for emergency plumbing. Financing available. Se habla espanol.</p>
<p>Call us at (512) 555-1212 or email <a href="mailto:service@lonestar.invalid">service@lonestar.invalid</a></p>
<a href="/contact-us">Contact</a>
<a href="/careers">We are hiring</a>
<a href="https://www.facebook.com/lonestardrain">Facebook</a>
<footer>&copy; 2026 Lone Star Drain Works</footer>
</body></html>`;

before(() => { realFetch = globalThis.fetch; });
after(async () => { globalThis.fetch = realFetch; await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  resetFetchState();
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const path = new URL(url).pathname;
    if (path === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n',
        { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (path === '/' || path === '/contact-us') {
      return new Response(SITE, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
  }) as typeof globalThis.fetch;
});

async function seedTexasPlumber(): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Lone Star Drain Works LLC',
    website: 'https://lonestar.invalid',
    phone: '512-555-1212',
    city: 'Austin', state: 'TX', postalCode: '78701',
    verticalProfileId: 'plumbing',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await markEntityVerified(accountId);
  return accountId;
}

/** The plumbing board dataset, loaded once as it would be in production. */
async function loadPlumbingBoard(): Promise<void> {
  const records = parseTsbpeDataset(fixtures.TSBPE_DATASET);
  await loadSnapshot({
    sourceId: 'tx_tsbpe', dataset: 'licensees', parserVersion: 'v1',
    content: fixtures.TSBPE_DATASET,
    sourceReference: 'https://tsbpe.texas.gov/example-dataset',
    records: records.map((record) => ({
      matchCompanyName: record.companyName, matchPersonName: record.licenseeName,
      licenseNumber: record.licenseNumber, city: record.city, stateRegion: 'TX',
      payload: record as unknown as Record<string, unknown>,
    })),
  });
}

test('research reads the site and records what it found', async () => {
  const accountId = await seedTexasPlumber();
  const outcome = await runContactResearch(accountId, 'newly_discovered');

  assert.ok(outcome.pagesFetched > 0, 'the crawl read nothing');
  assert.ok(outcome.stagesRun.includes('A_company_first_party'));

  // The official stage is wrapped so a fault cannot cost the crawl, which means a
  // fault in it is *silent*. This is the assertion that makes it audible: a broken
  // query in the context builder once skipped every official source while every unit
  // test -- all of which hand-build that context -- passed.
  const brokenStage = outcome.stagesSkipped
    .find((stage) => /could not run/i.test(stage.reason));
  assert.equal(brokenStage, undefined,
    `official source research failed silently: ${brokenStage?.reason ?? ''}`);

  const { rows } = await query<{ claim_key: string; category: string }>(
    'select claim_key, category from evidence_records where account_id = $1', [accountId]);
  const keys = new Set(rows.map((row) => row.claim_key));

  // The company, in its own words.
  assert.ok(keys.has('year_founded'), 'the founding year on the page was not recorded');
  assert.ok(keys.has('family_owned'));
  assert.ok(keys.has('spanish_language_service'));
  // What it runs.
  assert.ok(keys.has('tech_google_ads_tag'), 'a Google Ads tag on the page was missed');
  assert.ok(keys.has('tech_callrail'));
  // How to get in.
  assert.ok(keys.has('route_contact_form'));
  assert.ok(keys.has('route_careers'));
  // Who it links to.
  assert.ok(keys.has('social_facebook'));
  // Which inbox is which: the fixture publishes service@, not sales@.
  assert.ok(keys.has('inbox_service'),
    'a service inbox was recorded as an undifferentiated email address');
  assert.ok(!keys.has('inbox_sales'),
    'an inbox the site does not publish was invented');
  // What the site itself is like.
  assert.ok(keys.has('site_mobile_viewport'));
});

test('a Texas plumber gets its Responsible Master Plumber from the board', async () => {
  await loadPlumbingBoard();
  const accountId = await seedTexasPlumber();
  await runContactResearch(accountId, 'newly_discovered');

  const { rows } = await query<{ claim_text: string; normalized_value: string | null }>(
    `select claim_text, normalized_value from evidence_records
      where account_id = $1 and claim_key = 'responsible_master_plumber'`, [accountId]);
  assert.equal(rows.length, 1, 'the most valuable person on a Texas plumbing account was lost');
  assert.equal(rows[0]!.normalized_value, 'JORDAN OKAFOR');
  assert.match(rows[0]!.claim_text, /not by itself evidence of ownership/i);
});

test('the RMP is stored as a qualifier, never as an owner', async () => {
  await loadPlumbingBoard();
  const accountId = await seedTexasPlumber();
  await runContactResearch(accountId, 'newly_discovered');

  const { rows } = await query<{ relationship: string; full_name: string }>(
    `select relationship, full_name from contacts where account_id = $1`, [accountId]);
  const jordan = rows.find((row) => row.full_name?.toUpperCase().includes('JORDAN'));
  if (jordan) {
    assert.notEqual(jordan.relationship, 'OWNER',
      'a regulatory designation became an ownership claim in the database');
  }
});

test('the account page shows a snapshot a rep can act on', async () => {
  await loadPlumbingBoard();
  const accountId = await seedTexasPlumber();
  await runContactResearch(accountId, 'newly_discovered');

  const viewer = await makeUser(`E2E Viewer ${sequence}`, 'SALES_MANAGER');
  const detail = (await getAccountDetail(accountId,
    { userId: viewer.userId, role: 'SALES_MANAGER' }))!;
  const html = String(renderAccountBody(detail, {
    userId: viewer.userId, email: 'e2e@test.local', displayName: 'E2E',
    role: 'SALES_MANAGER',
  } as never));

  assert.match(html, /Business snapshot/, 'the snapshot section did not render');
  assert.match(html, /Responsible Master Plumber/,
    'the RMP was recorded and never shown to the rep');
  assert.match(html, /Where we looked/,
    'the page did not say which sources were consulted');
  // The epistemic labels a rep depends on.
  assert.match(html, /they say/i);
  assert.doesNotMatch(html, /\bOWNER\b/,
    'a role the records never established was rendered as owner');
});

test('a licence gap Texas does not create is never shown as one', async () => {
  // Same company, roofing instead of plumbing: Texas licenses no roofers.
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Hill Country Roofing LLC',
    website: 'https://lonestar.invalid',
    phone: '512-555-9999',
    city: 'Austin', state: 'TX', postalCode: '78701', verticalProfileId: 'roofing',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await markEntityVerified(accountId);
  await runContactResearch(accountId, 'newly_discovered');

  const viewer = await makeUser(`E2E Roof ${sequence}`, 'SALES_MANAGER');
  const detail = (await getAccountDetail(accountId,
    { userId: viewer.userId, role: 'SALES_MANAGER' }))!;
  const html = String(renderAccountBody(detail, {
    userId: viewer.userId, email: 'e2e2@test.local', displayName: 'E2E',
    role: 'SALES_MANAGER',
  } as never));

  assert.match(html, /does not license roofing contractors statewide/i,
    'a Texas roofer was shown a licence gap that does not exist');
});

test('research survives every official source being unavailable', async () => {
  // No snapshot loaded, nothing flagged on: every source declines.
  const accountId = await seedTexasPlumber();
  const outcome = await runContactResearch(accountId, 'newly_discovered');

  assert.ok(outcome.pagesFetched > 0,
    'first-party evidence was lost because official sources could not answer');
  const { rows } = await query<{ n: number }>(
    'select count(*)::int as n from evidence_records where account_id = $1', [accountId]);
  assert.ok(rows[0]!.n > 0, 'the account ended a research run with no evidence at all');
});
