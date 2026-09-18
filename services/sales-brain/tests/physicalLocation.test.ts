import './setup.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { runContactResearch } from '../src/workers/contactResearch.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { resetDatabase } from './helpers.js';
import {
  addressesFromJsonLd, addressesFromText, extractAddresses,
} from '../src/resolver/address.js';

after(async () => { await pool.end(); });

/**
 * SB-V2-3 — a physical address is something a company published.
 *
 * The failure this replaces is on the box right now: 66 `locations` rows, one per
 * legacy Roofing Account, every one carrying ZIP 32095 — the ZIP the canary searched.
 * No page was read and no company said anything. Each case below is a way the same
 * mistake comes back wearing different clothes.
 */

const NOW = new Date('2026-09-17T12:00:00Z');
const PAGE = 'https://example.example-co/contact';

// ----------------------------------------------------------------- structured

test('a schema.org PostalAddress on a business is a physical address', () => {
  const { addresses } = addressesFromJsonLd([{
    '@context': 'https://schema.org', '@type': 'HVACBusiness',
    name: 'Sunbright HVAC LLC',
    address: {
      '@type': 'PostalAddress', streetAddress: '1969 S Alafaya Trl Suite 233',
      addressLocality: 'Orlando', addressRegion: 'FL', postalCode: '32828',
      addressCountry: 'US',
    },
  }], PAGE, NOW);

  assert.equal(addresses.length, 1);
  assert.equal(addresses[0]!.kind, 'PHYSICAL');
  assert.equal(addresses[0]!.basis, 'SCHEMA_ORG_POSTAL_ADDRESS');
  assert.equal(addresses[0]!.streetAddress, '1969 S Alafaya Trl Suite 233');
  assert.equal(addresses[0]!.locality, 'Orlando');
  assert.equal(addresses[0]!.postalCode, '32828');
  assert.equal(addresses[0]!.sourceReference, PAGE);
});

test('a city and a state with no street is a place name, not an address', () => {
  // This is the shape of the 66 production rows: a geography with no street behind
  // it. Accepting it here would rebuild them from structured data instead of a ZIP.
  const { addresses } = addressesFromJsonLd([{
    '@type': 'LocalBusiness', name: 'Area Wide Air',
    address: { '@type': 'PostalAddress', addressLocality: 'Orlando', addressRegion: 'FL' },
  }], PAGE, NOW);
  assert.deepEqual(addresses, []);
});

test('areaServed is read as a service area and never as a location', () => {
  const { addresses, serviceAreas } = addressesFromJsonLd([{
    '@type': 'LocalBusiness', name: 'Travelling Air',
    areaServed: [{ '@type': 'City', name: 'Winter Park' }, 'Orange County'],
  }], PAGE, NOW);

  assert.deepEqual(addresses, [], 'somewhere a company travels to became where it is');
  assert.deepEqual(serviceAreas.map((a) => a.areaText), ['Winter Park', 'Orange County']);
  assert.equal(serviceAreas[0]!.basis, 'SCHEMA_ORG_AREA_SERVED');
});

test('a PO box is an address and not a place of business', () => {
  const { addresses } = addressesFromJsonLd([{
    '@type': 'Organization', name: 'Mail Drop Roofing',
    address: {
      '@type': 'PostalAddress', streetAddress: 'PO Box 1182',
      addressLocality: 'Sanford', addressRegion: 'FL', postalCode: '32772',
    },
  }], PAGE, NOW);

  assert.equal(addresses.length, 1);
  assert.equal(addresses[0]!.kind, 'MAILING',
    'a mail drop was recorded as the place the business operates from');
});

test('a Person node with an address is not the company address', () => {
  const { addresses } = addressesFromJsonLd([{
    '@type': 'Person', name: 'Hector Andres Guerrero',
    address: {
      '@type': 'PostalAddress', streetAddress: '1969 S Alafaya Trl',
      addressLocality: 'Orlando', addressRegion: 'FL', postalCode: '32828',
    },
  }], PAGE, NOW);
  assert.deepEqual(addresses, []);
});

// ---------------------------------------------------------------- page text

test('a street address in contact-page text is read with its own basis', () => {
  const addresses = addressesFromText(
    'Visit us\n4820 Distribution Ct Unit 6, Orlando, FL 32822\nOpen Monday to Friday',
    PAGE, NOW);

  assert.equal(addresses.length, 1);
  assert.equal(addresses[0]!.basis, 'PAGE_TEXT');
  assert.equal(addresses[0]!.kind, 'PHYSICAL');
  assert.equal(addresses[0]!.streetAddress, '4820 Distribution Ct Unit 6');
  assert.equal(addresses[0]!.locality, 'Orlando');
  assert.equal(addresses[0]!.region, 'FL');
  assert.equal(addresses[0]!.postalCode, '32822');
});

test('the addresses real company sites actually publish', () => {
  // Every line here is live on a site in production inventory, and each one broke the
  // first parser. Reading forwards from the house number let the street swallow the
  // "St." that begins a city name, and left no room for a unit between the street and
  // the town, so two of these produced a wrong answer and one produced nothing.
  const cases: [string, string, string][] = [
    ['3100 39th Ave N St. Petersburg, FL 33714', '3100 39th Ave N', 'St. Petersburg'],
    ['1579 Delaware Ave NE St. Petersburg, FL 33703', '1579 Delaware Ave NE', 'St. Petersburg'],
    ['1700 4th St S, Unit C, St. Petersburg, FL 33701', '1700 4th St S', 'St. Petersburg'],
    ['3865 Tyrone Blvd Saint Petersburg, FL 33710', '3865 Tyrone Blvd', 'Saint Petersburg'],
  ];
  for (const [line, street, city] of cases) {
    const found = addressesFromText(line, PAGE, NOW);
    assert.equal(found.length, 1, `no address read from: ${line}`);
    assert.equal(found[0]!.streetAddress, street, `wrong street from: ${line}`);
    assert.equal(found[0]!.locality, city, `wrong city from: ${line}`);
  }

  // And the street word that is also the start of a city name stays on the street.
  const court = addressesFromText('100 Court St, Orlando, FL 32801', PAGE, NOW);
  assert.equal(court[0]!.streetAddress, '100 Court St');
  assert.equal(court[0]!.locality, 'Orlando');
});

test('an address in the middle of a sentence is still an address', () => {
  // The service-area rule reads the sentence the address is in, not the one before it.
  const found = addressesFromText(
    'Serving all of Florida. Visit us at 100 Main St, Orlando, FL 32801', PAGE, NOW);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.streetAddress, '100 Main St');
});

test('service-area wording with a ZIP in it is not an address', () => {
  for (const line of [
    'Proudly serving Winter Park, FL 32789 and the surrounding area',
    'Areas we serve: 100 Main St, Winter Park, FL 32789',
    'We come to you throughout 500 Park Ave, Winter Park, FL 32789',
  ]) {
    assert.deepEqual(addressesFromText(line, PAGE, NOW), [],
      `service-area wording became an address: ${line}`);
  }
});

test('a city and state with no street number is never an address', () => {
  assert.deepEqual(addressesFromText('Orlando, FL 32801', PAGE, NOW), []);
  assert.deepEqual(addressesFromText('Located in Orlando, FL', PAGE, NOW), []);
  // A road named in a sentence is not a company sitting on it.
  assert.deepEqual(addressesFromText('Just off Alafaya Trail in Orlando, FL', PAGE, NOW), []);
});

test('a phone number and a licence number are not addresses', () => {
  assert.deepEqual(addressesFromText('Call 407 555 1200 today', PAGE, NOW), []);
  assert.deepEqual(addressesFromText('License CAC1819214, Orlando, FL 32828', PAGE, NOW), []);
});

// ------------------------------------------------------------------- a crawl

test('the same office on four pages is one location', () => {
  const jsonLd = [{
    '@type': 'LocalBusiness', name: 'Four Seasons Air',
    address: {
      '@type': 'PostalAddress', streetAddress: '2100 Principal Row',
      addressLocality: 'Orlando', addressRegion: 'FL', postalCode: '32837',
    },
  }];
  const text = 'Head office: 2100 Principal Row, Orlando, FL 32837';

  const { addresses } = extractAddresses([
    { url: 'https://example.example-co/', jsonLd, text },
    { url: 'https://example.example-co/contact', jsonLd, text },
    { url: 'https://example.example-co/about', text },
    { url: 'https://example.example-co/locations', text },
  ], NOW);

  assert.equal(addresses.length, 1);
  // The structured claim wins: both are the company's own words and one of them was
  // written to be read by a machine.
  assert.equal(addresses[0]!.basis, 'SCHEMA_ORG_POSTAL_ADDRESS');
});

test('one office written two ways is one location', () => {
  // Both lines are live on a St Petersburg company's site: the schema.org block spells
  // it out, and the page text abbreviates it and names the unit. Keying on the raw text
  // put the same office on the rep's page twice.
  const { addresses } = extractAddresses([{
    url: 'https://example.example-co/contact',
    jsonLd: [{
      '@type': 'HVACBusiness', name: 'The Service Pros',
      address: {
        '@type': 'PostalAddress', streetAddress: '1700 4th Street South',
        addressLocality: 'St. Petersburg', addressRegion: 'FL', postalCode: '33701-5811',
      },
    }],
    text: 'Visit us at 1700 4th St S, Unit C, St. Petersburg, FL 33701',
  }], NOW);

  assert.equal(addresses.length, 1, 'one office was recorded as two places');
  assert.equal(addresses[0]!.locality, 'St. Petersburg');
});

test('one office in two spellings of its state is one location', () => {
  // Live on an Orlando company's site: the schema.org block writes "Florida" and the
  // page writes "FL". Keying on the spelling put the same office on the page twice.
  const { addresses } = extractAddresses([{
    url: 'https://example.example-co/',
    jsonLd: [{
      '@type': 'LocalBusiness', name: 'Degree Seventy One',
      address: {
        '@type': 'PostalAddress', streetAddress: '2729 Maitland Crossing Way #308',
        addressLocality: 'Orlando', addressRegion: 'Florida', postalCode: '32810',
      },
    }],
    text: 'Office: 2729 Maitland Crossing Way #308, Orlando, FL 32810',
  }], NOW);

  assert.equal(addresses.length, 1);
  assert.equal(addresses[0]!.region, 'FL');
});

test('a directional is normalized and never dropped', () => {
  // "100 Main St N" and "100 Main St S" are two places. A key that ignored the letter
  // in the name of tidiness would merge two companies' neighbours into one location.
  const { addresses } = extractAddresses([{
    url: 'https://example.example-co/locations',
    text: 'North shop: 100 Main St N, Orlando, FL 32801. '
      + 'Our second yard: 100 Main St S, Orlando, FL 32801.',
  }], NOW);
  assert.equal(addresses.length, 2);
});

test('two branches published as two addresses stay two locations', () => {
  const { addresses } = extractAddresses([{
    url: 'https://example.example-co/locations',
    jsonLd: [{
      '@type': 'Organization', name: 'Two Branch Air',
      department: [
        {
          '@type': 'LocalBusiness', name: 'Orlando',
          address: {
            '@type': 'PostalAddress', streetAddress: '11 North St',
            addressLocality: 'Orlando', addressRegion: 'FL', postalCode: '32801',
          },
        },
        {
          '@type': 'LocalBusiness', name: 'Tampa',
          address: {
            '@type': 'PostalAddress', streetAddress: '22 South Ave',
            addressLocality: 'Tampa', addressRegion: 'FL', postalCode: '33602',
          },
        },
      ],
    }],
  }], NOW);

  assert.equal(addresses.length, 2);
  assert.deepEqual(addresses.map((a) => a.locality).sort(), ['Orlando', 'Tampa']);
});

test('a crawl that read nothing produces no location at all', () => {
  const { addresses, serviceAreas } = extractAddresses([
    { url: 'https://example.example-co/', text: 'Fast, friendly service. Call today.' },
  ], NOW);
  assert.deepEqual(addresses, []);
  assert.deepEqual(serviceAreas, []);
});

// --------------------------------------------------- through the research run

/**
 * The whole path, from a company's own page to a row a rep can read.
 *
 * Run against the real crawler with a stubbed network, because the parts that have
 * gone wrong before are the joins: an extractor that is never called, a write that
 * loses its provenance, a location that ends up attached to nothing.
 */
const SITES: Record<string, string> = {
  'sunbrightair.example-co': `<html><head>
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'HVACBusiness',
      name: 'Sunbright HVAC LLC',
      telephone: '407-555-0111',
      address: {
        '@type': 'PostalAddress', streetAddress: '1969 S Alafaya Trl Suite 233',
        addressLocality: 'Orlando', addressRegion: 'FL', postalCode: '32828',
        addressCountry: 'US',
      },
      areaServed: ['Orange County', 'Seminole County'],
    })}</script></head>
    <body><h1>Sunbright HVAC</h1>
    <p>Proudly serving Winter Park, FL 32789 and the surrounding area.</p>
    </body></html>`,
  'noaddressair.example-co': `<html><body><h1>No Address Air</h1>
    <p>Serving all of Central Florida. Call (407) 555-0122.</p></body></html>`,
};

async function withStubbedSites<T>(run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n',
        { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    const body = SITES[url.hostname];
    if (!body || url.pathname !== '/') {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof globalThis.fetch;
  try { return await run(); } finally { globalThis.fetch = realFetch; }
}

test('a research run records the address the site publishes, with where it read it',
  async () => {
    await resetDatabase();
    await syncVerticalProfiles();
    const { accountId } = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Sunbright HVAC LLC', website: 'https://sunbrightair.example-co',
      phone: '407-555-0111', verticalProfileId: 'hvac',
    }, { discoverySource: 'import' }));

    await withStubbedSites(() => runContactResearch(accountId, 'newly_discovered'));

    const { rows } = await query<{
      address_line_1: string | null; city: string | null; state_region: string | null;
      postal_code: string | null; location_type: string; basis: string | null;
      source_reference: string | null; last_verified_at: Date | null;
    }>(`select address_line_1, city, state_region, postal_code, location_type, basis,
               source_reference, last_verified_at
          from locations where account_id = $1`, [accountId]);

    assert.equal(rows.length, 1, 'the published address did not reach the Account');
    assert.equal(rows[0]!.address_line_1, '1969 S Alafaya Trl Suite 233');
    assert.equal(rows[0]!.city, 'Orlando');
    assert.equal(rows[0]!.postal_code, '32828');
    assert.equal(rows[0]!.location_type, 'physical');
    // How it is known travels with it. A location whose basis is null is a location
    // nobody can account for, which is what the 66 legacy rows are.
    assert.equal(rows[0]!.basis, 'SCHEMA_ORG_POSTAL_ADDRESS');
    assert.equal(rows[0]!.source_reference, 'https://sunbrightair.example-co/');
    assert.ok(rows[0]!.last_verified_at);

    // The service area is recorded as a service area, and never as a place.
    const { rows: evidence } = await query<{ claim_key: string; claim_text: string }>(
      `select claim_key, claim_text from evidence_records
        where account_id = $1 and category = 'location' order by claim_key`, [accountId]);
    const keys = evidence.map((row) => row.claim_key);
    assert.ok(keys.includes('physical_address'));
    assert.equal(keys.filter((key) => key === 'service_area').length, 2);
    assert.equal(keys.includes('mailing_address'), false);

    // And the evidence points at the row it is about.
    const { rows: linked } = await query<{ n: number }>(
      `select count(*)::int as n from evidence_records e
        join locations l on l.location_id = e.location_id
       where e.account_id = $1 and e.claim_key = 'physical_address'`, [accountId]);
    assert.equal(linked[0]!.n, 1, 'the address evidence is not attached to the address');
  });

test('a company that publishes no address gets no location at all', async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'No Address Air', website: 'https://noaddressair.example-co',
    phone: '407-555-0122', verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));

  await withStubbedSites(() => runContactResearch(accountId, 'newly_discovered'));

  const { rows } = await query<{ n: number }>(
    'select count(*)::int as n from locations where account_id = $1', [accountId]);
  assert.equal(rows[0]!.n, 0,
    '"Serving all of Central Florida" was turned into a place of business');
});

test('the database refuses a physical location with no street', async () => {
  await resetDatabase();
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Constraint Air', website: 'https://constraint.example-co',
    phone: '407-555-0133',
  }, { discoverySource: 'import' }));

  await assert.rejects(
    () => query(
      `insert into locations (account_id, city, state_region, postal_code, location_type)
       values ($1, 'Orlando', 'FL', '32801', 'physical')`, [accountId]),
    /locations_physical_needs_street/,
    'a ZIP with no street can still be written down as where a company is');
});

test('the rep sees the published address, its source, and what is not an address',
  async () => {
    await resetDatabase();
    await syncVerticalProfiles();
    const { accountId } = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Sunbright HVAC LLC', website: 'https://sunbrightair.example-co',
      phone: '407-555-0111', verticalProfileId: 'hvac',
    }, { discoverySource: 'import' }));
    await withStubbedSites(() => runContactResearch(accountId, 'newly_discovered'));

    const app = await buildServer();
    try {
      await createUser({
        email: 'loc.ops@test.local', displayName: 'Loc Ops', role: 'SALES_MANAGER',
        password: 'physical-location-password' });
      const login = await app.inject({ method: 'POST', url: '/login',
        payload: { email: 'loc.ops@test.local', password: 'physical-location-password' } });
      const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!.value;
      const page = await app.inject({ method: 'GET', url: `/accounts/${accountId}`,
        headers: { cookie: `yad_sales_session=${cookie}` } });

      assert.equal(page.statusCode, 200);
      assert.match(page.body, /Published address/);
      assert.match(page.body, /1969 S Alafaya Trl Suite 233, Orlando, FL 32828/);
      // Where it was read from, so a rep can check the claim rather than trust it.
      assert.match(page.body, /sunbrightair\.example-co/);
      // And the service area is labelled as travel, not as a location.
      assert.match(page.body, /Says it serves/);
      assert.match(page.body, /not where they\s+are/);
    } finally {
      await app.close();
    }
  });
