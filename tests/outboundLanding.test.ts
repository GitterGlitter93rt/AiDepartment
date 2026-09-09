// Cold-email outbound landing-page contract.
// Run with: node --experimental-strip-types --test tests/outboundLanding.test.ts
// (requires dist/ — run `npm run build` first.)
//
// Three layers, same discipline as tests/paidSocialFunnels.test.ts:
//   1. CONFIG    — the real objects from src/data/outbound/
//   2. BUILT     — the actual HTML in dist/, so a claim about the page
//                  is a claim about what ships
//   3. ANALYTICS — the pure builders, asserted payload by payload
//
// The rules encoded here are the ones that make these pages safe to
// point cold traffic at: they must not enter the index, must not
// fabricate outcomes, must not imply staff replacement, and must not
// report a click as a booking.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { OUTBOUND_PAGES, OUTBOUND_BY_CAMPAIGN } from '../src/data/outbound/index.ts';
import { SCHEDULING } from '../src/lib/scheduling.ts';
import {
  OUTBOUND_EVENTS,
  ENGAGEMENT_SIGNALS,
  DWELL_THRESHOLD_MS,
  buildOutboundViewParams,
  buildOutboundEngagedParams,
  buildOutboundCtaClickParams,
  isPiiFreeOutboundPayload,
  type OutboundIdentity,
} from '../src/lib/outbound/analytics.ts';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const SITE = 'https://youraidepartment.ai';

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const OUTBOUND_ROUTES = ['/go/law-firms/', '/go/roofing/'];
const built: Record<string, string> = {};
for (const route of OUTBOUND_ROUTES) {
  const file = join(DIST, route.slice(1), 'index.html');
  assert.ok(existsSync(file), `${route} must be built before this suite runs (npm run build)`);
  built[route] = readFileSync(file, 'utf8');
}

/** Markup with <style> and <script> removed, so a CSS selector or a
 * string inside a script can never mask or fake a structural result. */
function stripCode(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ');
}

function visibleText(html: string): string {
  return stripCode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ');
}

/** Just <main> — the shared minimal header/footer is not part of the
 * page's section budget. */
function mainContent(html: string): string {
  const s = stripCode(html);
  return s.slice(s.indexOf('<main'), s.indexOf('</main>'));
}

/** Every string a human will read on the page, straight from config. */
function configText(page: (typeof OUTBOUND_PAGES)[number]): string {
  return JSON.stringify(page);
}

// ============================================================
// 1. ROUTES AND STRUCTURE
// ============================================================

describe('Outbound routes exist and are data-driven', () => {
  test('the registry matches the routes on disk', () => {
    assert.equal(OUTBOUND_PAGES.length, 2);
    assert.deepEqual(OUTBOUND_PAGES.map((p) => p.path).sort(), [...OUTBOUND_ROUTES].sort());
    for (const key of ['slug', 'path', 'audience', 'campaignId', 'contentPrefix'] as const) {
      const values = OUTBOUND_PAGES.map((p) => p[key]);
      assert.equal(new Set(values).size, values.length, `${key} must be unique per page`);
    }
    for (const page of OUTBOUND_PAGES) {
      assert.equal(OUTBOUND_BY_CAMPAIGN[page.campaignId], page);
    }
  });

  test('each route is a three-line file that hands its config to the shared layout', () => {
    for (const page of OUTBOUND_PAGES) {
      const route = read(`src/pages${page.path}index.astro`);
      assert.ok(route.includes('OutboundLayout'), `${page.path} must use the shared layout`);
      assert.ok(route.includes(`data/outbound/${page.slug}`), `${page.path} must import its own config`);
      assert.equal(route.includes('<section'), false, `${page.path} must not inline page markup`);
    }
  });

  test('campaign_id and the recommended utm_campaign are the same string', () => {
    // A GA4 report grouped by campaign_id and one grouped by
    // utm_campaign must line up without a lookup table.
    for (const page of OUTBOUND_PAGES) {
      assert.match(page.campaignId, /^[a-z0-9_]+$/, 'campaign ids are lowercase snake_case, like the UTM values');
      assert.ok(page.campaignId.endsWith('_outbound'), `${page.campaignId}: cold-email campaigns are suffixed _outbound`);
    }
  });

  test('exactly one server-rendered H1, carrying the configured headline', () => {
    for (const page of OUTBOUND_PAGES) {
      const body = mainContent(built[page.path]);
      const h1s = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
      assert.equal(h1s.length, 1, `${page.path}: expected exactly one H1`);
      const text = h1s[0][1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      assert.ok(text.includes(page.hero.headline.trim()), `${page.path}: H1 missing headline`);
      if (page.hero.headlineLine2) {
        assert.ok(text.includes(page.hero.headlineLine2.trim()), `${page.path}: H1 missing second line`);
        const concatenated = page.hero.headline.trim() + page.hero.headlineLine2.trim();
        assert.equal(text.includes(concatenated), false, `${page.path}: headline lines concatenated without a space`);
      }
    }
  });

  test('heading levels never skip', () => {
    for (const page of OUTBOUND_PAGES) {
      const levels = [...mainContent(built[page.path]).matchAll(/<h([1-6])[^>]*>/g)].map((m) => Number(m[1]));
      assert.equal(levels[0], 1, `${page.path}: first heading must be the H1`);
      for (let i = 1; i < levels.length; i++) {
        assert.ok(levels[i] - levels[i - 1] <= 1, `${page.path}: heading level jump ${levels[i - 1]} -> ${levels[i]}`);
      }
    }
  });
});

describe('These pages stay short — a cold reader was interrupted, not shopping', () => {
  test('six sections, no more', () => {
    for (const page of OUTBOUND_PAGES) {
      const sections = (mainContent(built[page.path]).match(/<section/g) || []).length;
      assert.equal(sections, 6, `${page.path}: ${sections} sections — the cold-email budget is exactly 6`);
    }
  });

  test('word count stays inside the cold-email budget', () => {
    for (const page of OUTBOUND_PAGES) {
      const words = visibleText(built[page.path]).trim().split(/\s+/).length;
      assert.ok(words < 1600, `${page.path}: ${words} words — this is a cold-email page, reduce rather than add`);
      assert.ok(words > 500, `${page.path}: ${words} words is implausibly thin`);
    }
  });

  test('the counts in the config contract are actually held', () => {
    for (const page of OUTBOUND_PAGES) {
      assert.equal(page.capabilities.items.length, 6, `${page.slug}: six capability blocks`);
      assert.equal(page.flow.steps.length, 6, `${page.slug}: the chain is six stages`);
      assert.equal(page.call.items.length, 3, `${page.slug}: three things the call contains`);
      assert.ok(page.call.faqs.length >= 4 && page.call.faqs.length <= 5, `${page.slug}: 4-5 FAQs, not ten`);
      assert.ok(page.boundaries.items.length >= 3 && page.boundaries.items.length <= 4, `${page.slug}: 3-4 boundaries`);
      assert.ok((page.hero.bullets ?? []).length <= 3, `${page.slug}: at most three hero bullets`);
    }
  });
});

// ============================================================
// 2. INDEXATION — these must never compete with the organic pages
// ============================================================

describe('Campaign destinations, not doorway pages', () => {
  test('every page is noindex, follow', () => {
    for (const page of OUTBOUND_PAGES) {
      assert.equal(page.seo.robots, 'noindex, follow');
      assert.match(built[page.path], /<meta name="robots" content="noindex, follow">/);
    }
  });

  test('no canonical is emitted — a noindex page has no indexable URL to consolidate', () => {
    for (const route of OUTBOUND_ROUTES) {
      assert.equal(/rel="canonical"/.test(built[route]), false, `${route}: canonical on a noindex page`);
    }
  });

  test('neither route is in the sitemap', () => {
    const sitemap = read('public/sitemap.xml');
    for (const route of OUTBOUND_ROUTES) {
      assert.equal(sitemap.includes(SITE + route), false, `${route} must not be in the sitemap`);
      assert.equal(sitemap.includes(route), false, `${route} must not appear in the sitemap at all`);
    }
  });

  test('the organic industry pages they overlap are still indexable and unaffected', () => {
    // The whole reason these are noindex: /industries/law-firms/ and
    // /industries/roofing/ target the same audience organically, and
    // two of our own pages competing for one query helps nobody.
    for (const organic of ['/industries/law-firms/', '/industries/roofing/']) {
      const html = readFileSync(join(DIST, organic.slice(1), 'index.html'), 'utf8');
      assert.equal(/<meta name="robots"/.test(html), false, `${organic}: must stay indexable`);
      assert.ok(html.includes(`<link rel="canonical" href="${SITE}${organic}">`), `${organic}: self-canonical`);
      assert.ok(read('public/sitemap.xml').includes(SITE + organic), `${organic}: must stay in the sitemap`);
    }
  });

  test('no indexable page links into /go/, so the campaign pages cannot leak into discovery', () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'src'), ['.astro', '.ts', '.mdx', '.md'])) {
      if (file.includes('/src/pages/go/') || file.includes('/src/data/outbound/')) continue;
      const src = readFileSync(file, 'utf8');
      if (src.includes('href="/go/') || src.includes("href: '/go/") || src.includes('href: "/go/')) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    assert.deepEqual(offenders, [], 'campaign pages are reached from email, never from site navigation');
  });

  test('the campaign pages carry minimal chrome, not the full site navigation', () => {
    for (const route of OUTBOUND_ROUTES) {
      const html = built[route];
      assert.ok(html.includes('fnl-header'), `${route}: minimal funnel header missing`);
      // The site mega-menu header would bring dozens of destinations to
      // a page whose job is one decision.
      assert.equal(html.includes('data-mega-menu'), false, `${route}: full site navigation shipped`);
    }
  });
});

// ============================================================
// 3. THE ASK — strategy call primary, assessment secondary
// ============================================================

describe('The call is the ask; the assessment is the alternative', () => {
  test('every booking CTA is the centralized strategy-call event', () => {
    for (const page of OUTBOUND_PAGES) {
      for (const cta of [page.hero.cta, page.call.cta, page.close.cta]) {
        assert.equal(cta.href, SCHEDULING.strategyCall.url, `${page.slug}: CTA is not the centralized strategy call`);
        assert.equal(cta.type, 'strategy_call');
      }
    }
  });

  test('no Cal.com URL is hardcoded anywhere in the outbound source', () => {
    const files = walk(join(ROOT, 'src'), ['.astro', '.ts']).filter(
      (f) => f.includes('/outbound/') || f.includes('/src/pages/go/'),
    );
    assert.ok(files.length >= 5, 'expected the outbound module, components, data and routes');
    for (const file of files) {
      assert.equal(
        readFileSync(file, 'utf8').includes('https://cal.com/'),
        false,
        `${file.slice(ROOT.length + 1)} hardcodes a Cal.com URL`,
      );
    }
  });

  test('the booking link reaches the built page unmodified so site-wide enrichment applies', () => {
    // AttributionCapture.astro rewrites these hrefs at runtime to carry
    // UTMs, click IDs and the rep code. That only works if the markup
    // ships the bare centralized URL.
    const escaped = SCHEDULING.strategyCall.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const route of OUTBOUND_ROUTES) {
      const count = (mainContent(built[route]).match(new RegExp(escaped, 'g')) || []).length;
      assert.ok(count >= 4, `${route}: expected the centralized booking URL on every CTA (found ${count})`);
    }
  });

  test('the secondary CTA is the free assessment, not the legacy chooser route', () => {
    for (const page of OUTBOUND_PAGES) {
      assert.equal(page.hero.secondaryCta.href, '/free-ai-assessment/');
      assert.equal(page.hero.secondaryCta.type, 'assessment');
    }
    for (const route of OUTBOUND_ROUTES) {
      const body = mainContent(built[route]);
      assert.ok(body.includes('href="/free-ai-assessment/"'));
      assert.equal(body.includes('href="/ai-assessment/"'), false, `${route}: links to the legacy chooser`);
      assert.equal(body.includes('href="/ai-assessment/full/'), false, `${route}: links to the internal engine`);
    }
  });

  test('the assessment appears once, and after the booking CTA in source order', () => {
    // "Secondary" has to be true of the page, not just of the config.
    for (const route of OUTBOUND_ROUTES) {
      const body = mainContent(built[route]);
      assert.equal((body.match(/href="\/free-ai-assessment\/"/g) || []).length, 1, `${route}: one assessment link`);
      assert.ok(
        body.indexOf(SCHEDULING.strategyCall.url) < body.indexOf('/free-ai-assessment/'),
        `${route}: the strategy call must come first`,
      );
    }
  });

  test('CTA placements are hero / mid / faq / final plus the sticky bar', () => {
    for (const route of OUTBOUND_ROUTES) {
      const body = mainContent(built[route]);
      const locations = [...body.matchAll(/data-cta-location="([^"]+)"/g)].map((m) => m[1]);
      const types = [...body.matchAll(/data-cta-type="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(locations.length, types.length, `${route}: every CTA needs both attributes`);
      assert.deepEqual(locations, ['hero', 'hero', 'mid', 'faq', 'final', 'sticky'], `${route}: unexpected CTA placement`);
      // The two hero entries are the primary call and the secondary
      // assessment — the only place the page offers a choice.
      assert.deepEqual(types, ['strategy_call', 'assessment', 'strategy_call', 'strategy_call', 'strategy_call', 'strategy_call']);
    }
  });

  test('the CTA label is message-matched to the ask and identical at every placement', () => {
    for (const page of OUTBOUND_PAGES) {
      const label = page.hero.cta.label;
      assert.match(label, /Strategy Call/i);
      assert.match(label, /30-Minute/i, 'the length of the commitment belongs in the label');
      assert.match(label, /Free/i);
      for (const cta of [page.call.cta, page.close.cta]) {
        assert.equal(cta.label, label, `${page.slug}: CTA wording must not drift between placements`);
      }
      assert.ok(page.hero.cta.compactLabel, `${page.slug}: the sticky bar needs a short label`);
      assert.ok(page.hero.cta.compactLabel!.length < label.length);
    }
  });
});

// ============================================================
// 4. CONTENT GUARDRAILS
// ============================================================

describe('Nothing on these pages is invented', () => {
  const FABRICATION_PATTERNS: [RegExp, string][] = [
    [/\b\d{1,3}\s?% (more|increase|higher|growth|conversion|close)/i, 'a fabricated performance percentage'],
    [/\b(guarantee|guaranteed)\b/i, 'a guarantee'],
    [/\bROI\b/i, 'an ROI claim'],
    [/\b\d+x\b/i, 'a multiplier claim'],
    [/\btestimonial|our clients say|trusted by\b/i, 'social proof we do not have'],
    [/\b(case study|case studies)\b/i, 'a case study'],
    [/\baverage (case|job|deal) value\b/i, 'an invented deal value'],
  ];

  test('no fabricated statistics, guarantees, or social proof in the visible copy', () => {
    for (const route of OUTBOUND_ROUTES) {
      const text = visibleText(built[route]);
      for (const [pattern, what] of FABRICATION_PATTERNS) {
        const match = text.match(pattern);
        assert.equal(match, null, `${route}: ${what} — "${match?.[0]}"`);
      }
    }
  });

  test('no price is published to a cold prospect', () => {
    // Not because pricing is secret — /comprehensive-ai-business-audit/
    // publishes its price. Because no price has been approved for cold
    // outbound, and scope has not been established with a stranger.
    for (const route of OUTBOUND_ROUTES) {
      const text = visibleText(built[route]);
      assert.equal(/\$\s?[\d,]+/.test(text), false, `${route}: a price reached a cold-email page`);
    }
    for (const page of OUTBOUND_PAGES) {
      assert.equal(/\$\s?[\d,]+/.test(configText(page)), false, `${page.slug}: a price is configured`);
    }
  });

  test('nothing implies replacing people', () => {
    for (const route of OUTBOUND_ROUTES) {
      const text = visibleText(built[route]);
      for (const pattern of [
        /replace (your |their )?(staff|employees|team|people|receptionist|intake staff)/i,
        /\bfire (your|their) \w+/i,
        /\bwithout (any )?(staff|employees|humans)\b/i,
        /\bcut headcount\b/i,
      ]) {
        assert.equal(pattern.test(text), false, `${route}: staff-replacement framing — ${pattern}`);
      }
      // And the positive form must be present: this is an argument the
      // page makes, not just a phrase it avoids.
      assert.match(text, /(Nobody gets replaced|not the practice of law|Capacity|capacity)/);
    }
  });

  test('the law-firm page never claims AI performs legal work', () => {
    const text = visibleText(built['/go/law-firms/']);
    for (const pattern of [
      /AI (that )?(gives|provides|offers) legal advice/i,
      /\bAI (attorney|lawyer|paralegal)\b/i,
      /\bautomate (legal )?(judgment|advice)\b/i,
    ]) {
      assert.equal(pattern.test(text), false, `law firms: ${pattern}`);
    }
    assert.match(text, /Human judgment stays with your team/i);
    assert.match(text, /not the practice of law/i);
  });

  test('the roofing page never promises booked jobs or revenue', () => {
    const text = visibleText(built['/go/roofing/']);
    for (const pattern of [
      /\b(more|guaranteed) (booked )?(jobs|revenue|sales)\b/i,
      /\bwe will (get|book) you\b/i,
      /\bclose rate\b/i,
    ]) {
      assert.equal(pattern.test(text), false, `roofing: ${pattern}`);
    }
    assert.match(text, /No promises about booked jobs/i);
  });

  test('both pages say plainly that they work with existing systems', () => {
    for (const route of OUTBOUND_ROUTES) {
      assert.match(visibleText(built[route]), /(work with (your|what you already)|existing systems|already run|already use)/i);
    }
  });
});

// ============================================================
// 5. ANALYTICS CONTRACT
// ============================================================

describe('Outbound analytics measure the far side of the click', () => {
  const identity: OutboundIdentity = { audience: 'roofing', campaign_id: 'roofing_outbound' };
  const campaign = {
    utm_id: 'sl_roofing_20260820',
    utm_source: 'smartlead',
    utm_medium: 'email',
    utm_campaign: 'roofing_outbound',
    utm_content: 'roof_e1_a',
  };

  test('the three event names are diagnostic names, not conversion names', () => {
    assert.deepEqual(Object.values(OUTBOUND_EVENTS), ['cold_lp_view', 'cold_lp_engaged', 'outbound_cta_click']);
    for (const event of Object.values(OUTBOUND_EVENTS)) {
      assert.notEqual(event, 'booking_confirmed');
      assert.equal(/^booking_click_/.test(event), false, `${event} must not look like a booking-click event`);
    }
  });

  test('a click on a /go/ page never emits a booking_click_* or booking_confirmed event', () => {
    // booking_click_strategy still fires for the primary CTA — from the
    // site-wide tracker, exactly as it does everywhere else. What must
    // not happen is this module inventing a second one, or translating
    // an ASSESSMENT click into booking intent.
    // String literals only. Both files explain in prose why they do
    // NOT emit these, and a comment saying so must not read as a
    // violation — only a quoted event name could actually be pushed.
    for (const rel of ['src/components/outbound/OutboundAnalytics.astro', 'src/lib/outbound/analytics.ts']) {
      const src = read(rel);
      const literals = [...src.matchAll(/['"`]([a-z_]+)['"`]/g)].map((m) => m[1]);
      for (const literal of literals) {
        assert.equal(/^booking_click_/.test(literal), false, `${rel}: emits ${literal}`);
        assert.notEqual(literal, 'booking_confirmed', `${rel}: emits booking_confirmed`);
      }
    }
  });

  test('every payload carries audience and campaign_id', () => {
    const payloads = [
      buildOutboundViewParams(identity, campaign),
      buildOutboundEngagedParams(identity, 'dwell', campaign),
      buildOutboundCtaClickParams(identity, 'hero', 'strategy_call', campaign),
    ];
    for (const payload of payloads) {
      assert.equal(payload.audience, 'roofing');
      assert.equal(payload.campaign_id, 'roofing_outbound');
    }
  });

  test('all six UTM fields survive onto every event', () => {
    const payload = buildOutboundViewParams(identity, { ...campaign, utm_term: 'x' });
    for (const key of ['utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      assert.ok(key in payload, `${key} missing`);
    }
  });

  test('the campaign allowlist holds — a wider record cannot leak through', () => {
    const contaminated = {
      ...campaign,
      gclid: 'g-1',
      landing_page: '/go/roofing/',
      referrer: 'https://mail.google.com/',
      email: 'someone@example.com',
      first_name: 'Someone',
    } as any;
    for (const payload of [
      buildOutboundViewParams(identity, contaminated),
      buildOutboundEngagedParams(identity, 'interaction', contaminated),
      buildOutboundCtaClickParams(identity, 'final', 'strategy_call', contaminated),
    ]) {
      for (const leaked of ['gclid', 'landing_page', 'referrer', 'email', 'first_name']) {
        assert.equal(leaked in payload, false, `${leaked} leaked into an outbound event`);
      }
      assert.ok(isPiiFreeOutboundPayload(payload));
    }
    assert.equal(isPiiFreeOutboundPayload({ email: 'x' }), false, 'the guard still works');
    assert.equal(isPiiFreeOutboundPayload({ audience: 'roofing', utm_content: 'x' }), true);
  });

  test('an organic visitor produces no blank parameters', () => {
    for (const empty of [undefined, null, {}]) {
      const payload = buildOutboundViewParams(identity, empty);
      assert.deepEqual(Object.keys(payload).sort(), ['audience', 'campaign_id']);
    }
    assert.equal('rep_code' in buildOutboundViewParams(identity, campaign, null), false);
    assert.equal('rep_code' in buildOutboundViewParams(identity, campaign, ''), false);
    assert.equal(buildOutboundViewParams(identity, campaign, 'tony').rep_code, 'tony');
  });

  test('the CTA event separates the call from the assessment', () => {
    const call = buildOutboundCtaClickParams(identity, 'hero', 'strategy_call', campaign);
    const assessment = buildOutboundCtaClickParams(identity, 'hero', 'assessment', campaign);
    assert.equal(call.cta_type, 'strategy_call');
    assert.equal(assessment.cta_type, 'assessment');
    assert.equal(call.cta_location, 'hero');
    // Same event name, different parameter — one metric for "a cold
    // reader chose something", separable by which thing they chose.
    assert.equal(OUTBOUND_EVENTS.ctaClick, 'outbound_cta_click');
  });

  test('engagement is a parameter on one event, not two competing events', () => {
    assert.deepEqual([...ENGAGEMENT_SIGNALS], ['interaction', 'dwell']);
    for (const signal of ENGAGEMENT_SIGNALS) {
      assert.equal(buildOutboundEngagedParams(identity, signal).engagement_signal, signal);
    }
  });

  test('the dwell threshold is measured in visible time, and is neither trivial nor unreachable', () => {
    assert.ok(DWELL_THRESHOLD_MS >= 10_000, 'too short to distinguish a render from a read');
    assert.ok(DWELL_THRESHOLD_MS <= 30_000, 'too long — a real reader of a short page would never reach it');
    const component = read('src/components/outbound/OutboundAnalytics.astro');
    assert.match(component, /visibilitychange/, 'dwell must not accrue while the tab is hidden');
    assert.match(component, /document\.visibilityState === 'visible'/);
  });

  test('view and engaged fire at most once per pageview, without adding a storage key', () => {
    const component = read('src/components/outbound/OutboundAnalytics.astro');
    assert.match(component, /let engagedFired = false/);
    assert.match(component, /if \(engagedFired\) return/);
    // Per-pageview facts belong in memory. A yai_* key here would also
    // break the site-wide storage-key inventory in
    // tests/paidSocialFunnels.test.ts.
    assert.equal(/yai_/.test(component), false, 'outbound analytics must not add a storage key');
    assert.equal(/localStorage|sessionStorage/.test(component), false);
  });

  test('the outbound pages reuse the shared attribution and rep modules', () => {
    const component = read('src/components/outbound/OutboundAnalytics.astro');
    assert.ok(component.includes("from '../../lib/attribution'"));
    assert.ok(component.includes("from '../../lib/repAttribution'"));
    assert.ok(component.includes('captureAttribution()'));
    assert.ok(component.includes('getCampaignAttribution()'));
    assert.ok(component.includes('getRepCode()'));
  });

  test('the analytics root ships with the page identity in the built HTML', () => {
    for (const page of OUTBOUND_PAGES) {
      const html = built[page.path];
      assert.ok(html.includes('id="ob-analytics-root"'), `${page.path}: analytics root missing`);
      assert.ok(html.includes(`data-audience="${page.audience}"`));
      assert.ok(html.includes(`data-campaign-id="${page.campaignId}"`));
      assert.ok(html.includes('data-funnel-cta'), `${page.path}: no tracked CTA`);
    }
  });

  test('the shared GTM container is the only tag loader, as everywhere else', () => {
    for (const route of OUTBOUND_ROUTES) {
      const html = built[route];
      assert.ok(html.includes('GTM-5G8Q7KKZ'), `${route}: shared container missing`);
      assert.equal(html.includes('googletagmanager.com/gtag/js'), false, `${route}: a second gtag install`);
      assert.equal(html.includes('connect.facebook.net'), false, `${route}: Meta script shipped`);
    }
  });
});

// ============================================================
// 6. DOCUMENTATION THE OPERATOR ACTUALLY USES
// ============================================================

describe('The Smartlead link standard matches the code', () => {
  const doc = read('docs/analytics/smartlead-campaign-links.md');

  test('every campaign has a documented destination and utm_campaign value', () => {
    for (const page of OUTBOUND_PAGES) {
      assert.ok(doc.includes(page.path), `${page.path} missing from the Smartlead link standard`);
      assert.ok(doc.includes(page.campaignId), `${page.campaignId} missing from the Smartlead link standard`);
      assert.ok(doc.includes(`${page.contentPrefix}1_a`), `${page.contentPrefix}1_a missing — utm_content examples must be documented`);
    }
  });

  test('the documented URLs are absolute, on the canonical host, and carry the standard fields', () => {
    for (const page of OUTBOUND_PAGES) {
      const line = doc
        .split('\n')
        .find((l) => l.includes(`${SITE}${page.path}?`) && l.includes(page.contentPrefix));
      assert.ok(line, `${page.path}: no complete example URL in the standard`);
      const url = new URL(line!.trim());
      assert.equal(url.origin + url.pathname, SITE + page.path);
      for (const field of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content']) {
        assert.ok(url.searchParams.get(field), `${page.path}: example URL missing ${field}`);
      }
      assert.equal(url.searchParams.get('utm_source'), 'smartlead');
      assert.equal(url.searchParams.get('utm_medium'), 'email');
      assert.equal(url.searchParams.get('utm_campaign'), page.campaignId);
    }
  });

  test('no prospect identifier is ever suggested as a UTM value', () => {
    // Against the example URLs, not the prose. The document explicitly
    // names these tokens in order to forbid them, which must not read
    // as a violation of its own rule.
    const urlLines = doc.split('\n').filter((l) => l.trim().startsWith('https://youraidepartment.ai/'));
    assert.ok(urlLines.length >= 8, 'expected the documented example URLs');
    for (const line of urlLines) {
      for (const forbidden of ['{{email}}', '{{first_name}}', '{{last_name}}', '{{phone}}', '{{company}}']) {
        assert.equal(line.includes(forbidden), false, `an example URL carries ${forbidden}`);
      }
    }
    // And the rule itself is stated, so a future author sees it.
    assert.match(doc, /Never in a UTM value/i);
  });
});

describe('The conversion event taxonomy is written down', () => {
  const doc = read('docs/analytics/conversion-event-taxonomy.md');

  test('every event this site emits appears in the taxonomy', () => {
    for (const event of [
      ...Object.values(OUTBOUND_EVENTS),
      'ai_assessment_start',
      'ai_assessment_complete',
      'ai_assessment_lead_submit',
      'booking_click_strategy',
      'booking_click_comprehensive_audit',
      'booking_confirmed',
      'resource_cta_click',
      'funnel_view',
      'funnel_cta_click',
      'contact_form_submit',
    ]) {
      assert.ok(doc.includes(event), `${event} is missing from the event taxonomy`);
    }
  });

  test('it states which events are conversions and which are diagnostics', () => {
    assert.match(doc, /booking_confirmed/);
    assert.match(doc, /qualified_lead/);
    // The mapping that stops a second, duplicate booking event being
    // added later.
    assert.match(doc, /call_booked/i);
  });
});
