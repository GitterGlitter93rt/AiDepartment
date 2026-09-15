import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideMatch, corroborate, isDistinctiveName } from '../src/sources/match.js';
import type { MatchCandidate } from '../src/sources/match.js';
import { licensingRequirement, licenceGapIsMeaningful } from '../src/sources/requirements.js';
import { governanceFor, liveCallsPermitted, availabilityFor, SOURCE_GOVERNANCE }
  from '../src/sources/governance.js';
import type { SourceLookupContext } from '../src/sources/types.js';

/**
 * Identity is the whole risk.
 *
 * Every other defect in enrichment shows a rep something unhelpful. This one shows
 * them another company's officers, licence and registered agent as established fact
 * about the prospect they are about to call -- and they will use it, because it
 * looks exactly like the real thing.
 */

function context(overrides: Partial<SourceLookupContext> = {}): SourceLookupContext {
  return {
    accountId: 'acct-1',
    companyName: 'Kowalczyk Plumbing LLC',
    stateRegion: 'FL',
    city: 'St. Augustine',
    postalCode: '32095',
    domain: 'kowalczykplumbing.com',
    verticalProfileId: 'plumbing',
    knownPhones: ['+19045551212'],
    streetAddress: '120 Anastasia Blvd',
    ...overrides,
  };
}

// --------------------------------------------------------- name is not identity --

test('a name match with nothing else behind it is not an identification', () => {
  // Two companies, same trade name, different cities. This is the ordinary case in
  // any state register, not an exotic one.
  const candidates: MatchCandidate[] = [
    { name: 'Plumbing Services Company', reference: 'doc/1', city: null, stateRegion: null },
  ];
  const decision = decideMatch(candidates, context({
    companyName: 'Plumbing Services Company', city: null, postalCode: null,
    domain: null, knownPhones: [], streetAddress: null, stateRegion: null }));
  assert.equal(decision.status, 'AMBIGUOUS',
    'a generic name with no corroboration was accepted as this company');
  assert.equal(decision.selected, null);
});

test('two records of the same name cannot be told apart, so neither is chosen', () => {
  const candidates: MatchCandidate[] = [
    { name: 'Kowalczyk Plumbing LLC', reference: 'doc/1', city: 'St. Augustine', stateRegion: 'FL' },
    { name: 'Kowalczyk Plumbing, L.L.C.', reference: 'doc/2', city: 'St. Augustine', stateRegion: 'FL' },
  ];
  const decision = decideMatch(candidates, context());
  assert.equal(decision.status, 'AMBIGUOUS');
  assert.equal(decision.selected, null, 'one of two indistinguishable records was picked');
  assert.match(decision.reason, /cannot be told apart/);
});

test('a distinctive name that is the only record of its name is accepted', () => {
  const candidates: MatchCandidate[] = [
    { name: 'Kowalczyk Plumbing LLC', reference: 'doc/1' },
  ];
  const decision = decideMatch(candidates, context({
    city: null, postalCode: null, domain: null, knownPhones: [], streetAddress: null,
    stateRegion: null }));
  assert.equal(decision.status, 'MATCHED');
  assert.equal(decision.matchMethod, 'distinctive_name_sole_result');
});

test('a conflicting city disqualifies a record however well the name matches', () => {
  const candidates: MatchCandidate[] = [
    { name: 'Kowalczyk Plumbing LLC', reference: 'doc/1', city: 'Miami', stateRegion: 'FL' },
  ];
  const decision = decideMatch(candidates, context());
  assert.notEqual(decision.status, 'MATCHED',
    'a company in another city was attached on the strength of its name');
  assert.match(decision.considered[0]!.why, /city/);
});

test('a conflicting state disqualifies a record', () => {
  const candidates: MatchCandidate[] = [
    { name: 'Kowalczyk Plumbing LLC', reference: 'doc/1', stateRegion: 'TX' },
  ];
  const decision = decideMatch(candidates, context());
  assert.notEqual(decision.status, 'MATCHED');
});

test('corroboration by address, phone or domain accepts the right record', () => {
  for (const [label, candidate] of Object.entries({
    address: { name: 'Kowalczyk Plumbing LLC', reference: 'd', streetAddress: '120 Anastasia Blvd Ste 4' },
    phone: { name: 'Kowalczyk Plumbing LLC', reference: 'd', phones: ['(904) 555-1212'] },
    domain: { name: 'Kowalczyk Plumbing LLC', reference: 'd', domain: 'www.kowalczykplumbing.com' },
  } satisfies Record<string, MatchCandidate>)) {
    const decision = decideMatch([candidate], context({
      city: null, postalCode: null, stateRegion: null }));
    assert.equal(decision.status, 'MATCHED', `${label} failed to corroborate`);
  }
});

test('absence is not disagreement', () => {
  // A register record with no phone does not conflict with a company that has one.
  const { conflicts } = corroborate(
    { name: 'X', reference: null, phones: [] }, context());
  assert.deepEqual(conflicts, []);
});

test('no record with this name is a finding, not an ambiguity', () => {
  const decision = decideMatch(
    [{ name: 'Totally Different Roofing', reference: 'doc/9' }], context());
  assert.equal(decision.status, 'NO_MATCH');
  assert.match(decision.reason, /none whose name matches/);
});

test('legal-form differences do not make two names different', () => {
  assert.equal(
    decideMatch([{ name: 'Kowalczyk Plumbing, Inc.', reference: 'd', city: 'St. Augustine',
      stateRegion: 'FL' }], context()).status,
    'MATCHED');
});

test('a DBA on the record matches the brand we hold', () => {
  const decision = decideMatch([{
    name: 'KP HOLDINGS LLC', reference: 'd', city: 'St. Augustine', stateRegion: 'FL',
    alternateNames: ['Kowalczyk Plumbing'],
  }], context());
  assert.equal(decision.status, 'MATCHED', 'a DBA relationship was not honoured');
});

test('a generic trade name is never distinctive', () => {
  assert.equal(isDistinctiveName('Plumbing Services LLC'), false);
  assert.equal(isDistinctiveName('Air Conditioning and Heating Co'), false);
  assert.equal(isDistinctiveName('Kowalczyk Plumbing'), true);
});

// ------------------------------------------- what the state does and does not do --

test('Texas roofing has no statewide licence, and that is not a gap', () => {
  const requirement = licensingRequirement('TX', 'roofing');
  assert.equal(requirement.scope, 'NONE');
  assert.equal(licenceGapIsMeaningful('TX', 'roofing'), false,
    'every roofer in Texas would be flagged for lacking a licence that does not exist');
});

test('Florida roofing does have a statewide licence', () => {
  assert.equal(licensingRequirement('FL', 'roofing').scope, 'STATEWIDE');
  assert.equal(licenceGapIsMeaningful('FL', 'roofing'), true);
});

test('Texas plumbing and HVAC route to their real authorities', () => {
  assert.equal(licensingRequirement('TX', 'plumbing').sourceId, 'tx_tsbpe');
  assert.equal(licensingRequirement('TX', 'hvac').sourceId, 'tx_tdlr');
});

test('an unestablished state/trade pair stays UNKNOWN rather than guessing', () => {
  const requirement = licensingRequirement('TX', 'med-spas');
  assert.equal(requirement.scope, 'UNKNOWN');
  assert.equal(licenceGapIsMeaningful('TX', 'med-spas'), false,
    'an unknown licensing regime was counted against the company');
});

test('a missing state or vertical never produces a requirement', () => {
  assert.equal(licensingRequirement(null, 'plumbing').scope, 'UNKNOWN');
  assert.equal(licensingRequirement('FL', null).scope, 'UNKNOWN');
});

// ------------------------------------------------------------------ governance --

test('SOSDirect is paid and can never be switched on', () => {
  const governance = governanceFor('tx_sosdirect')!;
  assert.equal(governance.paid, true);
  assert.equal(governance.status, 'DISABLED_PAID_SOURCE');
  assert.equal(governance.enableFlag, null, 'a paid source was given an enable flag');
  assert.equal(liveCallsPermitted('tx_sosdirect', {} as NodeJS.ProcessEnv), false);
  // Not even an env var of the obvious name can turn it on.
  assert.equal(
    liveCallsPermitted('tx_sosdirect', { SOURCE_TX_SOSDIRECT_ENABLED: 'true' } as NodeJS.ProcessEnv),
    false, 'a paid source was enabled by an environment variable');
});

test('a blocked source cannot be flagged on either', () => {
  assert.equal(
    liveCallsPermitted('fl_sunbiz', { SOURCE_FL_SUNBIZ_ENABLED: 'true' } as NodeJS.ProcessEnv),
    false, 'a source that refuses automation was enabled by a flag');
  assert.equal(availabilityFor('fl_sunbiz', {} as NodeJS.ProcessEnv), 'BLOCKED');
});

test('a feature-flagged source is off until its flag is set', () => {
  assert.equal(liveCallsPermitted('tx_comptroller', {} as NodeJS.ProcessEnv), false);
  assert.equal(availabilityFor('tx_comptroller', {} as NodeJS.ProcessEnv), 'FEATURE_FLAGGED');
  const enabled = { SOURCE_TX_COMPTROLLER_ENABLED: 'true' } as NodeJS.ProcessEnv;
  assert.equal(liveCallsPermitted('tx_comptroller', enabled), true);
  assert.equal(availabilityFor('tx_comptroller', enabled), 'LIVE');
});

test('every governed source declares what it reads and what happens when it fails', () => {
  for (const governance of SOURCE_GOVERNANCE) {
    assert.ok(governance.businessPurpose.length > 20, `${governance.sourceId}: no purpose`);
    assert.ok(governance.failureBehaviour.length > 10, `${governance.sourceId}: no failure behaviour`);
    assert.ok(governance.statusReason.length > 20, `${governance.sourceId}: no status reason`);
    assert.ok(governance.publicUrl.startsWith('https://'), `${governance.sourceId}: no source URL`);
  }
});

test('TDLR governance records the robots restriction it must respect', () => {
  const governance = governanceFor('tx_tdlr')!;
  assert.match(governance.bulkStrategy, /robots/i);
  assert.match(governance.bulkStrategy, /csv/i,
    'the CSV disallow that robots.txt states was not written down anywhere');
});
