import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  discoveryVerticalRelevance, firstPartyVerticalRelevance,
} from '../src/discovery/verticalRelevance.js';

/**
 * Ranking for a trade's query is not membership of the trade.
 *
 * Production put "U-Haul Locations in Miami, FL 33127" in front of a rep filtering for
 * HVAC. The observation behind it: `result_type organic`, `position 51`, query
 * "HVAC contractor 33127", provider category null. The miner stamped the searched
 * vertical onto the Account, so a truck rental company became an HVAC prospect because
 * of the question we had asked.
 *
 * The Find filter was correct throughout. The data it filtered was wrong.
 */

// The terms the HVAC profile actually declares, as `search_taxonomy.core_queries`.
const HVAC = ['HVAC contractor', 'heating and cooling', 'air conditioning contractor'];
const PLUMBING = ['plumber', 'plumbing contractor', 'drain cleaning'];

test('a local business listing supports the trade', () => {
  for (const resultType of ['local_result', 'local_pack', 'maps_search', 'google_business_listing']) {
    assert.equal(
      discoveryVerticalRelevance({ resultType, providerCategory: null, verticalTerms: HVAC }),
      'SUPPORTED', `${resultType} was not treated as a business listing`);
  }
});

test('an organic ranking supports nothing on its own', () => {
  // The U-Haul case, generically: a page ranked, and that is all we know.
  assert.equal(
    discoveryVerticalRelevance({ resultType: 'organic', providerCategory: null, verticalTerms: HVAC }),
    'INSUFFICIENT');
  // Nor does a directory page, an informational block, or anything else that describes
  // a page rather than a business. A paid placement is deliberately not in this list:
  // the company bought that keyword, which is its own assertion about the trade.
  for (const resultType of ['organic', '', 'people_also_ask', 'related_searches']) {
    assert.equal(
      discoveryVerticalRelevance({ resultType, providerCategory: null, verticalTerms: HVAC }),
      'INSUFFICIENT', `${resultType} was treated as evidence about a business`);
  }
});

test('a paid placement against the trade is the company asserting the trade', () => {
  // Bought traffic, not a ranking. This is what the advertiser-first strategy runs on.
  for (const resultType of ['paid_search', 'paid_search_text', 'local_services_ad']) {
    assert.equal(
      discoveryVerticalRelevance({ resultType, providerCategory: null, verticalTerms: HVAC }),
      'SUPPORTED', `${resultType} was not treated as the company's own assertion`);
  }
  // A product listing is a thing for sale, not a contractor.
  for (const resultType of ['shopping_or_irrelevant_paid', 'paid_local']) {
    assert.equal(
      discoveryVerticalRelevance({ resultType, providerCategory: null, verticalTerms: HVAC }),
      'INSUFFICIENT', `${resultType} was treated as trade evidence`);
  }
});

test('a provider category naming the trade supports it, when one is ever supplied', () => {
  assert.equal(
    discoveryVerticalRelevance({
      resultType: 'organic', providerCategory: 'HVAC contractor', verticalTerms: HVAC,
    }), 'SUPPORTED');
  // A category naming a different trade does not.
  assert.equal(
    discoveryVerticalRelevance({
      resultType: 'organic', providerCategory: 'Truck rental agency', verticalTerms: HVAC,
    }), 'INSUFFICIENT');
});

test('a company that sells the trade on its own site earns it', () => {
  const site = [
    'Air conditioning contractor serving Orlando since 1994.',
    'We handle heating and cooling for homes and light commercial.',
  ];
  assert.equal(firstPartyVerticalRelevance({ pageText: site, verticalTerms: HVAC }), 'SUPPORTED');
});

test('a passing mention is not a trade', () => {
  // A moving company's site can say "air conditioning" once, about a truck cab.
  const movers = [
    'U-Haul truck rental, trailers, and self storage. Moving supplies and towing.',
    'Every truck has air conditioning and a low deck.',
  ];
  assert.equal(firstPartyVerticalRelevance({ pageText: movers, verticalTerms: HVAC }),
    'INSUFFICIENT', 'one incidental phrase established a trade');

  // A retailer selling units is not a contractor either.
  const retailer = ['Shop window air conditioning units, fans and heaters. Free delivery.'];
  assert.equal(firstPartyVerticalRelevance({ pageText: retailer, verticalTerms: HVAC }),
    'INSUFFICIENT');
});

test('a mixed-trade company is supported in each trade it actually sells', () => {
  const site = [
    'ABC Plumbing, Heating & Air. Plumbing contractor and HVAC contractor in one call.',
    'Drain cleaning, water heaters, heating and cooling, air conditioning contractor services.',
  ];
  assert.equal(firstPartyVerticalRelevance({ pageText: site, verticalTerms: HVAC }), 'SUPPORTED');
  assert.equal(firstPartyVerticalRelevance({ pageText: site, verticalTerms: PLUMBING }), 'SUPPORTED');
});

test('a plumbing-only company is not an HVAC company', () => {
  const site = [
    'Plumber serving St. Augustine. Drain cleaning, repiping, water heater replacement.',
    'Plumbing contractor licensed in Florida.',
  ];
  assert.equal(firstPartyVerticalRelevance({ pageText: site, verticalTerms: PLUMBING }), 'SUPPORTED');
  assert.equal(firstPartyVerticalRelevance({ pageText: site, verticalTerms: HVAC }), 'INSUFFICIENT');
});

test('no pages read supports nothing', () => {
  // The site we could not fetch must not become a trade by default, in either direction.
  assert.equal(firstPartyVerticalRelevance({ pageText: [], verticalTerms: HVAC }), 'INSUFFICIENT');
  assert.equal(firstPartyVerticalRelevance({ pageText: ['   '], verticalTerms: HVAC }), 'INSUFFICIENT');
});

test('the search keyword alone never establishes the trade', () => {
  // The exact shape of the bug: everything we knew about U-Haul at discovery.
  const uhaul = discoveryVerticalRelevance({
    resultType: 'organic', providerCategory: null, verticalTerms: HVAC,
  });
  assert.equal(uhaul, 'INSUFFICIENT');

  // And its own site does not rescue it.
  assert.equal(firstPartyVerticalRelevance({
    pageText: ['U-Haul Locations in Miami, FL. Truck rental, trailer hitches, self storage.'],
    verticalTerms: HVAC,
  }), 'INSUFFICIENT');
});
