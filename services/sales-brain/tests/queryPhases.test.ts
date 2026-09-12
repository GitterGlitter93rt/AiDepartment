import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/pool.js';
import { syncVerticalProfiles, listVerticals } from '../src/domain/verticals.js';
import { planSearchQueries, searchQueriesFor } from '../src/miner/searchTaxonomy.js';
import { planDiscoverySearches } from '../src/miner/searchPlan.js';
import { resetDatabase } from './helpers.js';

/**
 * Market discovery and commercial intelligence are different jobs.
 *
 * Live defect: Michael asked for Plumbing in 32095 and the provider was asked for
 * "drain cleaning 32095". That is a plumbing service, not the plumbers in a ZIP. It
 * happened because one sort ranked every query on how close to buying somebody typing
 * it is -- where every core term scores 4 and every service term scores 5 -- so the
 * whole trade sorted behind the whole service list, and the alphabet picked the
 * winner among the five that tied.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });

const plan = (vertical: string, budget: number) =>
  planSearchQueries({ verticalProfileId: vertical, strategy: 'ADVERTISER_FIRST', budget });

// ------------------------------------------------------------- the live defect --

test('1. Plumbing with one paid query buys the trade, not a service', async () => {
  const { queries } = await plan('plumbing', 1);
  assert.equal(queries.length, 1);
  assert.equal(queries[0]!.purpose, 'ENTITY_DISCOVERY');
  assert.equal(queries[0]!.coverageRole, 'PRIMARY');
  assert.notEqual(queries[0]!.query, 'drain cleaning',
    'the exact live failure: a narrow service defined the whole plumbing market');
  assert.ok(['plumber', 'plumbing contractor'].includes(queries[0]!.query),
    `expected a core plumbing term, got "${queries[0]!.query}"`);
});

test('2. two slots cover the trade broadly before any service term', async () => {
  const { queries } = await plan('plumbing', 2);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries.map((q) => q.purpose), ['ENTITY_DISCOVERY', 'ENTITY_DISCOVERY']);
  assert.deepEqual([...queries.map((q) => q.query)].sort(), ['plumber', 'plumbing contractor']);
});

test('3. a higher-intent service cannot outrank required discovery coverage', async () => {
  const all = await searchQueriesFor('plumbing');
  const service = all.find((q) => q.query === 'drain cleaning')!;
  const core = all.find((q) => q.query === 'plumber')!;
  // The data that caused the defect is unchanged: the service really does score higher.
  assert.ok(service.intentWeight > core.intentWeight,
    'fixture no longer reproduces the condition that caused the live failure');
  const { queries } = await plan('plumbing', 3);
  const firstService = queries.findIndex((q) => q.purpose === 'COMMERCIAL_INTELLIGENCE');
  const lastCore = queries.map((q) => q.purpose).lastIndexOf('ENTITY_DISCOVERY');
  assert.ok(lastCore < firstService || firstService === -1);
});

test('4. alphabetical order cannot move phase 2 ahead of phase 1', async () => {
  // "drain cleaning" sorts before "plumber". That must no longer matter.
  const { queries } = await plan('plumbing', 4);
  const positions = new Map(queries.map((q, index) => [q.query, index]));
  const plumber = positions.get('plumber');
  const drain = positions.get('drain cleaning');
  if (plumber !== undefined && drain !== undefined) {
    assert.ok(plumber < drain, 'the alphabet is deciding what the market is again');
  }
});

test('9. a larger plan is discovery first, then intelligence', async () => {
  const { queries, commercialIntelligenceIncluded } = await plan('plumbing', 6);
  const purposes = queries.map((q) => q.purpose);
  const firstCommercial = purposes.indexOf('COMMERCIAL_INTELLIGENCE');
  assert.ok(firstCommercial > 0, 'nothing was discovered before intelligence was bought');
  assert.ok(!purposes.slice(firstCommercial).includes('ENTITY_DISCOVERY'),
    'the phases interleave, so coverage is not actually satisfied first');
  assert.equal(commercialIntelligenceIncluded, true);
});

test('10/11. a single-query run is primary discovery and says coverage is partial',
  async () => {
  const one = await plan('roofing', 1);
  assert.equal(one.queries[0]!.coverageRole, 'PRIMARY');
  assert.equal(one.partialDiscoveryCoverage, true,
    'a one-query run must not present itself as having covered the market');
  assert.equal(one.commercialIntelligenceIncluded, false);

  const full = await plan('roofing', 99);
  assert.equal(full.partialDiscoveryCoverage, false);
});

test('12. the plan is deterministic', async () => {
  const first = await plan('hvac', 4);
  const second = await plan('hvac', 4);
  assert.deepEqual(first.queries.map((q) => q.query), second.queries.map((q) => q.query));
});

// ------------------------------------------------------------------ fail closed --

test('8. a vertical with no entity-discovery query refuses rather than guessing',
  async () => {
  // Built by hand rather than by breaking a shipped profile: the point is the
  // planner's behaviour, and every real profile has core terms.
  const { queries, refusal } = await planSearchQueries({
    verticalProfileId: 'not-a-real-vertical', strategy: 'ADVERTISER_FIRST', budget: 3 });
  assert.deepEqual(queries, []);
  // An unknown vertical has no taxonomy at all, which is a different thing from a
  // known vertical with only service terms. Both buy nothing.
  assert.equal(refusal, null);

  const planned = await planDiscoverySearches({
    verticalProfileId: 'not-a-real-vertical', geographyType: 'zip_zcta',
    geographyValue: '32095', miningMode: 'advertiser_first', count: 1, marketId: null });
  assert.equal(planned.searches.length, 0);
  assert.ok(planned.refusal, 'an unplannable vertical must refuse before spending');
});

// --------------------------------------------------- every vertical, parameterized --

test('7. every supported vertical has a primary entity-discovery query', async () => {
  const verticals = (await listVerticals()).map((option) => option.id);
  assert.ok(verticals.length >= 13, `only ${verticals.length} verticals found`);

  const broken: string[] = [];
  for (const vertical of verticals) {
    const { queries, refusal } = await plan(vertical, 1);
    if (refusal) { broken.push(`${vertical}: ${refusal.code}`); continue; }
    if (queries.length === 0) { broken.push(`${vertical}: nothing planned`); continue; }
    const first = queries[0]!;
    if (first.purpose !== 'ENTITY_DISCOVERY') {
      broken.push(`${vertical}: one query would buy ${first.purpose} "${first.query}"`);
    }
    if (first.coverageRole !== 'PRIMARY') {
      broken.push(`${vertical}: first query is ${first.coverageRole}`);
    }
  }
  assert.deepEqual(broken, [],
    `these verticals would spend their only paid query on the wrong question:\n  ${broken.join('\n  ')}`);
});

test('every vertical’s primary query reads like a trade, not a service', async () => {
  // A weak but useful shape check: an entity-discovery term should name the operator
  // or the trade. Not a rule the planner enforces -- it is a review of the profiles.
  const verticals = (await listVerticals()).map((option) => option.id);
  const suspicious: string[] = [];
  for (const vertical of verticals) {
    const { queries } = await plan(vertical, 1);
    const term = queries[0]?.query ?? '';
    if (/\b(repair|replacement|cleaning|install|installation|emergency)\b/i.test(term)
        && !/\b(contractor|company|shop|repair shop)\b/i.test(term)) {
      suspicious.push(`${vertical}: "${term}"`);
    }
  }
  // Three trades are named after the work they do, which is how their customers
  // search for them: "auto body repair", "auto hail repair" and "garage door repair"
  // are the trade, not a narrow service inside it the way "drain cleaning" is inside
  // plumbing. Reviewed and accepted by name rather than by loosening the rule, so a
  // fourth vertical appearing here is a profile change somebody has to defend.
  const reviewed = new Set([
    'collision-repair: "auto body repair"',
    'pdr-hail: "auto hail repair"',
    'garage-door: "garage door repair"',
  ]);
  const unreviewed = suspicious.filter((entry) => !reviewed.has(entry));
  assert.deepEqual(unreviewed, [],
    `these verticals lead with a service term and have not been reviewed:\n  ${unreviewed.join('\n  ')}`);
});

// -------------------------------------------------------------- cause semantics --

test('5/6. a ZIP search does not inject storm terms unless asked', async () => {
  const neutral = await planDiscoverySearches({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    miningMode: 'advertiser_first', count: 4, marketId: null });
  for (const search of neutral.searches) {
    assert.equal(search.cause, null,
      `"${search.term}" assumes a weather event nobody asked about`);
  }

  const asked = await planDiscoverySearches({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    miningMode: 'advertiser_first', count: 8, marketId: null, causes: ['hail'] });
  assert.ok(asked.searches.length >= neutral.searches.length);
});
