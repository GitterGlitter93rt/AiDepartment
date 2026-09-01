// Smartlead legacy-link repair + campaign-attribution test suite.
// Run with: node --experimental-strip-types --test tests/campaignAttribution.test.ts
// (npm test builds first; the built-output sections require dist/.)
//
// Covers the two halves of this work:
//   A. /assessment and /assessment/ reach /free-ai-assessment/ with the
//      query string intact, by a real 301 with a static fallback.
//   B. Campaign parameters are captured, persist across internal
//      navigation, and reach the assessment events and the lead payload
//      — with a hard guarantee that nothing else does.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ASSESSMENT_EVENTS,
  ASSESSMENT_TYPE,
  buildAssessmentStartParams,
  buildAssessmentCompleteParams,
  buildAssessmentLeadSubmitParams,
  withCampaignParams,
} from '../src/lib/assessment/ga4Events.ts';
import { CAMPAIGN_PARAM_KEYS } from '../src/lib/attribution.ts';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const DESTINATION = '/free-ai-assessment/';

// ============================================================
// A. LEGACY URL REPAIR
// ============================================================

describe('Legacy /assessment/ link repair', () => {
  const htaccess = read('public/.htaccess');

  test('a real 301 is configured for both /assessment and /assessment/', () => {
    assert.match(htaccess, /RewriteEngine\s+On/, 'mod_rewrite must be enabled');
    const rule = htaccess.match(/RewriteRule\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]/);
    assert.ok(rule, 'a RewriteRule must exist');
    const [, pattern, target, flags] = rule!;
    // ^assessment/?$ matches the path both with and without the
    // trailing slash (Apache strips the leading slash in .htaccess).
    assert.equal(pattern, '^assessment/?$');
    assert.ok(new RegExp(pattern).test('assessment'), 'must match /assessment');
    assert.ok(new RegExp(pattern).test('assessment/'), 'must match /assessment/');
    assert.equal(target, DESTINATION);
    assert.match(flags, /R=301|R=308/, 'must be a permanent redirect');
    assert.match(flags, /QSA/, 'QSA is what preserves the UTM query string');
    assert.match(flags, /\bL\b/, 'must stop rule processing');
  });

  test('the redirect cannot loop', () => {
    const pattern = new RegExp(htaccess.match(/RewriteRule\s+(\S+)/)![1]);
    // Apache matches the path with the leading slash removed.
    assert.equal(pattern.test('free-ai-assessment/'), false, 'destination must not re-match the rule');
    assert.equal(pattern.test('ai-assessment/'), false, 'the chooser must not be caught by the rule');
  });

  test('the rewrite is guarded so a host without mod_rewrite degrades instead of 500-ing', () => {
    assert.match(htaccess, /<IfModule mod_rewrite\.c>[\s\S]*RewriteRule[\s\S]*<\/IfModule>/);
  });

  test('the existing branded 404 handler is preserved', () => {
    assert.match(htaccess, /ErrorDocument 404 \/404\.html/);
    assert.ok(existsSync(join(DIST, '404.html')));
  });

  test('.htaccess ships in the deployable build output', () => {
    assert.ok(existsSync(join(DIST, '.htaccess')), '.htaccess must be in dist/ or the redirect never deploys');
    assert.equal(readFileSync(join(DIST, '.htaccess'), 'utf8'), htaccess);
  });
});

describe('Static fallback route at /assessment/', () => {
  const built = readFileSync(join(DIST, 'assessment', 'index.html'), 'utf8');

  test('the fallback page exists and is built', () => {
    assert.ok(existsSync('src/pages/assessment/index.astro'));
    assert.ok(existsSync(join(DIST, 'assessment', 'index.html')));
  });

  test('it redirects with location.replace, preserving the query string', () => {
    assert.match(built, /location\.replace\(/, 'must use replace, not assignment');
    assert.match(
      built,
      /location\.replace\(\s*DESTINATION\s*\+\s*window\.location\.search\s*\+\s*window\.location\.hash\s*\)/,
      'search and hash must both be carried across'
    );
    assert.match(built, /const DESTINATION\s*=\s*"\/free-ai-assessment\/"/);
    // Never location.href — that would leave the stub in the back stack.
    assert.equal(/location\.href\s*=/.test(built), false);
  });

  test('it cannot loop', () => {
    assert.match(built, /window\.location\.pathname\s*!==\s*DESTINATION/, 'guarded against self-redirect');
  });

  test('it is noindex with a canonical pointing at the real destination', () => {
    assert.match(built, /<meta name="robots" content="noindex, follow">/);
    assert.match(built, /<link rel="canonical" href="https:\/\/youraidepartment\.ai\/free-ai-assessment\/">/);
  });

  test('the redirect runs before any analytics tag loads — no stray page_view', () => {
    const headEnd = built.indexOf('</head>');
    const replaceAt = built.indexOf('location.replace');
    assert.ok(replaceAt > -1 && replaceAt < headEnd, 'the redirect must execute inside <head>');
    // The stub deliberately does not load the GTM container at all.
    assert.equal(built.includes('googletagmanager.com'), false, 'the stub must not load GTM');
    assert.equal(built.includes('GTM-5G8Q7KKZ'), false);
  });

  test('no-JS visitors still get a working link', () => {
    assert.match(built, /<a[^>]+href="\/free-ai-assessment\/"/);
  });

  test('the stub is excluded from the sitemap', () => {
    const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
    assert.equal(sitemap.includes('/assessment/'), false, '/assessment/ must not be in the sitemap');
  });
});

describe('The live assessment routes are untouched', () => {
  test('/ai-assessment/ chooser still exists and is not redirected', () => {
    assert.ok(existsSync(join(DIST, 'ai-assessment', 'index.html')));
    const page = read('src/pages/ai-assessment/index.astro');
    assert.equal(page.includes('http-equiv="refresh"'), false, 'the chooser must not redirect');
    assert.equal(page.includes('location.replace'), false);
    // Still the chooser: links to both funnels.
    assert.ok(page.includes('href="/free-ai-assessment/"'));
    assert.ok(page.includes('href="/comprehensive-ai-business-audit/"'));
    // And the .htaccess rule must not touch it.
    assert.equal(new RegExp(read('public/.htaccess').match(/RewriteRule\s+(\S+)/)![1]).test('ai-assessment/'), false);
  });

  test('both real assessment funnels still build', () => {
    assert.ok(existsSync(join(DIST, 'free-ai-assessment', 'index.html')));
    assert.ok(existsSync(join(DIST, 'comprehensive-ai-business-audit', 'index.html')));
  });

  test('the newer production assessment architecture is intact (not reverted to the older one)', () => {
    // The free funnel mounts the 15-question quick engine; the
    // comprehensive engine remains the separate 64-question app.
    const free = read('src/pages/free-ai-assessment/index.astro');
    assert.ok(free.includes('mountQuickAssessmentApp'));
    assert.ok(read('src/pages/ai-assessment/full/index.astro').includes('mountAssessmentApp'));
  });
});

// ============================================================
// B. CAMPAIGN ATTRIBUTION
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
  getCampaignAttribution,
  getFirstTouch,
  getLatestTouch,
  buildLeadAttributionFields,
} = await import('../src/lib/attribution.ts');

function freshStorage() {
  (globalThis as any).window.localStorage = new MemoryStorage();
}

const ROOFING_QS =
  '?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_ai_assessment_cold_outreach_202608&utm_id=sl_roofing_20260820&utm_content=step_1';

describe('Campaign parameter capture', () => {
  test('all six UTM fields are captured from a Smartlead link', () => {
    freshStorage();
    captureAttribution({ search: ROOFING_QS + '&utm_term=roofing+ai', landingPage: DESTINATION });
    const campaign = getCampaignAttribution();
    assert.deepEqual(campaign, {
      utm_id: 'sl_roofing_20260820',
      utm_source: 'smartlead',
      utm_medium: 'email',
      utm_campaign: 'roofing_ai_assessment_cold_outreach_202608',
      utm_content: 'step_1',
      utm_term: 'roofing ai',
    });
  });

  test('utm_id is captured, persisted and reaches the lead payload', () => {
    freshStorage();
    captureAttribution({ search: ROOFING_QS, landingPage: DESTINATION });
    assert.equal(getLatestTouch()?.utm_id, 'sl_roofing_20260820');
    assert.equal(buildLeadAttributionFields().attribution_utm_id, 'sl_roofing_20260820');
  });

  test('values are preserved verbatim — never mutated or lower-cased at runtime', () => {
    // Lowercase is an authoring convention. Rewriting values here would
    // corrupt utm_content, which doubles as an ad-creative identifier.
    freshStorage();
    captureAttribution({ search: '?utm_campaign=Roofing_MixedCase&utm_content=Step_1_A', landingPage: DESTINATION });
    const campaign = getCampaignAttribution();
    assert.equal(campaign.utm_campaign, 'Roofing_MixedCase');
    assert.equal(campaign.utm_content, 'Step_1_A');
  });

  test('A/B variant values survive intact', () => {
    for (const variant of ['step_1_a', 'step_1_b', 'step_3_b']) {
      freshStorage();
      captureAttribution({ search: `?utm_source=smartlead&utm_content=${variant}`, landingPage: DESTINATION });
      assert.equal(getCampaignAttribution().utm_content, variant);
    }
  });

  test('an organic visitor produces no campaign fields at all', () => {
    freshStorage();
    captureAttribution({ search: '', landingPage: '/' });
    assert.deepEqual(getCampaignAttribution(), {}, 'no blank parameters may reach GA4');
  });
});

describe('Attribution survives the journey into the assessment', () => {
  test('landing page -> industry page -> /free-ai-assessment/ keeps the campaign', () => {
    freshStorage();
    captureAttribution({ search: ROOFING_QS, landingPage: '/industries/roofing/' });
    captureAttribution({ search: '', landingPage: '/ai-assessment/' });
    captureAttribution({ search: '', landingPage: DESTINATION });

    const campaign = getCampaignAttribution();
    assert.equal(campaign.utm_campaign, 'roofing_ai_assessment_cold_outreach_202608');
    assert.equal(campaign.utm_id, 'sl_roofing_20260820');
    assert.equal(campaign.utm_content, 'step_1');
    assert.equal(getFirstTouch()?.landing_page, '/industries/roofing/');
  });

  test('the legacy /assessment/ hop does not lose attribution', () => {
    // The 301 carries the query string, so capture happens once — on the
    // destination — with everything intact.
    freshStorage();
    captureAttribution({ search: ROOFING_QS, landingPage: DESTINATION });
    assert.equal(getCampaignAttribution().utm_id, 'sl_roofing_20260820');
  });

  test('first touch and latest touch remain separate', () => {
    freshStorage();
    captureAttribution({ search: '?utm_campaign=roofing_ai_assessment_cold_outreach_202608&utm_content=step_1', landingPage: DESTINATION });
    captureAttribution({ search: '?utm_campaign=roofing_ai_assessment_cold_outreach_202608&utm_content=step_3', landingPage: DESTINATION });
    assert.equal(getFirstTouch()?.utm_content, 'step_1', 'first touch is immutable');
    assert.equal(getLatestTouch()?.utm_content, 'step_3', 'latest touch advances');
    // A later untagged pageview erases neither.
    captureAttribution({ search: '', landingPage: '/contact/' });
    assert.equal(getFirstTouch()?.utm_content, 'step_1');
    assert.equal(getLatestTouch()?.utm_content, 'step_3');
  });

  test('the existing paid-click architecture is unaffected by the new field', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=g-1&gbraid=b-1&wbraid=w-1&fbclid=fb-1&utm_id=sl_x', landingPage: '/' });
    const latest = getLatestTouch();
    assert.equal(latest?.gclid, 'g-1');
    assert.equal(latest?.gbraid, 'b-1');
    assert.equal(latest?.wbraid, 'w-1');
    assert.equal(latest?.fbclid, 'fb-1');
    assert.equal(latest?.utm_id, 'sl_x');
  });
});

describe('Campaign fields on the assessment events', () => {
  const campaign = {
    utm_id: 'sl_roofing_20260820',
    utm_source: 'smartlead',
    utm_medium: 'email',
    utm_campaign: 'roofing_ai_assessment_cold_outreach_202608',
    utm_content: 'step_1',
  };

  test('all three assessment events accept campaign fields', () => {
    const start = withCampaignParams(buildAssessmentStartParams(ASSESSMENT_TYPE.free), campaign);
    const complete = withCampaignParams(buildAssessmentCompleteParams(ASSESSMENT_TYPE.free), campaign);
    const lead = withCampaignParams(buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.free, 'lead-1', 70), campaign);

    for (const payload of [start, complete, lead]) {
      assert.equal(payload.utm_id, 'sl_roofing_20260820');
      assert.equal(payload.utm_campaign, 'roofing_ai_assessment_cold_outreach_202608');
      assert.equal(payload.utm_content, 'step_1');
      // The existing funnel identifiers are preserved, not replaced.
      assert.equal(payload.assessment_type, 'free_opportunity');
    }
    assert.equal(start.assessment_version, 'short_v1');
    assert.equal(lead.lead_id, 'lead-1');
    assert.equal(lead.score_band, 'medium');
  });

  test('the comprehensive funnel keeps its own identifiers alongside campaign fields', () => {
    const p = withCampaignParams(buildAssessmentCompleteParams(ASSESSMENT_TYPE.comprehensive), campaign);
    assert.equal(p.assessment_type, 'comprehensive_audit');
    assert.equal(p.utm_source, 'smartlead');
  });

  test('NO PII: only the six allowlisted UTM keys are ever merged', () => {
    const contaminated = {
      ...campaign,
      email: 'someone@example.com',
      phone: '5551234567',
      first_name: 'Someone',
      last_name: 'Else',
      company: 'Acme Roofing',
      website: 'acme.example',
      answers: 'Q1:yes',
      message: 'free text',
      // Real attribution-record fields that must NOT reach GA4 this way.
      landing_page: '/free-ai-assessment/',
      referrer: 'https://mail.example.com/',
      gclid: 'g-1',
      rep_code: 'jane',
    } as any;

    const payload = withCampaignParams(buildAssessmentStartParams(ASSESSMENT_TYPE.free), contaminated);
    assert.deepEqual(Object.keys(payload).sort(), [
      'assessment_type', 'assessment_version',
      'utm_campaign', 'utm_content', 'utm_id', 'utm_medium', 'utm_source',
    ].sort());
    for (const forbidden of ['email', 'phone', 'first_name', 'last_name', 'company', 'website', 'answers', 'message', 'landing_page', 'referrer', 'gclid', 'rep_code']) {
      assert.equal(forbidden in payload, false, `"${forbidden}" must never reach the dataLayer`);
    }
  });

  test('empty and missing campaign values are dropped, never sent blank', () => {
    const base = buildAssessmentStartParams(ASSESSMENT_TYPE.free);
    assert.deepEqual(withCampaignParams(base, {}), base);
    assert.deepEqual(withCampaignParams(base, undefined), base);
    assert.deepEqual(withCampaignParams(base, null), base);
    assert.deepEqual(withCampaignParams(base, { utm_id: '', utm_source: undefined } as any), base);
  });

  test('the allowlist is exactly the six standard UTM fields', () => {
    assert.deepEqual([...CAMPAIGN_PARAM_KEYS].sort(), [
      'utm_campaign', 'utm_content', 'utm_id', 'utm_medium', 'utm_source', 'utm_term',
    ]);
  });
});

describe('Event wiring: exactly once, no duplicates, no second GA4', () => {
  const tracker = read('src/components/AnalyticsEvents.astro');
  const quickApp = read('src/components/assessment/quickAssessmentApp.ts');
  const fullApp = read('src/components/assessment/assessmentApp.ts');
  const capture = read('src/components/AttributionCapture.astro');

  test('ai_assessment_start still fires exactly once, now campaign-enriched', () => {
    assert.equal((tracker.match(/pushEvent\(assessmentStartEventName/g) || []).length, 1, 'single start push');
    assert.ok(tracker.includes('!assessmentStartFired'), 'once-per-page guard must remain');
    assert.match(tracker, /pushEvent\(assessmentStartEventName, withCampaign\(params\)\)/);
    // The apps must still not push start themselves.
    assert.equal(quickApp.includes('event: ASSESSMENT_EVENTS.start'), false);
    assert.equal(quickApp.includes("event: 'ai_assessment_start'"), false);
  });

  test('complete and lead_submit each push exactly once per app', () => {
    for (const [name, src] of [['quick', quickApp], ['comprehensive', fullApp]] as const) {
      assert.equal((src.match(/event: ASSESSMENT_EVENTS\.complete/g) || []).length, 1, `${name}: one complete push`);
      const leadPushes =
        (src.match(/event: ASSESSMENT_EVENTS\.leadSubmit/g) || []).length +
        (src.match(/event: 'ai_assessment_lead_submit'/g) || []).length;
      assert.equal(leadPushes, 1, `${name}: one lead_submit push`);
      assert.ok(src.includes('withCampaignParams('), `${name}: events must be campaign-enriched`);
    }
  });

  test('the campaign snapshot is published once and read lazily', () => {
    assert.ok(capture.includes('getCampaignAttribution()'), 'AttributionCapture must publish the snapshot');
    assert.match(capture, /yaiCampaign/);
    // The inline tracker reads it at click time rather than capturing it
    // at parse time, because module scripts run after inline ones.
    assert.match(tracker, /window\.yaiCampaign \|\| \{\}/);
    assert.ok(tracker.includes('CAMPAIGN_KEYS'), 'the inline tracker must use its own hard-coded allowlist');
  });

  test('no second GA4 installation and no manual page_view anywhere', () => {
    const layout = read('src/layouts/BaseLayout.astro');
    // Counted in the BUILT page, which is what actually ships, and by
    // the two things that genuinely load a tag — not by mentions of the
    // container ID, which also appears in an explanatory comment.
    const builtAssessment = readFileSync(join(DIST, 'free-ai-assessment', 'index.html'), 'utf8');
    assert.equal(
      (builtAssessment.match(/googletagmanager\.com\/gtm\.js/g) || []).length, 1,
      'exactly one GTM container loader'
    );
    assert.equal(
      (builtAssessment.match(/googletagmanager\.com\/ns\.html/g) || []).length, 1,
      'exactly one GTM noscript iframe'
    );
    assert.equal(/googletagmanager\.com\/gtag\/js/.test(builtAssessment), false, 'no second, direct GA4 install');
    assert.equal(/\bgtag\(/.test(builtAssessment), false, 'no direct gtag() calls');
    assert.equal(/gtag\(/.test(layout), false, 'no direct gtag.js install in the layout');
    for (const src of [tracker, quickApp, fullApp, capture, layout]) {
      assert.equal(/event:\s*['"]page_view['"]/.test(src), false, 'page_view must stay owned by the GA4 tag in GTM');
    }
  });

  test('event names are unchanged', () => {
    assert.equal(ASSESSMENT_EVENTS.start, 'ai_assessment_start');
    assert.equal(ASSESSMENT_EVENTS.complete, 'ai_assessment_complete');
    assert.equal(ASSESSMENT_EVENTS.leadSubmit, 'ai_assessment_lead_submit');
    for (const src of [tracker, quickApp, fullApp]) {
      assert.equal(src.includes('ai_quick_score'), false, 'no retired event name may return');
    }
  });

  test('the lead email carries campaign attribution for later CRM matching', () => {
    const submission = read('src/lib/assessment/quickLeadSubmission.ts');
    assert.ok(submission.includes('buildLeadAttributionFields'));
    assert.ok(submission.includes('Object.assign(payload, attributionFields'), 'attribution must be merged into the payload');
  });
});
