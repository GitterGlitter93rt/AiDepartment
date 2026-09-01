// SEO quality / indexability test suite — audits the BUILT site.
// Run with: node --experimental-strip-types --test tests/seoQuality.test.ts
// (npm test builds first; this suite requires dist/ to exist.)
//
// Machine-checkable guarantees only — subjective quality (persuasiveness,
// keyword fit) is NOT asserted here; that lives in
// docs/seo/full-site-seo-audit.md. No arbitrary character-count rules.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const SITE = 'https://youraidepartment.ai';

assert.ok(
  existsSync(join(DIST, 'index.html')),
  'dist/ build output must exist before SEO quality tests run — run `npm run build` first (npm test does this automatically)'
);

function walkHtml(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '_astro') continue;
      out.push(...walkHtml(full));
    } else if (entry === 'index.html' || entry === '404.html') {
      out.push(full);
    }
  }
  return out;
}

interface PageData {
  route: string;
  doc: string;
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  h1s: string[];
  metaRefresh: boolean;
}

const pages: PageData[] = walkHtml(DIST).map((file) => {
  const doc = readFileSync(file, 'utf8');
  const rel0 = file.slice(DIST.length);
  const route = rel0 === '/404.html' ? '/404.html' : rel0.replace(/index\.html$/, '');
  return {
    route,
    doc,
    title: doc.match(/<title>([^<]*)<\/title>/)?.[1] ?? null,
    description: doc.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? null,
    canonical: doc.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null,
    robots: doc.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? null,
    h1s: [...doc.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()),
    metaRefresh: /http-equiv="refresh"/.test(doc),
  };
});

const isIndexable = (p: PageData) => !p.robots && !p.metaRefresh && p.route !== '/404.html';
const indexable = pages.filter(isIndexable);
const sitemapRaw = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemapRaw.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

describe('Route inventory', () => {
  test('built site contains the expected indexable / noindex / redirect split', () => {
    assert.ok(indexable.length >= 110, `expected ~117 indexable pages, found ${indexable.length}`);
    // Exactly the intentional exclusions carry noindex (the Astro
    // redirect stub also carries noindex — correct for a retired URL).
    // The three /*-ai/ routes are the paid-social VSL funnels: they are
    // deliberately excluded from search so they cannot cannibalize the
    // organic industry pages they overlap (/industries/plumbing/,
    // /industries/law-firms/). They carry "noindex, follow" rather than
    // the default "noindex, nofollow" — see the funnel indexation test
    // in tests/paidSocialFunnels.test.ts and
    // docs/funnels/paid-social-funnel-system.md.
    const noindex = pages.filter((p) => p.robots).map((p) => p.route).sort();
    assert.deepEqual(noindex, [
      '/404.html',
      '/ai-assessment/full/',
      '/ai-assessment/results/',
      '/ai-department-audit/',
      // Legacy cold-email link repair. The primary mechanism is a 301
      // in public/.htaccess; this stub only renders if mod_rewrite is
      // unavailable, and must never be indexed.
      '/assessment/',
      '/booking-confirmed/',
      '/divorce-law-ai/',
      '/personal-injury-ai/',
      '/plumbing-ai/',
    ]);
    const redirects = pages.filter((p) => p.metaRefresh).map((p) => p.route);
    assert.deepEqual(redirects, ['/ai-department-audit/']);
  });

  test('key routes exist as built pages', () => {
    for (const r of ['/', '/free-ai-assessment/', '/comprehensive-ai-business-audit/', '/ai-assessment/', '/ai-assessment/full/']) {
      assert.ok(pages.some((p) => p.route === r), `${r} must be built`);
    }
  });
});

describe('Per-page metadata integrity', () => {
  test('every indexable page has a unique non-empty title', () => {
    const titles = new Map<string, string[]>();
    for (const p of indexable) {
      assert.ok(p.title && p.title.length > 5, `${p.route}: missing title`);
      const key = p.title.trim().toLowerCase();
      (titles.get(key) ?? titles.set(key, []).get(key)!).push(p.route);
    }
    const dupes = [...titles.entries()].filter(([, rs]) => rs.length > 1);
    assert.deepEqual(dupes, []);
  });

  test('every indexable page has a unique non-empty meta description', () => {
    const descs = new Map<string, string[]>();
    for (const p of indexable) {
      assert.ok(p.description && p.description.length > 20, `${p.route}: missing meta description`);
      const key = p.description.trim().toLowerCase();
      (descs.get(key) ?? descs.set(key, []).get(key)!).push(p.route);
    }
    const dupes = [...descs.entries()].filter(([, rs]) => rs.length > 1);
    assert.deepEqual(dupes, []);
  });

  test('every indexable page has exactly one H1 (server-rendered)', () => {
    // Indexable pages must carry their H1 in static HTML — Google and
    // no-JS visitors should never depend on client JS for it. Noindex
    // utilities (e.g. the JS-rendered results page) are exempt.
    for (const p of indexable) {
      assert.equal(p.h1s.length, 1, `${p.route}: expected exactly one server-rendered H1, found ${p.h1s.length}`);
    }
  });

  test('indexable H1s are unique', () => {
    const h1s = new Map<string, string[]>();
    for (const p of indexable) {
      const key = p.h1s[0].toLowerCase();
      (h1s.get(key) ?? h1s.set(key, []).get(key)!).push(p.route);
    }
    const dupes = [...h1s.entries()].filter(([, rs]) => rs.length > 1);
    assert.deepEqual(dupes, []);
  });
});

describe('Canonicals', () => {
  test('every indexable page is self-canonical on HTTPS with trailing slash', () => {
    for (const p of indexable) {
      assert.ok(p.canonical, `${p.route}: missing canonical`);
      assert.equal(p.canonical, SITE + p.route, `${p.route}: canonical mismatch (${p.canonical})`);
      assert.ok(p.canonical.startsWith('https://'), `${p.route}: insecure canonical`);
    }
  });

  test('no localhost/staging canonicals anywhere', () => {
    for (const p of pages) {
      assert.equal(/localhost|staging|http:\/\/|:3000|:4321/.test(p.canonical ?? ''), false, `${p.route}: suspicious canonical`);
    }
  });

  test('noindex pages emit no canonical (prevents canonical-to-excluded anomalies)', () => {
    // One deliberate exception: /assessment/ is a redirect stub for the
    // legacy Smartlead link, not a utility page. A utility page has no
    // indexable equivalent to point at, which is why the rule exists; a
    // redirect stub does, and naming it is the correct signal.
    const REDIRECT_STUBS: Record<string, string> = {
      '/assessment/': SITE + '/free-ai-assessment/',
    };
    for (const p of pages) {
      if (p.robots && !p.metaRefresh) {
        const expected = REDIRECT_STUBS[p.route] ?? null;
        assert.equal(p.canonical, expected, `${p.route}: unexpected canonical on a noindex page`);
      }
    }
  });
});

describe('Sitemap', () => {
  test('every indexable page is in the sitemap', () => {
    const set = new Set(sitemapUrls);
    for (const p of indexable) {
      assert.ok(set.has(SITE + p.route), `${p.route}: indexable but missing from sitemap`);
    }
  });

  test('sitemap contains no noindex, redirect, 404, or non-existent URLs', () => {
    const built = new Set(pages.map((p) => p.route));
    for (const url of sitemapUrls) {
      const route = url.slice(SITE.length) || '/';
      assert.ok(built.has(route), `sitemap URL not built: ${url}`);
      const page = pages.find((p) => p.route === route)!;
      assert.equal(isIndexable(page), true, `sitemap URL is not indexable: ${url}`);
    }
  });
});

describe('Internal link graph', () => {
  const inbound = new Map<string, Set<string>>();
  for (const p of pages) {
    if (p.metaRefresh) continue;
    // href="([^"#]+)" then startsWith('/') — matches bare href="/" too
    // (an anchored /-first pattern with a "+" quantifier would miss
    // every homepage logo link).
    for (const href of [...p.doc.matchAll(/<a [^>]*href="([^"#]+)"/g)].map((m) => m[1])) {
      if (!href.startsWith('/')) continue;
      const target = href.endsWith('/') ? href : href + '/';
      if (target !== p.route) {
        (inbound.get(target) ?? inbound.set(target, new Set()).get(target)!).add(p.route);
      }
    }
  }

  test('no indexable page is an orphan (every indexable route has >=1 internal inbound link)', () => {
    const orphans = indexable.filter((p) => !(inbound.get(p.route)?.size ?? 0));
    assert.deepEqual(orphans.map((p) => p.route), []);
  });

  test('no public page links to the internal full engine or the retired audit route', () => {
    for (const p of pages) {
      assert.equal(p.doc.includes('href="/ai-assessment/full/'), false, `${p.route}: public link to internal engine`);
      assert.equal(p.doc.includes('href="/ai-department-audit/'), false, `${p.route}: link to retired route`);
    }
  });
});

describe('Favicon / search appearance', () => {
  test('all favicon assets ship in dist and are referenced from the homepage', () => {
    for (const f of ['favicon.ico', 'favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest']) {
      assert.ok(existsSync(join(DIST, f)), `dist/${f} missing`);
    }
    const home = pages.find((p) => p.route === '/')!.doc;
    for (const ref of ['/favicon.svg', '/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png', '/site.webmanifest']) {
      assert.ok(home.includes(`href="${ref}"`), `homepage must reference ${ref}`);
    }
  });

  test('no broken icon/manifest references on the homepage', () => {
    const home = pages.find((p) => p.route === '/')!.doc;
    for (const href of [...home.matchAll(/<link[^>]+href="(\/[^"]+)"[^>]*rel="[^"]*(?:icon|manifest)[^"]*"/g)].map((m) => m[1]).concat(
      ...[...home.matchAll(/<link[^>]*rel="[^"]*(?:icon|manifest)[^"]*"[^>]*href="(\/[^"]+)"/g)].map((m) => m[1])
    )) {
      assert.ok(existsSync(join(DIST, href.slice(1))), `referenced icon asset missing: ${href}`);
    }
  });
});

describe('Structured data sanity', () => {
  test('schema is valid JSON-LD with only truthful types', () => {
    const allowed = new Set(['Organization', 'WebSite', 'Article', 'BreadcrumbList', 'WebPage']);
    for (const p of pages) {
      for (const block of [...p.doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])) {
        let parsed: any;
        assert.doesNotThrow(() => (parsed = JSON.parse(block)), `${p.route}: malformed JSON-LD`);
        const types = Array.isArray(parsed['@graph']) ? parsed['@graph'].map((n: any) => n['@type']) : [parsed['@type']];
        for (const t of types) {
          assert.ok(allowed.has(t), `${p.route}: unsupported schema type ${t}`);
          // Never fabricate ratings/reviews/offers/claims in schema.
          assert.equal('aggregateRating' in parsed, false, `${p.route}: fabricated aggregateRating`);
          assert.equal('review' in parsed, false, `${p.route}: fabricated review`);
        }
      }
    }
  });

  test('resources carry Article schema; homepage carries Organization + WebSite', () => {
    const res = pages.find((p) => p.route === '/resources/why-speed-to-lead-matters/')!;
    assert.ok(res.doc.includes('"@type":"Article"'));
    const home = pages.find((p) => p.route === '/')!;
    assert.ok(home.doc.includes('"@type":"Organization"'));
    assert.ok(home.doc.includes('"@type":"WebSite"'));
  });
});