import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTechnologies } from '../src/resolver/techSignals.js';
import { extractSocialProfiles, extractContactRoutes, extractProfileClaims,
  extractServiceArea, extractHours } from '../src/resolver/companyProfile.js';

/**
 * What the company's own site can tell a rep.
 *
 * The recurring risk in this file is the same one: reading marketing copy as though
 * it were a fact about the business. A page that mentions ServiceTitan is not a
 * ServiceTitan customer, a link to Facebook's share widget is not a company profile,
 * and "licensed and insured" in a footer is a claim rather than a licence.
 */

const SITE = `<!doctype html><html><head>
<meta name="generator" content="WordPress 6.4" />
<script src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script>
<script src="https://cdn.callrail.com/companies/123/abc/12/swap.js"></script>
<script src="https://js.hs-scripts.com/1234567.js"></script>
<script>fbq('init', '99887766');</script>
</head><body>
<p>Proudly serving St Augustine and surrounding areas since 2004.</p>
<p>Family owned and operated. Licensed and insured. Se habla espanol.</p>
<p>Over 20 years of experience. License # CFC1428888.</p>
<p>Open 24/7 for emergency calls. Financing available.</p>
<p>We work with all insurance carriers on storm claims.</p>
<p>Ask about our maintenance plan.</p>
<a href="/contact-us">Contact</a>
<a href="/book-online">Book Online</a>
<a href="/request-a-quote">Free Estimate</a>
<a href="/careers">We are hiring</a>
<a href="/financing">Financing</a>
<a href="https://www.facebook.com/kowalczykplumbing">Facebook</a>
<a href="https://www.instagram.com/kowalczykplumbing">Instagram</a>
<a href="https://www.linkedin.com/company/kowalczyk-plumbing">LinkedIn</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
<a href="https://directory.example.com/book-online">Book via directory</a>
</body></html>`;

const ORIGIN = 'https://kowalczykplumbing.invalid';
const REF = `${ORIGIN}/`;

// ------------------------------------------------------------- technology --

test('technology is detected from what the vendor put there', () => {
  const found = detectTechnologies(SITE, REF);
  const ids = found.map((entry) => entry.id).sort();
  assert.deepEqual(ids,
    ['callrail', 'google_ads_tag', 'hubspot', 'meta_pixel', 'wordpress'].sort());
  for (const entry of found) {
    assert.ok(entry.evidence.length > 0, `${entry.id} reported without evidence`);
    assert.ok(entry.sourceReference, `${entry.id} reported without a source`);
  }
});

test('a page that talks about a vendor is not a customer of it', () => {
  const blog = `<html><body><article>
    <h1>Why we moved off ServiceTitan to Housecall Pro</h1>
    <p>We compared ServiceTitan, Jobber and Housecall Pro before choosing.</p>
    <p>Our Podium reviews and Birdeye listings both improved.</p>
  </article></body></html>`;
  assert.deepEqual(detectTechnologies(blog, REF), [],
    'vendor names in body copy were read as an installed stack');
});

test('the Google Ads tag is distinguished from plain analytics', () => {
  const analyticsOnly = `<script src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>`;
  const adsToo = `<script src="https://www.googletagmanager.com/gtag/js?id=AW-999"></script>`;
  assert.deepEqual(detectTechnologies(analyticsOnly, REF).map((e) => e.id), ['ga4']);
  assert.deepEqual(detectTechnologies(adsToo, REF).map((e) => e.id), ['google_ads_tag']);
});

test('a detected advertising tag carries why a rep should care', () => {
  const found = detectTechnologies(SITE, REF).find((entry) => entry.id === 'google_ads_tag')!;
  assert.match(found.salesNote!, /clicks/i);
});

// ---------------------------------------------------------------- socials --

test('social profiles come from the company linking to them', () => {
  const socials = extractSocialProfiles(SITE, REF);
  assert.deepEqual(socials.map((entry) => entry.network).sort(),
    ['facebook', 'instagram', 'linkedin']);
  assert.equal(socials.find((entry) => entry.network === 'facebook')!.url,
    'https://www.facebook.com/kowalczykplumbing');
});

test('a share widget is not a company profile', () => {
  const shareOnly = `<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>`;
  assert.deepEqual(extractSocialProfiles(shareOnly, REF), [],
    'a share link was recorded as the company’s page');
});

// ---------------------------------------------------------- contact routes --

test('contact routes are separated by what they actually are', () => {
  const routes = extractContactRoutes(SITE, ORIGIN, REF);
  const kinds = routes.map((route) => route.kind).sort();
  assert.deepEqual(kinds, ['booking', 'careers', 'contact_form', 'financing', 'quote']);
});

test('another site’s booking page is not this company’s', () => {
  const routes = extractContactRoutes(SITE, ORIGIN, REF);
  assert.ok(routes.every((route) => !route.url.includes('directory.example.com')),
    'a directory’s booking page was attributed to this company');
});

// ----------------------------------------------------------- stated claims --

test('the company’s claims about itself are captured as claims', () => {
  const claims = extractProfileClaims(SITE.replace(/<[^>]+>/g, ' '), REF);
  const keys = claims.map((claim) => claim.claimKey);
  for (const expected of ['year_founded', 'family_owned', 'licensed_and_insured_claim',
    'spanish_language_service', 'insurance_claim_assistance', 'membership_plan_offered',
    'license_number_displayed']) {
    assert.ok(keys.includes(expected), `${expected} was not captured`);
  }
  assert.equal(claims.find((claim) => claim.claimKey === 'year_founded')!.normalizedValue, '2004');
  assert.equal(
    claims.find((claim) => claim.claimKey === 'license_number_displayed')!.normalizedValue,
    'CFC1428888');
});

test('"licensed and insured" is recorded as a claim, not a verification', () => {
  const claim = extractProfileClaims(SITE.replace(/<[^>]+>/g, ' '), REF)
    .find((entry) => entry.claimKey === 'licensed_and_insured_claim')!;
  assert.match(claim.claimText, /not a verification/i,
    'a marketing claim was worded as though the licence had been checked');
});

test('a service area is not an address', () => {
  const area = extractServiceArea('Proudly serving St Augustine and surrounding areas.', REF)!;
  assert.equal(area.claimKey, 'stated_service_area');
  assert.match(area.claimText, /not the same as where it is located/i,
    'a service area was recorded without distinguishing it from a location');
});

test('round-the-clock availability is read as hours', () => {
  assert.equal(extractHours('Open 24/7 for emergencies', REF)!.normalizedValue, '24/7');
  assert.equal(extractHours('Mon-Fri: 8am - 5pm', REF)!.normalizedValue, 'Mon-Fri 8am-5pm');
  assert.equal(extractHours('We are open sometimes', REF), null,
    'hours were invented from a page that does not state them');
});

test('nothing is claimed about a site that says nothing', () => {
  const bare = '<html><body><h1>Welcome</h1><p>We fix pipes.</p></body></html>';
  assert.deepEqual(extractProfileClaims(bare, REF), []);
  assert.deepEqual(detectTechnologies(bare, REF), []);
  assert.deepEqual(extractSocialProfiles(bare, REF), []);
  assert.equal(extractServiceArea(bare, REF), null);
});
