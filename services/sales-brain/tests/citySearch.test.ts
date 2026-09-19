import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGeography, classifyGeographyForInventory, geographyInput, normalizeGeography,
} from '../src/miner/geography.js';
import { parseSearchQuery } from '../src/api/portal.js';

/**
 * "Orlando, FL" is a city and a state, all the way through.
 *
 * Reproduced in production: Find Prospects showed `Orlando, FL`, the URL carried
 * `where=orlando%2C+FL`, and pressing Research more answered "Which Orlando? Add the
 * state". The parser was never wrong. A classified city keeps `value` as the city
 * alone -- the inventory filter compares city and state as separate columns -- and
 * `/api/mining/plan` forwarded `geography.value` while dropping `geography.state`, so
 * the preview was asked to locate the bare word "Orlando".
 *
 * These tests pin both halves: the parser's reading, and the rejoining that every
 * caller handing a geography back to the parser has to do.
 */

const canonical = (where: string) => {
  const read = classifyGeographyForInventory(where);
  assert.ok(read.ok, `"${where}" did not classify: ${read.ok ? '' : read.message}`);
  return read;
};

test('a city with its state resolves, however it is typed', () => {
  for (const input of [
    'Orlando, FL', 'orlando, fl', 'ORLANDO, FL', 'Orlando,FL', 'Orlando , FL',
    '  Orlando, FL  ', 'Orlando, Florida', 'orlando, florida',
  ]) {
    const read = canonical(input);
    assert.equal(read.type, 'city', `${input} was not read as a city`);
    assert.equal(read.value, 'Orlando', `${input} lost the city`);
    assert.equal(read.state, 'FL', `${input} lost the state`);
    // Cosmetic differences must not become different markets.
    assert.equal(geographyInput(read), 'Orlando, FL', `${input} rejoined differently`);
  }
});

test('other real cities resolve too', () => {
  const cases: [string, string, string][] = [
    ['Miami, FL', 'Miami', 'FL'],
    ['St. Augustine, FL', 'St. Augustine', 'FL'],
    ['Fort Worth, TX', 'Fort Worth', 'TX'],
    ['Dallas, TX', 'Dallas', 'TX'],
    ['Los Angeles, CA', 'Los Angeles', 'CA'],
    ['New York, NY', 'New York', 'NY'],
    ['Jacksonville, FL', 'Jacksonville', 'FL'],
  ];
  for (const [input, city, state] of cases) {
    const read = canonical(input);
    assert.equal(read.type, 'city');
    assert.equal(read.state, state, `${input} lost its state`);
    assert.ok(read.value.toLowerCase().includes(city.split(' ')[0]!.toLowerCase()),
      `${input} produced city ${read.value}`);
  }
});

test('a bare city still asks which one, and names the state it wants', () => {
  // The discovery request is where a state becomes required: a provider has to be told
  // which Orlando. This message is correct -- it was simply being shown to people who
  // had already answered it.
  const read = normalizeGeography('city', 'Orlando');
  assert.equal(read.ok, false);
  assert.match(read.ok ? '' : read.message, /Add the state/i);

  const miami = normalizeGeography('city', 'Miami');
  assert.equal(miami.ok, false);
});

test('ZIPs and states are unaffected', () => {
  for (const zip of ['32095', '76131']) {
    const read = canonical(zip);
    assert.equal(read.type, 'zip_zcta');
    assert.equal(read.value, zip);
    assert.equal(geographyInput(read), zip, 'a ZIP was given a state it does not have');
  }
  for (const [input, code] of [['FL', 'FL'], ['Florida', 'FL'], ['TX', 'TX'], ['Texas', 'TX']]) {
    const read = canonical(input!);
    assert.equal(read.type, 'state');
    assert.equal(read.value, code);
    assert.equal(geographyInput(read), code, 'a state was rejoined with itself');
  }
});

test('nonsense is refused rather than turned into a plan', () => {
  const read = classifyGeography('somewhere over there');
  assert.equal(read.ok, false);
});

/**
 * The exact flow Michael used. Parser unit tests passed throughout the outage, because
 * the value was lost between the parser and the preview rather than inside either.
 */
test('the live URL reaches a locatable plan request, not a state-required refusal', () => {
  for (const [query, expectedCity] of [
    ['vertical=hvac&where=orlando%2C+FL', 'Orlando'],
    ['vertical=hvac&where=Miami%2C%20FL', 'Miami'],
    ['vertical=plumbing&where=St.+Augustine%2C+FL', 'St. Augustine'],
  ] as const) {
    const request = parseSearchQuery(new URLSearchParams(query));
    assert.equal(request.geography?.type, 'city', `${query} did not parse to a city`);
    assert.equal(request.geography?.value, expectedCity);
    assert.equal(request.geography?.state, 'FL', `${query} dropped the state`);

    // What /api/mining/plan now forwards, and what the plan builder makes of it.
    const forwarded = geographyInput(request.geography);
    const located = normalizeGeography(request.geography?.type ?? null, forwarded);
    assert.ok(located.ok,
      `the preview refused a location the rep gave in full: ${located.ok ? '' : located.message}`);
    assert.equal(located.type, 'city');
    assert.equal(located.state, 'FL');
    assert.equal(located.display, `${expectedCity}, FL`);
  }
});

test('forwarding the bare value is what broke, and is what the helper prevents', () => {
  const request = parseSearchQuery(new URLSearchParams('vertical=hvac&where=orlando%2C+FL'));

  // The old behaviour, kept as a statement of the bug: value alone cannot be located.
  const oldWay = normalizeGeography(request.geography?.type ?? null, request.geography?.value ?? null);
  assert.equal(oldWay.ok, false);
  assert.match(oldWay.ok ? '' : oldWay.message, /Add the state/i);

  // The new behaviour.
  const newWay = normalizeGeography(request.geography?.type ?? null, geographyInput(request.geography));
  assert.equal(newWay.ok, true);
});

test('equivalent spellings produce one market identity, not several', () => {
  const forms = ['Orlando, FL', 'orlando, florida', 'ORLANDO,FL', '  Orlando , FL '];
  const identities = new Set(forms.map((form) => {
    const read = canonical(form);
    return `${read.type}:${read.value}:${read.state}`;
  }));
  assert.equal(identities.size, 1,
    `display formatting created ${identities.size} market identities: ${[...identities].join(' | ')}`);
});
