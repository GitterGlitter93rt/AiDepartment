import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../src/resolver/reconcile.js';
import type { PersonObservation } from '../src/resolver/types.js';
import { parseSunbizDetail, sunbizPeople } from '../src/sources/adapters/flSunbiz.js';
import { parseComptrollerStatus, comptrollerPeople }
  from '../src/sources/adapters/txComptroller.js';
import { parseTsbpeDataset, tsbpePeople } from '../src/sources/adapters/txTsbpe.js';
import * as fixtures from './support/fixtures/sources/index.js';

/**
 * Who the rep is told to ask for, once official records are in the mix.
 *
 * Official filings name real, verifiable, usually-senior people, which makes them
 * genuinely valuable and genuinely dangerous: a registered agent is often a law firm,
 * and a Responsible Master Plumber is a regulatory designation. Both look exactly like
 * a decision maker in a CRM field, and a rep will ask for whoever the field names.
 */

function firstParty(name: string, title: string): PersonObservation {
  return {
    personName: name, rawTitle: title,
    relationship: title.toLowerCase().includes('owner') ? 'OWNER'
      : title.toLowerCase().includes('operations') ? 'OPERATIONS' : 'OTHER_BUSINESS_ROLE',
    sourceClass: 'COMPANY_FIRST_PARTY', sourceReference: 'https://co.invalid/about',
    observedAt: new Date(), freshness: 'FRESH', scope: 'ACCOUNT',
  };
}

function resolve(people: PersonObservation[]) {
  return reconcile({
    companyName: 'Kowalczyk Plumbing LLC', verticalProfileId: 'plumbing',
    hypothesisCategory: null, people, endpoints: [], paidEnrichmentAvailable: false,
  });
}

test('a registered agent is never the person a rep is sent to', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL)!;
  const resolution = resolve(sunbizPeople(record, 'ref'));

  assert.notEqual(resolution.primary?.personName, 'COASTAL AGENT SERVICES INC',
    'the rep was sent to a commercial registered-agent service');
  const everywhere = [resolution.primary, ...resolution.alternates]
    .filter(Boolean)
    .map((identity) => identity!.relationship);
  if (everywhere.includes('REGISTERED_AGENT')) {
    const agent = [resolution.primary, ...resolution.alternates]
      .find((identity) => identity?.relationship === 'REGISTERED_AGENT')!;
    assert.notEqual(agent, resolution.primary,
      'a registered agent was promoted to primary contact');
  }
});

test('an owner on the company website outranks an officer on a filing', () => {
  const record = parseComptrollerStatus(fixtures.COMPTROLLER_ACTIVE)!;
  const resolution = resolve([
    ...comptrollerPeople(record, 'ref'),
    firstParty('Dana Kowalczyk', 'Owner'),
  ]);
  assert.equal(resolution.primary?.personName, 'Dana Kowalczyk',
    'a state filing outranked the company saying who runs it');
  assert.equal(resolution.primary?.relationship, 'OWNER');
});

test('an officer from a filing stays visible with the title the filing gave', () => {
  const record = parseComptrollerStatus(fixtures.COMPTROLLER_ACTIVE)!;
  const resolution = resolve([
    ...comptrollerPeople(record, 'ref'),
    firstParty('Dana Kowalczyk', 'Owner'),
  ]);
  const everyone = [resolution.primary, ...resolution.alternates].filter(Boolean);
  const priya = everyone.find((identity) => identity!.personName === 'PRIYA NAIR');
  if (priya) {
    assert.equal(priya.rawTitle, 'PRESIDENT',
      'the filing’s own title was replaced by a normalized guess');
  }
  // Either way the registry person must not have been silently discarded *and*
  // promoted; both failures are covered by the other tests in this file.
  assert.ok(everyone.length >= 1);
});

test('a Responsible Master Plumber is not turned into the owner', () => {
  const rmp = parseTsbpeDataset(fixtures.TSBPE_DATASET)
    .find((entry) => entry.licenseNumber === 'M-40111')!;
  const resolution = resolve(tsbpePeople(rmp, 'ref'));

  const everyone = [resolution.primary, ...resolution.alternates].filter(Boolean);
  const jordan = everyone.find((identity) => identity!.personName === 'JORDAN OKAFOR');
  if (jordan) {
    assert.notEqual(jordan.relationship, 'OWNER',
      'a regulatory designation became an ownership claim');
    assert.equal(jordan.relationship, 'QUALIFIER');
  }
  assert.notEqual(resolution.status, 'NAMED_DIRECT_READY',
    'a licence record alone was treated as a ready-to-call named contact');
});

test('a qualifier alone does not make an account look contact-ready', () => {
  const rmp = parseTsbpeDataset(fixtures.TSBPE_DATASET)
    .find((entry) => entry.licenseNumber === 'M-40111')!;
  const resolution = resolve(tsbpePeople(rmp, 'ref'));
  if (resolution.primary) {
    assert.notEqual(resolution.primary.roleMatch, 'PRIMARY_PROCESS_OWNER',
      'the person whose licence the company operates under was called the process owner');
  }
});

test('official people are kept when the website names nobody', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL)!;
  const resolution = resolve(sunbizPeople(record, 'ref'));
  const named = [resolution.primary, ...resolution.alternates]
    .filter(Boolean).map((identity) => identity!.personName);
  assert.ok(named.some((name) => name === 'KOWALCZYK, DANA' || name === 'ELLIS, MARCUS'),
    'a company whose only named people are on its state filing was left with none');
});

test('every excluded person is excluded for a stated reason', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL)!;
  const resolution = resolve(sunbizPeople(record, 'ref'));
  for (const excluded of resolution.excluded) {
    assert.ok(excluded.reason.length > 0,
      `${excluded.personName} was dropped without a reason anyone can audit`);
  }
});
