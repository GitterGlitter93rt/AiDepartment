import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSiteQuality, hasMobileViewport, hasMetaDescription, hasTitle,
  hasLocalBusinessSchema, copyrightYear } from '../src/resolver/siteQuality.js';

/**
 * Does their own digital presence suggest an opening?
 *
 * The line this file walks: every check must be something a rep would open a
 * conversation differently for. Nothing here scores a site out of a hundred, because
 * a number invites an argument and a fact invites a question.
 */

const GOOD = `<!doctype html><html><head>
<title>Kowalczyk Plumbing | St Augustine</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Emergency plumbing, drain cleaning and water heaters in St Augustine since 2004.">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Plumber","name":"Kowalczyk Plumbing"}
</script>
</head><body><footer>&copy; 2026 Kowalczyk Plumbing</footer></body></html>`;

const POOR = `<!doctype html><html><head><title>Home</title></head>
<body><footer>Copyright 2019 Old Pipes Co</footer></body></html>`;

test('a maintained site reports as maintained', () => {
  const signals = extractSiteQuality({
    html: GOOD, text: '© 2026 Kowalczyk Plumbing', url: 'https://co.invalid/', isHomepage: true });
  const byKey = new Map(signals.map((signal) => [signal.claimKey, signal.normalizedValue]));
  assert.equal(byKey.get('site_https'), 'yes');
  assert.equal(byKey.get('site_mobile_viewport'), 'yes');
  assert.equal(byKey.get('site_meta_description'), 'yes');
  assert.equal(byKey.get('site_local_business_schema'), 'yes');
  assert.equal(byKey.get('site_copyright_year'), 'yes');
});

test('a neglected site reports what is missing, as a question', () => {
  const signals = extractSiteQuality({
    html: POOR, text: 'Copyright 2019 Old Pipes Co', url: 'http://old.invalid/',
    isHomepage: true });
  const byKey = new Map(signals.map((signal) => [signal.claimKey, signal]));
  assert.equal(byKey.get('site_https')!.normalizedValue, 'no');
  assert.equal(byKey.get('site_mobile_viewport')!.normalizedValue, 'no');
  assert.equal(byKey.get('site_meta_description')!.normalizedValue, 'no');
  assert.equal(byKey.get('site_local_business_schema')!.normalizedValue, 'no');

  const copyright = byKey.get('site_copyright_year')!;
  assert.equal(copyright.normalizedValue, 'no');
  assert.match(copyright.claimText, /question rather than a conclusion/i,
    'a stale footer was presented as proof the company is neglected');
});

test('structured data of the wrong kind does not count as local markup', () => {
  const breadcrumbsOnly = `<script type="application/ld+json">
    {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}
  </script>`;
  assert.equal(hasLocalBusinessSchema(breadcrumbsOnly), false,
    'breadcrumb markup was counted as local business markup');
  assert.equal(hasLocalBusinessSchema(GOOD), true);
});

test('the individual checks are honest about what they read', () => {
  assert.equal(hasMobileViewport('<meta name="viewport" content="width=device-width">'), true);
  assert.equal(hasMobileViewport('<meta name="viewport" content="width=1024">'), false,
    'a fixed-width viewport was accepted as mobile-ready');
  assert.equal(hasMetaDescription('<meta name="description" content="short">'), false,
    'an empty-ish description was counted as a description');
  assert.equal(hasTitle('<title>  </title>'), false);
});

test('a copyright range reports its newest year', () => {
  assert.equal(copyrightYear('© 2018-2026 Some Co'), 2026);
  assert.equal(copyrightYear('Copyright 2019'), 2019);
  assert.equal(copyrightYear('no year here'), null);
});

test('a page with no title is not assessed at all', () => {
  // The invariant these checks must not break: research of a page that states nothing
  // writes no evidence. A bare fragment with no head is not a site we can judge, and
  // "no meta description" about it would record our own failed fetch as a finding.
  assert.deepEqual(extractSiteQuality({
    html: '<html><body><h1>Quiet Air</h1><p>Heating and cooling.</p></body></html>',
    text: 'Quiet Air Heating and cooling.', url: 'https://quiet.invalid/',
    isHomepage: true }), [],
  'a page with nothing to assess produced negative findings about the company');
});

test('these checks run on the front page only', () => {
  assert.deepEqual(extractSiteQuality({
    html: GOOD, text: '', url: 'https://co.invalid/about', isHomepage: false }), [],
  'site-wide checks were repeated for every page crawled');
});
