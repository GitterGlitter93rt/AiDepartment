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
