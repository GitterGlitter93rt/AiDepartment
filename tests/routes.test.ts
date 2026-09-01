// Route architecture + GA4 event contract test suite.
// Run with: node --experimental-strip-types --test tests/routes.test.ts
//
// Verifies the corrected public route architecture without touching a
// browser: permanent routes exist, the legacy /ai-assessment/ route is
// a choice page (not an app, not a redirect), the retired
// /ai-department-audit/ route is gone and cleanly redirected, the
// 64-question engine is preserved at /ai-assessment/full/, the shared
// GA4 event family and funnel parameters are correct with no PII, and
// internal links point at the right destinations.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// ---- Pure-logic imports (no DOM needed) -----------------------------------

import { QUESTIONS } from '../src/data/assessment/questions.ts';
import { QUICK_QUESTIONS } from '../src/data/assessment/quickQuestions.ts';
import {
  ASSESSMENT_EVENTS,
  ASSESSMENT_TYPE,
  buildAssessmentStartParams,
  buildAssessmentCompleteParams,
  buildAssessmentLeadSubmitParams,
} from '../src/lib/assessment/ga4Events.ts';
import { SCHEDULING } from '../src/lib/scheduling.ts';

// ---- Helpers ---------------------------------------------------------------

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.includes(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

// ---- Route architecture ------------------------------------------------------

describe('Permanent public routes exist', () => {
  test('/free-ai-assessment/ page exists and mounts the quick assessment', () => {
    assert.ok(existsSync('src/pages/free-ai-assessment/index.astro'));
    const page = read('src/pages/free-ai-assessment/index.astro');
    assert.ok(page.includes('mountQuickAssessmentApp'), 'must reuse the existing quick app');
    assert.ok(page.includes('path="/free-ai-assessment/"'));
    // Indexable: no noindex prop on this page.
    assert.equal(page.includes('noindex'), false);
  });

  test('/comprehensive-ai-business-audit/ page exists with the $495 offer', () => {
    assert.ok(existsSync('src/pages/comprehensive-ai-business-audit/index.astro'));
    const page = read('src/pages/comprehensive-ai-business-audit/index.astro');
    assert.ok(page.includes('path="/comprehensive-ai-business-audit/"'));
    assert.ok(page.includes('Book Your'));
    assert.ok(page.includes('SCHEDULING.comprehensiveAudit.price'));
    assert.equal(page.includes('noindex'), false);
  });

  test('both permanent routes are in the sitemap', () => {
    const sitemap = read('public/sitemap.xml');
    assert.ok(sitemap.includes('https://youraidepartment.ai/free-ai-assessment/'));
    assert.ok(sitemap.includes('https://youraidepartment.ai/comprehensive-ai-business-audit/'));
  });
});

describe('/ai-assessment/ is a legacy choice page — not an app, not a redirect', () => {
  const page = read('src/pages/ai-assessment/index.astro');

  test('presents both options with CTAs to the permanent routes', () => {
    assert.ok(page.includes('href="/free-ai-assessment/"'), 'must link to the free assessment');
    assert.ok(page.includes('href="/comprehensive-ai-business-audit/"'), 'must link to the paid audit');
  });

  test('does not mount either assessment application', () => {
    assert.equal(page.includes('mountQuickAssessmentApp'), false);
    assert.equal(page.includes('mountAssessmentApp'), false);
  });

  test('does not auto-redirect (no meta refresh / JS redirect)', () => {
    assert.equal(page.includes('http-equiv="refresh"'), false);
    assert.equal(page.includes('window.location'), false);
  });
});

describe('/ai-assessment/full/ preserves the comprehensive engine', () => {
  const page = read('src/pages/ai-assessment/full/index.astro');

  test('still mounts the untouched 64-question engine', () => {
    assert.ok(page.includes('mountAssessmentApp'));
    assert.ok(page.includes('assessmentApp'));
  });

  test('is deliberately noindex (underlying engine, not a competing SEO page)', () => {
    assert.ok(page.includes('noindex'));
    const sitemap = read('public/sitemap.xml');
    assert.equal(sitemap.includes('/ai-assessment/full/'), false, 'must not be in the sitemap');
  });

  test('the engines themselves are intact: 64 comprehensive questions, 15 quick questions', () => {
    assert.equal(QUESTIONS.length, 64);
    assert.equal(QUICK_QUESTIONS.length, 15);
  });
});

describe('/ai-department-audit/ is removed and cleanly redirected', () => {
  test('no page directory remains at the retired route', () => {
    assert.equal(existsSync('src/pages/ai-department-audit'), false);
  });

  test('astro config redirects the retired route to the permanent route', () => {
    const config = read('astro.config.mjs');
    assert.ok(config.includes("'/ai-department-audit'"));
    assert.ok(config.includes("'/comprehensive-ai-business-audit/'"));
  });

  test('retired route is not in the sitemap', () => {
    assert.equal(read('public/sitemap.xml').includes('ai-department-audit'), false);
  });

  test('no internal links to the retired route remain in src/', () => {
    // Comments may mention the retired route (explaining the redirect);
    // actual link/CTA targets must not. Match only href/value patterns.
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'src'), ['.astro', '.ts', '.tsx', '.mdx', '.md'])) {
      const src = readFileSync(file, 'utf8');
      if (
        src.includes('href="/ai-department-audit/') ||
        src.includes("href: '/ai-department-audit/") ||
        src.includes('href: "/ai-department-audit/')
      ) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

// ---- GA4 event contract --------------------------------------------------------

describe('GA4 event names: the shared assessment family is preserved', () => {
  test('canonical event names are exactly the existing family', () => {
    assert.equal(ASSESSMENT_EVENTS.start, 'ai_assessment_start');
    assert.equal(ASSESSMENT_EVENTS.complete, 'ai_assessment_complete');
    assert.equal(ASSESSMENT_EVENTS.leadSubmit, 'ai_assessment_lead_submit');
  });

  test('no retired ai_quick_score_* event names remain in app or tracker sources', () => {
    const files = [
      'src/components/assessment/quickAssessmentApp.ts',
      'src/components/assessment/assessmentApp.ts',
      'src/components/AnalyticsEvents.astro',
      'src/lib/assessment/quickLeadSubmission.ts',
    ];
    for (const f of files) {
      assert.equal(read(f).includes('ai_quick_score'), false, `${f} still references a retired event name`);
    }
  });

  test('both apps use the shared event constants', () => {
    assert.ok(read('src/components/assessment/quickAssessmentApp.ts').includes('ASSESSMENT_EVENTS'));
    assert.ok(read('src/components/assessment/assessmentApp.ts').includes('ASSESSMENT_EVENTS'));
    // The delegated start tracker (inline script) receives the event
    // name and params via define:vars from the same shared module.
    assert.ok(read('src/components/AnalyticsEvents.astro').includes('ASSESSMENT_EVENTS.start'));
  });
});

describe('GA4 funnel parameters', () => {
  test('free assessment params: assessment_type=free_opportunity, assessment_version=short_v1', () => {
    const params = buildAssessmentStartParams(ASSESSMENT_TYPE.free);
    assert.equal(params.assessment_type, 'free_opportunity');
    assert.equal(params.assessment_version, 'short_v1');

    const complete = buildAssessmentCompleteParams(ASSESSMENT_TYPE.free);
    assert.equal(complete.assessment_type, 'free_opportunity');
    assert.equal(complete.assessment_version, 'short_v1');
  });

  test('comprehensive engine params: assessment_type=comprehensive_audit', () => {
    const params = buildAssessmentStartParams(ASSESSMENT_TYPE.comprehensive);
    assert.equal(params.assessment_type, 'comprehensive_audit');

    const complete = buildAssessmentCompleteParams(ASSESSMENT_TYPE.comprehensive);
    assert.equal(complete.assessment_type, 'comprehensive_audit');
  });

  test('lead-submit params add only non-PII lead_id and score_band', () => {
    const free = buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.free, 'lead-1', 90);
    assert.equal(free.lead_id, 'lead-1');
    assert.equal(free.score_band, 'high');
    assert.equal(free.assessment_type, 'free_opportunity');

    const comp = buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.comprehensive, 'lead-2', 30);
    assert.equal(comp.lead_id, 'lead-2');
    assert.equal(comp.score_band, 'low');
    assert.equal(comp.assessment_type, 'comprehensive_audit');
  });

  test('no GA4 builder ever emits PII keys', () => {
    const all = [
      buildAssessmentStartParams(ASSESSMENT_TYPE.free),
      buildAssessmentStartParams(ASSESSMENT_TYPE.comprehensive),
      buildAssessmentCompleteParams(ASSESSMENT_TYPE.free),
      buildAssessmentCompleteParams(ASSESSMENT_TYPE.comprehensive),
      buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.free, 'lead-1', 50),
      buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.comprehensive, 'lead-2', 50),
    ];
    const forbidden = ['firstname', 'lastname', 'email', 'phone', 'company', 'website', 'name', 'answer'];
    for (const params of all) {
      for (const key of Object.keys(params)) {
        const lower = key.toLowerCase();
        for (const bad of forbidden) {
          assert.equal(lower.includes(bad), false, `GA4 key "${key}" looks like it could contain PII`);
        }
      }
    }
  });
});

// ---- Delivery + attribution sanity ----------------------------------------------

describe('Web3Forms delivery targets still configured', () => {
  test('both assessment lead submission modules retain the endpoint', () => {
    assert.ok(read('src/lib/assessment/leadSubmission.ts').includes('https://api.web3forms.com/submit'));
    assert.ok(read('src/lib/assessment/quickLeadSubmission.ts').includes('https://api.web3forms.com/submit'));
  });
});

describe('Attribution modules still function', () => {
  test('rep attribution capture + read still works end-to-end', async () => {
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

    const { captureRepAttribution, getRepCode, buildRepLeadFields } = await import('../src/lib/repAttribution.ts');
    captureRepAttribution({ search: '?rep=correction-pass' });
    assert.equal(getRepCode(), 'correction-pass');
    assert.deepEqual(buildRepLeadFields(), { rep_code: 'correction-pass' });
  });

  test('Cal.com forward fields still work (rep + marketing fields merge)', async () => {
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

    const { captureAttribution, buildCalComForwardFields } = await import('../src/lib/attribution.ts');
    const { captureRepAttribution, buildCalComRepField } = await import('../src/lib/repAttribution.ts');

    captureAttribution({ search: '?utm_source=google&utm_medium=cpc&gclid=xyz', landingPage: '/free-ai-assessment/' });
    captureRepAttribution({ search: '?rep=jane' });

    const forward = { ...buildCalComForwardFields(), ...buildCalComRepField() };
    assert.equal(forward.gclid, 'xyz');
    assert.equal(forward.utm_source, 'google');
    assert.equal((forward as Record<string, string>).rep, 'jane');

    // AttributionCapture.astro merges exactly these two builders.
    const component = read('src/components/AttributionCapture.astro');
    assert.ok(component.includes('buildCalComForwardFields'));
    assert.ok(component.includes('buildCalComRepField'));
  });
});

// ---- Internal links ---------------------------------------------------------------

describe('Internal CTA targets', () => {
  test('site-wide primary CTA points to the permanent free route', () => {
    // site.ts uses extensionless imports (Vite-resolved, not
    // Node-resolvable), so verify via source instead of importing.
    const site = read('src/lib/site.ts');
    assert.ok(site.includes("href: '/free-ai-assessment/'"), 'PRIMARY_CTA must target /free-ai-assessment/');
    assert.ok(site.includes("label: 'Get Your AI Department Score'"));
    // The bare legacy route may appear exactly once — as the footer's
    // deliberate "Assessment Options" de-orphan link to the chooser page.
    assert.equal((site.match(/href: '\/ai-assessment\/'/g) || []).length, 1);
  });

  test('cold assessment CTAs do not use the legacy route (footer de-orphan link excluded)', () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'src'), ['.astro', '.ts', '.tsx', '.mdx'])) {
      // site.ts carries the one intentional footer link to the chooser.
      if (file.endsWith('src/lib/site.ts')) continue;
      const src = readFileSync(file, 'utf8');
      // href="/ai-assessment/" or '/ai-assessment/' or "/ai-assessment/" —
      // the bare legacy route used as a link/CTA target. /ai-assessment/full/
      // and /ai-assessment/results/ are legitimate and excluded by the
      // boundary checks.
      if (
        src.includes('href="/ai-assessment/"') ||
        src.includes("href: '/ai-assessment/'") ||
        src.includes('href: "/ai-assessment/"')
      ) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

// ---- Final funnel corrections ------------------------------------------------
//
// The 64-question engine (/ai-assessment/full/) is the UNDERLYING
// comprehensive engine / internal-access implementation. It must not be
// publicly promoted as a free alternative to the $495 audit, and the
// audit copy must not claim human review that no defined fulfillment
// workflow currently provides.

describe('Final funnel corrections', () => {
  const FUNNEL_FILES = [
    'src/pages/ai-assessment/index.astro',
    'src/pages/comprehensive-ai-business-audit/index.astro',
    'src/pages/free-ai-assessment/index.astro',
    'src/pages/ai-assessment/full/index.astro',
    'src/components/assessment/quickAssessmentApp.ts',
  ];

  test('/ai-assessment/ contains no public link to /ai-assessment/full/', () => {
    const page = read('src/pages/ai-assessment/index.astro');
    assert.equal(page.includes('/ai-assessment/full/">'), false, 'choice page must not link to the engine');
  });

  test('no public CTA anywhere in src/ links to /ai-assessment/full/', () => {
    // href patterns only — non-link mentions in comments (e.g. internal
    // documentation of the engine's status) are legitimate.
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'src'), ['.astro', '.ts', '.tsx', '.mdx'])) {
      const src = readFileSync(file, 'utf8');
      if (
        src.includes('href="/ai-assessment/full/') ||
        src.includes("href: '/ai-assessment/full/") ||
        src.includes('href: "/ai-assessment/full/')
      ) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('the quick assessment offers only the paid audit as its upgrade path', () => {
    const app = read('src/components/assessment/quickAssessmentApp.ts');
    // Comments may document where the underlying engine lives; what
    // must not exist is any link/CTA to it.
    assert.equal(app.includes('href="/ai-assessment/full/'), false, 'quick app must not link to the engine route');
    assert.equal(app.includes('href="/free-ai-assessment/'), false, 'quick app must not self-link');
    assert.ok(app.includes('href="/comprehensive-ai-business-audit/"'), 'audit upgrade card must remain');
  });

  test('funnel pages make no unverified human-review claims', () => {
    const forbidden = [
      /senior[- ]reviewed/i,
      /human (analysis|reviewed|authored|written)/i,
      /a senior reviews/i,
    ];
    for (const f of FUNNEL_FILES) {
      const src = read(f);
      for (const pattern of forbidden) {
        assert.equal(pattern.test(src), false, `${f} contains an unsupported human-review claim (${pattern})`);
      }
    }
  });

  test('audit offer describes only supported deliverables (personalized report + strategy review call)', () => {
    const page = read('src/pages/comprehensive-ai-business-audit/index.astro');
    assert.ok(page.includes('45-minute strategy review call'));
    assert.ok(page.includes('Personalized Audit Report'));
    assert.equal(page.includes('Written Audit Report'), false);
  });
});

// ---- Paid Cal.com integration ------------------------------------------------
//
// The live paid booking event must be driven entirely by the existing
// centralized scheduling / attribution / analytics architecture — no
// hardcoded Cal URLs in the page, no manual query-string building, no
// new PII-bearing events.

describe('Paid Cal.com integration', () => {
  test('centralized paid Cal URL is correct', () => {
    assert.equal(SCHEDULING.comprehensiveAudit.url, 'https://cal.com/youraidepartment/comprehensive-ai-business-audit');
    assert.equal(SCHEDULING.comprehensiveAudit.label, 'Comprehensive AI Business Audit');
    assert.equal(SCHEDULING.comprehensiveAudit.durationMinutes, 45);
    assert.equal(SCHEDULING.comprehensiveAudit.price, '$495');
  });

  test('paid audit CTA uses the centralized scheduling configuration — no hardcoded Cal URL in the page', () => {
    const page = read('src/pages/comprehensive-ai-business-audit/index.astro');
    assert.ok(page.includes('SCHEDULING.comprehensiveAudit.url'), 'CTA must reference the centralized config');
    assert.ok(page.includes('Book Your'), 'purchase CTA wording required');
    // The literal Cal URL must not appear in the page source — it can
    // only arrive via the scheduling configuration.
    assert.equal(page.includes('https://cal.com/youraidepartment/comprehensive-ai-business-audit'), false);
  });

  test('AttributionCapture enriches the paid audit booking link with the same architecture', async () => {
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

    // The site-wide capture component must list the paid URL alongside
    // the other scheduling links (existing architecture, not rebuilt).
    const component = read('src/components/AttributionCapture.astro');
    assert.ok(component.includes('SCHEDULING.comprehensiveAudit.url'), 'paid URL must be in the enriched set');

    // End-to-end: the exact merge AttributionCapture performs must
    // carry rep + UTMs + gclid onto the paid booking URL.
    const { captureAttribution, buildCalComForwardFields, appendAttributionToUrl } = await import('../src/lib/attribution.ts');
    const { captureRepAttribution, buildCalComRepField } = await import('../src/lib/repAttribution.ts');

    captureAttribution({
      search: '?utm_source=google&utm_medium=cpc&utm_campaign=audit-launch&gclid=g-123&gbraid=b-1&wbraid=w-1',
      landingPage: '/comprehensive-ai-business-audit/',
    });
    captureRepAttribution({ search: '?rep=michael' });

    const merged = { ...buildCalComForwardFields(), ...buildCalComRepField() };
    const enriched = appendAttributionToUrl(SCHEDULING.comprehensiveAudit.url, merged);

    assert.ok(enriched.includes('gclid=g-123'), 'gclid must travel to the paid booking URL');
    assert.ok(enriched.includes('gbraid=b-1'), 'gbraid must travel to the paid booking URL');
    assert.ok(enriched.includes('wbraid=w-1'), 'wbraid must travel to the paid booking URL');
    assert.ok(enriched.includes('utm_source=google'), 'UTM source must travel');
    assert.ok(enriched.includes('utm_campaign=audit-launch'), 'UTM campaign must travel');
    assert.ok(enriched.includes('utm_medium=cpc'), 'UTM medium must travel');
    assert.ok(enriched.includes('rep=michael'), 'rep code must travel to the paid booking URL');
  });

  test('paid audit page contains no public link to /ai-assessment/full/', () => {
    const page = read('src/pages/comprehensive-ai-business-audit/index.astro');
    assert.equal(page.includes('href="/ai-assessment/full/'), false);
    assert.equal(page.includes("href: '/ai-assessment/full/"), false);
  });

  test('paid audit booking click uses the existing booking_click_* architecture, non-PII only', () => {
    const tracker = read('src/components/AnalyticsEvents.astro');
    assert.ok(tracker.includes('booking_click_comprehensive_audit'), 'named booking-click event required');
    assert.ok(tracker.includes('comprehensiveAuditUrl'), 'match target must come from centralized scheduling');
    // Same non-PII payload shape as the other booking clicks.
    const match = tracker.match(/booking_click_comprehensive_audit', \{ link_url: href \}\)/);
    assert.ok(match, 'event must push only { link_url: href }');
    // The event line must not carry any contact-field parameters.
    const eventLine = tracker.split('\n').find((l) => l.includes('booking_click_comprehensive_audit')) || '';
    assert.equal(eventLine.includes('email'), false);
    assert.equal(eventLine.includes('name'), false);
    assert.equal(eventLine.includes('phone'), false);
  });

  test('existing free strategy-call scheduling remains unchanged', () => {
    assert.equal(SCHEDULING.strategyCall.url, 'https://cal.com/youraidepartment/ai-strategy-call');
    assert.equal(SCHEDULING.strategyCall.durationMinutes, 30);
    assert.equal(SCHEDULING.strategyCall.price, null);
    const tracker = read('src/components/AnalyticsEvents.astro');
    assert.ok(tracker.includes("booking_click_strategy"));
    const component = read('src/components/AttributionCapture.astro');
    assert.ok(component.includes('SCHEDULING.strategyCall.url'), 'strategy call must remain enriched');
  });
});
