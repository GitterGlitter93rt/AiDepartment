import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { planDiscoverySearches, renderSearchPlan } from '../src/miner/searchPlan.js';
import { searchQueriesFor, inherentCausesFor } from '../src/miner/searchTaxonomy.js';

/**
 * A vertical, a service and an event are three different things.
 * Authority: Issue #3 E.
 *
 * The live failure: Michael picked Roofing and a ZIP, and the provider was asked for
 * "hail damage roof 32095". That is not roofing in that ZIP. It is roofers who bid
 * on hail work -- a narrower, event-dependent slice, and an assumption nobody made.
 *
 * It happened because ADVERTISER_FIRST breaks ties alphabetically among queries of
 * equal intent, and every roofing high-intent term scores 5: "hail damage roof"
 * sorted before "roof repair" and was the one search the run bought. Nothing was
 * broken in the ordering. The taxonomy simply had no way to say that one of those
 * queries assumes the weather and the others do not.
 *
 * The distinction that matters is not whether a query mentions an event. It is
 * whether the query still makes sense in a week with no weather. "water damage
 * restoration" is a service a company sells all year. "hail damage roof" is a
 * general service with an event stuck on the front.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

const ROOFING = {
  verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
  miningMode: 'advertiser_first',
};

// ------------------------------------------------------- the roofing regression --

test('roofing plus a ZIP does not buy a hail search', async () => {
  const plan = await planDiscoverySearches({ ...ROOFING, count: 8 });
  const keywords = plan.searches.map((search) => search.keyword);

  assert.ok(keywords.length > 0, 'roofing planned nothing at all');
  for (const keyword of keywords) {
    assert.doesNotMatch(keyword, /hail/i,
      `"${keyword}" assumes a hail event nobody asked about`);
    assert.doesNotMatch(keyword, /storm/i, `"${keyword}" assumes a storm`);
  }
});

test('the first search a roofing run buys is roofing', async () => {
  // The live run bought exactly one search, and it was the hail one. With a count of
  // one the first query is the whole market search, so what sorts first is the
  // entire result.
  const plan = await planDiscoverySearches({ ...ROOFING, count: 1 });
  assert.equal(plan.searches.length, 1);
  assert.match(plan.searches[0]!.keyword, /^roof/i,
    `a roofing market search asked the provider for "${plan.searches[0]!.keyword}"`);
});

test('the held-back events are named, not silently dropped', async () => {
  const plan = await planDiscoverySearches({ ...ROOFING, count: 8 });
  assert.deepEqual(plan.causesAvailable, ['hail', 'storm']);

  const printed = renderSearchPlan(plan);
  assert.match(printed, /Not searched: hail, storm damage/);
  assert.match(printed, /different question from/,
    'the plan does not explain why those terms were held back');
  assert.match(printed, /Ask for them explicitly/,
    'an operator who wants storm work is not told how to get it');
});

test('storm work is a campaign somebody runs on purpose', async () => {
  const plan = await planDiscoverySearches({ ...ROOFING, count: 8, causes: ['hail'] });
  const keywords = plan.searches.map((search) => search.keyword);

  assert.ok(keywords.some((keyword) => /hail/i.test(keyword)),
    'asking for hail did not include the hail terms');
  assert.ok(!keywords.some((keyword) => /storm damage/i.test(keyword)),
    'asking for hail also bought storm, which is a different event');
  assert.deepEqual(plan.causesRequested, ['hail']);
  assert.deepEqual(plan.causesAvailable, ['storm']);
});

// ------------------------------------------- trades whose business is the event --

test('a trade that exists for the event still searches for it', async () => {
  // Paintless dent repair without hail is a different and much smaller trade.
  const inherent = await inherentCausesFor('pdr-hail');
  assert.ok(inherent.has('hail'));

  const plan = await planDiscoverySearches({
    verticalProfileId: 'pdr-hail', geographyType: 'zip_zcta', geographyValue: '32095',
    miningMode: 'advertiser_first', count: 10,
  });
  assert.ok(plan.searches.some((search) => /hail/i.test(search.keyword)),
    'the hail vertical stopped searching for hail');
  assert.deepEqual(plan.causesAvailable, [],
    'a trade defined by an event reported that event as held back');
});

test('a service sold all year is not mistaken for an event', async () => {
  // "water damage restoration" is what the company does, not a claim that a pipe
  // burst this week. Marking it as a cause would have emptied the vertical.
  const queries = await searchQueriesFor('restoration');
  const water = queries.find((entry) => /water damage restoration/i.test(entry.query));
  assert.ok(water, 'the restoration taxonomy no longer contains its own service line');
  assert.equal(water!.cause, null,
    'a year-round service line was marked as an event assumption');

  const plan = await planDiscoverySearches({
    verticalProfileId: 'restoration', geographyType: 'zip_zcta', geographyValue: '32095',
    miningMode: 'advertiser_first', count: 10,
  });
  assert.ok(plan.searches.length >= 4, 'excluding causes emptied the restoration plan');
});

// --------------------------------------------------------- across every vertical --

test('no vertical leaks an unrequested event into a default search', async () => {
  const { rows } = await pool.query<{ vertical_profile_id: string }>(
    'select vertical_profile_id from vertical_profiles order by vertical_profile_id');
  const leaks: string[] = [];

  for (const row of rows) {
    const inherent = await inherentCausesFor(row.vertical_profile_id);
    const plan = await planDiscoverySearches({
      verticalProfileId: row.vertical_profile_id, geographyType: 'zip_zcta',
      geographyValue: '32095', miningMode: 'advertiser_first', count: 50,
    });
    for (const search of plan.searches) {
      if (search.cause && !inherent.has(search.cause)) {
        leaks.push(`${row.vertical_profile_id}: "${search.term}" (${search.cause})`);
      }
    }
    assert.ok(plan.searches.length > 0 || plan.refusal,
      `${row.vertical_profile_id} plans nothing and gives no reason`);
  }

  assert.deepEqual(leaks, [],
    `these verticals search for an event nobody asked about:\n${leaks.join('\n')}`);
});

test('every vertical can still fill a real plan without its event terms', async () => {
  const { rows } = await pool.query<{ vertical_profile_id: string }>(
    'select vertical_profile_id from vertical_profiles order by vertical_profile_id');
  const emptied: string[] = [];

  for (const row of rows) {
    const plan = await planDiscoverySearches({
      verticalProfileId: row.vertical_profile_id, geographyType: 'zip_zcta',
      geographyValue: '32095', miningMode: 'advertiser_first', count: 3,
    });
    // Excluding events must narrow a plan, never empty one: a vertical left with no
    // searchable terms would silently stop discovering anything.
    if (plan.searches.length === 0) emptied.push(row.vertical_profile_id);
  }
  assert.deepEqual(emptied, [],
    `holding back event terms left these verticals with nothing to search: ${emptied.join(', ')}`);
});

test('a cause the taxonomy does not have is asked for and simply not found', async () => {
  // An operator asking for an event this vertical has no terms for gets the ordinary
  // plan rather than an error or an empty one.
  const plan = await planDiscoverySearches({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    miningMode: 'advertiser_first', count: 4, causes: ['earthquake'],
  });
  assert.ok(plan.searches.length > 0);
  assert.deepEqual(plan.causesRequested, ['earthquake']);
});

// ------------------------------------------------- what a vertical is not --------

test('the exclusions every profile declares are actually applied', async () => {
  const { negativeTermsFor, matchesNegativeTerm } = await import('../src/miner/searchTaxonomy.js');
  const terms = await negativeTermsFor('roofing');
  assert.ok(terms.includes('roofing supply'), `roofing declares: ${terms.join(', ')}`);

  // The companies a roofing search really returns alongside roofers.
  assert.equal(matchesNegativeTerm('ABC Roofing Supply', 'abcroofingsupply.com', terms),
    'roofing supply');
  assert.equal(matchesNegativeTerm('Gulf Coast Roofing School', null, terms), 'roofing school');
  assert.ok(matchesNegativeTerm('Wholesale Building Products', null, terms));

  // And a contractor is not rejected for an unfortunate name.
  assert.equal(matchesNegativeTerm('Salazar Roofing & Repair', 'salazarroofing.com', terms), null);
  assert.equal(matchesNegativeTerm('Roofing Supplyhouse Contractors', null, terms), null,
    'a substring inside a longer word rejected a real company');
});

test('every vertical excludes something, and none excludes its own trade', async () => {
  const { negativeTermsFor, matchesNegativeTerm } = await import('../src/miner/searchTaxonomy.js');
  const { rows } = await pool.query<{ vertical_profile_id: string }>(
    'select vertical_profile_id from vertical_profiles order by vertical_profile_id');

  for (const row of rows) {
    const terms = await negativeTermsFor(row.vertical_profile_id);
    assert.ok(terms.length > 0, `${row.vertical_profile_id} declares no exclusions`);

    // A vertical's own search terms must never match its own exclusions, or the
    // filter would reject the companies the search exists to find.
    const queries = await searchQueriesFor(row.vertical_profile_id);
    for (const query of queries) {
      const hit = matchesNegativeTerm(`${query.query} Company`, null, terms);
      assert.equal(hit, null,
        `${row.vertical_profile_id} would reject its own "${query.query}" search results `
        + `for matching "${hit}"`);
    }
  }
});
