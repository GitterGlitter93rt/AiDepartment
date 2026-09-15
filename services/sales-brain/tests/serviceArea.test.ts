import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServiceArea, serviceAreaCoversZip } from '../src/resolver/serviceArea.js';

/**
 * Where they will go is not where they are.
 *
 * The error this guards against makes a read model claim a plumber has an office in
 * every town it drives to. A missed service area costs a filter; an invented one costs
 * a rep a wasted drive and a confusing phone call.
 */

test('an explicit ZIP list parses into ZIPs', () => {
  const area = parseServiceArea(
    'Service Areas: 32095, 32084, 32086 and 32092.')!;
  assert.ok(area, 'an explicit ZIP list was not read');
  assert.deepEqual(area.zips, ['32095', '32084', '32086', '32092']);
  assert.equal(area.vague, false);
});

test('named cities parse, with their state when the copy gives one', () => {
  const area = parseServiceArea(
    'Proudly serving St Augustine, Jacksonville, FL and Palm Coast.')!;
  const names = area.cities.map((city) => city.name);
  assert.ok(names.includes('St Augustine'), `cities were ${JSON.stringify(names)}`);
  assert.ok(names.includes('Jacksonville'));
});

test('counties are read as counties, not as cities', () => {
  const area = parseServiceArea('We serve St Johns County and Duval County.')!;
  assert.deepEqual(area.counties, ['St Johns County', 'Duval County']);
  assert.ok(!area.cities.some((city) => /county/i.test(city.name)),
    'a county was also recorded as a city');
});

test('a vague area is marked vague rather than parsed into nothing', () => {
  const area = parseServiceArea('Proudly serving Austin and surrounding areas.')!;
  assert.equal(area.vague, true);
  assert.ok(area.cities.some((city) => city.name === 'Austin'));
});

test('a named region is kept as a region', () => {
  const area = parseServiceArea('Available throughout Greater Austin and Central Texas.')!;
  assert.ok(area.regions.some((region) => /greater austin/i.test(region)),
    `regions were ${JSON.stringify(area.regions)}`);
});

test('a postal address wearing a service-area verb is refused', () => {
  // "Serving you from 120 Anastasia Blvd" is an address sentence. Reading it as
  // coverage puts the company's own street into the list of places it travels to.
  const area = parseServiceArea('Serving you from 120 Anastasia Blvd, St Augustine FL 32095.');
  assert.equal(area, null,
    'a street address was parsed as a service area');
});

test('copy that says nothing about coverage produces nothing', () => {
  assert.equal(parseServiceArea('We fix pipes. Call us today.'), null);
  assert.equal(parseServiceArea(''), null);
});

test('the statement that produced the parse is kept for a rep to check', () => {
  const area = parseServiceArea('We serve 32095 and 32084.')!;
  assert.match(area.statement, /32095/);
});

test('ZIP coverage is claimed only from an explicit ZIP', () => {
  const area = parseServiceArea('We serve St Johns County.')!;
  assert.equal(serviceAreaCoversZip(area, '32095'), false,
    'a county was expanded into ZIPs this product cannot know');

  const explicit = parseServiceArea('Service Areas: 32095, 32084.')!;
  assert.equal(serviceAreaCoversZip(explicit, '32095'), true);
  assert.equal(serviceAreaCoversZip(explicit, '78701'), false);
});

test('a ZIP+4 is normalised to the five-digit market', () => {
  const area = parseServiceArea('We serve 32095-1234.')!;
  assert.deepEqual(area.zips, ['32095']);
});

test('malformed or hostile copy does not throw or invent places', () => {
  for (const text of [
    'Serving <script>alert(1)</script>',
    'serving ' + 'x'.repeat(500),
    'Service Areas: ,,,,',
    'We serve ' + '99999 '.repeat(30),
  ]) {
    const area = parseServiceArea(text);
    if (area) {
      assert.ok(Array.isArray(area.zips));
      assert.ok(!area.cities.some((city) => city.name.includes('<')),
        'markup became a place name');
    }
  }
});

test('a service area never yields a street address', () => {
  const area = parseServiceArea('Proudly serving 32095, 32084 and St Augustine.')!;
  assert.equal((area as unknown as Record<string, unknown>)['street'], undefined);
  assert.equal((area as unknown as Record<string, unknown>)['address'], undefined);
});

test('a page that states coverage twice keeps the specific half', () => {
  // The hero says something warm and vague; the footer lists ZIPs. Reading only the
  // first match threw away the one thing a filter can use.
  const area = parseServiceArea(
    'Family owned, proudly serving Austin and surrounding areas since 2009.\n'
    + 'Service Areas: 78701, 78702 and 78704.')!;
  assert.deepEqual(area.zips, ['78701', '78702', '78704']);
  assert.ok(area.cities.some((city) => city.name === 'Austin'),
    'the warm sentence was discarded rather than merged');
  assert.equal(area.vague, true, 'the "surrounding areas" caveat was lost');
  assert.match(area.statement, /78701/,
    'the statement shown to a rep was the vague one, not the checkable one');
});
