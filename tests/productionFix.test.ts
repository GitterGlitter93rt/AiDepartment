// Production-fix regression + discoverability + branding test suite.
// Run with: node --experimental-strip-types --test tests/productionFix.test.ts
//
// Covers the final production pass without any fake-DOM harness — the
// dead "Get My Score" button class of bug is caught by a simple
// source-contract check: every element id an app queries via
// querySelector('#...') must be an id that app actually renders. That
// exact mismatch (button id="a-quick-start-btn" vs a stale
// querySelector('#a-start-btn') lookup, silently no-op'd by optional
// chaining) is what dead-wired the start button in production.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QUICK_QUESTIONS } from '../src/data/assessment/quickQuestions.ts';
import {
  buildAssessmentStartParams,
  ASSESSMENT_TYPE,
} from '../src/lib/assessment/ga4Events.ts';

const read = (f: string): string => readFileSync(join(process.cwd(), f), 'utf8');

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.includes(full.slice(full.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

// ---- PART 1: dead start-button regression -----------------------------------

describe('Free assessment start button wiring', () => {
  test('every id queried via querySelector("#...") is rendered by the same app', () => {
    const apps = [
      'src/components/assessment/quickAssessmentApp.ts',
      'src/components/assessment/assessmentApp.ts',
    ];
    for (const file of apps) {
      const src = read(file);
      const rendered = new Set([...src.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
      const queried = [...src.matchAll(/querySelector(?:All)?(?:<[^>]*>)?\(['"`]#([^'"`]+)['"`]\)/g)].map((m) => m[1]);
      assert.ok(queried.length > 0, `${file} should query element ids`);
      for (const id of queried) {
        assert.ok(rendered.has(id), `${file} queries #${id} but never renders id="${id}"`);
      }
    }
  });

  test('quick app renders and wires the exact start button id', () => {
    const app = read('src/components/assessment/quickAssessmentApp.ts');
    assert.ok(app.includes('id="a-quick-start-btn"'), 'start button must render a-quick-start-btn');
    assert.ok(app.includes("querySelector('#a-quick-start-btn')"), 'start listener must attach to a-quick-start-btn');
    // Server-rendered intro on the route must use the same id, so the
    // pre-JS button and the mounted button are interchangeable.
    const page = read('src/pages/free-ai-assessment/index.astro');
    assert.ok(page.includes('id="a-quick-start-btn"'));
    assert.ok(page.includes('mountQuickAssessmentApp'));
  });

  test('clicking start enters the 15-question flow (startQuiz -> first question)', () => {
    const app = read('src/components/assessment/quickAssessmentApp.ts');
    // startQuiz must advance state intro -> question, and renderQuestion
    // must number questions against the full 15-question set.
    assert.ok(app.includes('private startQuiz = () => {'));
    assert.ok(app.includes("this.state = 'question';"));
    assert.match(app, /Question \$\{idx \+ 1\} of \$\{total\}/);
    assert.ok(app.includes('QUICK_QUESTIONS.length'));
    // First question flows from QUICK_QUESTIONS order (QS1 industry).
    assert.equal(QUICK_QUESTIONS[0].id, 'QS1');
  });

  test('GA4: start fires exactly once — app never pushes start (delegated handler only)', () => {
    const app = read('src/components/assessment/quickAssessmentApp.ts');
    // The app must NOT push the start event itself: the site-wide
    // delegated handler in AnalyticsEvents.astro owns it, and an
    // app-level push would double-fire on the same click. (Checked as
    // push-statement patterns — comments may legitimately name the
    // event family.)
    assert.equal(app.includes('event: ASSESSMENT_EVENTS.start'), false, 'app must not push the start event');
    assert.equal(app.includes("event: 'ai_assessment_start'"), false);

    const tracker = read('src/components/AnalyticsEvents.astro');
    // Exactly one guarded start push, with free params selected by the
    // quick start button id.
    assert.equal((tracker.match(/pushEvent\(assessmentStartEventName/g) || []).length, 1, 'single start push');
    assert.ok(tracker.includes('!assessmentStartFired'), 'once-per-page guard required');
    assert.ok(tracker.includes("startBtn.id === 'a-quick-start-btn' ? freeStartParams"), 'free params wired to the quick button');
    // No retired event names anywhere.
    assert.equal(tracker.includes('ai_quick_score'), false);
  });

  test('free start params are assessment_type=free_opportunity, assessment_version=short_v1', () => {
    const params = buildAssessmentStartParams(ASSESSMENT_TYPE.free);
    assert.equal(params.assessment_type, 'free_opportunity');
    assert.equal(params.assessment_version, 'short_v1');
  });
});

// ---- PART 2: free-assessment timing consistency -------------------------------

describe('Free assessment timing is consistently 3-4 minutes', () => {
  test('public free-assessment copy promises 3-4 minutes', () => {
    assert.ok(read('src/pages/free-ai-assessment/index.astro').includes('3-4 minutes'));
    assert.ok(read('src/pages/ai-assessment/index.astro').includes('3-4 Minutes'));
    const app = read('src/components/assessment/quickAssessmentApp.ts');
    assert.ok(app.includes('About 3-4 minutes'));
    assert.ok(read('src/components/FinalCTA.astro').includes('3&ndash;4 Minutes'));
    assert.ok(read('src/components/Hero.astro').includes('3–4 minutes'));
  });

  test('no stale 7-12/7-10 free-assessment timing outside the hidden full engine', () => {
    const stale = [];
    for (const file of walk(join(process.cwd(), 'src'), ['.astro', '.ts', '.tsx', '.mdx'])) {
      if (
        file.includes('ai-assessment/full') ||
        file.endsWith('assessmentApp.ts') // the preserved 64-question engine's own UI
      ) {
        continue;
      }
      if (/(7[-–]12|7[-–]10)\s*minutes/i.test(readFileSync(file, 'utf8'))) stale.push(file);
    }
    assert.deepEqual(stale, []);
  });
});

// ---- PARTS 3-6: paid-audit discoverability --------------------------------------

describe('Paid audit discoverability', () => {
  test('Services mega-menu exposes the paid audit (desktop + mobile share this list)', () => {
    const site = read('src/lib/site.ts');
    assert.ok(site.includes("label: 'Comprehensive AI Business Audit'"));
    assert.ok(site.includes("href: '/comprehensive-ai-business-audit/'"));
    const header = read('src/components/Header.astro');
    assert.ok(header.includes('SERVICES_MENU'), 'desktop menu renders from the shared list');
    assert.ok(header.includes('MEGA_MENUS'), 'mobile menu renders from the same shared list');
  });

  test('top-right primary CTA remains the free assessment', () => {
    const site = read('src/lib/site.ts');
    assert.ok(site.includes("label: 'Get Your AI Department Score'"));
    assert.ok(site.includes("href: '/free-ai-assessment/'"));
  });

  test('homepage exposes the paid audit as a secondary path below the free funnel', () => {
    const home = read('src/pages/index.astro');
    assert.ok(home.includes('PaidAuditCTA'));
    const band = read('src/components/PaidAuditCTA.astro');
    assert.ok(band.includes('href="/comprehensive-ai-business-audit/"'));
    assert.ok(band.includes('Explore the $495 AI Business Audit'));
    assert.ok(band.includes('$495'));
    assert.equal(band.includes('/ai-assessment/full/'), false);
    // Positioned before the free FinalCTA band (free stays dominant).
    assert.ok(home.indexOf('<PaidAuditCTA />') < home.indexOf('<FinalCTA />'));
  });

  test('footer Services group exposes the paid audit and never the full engine', () => {
    const site = read('src/lib/site.ts');
    const servicesBlock = site.slice(site.indexOf('services: ['), site.indexOf('industries: FOOTER_INDUSTRIES'));
    assert.ok(servicesBlock.includes("href: '/comprehensive-ai-business-audit/'"));
    // href/value patterns only — comments may document the engine.
    assert.equal(site.includes("href: '/ai-assessment/full/'"), false);
    assert.equal(site.includes('href="/ai-assessment/full/'), false);
    assert.ok(read('src/components/Footer.astro').includes('FOOTER_LINKS'));
  });
});

// ---- PART 7: free-results CTA hierarchy -----------------------------------------

describe('Free assessment results CTA hierarchy', () => {
  test('primary = free strategy call; secondary = paid audit; audit never above the strategy call', () => {
    const app = read('src/components/assessment/quickAssessmentApp.ts');
    assert.ok(app.includes('Schedule a Free AI Strategy Call'));
    assert.ok(app.includes('SCHEDULING.strategyCall.url'));
    assert.ok(app.includes('href="/comprehensive-ai-business-audit/"'));
    // The primary strategy-call band must appear BEFORE the secondary
    // paid-audit upgrade card in the rendered results order.
    assert.ok(
      app.indexOf('class="r-cta"') < app.indexOf('class="q-upgrade"'),
      'free strategy-call CTA must lead the results CTA order'
    );
    // The paid card's button is deliberately the secondary style.
    assert.ok(app.includes('r-btn r-btn-secondary" href="/comprehensive-ai-business-audit/"'));
    // No link/CTA to the hidden full engine (comments may mention it).
    assert.equal(app.includes('href="/ai-assessment/full/'), false);
  });
});

// ---- PART 12: favicon / brand system ----------------------------------------------

describe('Favicon and brand icon system', () => {
  const FAVICON_FILES = [
    'public/favicon.ico',
    'public/favicon.svg',
    'public/favicon-16x16.png',
    'public/favicon-32x32.png',
    'public/apple-touch-icon.png',
    'public/icon-192.png',
    'public/icon-512.png',
    'public/site.webmanifest',
  ];

  test('all required favicon assets exist', () => {
    for (const f of FAVICON_FILES) {
      assert.ok(existsSync(f), `${f} must exist`);
      assert.ok(statSync(f).size > 0, `${f} must be non-empty`);
    }
  });

  test('BaseLayout centrally references every asset — no per-page icon links, no broken paths', () => {
    const layout = read('src/layouts/BaseLayout.astro');
    for (const ref of [
      '/favicon.svg',
      '/favicon.ico',
      '/favicon-16x16.png',
      '/favicon-32x32.png',
      '/apple-touch-icon.png',
      '/site.webmanifest',
    ]) {
      assert.ok(layout.includes(`href="${ref}"`), `BaseLayout must reference ${ref}`);
    }
    assert.ok(layout.includes('name="theme-color" content="#08111F"'));
    // Every referenced icon/manifest path resolves to a real public file.
    const refs = [...layout.matchAll(/<link[^>]+href="(\/[^"]+)"[^>]*>/g)].map((m) => m[1]);
    for (const ref of refs) {
      assert.ok(existsSync(join(process.cwd(), 'public', ref.slice(1))), `referenced asset ${ref} must exist in public/`);
    }
  });

  test('webmanifest is valid JSON with matching icon files and brand colors', () => {
    const manifest = JSON.parse(read('public/site.webmanifest'));
    assert.equal(manifest.name, 'Your AI Department');
    assert.equal(manifest.theme_color, '#08111F');
    for (const icon of manifest.icons) {
      assert.ok(existsSync(join(process.cwd(), 'public', icon.src.slice(1))), `${icon.src} must exist`);
    }
  });
});
