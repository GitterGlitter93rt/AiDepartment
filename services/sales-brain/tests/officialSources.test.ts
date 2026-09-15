import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSunbizDetail, sunbizCandidate, sunbizFacts, sunbizPeople, expandSunbizTitle }
  from '../src/sources/adapters/flSunbiz.js';
import { parseDbprDetail, dbprFacts, dbprPeople, licenceCoversVertical }
  from '../src/sources/adapters/flDbpr.js';
import { parseComptrollerStatus, comptrollerFacts, comptrollerPeople }
  from '../src/sources/adapters/txComptroller.js';
import { parseTdlrResults, tdlrPeople, tdlrProgramFor }
  from '../src/sources/adapters/txTdlr.js';
import { parseTsbpeDataset, tsbpeFacts, tsbpePeople, rankTsbpe, classifyTsbpeLicenseType }
  from '../src/sources/adapters/txTsbpe.js';
import { decideMatch } from '../src/sources/match.js';
import type { SourceLookupContext } from '../src/sources/types.js';
import * as fixtures from './support/fixtures/sources/index.js';

/**
 * Parsing official records.
 *
 * Every fixture here is sanitized and offline. That matters more in this file than
 * anywhere else in the suite: the alternative is a test that sends traffic to a state
 * agency every time somebody runs `npm test`.
 */

function context(overrides: Partial<SourceLookupContext> = {}): SourceLookupContext {
  return {
    accountId: 'a', companyName: 'Kowalczyk Plumbing LLC', stateRegion: 'FL',
    city: 'St Augustine', postalCode: '32095', domain: null,
    verticalProfileId: 'plumbing', knownPhones: [], streetAddress: '120 Anastasia Blvd',
    ...overrides,
  };
}

// ------------------------------------------------------------------- Sunbiz --

test('a Sunbiz filing yields the entity, its status and its filing date', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL)!;
  assert.equal(record.legalName, 'KOWALCZYK PLUMBING LLC');
  assert.equal(record.documentNumber, 'L14000012345');
  assert.equal(record.status, 'ACTIVE');
  assert.equal(record.filedDate, '03/14/2014');
  assert.equal(record.principalAddress?.city, 'ST AUGUSTINE');
  assert.equal(record.principalAddress?.postalCode, '32095');
  assert.equal(record.lastAnnualReportYear, '2025');
});

test('the registered agent is an agent, never an owner', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL)!;
  assert.equal(record.registeredAgent?.name, 'COASTAL AGENT SERVICES INC');

  const people = sunbizPeople(record, 'ref');
  const agent = people.find((person) => person.personName === 'COASTAL AGENT SERVICES INC')!;
  assert.equal(agent.relationship, 'REGISTERED_AGENT',
    'the registered agent was given an operational role');
  assert.match(agent.notes!, /[Nn]ot evidence of employment, ownership/);

  const facts = sunbizFacts(record, 'ref');
  const agentFact = facts.find((fact) => fact.claimKey === 'registered_agent_name')!;
  assert.match(agentFact.claimText, /registered agent/i);
  assert.doesNotMatch(agentFact.claimText, /\bowner\b/i,
    'the registered agent fact used the word owner');
});

test('managers keep the role the filing gives them', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL)!;
  assert.equal(record.authorizedPersons.length, 2);
  assert.equal(record.authorizedPersons[0]!.name, 'KOWALCZYK, DANA');
  assert.equal(record.authorizedPersons[0]!.title, 'Managing Member');
  assert.equal(record.authorizedPersons[1]!.title, 'Manager');

  const people = sunbizPeople(record, 'ref');
  const dana = people.find((person) => person.personName === 'KOWALCZYK, DANA')!;
  assert.equal(dana.rawTitle, 'Managing Member', 'the filing’s own title was lost');
  assert.notEqual(dana.relationship, 'OWNER',
    'a managing member was promoted to owner without evidence');
});

test('Sunbiz title codes expand to what they mean', () => {
  assert.equal(expandSunbizTitle('MGRM'), 'Managing Member');
  assert.equal(expandSunbizTitle('RA'), 'Registered Agent');
  assert.equal(expandSunbizTitle('P'), 'President');
  assert.equal(expandSunbizTitle('Chief Widget Officer'), 'Chief Widget Officer');
});

test('an inactive entity says inactive', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_INACTIVE_DETAIL)!;
  assert.equal(record.status, 'INACTIVE');
  const status = sunbizFacts(record, 'ref').find((fact) => fact.claimKey === 'entity_status')!;
  assert.equal(status.normalizedValue, 'INACTIVE');
});

test('a search-results page is not mistaken for a record', () => {
  assert.equal(parseSunbizDetail(fixtures.SUNBIZ_SEARCH_RESULTS), null,
    'a list of candidates was parsed as one company');
});

test('the FEI/EIN on the filing is not stored', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL)!;
  const serialized = JSON.stringify([record, sunbizFacts(record, 'ref')]);
  assert.doesNotMatch(serialized, /47-?1234567/,
    'a federal tax identifier was carried into the fact model');
});

test('entity status ages faster than a filing date', () => {
  const facts = sunbizFacts(parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL)!, 'ref');
  const status = facts.find((fact) => fact.claimKey === 'entity_status')!;
  const filed = facts.find((fact) => fact.claimKey === 'entity_filed_date')!;
  assert.ok(status.ttlDays < filed.ttlDays,
    'a status that changes silently was given the same life as a date that cannot change');
});

test('a Miami namesake does not become the St Augustine company', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL)!;
  const decision = decideMatch([sunbizCandidate(record)], context({ city: 'Miami' }));
  assert.notEqual(decision.status, 'MATCHED');
});

// --------------------------------------------------------------------- DBPR --

test('a DBPR licence yields number, status, qualifier and dates', () => {
  const licence = parseDbprDetail(fixtures.DBPR_BUSINESS_LICENCE)!;
  assert.equal(licence.licenseNumber, 'CFC1428888');
  assert.equal(licence.licenseType, 'Certified Plumbing Contractor');
  assert.equal(licence.qualifyingAgent, 'DANA KOWALCZYK');
  assert.equal(licence.primaryStatus, 'Current');
  assert.equal(licence.expiresDate, '08/31/2026');
});

test('the qualifying agent is a qualifier, not an owner', () => {
  const licence = parseDbprDetail(fixtures.DBPR_BUSINESS_LICENCE)!;
  const people = dbprPeople(licence, 'ref');
  const qualifier = people.find((person) => person.personName === 'DANA KOWALCZYK')!;
  assert.equal(qualifier.relationship, 'QUALIFIER');
  assert.match(qualifier.notes!, /not evidence of ownership/i);

  const fact = dbprFacts(licence, 'ref')
    .find((entry) => entry.claimKey === 'license_qualifying_agent')!;
  assert.doesNotMatch(fact.claimText, /\bowner\b(?!ship)/i);
});

test('a business-held licence produces no person named after a company', () => {
  const licence = parseDbprDetail(fixtures.DBPR_BUSINESS_LICENCE)!;
  const people = dbprPeople(licence, 'ref');
  assert.ok(!people.some((person) => /LLC|INC/i.test(person.personName ?? '')),
    'a company name was recorded as a person');
});

test('an expired licence is reported expired, not active', () => {
  const licence = parseDbprDetail(fixtures.DBPR_EXPIRED_LICENCE)!;
  const status = dbprFacts(licence, 'ref')
    .find((fact) => fact.claimKey === 'professional_license_status')!;
  assert.notEqual(status.normalizedValue, 'ACTIVE');
});

test('an electrical licence does not verify a plumbing company', () => {
  const licence = parseDbprDetail(fixtures.DBPR_WRONG_TRADE_LICENCE)!;
  assert.equal(licenceCoversVertical(licence, 'plumbing'), false,
    'a licence for another trade was accepted as verifying this one');
  assert.equal(licenceCoversVertical(licence, 'electrical'), true);
});

// -------------------------------------------------------- Texas Comptroller --

test('the Comptroller record yields entity identity and right to transact', () => {
  const record = parseComptrollerStatus(fixtures.COMPTROLLER_ACTIVE)!;
  assert.equal(record.legalName, 'LONE STAR DRAIN WORKS LLC');
  assert.equal(record.sosFileNumber, '0801234567');
  assert.equal(record.rightToTransact, 'ACTIVE');
  assert.equal(record.stateOfFormation, 'TX');
  assert.equal(record.reportYear, '2025');
});

test('"franchise tax ended" is preserved rather than flattened to inactive', () => {
  const record = parseComptrollerStatus(fixtures.COMPTROLLER_FRANCHISE_ENDED)!;
  const fact = comptrollerFacts(record, 'ref')
    .find((entry) => entry.claimKey === 'entity_right_to_transact')!;
  assert.equal(fact.normalizedValue, 'FRANCHISE TAX ENDED',
    'a status a rep would want to know about was collapsed into a boolean');
});

test('officers from a public information report keep their exact titles', () => {
  const record = parseComptrollerStatus(fixtures.COMPTROLLER_ACTIVE)!;
  assert.equal(record.officers.length, 2);
  const people = comptrollerPeople(record, 'ref');
  const priya = people.find((person) => person.personName === 'PRIYA NAIR')!;
  assert.equal(priya.rawTitle, 'PRESIDENT');
  assert.notEqual(priya.relationship, 'OWNER',
    'an officer on a tax report was turned into an owner');
  assert.match(priya.notes!, /public information report/i);
});

test('the Texas taxpayer number is not stored as a fact', () => {
  const record = parseComptrollerStatus(fixtures.COMPTROLLER_ACTIVE)!;
  const serialized = JSON.stringify(comptrollerFacts(record, 'ref'));
  assert.doesNotMatch(serialized, /32012345678/,
    'a tax identifier was carried into the fact model');
});

// ------------------------------------------------------------------- TDLR --

test('a TDLR result yields licence, holder, business and status', () => {
  const [licence] = parseTdlrResults(fixtures.TDLR_HVAC_RESULTS, 'AIR_CONDITIONING');
  assert.ok(licence, 'no licence parsed');
  assert.equal(licence!.licenseNumber, 'TACLA00123456');
  assert.equal(licence!.licenseeName, 'ELENA VOSS');
  assert.equal(licence!.businessName, 'BLUEBONNET AIR LLC');
  assert.equal(licence!.status, 'Active');
});

test('a TDLR licence holder is a licence holder, not an owner', () => {
  const [licence] = parseTdlrResults(fixtures.TDLR_HVAC_RESULTS, 'AIR_CONDITIONING');
  const [person] = tdlrPeople(licence!, 'ref');
  assert.equal(person!.relationship, 'LICENSE_HOLDER');
  assert.match(person!.notes!, /not evidence of ownership/i);
});

test('an expired TDLR licence is not reported active', () => {
  const [licence] = parseTdlrResults(fixtures.TDLR_EXPIRED_RESULTS, 'AIR_CONDITIONING');
  assert.equal(licence!.status, 'Expired');
});

test('no results is no licence, and parses to nothing', () => {
  assert.deepEqual(parseTdlrResults(fixtures.TDLR_NO_RESULTS, 'AIR_CONDITIONING'), []);
});

test('two same-named licences in two cities are not resolved by guessing', () => {
  const licences = parseTdlrResults(fixtures.TDLR_COLLISION_RESULTS, 'AIR_CONDITIONING');
  assert.equal(licences.length, 2);
  const decision = decideMatch(
    licences.map((licence) => ({
      name: licence.businessName!, reference: licence.licenseNumber,
      city: licence.city, stateRegion: 'TX',
    })),
    context({ companyName: 'Bluebonnet Air LLC', stateRegion: 'TX', city: null,
      postalCode: null, streetAddress: null, verticalProfileId: 'hvac' }));
  assert.equal(decision.status, 'AMBIGUOUS',
    'one of two same-named licences in different cities was picked');
});

test('TDLR programmes map only to the trades they cover', () => {
  assert.equal(tdlrProgramFor('hvac'), 'AIR_CONDITIONING');
  assert.equal(tdlrProgramFor('electrical'), 'ELECTRICAL');
  assert.equal(tdlrProgramFor('roofing'), null,
    'a trade TDLR does not license was routed to TDLR');
  assert.equal(tdlrProgramFor('plumbing'), null,
    'Texas plumbing is the plumbing board’s, not TDLR’s');
});

// ------------------------------------------------------------------ TSBPE --

test('a TSBPE dataset parses licences with company association', () => {
  const records = parseTsbpeDataset(fixtures.TSBPE_DATASET);
  assert.equal(records.length, 4);
  const rmp = records.find((record) => record.licenseNumber === 'M-40111')!;
  assert.equal(rmp.licenseType, 'RESPONSIBLE_MASTER_PLUMBER');
  assert.equal(rmp.licenseeName, 'JORDAN OKAFOR');
  assert.equal(rmp.companyName, 'LONE STAR DRAIN WORKS LLC');
  assert.equal(rmp.insuranceExpirationDate, '01/15/2027');
  assert.deepEqual(rmp.endorsements, ['Medical Gas']);
});

test('the Responsible Master Plumber is prominent but never called the owner', () => {
  const rmp = parseTsbpeDataset(fixtures.TSBPE_DATASET)
    .find((record) => record.licenseNumber === 'M-40111')!;
  const [person] = tsbpePeople(rmp, 'ref');
  assert.equal(person!.relationship, 'QUALIFIER',
    'the RMP was promoted to an ownership role');
  assert.match(person!.notes!, /not evidence of ownership/i);

  const fact = tsbpeFacts(rmp, 'ref')
    .find((entry) => entry.claimKey === 'responsible_master_plumber')!;
  assert.match(fact.claimText, /Responsible Master Plumber/);
  assert.match(fact.claimText, /not by itself evidence of ownership/i);
});

test('insurance expiry is kept when the dataset has it and absent when it does not', () => {
  const records = parseTsbpeDataset(fixtures.TSBPE_DATASET);
  const withInsurance = records.find((record) => record.licenseNumber === 'M-40111')!;
  const without = records.find((record) => record.licenseNumber === 'J-55222')!;
  assert.ok(tsbpeFacts(withInsurance, 'r').some((f) => f.claimKey === 'license_insurance_expiration'));
  assert.ok(!tsbpeFacts(without, 'r').some((f) => f.claimKey === 'license_insurance_expiration'),
    'an insurance date was invented for a record that has none');
});

test('an expired plumbing licence is not reported active', () => {
  const expired = parseTsbpeDataset(fixtures.TSBPE_DATASET)
    .find((record) => record.licenseNumber === 'M-40999')!;
  const status = tsbpeFacts(expired, 'r')
    .find((fact) => fact.claimKey === 'professional_license_status')!;
  assert.notEqual(status.normalizedValue, 'ACTIVE');
});

test('the most senior licence leads', () => {
  const records = parseTsbpeDataset(fixtures.TSBPE_DATASET)
    .filter((record) => record.companyName === 'LONE STAR DRAIN WORKS LLC');
  assert.equal(rankTsbpe(records)[0]!.licenseType, 'RESPONSIBLE_MASTER_PLUMBER',
    'a journeyman was shown above the Responsible Master Plumber');
});

test('licence types are classified from the words the board uses', () => {
  assert.equal(classifyTsbpeLicenseType('Responsible Master Plumber'), 'RESPONSIBLE_MASTER_PLUMBER');
  assert.equal(classifyTsbpeLicenseType('RMP'), 'RESPONSIBLE_MASTER_PLUMBER');
  assert.equal(classifyTsbpeLicenseType('Tradesman Plumber-Limited'), 'TRADESMAN_PLUMBER_LIMITED');
  assert.equal(classifyTsbpeLicenseType('Beekeeper'), null);
});

test('one company name in two cities stays ambiguous in the dataset too', () => {
  const records = parseTsbpeDataset(fixtures.TSBPE_DUPLICATE_COMPANY);
  const decision = decideMatch(
    records.map((record) => ({
      name: record.companyName!, reference: record.licenseNumber,
      city: record.city, stateRegion: 'TX',
    })),
    context({ companyName: 'Statewide Plumbing Co', stateRegion: 'TX', city: null,
      postalCode: null, streetAddress: null }));
  assert.equal(decision.status, 'AMBIGUOUS');
});

test('a malformed dataset yields nothing rather than garbage', () => {
  assert.deepEqual(parseTsbpeDataset(''), []);
  assert.deepEqual(parseTsbpeDataset('just one line'), []);
  assert.deepEqual(parseTsbpeDataset('a,b,c\n1,2,3'), [],
    'rows without a recognisable licence type were accepted');
});

// ------------------------------------------- licence must cover the trade --

test('a Texas electrical licence does not verify an HVAC company', async () => {
  const { tdlrLicenceCoversVertical } = await import('../src/sources/adapters/txTdlr.js');
  const [licence] = parseTdlrResults(fixtures.TDLR_HVAC_RESULTS, 'AIR_CONDITIONING');
  assert.equal(tdlrLicenceCoversVertical(licence!, 'hvac'), true);

  const electrical = { ...licence!, licenseType: 'Master Electrician',
    licenseNumber: 'EC99887', program: 'ELECTRICAL' as const };
  assert.equal(tdlrLicenceCoversVertical(electrical, 'hvac'), false,
    'an electrical licence was accepted as verifying air-conditioning work');
  assert.equal(tdlrLicenceCoversVertical(electrical, 'electrical'), true);
});

test('a trade TDLR does not cover can never be satisfied by a TDLR licence', async () => {
  const { tdlrLicenceCoversVertical } = await import('../src/sources/adapters/txTdlr.js');
  const [licence] = parseTdlrResults(fixtures.TDLR_HVAC_RESULTS, 'AIR_CONDITIONING');
  assert.equal(tdlrLicenceCoversVertical(licence!, 'roofing'), false);
  assert.equal(tdlrLicenceCoversVertical(licence!, 'plumbing'), false,
    'Texas plumbing belongs to the plumbing board, not TDLR');
});

test('a filing with an agent and no officers yields the agent, and no invented people',
  () => {
    const record = parseSunbizDetail(fixtures.SUNBIZ_AGENT_ONLY)!;
    assert.equal(record.legalName, 'QUIET HOLDINGS LLC');
    assert.equal(record.authorizedPersons.length, 0,
      'people were manufactured for a filing that names none');
    assert.equal(record.registeredAgent?.name, 'COASTAL AGENT SERVICES INC');

    const people = sunbizPeople(record, 'ref');
    assert.equal(people.length, 1);
    assert.equal(people[0]!.relationship, 'REGISTERED_AGENT');
  });

test('an individually held licence names a person, not a company', () => {
  const licence = parseDbprDetail(fixtures.DBPR_INDIVIDUAL_LICENCE)!;
  assert.equal(licence.licenseeName, 'MARCUS ELLIS');
  assert.equal(licence.qualifyingAgent, null,
    'a qualifying agent was invented for a licence that names none');

  const people = dbprPeople(licence, 'ref');
  assert.equal(people.length, 1);
  assert.equal(people[0]!.personName, 'MARCUS ELLIS');
  assert.equal(people[0]!.relationship, 'LICENSE_HOLDER',
    'an individual licensee was promoted beyond holding a licence');
});

test('a business licence and an individual licence produce different people', () => {
  const business = parseDbprDetail(fixtures.DBPR_BUSINESS_LICENCE)!;
  const individual = parseDbprDetail(fixtures.DBPR_INDIVIDUAL_LICENCE)!;
  assert.ok(dbprPeople(business, 'r').some((person) => person.relationship === 'QUALIFIER'));
  assert.ok(!dbprPeople(individual, 'r').some((person) => person.relationship === 'QUALIFIER'));
});
