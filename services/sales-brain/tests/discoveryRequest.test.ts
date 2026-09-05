import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/pool.js';
import { normalizeGeography, stateCode } from '../src/miner/geography.js';
import { planSearchQueries, searchQueriesFor } from '../src/miner/searchTaxonomy.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { classifyGeographyForInventory } from '../src/miner/geography.js';
import { discoveryFingerprint, enqueueMarketResearch } from '../src/workers/enqueue.js';
import { createUser } from '../src/domain/auth.js';
import { query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';

/**
 * What the miner asks a provider, and where it asks about.
 * Authority: Issue #2 parts 2, 5 and 9.
 *
 * Two defects live here, and both would have made a live provider call return
 * expensive nonsense:
 *
 *   - the search term was the strategy name, the internal vertical id and the raw
 *     geography joined with spaces: "advertiser_first hvac 32095". Nobody searches
 *     for that. The vertical profiles have carried a real search taxonomy all along
 *     and nothing read it.
 *
 *   - the geography went to the provider exactly as typed, so " 32095 " did not
 *     match the ZIP filter, "Jacksonville" and "jacksonville " were two different
 *     paid searches, and a bare city name searched whichever Jacksonville the
 *     provider felt like.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });

// ------------------------------------------------------------------ geography --

test('a ZIP is five digits, however it was typed', () => {
  for (const input of ['32095', ' 32095 ', '32095-1234', '32095 1234']) {
    const result = normalizeGeography('zip_zcta', input);
    assert.ok(result.ok, `${input}: ${(result as { message?: string }).message}`);
    assert.equal(result.value, '32095',
      'ZIP+4 identifies a delivery route; the market is the five-digit ZIP');
  }
});

test('something that is not a ZIP says so, instead of being searched', () => {
  for (const input of ['3209', '320955', 'ABCDE', '32095-12', 'Jacksonville']) {
    const result = normalizeGeography('zip_zcta', input);
    assert.equal(result.ok, false, input);
    assert.match((result as { message: string }).message, /ZIP/,
      'the operator is told what a ZIP looks like, not "invalid input"');
  }
});

test('a state is accepted by name or abbreviation and stored one way', () => {
  for (const input of ['FL', 'fl', ' Florida ', 'florida']) {
    const result = normalizeGeography('state', input);
    assert.ok(result.ok, input);
    assert.equal(result.value, 'FL');
    assert.equal(result.display, 'Florida');
  }
  assert.equal(stateCode('Atlantis'), null);
  const impossible = normalizeGeography('state', 'Atlantis');
  assert.equal(impossible.ok, false);
  assert.match((impossible as { message: string }).message, /not a US state/);
});

test('a city without a state is refused, because most city names are not unique', () => {
  const bare = normalizeGeography('city', 'Springfield');
  assert.equal(bare.ok, false);
  assert.match((bare as { message: string }).message, /Add the state/,
    'searching the wrong Springfield is worse than asking which one');
});

test('a city and state are read however they were written', () => {
  for (const input of ['Jacksonville, FL', 'jacksonville, fl', 'Jacksonville FL',
    ' Jacksonville ,  Florida ', 'JACKSONVILLE, FLORIDA']) {
    const result = normalizeGeography('city', input);
    assert.ok(result.ok, input);
    assert.equal(result.value, 'Jacksonville', input);
    assert.equal(result.state, 'FL', input);
    assert.equal(result.display, 'Jacksonville, FL');
  }
});

test('a two-word city keeps both words', () => {
  const result = normalizeGeography('city', 'St. Augustine, FL');
  assert.ok(result.ok);
  assert.equal(result.value, 'St. Augustine');
  assert.equal(result.state, 'FL');
});

test('the provider is told a place it can recognise', () => {
  const city = normalizeGeography('city', 'Jacksonville, FL');
  assert.ok(city.ok);
  assert.equal(city.providerLocation, 'Jacksonville,Florida,United States');

  const state = normalizeGeography('state', 'FL');
  assert.ok(state.ok);
  assert.equal(state.providerLocation, 'Florida,United States');
});

test('an empty or unsupported geography is refused in words an operator can act on', () => {
  const empty = normalizeGeography('zip_zcta', '   ');
  assert.equal(empty.ok, false);
  assert.match((empty as { message: string }).message, /Enter a ZIP code/);

  const unsupported = normalizeGeography('country', 'United States');
  assert.equal(unsupported.ok, false);
  assert.match((unsupported as { message: string }).message, /not a geography this system searches/);
});

// ----------------------------------------------------------- what we search for --

test('a vertical profile supplies the queries a customer would actually type', async () => {
  const queries = await searchQueriesFor('hvac');
  assert.ok(queries.length >= 3, 'the hvac profile defines a search taxonomy');
  const text = queries.map((entry) => entry.query.toLowerCase());
  assert.ok(text.includes('ac repair'), text.join(', '));
  assert.ok(!text.some((entry) => entry.includes('advertiser_first')),
    'the strategy name is how we choose queries, not a thing to search for');
  assert.ok(!text.some((entry) => entry === 'hvac'),
    'hvac is our internal id, not the words a customer uses');
});

test('advertiser-first orders by where advertisers bid, and by intent', async () => {
  const planned = await planSearchQueries({
    verticalProfileId: 'hvac', strategy: 'ADVERTISER_FIRST', budget: 5 });
  assert.ok(planned.length > 0);
  assert.equal(planned[0]!.recommendedForPaidSerp, true);
  // Highest intent first: somebody typing "AC repair" has a broken air conditioner.
  assert.ok(planned[0]!.intentWeight >= planned[planned.length - 1]!.intentWeight);
});

test('advertiser-first orders, it does not exclude', async () => {
  const all = await searchQueriesFor('hvac');
  const planned = await planSearchQueries({
    verticalProfileId: 'hvac', strategy: 'ADVERTISER_FIRST', budget: all.length });
  assert.equal(planned.length, all.length,
    'a non-advertiser is still a business in the market; dropping it makes the market '
    + 'look smaller than it is');
});

test('the budget is a ceiling on how many queries are bought', async () => {
  const planned = await planSearchQueries({
    verticalProfileId: 'hvac', strategy: 'ADVERTISER_FIRST', budget: 2 });
  assert.equal(planned.length, 2);

  const none = await planSearchQueries({
    verticalProfileId: 'hvac', strategy: 'ADVERTISER_FIRST', budget: 0 });
  assert.equal(none.length, 0);
});

test('a vertical with no taxonomy asks nothing rather than asking nonsense', async () => {
  const planned = await planSearchQueries({
    verticalProfileId: 'not-a-real-vertical', strategy: 'ADVERTISER_FIRST', budget: 5 });
  assert.deepEqual(planned, []);

  const noVertical = await planSearchQueries({
    verticalProfileId: null, strategy: 'ADVERTISER_FIRST', budget: 5 });
  assert.deepEqual(noVertical, []);
});


// --------------------------------------------- what Find Prospects makes of it --

test('the where box reads what a rep actually types', () => {
  const cases: [string, string, string][] = [
    ['32095', 'zip_zcta', '32095'],
    [' 32095 ', 'zip_zcta', '32095'],
    ['32095-1234', 'zip_zcta', '32095'],
    ['Florida', 'state', 'FL'],
    ['FL', 'state', 'FL'],
    ['Jacksonville, FL', 'city', 'Jacksonville'],
    ['jacksonville fl', 'city', 'Jacksonville'],
    ['St. Augustine, FL', 'city', 'St. Augustine'],
    // A bare city still works for an inventory search: only a provider needs to be
    // told which Jacksonville.
    ['Jacksonville', 'city', 'Jacksonville'],
  ];

  for (const [input, type, value] of cases) {
    const read = classifyGeographyForInventory(input);
    assert.ok(read.ok, `${input}: ${(read as { message?: string }).message}`);
    assert.equal(read.type, type, input);
    assert.equal(read.value, value, input);
  }
});

test('a city qualified by a state stays qualified', () => {
  const read = classifyGeographyForInventory('Jacksonville, TX');
  assert.ok(read.ok);
  assert.equal(read.state, 'TX',
    'there is a Jacksonville in Florida and one in Texas, and they are different markets');
});

// ------------------------------------------------------------- one search, once --

test('two spellings of the same market are one job, not two paid searches', async () => {
  const spellings = [
    { geographyType: 'zip_zcta', geographyValue: '32095' },
    { geographyType: 'zip_zcta', geographyValue: ' 32095 ' },
    { geographyType: 'zip_zcta', geographyValue: '32095-1234' },
  ];
  const fingerprints = new Set(spellings.map((input) =>
    discoveryFingerprint({ ...input, verticalProfileId: 'hvac' })));
  assert.equal(fingerprints.size, 1, [...fingerprints].join(' | '));

  const cities = new Set([
    'Jacksonville, FL', 'jacksonville, fl', ' Jacksonville , Florida ',
  ].map((value) => discoveryFingerprint({
    geographyType: 'city', geographyValue: value, verticalProfileId: 'hvac' })));
  assert.equal(cities.size, 1, [...cities].join(' | '));
});

test('two genuinely different searches do not collapse into one', () => {
  const base = { geographyType: 'zip_zcta', geographyValue: '32095', verticalProfileId: 'hvac' };
  const fingerprints = new Set([
    discoveryFingerprint(base),
    discoveryFingerprint({ ...base, verticalProfileId: 'roofing' }),
    discoveryFingerprint({ ...base, geographyValue: '32256' }),
    discoveryFingerprint({ ...base, miningMode: 'broad_local' }),
    discoveryFingerprint({ ...base, marketId: 'a-saved-market' }),
  ]);
  assert.equal(fingerprints.size, 5, 'a different vertical, place, strategy or market is a different search');
});

test('a second click while the first search is still queued does not queue a second', async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  const userId = await createUser({
    email: 'clicker@test.local', displayName: 'Clicker', role: 'SALES_MANAGER',
    password: 'discovery-request-password' });

  const first = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: userId });
  const second = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: ' 32095 ',
    marketId: null, requestedBy: userId });

  assert.equal(first.created, true);
  assert.equal(second.created, false, 'the same market was queued twice');
  assert.equal(second.jobId, first.jobId);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.n, 1);
});

test('the queued job carries the normalized geography the worker will search', async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  const userId = await createUser({
    email: 'normalizer@test.local', displayName: 'Normalizer', role: 'SALES_MANAGER',
    password: 'discovery-request-password' });

  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: ' jacksonville , florida ',
    marketId: null, requestedBy: userId });

  const { rows } = await query<{ payload: Record<string, unknown> }>(
    'select payload from jobs where job_id = $1', [job.jobId]);
  assert.equal(rows[0]!.payload['geography_value'], 'Jacksonville');
  assert.equal(rows[0]!.payload['geography_state'], 'FL');
  assert.equal(rows[0]!.payload['geography_display'], 'Jacksonville, FL');
});
