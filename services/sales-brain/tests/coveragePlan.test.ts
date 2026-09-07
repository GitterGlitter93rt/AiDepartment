import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  clearDiscoveryAdapters, registerDiscoveryAdapter, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import {
  marketCoverage, renderMarketCoverage, recordSaturation,
} from '../src/miner/coveragePlan.js';

/**
 * How much of a market we have, and what we have not asked.
 * Authority: Issue #3 J.
 *
 * The one thing this must never produce is a percentage. Nobody knows how many
 * roofers are in 32095 -- not us, not the provider, not the ZIP -- so "68% covered"
 * would be a fraction with an invented denominator, and an operator would plan
 * against it and buy the wrong thing.
 *
 * What can be said honestly is smaller and more useful: which terms we asked, which
 * we did not, what the last searches yielded, and whether new searches are still
 * finding companies we did not hold. That last one has a boundary that has to be
 * said out loud: a market is saturated *for the terms we asked*, which is not the
 * same as exhausted.
 *
 * Two columns existed for this and neither was ever used. `saturation_state` was
 * written and read by nothing. `target_inventory_depth` was printed on the Markets
 * page and influenced no decision anywhere -- an operator could state a goal the
 * system then ignored, which is worse than not having the field.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { clearDiscoveryAdapters(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
});

const ROOFING = { vertical: 'roofing', location: '32095' };

async function hold(name: string, zip = '32095'): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name, website: `https://${name.toLowerCase().replace(/\W+/g, '')}.invalid`,
    phone: null, city: 'St. Augustine', state: 'FL', postalCode: zip,
    verticalProfileId: 'roofing',
  }, { discoverySource: 'import' }));
  return accountId;
}

/** Runs a real market search, finding whatever it is told to. */
async function mine(found: string[], count = 1): Promise<void> {
  clearDiscoveryAdapters();
  let call = 0;
  registerDiscoveryAdapter({
    name: 'coverage-fixture', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      const name = found[call];
      call += 1;
      return {
        status: 'OK',
        businesses: name
          ? [{ name, website: `https://${name}.invalid`, phone: null,
            city: null, state: null, postalCode: null,
            resultType: 'ORGANIC', query: request.search?.term ?? null }]
          : [],
        providerRows: name ? 1 : 2, rejectedRows: name ? 0 : 2, duplicateRows: 0,
      };
    },
  });
  const ops = await makeUser(`Coverage Ops ${Date.now()}${Math.random()}`, 'RESEARCH_OPS');
  await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: count });
  await drainQueue();
}

// ------------------------------------------------------------- no percentages ---

test('there is no coverage percentage anywhere, and the report says why', async () => {
  await hold('Held Roofing');
  const coverage = await marketCoverage(ROOFING);
  const rendered = renderMarketCoverage(coverage);

  assert.doesNotMatch(rendered, /\d+\s*%/,
    'a coverage percentage appeared, and it has no denominator to be a fraction of');
  assert.match(coverage.denominatorNote, /invented denominator/);
  assert.match(rendered, /Nobody knows how many businesses/);
});

test('what is held, and what is asked, are separate numbers', async () => {
  await hold('First Roofing');
  await hold('Second Roofing');

  const coverage = await marketCoverage(ROOFING);
  assert.equal(coverage.inventory, 2, 'imported companies are not counted as held');
  assert.equal(coverage.termsAsked.length, 0,
    'terms were reported as asked when nothing has searched');
  assert.equal(coverage.termsDefined, 5);
});

// -------------------------------------------------------------- saturation -----

test('a market nothing has searched says so, rather than looking empty', async () => {
  const coverage = await marketCoverage(ROOFING);
  assert.equal(coverage.saturation, 'NEVER_SEARCHED');
  assert.match(renderMarketCoverage(coverage), /nothing has searched this market yet/);
});

test('a search that found somebody new means the market is still yielding', async () => {
  await mine(['freshroofer'], 1);
  const coverage = await marketCoverage(ROOFING);
  assert.equal(coverage.saturation, 'STILL_FINDING',
    `saturation read ${coverage.saturation} after a search found a new company`);
  assert.ok(coverage.recentYield.some((entry) => entry.newAccounts > 0));
});

test('terms that stopped finding anyone are saturated for those terms, not for the trade', async () => {
  // The boundary that matters. Asking two of five terms and finding nobody new says
  // something about those two questions and nothing about the other three.
  await mine(['knownroofer'], 1);
  await mine([], 2);

  const coverage = await marketCoverage(ROOFING);
  assert.ok(['SATURATED_FOR_TERMS_ASKED', 'STILL_FINDING'].includes(coverage.saturation),
    coverage.saturation);
  if (coverage.saturation === 'SATURATED_FOR_TERMS_ASKED') {
    assert.ok(coverage.termsNotAsked.length > 0,
      'a market was called saturated for the terms asked with no terms left unasked');
    assert.match(renderMarketCoverage(coverage), /others remain unasked/);
  }
});

test('a run that never reached a provider leaves saturation unknown, not empty', async () => {
  // No adapter at all: the job succeeds, refreshes inventory and searches nothing.
  const ops = await makeUser(`Coverage Blocked ${Date.now()}`, 'RESEARCH_OPS');
  await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId });
  await drainQueue();

  const coverage = await marketCoverage(ROOFING);
  assert.notEqual(coverage.saturation, 'SATURATED_FOR_TERMS_ASKED',
    'a market nothing could search was reported as searched and exhausted');
  assert.notEqual(coverage.saturation, 'SATURATED_FOR_VERTICAL');
});

test('the saturation conclusion is written where the column has always been', async () => {
  const owner = await makeUser(`Coverage Owner ${Date.now()}`, 'RESEARCH_OPS');
  const { rows } = await query<{ market_id: string }>(
    `insert into saved_markets (name, vertical_profile_id, geography_type,
                                geography_definition, created_by)
     values ('Coverage Market', 'roofing', 'zip_zcta', '{"value":"32095"}'::jsonb, $1)
     returning market_id`, [owner.userId]);
  const marketId = rows[0]!.market_id;

  const before = await query<{ saturation_state: string | null }>(
    'select saturation_state from saved_markets where market_id = $1', [marketId]);
  assert.equal(before.rows[0]!.saturation_state, null,
    'the column already had a value, so this test proves nothing');

  await recordSaturation(marketId, 'NEVER_SEARCHED');
  const after = await query<{ saturation_state: string | null }>(
    'select saturation_state from saved_markets where market_id = $1', [marketId]);
  assert.equal(after.rows[0]!.saturation_state, 'NEVER_SEARCHED',
    'the saturation column is still written by nothing');
});

// ------------------------------------------------------------- what is next -----

test('the terms not yet asked are named, with what they would cost', async () => {
  await mine(['someroofer'], 2);
  const coverage = await marketCoverage(ROOFING);

  assert.ok(coverage.termsNotAsked.length > 0);
  assert.equal(coverage.nextSearches.length, coverage.termsNotAsked.length);
  assert.ok(coverage.estimatedCostUsd > 0,
    'unasked searches were costed at nothing');

  // Each is a real query with its own identity, so running them is the ordinary path.
  for (const search of coverage.nextSearches) {
    assert.match(search.keyword, /32095$/);
    assert.match(search.fingerprint, /^search:/);
  }
  assert.equal(new Set(coverage.nextSearches.map((s) => s.fingerprint)).size,
    coverage.nextSearches.length);
});

test('a market with every term asked has nothing left to propose', async () => {
  await mine(['a1', 'a2', 'a3', 'a4', 'a5'], 5);
  const coverage = await marketCoverage(ROOFING);
  assert.equal(coverage.termsNotAsked.length, 0,
    `still unasked: ${coverage.termsNotAsked.join(', ')}`);
  assert.equal(coverage.estimatedCostUsd, 0);
  assert.match(renderMarketCoverage(coverage), /every term has been asked/);
});

test('the events a vertical holds back are not proposed as coverage gaps', async () => {
  // Hail and storm terms exist for roofing and are deliberately not searched by
  // default. Listing them as "not asked" would invite an operator to buy them as
  // though the market were incomplete without them.
  const coverage = await marketCoverage(ROOFING);
  for (const term of coverage.termsNotAsked) {
    assert.doesNotMatch(term, /hail|storm/i,
      `"${term}" was proposed as a coverage gap, which would sell an event search as `
      + 'the market being incomplete');
  }
});

// --------------------------------------------------------------- the target -----

test('a target the operator set is measured, not just displayed', async () => {
  const owner = await makeUser(`Coverage Target ${Date.now()}`, 'RESEARCH_OPS');
  const { rows } = await query<{ market_id: string }>(
    `insert into saved_markets (name, vertical_profile_id, geography_type,
                                geography_definition, created_by, target_inventory_depth)
     values ('Target Market', 'roofing', 'zip_zcta', '{"value":"32095"}'::jsonb, $1, 20)
     returning market_id`, [owner.userId]);
  await hold('Target Roofing One');
  await hold('Target Roofing Two');

  const coverage = await marketCoverage({ ...ROOFING, marketId: rows[0]!.market_id });
  assert.deepEqual(coverage.towardTarget, { held: 2, target: 20, shortfall: 18 },
    'the target depth was displayed and never measured against');
  assert.match(renderMarketCoverage(coverage), /2 of 20 wanted, 18 short/);
});

test('no target set says so rather than inventing one', async () => {
  const coverage = await marketCoverage(ROOFING);
  assert.equal(coverage.towardTarget, null);
  assert.match(renderMarketCoverage(coverage), /target       not set/);
});

test('coverage counts only the vertical and place it was asked about', async () => {
  await hold('In Scope Roofing', '32095');
  await hold('Out Of Scope Roofing', '32084');
  const coverage = await marketCoverage(ROOFING);
  assert.equal(coverage.inventory, 1,
    'a company in a different ZIP was counted as coverage of this one');
});

test('a suppressed company is not counted as coverage', async () => {
  const accountId = await hold('Suppressed Roofing');
  await query(
    `update accounts set is_suppressed = true, suppression_summary = 'asked not to'
      where account_id = $1`, [accountId]);
  const coverage = await marketCoverage(ROOFING);
  assert.equal(coverage.inventory, 0,
    'a company we may not contact was counted as market coverage');
});

// ------------------------------------------ a market nobody named --------------

test('"every term has been asked" is not said when there are no terms', async () => {
  // Zero unasked out of zero defined is not the same as having asked them all.
  // Without a vertical there is no taxonomy, and the vacuous reading of that line is
  // complete coverage of a market nobody searched.
  const coverage = await marketCoverage({ vertical: null, location: '32095', marketId: null });
  assert.equal(coverage.termsDefined, 0, 'the fixture no longer tests the empty case');

  const rendered = renderMarketCoverage(coverage);
  assert.doesNotMatch(rendered, /every term has been asked/,
    'a market with no term list was reported as fully asked');
  assert.match(rendered, /no term list, so there is nothing to ask/);
});

test('a real market still reports its unasked terms', async () => {
  const coverage = await marketCoverage(
    { vertical: 'roofing', location: '32095', marketId: null });
  assert.ok(coverage.termsDefined > 0);
  const rendered = renderMarketCoverage(coverage);
  assert.doesNotMatch(rendered, /no term list/);
  assert.match(rendered, /not asked \(\d+ terms/);
});

test('the coverage command refuses a market nobody named', async () => {
  // It printed a market-shaped report about the whole database: every company held,
  // and a saturation state for a market nobody had asked about. That reads as a
  // finding rather than as a missing argument.
  const { spawnSync } = await import('node:child_process');
  const run = spawnSync('npx', ['tsx', 'src/bin/coverage.ts'],
    { encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stderr, /Name a market/);
  assert.doesNotMatch(run.stdout, /MARKET COVERAGE/,
    'a report was printed for a market that was never named');
});
