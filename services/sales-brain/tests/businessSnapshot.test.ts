import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount, recordEvidence } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase, markEntityVerified } from './helpers.js';
import { buildBusinessSnapshot, claimKindOf, officialPersonHighlight }
  from '../src/domain/businessSnapshot.js';
import { researchPictureFor } from '../src/domain/researchFacts.js';
import type { DetailEvidence } from '../src/domain/accountDetail.js';

/**
 * What a rep is shown, and how sure we say we are.
 *
 * The failure this guards against is subtle and expensive: a company's own marketing
 * copy rendered in the same typeface as a state record, so a rep reads "licensed and
 * insured" off a footer and repeats it as though somebody checked.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

function evidence(overrides: Partial<DetailEvidence> = {}): DetailEvidence {
  return {
    evidence_id: `e${++sequence}`, category: 'official_record',
    claim_key: 'entity_status', claim_text: 'Florida entity status: ACTIVE.',
    normalized_value: 'ACTIVE', confidence: 'confirmed', can_state_as_fact: true,
    source_type: 'public_registry', source_reference: 'https://example.invalid/rec',
    observed_at: new Date(), expires_at: null, is_expired: false, ...overrides,
  };
}

test('an official record is a fact and a marketing claim is not', () => {
  assert.equal(claimKindOf(evidence()), 'FACT');
  assert.equal(claimKindOf(evidence({
    category: 'company_profile', claim_key: 'licensed_and_insured_claim',
    source_type: 'first_party',
  })), 'OBSERVATION',
  'a claim on the company’s own site was presented as a verified fact');
});

test('the snapshot separates official records from what the company says', () => {
  const sections = buildBusinessSnapshot({
    evidence: [
      evidence(),
      evidence({ claim_key: 'family_owned', category: 'company_profile',
        source_type: 'first_party', normalized_value: 'yes',
        claim_text: 'Describes itself as family owned.' }),
    ],
    stateRegion: 'FL', verticalProfileId: 'plumbing',
  });
  const official = sections.find((section) => section.id === 'official')!;
  const profile = sections.find((section) => section.id === 'profile')!;
  assert.equal(official.items[0]!.kind, 'FACT');
  assert.equal(profile.items[0]!.kind, 'OBSERVATION');
});

test('a Texas roofer is not shown a licence gap that does not exist', () => {
  const sections = buildBusinessSnapshot({
    evidence: [], stateRegion: 'TX', verticalProfileId: 'roofing' });
  const licensing = sections.find((section) => section.id === 'licensing')!;
  assert.equal(licensing.items.length, 0);
  assert.match(licensing.emptyNote, /does not license roofing contractors statewide/i);
  assert.doesNotMatch(licensing.emptyNote, /gap worth checking/i,
    'a state that issues no licence was described as a missing credential');
});

test('a Florida roofer with no licence match is told it is worth checking', () => {
  const sections = buildBusinessSnapshot({
    evidence: [], stateRegion: 'FL', verticalProfileId: 'roofing' });
  const licensing = sections.find((section) => section.id === 'licensing')!;
  assert.match(licensing.emptyNote, /gap worth checking, not a confirmed absence/i);
});

test('expired evidence is marked stale rather than dropped', () => {
  const sections = buildBusinessSnapshot({
    evidence: [evidence({ is_expired: true })],
    stateRegion: 'FL', verticalProfileId: 'plumbing' });
  const item = sections.find((section) => section.id === 'official')!.items[0]!;
  assert.equal(item.stale, true, 'aged evidence lost its staleness marker');
  assert.equal(item.value, 'ACTIVE', 'aged evidence was discarded rather than dated');
});

test('only the newest reading of a claim is shown', () => {
  const older = evidence({ normalized_value: 'INACTIVE',
    observed_at: new Date(Date.now() - 86_400_000 * 30) });
  const newer = evidence({ normalized_value: 'ACTIVE', observed_at: new Date() });
  const sections = buildBusinessSnapshot({
    evidence: [older, newer], stateRegion: 'FL', verticalProfileId: 'plumbing' });
  const items = sections.find((section) => section.id === 'official')!.items
    .filter((item) => item.label === 'Entity status');
  assert.equal(items.length, 1, 'an account page became a changelog');
  assert.equal(items[0]!.value, 'ACTIVE');
});

test('the highlighted official person keeps the role the record gives them', () => {
  const highlight = officialPersonHighlight([
    evidence({ claim_key: 'responsible_master_plumber', normalized_value: 'JORDAN OKAFOR',
      claim_text: 'JORDAN OKAFOR is the Responsible Master Plumber on record.' }),
  ])!;
  assert.equal(highlight.label, 'Responsible Master Plumber');
  assert.notEqual(highlight.label, 'Owner');
});

// ------------------------------------------------- the fact model dimensions --

async function seed(state: string, vertical: string): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Snapshot Co ${sequence}`,
    website: `https://snap${sequence}.invalid`,
    phone: `512-555-${String(2000 + sequence).slice(-4)}`,
    city: state === 'TX' ? 'Austin' : 'St Augustine', state,
    postalCode: state === 'TX' ? '78701' : '32095',
    verticalProfileId: vertical,
  }, { discoverySource: 'market_miner:test' }));
  await markEntityVerified(accountId);
  return accountId;
}

test('Texas roofing has no licence dimension at all', async () => {
  const accountId = await seed('TX', 'roofing');
  const picture = await researchPictureFor(accountId);
  assert.ok(!picture.facts.some((fact) => fact.key === 'license_verified'),
    'a Texas roofer was scored against a licence Texas does not issue');
});

test('Florida roofing does have a licence dimension', async () => {
  const accountId = await seed('FL', 'roofing');
  const picture = await researchPictureFor(accountId);
  assert.ok(picture.facts.some((fact) => fact.key === 'license_verified'),
    'a Florida roofer was not checked against a licence Florida requires');
});

test('a verified entity answers "are they real"', async () => {
  const accountId = await seed('TX', 'plumbing');
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'official_record', claimKey: 'entity_right_to_transact',
    claimText: 'Right to transact business in Texas: ACTIVE.',
    normalizedValue: 'ACTIVE', confidence: 'confirmed', canStateAsFact: true,
    sourceType: 'public_registry', sourceProvider: 'tx_comptroller',
    sourceReference: 'https://example.invalid/coa',
    expiresAt: new Date(Date.now() + 86_400_000 * 90), precedenceRank: 1,
  }));
  const picture = await researchPictureFor(accountId);
  const fact = picture.facts.find((entry) => entry.key === 'official_entity')!;
  assert.equal(fact.state, 'YES');
  assert.equal(fact.canStateAsFact, true);
});

test('an unchecked register is not a company that failed a check', async () => {
  const accountId = await seed('FL', 'plumbing');
  const picture = await researchPictureFor(accountId);
  const fact = picture.facts.find((entry) => entry.key === 'official_entity')!;
  assert.notEqual(fact.state, 'NO',
    'never having looked at the register was reported as a negative finding');
});
