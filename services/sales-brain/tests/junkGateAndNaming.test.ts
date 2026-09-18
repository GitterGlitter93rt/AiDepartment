import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters,
  type DiscoveryAdapter, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { resetDatabase } from './helpers.js';
import { observationsFor, type BusinessSpec } from './support/observations.js';
import type { ProviderObservation } from '../src/discovery/observation.js';

/**
 * A page about businesses is not a business, and a page title is not a name.
 *
 * Two separate promises the portal makes to a rep, both broken by the same gap.
 * `resolve.ts` classified every identity and worked out a defensible name for it, and
 * `discovery_candidates` stored both -- then promotion ignored the lot and asked
 * `isUsableBusiness`, which is a name plus a domain or a phone. A Yelp search page, a
 * news article and a manufacturer's dealer locator each have all three.
 *
 * So the classifier's own opening line described live behaviour: "every one of them
 * became a company a rep was asked to call".
 */

let userId: string;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  userId = await createUser({
    email: 'junk.gate@test.local', displayName: 'Junk Gate', role: 'SALES_MANAGER',
    password: 'junk-gate-password-not-a-secret' });
});

function adapterReturning(specs: BusinessSpec[]): DiscoveryAdapter {
  return {
    name: 'fixture-provider', requiresCredential: false, governanceReviewed: true,
    mode: 'sync', isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return { status: 'OK', observations: observationsFor(specs), providerTaskId: 'fixture-1' };
    },
  } as DiscoveryAdapter;
}

async function mine(specs: BusinessSpec[]): Promise<void> {
  registerDiscoveryAdapter(adapterReturning(specs));
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: userId });
  await drainQueue(25);
}

async function accountNames(): Promise<string[]> {
  const { rows } = await query<{ canonical_name: string }>(
    'select canonical_name from accounts order by canonical_name');
  return rows.map((row) => row.canonical_name);
}

test('a directory that carries several businesses never becomes one', async () => {
  // The structural test, which is what catches tomorrow's directory: one domain
  // presenting three different companies is serving other people's businesses.
  await mine([
    { name: 'Acme Heating & Air', website: 'https://localprobook.com/acme', phone: '904-555-0101',
      resultType: 'ORGANIC' },
    { name: 'Bayside Cooling', website: 'https://localprobook.com/bayside', phone: '904-555-0102',
      resultType: 'ORGANIC' },
    { name: 'Coastal Climate Control', website: 'https://localprobook.com/coastal',
      phone: '904-555-0103', resultType: 'ORGANIC' },
  ]);

  assert.deepEqual(await accountNames(), [],
    'a directory listing three companies was promoted to a company');
});

test('the refusal is recorded, not silent', async () => {
  await mine([
    { name: 'Acme Heating & Air', website: 'https://localprobook.com/acme', phone: '904-555-0101',
      resultType: 'ORGANIC' },
    { name: 'Bayside Cooling', website: 'https://localprobook.com/bayside', phone: '904-555-0102',
      resultType: 'ORGANIC' },
  ]);

  // The run that found a directory has to be able to say so afterwards.
  const { rows } = await query<{ source_class: string; entity_status: string }>(
    'select source_class, entity_status from discovery_candidates');
  assert.ok(rows.length > 0, 'nothing was recorded about what the search returned');
  assert.ok(rows.every((row) => row.entity_status !== 'VERIFIED'),
    'a directory identity was recorded as a verified entity');
});

test('a real local listing is still promoted', async () => {
  // The gate must refuse pages, not companies. A provider entity listing with a name
  // and a number to ring is the strongest thing a SERP gives us.
  await mine([
    { name: 'Southern Air', website: 'https://southernair.example-co', phone: '407-555-0150',
      resultType: 'MAPS_LOCAL', observedBusinessAddress: '120 Main St, Orlando, FL' },
  ]);

  assert.deepEqual(await accountNames(), ['Southern Air'],
    'a genuine local business listing was refused');
});

test('a company is named from its listing, not from its page title', async () => {
  // The production shape: the same company appears in the local pack under its name
  // and organically under an SEO title. The rep's list read the title.
  await mine([
    { name: 'Southern Air', website: 'https://southernair.example-co', phone: '407-555-0150',
      resultType: 'MAPS_LOCAL', observedBusinessAddress: '120 Main St, Orlando, FL' },
    { name: 'Southern Air | AC Repair & Installation in Orlando FL | Call Now',
      website: 'https://southernair.example-co', phone: '407-555-0150', resultType: 'ORGANIC' },
  ]);

  const names = await accountNames();
  assert.equal(names.length, 1, 'one company became two Accounts');
  assert.equal(names[0], 'Southern Air',
    'the Account was named after a page title rather than the company');
});

test('ad copy never becomes a company name', async () => {
  // "Same-Day AC Repair -- 24/7" beside a tracking number is a campaign, and an
  // aggregator and a franchise portal buy the same keywords. Built as a raw row on
  // purpose: `observationsFor` pairs every paid spec with the listing that says whose
  // ad it is, and the row this guards against is the one that arrives without it.
  const paidOnly: ProviderObservation[] = [{
    providerNativeId: null,
    observedName: 'Same-Day AC Repair - 24/7 Emergency Service',
    observedDomain: null, observedPhone: '800-555-0199',
    observedBusinessAddress: null,
    observedCity: null, observedRegion: null, observedPostalCode: null,
    searchLocationName: null, resultType: 'PAID_SEARCH_TEXT', position: 1,
    adHeadline: 'Same-Day AC Repair - 24/7 Emergency Service',
    landingUrl: null, advertisedService: 'ac repair', checkUrl: null,
    observedAt: new Date(), query: 'HVAC contractor 32095',
  }];
  registerDiscoveryAdapter({
    name: 'fixture-provider', requiresCredential: false, governanceReviewed: true,
    mode: 'sync', isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return { status: 'OK', observations: paidOnly, providerTaskId: 'fixture-1' };
    },
  } as DiscoveryAdapter);
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: userId });
  await drainQueue(25);

  const names = await accountNames();
  assert.ok(!names.some((name) => name.toLowerCase().includes('same-day')),
    `ad copy was promoted to a company: ${names.join(' | ')}`);
});

test('a company with no website but a real name and number is kept', async () => {
  // Refusing these would drop the businesses that genuinely have no site, which is a
  // real and common shape in a local market.
  await mine([
    { name: 'Gulf Coast Heating and Air', website: null, phone: '904-555-0170',
      resultType: 'MAPS_LOCAL', observedBusinessAddress: '9 Ocean Blvd, St. Augustine, FL' },
  ]);

  assert.deepEqual(await accountNames(), ['Gulf Coast Heating and Air'],
    'a real business without a website was refused');
});
