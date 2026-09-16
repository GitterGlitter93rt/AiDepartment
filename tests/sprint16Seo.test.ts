// Sprint 16 — GSC demand expansion: search-intent ownership contract.
// Run with: node --experimental-strip-types --test tests/sprint16Seo.test.ts
// (requires dist/ — `npm test` builds first.)
//
// Same approach as tests/sprint14Seo.test.ts: assertions run against the
// BUILT html, and they protect the thing that would actually regress —
// routes, metadata, intent ownership, links and claim discipline — not
// the prose.
//
// The sprint added three resources off real Search Console demand and
// upgraded two more. The risk this file exists to catch is
// cannibalization: a supporting resource drifting onto the query its
// commercial page is supposed to own, or a vertical page swallowing the
// generic one. Those failures are invisible in a build and expensive in
// search, so they are asserted rather than reviewed.
//
// Deliberately NOT here: paragraph-level copy assertions. The pages are
// meant to be edited. What must not silently change is which page owns
// which intent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { SITE } from '../src/lib/site.ts';
import { LEGAL_ENTITY } from '../src/lib/businessIdentity.ts';

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

/** Parsed JSON-LD nodes. Never regex-slice a node — see Sprint 14. */
function jsonLd(html: string): any[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  );
}

const unescape = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const titleOf = (h: string) => unescape(h.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
const descOf = (h: string) => unescape(h.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '');
const h1Of = (h: string) =>
  unescape((mainContent(h).match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '').replace(/<[^>]+>/g, '').trim());

function stripCode(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ');
}
function mainContent(html: string): string {
  const s = stripCode(html);
  return s.slice(s.indexOf('<main'), s.indexOf('</main>'));
}
function visibleText(html: string): string {
  return unescape(mainContent(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}
/** Editorial links only — inside <main>, so nav and footer never count. */
function bodyLinks(html: string): Set<string> {
  return new Set([...mainContent(html).matchAll(/<a [^>]*href="(\/[^"#]*)"/g)].map((m) => m[1]));
}
/** Every anchor text pointing at `to` from `html`. */
function anchorsTo(html: string, to: string): string[] {
  const esc = to.replace(/[/\-]/g, (c) => `\\${c}`);
  return [...mainContent(html).matchAll(new RegExp(`<a [^>]*href="${esc}"[^>]*>([\\s\\S]*?)</a>`, 'g'))].map((m) =>
    unescape(m[1].replace(/<[^>]+>/g, '')).trim(),
  );
}

// The three routes this sprint created.
const NEW_ROUTES = [
  '/resources/ai-search-optimization-for-garage-door-companies/',
  '/resources/how-to-integrate-an-ai-chatbot-with-a-crm/',
  '/resources/ai-dms-integration-for-automotive-dealerships/',
];

// The two it materially upgraded. Their publishDate must survive.
const UPGRADED = [
  { route: '/resources/ai-phone-handling-for-garage-door-companies/', published: '2026-08-18' },
  { route: '/resources/how-home-service-companies-can-automate-estimate-follow-up/', published: '2026-08-18' },
];

const SPRINT_DATE = '2026-09-14';

// ============================================================
// The new routes exist and are indexable
// ============================================================

describe('Sprint 16 routes build, are indexable, and are discoverable', () => {
  for (const route of NEW_ROUTES) {
    test(`${route} renders as a complete indexable page`, () => {
      const html = page(route);
      assert.equal((html.match(/<title>/g) || []).length, 1, 'duplicate title tag');
      assert.ok(titleOf(html).length > 5, 'missing title');

      const d = descOf(html);
      // Outside this band a description is either truncated in the SERP
      // or too thin to earn the click.
      assert.ok(d.length >= 110 && d.length <= 160, `description is ${d.length} chars`);

      assert.equal([...mainContent(html).matchAll(/<h1[^>]*>/g)].length, 1, 'expected exactly one H1');
      assert.ok(html.includes(`<link rel="canonical" href="${SITE.domain}${route}">`), 'not self-canonical');
      assert.equal(/<meta name="robots"/.test(html), false, 'unexpectedly noindex');
      assert.equal(/http-equiv="refresh"/.test(html), false, 'unexpectedly a redirect stub');
      // Front-loading is what survives truncation.
      assert.equal(titleOf(html).startsWith('Your AI Department'), false, 'brand is front-loaded');
    });
  }

  test('all three are listed in the sitemap, which is now pinned at 130', () => {
    const urls = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(urls.length, 130, 'sitemap count changed unexpectedly');
    assert.equal(new Set(urls).size, 130, 'duplicate sitemap entries');
    for (const route of NEW_ROUTES) {
      assert.ok(urls.includes(SITE.domain + route), `${route} missing from sitemap`);
    }
  });

  test('all three appear on the /resources/ hub, via the existing collection', () => {
    const hub = page('/resources/');
    const links = bodyLinks(hub);
    for (const route of NEW_ROUTES) {
      assert.ok(links.has(route), `${route} is not reachable from the resource hub`);
    }
  });

  test('every resource file has exactly one built route — no duplicate slugs', () => {
    const slugs = readdirSync(join(ROOT, 'src/content/resources'))
      .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
      .map((f) => f.replace(/\.mdx?$/, ''));
    assert.equal(new Set(slugs).size, slugs.length, 'duplicate resource slug on disk');
    const built = readdirSync(join(DIST, 'resources')).filter((e) =>
      statSync(join(DIST, 'resources', e)).isDirectory(),
    );
    assert.deepEqual(slugs.slice().sort(), built.slice().sort(), 'resource files and built routes diverged');
  });
});

// ============================================================
// Structured data on the new articles
// ============================================================

describe('Sprint 16 articles carry complete Article schema', () => {
  for (const route of NEW_ROUTES) {
    test(`${route} Article node is complete and absolute`, () => {
      const article = jsonLd(page(route)).find((n) => n['@type'] === 'Article');
      assert.ok(article, 'Article node missing');

      assert.ok(article.headline?.length > 5, 'missing headline');
      assert.ok(article.description?.length > 20, 'missing description');
      assert.equal(article.datePublished, SPRINT_DATE, 'wrong publish date for a Sprint 16 resource');
      assert.equal(article.mainEntityOfPage, SITE.domain + route, 'mainEntityOfPage must be this absolute URL');
      assert.ok(String(article.image).startsWith('https://'), 'image missing or not absolute');

      for (const role of ['author', 'publisher'] as const) {
        const org = article[role];
        assert.equal(org?.['@type'], 'Organization', `${role} must be an Organization, never an invented person`);
        assert.equal(org.legalName, LEGAL_ENTITY, `${role} legalName must stay the active operator`);
        assert.equal(org.name, SITE.name, `${role} name must stay the consumer brand`);
        assert.ok(String(org.logo?.url).startsWith('https://'), `${role} logo missing or not absolute`);
      }

      // Nothing fabricated.
      for (const forbidden of ['aggregateRating', 'review', 'offers', 'priceRange']) {
        assert.equal(forbidden in article, false, `Article emits ${forbidden}`);
      }
    });
  }

  test('publication dates are honest — new pages dated, upgraded pages keep their original', () => {
    for (const { route, published } of UPGRADED) {
      const article = jsonLd(page(route)).find((n) => n['@type'] === 'Article');
      assert.equal(article.datePublished, published, `${route}: original publishDate was overwritten`);
      assert.equal(article.dateModified, SPRINT_DATE, `${route}: updatedDate not recorded`);
    }
    for (const route of NEW_ROUTES) {
      const article = jsonLd(page(route)).find((n) => n['@type'] === 'Article');
      assert.equal(article.dateModified, SPRINT_DATE);
    }
  });
});

// ============================================================
// Intent ownership — the contract this sprint is built on
// ============================================================

describe('Garage door cluster: four pages, four intents', () => {
  const industry = '/industries/garage-door-companies/';
  const phone = '/resources/ai-phone-handling-for-garage-door-companies/';
  const search = '/resources/ai-search-optimization-for-garage-door-companies/';
  const attribution = '/resources/how-garage-door-companies-can-track-advertising-leads-to-revenue/';

  test('the industry page still owns the broad AI systems / services intent', () => {
    const html = page(industry);
    // Sprint 14 deliberately gave this page the broad commercial query.
    assert.match(titleOf(html), /^AI Systems for Garage Door Companies/);
    // It must not start competing on the supporting resources' intents.
    for (const foreign of [/receptionist/i, /search optimization/i, /attribution/i]) {
      assert.equal(foreign.test(titleOf(html)), false, `industry title drifted onto ${foreign}`);
      assert.equal(foreign.test(descOf(html)), false, `industry description drifted onto ${foreign}`);
    }
  });

  test('the phone resource owns receptionist and voice-agent intent', () => {
    const html = page(phone);
    assert.match(titleOf(html), /AI Receptionist for Garage Door Companies/);
    assert.match(h1Of(html), /Receptionist/i);
    assert.match(descOf(html), /receptionist/i);
    const text = visibleText(html);
    for (const term of ['receptionist', 'voice agent', 'missed', 'escalat']) {
      assert.match(text, new RegExp(term, 'i'), `the article no longer covers ${term}`);
    }
    // It must not reach for the industry page's broad query.
    assert.equal(/AI marketing services/i.test(titleOf(html)), false);
    assert.equal(/^AI Systems for Garage Door/i.test(titleOf(html)), false);
  });

  test('the search resource owns search-optimization intent — and NOT AI marketing services', () => {
    const html = page(search);
    assert.match(titleOf(html), /^AI Search Optimization for Garage Door Companies/);
    assert.match(descOf(html), /search/i);
    const text = visibleText(html);
    for (const term of ['local', 'review', 'Google Business Profile', 'structured data']) {
      assert.match(text, new RegExp(term, 'i'), `the article no longer covers ${term}`);
    }
    // The explicit cannibalization rule from the brief: this page does
    // not chase "ai marketing services garage doors". That stays with
    // the industry page.
    assert.equal(/marketing services/i.test(titleOf(html)), false, 'search resource is chasing the industry query');
    assert.equal(/marketing services/i.test(descOf(html)), false, 'search resource is chasing the industry query');
    assert.equal(/^AI Systems/i.test(titleOf(html)), false);
  });

  test('the attribution resource still owns attribution and revenue', () => {
    const html = page(attribution);
    assert.match(titleOf(html), /Attribution/i);
    assert.equal(/receptionist/i.test(titleOf(html)), false);
    assert.equal(/search optimization/i.test(titleOf(html)), false);
    const text = visibleText(html);
    for (const term of ['attribution', 'revenue']) assert.match(text, new RegExp(term, 'i'));
  });

  test('no two garage door pages share a title or an H1', () => {
    const routes = [industry, phone, search, attribution];
    const titles = routes.map((r) => titleOf(page(r)).toLowerCase());
    const h1s = routes.map((r) => h1Of(page(r)).toLowerCase());
    assert.equal(new Set(titles).size, routes.length, 'duplicate title inside the garage door cluster');
    assert.equal(new Set(h1s).size, routes.length, 'duplicate H1 inside the garage door cluster');
  });
});

describe('CRM cluster: commercial pages keep service intent, the guide stays informational', () => {
  const guide = '/resources/how-to-integrate-an-ai-chatbot-with-a-crm/';

  test('/ai-crm-integration/ still reads as the service page', () => {
    const html = page('/ai-crm-integration/');
    assert.match(titleOf(html), /^AI CRM Integration Services \|/, 'Sprint 14 title strategy must survive');
    assert.match(descOf(html), /AI CRM integration services/);
  });

  test('/crm-setup-automation/ still owns setup and configuration', () => {
    const html = page('/crm-setup-automation/');
    assert.match(titleOf(html), /^CRM Setup & Automation \|/);
    assert.match(descOf(html), /CRM automation built around how you actually sell/);
  });

  test('the guide is unmistakably how-to, not a second CRM services page', () => {
    const html = page(guide);
    assert.match(titleOf(html), /^How to Integrate an AI Chatbot With a CRM/);
    assert.match(h1Of(html), /^How to Integrate an AI Chatbot With/);
    // "Services" in the title is what would make this a competing
    // commercial page for the query /ai-crm-integration/ owns.
    assert.equal(/\bservices\b/i.test(titleOf(html)), false, 'the guide title reads as a services page');
    const text = visibleText(html);
    for (const term of ['identity', 'field mapping', 'handoff', 'duplicate', 'rollback', 'webhook']) {
      assert.match(text, new RegExp(term, 'i'), `the guide no longer covers ${term}`);
    }
  });

  test('the guide defers commercially to both CRM pages', () => {
    const links = bodyLinks(page(guide));
    assert.ok(links.has('/ai-crm-integration/'), 'guide must point at the commercial owner');
    assert.ok(links.has('/crm-setup-automation/'), 'guide must point at the setup owner');
  });
});

describe('Automotive: the industry page stays broad, the DMS article stays specific', () => {
  const industry = '/industries/automotive-dealers/';
  const dms = '/resources/ai-dms-integration-for-automotive-dealerships/';

  test('the industry page keeps its broad multi-rooftop positioning', () => {
    const html = page(industry);
    assert.match(titleOf(html), /^AI Systems for Automotive Dealer Groups/);
    // Broad page must not narrow onto the DMS-integration query.
    assert.equal(/DMS integration/i.test(titleOf(html)), false);
  });

  test('the DMS article is specific to DMS and integration intent', () => {
    const html = page(dms);
    assert.match(titleOf(html), /^AI DMS Integration for Automotive Dealerships/);
    assert.match(h1Of(html), /DMS Integration/i);
    assert.match(descOf(html), /dealer management system/i);
    const text = visibleText(html);
    for (const term of ['declined', 'service intake', 'API', 'mapping', 'rooftop']) {
      assert.match(text, new RegExp(term, 'i'), `the article no longer covers ${term}`);
    }
    assert.equal(/^AI Systems/i.test(titleOf(html)), false, 'the article is reaching for the industry query');
  });
});

describe('Estimate follow-up: the generic page owns unsold estimates, verticals stay vertical', () => {
  const generic = '/resources/how-home-service-companies-can-automate-estimate-follow-up/';
  const VERTICALS: [string, RegExp][] = [
    ['/resources/ai-follow-up-for-pool-estimates/', /Pool/i],
    ['/resources/automating-garage-door-replacement-estimate-follow-up/', /Garage Door/i],
    ['/resources/how-electrical-contractors-can-automate-estimate-follow-up/', /Electrical/i],
    ['/resources/how-plumbing-companies-can-automate-estimate-follow-up/', /Plumbing/i],
    ['/resources/how-screen-enclosure-companies-can-automate-estimate-follow-up/', /Screen Enclosure/i],
    ['/resources/automating-estimate-follow-up-for-outdoor-living-projects/', /Outdoor Living/i],
  ];

  test('the generic page explicitly owns unsold-estimate wording', () => {
    const html = page(generic);
    assert.match(titleOf(html), /Unsold Estimate Follow-Up Automation for Home Services/);
    assert.match(h1Of(html), /Unsold Estimate Follow-Up/i);
    assert.match(descOf(html), /unsold estimate follow-up/i);
    const text = visibleText(html);
    // The vocabulary the brief assigned to this page.
    for (const term of ['unsold estimate', 'open estimate', 'quoted', 'stale estimate', 'closed-lost']) {
      assert.match(text, new RegExp(term, 'i'), `the generic page does not cover "${term}"`);
    }
    // It must stay cross-trade rather than becoming another vertical page.
    for (const trade of ['HVAC', 'plumbing', 'electrical', 'roofing', 'garage door']) {
      assert.match(text, new RegExp(trade, 'i'), `the cross-trade framing lost ${trade}`);
    }
  });

  test('no vertical estimate page claims the generic unsold-estimate title', () => {
    for (const [route, vertical] of VERTICALS) {
      const t = titleOf(page(route));
      assert.match(t, vertical, `${route}: title no longer names its vertical`);
      assert.equal(
        /unsold estimate/i.test(t),
        false,
        `${route}: a vertical page is competing for the generic unsold-estimate query`,
      );
    }
  });

  test('the pool article hands generic unsold-estimate intent to the home-service page', () => {
    const pool = '/resources/ai-follow-up-for-pool-estimates/';
    const links = bodyLinks(page(pool));
    assert.ok(links.has(generic), 'pool article must point at the generic owner (GSC surfaced it here)');
    const anchors = anchorsTo(page(pool), generic);
    assert.ok(anchors.length > 0, 'no editorial anchor found');
    assert.ok(
      anchors.some((a) => /unsold estimate/i.test(a)),
      `anchor does not name the generic intent: ${anchors.join(' | ')}`,
    );
  });
});

// ============================================================
// Internal link architecture
// ============================================================

describe('Sprint 16 built real topical clusters', () => {
  const EXPECTED: [string, string][] = [
    // Garage door cluster — supporting resources back to the commercial page.
    ['/industries/garage-door-companies/', '/resources/ai-phone-handling-for-garage-door-companies/'],
    ['/industries/garage-door-companies/', '/resources/ai-search-optimization-for-garage-door-companies/'],
    ['/resources/ai-search-optimization-for-garage-door-companies/', '/industries/garage-door-companies/'],
    ['/resources/ai-search-optimization-for-garage-door-companies/', '/seo/'],
    ['/resources/ai-search-optimization-for-garage-door-companies/', '/conversion-tracking-analytics/'],
    ['/resources/ai-search-optimization-for-garage-door-companies/', '/resources/how-garage-door-companies-can-track-advertising-leads-to-revenue/'],
    ['/resources/ai-search-optimization-for-garage-door-companies/', '/resources/ai-phone-handling-for-garage-door-companies/'],
    ['/resources/ai-phone-handling-for-garage-door-companies/', '/industries/garage-door-companies/'],
    ['/resources/ai-phone-handling-for-garage-door-companies/', '/resources/ai-search-optimization-for-garage-door-companies/'],
    ['/resources/ai-phone-handling-for-garage-door-companies/', '/resources/why-speed-to-lead-matters/'],
    ['/resources/ai-phone-handling-for-garage-door-companies/', '/resources/automating-garage-door-replacement-estimate-follow-up/'],
    ['/resources/ai-phone-handling-for-garage-door-companies/', '/resources/how-garage-door-companies-can-track-advertising-leads-to-revenue/'],
    ['/seo/', '/resources/ai-search-optimization-for-garage-door-companies/'],
    // CRM cluster — reciprocal, both directions.
    ['/ai-crm-integration/', '/resources/how-to-integrate-an-ai-chatbot-with-a-crm/'],
    ['/crm-setup-automation/', '/resources/how-to-integrate-an-ai-chatbot-with-a-crm/'],
    ['/resources/how-to-integrate-an-ai-chatbot-with-a-crm/', '/ai-crm-integration/'],
    ['/resources/how-to-integrate-an-ai-chatbot-with-a-crm/', '/crm-setup-automation/'],
    // Automotive — reciprocal.
    ['/industries/automotive-dealers/', '/resources/ai-dms-integration-for-automotive-dealerships/'],
    ['/resources/ai-dms-integration-for-automotive-dealerships/', '/industries/automotive-dealers/'],
    ['/resources/ai-dms-integration-for-automotive-dealerships/', '/ai-crm-integration/'],
    ['/resources/ai-dms-integration-for-automotive-dealerships/', '/ai-implementation/'],
    // Estimate follow-up — generic page reaches its verticals, pool reaches back.
    ['/resources/how-home-service-companies-can-automate-estimate-follow-up/', '/resources/ai-follow-up-for-pool-estimates/'],
    ['/resources/how-home-service-companies-can-automate-estimate-follow-up/', '/resources/automating-garage-door-replacement-estimate-follow-up/'],
    ['/resources/ai-follow-up-for-pool-estimates/', '/resources/how-home-service-companies-can-automate-estimate-follow-up/'],
  ];

  test('every expected contextual link exists inside <main>', () => {
    const missing = EXPECTED.filter(([from, to]) => !bodyLinks(page(from)).has(to)).map(
      ([from, to]) => `${from} -> ${to}`,
    );
    assert.deepEqual(missing, []);
  });

  test('every internal link on a Sprint 16 page resolves to a built route', () => {
    const touched = [...new Set(EXPECTED.flat())];
    const broken: string[] = [];
    for (const route of touched) {
      for (const href of bodyLinks(page(route))) {
        if (/\.[a-z0-9]{2,4}$/.test(href)) continue;
        const target = href.endsWith('/') ? href : `${href}/`;
        if (!existsSync(join(DIST, target.slice(1), 'index.html'))) broken.push(`${route} -> ${href}`);
      }
    }
    assert.deepEqual(broken, []);
  });

  test('the garage door industry page names the receptionist intent in an anchor', () => {
    const anchors = anchorsTo(page('/industries/garage-door-companies/'), '/resources/ai-phone-handling-for-garage-door-companies/');
    assert.ok(anchors.length > 0, 'no editorial anchor found');
    assert.ok(
      anchors.some((a) => /receptionist|phone handling/i.test(a)),
      `anchor does not name the intent: ${anchors.join(' | ')}`,
    );
  });

  test('anchors into the new resources are varied, not one repeated exact-match string', () => {
    // Exact-match anchor repetition is the over-optimization the brief
    // warns about. Each new resource is linked from more than one place;
    // the anchors should not all be identical.
    for (const to of NEW_ROUTES) {
      const anchors = new Set<string>();
      for (const file of walkHtml(DIST)) {
        const html = readFileSync(file, 'utf8');
        if (!html.includes(`href="${to}"`)) continue;
        for (const a of anchorsTo(html, to)) if (a) anchors.add(a.toLowerCase());
      }
      assert.ok(anchors.size >= 2, `${to}: every anchor is the same string (${[...anchors].join(' | ')})`);
    }
  });
});

// ============================================================
// Claim discipline — EEAT guardrails the brief made explicit
// ============================================================

describe('Sprint 16 content makes no claim the business cannot support', () => {
  test('the DMS article names no dealer management vendor as compatible', () => {
    // The brief is explicit: no compatibility claim for any named
    // platform unless a real integration capability backs it. The
    // simplest durable guard is that the names do not appear at all.
    const VENDORS = [/\bCDK\b/i, /Reynolds/i, /Dealertrack/i, /Tekion/i, /Xtime/i, /DealerSocket/i, /VinSolutions/i];
    for (const route of ['/resources/ai-dms-integration-for-automotive-dealerships/', '/industries/automotive-dealers/']) {
      const text = visibleText(page(route));
      for (const v of VENDORS) {
        assert.equal(v.test(text), false, `${route} names a DMS/CRM vendor (${v}) — implies an unproven integration`);
      }
    }
  });

  test('the DMS article states that integration depends on approved vendor access', () => {
    const text = visibleText(page('/resources/ai-dms-integration-for-automotive-dealerships/'));
    for (const term of ['approved', 'permit', 'contract', 'OEM']) {
      assert.match(text, new RegExp(term, 'i'), `the access caveat lost "${term}"`);
    }
  });

  test('no Sprint 16 page guarantees a ranking or claims algorithm access', () => {
    // These patterns match the business PROMISING something, not the
    // page naming a claim in order to warn against it — the search
    // article deliberately lists "guaranteed rankings" among the things
    // that should disqualify a vendor, and that sentence must stay
    // publishable. So the guard is scoped to promissory constructions
    // (a first-person subject, or a ranking asserted as guaranteed).
    const FORBIDDEN = [
      /\bwe (?:can )?guarantee\b/i,
      /\bguarantee(?:d)? (?:you |your )?(?:a |the )?(?:top|first|#1|number one|page one|page-one)\b/i,
      /\brankings? (?:are|is) guaranteed\b/i,
      /\bGoogle prefers\b/i,
      /ChatGPT ranks businesses/i,
      /\bour proprietary algorithm\b/i,
    ];
    for (const route of [...NEW_ROUTES, ...UPGRADED.map((u) => u.route), '/seo/']) {
      const text = visibleText(page(route));
      for (const f of FORBIDDEN) {
        assert.equal(f.test(text), false, `${route} makes an unsupportable claim (${f})`);
      }
    }
  });

  test('the search article says plainly that rankings are not guaranteed', () => {
    const text = visibleText(page('/resources/ai-search-optimization-for-garage-door-companies/'));
    assert.match(text, /guarantee/i, 'the page must address the guarantee question rather than dodge it');
    assert.match(text, /no one can guarantee|cannot be purchased directly/i);
  });

  test('the safety boundary survives on the garage door receptionist article', () => {
    const text = visibleText(page('/resources/ai-phone-handling-for-garage-door-companies/'));
    // The brief forbids implying AI diagnoses repairs or decides safety.
    assert.match(text, /does not diagnose|not to make any technical/i, 'the human-judgment boundary was removed');
    assert.match(text, /safety/i);
  });

  test('the estimate article promises no recovery rate and cites no close-rate statistic', () => {
    const text = visibleText(page('/resources/how-home-service-companies-can-automate-estimate-follow-up/'));
    assert.match(text, /[Nn]ot every unsold estimate is recoverable/, 'the honesty caveat was removed');
    // A bare percentage here would be an invented conversion statistic.
    assert.equal(/\d+\s?%/.test(text), false, 'a percentage claim appeared on the estimate article');
  });
});

// ============================================================
// Regression — earlier sprints survive
// ============================================================

describe('Sprints 13, 14 and 15 are intact after Sprint 16', () => {
  test('the active legal entity is still Catastrophic Solutions LLC everywhere', () => {
    assert.equal(LEGAL_ENTITY, 'Catastrophic Solutions LLC');
    const leaks = walkHtml(DIST)
      .filter((f) => readFileSync(f, 'utf8').includes('Your AI Department LLC'))
      .map((f) => f.slice(DIST.length));
    assert.deepEqual(leaks, [], 'the future legal entity must not be published as the active operator');
  });

  test('the campaign funnels are still noindex and still excluded from the sitemap', () => {
    const sitemap = read('public/sitemap.xml');
    for (const route of ['/go/law-firms/', '/go/roofing/']) {
      assert.match(page(route), /<meta name="robots" content="noindex, follow">/);
      assert.equal(sitemap.includes(route), false, `${route} leaked into the sitemap`);
    }
  });

  test('deployment artefacts still ship', () => {
    for (const f of ['.htaccess', 'og-default.png', 'robots.txt', 'sitemap.xml', '404.html', 'icon-512.png']) {
      assert.ok(existsSync(join(DIST, f)), `dist/${f} missing`);
    }
  });

  test('Sprint 16 touched no analytics, GTM or consent code', () => {
    // This sprint is content and links only. Anything under the
    // analytics surface changing here would be out of scope.
    const analytics = read('src/components/AnalyticsEvents.astro');
    assert.match(analytics, /dataLayer/, 'analytics component unexpectedly gutted');
    const smsPage = read('src/pages/sms-consent/index.astro');
    const push = smsPage.match(/dataLayer\.push\(\{[\s\S]*?\}\)/)?.[0] ?? '';
    for (const forbidden of ['name', 'phone', 'email']) {
      assert.equal(new RegExp(`\\b${forbidden}\\b`).test(push), false, `analytics payload carries ${forbidden}`);
    }
  });
});
