import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addressesMatch, classifySourceRole, isFirstParty, mayPromoteRole, nameMatchesDomain,
  provenanceForRole,
} from '../src/discovery/sourceRole.js';

/**
 * A URL that ranked is not a company's website.
 *
 * `classifyObservation` ended with a fallthrough: anything matching none of its shape
 * rules became OFFICIAL_SITE. 2,002 of production's 3,006 discovery candidates carry that
 * class, and among them are homeyou.com (a directory), uhaul.com (a moving company) and
 * myfloridalicense.com (a state licensing portal), all recorded as contractors' own
 * websites. Every V2 attempt to tell a directory from a contractor failed on this.
 *
 * Ownership is now a conclusion. These tests are mostly about what it refuses.
 */

test('ownership is never assumed from a URL that merely ranked', () => {
  // The exact shape of the old fallthrough: a domain, a plausible title, and nothing
  // whatever connecting it to the company we asked about.
  const verdict = classifySourceRole({
    url: 'https://homeyou.com/central-air-service-winter-park',
    title: 'Central Air Service - Winter Park HVAC Contractors - Homeyou',
    companyName: 'Central Air Service',
  });
  assert.equal(verdict.role, 'UNKNOWN');
  assert.equal(mayPromoteRole(verdict.role), false);
  assert.match(verdict.reasons.join(' '), /nothing here attributes this site/);
});

test('a licensing portal on a .com is still a licensing portal', () => {
  const verdict = classifySourceRole({
    url: 'https://www.myfloridalicense.com/intentions2.asp',
    title: 'Construction Industry – MyFloridaLicense.com',
    companyName: 'Some HVAC Co',
  });
  assert.equal(verdict.role, 'LICENSING_DATABASE');
  assert.equal(verdict.confidence, 'HIGH');
  assert.equal(mayPromoteRole(verdict.role), false);

  // And a real government host is government whatever it is serving.
  assert.equal(classifySourceRole({
    url: 'https://www.sos.state.tx.us/corp/', title: 'Business Filings' }).role, 'GOVERNMENT');
});

test('a domain carrying several businesses is serving other people\'s businesses', () => {
  // The rule that found theagentpages.com and nationalroofingdirectory.com without
  // anyone naming them. Three is the floor: two can be a company and its acquisition.
  const verdict = classifySourceRole({
    url: 'https://someplacenobodyhasheardof.com/hvac/tampa',
    title: 'HVAC Contractors in Tampa',
    companyName: 'Acme Air',
    distinctBusinessesOnDomain: 9,
  });
  assert.equal(verdict.role, 'DIRECTORY');
  assert.equal(verdict.confidence, 'HIGH');

  // Lead generation is a directory that also wants the visitor's details.
  const leadGen = classifySourceRole({
    url: 'https://quotesite.example-co/get-quotes/hvac',
    title: 'HVAC quotes',
    bodyText: 'Get free quotes from top pros near you. Get matched with a contractor today.',
    distinctBusinessesOnDomain: 12,
  });
  assert.equal(leadGen.role, 'LEAD_GEN_DIRECTORY');
});

test('a real company is recognised from evidence, not from ranking', () => {
  // The cheapest strong signal and the one that is nearly always available.
  const byName = classifySourceRole({
    url: 'https://coolairtampa.com/', title: 'AC Repair Tampa | Cool Air Tampa',
    companyName: 'Cool Air Tampa',
  });
  assert.equal(byName.role, 'COMPANY_OWNED_SITE');
  assert.equal(byName.confidence, 'HIGH');
  assert.equal(isFirstParty(byName.role), true);
  assert.equal(mayPromoteRole(byName.role), true);

  // A phone we already knew, published on the page, is independent corroboration.
  const byPhone = classifySourceRole({
    url: 'https://somethingelseentirely.com/', title: 'Home',
    companyName: 'Boeschen Heating', companyPhone: '(813) 555-0142',
    publishedPhones: ['813-555-0142'],
  });
  assert.equal(byPhone.role, 'COMPANY_OWNED_SITE');
  assert.match(byPhone.reasons.join(' '), /known phone is published/);

  // And so is an address.
  const byAddress = classifySourceRole({
    url: 'https://nothinglikethename.com/', title: 'Welcome',
    companyName: 'Marsh Point Air', companyAddress: '29851 Co Rd 49, Loxley, AL',
    publishedAddresses: ['29851 County Road 49, Loxley, AL 36551'],
  });
  assert.equal(byAddress.role, 'COMPANY_OWNED_SITE');
});

test('two supporting signals stand in for one strong one, and one does not', () => {
  const one = classifySourceRole({
    url: 'https://unrelated.example-co/', title: 'Home',
    companyName: 'Some Company', canonicalUrl: 'https://unrelated.example-co/',
  });
  assert.equal(one.role, 'UNKNOWN', 'a self-canonical URL proves only that a page exists');

  const two = classifySourceRole({
    url: 'https://unrelated.example-co/', title: 'Home',
    companyName: 'Some Company', canonicalUrl: 'https://unrelated.example-co/',
    sameOriginPaths: ['/about-us', '/contact'],
    distinctBusinessesOnDomain: 1,
  });
  assert.equal(two.role, 'COMPANY_OWNED_SITE');
  assert.equal(two.confidence, 'MEDIUM', 'and it says it is the weaker kind of yes');
});

test('which page of theirs it is', () => {
  const base = { companyName: 'Cool Air Tampa' };
  assert.equal(classifySourceRole({ ...base, url: 'https://coolairtampa.com/' }).role,
    'COMPANY_OWNED_SITE');
  assert.equal(classifySourceRole({ ...base, url: 'https://coolairtampa.com/locations/brandon' }).role,
    'COMPANY_LOCATION_PAGE');
  assert.equal(classifySourceRole({ ...base, url: 'https://coolairtampa.com/services/ac-repair' }).role,
    'COMPANY_SERVICE_PAGE');
  assert.equal(classifySourceRole({ ...base, url: 'https://coolairtampa.com/blog/spring-tune-up' }).role,
    'COMPANY_BLOG_PAGE');

  // A blog post on a contractor's own site is still their site, and is still not the
  // page that identifies the company. A rep sent to it would be reading an article.
  assert.equal(isFirstParty('COMPANY_BLOG_PAGE'), true);
  assert.equal(mayPromoteRole('COMPANY_BLOG_PAGE'), false);
});

test('two written addresses are the same place, or they are not', () => {
  // Deleting abbreviations left "29851 co 49 loxley al" and "29851 county 49 loxley al
  // 36551" sharing a house number and disagreeing about everything else, so a real
  // ownership signal disappeared. Expanding them is what makes them comparable.
  assert.equal(addressesMatch('29851 Co Rd 49, Loxley, AL',
    '29851 County Road 49, Loxley, AL 36551'), true);
  assert.equal(addressesMatch('120 N Main St, Tampa FL',
    '120 North Main Street, Suite 4, Tampa, FL 33602'), true);
  // A different house number on the same street is a different place.
  assert.equal(addressesMatch('118 North Main Street, Tampa FL',
    '120 North Main Street, Tampa FL'), false);
  // And the same number on a different street is not a match either.
  assert.equal(addressesMatch('120 Oak Avenue, Tampa FL',
    '120 North Main Street, Tampa FL'), false);
});

test('a name and a domain agree, or they do not', () => {
  assert.equal(nameMatchesDomain('High Tide Roofing & Waterproofing, Inc', 'hightideroofing.com'), true);
  assert.equal(nameMatchesDomain('Airco Service', 'aircoservice.com'), true);
  assert.equal(nameMatchesDomain('Southern Air', 'southernair.net'), true);
  assert.equal(nameMatchesDomain('Central Air Service', 'homeyou.com'), false);
  assert.equal(nameMatchesDomain('Some HVAC Co', 'myfloridalicense.com'), false);
  // A short fragment must not marry two unrelated businesses.
  assert.equal(nameMatchesDomain('AC', 'acmecorporation.com'), false);
  assert.equal(nameMatchesDomain(null, 'anything.com'), false);
});

test('social, video and forum sources are themselves, not companies', () => {
  assert.equal(classifySourceRole({ url: 'https://www.facebook.com/coolairtampa' }).role,
    'SOCIAL_PROFILE');
  assert.equal(classifySourceRole({ url: 'https://www.youtube.com/watch?v=abc' }).role, 'VIDEO');
  assert.equal(classifySourceRole({ url: 'https://www.reddit.com/r/hvac/comments/x' }).role, 'FORUM');
  for (const role of ['SOCIAL_PROFILE', 'VIDEO', 'FORUM'] as const) {
    assert.equal(mayPromoteRole(role), false);
  }
});

test('how a fact reached us is recorded apart from which page it is on', () => {
  // A snippet is Google's summary of a page. Opening the page is a different act with a
  // different reliability, and a record that cannot tell them apart cannot answer
  // whether paying to open pages was worth it.
  assert.equal(provenanceForRole('COMPANY_OWNED_SITE', false), 'GOOGLE_SNIPPET_ONLY');
  assert.equal(provenanceForRole('COMPANY_OWNED_SITE', true), 'OFFICIAL_COMPANY_SITE');
  assert.equal(provenanceForRole('DIRECTORY', true), 'BUSINESS_DIRECTORY');
  assert.equal(provenanceForRole('LICENSING_DATABASE', true), 'GOVERNMENT_OR_LICENSE_SOURCE');
  assert.equal(provenanceForRole('SOCIAL_PROFILE', true), 'PUBLIC_PROFESSIONAL_PROFILE');
  assert.equal(provenanceForRole('UNKNOWN', true), 'OPENED_SOURCE_PAGE');
});

test('a directory saying something about a company is not the company saying it', () => {
  // The rule that survives into every downstream use: first-party is a property of the
  // source, and a directory never has it however accurate its content happens to be.
  for (const role of ['DIRECTORY', 'LEAD_GEN_DIRECTORY', 'NEWS_OR_PUBLISHER',
    'GOVERNMENT', 'LICENSING_DATABASE', 'MARKETPLACE', 'AGGREGATOR', 'UNKNOWN'] as const) {
    assert.equal(isFirstParty(role), false, `${role} is not first-party`);
  }
});
