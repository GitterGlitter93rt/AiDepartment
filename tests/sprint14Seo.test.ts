// Sprint 14 — Search Console optimization contract.
// Run with: node --experimental-strip-types --test tests/sprint14Seo.test.ts
// (requires dist/ — `npm test` builds first.)
//
// Extends the pattern in tests/seoContent.test.ts: assertions run
// against the BUILT html, and they test the thing that would actually
// regress rather than restating the copy.
//
// Deliberately NOT here: a global "every title <= 60 chars" rule. Most
// of the site's titles predate this sprint, several are over by a few
// characters with the keyword front-loaded, and a global rule would
// either fail on unrelated pages or force this sprint to churn 80 of
// them. The length checks below are scoped to the pages Sprint 14
// actually touched.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { SITE } from '../src/lib/site.ts';
import { LEGAL_ENTITY } from '../src/lib/businessIdentity.ts';
import { absoluteUrl, organizationSchema, articleSchema, organizationRef } from '../src/lib/schema.ts';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function page(route: string): string {
  const file = join(DIST, route.slice(1), 'index.html');
  assert.ok(existsSync(file), `${route} must be built (npm test builds first)`);
  return readFileSync(file, 'utf8');
}

function walkHtml(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '_astro') continue;
      out.push(...walkHtml(full));
    } else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

/** Parsed JSON-LD nodes. Never regex-slice a node: it breaks as soon as
 * one nests another object, which is how the Organization logo landed. */
function jsonLd(html: string): any[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  );
}

const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const titleOf = (h: string) => unescape(h.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
const descOf = (h: string) => unescape(h.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '');

function stripCode(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ');
}
function mainContent(html: string): string {
  const s = stripCode(html);
  return s.slice(s.indexOf('<main'), s.indexOf('</main>'));
}
function visibleText(html: string): string {
  return mainContent(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
/** Editorial links only — inside <main>, so nav and footer never count. */
function bodyLinks(html: string): Set<string> {
  return new Set([...mainContent(html).matchAll(/<a [^>]*href="(\/[^"#]*)"/g)].map((m) => m[1]));
}

// ============================================================
// Structured data — the two defects a live crawl reported
// ============================================================

describe('Structured data is complete site-wide', () => {
  test('the logo points at a real brand asset that ships in the build', () => {
    assert.equal(SITE.logoImage, '/icon-512.png');
    assert.ok(existsSync(join(DIST, 'icon-512.png')), 'the logo asset must be in dist');
    // Dimensions must match what schema claims, and clear Google's
    // 112x112 minimum for an Organization logo.
    const buf = readFileSync(join(DIST, 'icon-512.png'));
    assert.equal(buf.readUInt32BE(16), SITE.logoImageSize.width);
    assert.equal(buf.readUInt32BE(20), SITE.logoImageSize.height);
    assert.ok(SITE.logoImageSize.width >= 112 && SITE.logoImageSize.height >= 112);
  });

  test('homepage Organization parses, has a logo, and keeps the brand/legal split', () => {
    const nodes = jsonLd(page('/'));
    const org = nodes.find((n) => n['@type'] === 'Organization');
    assert.ok(org, 'Organization node missing');
    assert.equal(org.name, SITE.name, 'the searchable brand must not be replaced by the legal entity');
    assert.equal(org.legalName, LEGAL_ENTITY, 'Sprint 13 legal identity must survive');
    assert.equal(org.logo['@type'], 'ImageObject');
    assert.equal(org.logo.url, absoluteUrl('/icon-512.png'));
    assert.ok(org.logo.url.startsWith('https://'), 'a relative logo is the same as no logo');
  });

  test('EVERY Article node has an image and a publisher logo, all absolute', () => {
    let articles = 0;
    const defects: string[] = [];
    for (const file of walkHtml(DIST)) {
      for (const node of jsonLd(readFileSync(file, 'utf8'))) {
        if (node['@type'] !== 'Article') continue;
        articles++;
        const where = file.slice(DIST.length);
        if (!node.image) defects.push(`${where}: Article missing image`);
        else if (!String(node.image).startsWith('https://')) defects.push(`${where}: image not absolute`);
        for (const role of ['author', 'publisher'] as const) {
          const o = node[role];
          if (!o?.logo?.url) defects.push(`${where}: ${role} Organization missing logo`);
          else if (!String(o.logo.url).startsWith('https://')) defects.push(`${where}: ${role} logo not absolute`);
        }
        if (!String(node.mainEntityOfPage ?? '').startsWith('https://')) {
          defects.push(`${where}: mainEntityOfPage not absolute`);
        }
      }
    }
    assert.ok(articles >= 60, `expected the resource library, found ${articles} Article nodes`);
    assert.deepEqual(defects, []);
  });

  test('no JSON-LD anywhere is malformed', () => {
    for (const file of walkHtml(DIST)) {
      const html = readFileSync(file, 'utf8');
      assert.doesNotThrow(() => jsonLd(html), `${file.slice(DIST.length)}: malformed JSON-LD`);
    }
  });

  test('the builders invent nothing — no person author, rating, review or offer', () => {
    const org = organizationSchema();
    const art = articleSchema({
      headline: 'x', description: 'y', path: '/resources/x/',
      datePublished: '2026-01-01', dateModified: '2026-01-01',
    });
    for (const node of [org, art, organizationRef()]) {
      for (const forbidden of ['aggregateRating', 'review', 'offers', 'priceRange']) {
        assert.equal(forbidden in node, false, `builder emits ${forbidden}`);
      }
    }
    assert.equal(art.author['@type'], 'Organization', 'the author must not become an invented person');
  });

  test('a resource that was edited this sprint reports a later dateModified', () => {
    const nodes = jsonLd(page('/resources/why-speed-to-lead-matters/'));
    const art = nodes.find((n) => n['@type'] === 'Article');
    assert.equal(art.dateModified, '2026-09-09');
    assert.notEqual(art.datePublished, art.dateModified, 'publishDate must not be overwritten');
  });
});

// ============================================================
// Priority page metadata
// ============================================================

describe('GSC priority pages carry the intended metadata', () => {
  const CASES: { route: string; title: RegExp; desc: RegExp; maxTitle?: number }[] = [
    { route: '/ai-crm-integration/', title: /^AI CRM Integration Services \| Your AI Department$/, desc: /AI CRM integration services that connect chatbots/, maxTitle: 60 },
    { route: '/resources/ai-for-logistics-document-processing-and-back-office-automation/', title: /^AI Document Processing in Logistics \|/, desc: /automate freight documents, data entry, back-office workflows/, maxTitle: 60 },
    { route: '/resources/what-business-processes-should-not-be-automated/', title: /^What Business Processes Should Not Be Automated\?/, desc: /stay human-led, where automation creates risk/ },
    { route: '/resources/why-speed-to-lead-matters/', title: /^Why Speed to Lead Matters for Service Businesses/, desc: /automated speed-to-lead system for calls, forms and after-hours/ },
    { route: '/resources/how-garage-door-companies-can-track-advertising-leads-to-revenue/', title: /^Garage Door Marketing Attribution \|/, desc: /Google Ads, calls and form leads through estimates, completed jobs and revenue/, maxTitle: 60 },
    { route: '/conversion-tracking-analytics/', title: /^AI Conversion Tracking & Attribution \|/, desc: /Track calls, forms, campaigns and ad spend through your CRM/, maxTitle: 60 },
    { route: '/resources/how-pool-companies-can-track-google-ads-to-signed-projects/', title: /^Google Ads Tracking for Pool Companies \|/, desc: /from first click through estimates, signed projects and revenue/, maxTitle: 60 },
    { route: '/industries/insurance/', title: /^AI Consulting for Insurance Companies \|/, desc: /policyholder communication, claims workflows/, maxTitle: 60 },
    { route: '/industries/law-firms/', title: /^AI for Law Firms \|/, desc: /AI automation for law firms: improve intake, follow-up/, maxTitle: 60 },
    { route: '/industries/roofing/', title: /^AI automation for roofing|^AI for Roofing Companies \|/, desc: /answer calls, qualify leads, improve follow-up/, maxTitle: 60 },
    { route: '/resources/how-pest-control-companies-can-track-marketing-to-recurring-customers/', title: /^Pest Control Marketing Attribution \|/, desc: /recurring service and revenue/, maxTitle: 60 },
    { route: '/resources/how-real-estate-teams-can-reactivate-old-leads/', title: /^AI Lead Reactivation for Real Estate Teams \|/, desc: /re-engage old database leads/ },
    { route: '/resources/how-ecommerce-brands-can-connect-ad-spend-to-customer-revenue/', title: /^Ecommerce Ad Spend to Revenue Attribution \|/, desc: /measure campaign profitability instead of clicks alone/ },
    { route: '/resources/how-electrical-contractors-can-automate-estimate-follow-up/', title: /^Electrical Estimate Follow-Up Automation \|/, desc: /timely reminders, CRM tasks and AI-assisted outreach/ },
  ];

  for (const c of CASES) {
    test(`${c.route} title and description`, () => {
      const html = page(c.route);
      const t = titleOf(html);
      const d = descOf(html);
      assert.match(t, c.title);
      assert.match(d, c.desc);
      // A description outside this band is either truncated in the SERP
      // or too thin to earn a click.
      assert.ok(d.length >= 110 && d.length <= 160, `${c.route}: description is ${d.length} chars`);
      if (c.maxTitle) assert.ok(t.length <= c.maxTitle, `${c.route}: title is ${t.length} chars`);
      // Front-loading is what survives truncation, so the keyword must
      // not sit behind the brand.
      assert.equal(t.startsWith('Your AI Department'), false, `${c.route}: brand is front-loaded`);
    });
  }

  test('all touched pages keep exactly one H1 and remain self-canonical', () => {
    for (const c of CASES) {
      const html = page(c.route);
      const h1s = [...mainContent(html).matchAll(/<h1[^>]*>/g)];
      assert.equal(h1s.length, 1, `${c.route}: expected one H1`);
      assert.ok(html.includes(`<link rel="canonical" href="${SITE.domain}${c.route}">`), `${c.route}: not self-canonical`);
      assert.equal(/<meta name="robots"/.test(html), false, `${c.route}: unexpectedly noindex`);
      assert.equal((html.match(/<title>/g) || []).length, 1, `${c.route}: duplicate title tag`);
    }
  });

  test('titles and descriptions stay unique across every indexable page', () => {
    const seenT = new Map<string, string>();
    const seenD = new Map<string, string>();
    for (const file of walkHtml(DIST)) {
      const html = readFileSync(file, 'utf8');
      if (/<meta name="robots"/.test(html) || /http-equiv="refresh"/.test(html)) continue;
      const route = file.slice(DIST.length).replace(/index\.html$/, '');
      const t = titleOf(html).toLowerCase();
      const d = descOf(html).toLowerCase();
      assert.equal(seenT.has(t), false, `duplicate title: ${route} and ${seenT.get(t)}`);
      assert.equal(seenD.has(d), false, `duplicate description: ${route} and ${seenD.get(d)}`);
      seenT.set(t, route);
      seenD.set(d, route);
    }
  });
});

// ============================================================
// Garage door cannibalization
// ============================================================

describe('Garage door: the two pages own different intents', () => {
  const industry = page('/industries/garage-door-companies/');
  const resource = page('/resources/how-garage-door-companies-can-track-advertising-leads-to-revenue/');

  test('the industry page owns the broad commercial intent', () => {
    assert.match(titleOf(industry), /^AI Systems for Garage Door Companies/);
    // It must NOT start competing on attribution language.
    assert.equal(/attribution/i.test(titleOf(industry)), false);
  });

  test('the resource owns attribution, and does not read as generic AI marketing', () => {
    const t = titleOf(resource);
    assert.match(t, /Attribution/i);
    assert.equal(/AI marketing services/i.test(t), false, 'the resource must not chase the generic query');
    assert.equal(/^AI Systems/i.test(t), false);
    // The body is still about the measurement chain.
    const text = visibleText(resource);
    for (const term of ['attribution', 'revenue']) {
      assert.match(text, new RegExp(term, 'i'), `the article drifted away from ${term}`);
    }
  });

  test('they link to each other, with anchors that name the intent', () => {
    assert.ok(bodyLinks(industry).has('/resources/how-garage-door-companies-can-track-advertising-leads-to-revenue/'));
    assert.ok(bodyLinks(resource).has('/industries/garage-door-companies/'));
    // The industry page's anchor must describe attribution, not repeat
    // the old article title.
    const anchor = mainContent(industry)
      .match(/<a [^>]*href="\/resources\/how-garage-door-companies-can-track-advertising-leads-to-revenue\/"[^>]*>([^<]*)<\/a>/)?.[1];
    assert.ok(anchor, 'no editorial anchor found');
    assert.match(anchor!, /attribution/i, `anchor does not name the intent: "${anchor}"`);
  });
});

// ============================================================
// Internal linking
// ============================================================

describe('Topical clusters gained real contextual links', () => {
  const EXPECTED: [string, string][] = [
    ['/ai-growth-systems/', '/ai-crm-integration/'],
    ['/ai-growth-systems/', '/conversion-tracking-analytics/'],
    ['/managed-ai-department/', '/ai-crm-integration/'],
    ['/managed-ai-department/', '/conversion-tracking-analytics/'],
    ['/meta-ads/', '/conversion-tracking-analytics/'],
    ['/google-ads/', '/conversion-tracking-analytics/'],
    ['/google-ads/', '/resources/how-pool-companies-can-track-google-ads-to-signed-projects/'],
    ['/google-ads/', '/resources/what-is-ai-conversion-tracking/'],
    ['/ai-crm-integration/', '/crm-setup-automation/'],
    ['/crm-setup-automation/', '/ai-crm-integration/'],
    ['/industries/logistics-transportation/', '/resources/ai-for-logistics-document-processing-and-back-office-automation/'],
    ['/resources/where-logistics-companies-should-start-with-ai/', '/resources/ai-for-logistics-document-processing-and-back-office-automation/'],
    ['/resources/ai-for-logistics-document-processing-and-back-office-automation/', '/industries/logistics-transportation/'],
    ['/resources/why-speed-to-lead-matters/', '/ai-agent-development/'],
    ['/resources/why-speed-to-lead-matters/', '/ai-crm-integration/'],
    ['/resources/why-speed-to-lead-matters/', '/conversion-tracking-analytics/'],
    ['/industries/pool-companies/', '/resources/how-pool-companies-can-track-google-ads-to-signed-projects/'],
  ];

  test('every expected contextual link exists inside <main>', () => {
    const missing = EXPECTED.filter(([from, to]) => !bodyLinks(page(from)).has(to))
      .map(([from, to]) => `${from} -> ${to}`);
    assert.deepEqual(missing, []);
  });

  test('every internal link destination on a touched page actually builds', () => {
    const touched = [...new Set(EXPECTED.map(([f]) => f))];
    const broken: string[] = [];
    for (const route of touched) {
      for (const href of bodyLinks(page(route))) {
        const target = href.endsWith('/') ? href : `${href}/`;
        if (/\.[a-z0-9]{2,4}$/.test(href)) continue;
        if (!existsSync(join(DIST, target.slice(1), 'index.html'))) broken.push(`${route} -> ${href}`);
      }
    }
    assert.deepEqual(broken, []);
  });

  test('anchors into AI CRM integration are varied, not one exact-match string', () => {
    const anchors = new Set<string>();
    for (const from of ['/ai-growth-systems/', '/managed-ai-department/', '/resources/why-speed-to-lead-matters/']) {
      for (const m of mainContent(page(from)).matchAll(/<a [^>]*href="\/ai-crm-integration\/"[^>]*>([^<]*)<\/a>/g)) {
        anchors.add(m[1].trim().toLowerCase());
      }
    }
    assert.ok(anchors.size >= 3, `expected varied anchors, got ${[...anchors].join(' | ')}`);
  });
});

// ============================================================
// Nothing from earlier sprints regressed
// ============================================================

describe('Sprint 13 state is untouched', () => {
  test('the campaign pages are still noindex and still out of the sitemap', () => {
    const sitemap = read('public/sitemap.xml');
    for (const route of ['/go/law-firms/', '/go/roofing/']) {
      assert.match(page(route), /<meta name="robots" content="noindex, follow">/);
      assert.equal(sitemap.includes(route), false, `${route} leaked into the sitemap`);
    }
  });

  test('the sitemap is unchanged at 119 URLs — this sprint added no routes', () => {
    const urls = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(urls.length, 119);
    assert.equal(new Set(urls).size, 119, 'duplicate sitemap entries');
    // Everything listed must build and be indexable.
    for (const u of urls) {
      const route = u.slice(SITE.domain.length);
      const file = join(DIST, route.slice(1), 'index.html');
      assert.ok(existsSync(file), `sitemap URL not built: ${u}`);
      assert.equal(/<meta name="robots"/.test(readFileSync(file, 'utf8')), false, `sitemap URL is noindex: ${u}`);
    }
  });

  test('the active legal entity is still Catastrophic Solutions LLC', () => {
    assert.equal(LEGAL_ENTITY, 'Catastrophic Solutions LLC');
    const leaks = walkHtml(DIST)
      .filter((f) => readFileSync(f, 'utf8').includes('Your AI Department LLC'))
      .map((f) => f.slice(DIST.length));
    assert.deepEqual(leaks, [], 'the future legal entity must not be published as the active operator');
  });

  test('no PII was introduced into any analytics payload', () => {
    // Sprint 14 touched no analytics, and this asserts it stayed that way.
    const smsPage = read('src/pages/sms-consent/index.astro');
    const push = smsPage.match(/dataLayer\.push\(\{[\s\S]*?\}\)/)?.[0] ?? '';
    for (const forbidden of ['name', 'phone', 'email']) {
      assert.equal(new RegExp(`\\b${forbidden}\\b`).test(push), false, `analytics payload carries ${forbidden}`);
    }
  });

  test('deployment artefacts still ship', () => {
    for (const f of ['.htaccess', 'og-default.png', 'robots.txt', 'sitemap.xml', '404.html', 'icon-512.png']) {
      assert.ok(existsSync(join(DIST, f)), `dist/${f} missing`);
    }
  });
});
