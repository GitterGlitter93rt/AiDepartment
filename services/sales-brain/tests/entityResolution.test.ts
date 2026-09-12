import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyObservation, registrableDomain } from '../src/discovery/sourceClass.js';
import { resolveCandidates, looksLikeCompanyName, brandMatchesDomain,
         type CandidateObservation } from '../src/discovery/resolve.js';

/**
 * The failure corpus from the first real canary, as fixtures.
 *
 * Roofing / 32095 produced 65 Accounts from one search. Nineteen were not companies
 * at all and every one of the 65 was named after a SERP result title. These are the
 * shapes that produced them. No network, no provider, no scraping: the structures are
 * reproduced, which is what the rules actually read.
 */

let rank = 0;
function row(input: Partial<CandidateObservation>): CandidateObservation {
  rank += 1;
  return {
    resultType: 'ORGANIC', observedName: null, observedDomain: null, observedPhone: null,
    observedBusinessAddress: null, landingUrl: null, position: rank, ...input,
  };
}

const only = (rows: CandidateObservation[], genericTerms?: ReadonlySet<string>) => {
  const resolved = resolveCandidates(rows, genericTerms);
  assert.equal(resolved.length, 1, `expected one candidate, got ${resolved.length}`);
  return resolved[0]!;
};

// ---------------------------------------------------------------- classification --

test('a provider business listing is the strongest identity we get', () => {
  const candidate = only([row({
    resultType: 'MAPS_LOCAL', observedName: 'Burchfield Roof Services LLC',
    observedDomain: 'burchfieldroofing.com', observedPhone: '904-555-0142',
    observedBusinessAddress: '120 King St, St. Augustine, FL',
  })]);
  assert.equal(candidate.sourceClass, 'BUSINESS_LISTING');
  assert.equal(candidate.status, 'VERIFIED');
  assert.equal(candidate.resolvedName, 'Burchfield Roof Services LLC');
  assert.equal(candidate.nameBasis, 'provider_listing');
  assert.equal(candidate.phone, '904-555-0142');
});

test('a Yelp search page is an observation, never a business', () => {
  const candidate = only([row({
    observedName: 'THE BEST 10 ROOFING IN ST. AUGUSTINE, FL',
    observedDomain: 'yelp.com', landingUrl: 'https://www.yelp.com/search?find_desc=roofing',
  })]);
  assert.equal(candidate.sourceClass, 'DIRECTORY');
  assert.equal(candidate.status, 'REJECTED');
  assert.equal(candidate.resolvedName, null);
});

test('a news article does not become the company it is about', () => {
  const candidate = only([row({
    observedName: 'Jacksonville roofing company under investigation by State ...',
    observedDomain: 'news4jax.com',
    landingUrl: 'https://www.news4jax.com/news/2026/09/01/roofing-investigation/',
  })]);
  assert.equal(candidate.sourceClass, 'PUBLISHER');
  assert.equal(candidate.status, 'REJECTED');
});

test('a forum question is not a business', () => {
  const candidate = only([row({
    observedName: 'Who are fair and reputable roofing contractors in St ...',
    observedDomain: 'reddit.com',
    landingUrl: 'https://www.reddit.com/r/jacksonville/comments/abc/roofers/',
  })]);
  assert.equal(candidate.sourceClass, 'FORUM');
  assert.equal(candidate.status, 'REJECTED');
});

test('social and video results cannot promote', () => {
  for (const [domain, url, expected] of [
    ['facebook.com', 'https://www.facebook.com/groups/staug/posts/123', 'SOCIAL'],
    ['youtube.com', 'https://www.youtube.com/watch?v=abc', 'VIDEO'],
  ] as const) {
    const candidate = only([row({
      observedName: 'St Augustine roofing discussion', observedDomain: domain, landingUrl: url })]);
    assert.equal(candidate.sourceClass, expected);
    assert.equal(candidate.status, 'REJECTED');
  }
});

test('a manufacturer’s contractor finder is not a contractor', () => {
  const candidate = only([row({
    observedName: 'Find a contractor near Saint Augustine, FL', observedDomain: 'gaf.com',
    landingUrl: 'https://www.gaf.com/en-us/roofing-contractors/residential',
  })]);
  assert.equal(candidate.sourceClass, 'MANUFACTURER_LOCATOR');
  assert.equal(candidate.status, 'REJECTED');
});

test('a listicle is an article, whoever published it', () => {
  // roof-crafters.com is a real roofing company publishing a ranked list. The page is
  // still a list, and naming an Account after it would be naming it after an article.
  const candidate = only([row({
    observedName: 'The Top 5 Roofing Companies in St. Augustine, Florida',
    observedDomain: 'roof-crafters.com', landingUrl: 'https://roof-crafters.com/blog/top-5/',
  })]);
  assert.ok(['LISTICLE', 'PUBLISHER'].includes(candidate.sourceClass));
  assert.equal(candidate.status, 'REJECTED');
});

// ------------------------------------------------- the structural directory rule --

test('an unknown directory is caught by what it carries, not by its name', () => {
  // freeroofquote.com is the real contamination case and appears on no denylist here.
  const resolved = resolveCandidates([
    row({ observedName: 'Precision Roofing of North Florida Inc',
          observedDomain: 'freeroofquote.com', landingUrl: 'https://freeroofquote.com/fl/precision' }),
    row({ observedName: 'Sunshine Roof Services LLC',
          observedDomain: 'freeroofquote.com', landingUrl: 'https://freeroofquote.com/fl/sunshine' }),
    row({ observedName: 'East Coast Roofing & Restoration',
          observedDomain: 'freeroofquote.com', landingUrl: 'https://freeroofquote.com/fl/eastcoast' }),
  ]);
  assert.equal(resolved.length, 1, 'three listings on one domain are one domain');
  assert.equal(resolved[0]!.sourceClass, 'DIRECTORY');
  assert.equal(resolved[0]!.status, 'REJECTED');
  assert.match(resolved[0]!.reasons.join(' '), /3 different business names/);
});

test('two contractors on one directory do not dedupe into one contractor', () => {
  const resolved = resolveCandidates([
    row({ observedName: 'A Roofing Co', observedDomain: 'someunknowndirectory.com',
          landingUrl: 'https://someunknowndirectory.com/a' }),
    row({ observedName: 'B Roofing Co', observedDomain: 'someunknowndirectory.com',
          landingUrl: 'https://someunknowndirectory.com/b' }),
  ]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.status, 'REJECTED',
    'a directory became a single Account carrying two companies’ identities');
});

test('one contractor appearing once on their own domain still resolves', () => {
  // The rule must not punish a company for appearing once.
  const candidate = only([row({
    observedName: 'Augustine Contractors LLC', observedDomain: 'augustine.pro',
    landingUrl: 'https://augustine.pro/',
  })]);
  assert.equal(candidate.sourceClass, 'OFFICIAL_SITE');
  assert.equal(candidate.status, 'VERIFIED');
});

// ------------------------------------------------------------------- naming rules --

test('a page title cannot become a company name without passing for one', () => {
  for (const title of [
    'Roofing Company in St. Augustine, FL | Roof Repair',
    'Top 10 Best Roofers in Saint Augustine, FL',
    '500',
    'Roofers in St. Augustine, FL',
    'A to Z Roofing and Waterproofing – Roofing, Waterproofing ...',
    'Who are fair and reputable roofing contractors in St ...',
  ]) {
    assert.equal(looksLikeCompanyName(title).ok, false, `"${title}" passed as a company name`);
  }
  for (const title of [
    'Burchfield Roof Services LLC', 'Augustine Contractors LLC',
    'East Coast Roofing & Restoration', 'Sunshine Roof Services LLC',
  ]) {
    assert.equal(looksLikeCompanyName(title).ok, true, `"${title}" was rejected as a name`);
  }
});

test('an own-site page with an unusable title is kept for review, not promoted', () => {
  // This is the common organic case: a real company behind a page-shaped title. It is
  // not rejected -- the company probably exists -- and it is not promoted either,
  // because we cannot yet say what it is called.
  const candidate = only([row({
    observedName: 'Roofing Company in St. Augustine, FL | Roof Repair',
    observedDomain: 'bigfootroofing.com', observedPhone: '904-555-0199',
    landingUrl: 'https://bigfootroofing.com/',
  })]);
  assert.equal(candidate.sourceClass, 'OFFICIAL_SITE');
  assert.equal(candidate.status, 'NEEDS_REVIEW');
  assert.equal(candidate.resolvedName, null);
  assert.equal(candidate.nameBasis, 'unresolved');
  assert.equal(candidate.phone, null,
    'a phone from a page we have not established ownership of was carried forward');
});

// ------------------------------------------------------- one company, many rows --

test('the same company paid, organic and local resolves to one business', () => {
  const resolved = resolveCandidates([
    row({ resultType: 'PAID_SEARCH_TEXT', observedName: 'Same-Day Roof Repair — Free Estimates',
          observedDomain: 'enterpriseroofingllc.com' }),
    row({ resultType: 'ORGANIC', observedName: 'Enterprise Roofing, LLC',
          observedDomain: 'enterpriseroofingllc.com' }),
    row({ resultType: 'MAPS_LOCAL', observedName: 'Enterprise Roofing, LLC',
          observedDomain: 'enterpriseroofingllc.com', observedPhone: '904-555-0177',
          observedBusinessAddress: '9 Center St, St. Augustine, FL' }),
  ]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.status, 'VERIFIED');
  assert.equal(resolved[0]!.sourceClass, 'BUSINESS_LISTING',
    'the listing should decide the identity, not the ad copy');
  assert.equal(resolved[0]!.resolvedName, 'Enterprise Roofing, LLC');
  assert.equal(resolved[0]!.observationCount, 3);
});

test('an aggregator running a paid ad is still an aggregator', () => {
  const candidate = only([row({
    resultType: 'PAID_SEARCH_TEXT', observedName: 'Roofers Near You — Get 3 Quotes',
    observedDomain: 'homeadvisor.com', landingUrl: 'https://www.homeadvisor.com/c.Roofing.html',
  })]);
  assert.equal(candidate.status, 'REJECTED',
    'paid placement was treated as proof the advertiser is a contractor');
});

test('registrable domain groups subdomains with their parent', () => {
  assert.equal(registrableDomain('reviews.birdeye.com'), 'birdeye.com');
  assert.equal(registrableDomain('www.Yelp.com'), 'yelp.com');
  assert.equal(registrableDomain('foo.co.uk'), 'foo.co.uk');
  assert.equal(registrableDomain(null), null);
});

// --------------------------------------------------- the corpus, end to end --

test('the canary corpus classifies sanely as a whole', () => {
  const corpus: CandidateObservation[] = [
    row({ resultType: 'MAPS_LOCAL', observedName: 'Burchfield Roof Services LLC',
          observedDomain: 'burchfieldroofing.com', observedPhone: '904-555-0142',
          observedBusinessAddress: 'St. Augustine, FL' }),
    row({ observedName: 'Augustine Contractors LLC', observedDomain: 'augustine.pro' }),
    row({ observedName: 'THE BEST 10 ROOFING IN ST. AUGUSTINE, FL', observedDomain: 'yelp.com' }),
    row({ observedName: 'Top 10 Roofers in Saint Augustine, FL (with Photos)',
          observedDomain: 'buildzoom.com' }),
    row({ observedName: 'Jacksonville lawyers warn homeowners after state sues roofing ...',
          observedDomain: 'news4jax.com' }),
    row({ observedName: 'Find a contractor near Saint Augustine, FL', observedDomain: 'gaf.com' }),
    row({ observedName: 'St. Augustine Roofing - 29 Reviews - Birdeye',
          observedDomain: 'reviews.birdeye.com' }),
    row({ observedName: 'Who are fair and reputable roofing contractors in St ...',
          observedDomain: 'reddit.com' }),
    row({ observedName: '500', observedDomain: 'southeasternroofers.com' }),
    row({ observedName: 'Roofing Company in St. Augustine, FL | Roof Repair',
          observedDomain: 'bigfootroofing.com' }),
  ];
  const resolved = resolveCandidates(corpus);
  const byStatus = (status: string) => resolved.filter((c) => c.status === status).length;

  assert.equal(resolved.length, 10);
  assert.equal(byStatus('VERIFIED'), 2, 'only the listing and the well-named site promote');
  assert.equal(byStatus('REJECTED'), 6, 'directories, publisher, forum, locator, review site');
  assert.equal(byStatus('NEEDS_REVIEW'), 2, '"500" and the page-titled real company');

  // Nothing a rep would be asked to call is a webpage.
  for (const candidate of resolved.filter((c) => c.status === 'VERIFIED')) {
    assert.ok(candidate.resolvedName && candidate.resolvedName.length > 2);
    assert.ok(!/^\d+$/.test(candidate.resolvedName));
  }
});

// ------------------------------------------------- corroboration (review #5) --

test('UNKNOWN_DIRECTORY_SINGLE_ENTRY: a company name on an unrelated domain waits',
  () => {
  // One row, so the multiplicity rule cannot see it. A company-shaped title used to be
  // enough on its own, which meant an unknown lead-generation site showing somebody
  // else's name became that company.
  const candidate = only([row({
    observedName: 'ABC Plumbing LLC', observedDomain: 'someunknownleadsite.com',
    observedPhone: '904-555-0101', landingUrl: 'https://someunknownleadsite.com/fl/abc',
  })]);
  assert.notEqual(candidate.status, 'VERIFIED',
    'an unknown domain was verified on the strength of a title alone');
  assert.equal(candidate.status, 'NEEDS_REVIEW');
  assert.equal(candidate.resolvedName, null);
  assert.equal(candidate.phone, null, 'a phone from an unattributed page was carried');
  assert.match(candidate.reasons.join(' '), /nothing yet connects that name to that domain/);
});

test('LEGITIMATE_OFFICIAL_SITE: name and domain agreeing is corroboration', () => {
  const candidate = only([row({
    observedName: 'Burchfield Roof Services LLC', observedDomain: 'burchfieldroofing.com',
    landingUrl: 'https://burchfieldroofing.com/',
  })]);
  assert.equal(candidate.status, 'VERIFIED');
  assert.match(candidate.reasons.join(' '), /name and the domain agree/);
});

test('LISTING_LINKS_OFFICIAL_DOMAIN: a listing for the same domain corroborates', () => {
  // The name and domain need not agree when the provider itself ties them together.
  const resolved = resolveCandidates([
    row({ resultType: 'MAPS_LOCAL', observedName: 'Reiter Roofing',
          observedDomain: 'bettermetalroof.com', observedPhone: '904-555-0177',
          observedBusinessAddress: '9 Center St, St. Augustine, FL' }),
    row({ observedName: 'Reiter Roofing', observedDomain: 'bettermetalroof.com' }),
  ]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.status, 'VERIFIED');
});

test('a paid ad on an unknown domain is not automatically the trade', () => {
  // Review #5: paid traffic proves somebody bought an ad, not that the advertiser is
  // an operating roofer rather than a marketplace nobody has catalogued yet.
  const candidate = only([row({
    resultType: 'PAID_SEARCH_TEXT', observedName: 'Roof Repair — Free Quotes Today',
    observedDomain: 'unknownquotefunnel.com',
    landingUrl: 'https://unknownquotefunnel.com/lp/roofing',
  })]);
  assert.notEqual(candidate.status, 'VERIFIED',
    'a paid placement on an unknown domain was promoted to a business');
  // Retained, not discarded: the placement is still real and still evidence.
  assert.equal(candidate.status, 'NEEDS_REVIEW');
});

test('brand agreement is about identifying words, not boilerplate', () => {
  assert.equal(brandMatchesDomain('Burchfield Roof Services LLC', 'burchfieldroofing.com'), true);
  assert.equal(brandMatchesDomain('Augustine Contractors LLC', 'augustine.pro'), true);
  assert.equal(brandMatchesDomain('Cooper Roofing, Inc.', 'cooperroofinginc.com'), true);
  // "LLC", "Inc" and "The" identify nobody.
  assert.equal(brandMatchesDomain('ABC Plumbing LLC', 'llcinc.com'), false);
  assert.equal(brandMatchesDomain('ABC Plumbing LLC', 'someunknownleadsite.com'), false);
  assert.equal(brandMatchesDomain(null, 'anything.com'), false);
});

test('two businesses on the same site builder are two businesses', () => {
  // `wixsite.com` names nobody. Collapsing both to it would merge two companies into
  // one identity carrying two names, which the multiplicity rule then reads as a
  // directory -- so two real roofers would reject each other for sharing a host.
  const resolved = resolveCandidates([
    row({ resultType: 'MAPS_LOCAL', observedName: 'Salazar Roofing',
          observedDomain: 'salazarroofing.wixsite.com', observedPhone: '904-555-0181',
          observedBusinessAddress: '4 King St, St. Augustine, FL' }),
    row({ resultType: 'MAPS_LOCAL', observedName: 'Coastal Air',
          observedDomain: 'coastalair.wixsite.com', observedPhone: '904-555-0182',
          observedBusinessAddress: '8 Bay St, St. Augustine, FL' }),
  ]);
  assert.equal(resolved.length, 2, 'two companies on one site builder became one identity');
  assert.deepEqual(resolved.map((candidate) => candidate.status), ['VERIFIED', 'VERIFIED']);
});

test('a URL and a bare host are the same identity', () => {
  // Inventory stores `https://acme.invalid`; the resolver stores `acme.invalid`. When
  // these disagreed, linking an observation to the Account it became matched nothing
  // and the evidence was left unattached.
  assert.equal(registrableDomain('https://acme.invalid/roofing?utm=1'), 'acme.invalid');
  assert.equal(registrableDomain('acme.invalid'), 'acme.invalid');
  assert.equal(registrableDomain('HTTPS://WWW.Acme.Invalid:8443/x'), 'acme.invalid');
});

// ----------------------------------------- corroboration must be distinctive --

/** What the taxonomy says is generic in a plumbing market. */
const PLUMBING_GENERIC = new Set(['plumbing', 'plumber', 'plumbers', 'drain', 'sewer',
  'water', 'heater', 'jacksonville', 'augustine']);

test('a trade word shared with the domain does not establish ownership', () => {
  // "ABC Plumbing LLC" on `bestplumbingquotes.com`: both contain "plumbing", which
  // says which market we are in and nothing about whose site this is. A
  // lead-generation domain used to pass as the company's own on exactly this.
  assert.equal(
    brandMatchesDomain('ABC Plumbing LLC', 'bestplumbingquotes.com', PLUMBING_GENERIC),
    false, 'a category word was accepted as a brand match');

  // And through the resolver, which is where it mattered.
  const candidate = only([row({
    observedName: 'ABC Plumbing LLC', observedDomain: 'bestplumbingquotes.com',
    landingUrl: 'https://bestplumbingquotes.com/fl/abc',
  })], PLUMBING_GENERIC);
  assert.notEqual(candidate.status, 'VERIFIED');
  assert.equal(candidate.status, 'NEEDS_REVIEW');
});

test('a company word and a place name are not distinctive either', () => {
  assert.equal(brandMatchesDomain(
    'Jacksonville Roofing Company', 'roofingcompanyflorida.example',
    new Set(['roofing', 'roofer', 'jacksonville'])), false,
    'generic category and place words were accepted as a brand match');
});

test('a distinctive word still establishes ownership', () => {
  assert.equal(
    brandMatchesDomain('Burchfield Roof Services LLC', 'burchfieldroofing.com',
      new Set(['roof', 'roofing', 'services'])),
    true, 'a real brand match was refused');
});

test('two rows from one unknown directory are not two sources', () => {
  // A directory is made of a profile page and a category page. Both are pages on that
  // domain, and their agreeing with each other is the site repeating itself.
  const resolved = resolveCandidates([
    row({ observedName: 'Salazar Plumbing', observedDomain: 'unknownplumbingdir.example',
          landingUrl: 'https://unknownplumbingdir.example/fl/salazar-plumbing' }),
    row({ observedName: 'Salazar Plumbing', observedDomain: 'unknownplumbingdir.example',
          landingUrl: 'https://unknownplumbingdir.example/category/plumbers' }),
  ], PLUMBING_GENERIC);
  assert.equal(resolved.length, 1);
  assert.notEqual(resolved[0]!.status, 'VERIFIED',
    'a directory corroborated itself and became the contractor it lists');
  assert.equal(resolved[0]!.resolvedName, null);
});

test('a provider listing tied to the domain is still corroboration', () => {
  const resolved = resolveCandidates([
    row({ resultType: 'MAPS_LOCAL', observedName: 'Salazar Plumbing',
          observedDomain: 'salazarplumbingco.example', observedPhone: '904-555-0190',
          observedBusinessAddress: '12 Bay St, St. Augustine, FL' }),
    row({ observedName: 'Salazar Plumbing', observedDomain: 'salazarplumbingco.example' }),
  ], PLUMBING_GENERIC);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.status, 'VERIFIED');
});
