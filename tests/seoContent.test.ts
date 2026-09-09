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
