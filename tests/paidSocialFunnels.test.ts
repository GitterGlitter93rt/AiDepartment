// Paid-social VSL funnel test suite (plumbing / personal injury /
// divorce & family law).
// Run with: node --experimental-strip-types --test tests/paidSocialFunnels.test.ts
// (npm test builds first; the built-output sections require dist/.)
//
// Three layers of assertion:
//   1. CONFIG — imported real objects from src/data/funnels/, so offer
//      pricing, CTA labels, and vertical identifiers are checked as
//      values rather than as source-text regexes.
//   2. BUILT OUTPUT — dist/*.html: robots directives, sitemap
//      exclusion, tracked CTA attributes, absence of fabricated proof,
//      absence of Meta credentials.
//   3. SOURCE CONTRACTS — "no hardcoded Cal.com URL", "no access token
//      anywhere in src/", typography and layout floors.
//
// ANTI-INFLATION BUDGETS. These pages were reduced ~50% in the
// conversion pass. The section, word, card, and item ceilings below
// exist so they cannot silently grow back into whitepapers: a funnel
// that needs another section needs a decision, not a commit.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

import { FUNNELS, FUNNELS_BY_ID } from '../src/data/funnels/index.ts';
import {
  FUNNEL_EVENTS,
  FUNNEL_BOOKING_CLICK_EVENTS,
  VSL_PROGRESS_THRESHOLDS,
  buildFunnelViewParams,
  buildCtaClickParams,
  buildVslPlayParams,
  buildVslProgressParams,
  buildBookingClickEvent,
  isPiiFreePayload,
} from '../src/lib/funnels/analytics.ts';
import { getMetaPixelId, META_CAPI_STATUS, META_EVENT_MAP } from '../src/lib/metaPixel.ts';
import { SCHEDULING } from '../src/lib/scheduling.ts';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

assert.ok(
  existsSync(join(DIST, 'index.html')),
  'dist/ must exist before this suite runs — `npm test` builds first'
);

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.includes(extname(full))) out.push(full);
  }
  return out;
}

const SRC_FILES = walk(join(ROOT, 'src'), ['.astro', '.ts', '.tsx', '.mdx']);

const FUNNEL_ROUTES = ['/plumbing-ai/', '/personal-injury-ai/', '/divorce-law-ai/'];
const builtFunnel: Record<string, string> = {};
for (const route of FUNNEL_ROUTES) {
  builtFunnel[route] = readFileSync(join(DIST, route.slice(1), 'index.html'), 'utf8');
}

/** Markup with <style> and <script> removed. Every structural count and
 * every "must not say X" check runs against this, so CSS percentages
 * and script-internal selector strings can never mask (or fake) a
 * result. */
function stripCode(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ');
}

/** Visible page copy. */
function visibleText(html: string): string {
  return stripCode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ');
}

/** Just the <main> content — excludes the shared header/footer chrome,
 * which is not part of a funnel's section budget. */
function mainContent(html: string): string {
  const s = stripCode(html);
  return s.slice(s.indexOf('<main'), s.indexOf('</main>'));
}

function wordCount(html: string): number {
  return mainContent(html).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length;
}

/**
 * Occurrences of `word` that are NOT in a negating context.
 *
 * These funnels legitimately name what they refuse to do — "not an
 * unlimited plan", "not a product with a checkout", "Not on a
 * Testimonial". A blanket word ban would forbid exactly the honest
 * disclosures the brief requires, so the guard checks for the
 * ASSERTION rather than the word. Combined with the structural checks
 * (no blockquote/cite/rating markup, no review schema) this still
 * catches a real fabricated-proof or checkout section.
 */
function unnegatedMentions(text: string, word: RegExp): string[] {
  const negation = /\b(not|no|never|without|instead of|rather than|don't|cannot|refuse)\b/i;
  const out: string[] = [];
  for (const match of text.matchAll(new RegExp(word.source, 'gi'))) {
    const before = text.slice(Math.max(0, match.index! - 90), match.index!);
    if (!negation.test(before)) out.push(text.slice(Math.max(0, match.index! - 60), match.index! + 60));
  }
  return out;
}

// ============================================================
// 1. ROUTES + SECTION BUDGET
// ============================================================

describe('Funnel routes exist', () => {
  test('all three funnel pages exist in src and in the build', () => {
    for (const [srcPath, route] of [
      ['src/pages/plumbing-ai/index.astro', '/plumbing-ai/'],
      ['src/pages/personal-injury-ai/index.astro', '/personal-injury-ai/'],
      ['src/pages/divorce-law-ai/index.astro', '/divorce-law-ai/'],
    ] as const) {
      assert.ok(existsSync(srcPath), `${srcPath} must exist`);
      assert.ok(existsSync(join(DIST, route.slice(1), 'index.html')), `${route} must be built`);
    }
  });

  test('registry exposes exactly three funnels with unique identifiers', () => {
    assert.equal(FUNNELS.length, 3);
    for (const key of ['slug', 'path', 'funnelId', 'vertical'] as const) {
      const values = FUNNELS.map((f) => f[key]);
      assert.equal(new Set(values).size, 3, `${key} must be unique across funnels`);
    }
    assert.deepEqual(FUNNELS.map((f) => f.path).sort(), [...FUNNEL_ROUTES].sort());
  });

  test('each route renders its own config (thin route, shared renderer)', () => {
    for (const funnel of FUNNELS) {
      const page = read(`src/pages${funnel.path}index.astro`);
      assert.ok(page.includes('FunnelLayout'), `${funnel.path} must use the shared layout`);
      assert.ok(page.includes(`data/funnels/${funnel.slug}`), `${funnel.path} must import its own config`);
      assert.equal(page.includes('<section'), false, `${funnel.path} must not inline page markup`);
    }
  });

  test('one server-rendered H1 per funnel, with the two headline lines separated', () => {
    for (const funnel of FUNNELS) {
      const body = mainContent(builtFunnel[funnel.path]);
      const h1s = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
      assert.equal(h1s.length, 1, `${funnel.path}: expected exactly one H1`);
      const text = h1s[0][1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      assert.ok(text.includes(funnel.hero.headline.trim()), `${funnel.path}: H1 missing headline`);
      if (funnel.hero.headlineLine2) {
        assert.ok(text.includes(funnel.hero.headlineLine2.trim()), `${funnel.path}: H1 missing second line`);
        // Regression guard against "...Booked JobsWithout Hiring...".
        const concatenated = funnel.hero.headline.trim() + funnel.hero.headlineLine2.trim().slice(0, 6);
        assert.equal(text.includes(concatenated), false, `${funnel.path}: headline lines concatenated without a space`);
      }
    }
  });

  test('heading hierarchy is clean (single H1, no skipped levels)', () => {
    for (const funnel of FUNNELS) {
      const levels = [...mainContent(builtFunnel[funnel.path]).matchAll(/<h([1-6])[^>]*>/g)].map((m) => Number(m[1]));
      assert.equal(levels[0], 1, `${funnel.path}: first heading must be the H1`);
      for (let i = 1; i < levels.length; i++) {
        assert.ok(levels[i] - levels[i - 1] <= 1, `${funnel.path}: heading level jump ${levels[i - 1]} -> ${levels[i]}`);
      }
    }
  });
});

describe('SECTION BUDGET — pages must stay tight', () => {
  // These are paid-social landing pages read on a phone straight after
  // a short video ad, not proposals. The ceilings are the point.
  const BUDGET: Record<string, { minSections: number; maxSections: number; maxWords: number; maxCards: number }> = {
    plumbing_ai: { minSections: 6, maxSections: 8, maxWords: 2100, maxCards: 12 },
    personal_injury_ai: { minSections: 7, maxSections: 9, maxWords: 2100, maxCards: 12 },
    divorce_law_ai: { minSections: 7, maxSections: 9, maxWords: 2000, maxCards: 12 },
  };

  test('major section count is within budget (header/footer excluded)', () => {
    for (const funnel of FUNNELS) {
      const budget = BUDGET[funnel.funnelId];
      const sections = (mainContent(builtFunnel[funnel.path]).match(/<section/g) || []).length;
      assert.ok(
        sections >= budget.minSections && sections <= budget.maxSections,
        `${funnel.path}: ${sections} sections, budget is ${budget.minSections}-${budget.maxSections}`
      );
    }
  });

  test('visible word count stays under the ceiling', () => {
    for (const funnel of FUNNELS) {
      const words = wordCount(builtFunnel[funnel.path]);
      assert.ok(
        words <= BUDGET[funnel.funnelId].maxWords,
        `${funnel.path}: ${words} words exceeds the ${BUDGET[funnel.funnelId].maxWords} ceiling — reduce, do not add`
      );
      assert.ok(words > 800, `${funnel.path}: ${words} words is implausibly thin`);
    }
  });

  test('card walls are capped — fewer, larger blocks', () => {
    for (const funnel of FUNNELS) {
      const cards = (mainContent(builtFunnel[funnel.path]).match(/class="fnl-card"/g) || []).length;
      assert.ok(cards <= BUDGET[funnel.funnelId].maxCards, `${funnel.path}: ${cards} cards is a card wall`);
    }
  });

  test('per-section item ceilings hold in every config', () => {
    for (const f of FUNNELS) {
      assert.ok(f.leak.items.length <= 4, `${f.funnelId}: ${f.leak.items.length} leak points (max 4)`);
      assert.ok(f.leak.items.length >= 3, `${f.funnelId}: needs at least 3 leak points`);
      if (f.system.capabilities) {
        assert.ok(f.system.capabilities.length <= 6, `${f.funnelId}: ${f.system.capabilities.length} capabilities (max 6)`);
      }
      if (f.system.pillars) {
        assert.equal(f.system.pillars.length, 4, `${f.funnelId}: pillars must be exactly 4 blocks`);
      }
      assert.ok(f.system.boundaries.length <= 3, `${f.funnelId}: boundary strip capped at 3`);
      if (f.deliverables) {
        assert.ok(f.deliverables.items.length >= 8 && f.deliverables.items.length <= 10, `${f.funnelId}: deliverables must be 8-10`);
      }
      assert.ok(f.offer.includes.length >= 5 && f.offer.includes.length <= 8, `${f.funnelId}: offer bullets must be 5-8`);
      assert.ok(f.offer.footnotes.length <= 2, `${f.funnelId}: offer footnotes capped at 2`);
      const steps = f.process?.steps ?? f.proof.steps ?? [];
      assert.ok(steps.length >= 3 && steps.length <= 4, `${f.funnelId}: process must be 3-4 steps, found ${steps.length}`);
      assert.equal(!!f.process && !!f.proof.steps, false, `${f.funnelId}: use process OR proof.steps, never both`);
      assert.ok(f.proof.demoSlots.length <= 4, `${f.funnelId}: demo slots capped at 4`);
      assert.ok(f.fit.faqs.length >= 5 && f.fit.faqs.length <= 6, `${f.funnelId}: FAQ must be 5-6, found ${f.fit.faqs.length}`);
      assert.ok(f.fit.fitItems.length >= 4 && f.fit.fitItems.length <= 5, `${f.funnelId}: fit list must be 4-5`);
      assert.ok(f.fit.notFitItems.length >= 2 && f.fit.notFitItems.length <= 3, `${f.funnelId}: not-fit list must be 2-3`);
      assert.ok((f.hero.bullets ?? []).length <= 3, `${f.funnelId}: hero bullets capped at 3`);
    }
  });

  test('copy length standard: no walls of text', () => {
    for (const f of FUNNELS) {
      const paragraphs = [...f.system.paragraphs, f.leak.intro ?? '', f.close.body, f.offer.summary];
      for (const p of paragraphs) {
        const words = p.trim().split(/\s+/).filter(Boolean).length;
        assert.ok(words <= 70, `${f.funnelId}: a paragraph runs ${words} words — keep to 1-3 sentences`);
      }
      const cards = [...f.leak.items, ...(f.system.capabilities ?? [])];
      for (const card of cards) {
        const words = card.body.trim().split(/\s+/).length;
        assert.ok(words <= 48, `${f.funnelId}: card "${card.title}" runs ${words} words (target 15-45)`);
      }
    }
  });

  test('the removed sections are genuinely gone from the contract', () => {
    // These were separate sections before the conversion pass and were
    // deleted or merged. Re-adding one requires changing the type, which
    // makes it a deliberate decision rather than a quiet regression.
    const types = read('src/lib/funnels/types.ts');
    for (const gone of ['FunnelValue', 'FunnelBands', 'FunnelQualification', 'FunnelCost', 'FunnelCapabilities']) {
      assert.equal(types.includes(`interface ${gone}`), false, `${gone} was merged away — do not reintroduce it`);
    }
    const page = read('src/components/funnel/FunnelPage.astro');
    assert.equal(page.includes('fnl-band'), false, 'the repeated CTA band strips were removed');
    assert.equal(page.includes('fnl-compare'), false, 'the alternatives-comparison section was merged into the FAQ');
  });
});

// ============================================================
// 2. PLUMBING
// ============================================================

describe('Plumbing funnel offer contract', () => {
  const f = FUNNELS_BY_ID.plumbing_ai;
  const html = builtFunnel['/plumbing-ai/'];
  const text = visibleText(html);
  const offerText = [
    ...f.offer.priceLines.map((l) => `${l.label} ${l.value} ${l.note ?? ''}`),
    ...f.offer.footnotes,
  ].join(' ');

  test('identifiers are vertical=plumbing / funnel_id=plumbing_ai', () => {
    assert.equal(f.vertical, 'plumbing');
    assert.equal(f.funnelId, 'plumbing_ai');
    assert.ok(html.includes('data-vertical="plumbing"'));
    assert.ok(html.includes('data-funnel-id="plumbing_ai"'));
  });

  test('$5,000 implementation and starting-at $500/month appear in config and on the page', () => {
    const values = f.offer.priceLines.map((l) => l.value);
    assert.ok(values.includes('$5,000'), 'offer must state the $5,000 implementation');
    assert.ok(values.some((v) => /From \$500\/month/i.test(v)), 'offer must state the starting-at monthly');
    assert.ok(f.hero.priceAnchor?.some((p) => p.value === '$5,000'), 'hero must anchor $5,000');
    assert.ok(f.hero.priceAnchor?.some((p) => /\$500\/mo/i.test(p.value)), 'hero must anchor the monthly');
    assert.ok(text.includes('$5,000'));
    assert.match(text, /From \$500\/month/i);
    assert.match(offerText, /starts at \$500/i, 'the starting-at qualifier must be explicit somewhere in the offer');
  });

  test('monthly is never presented as unlimited, and the variables are disclosed', () => {
    assert.deepEqual(unnegatedMentions(text, /unlimited/), [], 'must never imply unlimited usage');
    assert.ok(/unlimited/i.test(text), 'the page should actively disclaim unlimited usage');
    assert.match(offerText, /[Nn]ot an unlimited-usage plan/);
    for (const driver of ['call volume', 'outbound', 'SMS volume', 'integrations', 'locations', 'complexity', 'support']) {
      assert.match(offerText, new RegExp(driver, 'i'), `monthly drivers must disclose "${driver}"`);
    }
  });

  test('the offer is reachable early — price is anchored in the hero', () => {
    // A paid-social visitor should know the number without scrolling to
    // the offer section.
    const body = mainContent(html);
    const heroEnd = body.indexOf('</section>');
    const hero = body.slice(0, heroEnd);
    assert.ok(hero.includes('$5,000'), 'the implementation price must appear in the hero');
    assert.ok(/From \$500\/mo/i.test(hero), 'the monthly must appear in the hero');
    assert.ok(hero.includes('data-cta-location="hero"'), 'the hero must carry the primary CTA');
  });

  test('CTA is the plumbing STRATEGY CALL everywhere on the page', () => {
    for (const cta of [f.hero.cta, f.offer.cta, f.fit.cta, f.close.cta]) {
      assert.equal(cta.label, 'Book My AI Front Desk Strategy Call');
      assert.equal(cta.type, 'strategy_call');
    }
    assert.ok(text.includes('Book My AI Front Desk Strategy Call'));
    assert.equal(text.includes('Law Firm AI Growth Strategy Call'), false);
    assert.equal(text.includes('Family Law AI Growth Strategy Call'), false);
  });

  test('the funnel promises NO product demo — we have no generic AI voice demo to play', () => {
    // The sales process is: ad -> funnel -> strategy call -> discovery ->
    // custom proposal -> $5,000 implementation. Promising a demo sets an
    // expectation the next step cannot meet.
    assert.equal(text.includes('Book My AI Front Desk Demo'), false, 'the demo CTA must be gone');
    for (const pattern of [
      /\bdemo\b/i,
      /hear (the|our) AI/i,
      /listen to (the|a) (call|agent|recording)/i,
      /live call walkthrough/i,
      /judge it on the demo/i,
      /sample (call )?recording/i,
    ]) {
      // "recording"/"transcript" may appear only where the page DENIES
      // having one (the illustrative-workflow disclaimer).
      assert.deepEqual(unnegatedMentions(text, pattern), [], `plumbing funnel implies a demo: ${pattern}`);
    }
    // And no fake player of any kind was substituted for one.
    for (const marker of ['<audio', '<video', 'waveform', 'data-player', 'class="player']) {
      assert.equal(html.toLowerCase().includes(marker), false, `fake demo asset shipped: ${marker}`);
    }
  });

  test('the CTA sells a strategy call, with only a verified duration and price claim', () => {
    const micro = f.hero.cta.microcopy!;
    assert.match(micro, /strategy call/i);
    // "Free 30-minute" must match the centralized scheduling config, not
    // an invented duration.
    assert.equal(SCHEDULING.strategyCall.durationMinutes, 30);
    assert.equal(SCHEDULING.strategyCall.price, null, 'the call must actually be free to call it free');
    assert.match(micro, /Free 30-minute/);
    assert.match(micro, /map your current call and booking process/i);
    // A shorter label is used ONLY by the sticky bar.
    assert.equal(f.hero.cta.compactLabel, 'Book My Strategy Call');
  });

  test('the proof section shows how the system WOULD work — it does not promise a demo', () => {
    assert.equal(f.proof.eyebrow, 'See How It Works');
    assert.equal(f.proof.heading, 'See How the System Would Work');
    assert.ok(text.includes('See How the System Would Work'));
    assert.equal(text.includes('Judge It on the Demo'), false);
    // The four cards describe discovery work done on the call, not a
    // playback of something we do not have.
    const slots = f.proof.demoSlots.map((s2) => `${s2.title} ${s2.body}`).join(' ');
    assert.equal(/\bdemo\b/i.test(slots), false);
    assert.match(slots, /call flow, mapped/i);
    assert.match(slots, /Scope, timeline/i);
    // None of them carries the generic 'play' icon any more.
    for (const slot of f.proof.demoSlots) {
      assert.ok(slot.icon && slot.icon !== 'play', `slot "${slot.title}" should not use a playback icon`);
    }
  });

  test('the illustrative workflow is labeled as an example and cannot read as a real call', () => {
    const w = f.proof.workflow!;
    assert.match(w.label, /Example AI Front Desk Workflow/);
    assert.match(w.label, /illustrative/i);
    assert.equal(w.steps.length, 8);
    assert.match(w.steps[0].marker, /8:47 PM/);
    for (const denial of [/not a recording/i, /not a transcript/i, /not a real customer interaction/i, /not a claim about results/i]) {
      assert.match(w.disclaimer, denial, `disclaimer must state ${denial}`);
    }
    assert.ok(text.includes(w.label), 'the label must render as visible copy');
    assert.ok(text.includes('not a recording'), 'the denial must render');
  });

  test('the hero positions added capacity, not staff replacement', () => {
    assert.equal(f.hero.headlineLine2, 'Without Adding Another Full-Time Dispatcher');
    assert.equal(/Hiring Another Dispatcher/.test(text), false, 'replacement framing must be gone');
    assert.match(f.hero.subhead, /can answer calls/i, 'capability language must be hedged to what is configured');
    assert.match(text, /Turn More Plumbing Calls Into Booked Jobs/);
  });

  test('the final close asks for the call flow rather than offering a demo', () => {
    assert.equal(f.close.eyebrow, 'Your AI Front Desk');
    assert.match(f.close.heading, /Bring Us Your Current Call Flow/);
    assert.match(f.close.heading, /How an AI Front Desk Could Fit Into It/);
    assert.equal(/\bdemo\b/i.test(f.close.body + f.close.whatHappens!.join(' ')), false);
    // The old "you hear how the system handles calls like yours" promise.
    assert.equal(/you hear how/i.test(text), false);
    assert.match(f.close.whatHappens!.join(' '), /map your current call, booking, and follow-up process/i);
  });

  test('the mechanism is the AI Front Desk, with a visible call flow', () => {
    assert.equal(f.system.name, 'Your AI Front Desk');
    assert.ok(f.system.flow, 'the mechanism must be shown as a flow, not only described');
    const labels = f.system.flow!.steps.map((s) => s.label.toLowerCase()).join(' | ');
    for (const stage of ['call', 'answer', 'qualif', 'book', 'follow', 'escalat']) {
      assert.ok(labels.includes(stage), `call flow must show "${stage}"`);
    }
    assert.ok(html.includes('fnl-flow'), 'the flow must actually render');
  });

  test('boundaries are stated without claiming to replace staff', () => {
    const boundaries = f.system.boundaries.map((b) => `${b.title} ${b.body}`).join(' ');
    assert.match(boundaries, /does not replace your team/i);
    assert.match(boundaries, /does not diagnose or price/i);
  });

  test('the six core capabilities are present', () => {
    const items = (f.system.capabilities ?? []).map((i) => `${i.title} ${i.body}`).join(' ');
    assert.equal(f.system.capabilities?.length, 6);
    for (const capability of [/inbound call/i, /after.hours/i, /booking|book/i, /missed.call/i, /estimate/i, /SMS|text/i, /escalation/i]) {
      assert.match(items, capability, `capability stack must cover ${capability}`);
    }
  });

  test('the offer area is not interrupted by billing mechanics, and nothing material is hidden', () => {
    // One concise footnote in the offer; the tooling/third-party detail
    // moved to the FAQ where someone asking actually wants it.
    assert.equal(f.offer.footnotes.length, 1, 'the offer should carry one concise note');
    assert.match(f.offer.footnotes[0], /Confirmed in writing before launch/i);
    const faqText = f.fit.faqs.map((q) => `${q.question} ${q.answer}`).join(' ');
    assert.match(faqText, /You keep your own phone numbers, CRM, and scheduling tools/i, 'material fact must survive in the FAQ');
    assert.match(faqText, /third-party telephony or SMS costs are billed to you/i, 'billing fact must survive in the FAQ');
  });

  test('the FAQ still handles the objections that block a booking', () => {
    const questions = f.fit.faqs.map((i) => i.question).join(' | ');
    const answers = f.fit.faqs.map((i) => i.answer).join(' | ');
    for (const objection of [/know they are talking to AI/i, /transfer to a real person/i, /does not know the answer/i, /integrate with (our )?CRM/i, /\$5,000/]) {
      assert.match(questions, objection, `FAQ must handle ${objection}`);
    }
    // The alternatives argument was merged in here rather than given a
    // section of its own.
    assert.match(questions + answers, /answering service/i, 'the alternatives argument must survive inside the FAQ');
    assert.match(answers, /book/i);
  });
});

// ============================================================
// 3. PERSONAL INJURY
// ============================================================

describe('Personal injury funnel contract', () => {
  const f = FUNNELS_BY_ID.personal_injury_ai;
  const html = builtFunnel['/personal-injury-ai/'];
  const text = visibleText(html);

  test('identifiers are vertical=personal_injury / funnel_id=personal_injury_ai', () => {
    assert.equal(f.vertical, 'personal_injury');
    assert.equal(f.funnelId, 'personal_injury_ai');
    assert.ok(html.includes('data-vertical="personal_injury"'));
    assert.ok(html.includes('data-funnel-id="personal_injury_ai"'));
  });

  test('law-firm growth + intake positioning, with the acquisition chain shown once', () => {
    assert.match(f.offer.name, /Law Firm AI Growth \+ Intake System/i);
    assert.match(f.hero.headline + ' ' + (f.hero.headlineLine2 ?? ''), /may not need more leads/i);
    assert.ok(f.leak.flow, 'the acquisition chain must render inside the leak section');
    assert.deepEqual(f.leak.flow!.steps.map((s) => s.label), [
      'Traffic', 'Lead', 'Response', 'Intake', 'Qualification', 'Consultation', 'Follow-Up', 'Attribution',
    ]);
    // One chain, not a chain plus a duplicate leak section. Matched on
    // the class prefix so the responsive `is-long` modifier does not
    // break the count.
    assert.equal((mainContent(html).match(/<ol class="fnl-flow/g) || []).length, 1);
  });

  test('the system is four pillars, not a grid of micro-services', () => {
    assert.deepEqual((f.system.pillars ?? []).map((p) => p.title), ['ACQUIRE', 'ANSWER', 'CONVERT', 'MEASURE']);
    assert.ok(f.deliverables, 'the deliverables checklist must exist');
    const items = f.deliverables!.items.join(' ');
    for (const capability of [/Google Ads/i, /landing page/i, /AI[- ]assisted intake|AI intake/i, /scheduling/i, /follow-up/i, /CRM/i, /attribution/i]) {
      assert.match(items, capability, `deliverables must cover ${capability}`);
    }
  });

  test('CTA is the law-firm strategy call CTA', () => {
    for (const cta of [f.hero.cta, f.offer.cta, f.fit.cta, f.close.cta]) {
      assert.equal(cta.label, 'Book a Law Firm AI Growth Strategy Call');
      assert.equal(cta.type, 'strategy_call');
    }
    assert.ok(text.includes('Book a Law Firm AI Growth Strategy Call'));
  });

  test('investment is $15,000-$25,000 / $2,500-$5,000+ per month, ad spend separate', () => {
    const priceText = f.offer.priceLines.map((l) => `${l.label} ${l.value} ${l.note ?? ''}`).join(' ');
    assert.match(priceText, /\$15,000\s*[–-]\s*\$25,000/);
    assert.match(priceText, /\$2,500\s*[–-]\s*\$5,000\+?\/mo/);
    assert.match(priceText + f.offer.footnotes.join(' '), /[Aa]dvertising spend is separate|separate, paid directly/i);
    assert.match(text, /\$15,000\s*[–-]\s*\$25,000/);
    assert.match(text, /\$2,500\s*[–-]\s*\$5,000\+?\/mo/);
  });

  test('price is not led with in the hero — attorneys are qualified on fit first', () => {
    assert.equal(f.hero.priceAnchor, undefined);
    const heroText = `${f.hero.headline} ${f.hero.headlineLine2 ?? ''} ${f.hero.subhead} ${(f.hero.bullets ?? []).join(' ')}`;
    assert.equal(/\$\d/.test(heroText), false, 'hero must not contain a price');
  });

  test('there is no buy-now checkout anywhere on the page', () => {
    for (const pattern of [/buy now/i, /add to cart/i, /pay now/i, /purchase now/i, /stripe/i, /order now/i, /enter (your )?card/i]) {
      assert.equal(pattern.test(text), false, `PI funnel must not contain ${pattern}`);
    }
    assert.deepEqual(unnegatedMentions(text, /checkout/), [], 'PI funnel must not offer a checkout');
    assert.equal(/<form/i.test(html), false, 'PI funnel must not carry a payment/checkout form');
    assert.equal(/js\.stripe\.com|paypal|square(up)?\.com/i.test(html), false, 'no payment processor');
    assert.equal(f.hero.cta.type, 'strategy_call');
  });

  test('PI leak claims are hedged rather than asserted as universal behaviour', () => {
    for (const pattern of [
      /is contacting several/i,
      /always contacts?/i,
      /every (claimant|prospective client)/i,
      /\d+\s*%/,
    ]) {
      assert.equal(pattern.test(text), false, `PI funnel states an unsupported claim: ${pattern}`);
    }
    assert.match(f.leak.items.map((i) => i.body).join(' '), /when a prospective client contacts more than one firm/i);
  });

  test('the legal boundary is explicit: no advice, no merits call, no outcome promises', () => {
    const boundaries = f.system.boundaries.map((b) => `${b.title} ${b.body}`).join(' ');
    assert.match(boundaries, /No legal advice/i);
    assert.match(boundaries, /No merits evaluation/i);
    assert.match(boundaries, /No outcome predictions/i);
    assert.match(text, /does not answer legal questions/i);
    assert.match(f.fit.faqs.map((q) => q.answer).join(' '), /Your firm, without exception/i);
    for (const pattern of [/guarantee[ds]? (a )?(result|outcome|settlement)/i, /we will win/i, /guaranteed settlement/i]) {
      assert.equal(pattern.test(text), false, `must not contain ${pattern}`);
    }
  });
});

// ============================================================
// 4. DIVORCE / FAMILY LAW
// ============================================================

describe('Divorce and family law funnel contract', () => {
  const f = FUNNELS_BY_ID.divorce_law_ai;
  const html = builtFunnel['/divorce-law-ai/'];
  const text = visibleText(html);

  test('identifiers are vertical=divorce_law / funnel_id=divorce_law_ai', () => {
    assert.equal(f.vertical, 'divorce_law');
    assert.equal(f.funnelId, 'divorce_law_ai');
    assert.ok(html.includes('data-vertical="divorce_law"'));
    assert.ok(html.includes('data-funnel-id="divorce_law_ai"'));
  });

  test('family-law positioning with its own system flow', () => {
    assert.match(f.offer.name, /Family Law Firms/i);
    assert.equal(f.hero.eyebrow, 'For Divorce & Family Law Firms');
    assert.ok(f.system.flow, 'the family-law path must render as a flow');
    assert.deepEqual(f.system.flow!.steps.map((s) => s.label), [
      'Lead generation', 'Intake', 'Qualification', 'Scheduling', 'Follow-up', 'Attribution',
    ]);
    assert.match(text, /family law/i);
  });

  test('copy is genuinely its own — not the PI funnel with words swapped', () => {
    const pi = FUNNELS_BY_ID.personal_injury_ai;
    assert.notEqual(f.hero.subhead, pi.hero.subhead);
    assert.notEqual(f.close.heading, pi.close.heading);
    const fLeak = new Set(f.leak.items.map((i) => i.body));
    for (const item of pi.leak.items) {
      assert.equal(fLeak.has(item.body), false, 'leak copy must not be shared between the legal funnels');
    }
    const fFaq = new Set(f.fit.faqs.map((q) => q.question));
    const shared = pi.fit.faqs.filter((q) => fFaq.has(q.question));
    assert.deepEqual(shared, [], 'FAQ questions must not be shared between the legal funnels');
  });

  test('CTA is the family-law strategy call CTA', () => {
    for (const cta of [f.hero.cta, f.offer.cta, f.fit.cta, f.close.cta]) {
      assert.equal(cta.label, 'Book a Family Law AI Growth Strategy Call');
    }
    assert.ok(text.includes('Book a Family Law AI Growth Strategy Call'));
  });

  test('investment is $10,000-$20,000 / $2,500-$5,000+ per month, ad spend separate', () => {
    const priceText = f.offer.priceLines.map((l) => `${l.label} ${l.value} ${l.note ?? ''}`).join(' ');
    assert.match(priceText, /\$10,000\s*[–-]\s*\$20,000/);
    assert.match(priceText, /\$2,500\s*[–-]\s*\$5,000\+?\/mo/);
    assert.match(priceText, /separate/i);
    assert.match(text, /\$10,000\s*[–-]\s*\$20,000/);
  });

  test('price is not led with in the hero', () => {
    assert.equal(f.hero.priceAnchor, undefined);
    assert.equal(/\$\d/.test(`${f.hero.headline} ${f.hero.headlineLine2 ?? ''} ${f.hero.subhead}`), false);
  });

  test('the legal boundary is explicit', () => {
    const boundaries = f.system.boundaries.map((b) => `${b.title} ${b.body}`).join(' ');
    assert.match(boundaries, /No legal advice/i);
    assert.match(boundaries, /No assessment, no predictions/i);
    assert.match(text, /No answers to legal questions/i);
  });

  test('unsupported behavioural claims are softened, not stated as fact', () => {
    // We have no data on how many prospective clients contact multiple
    // firms or when inquiries arrive, so the copy must not assert it.
    for (const pattern of [
      /Usually Contacting Several/i,
      /is contacting several/i,
      /a great many .* inquiries arrive/i,
      /most (people|prospective clients|inquiries)/i,
      /\d+\s*%/,
    ]) {
      assert.equal(pattern.test(text), false, `divorce funnel states an unsupported claim: ${pattern}`);
    }
    // Hedged phrasing survives.
    assert.match(f.leak.heading, /May Be Contacting More Than One Firm|Comparing Firms/i);
    assert.match(f.leak.items.map((i) => i.body).join(' '), /some first inquiries|may be limited/i);
  });

  test('SENSITIVITY: the copy does not exploit distress, children, or fear', () => {
    // Family law prospects are people in a difficult period. This funnel
    // sells to FIRMS; it must never use a claimant's circumstances as a
    // persuasion device.
    const forbidden: [RegExp, string][] = [
      [/before (your|their) (spouse|ex)/i, 'adversarial fear framing'],
      [/lose (your|their) (kids|children|custody)/i, 'custody fear'],
      [/custody battle/i, 'custody sensationalism'],
      [/fight for (your|their) (kids|children)/i, 'children as leverage'],
      [/domestic violence/i, 'DV as a marketing hook'],
      [/desperate/i, 'characterizing prospects as desperate'],
      [/vulnerable (people|clients|leads)/i, 'targeting vulnerability'],
      [/act now/i, 'manufactured urgency'],
      [/before it'?s too late/i, 'manufactured urgency'],
    ];
    for (const [pattern, why] of forbidden) {
      assert.equal(pattern.test(text), false, `divorce funnel must not use ${why} (${pattern})`);
    }
    assert.match(text, /routes rather than probes|not designed to elicit/i);
  });
});

// ============================================================
// 5. CTA DESIGN + MESSAGE MATCH
// ============================================================

describe('CTA design and message match', () => {
  test('every funnel has a distinct CTA label — no shared generic button', () => {
    const labels = FUNNELS.map((f) => f.hero.cta.label);
    assert.equal(new Set(labels).size, 3, 'CTA labels must differ per vertical');
    assert.deepEqual(labels.slice().sort(), [
      'Book My AI Front Desk Strategy Call',
      'Book a Family Law AI Growth Strategy Call',
      'Book a Law Firm AI Growth Strategy Call',
    ].sort());
  });

  test('CTA appears at four placements plus the sticky mobile bar — not after every section', () => {
    for (const funnel of FUNNELS) {
      const body = mainContent(builtFunnel[funnel.path]);
      const locations = [...body.matchAll(/data-cta-location="([^"]+)"/g)].map((m) => m[1]);
      const types = [...body.matchAll(/data-cta-type="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(locations.length, types.length, `${funnel.path}: every CTA needs both attributes`);
      assert.deepEqual(locations, ['hero', 'offer', 'faq', 'final', 'sticky'], `${funnel.path}: unexpected CTA placement`);
      assert.equal(new Set(types).size, 1);
      assert.equal(types[0], funnel.hero.cta.type);
      // Anti-inflation: the previous version had seven CTAs plus four
      // repeated band strips.
      assert.ok(locations.length <= 6, `${funnel.path}: too many CTAs (${locations.length})`);
    }
  });

  test('the CTA is visually prominent and meets tap-target minimums', () => {
    const cta = read('src/components/funnel/FunnelCTA.astro');
    const minHeight = Number(cta.match(/min-height:\s*(\d+)px/)?.[1]);
    assert.ok(minHeight >= 52, `CTA min-height ${minHeight}px is too small for a primary paid-social CTA`);
    const fontSize = Number(cta.match(/font-size:\s*([\d.]+)rem/)?.[1]);
    assert.ok(fontSize >= 1, `CTA label ${fontSize}rem is understated`);
    assert.match(cta, /box-shadow:/, 'the primary CTA needs visual lift');
    assert.match(cta, /:focus-visible\s*\{[^}]*outline:/, 'the CTA needs an explicit focus ring on dark backgrounds');
    assert.match(cta, /width:\s*100%/, 'the CTA should span the column on phones');
  });

  test('attorney CTA architecture is preserved', () => {
    assert.equal(FUNNELS_BY_ID.personal_injury_ai.hero.cta.label, 'Book a Law Firm AI Growth Strategy Call');
    assert.equal(FUNNELS_BY_ID.divorce_law_ai.hero.cta.label, 'Book a Family Law AI Growth Strategy Call');
    for (const id of ['personal_injury_ai', 'divorce_law_ai'] as const) {
      const f = FUNNELS_BY_ID[id];
      assert.equal(f.hero.cta.type, 'strategy_call');
      // Full label everywhere, including the sticky bar — only plumbing
      // needed a shortened variant.
      assert.equal(f.hero.cta.compactLabel, undefined);
      for (const cta of [f.offer.cta, f.fit.cta, f.close.cta]) assert.equal(cta.label, f.hero.cta.label);
    }
  });

  test('CTA subtext is one consistent line per funnel, and not defensive', () => {
    for (const f of FUNNELS) {
      const micro = f.hero.cta.microcopy!;
      // The same line on every CTA — it renders four times per page.
      for (const cta of [f.offer.cta, f.fit.cta, f.close.cta]) assert.equal(cta.microcopy, micro);
      assert.match(micro, /30[- ]minute/, `${f.funnelId}: subtext should state the verified duration`);
      assert.equal(/not a pitch/i.test(visibleText(builtFunnel[f.path])), false, `${f.funnelId}: "not a pitch" is defensive`);
    }
    // The duration claim matches the centralized scheduling config.
    assert.equal(SCHEDULING.strategyCall.durationMinutes, 30);
  });

  test('the sticky mobile CTA is restrained and tracked, and adds no new event', () => {
    const sticky = read('src/components/funnel/FunnelStickyCta.astro');
    assert.match(sticky, /@media \(min-width: 900px\)[\s\S]*?display:\s*none/, 'sticky bar must be mobile-only');
    assert.ok(sticky.includes('IntersectionObserver'), 'no scroll listener — observer only');
    assert.ok(sticky.includes('location="sticky"'), 'the sticky CTA must be separately attributable');
    assert.ok(sticky.includes('heroVisible') && sticky.includes('finalVisible'), 'hidden near both the hero and final CTAs');
    // It reuses the existing event pair; it does not introduce one.
    assert.equal(/dataLayer\.push/.test(sticky), false, 'the sticky bar must not push its own events');
    // A funnel may shorten its label for this one placement only.
    const cta = read('src/components/funnel/FunnelCTA.astro');
    assert.match(cta, /compact \? \(cta\.compactLabel \?\? cta\.label\) : cta\.label/, 'compact label falls back to the full label');
    const plumbingHtml = builtFunnel['/plumbing-ai/'];
    const stickyLabel = plumbingHtml.match(/data-cta-location="sticky"[^>]*>\s*([^<]+)</)?.[1].trim();
    assert.equal(stickyLabel, 'Book My Strategy Call', 'sticky bar uses the short label');
    // ...while every in-page CTA keeps the full one.
    for (const loc of ['hero', 'offer', 'faq', 'final']) {
      const label = plumbingHtml.match(new RegExp(`data-cta-location="${loc}"[^>]*>\\s*([^<]+)<`))?.[1].trim();
      assert.equal(label, 'Book My AI Front Desk Strategy Call', `${loc} CTA must use the full label`);
    }
    // The close section must out-clear the sticky bar rather than match
    // a magic number: ~72px of bar (10px padding + 52px button + 10px)
    // plus visual breathing room for the closing copy.
    const styles = read('src/components/funnel/FunnelStyles.astro');
    const closeBottom = Number(
      styles.match(/@media \(max-width: 899px\)[\s\S]*?\.fnl-close\s*\{[\s\S]*?padding-bottom:\s*(\d+)px/)?.[1]
    );
    assert.ok(closeBottom >= 100, `close padding-bottom is ${closeBottom}px — must clear the ~72px sticky bar with room to spare`);
  });

  test('the closing supporting copy clears the section transition on phones', () => {
    // Reported on mobile: the copy under the final CTA sat hard against
    // the section edge and read as though the footer transition was
    // swallowing it.
    const styles = read('src/components/funnel/FunnelStyles.astro');
    const mobile = styles.slice(styles.indexOf('@media (max-width: 899px)'));
    assert.match(mobile, /\.fnl-what-happens\s*\{[\s\S]*?margin-bottom:\s*\d+px/, 'the closing list needs bottom clearance');
    assert.match(mobile, /\.fnl-close \.fnl-cta-micro\s*\{[\s\S]*?margin-bottom:\s*\d+px/, 'the CTA microcopy needs the same clearance when it is last');
    // The decorative transition is preserved, not removed.
    assert.ok(read('src/components/funnel/FunnelPage.astro').includes('fnl-close-glow'));
    for (const route of FUNNEL_ROUTES) {
      assert.ok(builtFunnel[route].includes('fnl-close-glow'), `${route}: decorative transition removed`);
    }
  });

  test('a long acquisition chain reflows to a readable grid on phones', () => {
    // Eight stages cannot stay legible as one horizontal row at 320px.
    // Only chains of 7+ switch to the two-column grid, so the six-stage
    // plumbing and family-law flows are untouched.
    const pi = mainContent(builtFunnel['/personal-injury-ai/']);
    assert.equal(pi.includes('class="fnl-flow is-long"'), true, 'the 8-stage PI chain must use the long-chain layout');
    assert.equal((pi.match(/fnl-flow-item/g) || []).length, 8);
    for (const route of ['/plumbing-ai/', '/divorce-law-ai/']) {
      const body = mainContent(builtFunnel[route]);
      assert.equal(body.includes('is-long'), false, `${route}: six-stage flow must keep the standard row`);
      assert.equal((body.match(/fnl-flow-item/g) || []).length, 6);
    }

    const styles = read('src/components/funnel/FunnelStyles.astro');
    // End the slice at the TOP-LEVEL .fnl-flow-arrow rule (two-space
    // indent) — the nth-child selector inside the media block also
    // contains ".fnl-flow-arrow {" and would truncate it early.
    const longBlock = styles.slice(
      styles.indexOf('@media (max-width: 699px)'),
      styles.indexOf('\n  .fnl-flow-arrow {')
    );
    assert.match(longBlock, /\.fnl-flow\.is-long\s*\{[\s\S]*?display:\s*grid/, 'mobile long chain must be a grid');
    assert.match(longBlock, /grid-template-columns:\s*1fr 1fr/, 'two columns');
    // Overflow must be structurally impossible, not font-metric dependent.
    assert.match(longBlock, /\.fnl-flow\.is-long\s*\{[\s\S]*?min-width:\s*0/, 'grid must drop the max-content floor');
    assert.match(longBlock, /\.fnl-flow\.is-long \.fnl-flow-item\s*\{[\s\S]*?min-width:\s*0/, 'grid items must drop their auto minimum');
    assert.match(longBlock, /\.fnl-flow\.is-long \.fnl-flow-step\s*\{[\s\S]*?min-width:\s*0/, 'the 116px step floor must be lifted');
    assert.match(longBlock, /overflow-wrap:\s*anywhere/, 'labels must be able to wrap rather than widen the grid');
    // The connector still communicates direction into the next row.
    assert.match(longBlock, /nth-child\(2n\) \.fnl-flow-arrow\s*\{[\s\S]*?rotate\(90deg\)/, 'end-of-row arrow must point down');
    // Desktop is untouched: every long-chain rule sits in a max-width query.
    assert.equal(/@media \(min-width[^)]*\)[^@]*\.fnl-flow\.is-long/.test(styles), false, 'no long-chain rule may apply above mobile');
    assert.match(styles, /@media \(min-width: 1080px\)\s*\{\s*\.fnl-flow\s*\{[\s\S]*?flex-wrap:\s*wrap/, 'the desktop wrap rule must survive');
  });
});

// ============================================================
// 6. ATTRIBUTION  (unchanged by the conversion pass)
// ============================================================

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as any).window = { localStorage: new MemoryStorage() };
(globalThis as any).document = { referrer: '' };

const {
  captureAttribution,
  getFirstTouch,
  getLatestTouch,
  getCreativeAttribution,
  buildCalComForwardFields,
  buildLeadAttributionFields,
  appendAttributionToUrl,
  sanitizeCreativeId,
} = await import('../src/lib/attribution.ts');

function freshStorage() {
  (globalThis as any).window.localStorage = new MemoryStorage();
}

const PLUMBING_AD_URL =
  '?utm_source=meta&utm_medium=paid_social&utm_campaign=plumbing_ai&utm_content=plumbing_ugc_vsl_01';

describe('Creative-level attribution', () => {
  test('utm_content is captured from a Meta ad landing URL and persists across internal navigation', () => {
    freshStorage();
    captureAttribution({ search: PLUMBING_AD_URL, landingPage: '/plumbing-ai/' });
    captureAttribution({ search: '', landingPage: '/free-ai-assessment/' });
    const latest = getLatestTouch();
    assert.equal(latest?.utm_content, 'plumbing_ugc_vsl_01');
    assert.equal(latest?.utm_campaign, 'plumbing_ai');
    assert.equal(latest?.utm_source, 'meta');
    assert.equal(latest?.utm_medium, 'paid_social');
  });

  test('creative_id is captured when supplied, and is optional', () => {
    freshStorage();
    captureAttribution({ search: PLUMBING_AD_URL + '&creative_id=plumbing_v1_missed_calls_hook', landingPage: '/plumbing-ai/' });
    assert.equal(getLatestTouch()?.creative_id, 'plumbing_v1_missed_calls_hook');

    freshStorage();
    captureAttribution({ search: PLUMBING_AD_URL, landingPage: '/plumbing-ai/' });
    assert.equal(getLatestTouch()?.creative_id, undefined);
    assert.equal(getCreativeAttribution().utm_content, 'plumbing_ugc_vsl_01');
  });

  test('creative_id is sanitized to a safe internal identifier', () => {
    assert.equal(sanitizeCreativeId('Plumbing_V1_Hook'), 'plumbing_v1_hook');
    assert.equal(sanitizeCreativeId('  pi_v1-hook.2  '), 'pi_v1-hook.2');
    assert.equal(sanitizeCreativeId('<script>alert(1)</script>'), 'scriptalert1script');
    assert.equal(sanitizeCreativeId('!!!'), null);
    assert.equal(sanitizeCreativeId(null), null);
    assert.equal(sanitizeCreativeId('x'.repeat(300))!.length, 64);
  });

  test('ad-platform values are NOT mangled by the creative_id sanitizer', () => {
    freshStorage();
    captureAttribution({ search: '?utm_content=Plumbing_UGC_VSL_01&fbclid=IwAR2xYzABC_-123', landingPage: '/plumbing-ai/' });
    assert.equal(getLatestTouch()?.utm_content, 'Plumbing_UGC_VSL_01');
    assert.equal(getLatestTouch()?.fbclid, 'IwAR2xYzABC_-123');
  });

  test('creative attribution survives funnel -> free assessment -> booking', () => {
    freshStorage();
    captureAttribution({ search: PLUMBING_AD_URL + '&creative_id=plumbing_v1_missed_calls_hook', landingPage: '/plumbing-ai/' });
    captureAttribution({ search: '', landingPage: '/free-ai-assessment/' });
    captureAttribution({ search: '', landingPage: '/booking-confirmed/' });
    const creative = getCreativeAttribution();
    assert.equal(creative.utm_content, 'plumbing_ugc_vsl_01');
    assert.equal(creative.creative_id, 'plumbing_v1_missed_calls_hook');
    assert.equal(creative.utm_campaign, 'plumbing_ai');
    assert.equal(getFirstTouch()?.landing_page, '/plumbing-ai/');
  });

  test('creative attribution forwards onto the Cal.com booking link', () => {
    freshStorage();
    captureAttribution({ search: PLUMBING_AD_URL + '&creative_id=plumbing_v1_missed_calls_hook', landingPage: '/plumbing-ai/' });
    const forward = buildCalComForwardFields();
    assert.equal(forward.utm_content, 'plumbing_ugc_vsl_01');
    assert.equal(forward.creative_id, 'plumbing_v1_missed_calls_hook');
    const enriched = appendAttributionToUrl(SCHEDULING.strategyCall.url, forward);
    const url = new URL(enriched);
    assert.equal(url.origin + url.pathname, SCHEDULING.strategyCall.url, 'destination event unchanged');
    assert.equal(url.searchParams.get('utm_content'), 'plumbing_ugc_vsl_01');
    assert.equal(url.searchParams.get('creative_id'), 'plumbing_v1_missed_calls_hook');
  });

  test('AttributionCapture forwards to the same centralized scheduling links (no competing system)', () => {
    const component = read('src/components/AttributionCapture.astro');
    assert.ok(component.includes('buildCalComForwardFields'));
    assert.ok(component.includes('buildCalComRepField'));
    assert.ok(component.includes('SCHEDULING.strategyCall.url'));
    const storeKeys = SRC_FILES.map((f) => readFileSync(f, 'utf8')).join('\n').match(/yai_[a-z_]+/g) ?? [];
    assert.deepEqual(
      [...new Set(storeKeys)].sort(),
      ['yai_attribution_first', 'yai_attribution_latest', 'yai_rep_attribution', 'yai_booking_confirmed_seen'].sort(),
      'funnels must reuse the existing attribution stores, not add new ones'
    );
    for (const file of SRC_FILES.filter((f) => f.includes('/funnel'))) {
      assert.equal(/yai_/.test(readFileSync(file, 'utf8')), false, `${file} introduces its own storage key`);
    }
  });
});

describe('Existing attribution behavior is unchanged', () => {
  test('gclid / gbraid / wbraid still capture, persist, and forward', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=g-1&gbraid=b-1&wbraid=w-1', landingPage: '/' });
    captureAttribution({ search: '', landingPage: '/contact/' });
    const latest = getLatestTouch();
    assert.equal(latest?.gclid, 'g-1');
    assert.equal(latest?.gbraid, 'b-1');
    assert.equal(latest?.wbraid, 'w-1');
    const forward = buildCalComForwardFields();
    assert.equal(forward.gclid, 'g-1');
    assert.equal(forward.gbraid, 'b-1');
    assert.equal(forward.wbraid, 'w-1');
  });

  test('fbclid is captured without disturbing Google click IDs', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=g-1&fbclid=fb-1&utm_source=google', landingPage: '/' });
    assert.equal(getLatestTouch()?.gclid, 'g-1');
    assert.equal(getLatestTouch()?.fbclid, 'fb-1');
    captureAttribution({ search: '?fbclid=fb-2', landingPage: '/plumbing-ai/' });
    assert.equal(getLatestTouch()?.gclid, 'g-1');
    assert.equal(getLatestTouch()?.fbclid, 'fb-2');
  });

  test('first touch is never overwritten; latest touch updates on a genuine new touch', () => {
    freshStorage();
    captureAttribution({ search: '?utm_content=plumbing_ugc_vsl_01', landingPage: '/plumbing-ai/' });
    captureAttribution({ search: '?utm_content=plumbing_ugc_vsl_02', landingPage: '/plumbing-ai/' });
    assert.equal(getFirstTouch()?.utm_content, 'plumbing_ugc_vsl_01', 'first touch is immutable');
    assert.equal(getLatestTouch()?.utm_content, 'plumbing_ugc_vsl_02', 'latest touch advances');
    captureAttribution({ search: '', landingPage: '/about/' });
    assert.equal(getLatestTouch()?.utm_content, 'plumbing_ugc_vsl_02');
    assert.equal(getFirstTouch()?.utm_content, 'plumbing_ugc_vsl_01');
  });

  test('lead payload carries creative fields and still contains no PII', () => {
    freshStorage();
    captureAttribution({ search: PLUMBING_AD_URL + '&creative_id=plumbing_v1_hook&fbclid=fb-9', landingPage: '/plumbing-ai/' });
    const fields = buildLeadAttributionFields();
    assert.equal(fields.attribution_utm_content, 'plumbing_ugc_vsl_01');
    assert.equal(fields.attribution_creative_id, 'plumbing_v1_hook');
    assert.equal(fields.attribution_fbclid, 'fb-9');
    for (const key of Object.keys(fields)) {
      for (const bad of ['email', 'phone', 'firstname', 'lastname', 'message']) {
        assert.equal(key.toLowerCase().includes(bad), false, `attribution field "${key}" may contain PII`);
      }
    }
  });
});

// ============================================================
// 7. ANALYTICS  (unchanged by the conversion pass)
// ============================================================

describe('Funnel GA4 event contract', () => {
  test('event names are exactly the four funnel events — none added, none renamed', () => {
    assert.deepEqual(FUNNEL_EVENTS, {
      view: 'funnel_view',
      vslPlay: 'vsl_play',
      vslProgress: 'vsl_progress',
      ctaClick: 'funnel_cta_click',
    });
  });

  test('booking-click event names are unique per funnel', () => {
    assert.deepEqual(FUNNEL_BOOKING_CLICK_EVENTS, {
      plumbing_ai: 'booking_click_plumbing_ai',
      personal_injury_ai: 'booking_click_pi_ai',
      divorce_law_ai: 'booking_click_divorce_ai',
    });
  });

  test('every builder stamps vertical + funnel_id + creative context', () => {
    const identity = { vertical: 'plumbing', funnel_id: 'plumbing_ai' } as const;
    const creative = { utm_content: 'plumbing_ugc_vsl_01', creative_id: 'plumbing_v1_hook', utm_campaign: 'plumbing_ai' };
    for (const payload of [
      buildFunnelViewParams(identity, creative),
      buildCtaClickParams(identity, 'hero', 'demo', creative),
      buildVslPlayParams(identity, creative),
      buildVslProgressParams(identity, 50, creative),
      buildBookingClickEvent(identity, 'offer', 'demo', creative).params,
    ]) {
      assert.equal(payload.vertical, 'plumbing');
      assert.equal(payload.funnel_id, 'plumbing_ai');
      assert.equal(payload.utm_content, 'plumbing_ugc_vsl_01');
      assert.equal(payload.creative_id, 'plumbing_v1_hook');
    }
  });

  test('cta_location and cta_type are recorded on CTA clicks, including the sticky bar', () => {
    const identity = { vertical: 'divorce_law', funnel_id: 'divorce_law_ai' } as const;
    assert.equal(buildCtaClickParams(identity, 'faq', 'strategy_call').cta_location, 'faq');
    assert.equal(buildCtaClickParams(identity, 'sticky', 'strategy_call').cta_location, 'sticky');
    assert.equal(buildCtaClickParams(identity, 'faq', 'strategy_call').cta_type, 'strategy_call');
  });

  test('vsl_progress is a number at the four defined thresholds', () => {
    assert.deepEqual([...VSL_PROGRESS_THRESHOLDS], [25, 50, 75, 100]);
    const identity = { vertical: 'plumbing', funnel_id: 'plumbing_ai' } as const;
    for (const t of VSL_PROGRESS_THRESHOLDS) {
      assert.equal(buildVslProgressParams(identity, t).vsl_progress, t);
      assert.equal(typeof buildVslProgressParams(identity, t).vsl_progress, 'number');
    }
  });

  test('no blank parameters are ever emitted', () => {
    const identity = { vertical: 'plumbing', funnel_id: 'plumbing_ai' } as const;
    const payload = buildFunnelViewParams(identity, { utm_content: '', creative_id: undefined });
    assert.deepEqual(payload, { vertical: 'plumbing', funnel_id: 'plumbing_ai' });
  });

  test('NO PII: builders emit only allowlisted keys, even when handed extra fields', () => {
    const identity = { vertical: 'plumbing', funnel_id: 'plumbing_ai' } as const;
    const contaminated = {
      utm_content: 'plumbing_ugc_vsl_01',
      email: 'someone@example.com',
      phone: '5551234567',
      first_name: 'Someone',
      company: 'Acme Plumbing',
    } as any;
    for (const payload of [
      buildFunnelViewParams(identity, contaminated),
      buildCtaClickParams(identity, 'hero', 'demo', contaminated),
      buildVslPlayParams(identity, contaminated),
      buildVslProgressParams(identity, 25, contaminated),
      buildBookingClickEvent(identity, 'final', 'demo', contaminated).params,
    ]) {
      assert.ok(isPiiFreePayload(payload), `payload leaked a PII-shaped key: ${Object.keys(payload)}`);
      for (const bad of ['email', 'phone', 'first_name', 'company']) {
        assert.equal(bad in payload, false, `builder forwarded "${bad}"`);
      }
      assert.equal(payload.utm_content, 'plumbing_ugc_vsl_01', 'legitimate creative field still forwarded');
    }
    assert.equal(isPiiFreePayload({ email: 'x' }), false);
    assert.equal(isPiiFreePayload({ vertical: 'plumbing', utm_content: 'x' }), true);
  });

  test('a booking CLICK is never reported as a completed booking', () => {
    const { event } = buildBookingClickEvent({ vertical: 'plumbing', funnel_id: 'plumbing_ai' } as const, 'hero', 'demo');
    assert.notEqual(event, 'booking_confirmed');
    assert.match(event, /^booking_click_/);
    const component = read('src/components/funnel/FunnelAnalytics.astro');
    assert.equal(component.includes("'booking_confirmed'"), false);
  });

  test('booking_confirmed remains the distinct, UID-gated real conversion', () => {
    assert.ok(read('src/pages/booking-confirmed/index.astro').includes('evaluateBookingConfirmedFiring'));
    assert.ok(read('src/lib/bookingConfirmation.ts').includes("event: 'booking_confirmed'"));
  });

  test('funnel pages emit the analytics hooks in the built HTML', () => {
    for (const funnel of FUNNELS) {
      const html = builtFunnel[funnel.path];
      assert.ok(html.includes('id="fnl-analytics-root"'), `${funnel.path}: analytics root missing`);
      assert.ok(html.includes(`data-vertical="${funnel.vertical}"`));
      assert.ok(html.includes(`data-funnel-id="${funnel.funnelId}"`));
      assert.ok(html.includes('data-funnel-cta'), `${funnel.path}: no tracked CTA`);
    }
  });

  test('existing site-wide analytics are preserved, not replaced', () => {
    const tracker = read('src/components/AnalyticsEvents.astro');
    assert.ok(tracker.includes('booking_click_strategy'));
    assert.ok(tracker.includes('booking_click_comprehensive_audit'));
    assert.ok(tracker.includes('ASSESSMENT_EVENTS.start'));
    for (const file of SRC_FILES.filter((f) => f.includes('funnel') || f.includes('metaPixel'))) {
      assert.equal(readFileSync(file, 'utf8').includes('ai_quick_score'), false, `${file} revives a retired event`);
    }
  });

  test('assessment event architecture is untouched', () => {
    const ga4 = read('src/lib/assessment/ga4Events.ts');
    assert.ok(ga4.includes("start: 'ai_assessment_start'"));
    assert.ok(ga4.includes("complete: 'ai_assessment_complete'"));
    assert.ok(ga4.includes("leadSubmit: 'ai_assessment_lead_submit'"));
    assert.ok(ga4.includes("free: 'free_opportunity'"));
    assert.ok(ga4.includes("comprehensive: 'comprehensive_audit'"));
    assert.ok(ga4.includes("FREE_ASSESSMENT_GA4_VERSION = 'short_v1'"));
  });
});

// ============================================================
// 8. META PIXEL / CAPI
// ============================================================

describe('Meta Pixel integration point', () => {
  test('no Pixel ID is configured and none is fabricated', () => {
    assert.equal(getMetaPixelId(), null);
    for (const [name, src] of [['metaPixel.ts', read('src/lib/metaPixel.ts')], ['MetaPixel.astro', read('src/components/MetaPixel.astro')]] as const) {
      assert.deepEqual(src.match(/(?<![\w-])\d{10,20}(?![\w-])/g) ?? [], [], `${name} contains what looks like a hardcoded Pixel ID`);
    }
    assert.ok(read('src/lib/metaPixel.ts').includes('PUBLIC_META_PIXEL_ID'));
  });

  test('no Meta access token is exposed anywhere in src/', () => {
    for (const file of SRC_FILES) {
      const src = readFileSync(file, 'utf8');
      assert.equal(/EAA[A-Za-z0-9]{20,}/.test(src), false, `${file} appears to contain a Meta access token`);
      assert.equal(/(access_?token|ACCESS_?TOKEN)\s*[:=]\s*['"][^'"]{12,}['"]/.test(src), false, `${file} assigns a literal access token`);
    }
  });

  test('the current build ships zero Meta code', () => {
    for (const route of FUNNEL_ROUTES.concat(['/'])) {
      const html = route === '/' ? readFileSync(join(DIST, 'index.html'), 'utf8') : builtFunnel[route];
      assert.equal(html.includes('connect.facebook.net'), false, `${route}: Meta script shipped`);
      assert.equal(/\bfbq\(/.test(html), false, `${route}: fbq call shipped`);
    }
  });

  test('event mapping keeps micro-conversions distinct from real conversions', () => {
    const byEvent = new Map(META_EVENT_MAP.map((m) => [m.dataLayerEvent, m]));
    assert.equal(byEvent.get('funnel_view')?.metaEvent, 'ViewContent');
    assert.equal(byEvent.get('ai_assessment_lead_submit')?.tier, 'conversion');
    assert.equal(byEvent.get('booking_confirmed')?.metaEvent, 'Schedule');
    const clickMapping = META_EVENT_MAP.find((m) => m.dataLayerEvent.includes('booking_click_'))!;
    assert.equal(clickMapping.tier, 'micro');
    assert.notEqual(clickMapping.metaEvent, 'Schedule');
  });

  test('Conversions API is documented as not implemented rather than faked', () => {
    assert.equal(META_CAPI_STATUS.implemented, false);
    assert.ok(existsSync(META_CAPI_STATUS.documentation));
  });
});

// ============================================================
// 9. TRUTHFUL PROOF / SAFETY
// ============================================================

describe('Truthful proof standard', () => {
  test('no testimonials, reviews, client names, or logos on any funnel', () => {
    for (const route of FUNNEL_ROUTES) {
      const html = builtFunnel[route];
      const text = visibleText(html);
      for (const pattern of [
        /what our clients say/i,
        /trusted by \d/i,
        /join \d+[,\d]* (companies|firms|businesses)/i,
        /\d+ (five|5)[- ]star (review|rating)/i,
        /rated \d(\.\d)? out of/i,
        /here'?s what .* had to say/i,
        /our clients (have )?(seen|achieved|report)/i,
      ]) {
        assert.equal(pattern.test(text), false, `${route}: contains ${pattern}`);
      }
      assert.deepEqual(unnegatedMentions(text, /testimonials?/), [], `${route}: presents a testimonial`);
      assert.deepEqual(unnegatedMentions(text, /case stud(y|ies)/), [], `${route}: presents a case study`);
      for (const marker of ['<blockquote', '<cite', '<figcaption', 'aggregateRating', 'ratingValue', 'reviewRating', 'class="testimonial', 'class="review']) {
        assert.equal(html.includes(marker), false, `${route}: fabricated-proof markup ${marker}`);
      }
      assert.equal(/"@type"\s*:\s*"(Review|AggregateRating)"/.test(html), false, `${route}: fake review schema`);
      assert.equal(/application\/ld\+json/.test(html), false, `${route}: unexpected structured data`);
    }
  });

  test('no fabricated statistics, percentages, or ROI claims in funnel copy', () => {
    for (const route of FUNNEL_ROUTES) {
      const text = visibleText(builtFunnel[route]);
      assert.equal(/\d\s*%/.test(text), false, `${route}: contains a percentage claim`);
      for (const pattern of [
        /\d+x (more|increase|return|roi)/i,
        /increase[ds]? (your )?(revenue|bookings|leads|cases) by/i,
        /average (roi|return)/i,
        /we (have )?helped \d+/i,
        /guaranteed/i,
      ]) {
        assert.equal(pattern.test(text), false, `${route}: contains ${pattern}`);
      }
    }
  });

  test('the one concrete sequence is explicitly labeled illustrative and carries a disclaimer', () => {
    const workflow = FUNNELS_BY_ID.plumbing_ai.proof.workflow!;
    assert.ok(workflow, 'the plumbing funnel keeps one labeled illustrative workflow');
    assert.match(workflow.label, /illustrative|example/i);
    assert.ok(workflow.disclaimer.length > 60);
    assert.match(workflow.disclaimer, /not a claim|not a description of a specific customer|not a real customer interaction/i);
    const text = visibleText(builtFunnel['/plumbing-ai/']);
    assert.ok(text.includes(workflow.label), 'the illustrative label must be visible copy');
    assert.ok(text.includes(workflow.disclaimer.slice(0, 50)), 'the disclaimer must render');
    // Every other funnel that shows a sequence must label it too.
    for (const f of FUNNELS) {
      if (f.proof.workflow) assert.match(f.proof.workflow.label, /illustrative|example/i, `${f.funnelId}: unlabeled workflow`);
    }
  });

  test('no funnel ADVERTISES the absence of client results', () => {
    // Not fabricating results does not require announcing that we have
    // none. A paragraph saying so reads as an apology and costs more
    // credibility than it buys — credibility here comes from
    // specificity, process, scope, and transparent pricing.
    for (const route of FUNNEL_ROUTES) {
      const text = visibleText(builtFunnel[route]);
      for (const pattern of [
        /do not have published/i,
        /do not publish [a-z ]*client results/i,
        /not going to invent/i,
        /will not manufacture/i,
        /they will appear here/i,
        /until then/i,
        /wall of five-star reviews/i,
        /Evaluate the Work, Not a Testimonial/i,
        /we cannot substantiate/i,
      ]) {
        assert.equal(pattern.test(text), false, `${route}: defensive proof language "${pattern}" must be removed`);
      }
    }
    // The escape hatch still exists in the contract for a REAL,
    // permissioned client result later — it is simply unused today.
    for (const funnel of FUNNELS) {
      assert.equal(funnel.proof.note, undefined, `${funnel.funnelId}: proof.note should be unused`);
    }
    assert.ok(read('src/lib/funnels/types.ts').includes('note?: string'), 'proof.note must remain available but optional');
  });

  test('no funnel promises a live or preconfigured AI agent it cannot deliver today', () => {
    // We build CUSTOM implementations after discovery. There is no
    // generic finished voice agent to play for a prospect, so nothing
    // may imply one already exists.
    for (const route of FUNNEL_ROUTES) {
      const text = visibleText(builtFunnel[route]);
      for (const pattern of [
        /live (demo|intake walkthrough|call walkthrough)/i,
        /configured (agent|intake) handling/i,
        /hear (the|our) (agent|intake|AI)/i,
        /listen to (the|a) (call|agent)/i,
        /judge (it on )?the demonstration/i,
        /\bdemo\b/i,
      ]) {
        assert.deepEqual(unnegatedMentions(text, pattern), [], `${route}: implies a demo we do not have (${pattern})`);
      }
      // And no fake asset was substituted for one.
      for (const marker of ['<audio', 'waveform', 'data-player', 'class="player']) {
        assert.equal(builtFunnel[route].toLowerCase().includes(marker), false, `${route}: fake demo asset ${marker}`);
      }
    }
  });

  test('the attorney proof sections show PROPOSED architecture, not a finished agent', () => {
    for (const id of ['personal_injury_ai', 'divorce_law_ai'] as const) {
      const f = FUNNELS_BY_ID[id];
      assert.match(f.proof.eyebrow, /See How It Would Work/i);
      assert.match(f.proof.heading, /Would (Fit|Work)/i);
      const slots = f.proof.demoSlots.map((s2) => `${s2.title} ${s2.body}`).join(' ');
      // Hedged language: these are proposals until discovery happens.
      assert.match(slots, /Proposed/i, `${id}: proof items must be framed as proposed`);
      assert.match(slots, /could|example/i, `${id}: proof items must be hedged`);
      assert.equal(/\bdemo\b|walkthrough|configured agent/i.test(slots), false, `${id}: demo framing remains`);
      // Scheduling / follow-up / attribution are all still covered.
      for (const topic of [/scheduling/i, /follow-up/i, /attribution|reporting/i]) {
        assert.match(slots, topic, `${id}: proof must still cover ${topic}`);
      }
    }
  });

  test('no fake scarcity, countdowns, or manufactured urgency', () => {
    for (const route of FUNNEL_ROUTES) {
      const html = builtFunnel[route];
      const text = visibleText(html);
      for (const pattern of [/only \d+ (spots|slots|seats|left)/i, /limited time/i, /offer expires/i, /countdown/i, /price goes up/i, /today only/i]) {
        assert.equal(pattern.test(text), false, `${route}: contains ${pattern}`);
      }
      assert.equal(/setInterval\s*\(/.test(html), false, `${route}: contains a timer`);
      assert.equal(/data-countdown|class="[^"]*countdown/.test(html), false, `${route}: countdown markup`);
    }
  });
});

describe('Site-safety invariants', () => {
  test('funnels never link to the internal full assessment engine or the retired audit route', () => {
    for (const route of FUNNEL_ROUTES) {
      assert.equal(builtFunnel[route].includes('href="/ai-assessment/full/'), false, `${route}: links to the engine`);
      assert.equal(builtFunnel[route].includes('href="/ai-department-audit/'), false, `${route}: links to a retired route`);
    }
  });

  test('scheduling stays centralized — no hardcoded Cal.com URL in funnel code', () => {
    const funnelFiles = SRC_FILES.filter((f) => f.includes('/funnels/') || f.includes('/funnel/'));
    assert.ok(funnelFiles.length > 0);
    for (const file of funnelFiles) {
      assert.equal(readFileSync(file, 'utf8').includes('https://cal.com/'), false, `${file} hardcodes a Cal.com URL`);
    }
    const known = new Set(Object.values(SCHEDULING).map((e) => e.url));
    for (const funnel of FUNNELS) {
      for (const cta of [funnel.hero.cta, funnel.offer.cta, funnel.fit.cta, funnel.close.cta]) {
        assert.ok(known.has(cta.href), `${funnel.funnelId}: CTA href is not a centralized scheduling event`);
      }
      assert.equal(funnel.hero.cta.href, SCHEDULING.strategyCall.url);
    }
  });

  test('funnel booking links reach the built page unmodified so site-wide enrichment applies', () => {
    const escaped = SCHEDULING.strategyCall.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const funnel of FUNNELS) {
      const count = (mainContent(builtFunnel[funnel.path]).match(new RegExp(escaped, 'g')) || []).length;
      assert.ok(count >= 4, `${funnel.path}: expected the centralized booking URL on every CTA (found ${count})`);
    }
  });

  test('no broken internal links on any funnel page', () => {
    for (const route of FUNNEL_ROUTES) {
      const hrefs = [...builtFunnel[route].matchAll(/<a [^>]*href="(\/[^"#?]*)"/g)].map((m) => m[1]);
      assert.ok(hrefs.length > 0, `${route}: expected internal links`);
      for (const href of new Set(hrefs)) {
        const target = href.endsWith('/') ? join(DIST, href.slice(1), 'index.html') : join(DIST, href.slice(1));
        assert.ok(existsSync(target), `${route}: broken internal link ${href}`);
      }
    }
  });

  test('funnels use minimal chrome — no site mega-menu competing with the CTA', () => {
    for (const route of FUNNEL_ROUTES) {
      const html = builtFunnel[route];
      assert.equal(html.includes('nav-megamenu-item'), false, `${route}: full site nav present`);
      assert.equal(html.includes('services-megamenu'), false, `${route}: services mega-menu present`);
      assert.ok(html.includes('fnl-header'), `${route}: minimal header missing`);
      assert.ok(html.includes('fnl-footer'), `${route}: minimal footer missing`);
      assert.ok(html.includes('href="/privacy/"'));
      assert.ok(html.includes('href="/terms/"'));
    }
  });
});

// ============================================================
// 10. INDEXATION  (unchanged by the conversion pass)
// ============================================================

describe('Funnel indexation strategy', () => {
  test('every funnel is noindex, follow', () => {
    for (const funnel of FUNNELS) {
      assert.equal(funnel.seo.robots, 'noindex, follow');
      assert.ok(builtFunnel[funnel.path].includes('<meta name="robots" content="noindex, follow">'));
    }
  });

  test('noindex funnels emit no canonical (consistent with the site rule)', () => {
    for (const route of FUNNEL_ROUTES) {
      assert.equal(/<link rel="canonical"/.test(builtFunnel[route]), false, `${route}: noindex page must not self-canonicalize`);
    }
  });

  test('funnels are excluded from the sitemap', () => {
    const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
    for (const route of FUNNEL_ROUTES) {
      assert.equal(sitemap.includes(route), false, `${route} must not be in the sitemap`);
    }
  });

  test('the organic industry pages they overlap are untouched and still indexable', () => {
    const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
    for (const route of ['/industries/plumbing/', '/industries/law-firms/']) {
      const html = readFileSync(join(DIST, route.slice(1), 'index.html'), 'utf8');
      assert.equal(/<meta name="robots"/.test(html), false, `${route} must remain indexable`);
      assert.ok(html.includes(`<link rel="canonical" href="https://youraidepartment.ai${route}">`));
      assert.ok(sitemap.includes(`https://youraidepartment.ai${route}`));
    }
  });

  test('funnels are paid-only: no indexable page links to them', () => {
    const offenders: string[] = [];
    for (const file of walk(DIST, ['.html'])) {
      const rel = file.slice(DIST.length).replace(/index\.html$/, '');
      if (FUNNEL_ROUTES.includes(rel)) continue;
      const html = readFileSync(file, 'utf8');
      if (/<meta name="robots"/.test(html)) continue;
      for (const route of FUNNEL_ROUTES) {
        if (html.includes(`href="${route}"`)) offenders.push(`${rel} -> ${route}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

// ============================================================
// 11. VSL
// ============================================================

describe('VSL integration', () => {
  test('with no asset configured, the hero renders cleanly with no placeholder', () => {
    for (const funnel of FUNNELS) {
      assert.equal(funnel.vsl, undefined, 'no VSL asset is configured yet');
      const html = builtFunnel[funnel.path];
      assert.equal(/video coming soon|coming soon/i.test(visibleText(html)), false, `${funnel.path}: placeholder copy shipped`);
      assert.equal(html.includes('fnl-vsl'), false, `${funnel.path}: empty player well shipped`);
      assert.equal(/<video/.test(html), false, `${funnel.path}: empty video element shipped`);
      assert.equal(html.includes('data-funnel-vsl'), false, `${funnel.path}: empty player shipped`);
      for (const iframe of [...html.matchAll(/<iframe[^>]*>/g)].map((m) => m[0])) {
        assert.ok(iframe.includes('googletagmanager.com'), `${funnel.path}: unexpected iframe ${iframe}`);
      }
    }
  });

  test('when configured, the VSL is a hero-level conversion anchor', () => {
    const page = read('src/components/funnel/FunnelPage.astro');
    // The player renders inside the hero section, not halfway down.
    const heroStart = page.indexOf('1. HERO');
    const leakStart = page.indexOf('2. THE LEAK');
    const vslAt = page.indexOf('<FunnelVSL');
    assert.ok(vslAt > heroStart && vslAt < leakStart, 'the VSL must render inside the hero');
    const styles = read('src/components/funnel/FunnelStyles.astro');
    assert.match(styles, /\.fnl-hero-inner\.has-vsl\s*\{[\s\S]*?grid-template-columns:\s*1fr 1fr/, 'the VSL gets near-equal width beside the copy on desktop');
  });

  test('the player supports both self-hosted files and embeds, with lazy loading', () => {
    const vsl = read('src/components/funnel/FunnelVSL.astro');
    assert.ok(vsl.includes("vsl.kind === 'file'"));
    assert.ok(vsl.includes('poster={vsl.poster}'));
    assert.ok(vsl.includes('preload="none"'), 'must not aggressively preload video');
    assert.ok(vsl.includes('loading="lazy"'), 'embeds must lazy-load');
    assert.ok(vsl.includes('playsinline'), 'mobile inline playback required');
    assert.ok(vsl.includes('aspect-ratio'), 'reserved box prevents layout shift');
    assert.ok(vsl.includes('kind="captions"'), 'caption track support required');
  });

  test('autoplay is muted-only — audio never autoplays', () => {
    const vsl = read('src/components/funnel/FunnelVSL.astro');
    assert.ok(vsl.includes('muted={vsl.autoplayMuted ? true : undefined}'));
    assert.ok(vsl.includes('autoplay={vsl.autoplayMuted ? true : undefined}'));
    assert.equal([...vsl.matchAll(/autoplay(?!Muted)/g)].length, 1, 'exactly one autoplay attribute, and it must be the guarded form');
  });

  test('progress events are wired for self-hosted video only, and never faked for embeds', () => {
    const analytics = read('src/components/funnel/FunnelAnalytics.astro');
    assert.ok(analytics.includes('video[data-funnel-vsl="file"]'), 'file-only selector required');
    assert.ok(analytics.includes("addEventListener('timeupdate'"));
    assert.ok(analytics.includes("addEventListener('ended'"), 'a full watch must always register 100%');
    assert.ok(analytics.includes('buildVslProgressParams'));
    assert.equal(/iframe[\s\S]{0,80}timeupdate/.test(analytics), false);
  });

  test('the configuration point is documented', () => {
    const doc = read('docs/funnels/paid-social-funnel-system.md');
    assert.ok(doc.includes('src/data/funnels/'), 'doc must name the config location');
    assert.ok(doc.includes('public/video/'), 'doc must name the asset location');
  });
});

// ============================================================
// 12. DOCUMENTATION
// ============================================================

describe('Analytics handoff documentation', () => {
  const plan = 'docs/analytics/funnel-tracking-plan.md';

  test('the tracking plan exists and covers every event in the architecture', () => {
    assert.ok(existsSync(plan));
    const doc = read(plan);
    for (const event of [
      'page_view', 'funnel_view', 'vsl_play', 'vsl_progress', 'funnel_cta_click',
      'booking_click_plumbing_ai', 'booking_click_pi_ai', 'booking_click_divorce_ai',
      'ai_assessment_start', 'ai_assessment_complete', 'ai_assessment_lead_submit',
      'booking_confirmed',
    ]) {
      assert.ok(doc.includes(event), `tracking plan must document ${event}`);
    }
  });

  test('the plan records the conversion hierarchy, dimensions, and CTA placements', () => {
    const doc = read(plan);
    assert.match(doc, /key event/i);
    for (const dimension of ['vertical', 'funnel_id', 'creative_id', 'utm_content', 'cta_location', 'assessment_type', 'assessment_version']) {
      assert.ok(doc.includes(dimension), `plan must list the ${dimension} dimension`);
    }
    // The documented cta_location values must match what the code emits.
    for (const location of ['hero', 'offer', 'faq', 'final', 'sticky']) {
      assert.ok(doc.includes(location), `plan must document cta_location "${location}"`);
    }
  });

  test('the creative naming convention is documented', () => {
    const src = read('docs/analytics/creative-naming-convention.md');
    for (const name of ['plumbing_ugc_vsl_01', 'pi_ugc_vsl_01', 'divorce_ugc_vsl_01', 'utm_content', 'creative_id']) {
      assert.ok(src.includes(name), `naming convention must document ${name}`);
    }
  });

  test('funnel configs match the documented creative prefixes and campaign names', () => {
    assert.equal(FUNNELS_BY_ID.plumbing_ai.creativePrefix, 'plumbing_ugc_vsl');
    assert.equal(FUNNELS_BY_ID.personal_injury_ai.creativePrefix, 'pi_ugc_vsl');
    assert.equal(FUNNELS_BY_ID.divorce_law_ai.creativePrefix, 'divorce_ugc_vsl');
    assert.equal(FUNNELS_BY_ID.plumbing_ai.campaignName, 'plumbing_ai');
    assert.equal(FUNNELS_BY_ID.personal_injury_ai.campaignName, 'personal_injury_ai');
    assert.equal(FUNNELS_BY_ID.divorce_law_ai.campaignName, 'divorce_law_ai');
  });

  test('the section budget is documented alongside the code that enforces it', () => {
    const doc = read('docs/funnels/paid-social-funnel-system.md');
    assert.match(doc, /6-8/, 'plumbing budget must be documented');
    assert.match(doc, /7-9/, 'attorney budget must be documented');
    assert.ok(read('src/lib/funnels/types.ts').includes('SECTION BUDGET'));
  });
});

// ============================================================
// 13. TYPOGRAPHY / LAYOUT / MOBILE / PERFORMANCE
// ============================================================

describe('Typography, layout and mobile', () => {
  const styles = read('src/components/funnel/FunnelStyles.astro');

  test('content width targets premium direct-response proportions', () => {
    const containerWidth = Number(styles.match(/\.fnl-container\s*\{[\s\S]*?max-width:\s*(\d+)px/)?.[1]);
    assert.ok(containerWidth >= 1100 && containerWidth <= 1200, `container is ${containerWidth}px, target 1100-1200px`);
    // The funnel owns its own shell — it does not inherit the site's
    // 1280px marketing Container.
    const page = read('src/components/funnel/FunnelPage.astro');
    assert.equal(page.includes("from '../Container.astro'"), false, 'funnels use fnl-container, not the site Container');
    assert.ok(page.includes('class="fnl-container"'));
  });

  test('body copy is set at a readable size, not 14px marketing fine print', () => {
    const bodySize = Number(styles.match(/\.fnl-p\s*\{[\s\S]*?font-size:\s*([\d.]+)rem/)?.[1]);
    assert.ok(bodySize >= 1.0625, `.fnl-p is ${bodySize}rem — sales copy needs ~17px minimum`);
    // And it steps up on desktop.
    assert.match(styles, /@media \(min-width: 900px\)\s*\{\s*\.fnl-p\s*\{\s*font-size:\s*1\.125rem/);
    // No important sales element is set below 0.9rem.
    for (const selector of ['.fnl-card p', '.fnl-faq-a', '.fnl-check-list li', '.fnl-fit-list li', '.fnl-deliverables li']) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const size = Number(styles.match(new RegExp(escaped + '\\s*\\{[\\s\\S]*?font-size:\\s*([\\d.]+)rem'))?.[1]);
      assert.ok(size >= 1, `${selector} is ${size}rem — too small for sales content`);
    }
  });

  test('headlines carry real weight', () => {
    const h1Max = Number(styles.match(/\.fnl-hero h1\s*\{[\s\S]*?clamp\([^,]+,[^,]+,\s*([\d.]+)rem\)/)?.[1]);
    assert.ok(h1Max >= 3.4, `H1 tops out at ${h1Max}rem — too small for a paid-social hero`);
    const h2Max = Number(styles.match(/\.fnl-h2\s*\{[\s\S]*?clamp\([^,]+,[^,]+,\s*([\d.]+)rem\)/)?.[1]);
    assert.ok(h2Max >= 2.5, `H2 tops out at ${h2Max}rem`);
  });

  test('pricing is rendered at display size, not as table text', () => {
    const priceMax = Number(styles.match(/\.fnl-price-line-value\s*\{[\s\S]*?clamp\([^,]+,[^,]+,\s*([\d.]+)rem\)/)?.[1]);
    assert.ok(priceMax >= 2.2, `price value tops out at ${priceMax}rem — it should be the most scannable thing in the section`);
    for (const route of FUNNEL_ROUTES) {
      assert.ok(builtFunnel[route].includes('fnl-price-line-value'), `${route}: price must render in the offer panel`);
    }
  });

  test('viewport is set and wide content scrolls inside its own container', () => {
    for (const route of FUNNEL_ROUTES) {
      assert.ok(builtFunnel[route].includes('name="viewport" content="width=device-width, initial-scale=1.0"'));
    }
    assert.match(styles, /\.fnl-flow-scroll\s*\{[\s\S]*?overflow-x:\s*auto/, 'the flow diagram must scroll inside its own box');
    assert.match(styles, /\.fnl-section\s*\{[\s\S]*?overflow-x:\s*hidden/);
    assert.match(styles, /\.fnl-hero\s*\{[\s\S]*?overflow-x:\s*hidden/);
    assert.match(styles, /\.fnl-close\s*\{[\s\S]*?overflow-x:\s*hidden/);
  });

  test('every multi-column grid collapses to one column on phones', () => {
    // Each grid must declare a single-column base and only add columns
    // inside a min-width media query.
    for (const selector of ['.fnl-leak-grid', '.fnl-grid', '.fnl-pillars', '.fnl-steps', '.fnl-deliverables']) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const block = styles.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}'))?.[1] ?? '';
      assert.match(block, /grid-template-columns:\s*1fr/, `${selector} must be single-column by default`);
    }
    // Multi-column rules only ever appear under min-width queries.
    const multiCol = [...styles.matchAll(/grid-template-columns:\s*repeat\((\d+)/g)].map((m) => Number(m[1]));
    assert.ok(multiCol.every((n) => n >= 2), 'repeat() columns should only be used for multi-column layouts');
    assert.equal(/@media \(max-width[^)]*\)\s*\{[^}]*grid-template-columns:\s*repeat/.test(styles), false, 'no multi-column grid inside a max-width query');
  });

  test('section padding is substantial but not cavernous', () => {
    const mobile = Number(styles.match(/\.fnl-section\s*\{[\s\S]*?padding-block:\s*(\d+)px/)?.[1]);
    assert.ok(mobile >= 40 && mobile <= 60, `mobile section padding is ${mobile}px`);
    const desktop = Number(styles.match(/@media \(min-width: 900px\)\s*\{\s*\.fnl-section\s*\{\s*padding-block:\s*(\d+)px/)?.[1]);
    assert.ok(desktop >= 60 && desktop <= 90, `desktop section padding is ${desktop}px`);
  });

  test('tone alternation is restrained — the offer is the visual centre of gravity', () => {
    for (const route of FUNNEL_ROUTES) {
      const body = mainContent(builtFunnel[route]);
      const tones = [...body.matchAll(/<section class="(?:fnl-section )?(fnl-(?:hero|dark-2|dark|light|white|close))/g)].map((m) => m[1]);
      let switches = 0;
      for (let i = 1; i < tones.length; i++) if (tones[i] !== tones[i - 1]) switches++;
      assert.ok(switches <= 6, `${route}: ${switches} tone switches — too much light/dark alternation`);
      // Exactly one mid-page dark offer section.
      assert.equal(tones.filter((t) => t === 'fnl-dark').length, 1, `${route}: the offer should be the only mid-page dark block`);
    }
  });

  test('no heavy client framework or animation library is introduced', () => {
    const pkg = JSON.parse(read('package.json'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const heavy of ['react', 'vue', 'svelte', 'gsap', 'framer-motion', 'jquery', 'alpinejs', 'lottie-web', 'swiper']) {
      assert.equal(deps.includes(heavy), false, `funnels must not introduce ${heavy}`);
    }
  });

  test('funnel pages ship no third-party script beyond the existing GTM container', () => {
    for (const route of FUNNEL_ROUTES) {
      for (const src of [...builtFunnel[route].matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)].map((m) => m[1])) {
        assert.ok(src.includes('googletagmanager.com'), `${route}: unexpected third-party script ${src}`);
      }
    }
  });

  test('all funnel styles are token-based — no one-off hex colors', () => {
    const hexes = [...styles.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map((m) => m[0].toUpperCase());
    const allowed = new Set(['#000', '#CBD5E1', '#334155', '#475569', '#92400E']);
    for (const hex of hexes) {
      assert.ok(allowed.has(hex), `unexpected one-off color ${hex} — add a token instead`);
    }
  });
});
