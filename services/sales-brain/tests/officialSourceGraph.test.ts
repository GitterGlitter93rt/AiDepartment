import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { parseDbprDetail, dbprPeople, dbprCandidate, licenceCoversVertical }
  from '../src/sources/adapters/flDbpr.js';
import { parseSunbizDetail, sunbizPeople, sunbizCandidate }
  from '../src/sources/adapters/flSunbiz.js';
import { decideMatch } from '../src/sources/match.js';
import type { SourceLookupContext } from '../src/sources/types.js';
import {
  decideLinkage, ownershipEstablished, recordAccountRelationship, relatedPhoneCaption,
} from '../src/sources/relationships.js';
import * as fixtures from './support/fixtures/sources/index.js';

/**
 * SB-V2-4 — what an official record establishes, and what it does not.
 *
 * The design case is real. A Florida HVAC company holds a certified air-conditioning
 * licence; the public record names the person who qualifies it. A public contractor
 * profile lists that same person, at that same address, for a second company, with a
 * phone number.
 *
 * Four wrong conclusions are available from those facts, and each of them would put a
 * rep in front of a company saying something untrue: that the two companies are one,
 * that the qualifier owns either of them, that the other company's phone reaches this
 * one, and that a shared address alone links anybody to anybody.
 *
 * The parsers and the matcher come from `feature/sales-brain-rep-enrichment`, where
 * they were built and qualified against sanitized fixtures of the real pages. The
 * relationship half is new, because nothing in the schema could say that two companies
 * are related and separate at the same time.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

/** The fixture company, as the account would carry it. */
const CONTEXT: SourceLookupContext = {
  accountId: '00000000-0000-0000-0000-000000000001',
  companyName: 'Kowalczyk Plumbing LLC',
  stateRegion: 'FL', city: 'St Augustine', postalCode: '32095',
  domain: null, verticalProfileId: 'plumbing', knownPhones: [],
  streetAddress: '120 Anastasia Blvd',
};

// ------------------------------------------------------------- what a record says

test('the qualifier on a licence is a qualifier and never an owner', () => {
  const licence = parseDbprDetail(fixtures.DBPR_BUSINESS_LICENCE);
  assert.ok(licence, 'the licence page did not parse');
  const people = dbprPeople(licence!, 'https://example.invalid/licence');

  const qualifier = people.find((person) => person.relationship === 'QUALIFIER');
  assert.ok(qualifier, 'the qualifying agent was not recorded at all');
  assert.equal(
    people.some((person) => person.relationship === 'OWNER'), false,
    'a regulatory role was promoted to ownership');
  assert.match(qualifier!.notes ?? '', /not evidence of ownership/);

  // And the rule that stops the promotion happening one layer up, too.
  assert.equal(ownershipEstablished({ relationship: 'QUALIFIER', rawTitle: 'Qualifying Agent' }),
    false);
  assert.equal(ownershipEstablished({ relationship: 'REGISTERED_AGENT', rawTitle: null }), false);
  assert.equal(ownershipEstablished({ relationship: 'OFFICER', rawTitle: 'Vice President' }), false);
  // The company's own words are a different matter.
  assert.equal(ownershipEstablished({ relationship: 'OTHER_BUSINESS_ROLE', rawTitle: 'Owner' }),
    true);
});

test('a registered agent is an agent, whatever the filing looks like', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_AGENT_ONLY);
  assert.ok(record);
  const people = sunbizPeople(record!, 'https://example.invalid/filing');
  const agent = people.find((person) => person.relationship === 'REGISTERED_AGENT');
  assert.ok(agent, 'the registered agent was not recorded');
  assert.equal(people.some((person) => person.relationship === 'OWNER'), false);
});

test('a licence for another trade does not verify this company', () => {
  const licence = parseDbprDetail(fixtures.DBPR_WRONG_TRADE_LICENCE);
  assert.ok(licence);
  assert.equal(licenceCoversVertical(licence!, 'plumbing'), false);
});

// ------------------------------------------------------ what identifies a company

test('a namesake in another city is not this company', () => {
  const licence = parseDbprDetail(fixtures.DBPR_BUSINESS_LICENCE);
  const candidate = dbprCandidate(licence!);
  const decision = decideMatch([{ ...candidate, city: 'Miami' }], CONTEXT);
  assert.notEqual(decision.status, 'MATCHED',
    'a company in another city was accepted on the strength of its name');
});

test('a name and a city together identify one record', () => {
  const record = parseSunbizDetail(fixtures.SUNBIZ_LLC_DETAIL);
  const decision = decideMatch([sunbizCandidate(record!)], CONTEXT);
  assert.equal(decision.status, 'MATCHED');
  assert.ok(decision.matchMethod, 'an acceptance was recorded without saying what agreed');
});

// -------------------------------------------------------------- what links two

test('one shared signal is not a link between two companies', () => {
  // A building has many tenants.
  const address = decideLinkage(['same_street_address']);
  assert.equal(address.linked, false);
  assert.match(address.reason, /many tenants|not a link/);

  // A name has many bearers.
  const person = decideLinkage(['same_exact_person']);
  assert.equal(person.linked, false);
});

test('a person and an address together are a link, and not a merge', () => {
  const decision = decideLinkage(['same_exact_person', 'same_street_address']);
  assert.equal(decision.linked, true);
  assert.equal(decision.confidence, 'MEDIUM');
  assert.equal(decision.basis, 'same_exact_person+same_street_address');
});

test('a licence number identifies an entity by itself', () => {
  const decision = decideLinkage(['same_license_number']);
  assert.equal(decision.linked, true);
  assert.equal(decision.confidence, 'MEDIUM');
});

// ------------------------------------------- the Sunbright pattern, end to end

test('two companies sharing a qualifier stay two companies with a link between them',
  async () => {
    const sunbright = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Sunbright HVAC LLC', website: 'https://sunbrightair.invalid',
      phone: '407-555-0111', city: 'Orlando', state: 'FL', postalCode: '32828',
      verticalProfileId: 'hvac',
    }, { discoverySource: 'import' }));
    const mrAc = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Mr AC of Orlando Inc', phone: '407-555-0199',
      city: 'Orlando', state: 'FL', postalCode: '32828',
    }, { discoverySource: 'import' }));

    assert.notEqual(sunbright.accountId, mrAc.accountId,
      'two entities sharing a person were resolved into one company');

    const result = await withTransaction((client) => recordAccountRelationship(client, {
      accountId: sunbright.accountId,
      relatedAccountId: mrAc.accountId,
      relatedName: 'Mr AC of Orlando Inc',
      relationshipType: 'RELATED_BUSINESS',
      signals: ['same_exact_person', 'same_street_address'],
      sourceReference: 'https://example.invalid/contractor-profile',
    }));
    assert.equal(result.written, true);
    assert.equal(result.confidence, 'MEDIUM');

    const { rows } = await query<{
      relationship_type: string; basis: string; confidence: string;
      related_account_id: string | null;
    }>(`select relationship_type, basis, confidence, related_account_id
          from account_relationships where account_id = $1`, [sunbright.accountId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.relationship_type, 'RELATED_BUSINESS');
    assert.equal(rows[0]!.basis, 'same_exact_person+same_street_address');
    assert.equal(rows[0]!.related_account_id, mrAc.accountId);

    // Both companies are still in inventory, unmerged.
    const { rows: accounts } = await query<{ n: number }>(
      `select count(*)::int as n from accounts where merged_into_account_id is null`);
    assert.equal(accounts[0]!.n, 2);
  });

test('a link that rests on one signal is refused and says why', async () => {
  const account = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Shared Address Air', phone: '407-555-0122',
    city: 'Orlando', state: 'FL', postalCode: '32828',
  }, { discoverySource: 'import' }));

  const result = await withTransaction((client) => recordAccountRelationship(client, {
    accountId: account.accountId,
    relatedName: 'Another Tenant LLC',
    relationshipType: 'RELATED_BUSINESS',
    signals: ['same_street_address'],
  }));

  assert.equal(result.written, false);
  assert.match(result.reason, /tenants/);
  const { rows } = await query<{ n: number }>(
    'select count(*)::int as n from account_relationships');
  assert.equal(rows[0]!.n, 0);
});

test('the database refuses a relationship that names only one thing that agreed',
  async () => {
    const account = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Constraint Air', phone: '407-555-0144',
    }, { discoverySource: 'import' }));

    await assert.rejects(
      () => query(
        `insert into account_relationships
           (account_id, related_name, relationship_type, basis)
         values ($1, 'Somebody Else LLC', 'RELATED_BUSINESS', 'same_street_address')`,
        [account.accountId]),
      /account_relationships_two_signals/,
      'a one-signal link could still be written straight into the table');
  });

test('a related business phone is never this company\'s line', () => {
  const caption = relatedPhoneCaption({
    e164: '+14075550199', relatedName: 'Mr AC of Orlando Inc',
    sourceReference: 'https://example.invalid/contractor-profile',
  });
  assert.match(caption, /related business/);
  assert.match(caption, /[Vv]erify/);
  // The words a rep must not read here.
  assert.equal(/direct line|main line|current company phone/i.test(caption), false);
});
