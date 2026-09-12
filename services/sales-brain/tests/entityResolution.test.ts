import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyObservation, registrableDomain } from '../src/discovery/sourceClass.js';
import { resolveCandidates, looksLikeCompanyName,
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
    observedLocation: null, landingUrl: null, position: rank, ...input,
  };
}

const only = (rows: CandidateObservation[]) => {
  const resolved = resolveCandidates(rows);
  assert.equal(resolved.length, 1, `expected one candidate, got ${resolved.length}`);
  return resolved[0]!;
};

// ---------------------------------------------------------------- classification --

test('a provider business listing is the strongest identity we get', () => {
  const candidate = only([row({
    resultType: 'MAPS_LOCAL', observedName: 'Burchfield Roof Services LLC',
    observedDomain: 'burchfieldroofing.com', observedPhone: '904-555-0142',
    observedLocation: '120 King St, St. Augustine, FL',
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
          observedLocation: '9 Center St, St. Augustine, FL' }),
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
          observedLocation: 'St. Augustine, FL' }),
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
