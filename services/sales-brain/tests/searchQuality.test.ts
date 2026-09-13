import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { upsertAccount, upsertEndpoint } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { globalSearch } from '../src/api/waveDQueries.js';

/**
 * Global search, from a rep's point of view.
 * Authority: yad-sales-crm-component-contract.v1.yaml TopUtilityBar
 * (search_results_link_to_canonical_account_or_contact_context).
 *
 * A rep types whatever they have: half a company name, a number from a missed call,
 * the ZIP they are working, the name of the person who answered. Every one of those
 * has to land on the canonical Account, and a term that is not a search must not
 * behave like one.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

let sequence = 0;

async function seed(input: {
  name: string; city?: string; postalCode?: string; phone?: string; domain?: string;
  contact?: string; email?: string; dba?: string[];
}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction(async (client) => {
    const result = await upsertAccount(client, {
      canonicalName: input.name,
      website: input.domain ?? `https://${input.name.toLowerCase().replace(/\W+/g, '')}.invalid`,
      phone: input.phone ?? `904-555-${String(3000 + sequence).slice(-4)}`,
      city: input.city ?? 'Jacksonville', state: 'FL',
      postalCode: input.postalCode ?? '32256',
      contactName: input.contact ?? null,
    }, { discoverySource: 'search-test' });
    if (input.email) {
      await upsertEndpoint(client, {
        accountId: result.accountId, contactId: null, locationId: null, type: 'EMAIL',
        rawValue: input.email, endpointRole: 'GENERAL_BUSINESS_EMAIL',
        relationshipToPerson: 'ROLE_INBOX', qualityState: 'PUBLIC_OBSERVED_CURRENT',
        source: 'COMPANY_WEBSITE', sourceReference: null, verifiedAt: null,
      });
    }
    return result;
  });
  if (input.dba) {
    await query('update accounts set dba_names = $2 where account_id = $1',
      [accountId, input.dba]);
  }
  return accountId;
}

// --- the things a rep types ------------------------------------------------------

test('an exact company name ranks above a partial one', async () => {
  await seed({ name: 'Coastal Air' });
  await seed({ name: 'Coastal Air and Heating Services' });
  await seed({ name: 'Southside Coastal Plumbing' });

  const hits = await globalSearch('coastal air');
  assert.ok(hits.length >= 2);
  assert.equal(hits[0]!.companyName, 'Coastal Air', 'the exact name did not rank first');
  assert.equal(hits[0]!.matchedOn, 'Company');
});

test('a partial name finds the company', async () => {
  await seed({ name: 'Northgate Air & Heat LLC' });
  for (const term of ['northgate', 'Northgate Air', 'air & heat', 'HEAT LLC']) {
    const hits = await globalSearch(term);
    assert.ok(hits.some((hit) => hit.companyName === 'Northgate Air & Heat LLC'),
      `"${term}" did not find the company`);
  }
});

test('a phone number is found however it is typed', async () => {
  await seed({ name: 'Phone Search Co', phone: '904-555-0142' });
  for (const term of ['9045550142', '(904) 555-0142', '904.555.0142', '555-0142', '5550142']) {
    const hits = await globalSearch(term);
    assert.ok(hits.some((hit) => hit.companyName === 'Phone Search Co'),
      `"${term}" did not find the number`);
  }
});

test('a phone fragment shorter than a line number is not a search', async () => {
  await seed({ name: 'Area Code Co', phone: '904-555-0150' });
  // Three digits is an area code: matching on it would return the whole city.
  const hits = await globalSearch('904');
  assert.equal(hits.some((hit) => hit.matchedOn === 'Phone'), false,
    'an area code matched as a phone number');
});

test('an email finds the company', async () => {
  await seed({ name: 'Email Search Co', email: 'office@emailsearch.invalid' });
  const exact = await globalSearch('office@emailsearch.invalid');
  assert.equal(exact[0]!.companyName, 'Email Search Co');
  assert.equal(exact[0]!.matchedOn, 'Email');
  const partial = await globalSearch('emailsearch.invalid');
  assert.ok(partial.some((hit) => hit.companyName === 'Email Search Co'));
});

test('a contact name finds their company', async () => {
  await seed({ name: 'Person Search Co', contact: 'Ray Alvarez' });
  const hits = await globalSearch('Alvarez');
  assert.equal(hits[0]!.companyName, 'Person Search Co');
  assert.equal(hits[0]!.matchedOn, 'Person');
});

test('a ZIP finds the companies in it', async () => {
  // This found nothing at all before: postal_code was not searched.
  await seed({ name: 'In The Patch One', postalCode: '32256' });
  await seed({ name: 'In The Patch Two', postalCode: '32256' });
  await seed({ name: 'Somewhere Else', postalCode: '32224' });

  const hits = await globalSearch('32256');
  const names = hits.map((hit) => hit.companyName);
  assert.ok(names.includes('In The Patch One'), 'a ZIP did not find its companies');
  assert.ok(names.includes('In The Patch Two'));
  assert.equal(names.includes('Somewhere Else'), false, 'a ZIP matched another ZIP');
  assert.equal(hits[0]!.matchedOn, 'ZIP');
});

test('a city finds the companies in it', async () => {
  await seed({ name: 'City Search Co', city: 'Ponte Vedra Beach', postalCode: '32082' });
  const hits = await globalSearch('Ponte Vedra');
  assert.ok(hits.some((hit) => hit.companyName === 'City Search Co'));
});

test('a domain finds the company', async () => {
  await seed({ name: 'Domain Search Co', domain: 'https://domainsearch.invalid' });
  const hits = await globalSearch('domainsearch');
  assert.ok(hits.some((hit) => hit.companyName === 'Domain Search Co'));
});

test('the name on the van finds the company on the incorporation', async () => {
  await seed({ name: 'Alvarez Holdings LLC', dba: ['Coastal Comfort Air'] });
  const hits = await globalSearch('Coastal Comfort');
  assert.equal(hits[0]!.companyName, 'Alvarez Holdings LLC');
  assert.equal(hits[0]!.matchedOn, 'Also known as');
});

test('an open opportunity is findable by its title', async () => {
  const rep = await makeUser('Opportunity Search Rep');
  const accountId = await seed({ name: 'Opportunity Search Co' });
  await claimAccount(accountId, rep);
  await query(
    `insert into opportunities (account_id, owner_user_id, title, stage, problem_summary,
                                source_channel)
     values ($1, $2, 'Winter maintenance programme', 'DISCOVERY',
             'They lose calls every afternoon while the crew is out on jobs.', 'human_rep')`,
    [accountId, rep.userId]);

  const hits = await globalSearch('winter maintenance');
  assert.equal(hits[0]!.companyName, 'Opportunity Search Co');
  assert.equal(hits[0]!.matchedOn, 'Opportunity');
});

test('punctuation and case do not matter', async () => {
  await seed({ name: "O'Donnell & Sons Roofing" });
  for (const term of ["o'donnell", "O'DONNELL", "Donnell & Sons", '& sons roofing']) {
    const hits = await globalSearch(term);
    assert.ok(hits.some((hit) => hit.companyName === "O'Donnell & Sons Roofing"),
      `"${term}" did not find the company`);
  }
});

// --- the searcher's own book -----------------------------------------------------

test('a rep’s own Account outranks a namesake they do not own', async () => {
  const rep = await makeUser('Ranking Rep');
  const other = await makeUser('Other Rep');
  // Distinct websites, or the identity resolver would correctly treat these as one
  // company: two namesakes are only two companies if something says so.
  const mine = await seed({
    name: 'Summit Roofing', city: 'Jacksonville', domain: 'https://summitroofingjax.invalid' });
  const theirs = await seed({
    name: 'Summit Roofing', city: 'Orange Park', postalCode: '32073',
    domain: 'https://summitroofingop.invalid' });
  assert.notEqual(mine, theirs, 'the fixture produced one Account, not two namesakes');
  await claimAccount(theirs, other);
  await claimAccount(mine, rep);

  const hits = await globalSearch('Summit Roofing', 25, { userId: rep.userId });
  assert.equal(hits[0]!.accountId, mine,
    'a rep had to read past a namesake to find the one they own');
  assert.equal(hits[0]!.ownerName, 'Ranking Rep');
});

// --- what search must not do ------------------------------------------------------

test('a wildcard character is a character, not a wildcard', async () => {
  for (let i = 0; i < 12; i += 1) await seed({ name: `Wildcard Co ${i}` });

  // These matched every Account in the database and took ten times as long as a real
  // search. On a shared box that is a cheap way to make the CRM slow for everyone.
  for (const term of ['%%', '%', '_o', 'a%', '%_%', '\\']) {
    const hits = await globalSearch(term);
    assert.equal(hits.length, 0, `"${term}" returned ${hits.length} hits`);
  }

  // And a literal percent in a company name is still findable.
  await seed({ name: '100% Comfort Heating' });
  const literal = await globalSearch('100%');
  assert.ok(literal.some((hit) => hit.companyName === '100% Comfort Heating'),
    'escaping broke a genuine percent sign in a name');
});

test('a term too short to mean anything returns nothing', async () => {
  await seed({ name: 'Short Term Co' });
  for (const term of ['', ' ', 'a', 'S']) {
    assert.deepEqual(await globalSearch(term), [], `"${term}" returned hits`);
  }
});

test('a suppressed company is findable and marked, never silently hidden', async () => {
  const accountId = await seed({ name: 'Suppressed Search Co' });
  await query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'Asked to be removed.')`, [accountId]);

  const hits = await globalSearch('Suppressed Search');
  const hit = hits.find((row) => row.accountId === accountId);
  assert.ok(hit, 'a suppressed company vanished from search, so a rep could rediscover it');
  assert.equal(hit!.isSuppressed, true, 'the hit does not say it is suppressed');
});

test('a suppressed company ranks below one a rep can work', async () => {
  const suppressed = await seed({ name: 'Ranked Air Suppressed' });
  await seed({ name: 'Ranked Air Workable' });
  await query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'Asked to be removed.')`, [suppressed]);

  const hits = await globalSearch('Ranked Air');
  assert.equal(hits[0]!.isSuppressed, false, 'the suppressed company ranked first');
});

test('every hit resolves to a canonical Account', async () => {
  const accountId = await seed({
    name: 'Canonical Co', contact: 'Dana Whitfield', email: 'office@canonical.invalid',
    phone: '904-555-0199', postalCode: '32256',
  });
  const terms = ['Canonical', 'Whitfield', 'office@canonical.invalid', '9045550199', '32256'];
  for (const term of terms) {
    const hits = await globalSearch(term);
    const hit = hits.find((row) => row.accountId === accountId);
    assert.ok(hit, `"${term}" did not resolve to the Account`);
    assert.equal(hit!.companyName, 'Canonical Co');
    assert.ok(hit!.matchedOn, 'a hit does not say why it matched');
    assert.ok(hit!.matchedValue, 'a hit does not show what matched');
  }
});

test('one Account appears once however many ways it matched', async () => {
  await seed({
    name: 'Repeated Match Co', contact: 'Repeated Match Person',
    email: 'repeated@repeatedmatch.invalid', domain: 'https://repeatedmatch.invalid',
  });
  const hits = await globalSearch('repeatedmatch');
  const ids = hits.map((hit) => hit.accountId);
  assert.equal(new Set(ids).size, ids.length, 'one Account was listed more than once');
});

test('search never invents a company that does not exist', async () => {
  await seed({ name: 'The Only Company' });
  assert.deepEqual(await globalSearch('nonexistent business name'), []);
  assert.deepEqual(await globalSearch('zzzzzzzz'), []);
});
