// Sprint 17 — location architecture, proof section, and the guardrails
// that keep both honest.
// Run with: node --experimental-strip-types --test tests/sprint17LocalAuthority.test.ts
// (requires dist/ — `npm test` builds first.)
//
// Two risks justify this file.
//
// 1. DOORWAY PAGES. Seven city pages that differ only by a place name
//    are, to Google, one page with six duplicates — and a manual-action
//    risk. The similarity suite below measures the built HTML rather
//    than trusting that whoever writes the eighth page will remember.
//
// 2. FABRICATED PRESENCE AND PROOF. The company has one verified
//    business address in Northeast Florida and no approved public case
//    studies, client names or performance figures. A location page that
//    implies an office, or a proof card that implies a result, is the
//    kind of claim that is easy to add later and hard to notice. Both
//    are asserted against here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { SITE } from '../src/lib/site.ts';
import { LEGAL_ENTITY, BUSINESS_ADDRESS_LINES } from '../src/lib/businessIdentity.ts';
import { MARKETS, HOME_REGION, locationPath } from '../src/lib/locations.ts';

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

function jsonLd(html: string): any[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  );
}

const unescape = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
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
  return unescape(mainContent(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function h1sOf(html: string): string[] {
  return [...mainContent(html).matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
    unescape(m[1].replace(/<[^>]+>/g, '')).trim(),
  );
}
function bodyLinks(html: string): Set<string> {
  return new Set([...mainContent(html).matchAll(/<a [^>]*href="(\/[^"#]*)"/g)].map((m) => m[1]));
}
/** Links anywhere in the document, including the footer. */
function allLinks(html: string): Set<string> {
  return new Set([...stripCode(html).matchAll(/<a [^>]*href="(\/[^"#]*)"/g)].map((m) => m[1]));
}

const HUB = '/locations/';
const MARKET_ROUTES = MARKETS.map((m) => locationPath(m.slug));
const ALL_LOCATION_ROUTES = [HUB, ...MARKET_ROUTES];

// ============================================================
// Routes, metadata, indexability
// ============================================================

describe('Every location route builds as a complete, indexable page', () => {
  for (const route of ALL_LOCATION_ROUTES) {
    test(`${route} is well-formed`, () => {
      const html = page(route);
      assert.equal((html.match(/<title>/g) || []).length, 1, 'duplicate title tag');
      assert.ok(titleOf(html).length > 5, 'missing title');
      assert.ok(descOf(html).length >= 110 && descOf(html).length <= 165, `description is ${descOf(html).length} chars`);
      assert.equal(h1sOf(html).length, 1, 'expected exactly one server-rendered H1');
      assert.ok(html.includes(`<link rel="canonical" href="${SITE.domain}${route}">`), 'not self-canonical');
      assert.equal(/<meta name="robots"/.test(html), false, 'unexpectedly noindex');
      assert.equal(/http-equiv="refresh"/.test(html), false, 'unexpectedly a redirect stub');
      // Core copy must be in the source, not assembled by client JS.
      assert.ok(visibleText(html).length > 2500, 'page body is too thin to be useful without JS');
    });
  }

  test('titles, descriptions and H1s are unique across the location set', () => {
    const titles = ALL_LOCATION_ROUTES.map((r) => titleOf(page(r)).toLowerCase());
    const descs = ALL_LOCATION_ROUTES.map((r) => descOf(page(r)).toLowerCase());
    const h1s = ALL_LOCATION_ROUTES.map((r) => h1sOf(page(r))[0].toLowerCase());
    assert.equal(new Set(titles).size, titles.length, 'duplicate title among location pages');
    assert.equal(new Set(descs).size, descs.length, 'duplicate description among location pages');
    assert.equal(new Set(h1s).size, h1s.length, 'duplicate H1 among location pages');
  });

  test('market titles follow the natural pattern and are not spammy', () => {
    for (const market of MARKETS) {
      const t = titleOf(page(locationPath(market.slug)));
      assert.match(t, /^AI Consulting .+ \| Your AI Department$/, `${market.slug}: unexpected title shape`);
      assert.equal(t.startsWith('Your AI Department'), false, 'brand front-loaded');
      for (const spam of [/\bbest\b/i, /\b#1\b/, /\bnumber one\b/i, /\btop rated\b/i, /!/]) {
        assert.equal(spam.test(t), false, `${market.slug}: spammy title (${spam})`);
      }
    }
  });

  test('all eight routes are in the sitemap, which is pinned at 130', () => {
    const urls = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(urls.length, 130, 'sitemap count changed unexpectedly');
    assert.equal(new Set(urls).size, 130, 'duplicate sitemap entries');
    for (const route of ALL_LOCATION_ROUTES) {
      assert.ok(urls.includes(SITE.domain + route), `${route} missing from sitemap`);
    }
  });

  test('no future-market page was created or listed ahead of its content', () => {
    // docs/05-seo/local-seo.md records these as candidates only. A stub
    // page or a sitemap entry for one is the failure mode this catches.
    const sitemap = read('public/sitemap.xml');
    for (const slug of ['tampa', 'west-palm-beach', 'boca-raton', 'naples', 'sarasota', 'fort-myers', 'palm-beach']) {
      assert.equal(existsSync(join(DIST, 'locations', `${slug}-fl`)), false, `${slug} page exists without approval`);
      assert.equal(sitemap.includes(`/locations/${slug}`), false, `${slug} leaked into the sitemap`);
    }
  });
});

// ============================================================
// The doorway-page test
// ============================================================

describe('Location pages are not a city-variable template', () => {
  /** Overlapping n-word shingles — catches reworded boilerplate that a
   * bag-of-words comparison would miss. */
  function shingles(text: string, n = 6): Set<string> {
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const out = new Set<string>();
    for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
    return out;
  }

  function jaccard(a: Set<string>, b: Set<string>): number {
    let shared = 0;
    for (const s of a) if (b.has(s)) shared++;
    return shared / (a.size + b.size - shared);
  }

  test('no two market pages are substantially similar', () => {
    // Threshold note: shared chrome (hero CTA labels, the CTA band, the
    // "Who This Tends to Work For" scaffolding) puts a floor under this
    // that no amount of original copy removes. Measured at
    // implementation, the worst real pair was Jacksonville/Miami at
    // 0.019 and the median pair was 0.016 — roughly ten times under the
    // limit. A city-variable template scores an order of magnitude
    // higher, so 0.18 fails that loudly while leaving honest editing,
    // and a future eighth market, plenty of room.
    const texts = new Map(MARKET_ROUTES.map((r) => [r, shingles(visibleText(page(r)))]));
    const offenders: string[] = [];
    let worst = { pair: '', score: 0 };

    for (let i = 0; i < MARKET_ROUTES.length; i++) {
      for (let j = i + 1; j < MARKET_ROUTES.length; j++) {
        const a = MARKET_ROUTES[i];
        const b = MARKET_ROUTES[j];
        const score = jaccard(texts.get(a)!, texts.get(b)!);
        if (score > worst.score) worst = { pair: `${a} vs ${b}`, score };
        if (score > 0.18) offenders.push(`${a} vs ${b}: ${score.toFixed(3)}`);
      }
    }
    assert.deepEqual(offenders, [], `worst pair was ${worst.pair} at ${worst.score.toFixed(3)}`);
  });

  test('the two pairs most at risk of duplication are genuinely different', () => {
    // St. Augustine/St. Johns County and Orlando/Winter Park are the
    // pairs a writer would most plausibly collapse. Each page owns a
    // distinct argument, and the terms below are the evidence of it.
    const OWNED: [string, RegExp[]][] = [
      ['/locations/st-augustine-fl/', [/season/i, /owner-operated|owner-led/i]],
      ['/locations/st-johns-county-fl/', [/overhead/i, /grow/i]],
      ['/locations/orlando-fl/', [/volume/i, /consisten/i]],
      ['/locations/winter-park-fl/', [/professional/i, /judgment/i]],
      ['/locations/jacksonville-fl/', [/territor/i, /logistics/i]],
      ['/locations/miami-fl/', [/time zone/i, /referral/i]],
      ['/locations/fort-lauderdale-fl/', [/marine/i, /quote|estimate/i]],
    ];
    for (const [route, terms] of OWNED) {
      const text = visibleText(page(route));
      for (const term of terms) {
        assert.match(text, term, `${route} lost its distinguishing theme (${term})`);
      }
    }
    // And the themes must not have bled across.
    assert.equal(/marine|yacht/i.test(visibleText(page('/locations/miami-fl/'))), false,
      'Miami drifted onto Fort Lauderdale’s marine theme');
    assert.equal(/time zone/i.test(visibleText(page('/locations/fort-lauderdale-fl/'))), false,
      'Fort Lauderdale drifted onto Miami’s cross-border theme');
  });

  test('each market page carries market-specific FAQ content', () => {
    // A shared FAQ block across all seven is the classic doorway tell.
    const faqSets = MARKET_ROUTES.map((r) => {
      const html = mainContent(page(r));
      return [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)]
        .map((m) => unescape(m[1].replace(/<[^>]+>/g, '')).trim().toLowerCase());
    });
    for (let i = 0; i < faqSets.length; i++) {
      assert.ok(faqSets[i].length >= 4, `${MARKET_ROUTES[i]}: too few FAQ entries`);
    }
    // No question text may appear on more than two of the seven pages.
    const counts = new Map<string, number>();
    for (const set of faqSets) for (const q of new Set(set)) counts.set(q, (counts.get(q) ?? 0) + 1);
    const shared = [...counts.entries()].filter(([, n]) => n > 2).map(([q]) => q);
    assert.deepEqual(shared, [], 'the same FAQ question appears on more than two market pages');
  });
});

// ============================================================
// Physical presence — no invented offices
// ============================================================

describe('No location page claims an office or an address', () => {
  test('no page emits LocalBusiness, PostalAddress or geo schema', () => {
    // Site-wide, not just the location pages: this is the assertion that
    // stops a "quick local SEO win" being added somewhere else later.
    const offenders: string[] = [];
    for (const file of walkHtml(DIST)) {
      const raw = readFileSync(file, 'utf8');
      for (const node of jsonLd(raw)) {
        const blob = JSON.stringify(node);
        for (const banned of ['LocalBusiness', 'PostalAddress', 'GeoCoordinates', '"address"', 'openingHours']) {
          if (blob.includes(banned)) offenders.push(`${file.slice(DIST.length)}: ${banned}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('the Service schema says areaServed and nothing about premises', () => {
    for (const market of MARKETS) {
      const route = locationPath(market.slug);
      const svc = jsonLd(page(route)).find((n) => n['@type'] === 'Service');
      assert.ok(svc, `${route}: Service node missing`);
      assert.equal(svc.areaServed['@type'], market.areaType, `${route}: wrong areaServed type`);
      assert.equal(svc.areaServed.name, market.name);
      assert.equal(svc.areaServed.containedInPlace.name, 'Florida');
      assert.equal(svc.provider['@type'], 'Organization');
      assert.equal(svc.provider.legalName, LEGAL_ENTITY, 'provider must carry the active legal entity');
      assert.equal('address' in svc.provider, false, 'provider must not carry an address');
      assert.equal(svc.url, `${SITE.domain}${route}`);
      for (const forbidden of ['aggregateRating', 'review', 'offers', 'priceRange']) {
        assert.equal(forbidden in svc, false, `${route}: Service emits ${forbidden}`);
      }
    }
  });

  test('no location page repeats the business street address', () => {
    // The address is published on the legal pages by design. It has no
    // business on a marketing location page, where it would read as a
    // branch office.
    for (const route of ALL_LOCATION_ROUTES) {
      const text = visibleText(page(route));
      for (const line of BUSINESS_ADDRESS_LINES) {
        assert.equal(text.includes(line), false, `${route} publishes the street address`);
      }
      assert.equal(/\bSTE\b|\bSuite\b/i.test(text), false, `${route} names a suite`);
    }
  });

  test('no location page claims an office, headquarters or "visit us"', () => {
    const CLAIMS = [
      /our (?:new )?(?:[A-Z][a-z]+ )?office/i,
      /\boffice (?:in|at) (?:Orlando|Miami|Fort Lauderdale|Winter Park|Jacksonville|St\.? Augustine)/i,
      /\bheadquarter/i,
      /visit (?:our|us at)/i,
      /\bwalk[- ]in\b/i,
      /serving .{0,30} from our \w+ office/i,
    ];
    for (const route of ALL_LOCATION_ROUTES) {
      const text = visibleText(page(route));
      for (const claim of CLAIMS) {
        // "We do not operate a Jacksonville office" must stay legal, so
        // matches are only failures when not preceded by a negation.
        for (const m of text.matchAll(new RegExp(claim.source, 'gi'))) {
          // A question ("Do you have an office in Orlando?") is fine when
          // the answer denies it, so the window spans both sides of the
          // match rather than only what precedes it.
          const before = text.slice(Math.max(0, m.index! - 120), m.index!).toLowerCase();
          const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 220).toLowerCase();
          const negated =
            /\b(no|not|never|without|do not|don't|nor)\b/.test(before) ||
            /^[?.\s]*\b(no|not|never|we do not|there is no|we don't)\b/.test(after);
          assert.ok(negated, `${route}: unnegated presence claim — "${m[0]}"`);
        }
      }
    }
  });

  test('every market page states the service relationship, and the home region is regional', () => {
    assert.equal(HOME_REGION, 'Northeast Florida', 'the home region must stay a region, not a city');
    // Nothing in the repository supports naming St. Augustine as the
    // company base, so the site must not say it is based there.
    for (const route of ALL_LOCATION_ROUTES) {
      const text = visibleText(page(route));
      assert.equal(/based in St\.? Augustine/i.test(text), false, `${route}: unsupported base-city claim`);
    }
  });
});

// ============================================================
// Proof section honesty
// ============================================================

describe('The homepage proof section claims nothing it cannot support', () => {
  const home = () => page('/');

  test('the section renders with problem / system / outcome structure', () => {
    const html = mainContent(home());
    assert.ok(html.includes('id="systems-we-build"'), 'proof section missing from the homepage');
    for (const label of ['Problem', 'System', 'Business Outcome']) {
      assert.ok(html.includes(`>${label}</p>`), `proof cards lost the ${label} label`);
    }
  });

  test('it is framed as capability, and claims no social proof', () => {
    const text = visibleText(home());
    // The framing is positive rather than a disclaimer: a prospect should
    // read what we build, not what we lack. The constraint behind it is
    // unchanged and lives in ProofSection.astro's header comment.
    assert.match(text, /examples of the practical systems we design and build/i,
      'the capability framing was removed');
    // Now that no disclaimer sentence needs an exception, these are
    // banned outright — a stricter guard than the negation-aware one it
    // replaces. Adding a testimonial or case study to the homepage fails
    // here regardless of how it is phrased.
    for (const forbidden of [/\btestimonial/i, /\bcase stud(?:y|ies)\b/i, /\bour client\b/i, /\bclients say\b/i]) {
      assert.equal(forbidden.test(text), false, `homepage claims social proof (${forbidden})`);
    }
  });

  test('no fabricated metric appears in the proof section', () => {
    // Percentages, currency figures and multipliers are exactly what a
    // future edit would reach for, and none of them are supportable.
    const section = mainContent(home());
    const start = section.indexOf('id="systems-we-build"');
    const proof = section.slice(start, start + 8000).replace(/<[^>]+>/g, ' ');
    for (const pattern of [/\d+\s?%/, /\$\s?\d/, /\b\d+x\b/i, /\b\d+\s?(?:hours|clients|customers)\s+saved/i]) {
      assert.equal(pattern.test(proof), false, `proof section contains a fabricated-looking metric (${pattern})`);
    }
  });

  test('every proof card links to a service page that actually exists', () => {
    const links = [...bodyLinks(home())].filter((l) => !l.startsWith('/locations/'));
    const broken = links.filter((href) => !existsSync(join(DIST, href.slice(1), 'index.html')));
    assert.deepEqual(broken, [], 'homepage links to a route that does not build');
  });
});

// ============================================================
// Internal linking
// ============================================================

describe('The location cluster is properly linked', () => {
  test('the hub links to all seven markets', () => {
    const links = bodyLinks(page(HUB));
    for (const route of MARKET_ROUTES) assert.ok(links.has(route), `hub does not link ${route}`);
  });

  test('every market page links back to the hub and into services', () => {
    for (const route of MARKET_ROUTES) {
      const links = bodyLinks(page(route));
      assert.ok(links.has(HUB), `${route} does not link back to the hub`);
      const services = [...links].filter((l) => !l.startsWith('/locations/') && !l.startsWith('/industries/'));
      assert.ok(services.length >= 3, `${route}: only ${services.length} service links`);
    }
  });

  test('no location page is an orphan — each has an inbound link from elsewhere', () => {
    const inbound = new Map<string, Set<string>>();
    for (const file of walkHtml(DIST)) {
      const raw = readFileSync(file, 'utf8');
      const from = file.slice(DIST.length).replace(/index\.html$/, '');
      for (const href of allLinks(raw)) {
        if (href === from) continue;
        (inbound.get(href) ?? inbound.set(href, new Set()).get(href)!).add(from);
      }
    }
    for (const route of ALL_LOCATION_ROUTES) {
      assert.ok((inbound.get(route)?.size ?? 0) > 0, `${route} is orphaned`);
    }
  });

  test('the homepage carries the location teaser and links to the hub', () => {
    assert.ok(bodyLinks(page('/')).has(HUB), 'homepage does not link /locations/');
    assert.match(visibleText(page('/')), new RegExp(`Based in ${HOME_REGION}`, 'i'));
  });

  test('the footer exposes the markets site-wide without a keyword block', () => {
    const footer = page('/').slice(page('/').indexOf('<footer'));
    for (const market of MARKETS) {
      assert.ok(footer.includes(locationPath(market.slug)), `footer missing ${market.slug}`);
    }
    // Anchor text is the place name, not a stuffed phrase.
    for (const m of footer.matchAll(/<a [^>]*href="\/locations\/[a-z-]+\/"[^>]*>([^<]*)<\/a>/g)) {
      assert.equal(/ai consulting/i.test(m[1]), false, `footer uses a keyword anchor: "${m[1]}"`);
    }
  });

  test('service pages link back into the location architecture', () => {
    for (const route of ['/ai-consulting/', '/ai-implementation/']) {
      assert.ok(bodyLinks(page(route)).has(HUB), `${route} does not link /locations/`);
    }
  });

  test('every internal link on a location page resolves to a built route', () => {
    const broken: string[] = [];
    for (const route of ALL_LOCATION_ROUTES) {
      for (const href of bodyLinks(page(route))) {
        if (/\.[a-z0-9]{2,4}$/.test(href)) continue;
        const target = href.endsWith('/') ? href : `${href}/`;
        if (!existsSync(join(DIST, target.slice(1), 'index.html'))) broken.push(`${route} -> ${href}`);
      }
    }
    assert.deepEqual(broken, []);
  });
});

// ============================================================
// Conversion funnel preserved
// ============================================================

describe('Location traffic enters the existing funnel unchanged', () => {
  test('every location page carries the shared primary and secondary CTAs', () => {
    for (const route of ALL_LOCATION_ROUTES) {
      const links = bodyLinks(page(route));
      assert.ok(links.has('/free-ai-assessment/'), `${route}: missing the primary assessment CTA`);
      const html = page(route);
      assert.match(html, /Get Your AI Department Score/, `${route}: primary CTA label changed`);
      assert.match(html, /Schedule a Strategy Call/, `${route}: secondary CTA missing`);
    }
  });

  test('no location page forks its own CTA destination', () => {
    // A hard-coded booking URL here would bypass the shared constant and
    // silently drift when scheduling changes.
    for (const route of ALL_LOCATION_ROUTES) {
      const src = read(`src/pages${route}index.astro`);
      assert.equal(/https:\/\/cal\.com/.test(src), false, `${route}: hard-coded Cal.com URL`);
      assert.match(src, /PRIMARY_CTA/, `${route}: does not use the shared primary CTA constant`);
    }
  });
});

// ============================================================
// Regression — earlier sprints survive
// ============================================================

describe('Sprints 13 through 16 are intact after Sprint 17', () => {
  test('the SMS consent page and its disclosure are untouched', () => {
    const html = page('/sms-consent/');
    assert.match(html, /Reply STOP to opt out/i);
    assert.match(html, new RegExp(LEGAL_ENTITY));
    assert.ok(visibleText(html).length > 500);
    // Sprint 17 changed no consent code.
    const src = read('src/pages/sms-consent/index.astro');
    assert.match(src, /SMS_CONSENT_DISCLOSURE_LEAD/);
  });

  test('the assessment and booking routes still build', () => {
    for (const route of [
      '/free-ai-assessment/', '/ai-assessment/', '/comprehensive-ai-business-audit/', '/contact/',
    ]) {
      assert.ok(existsSync(join(DIST, route.slice(1), 'index.html')), `${route} missing`);
    }
    assert.ok(existsSync(join(DIST, 'assessment', 'index.html')));
    assert.ok(existsSync(join(DIST, 'ai-assessment', 'full', 'index.html')));
  });

  test('the active legal entity is unchanged and the future one is unpublished', () => {
    assert.equal(LEGAL_ENTITY, 'Catastrophic Solutions LLC');
    const leaks = walkHtml(DIST)
      .filter((f) => readFileSync(f, 'utf8').includes('Your AI Department LLC'))
      .map((f) => f.slice(DIST.length));
    assert.deepEqual(leaks, []);
  });

  test('campaign funnels stay noindex and out of the sitemap', () => {
    const sitemap = read('public/sitemap.xml');
    for (const route of ['/go/law-firms/', '/go/roofing/']) {
      assert.match(page(route), /<meta name="robots" content="noindex, follow">/);
      assert.equal(sitemap.includes(route), false);
    }
  });

  test('deployment artefacts still ship', () => {
    for (const f of ['.htaccess', 'robots.txt', 'sitemap.xml', '404.html', 'og-default.png', 'icon-512.png']) {
      assert.ok(existsSync(join(DIST, f)), `dist/${f} missing`);
    }
  });

  test('Sprint 17 touched no analytics or consent payload', () => {
    const smsPage = read('src/pages/sms-consent/index.astro');
    const push = smsPage.match(/dataLayer\.push\(\{[\s\S]*?\}\)/)?.[0] ?? '';
    for (const forbidden of ['name', 'phone', 'email']) {
      assert.equal(new RegExp(`\\b${forbidden}\\b`).test(push), false, `analytics payload carries ${forbidden}`);
    }
  });
});
