// Search-intent alignment for the pages Search Console is already
// showing demand for.
// Run with: node --experimental-strip-types --test tests/seoContent.test.ts
// (requires dist/ — run `npm run build` first.)
//
// tests/seoQuality.test.ts asserts the mechanical guarantees for every
// page: one H1, unique titles, self-canonical, in the sitemap, not an
// orphan. This suite is narrower and about content: for the handful of
// URLs where Google has told us what it thinks the page is about, does
// the page actually answer that, and does it stay honest while doing it.
//
// It deliberately does NOT assert keyword density or exact strings from
// a brief. It asserts that the substance is present, that the pages do
// not cannibalise each other, and that nothing was invented to rank.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const SITE = 'https://youraidepartment.ai';

function page(route: string): string {
  const file = join(DIST, route.slice(1), 'index.html');
  assert.ok(existsSync(file), `${route} must be built before this suite runs (npm run build)`);
  return readFileSync(file, 'utf8');
}

function stripCode(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ');
}

function mainContent(html: string): string {
  const s = stripCode(html);
  return s.slice(s.indexOf('<main'), s.indexOf('</main>'));
}

function visibleText(html: string): string {
  return stripCode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
const descOf = (html: string) => html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
const h1Of = (html: string) => (mainContent(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const h2sOf = (html: string) => [...mainContent(html).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const wordsOf = (html: string) => visibleText(mainContent(html)).trim().split(/\s+/).length;

/** Internal destinations linked from inside <main>, so navigation and
 * footer links never count as a real editorial link. */
function bodyLinks(html: string): Set<string> {
  return new Set([...mainContent(html).matchAll(/<a [^>]*href="(\/[^"#]*)"/g)].map((m) => m[1]));
}

// ---------------------------------------------------------------------
// SEO priority 1 — /ai-crm-integration/
//
// GSC showed this URL picking up impressions for "ai crm integration",
// "ai crm integration services", "ai crm configuration" and — the
// largest single query — "ai chatbot crm integrate", at an average
// position in the seventies. The page was already substantial; the gap
// was that its title and H1 described a benefit ("Connect AI Tools to
// the CRM You Already Use") while the demand is for a service, and it
// said nothing specific about chatbots at all.
// ---------------------------------------------------------------------

describe('/ai-crm-integration/ answers the demand Search Console is showing', () => {
  const html = page('/ai-crm-integration/');

  test('the title and H1 name the service, and the title keeps the site brand suffix', () => {
    assert.match(titleOf(html), /AI CRM Integration Services/i);
    assert.ok(titleOf(html).endsWith('| Your AI Department'), 'every indexable page carries the brand suffix');
    assert.ok(titleOf(html).length <= 60, `title is ${titleOf(html).length} chars — it will be truncated in the SERP`);
    assert.match(h1Of(html), /AI CRM Integration Services/i);
    assert.ok(h1Of(html).length <= 70, 'the H1 is a heading, not a sentence');
  });

  test('the meta description names who it is for and what connects', () => {
    const desc = descOf(html);
    assert.ok(desc.length > 80 && desc.length <= 200, `description is ${desc.length} chars`);
    assert.match(desc, /CRM/);
    assert.match(desc, /chatbot|voice|intake/i);
  });

  test('chatbot-to-CRM is a real section, not a keyword sprinkled into existing copy', () => {
    const h2s = h2sOf(html).join(' | ');
    assert.match(h2s, /chatbot/i, 'the largest query family needs its own section');
    const text = visibleText(mainContent(html));
    // The substance that makes the section worth ranking.
    assert.match(text, /duplicat/i, 'deduplication is the first thing that goes wrong');
    assert.match(text, /handoff|hand off/i);
    assert.match(text, /voice agent/i, 'the same argument covers voice, and should say so');
  });

  test('the connection-method comparison is present and covers all three routes', () => {
    const text = visibleText(mainContent(html));
    for (const method of ['API', 'Webhook', 'Zapier', 'Make']) {
      assert.ok(text.includes(method), `the comparison must name ${method}`);
    }
    // A real comparison names the downside of each, or it is a
    // recommendation wearing a table's clothes.
    assert.match(text, /rate limit/i);
    assert.match(text, /duplicate|at-least-once/i);
    assert.match(text, /pricing scales|per-task/i);
  });

  test('the configuration section says what must be true before AI writes', () => {
    assert.match(h2sOf(html).join(' | '), /Before AI Writes|Configuration/i);
    const text = visibleText(mainContent(html));
    assert.match(text, /lifecycle stage/i);
    assert.match(text, /owns a new record|ownership/i);
    assert.match(text, /required field/i);
  });

  test('illustrative examples are labelled as illustrative, never as client work', () => {
    const text = visibleText(mainContent(html));
    assert.match(text, /Illustrative|not descriptions of specific client|not client/i);
    for (const pattern of [/case study/i, /one client/i, /a customer of ours/i, /\b\d{1,3}\s?% (more|increase|faster|higher)/i]) {
      assert.equal(pattern.test(text), false, `fabricated proof: ${pattern}`);
    }
  });

  test('it stays a service page, not a keyword page', () => {
    const text = visibleText(mainContent(html)).toLowerCase();
    const occurrences = (text.match(/ai crm integration/g) || []).length;
    assert.ok(occurrences <= 6, `"ai crm integration" appears ${occurrences} times — that reads as stuffing`);
    assert.ok(wordsOf(html) > 900, 'a service page competing on this term needs substance');
  });

  test('it does not cannibalise the CRM setup page — each names the other boundary', () => {
    const crmSetup = page('/crm-setup-automation/');
    assert.notEqual(titleOf(html), titleOf(crmSetup));
    assert.notEqual(h1Of(html), h1Of(crmSetup));
    // The AI page assumes a working CRM and says where the other page begins.
    assert.ok(bodyLinks(html).has('/crm-setup-automation/'), 'must point at the foundation page');
    assert.match(visibleText(mainContent(html)), /CRM configuration work rather than AI work|foundation itself needs/i);
  });

  test('it links onward to the pages a reader actually needs next', () => {
    const links = bodyLinks(html);
    for (const target of ['/crm-setup-automation/', '/ai-agent-development/', '/ai-implementation/', '/conversion-tracking-analytics/']) {
      assert.ok(links.has(target), `missing internal link to ${target}`);
    }
    // And into the resource cluster, not only to other service pages.
    assert.ok([...links].some((l) => l.startsWith('/resources/')), 'a service page should reach its supporting resources');
  });

  test('it remains indexable, self-canonical, and in the sitemap', () => {
    assert.equal(/<meta name="robots"/.test(html), false);
    assert.ok(html.includes(`<link rel="canonical" href="${SITE}/ai-crm-integration/">`));
    assert.ok(readFileSync(join(ROOT, 'public/sitemap.xml'), 'utf8').includes(`${SITE}/ai-crm-integration/`));
  });
});

// ---------------------------------------------------------------------
// SEO priority 2 — /resources/ai-for-logistics-document-processing.../
//
// "ai document processing in logistics" showed at an average position of
// ~18.75 on a handful of impressions. Small volume, but the best
// non-brand position on the site — Google had already decided this page
// was relevant, and the page was a ~400-word summary. The work was to
// make it worth the position it was being given, not to create a new one.
// ---------------------------------------------------------------------

describe('/resources/ai-for-logistics-document-processing-and-back-office-automation/ earns its position', () => {
  const route = '/resources/ai-for-logistics-document-processing-and-back-office-automation/';
  const html = page(route);
  const text = visibleText(mainContent(html));

  test('the URL did not change — the position belongs to this path', () => {
    // Renaming the slug would forfeit whatever authority the page has.
    assert.ok(html.includes(`<link rel="canonical" href="${SITE}${route}">`));
  });

  test('title and H1 lead with the phrase Google is ranking it for', () => {
    assert.match(titleOf(html), /^AI Document Processing in Logistics/);
    assert.ok(titleOf(html).length <= 60, `title is ${titleOf(html).length} chars`);
    assert.match(h1Of(html), /AI Document Processing in Logistics/);
  });

  test('it covers the document types by name, because they fail differently', () => {
    for (const term of ['bill', 'lading', 'BOL', 'POD', 'proofs? of delivery', 'invoice', 'rate confirmation']) {
      assert.ok(new RegExp(term, 'i').test(text), `missing coverage of ${term}`);
    }
  });

  test('it separates what OCR does from what a language model does', () => {
    assert.match(text, /OCR/);
    assert.match(text, /language model/i);
    // The asymmetry that justifies every human-review rule on the page.
    assert.match(text, /fails visibly and a language model fails plausibly/i);
  });

  test('it treats confidence thresholds as a business decision, not a setting', () => {
    assert.match(text, /confidence/i);
    assert.match(text, /threshold/i);
    assert.match(text, /exception queue/i);
  });

  test('it covers integration and the audit trail, not just extraction', () => {
    assert.match(text, /TMS/);
    assert.match(text, /idempot|retried write/i);
    assert.match(text, /audit trail/i);
  });

  test('it says plainly what must not be fully automated', () => {
    assert.match(text, /should not be fully automated/i);
    assert.match(text, /customs/i);
    assert.match(text, /claim/i);
  });

  test('it never claims perfect extraction or hallucination-free reading', () => {
    for (const pattern of [
      /100%\s*(accura|correct)/i,
      /perfect(ly)? accura/i,
      /never (makes )?(a )?mistake/i,
      /eliminates? (all )?errors/i,
      /hallucination[- ]free/i,
      /fully automated? end[- ]to[- ]end/i,
    ]) {
      assert.equal(pattern.test(text), false, `overclaim: ${pattern}`);
    }
    // And it states the limitation positively.
    assert.match(text, /Imperfectly|not well calibrated|do not assume/i);
  });

  test('it is substantial enough to deserve the ranking', () => {
    assert.ok(wordsOf(html) > 1200, `${wordsOf(html)} words — too thin for this intent`);
  });

  test('it links into the implementation and integration cluster', () => {
    const links = bodyLinks(html);
    assert.ok(links.has('/industries/logistics-transportation/'));
    assert.ok(links.has('/ai-implementation/'));
    assert.ok([...links].some((l) => l.startsWith('/resources/')), 'related resources must resolve');
  });

  test('the industry page still points at it', () => {
    assert.ok(bodyLinks(page('/industries/logistics-transportation/')).has(route));
  });
});

// ---------------------------------------------------------------------
// SEO priority 3 — the conversion-tracking cluster
//
// "ai conversion tracking" appeared at roughly position 47. The existing
// /conversion-tracking-analytics/ service page is strong and covers GTM,
// GA4, click IDs, offline imports and CRM handoff; over-specialising it
// to chase one query would damage the page that already works. A
// supporting resource answers the query, and the service page links to
// it.
// ---------------------------------------------------------------------

describe('The conversion-tracking cluster answers "ai conversion tracking" without breaking the service page', () => {
  const resourceRoute = '/resources/what-is-ai-conversion-tracking/';
  const resource = page(resourceRoute);
  const service = page('/conversion-tracking-analytics/');

  test('the resource exists, is indexable, and is in the sitemap', () => {
    assert.equal(/<meta name="robots"/.test(resource), false);
    assert.ok(resource.includes(`<link rel="canonical" href="${SITE}${resourceRoute}">`));
    assert.ok(readFileSync(join(ROOT, 'public/sitemap.xml'), 'utf8').includes(`${SITE}${resourceRoute}`));
  });

  test('it answers the question in the query, in the title and the H1', () => {
    assert.match(titleOf(resource), /What Is AI Conversion Tracking/i);
    assert.ok(titleOf(resource).length <= 60, `title is ${titleOf(resource).length} chars`);
    assert.match(h1Of(resource), /AI Conversion Tracking/i);
  });

  test('it refuses the false claim rather than repeating it', () => {
    const text = visibleText(mainContent(resource));
    assert.match(text, /AI does not track conversions/i);
    for (const pattern of [
      /AI tracks everything automatically/i,
      /no tags? (are )?(needed|required)/i,
      /replaces? (your )?(tag|GTM|GA4|tracking)/i,
    ]) {
      assert.equal(pattern.test(text), false, `the resource repeats the false claim: ${pattern}`);
    }
  });

  test('it names the deterministic chain AI cannot replace', () => {
    const text = visibleText(mainContent(resource));
    for (const term of ['gclid', 'UTM', 'GA4', 'Google Tag Manager', 'CRM', 'offline']) {
      assert.ok(text.includes(term), `missing ${term} from the deterministic chain`);
    }
  });

  test('it says where AI genuinely does help, so it is not merely a debunking', () => {
    const text = visibleText(mainContent(resource));
    assert.match(text, /classif/i);
    assert.match(text, /lead quality|scoring lead/i);
    assert.match(text, /conversion value|value sent back|better conversion values/i);
    // Modelled conversions are real and must not be lumped in with the
    // vendor claim being warned about.
    assert.match(text, /Modelled conversions are real/i);
  });

  test('the service page keeps its own scope and gains a section, not a rewrite', () => {
    const h2s = h2sOf(service).join(' | ');
    // The pre-existing argument is intact.
    assert.match(h2s, /A Click Is Not a Customer/);
    assert.match(h2s, /Tag Management and Event Architecture/);
    assert.match(h2s, /Feeding Real Outcomes Back to Google Ads/);
    // And the new one is present.
    assert.match(h2s, /AI Does Not Track Conversions/i);
  });

  test('service and resource link to each other, and do not duplicate intent', () => {
    assert.ok(bodyLinks(service).has(resourceRoute), 'the service page must link to the resource');
    assert.ok(bodyLinks(resource).has('/conversion-tracking-analytics/'), 'the resource must link to the service');
    assert.notEqual(titleOf(service), titleOf(resource));
    assert.notEqual(h1Of(service), h1Of(resource));
  });
});

// ---------------------------------------------------------------------
// Industry pages: consistency, and the three carrying demand signals.
//
// The industry pages were built across several sprints and drifted into
// two tiers. The later ones carried BreadcrumbList schema, an FAQ, a
// fit/not-fit section and links into the resource cluster; nine earlier
// ones carried none of that, because the pattern lived in whichever page
// happened to be open when the next one was written.
// ---------------------------------------------------------------------

import { INDUSTRIES } from '../src/lib/industries.ts';

describe('Every industry page carries breadcrumb schema', () => {
  test('all 28 emit a BreadcrumbList, from the shared component', () => {
    for (const industry of INDUSTRIES) {
      const html = page(industry.href);
      assert.ok(html.includes('"@type":"BreadcrumbList"'), `${industry.href}: no breadcrumb schema`);
    }
    // The component, not 28 copies — which is how nine of them ended up
    // without it in the first place.
    const usingComponent = INDUSTRIES.filter((i) =>
      readFileSync(join(ROOT, `src/pages${i.href}index.astro`), 'utf8').includes('<BreadcrumbSchema'),
    );
    assert.equal(usingComponent.length, INDUSTRIES.length, 'every industry page must use BreadcrumbSchema.astro');
    for (const industry of INDUSTRIES) {
      const src = readFileSync(join(ROOT, `src/pages${industry.href}index.astro`), 'utf8');
      assert.equal(src.includes("'@type': 'BreadcrumbList'"), false, `${industry.href}: still inlines the schema`);
    }
  });

  test('the crumb trail is Home / Industries / the page, with correct positions and URLs', () => {
    for (const industry of INDUSTRIES) {
      const html = page(industry.href);
      const block = html.match(/\{"@context":"https:\/\/schema\.org","@type":"BreadcrumbList"[\s\S]*?\}\]\}/)?.[0];
      assert.ok(block, `${industry.href}: breadcrumb JSON not found`);
      const parsed = JSON.parse(block!);
      assert.equal(parsed.itemListElement.length, 3);
      assert.deepEqual(parsed.itemListElement.map((e: any) => e.position), [1, 2, 3]);
      assert.equal(parsed.itemListElement[0].item, SITE);
      assert.equal(parsed.itemListElement[1].item, `${SITE}/industries/`);
      assert.equal(parsed.itemListElement[2].item, SITE + industry.href, `${industry.href}: last crumb points elsewhere`);
    }
  });

  test('the final crumb matches what the page calls itself, not a nav label', () => {
    // /industries/home-services/ is listed in the nav registry as
    // "Home Services (Overview)" to disambiguate a dropdown. Schema has
    // to match visible content, and no visitor sees "(Overview)" as the
    // page identity — though the mega-menu is still free to use it.
    const html = page('/industries/home-services/');
    const block = html.match(/\{"@context":"https:\/\/schema\.org","@type":"BreadcrumbList"[\s\S]*?\}\]\}/)![0];
    const last = JSON.parse(block).itemListElement[2];
    assert.equal(last.name, 'Home Services');
    assert.equal(last.item, `${SITE}/industries/home-services/`);
  });
});

describe('The three industry pages behind this sprint\'s demand signals', () => {
  const targets = [
    { route: '/industries/hvac/', label: 'HVAC' },
    { route: '/industries/law-firms/', label: 'law firms' },
    { route: '/industries/roofing/', label: 'roofing' },
  ];

  test('each is now substantial rather than a stub', () => {
    for (const { route, label } of targets) {
      const html = page(route);
      assert.ok(wordsOf(html) > 900, `${label}: ${wordsOf(html)} words is still a stub`);
      assert.ok(h2sOf(html).length >= 6, `${label}: only ${h2sOf(html).length} sections`);
    }
  });

  test('each answers objections and qualifies the reader', () => {
    for (const { route, label } of targets) {
      const html = page(route);
      const text = visibleText(mainContent(html));
      assert.match(h2sOf(html).join(' | '), /Common Questions/i, `${label}: no FAQ`);
      assert.match(text, /Probably not the right fit if/i, `${label}: no disqualification`);
      // Disclosure is a position this business takes, not a footnote.
      assert.match(text, /talking to an AI|speaking to an AI/i, `${label}: no disclosure answer`);
    }
  });

  test('each links into services and the resource cluster', () => {
    for (const { route, label } of targets) {
      const links = bodyLinks(page(route));
      for (const target of ['/ai-agent-development/', '/ai-crm-integration/', '/conversion-tracking-analytics/']) {
        assert.ok(links.has(target), `${label}: missing link to ${target}`);
      }
      const resources = [...links].filter((l) => l.startsWith('/resources/'));
      assert.ok(resources.length >= 3, `${label}: only ${resources.length} resource links`);
    }
  });

  test('none of them tells an owner to replace their staff', () => {
    for (const { route, label } of targets) {
      const text = visibleText(mainContent(page(route)));
      for (const pattern of [
        /replace (your |their )?(staff|employees|team|CSRs?|intake staff)/i,
        /\bfire (your|their) \w+/i,
        /\bcut headcount\b/i,
      ]) {
        assert.equal(pattern.test(text), false, `${label}: staff-replacement framing — ${pattern}`);
      }
      assert.match(text, /(No\.|no,) /i, 'the FAQ answers the question directly');
    }
  });

  test('HVAC answers the "AI CSR" query specifically', () => {
    const html = page('/industries/hvac/');
    assert.match(h2sOf(html).join(' | '), /AI CSR/i, 'the query needs its own section heading');
    const text = visibleText(mainContent(html));
    assert.match(text, /answering service/i, 'the section must distinguish itself from an answering service');
    assert.match(text, /dispatch/i);
    assert.match(text, /after[- ]hours/i);
    assert.match(text, /overflow|heat wave|surge/i);
    // And it must not claim AI does the technician's job.
    assert.equal(/AI can diagnose|diagnoses? (the )?(problem|fault)/i.test(text), false);
  });

  test('the law-firm page keeps legal judgment with attorneys, explicitly', () => {
    const text = visibleText(mainContent(page('/industries/law-firms/')));
    assert.match(text, /without giving legal advice|practice of law/i);
    assert.match(text, /conflicts check/i, 'a firm will ask about conflicts before anything else');
    assert.match(text, /retention|how long it is kept/i, 'intake accumulates data on non-clients');
    assert.equal(/\bAI (attorney|lawyer|paralegal)\b/i.test(text), false);
  });

  test('the roofing page promises no jobs, revenue, or claim outcomes', () => {
    const text = visibleText(mainContent(page('/industries/roofing/')));
    for (const pattern of [
      /\bguarantee/i,
      /\bclose rate\b/i,
      /\b\d{1,3}\s?% (more|increase|higher)/i,
      /assess(es)? (storm )?damage automatically/i,
    ]) {
      assert.equal(pattern.test(text), false, `roofing: ${pattern}`);
    }
    assert.match(text, /storm|hail/i);
    assert.match(text, /insurance/i);
  });

  test('the organic industry pages and the /go/ campaign pages stay distinct', () => {
    // Same audience, different job. If their H1s or titles converged,
    // the noindex would be papering over a real duplication.
    for (const [organic, campaign] of [
      ['/industries/law-firms/', '/go/law-firms/'],
      ['/industries/roofing/', '/go/roofing/'],
    ]) {
      const a = page(organic);
      const b = page(campaign);
      assert.notEqual(titleOf(a), titleOf(b));
      assert.notEqual(h1Of(a), h1Of(b));
      assert.notEqual(descOf(a), descOf(b));
      // And the organic page is the one that gets to be indexed.
      assert.equal(/<meta name="robots"/.test(a), false, `${organic} must stay indexable`);
      assert.match(b, /<meta name="robots" content="noindex, follow">/);
    }
  });
});
