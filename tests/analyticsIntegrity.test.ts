// Sprint 15 — analytics conversion integrity.
// Run with: node --experimental-strip-types --test tests/analyticsIntegrity.test.ts
// (requires dist/ — `npm test` builds first.)
//
// One job: make it mechanically impossible for a future change to let an
// event mean more than its name claims.
//
// The measurement ladder this suite defends:
//
//   L0 traffic      page_view, session_start, cold_lp_view
//   L1 engagement   user_engagement, scroll, cold_lp_engaged, resource_cta_click
//   L2 intent       booking_click_*, outbound_cta_click, ai_assessment_start
//   L3 lead         contact_form_submit, ai_assessment_lead_submit
//   L4 booked call  booking_confirmed          <- the only booked-call fact
//   L5 qualified    qualified_lead             <- CRM/server-side only, never here
//   L6 revenue      offline import             <- never fabricated in a browser
//
// The failure this prevents is someone reading 44 booking_click_strategy
// events as 44 bookings.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  getBookingUid, getBookingType, evaluateBookingConfirmedFiring,
  buildBookingConfirmedEvent, ALLOWED_BOOKING_TYPES,
} from '../src/lib/bookingConfirmation.ts';
import {
  OUTBOUND_EVENTS, ENGAGEMENT_SIGNALS, DWELL_THRESHOLD_MS,
  buildOutboundViewParams, buildOutboundEngagedParams, buildOutboundCtaClickParams,
  isPiiFreeOutboundPayload,
} from '../src/lib/outbound/analytics.ts';
import { CAMPAIGN_PARAM_KEYS } from '../src/lib/attribution.ts';
import { sanitizeRepCode } from '../src/lib/repAttribution.ts';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function walk(dir: string, pred: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e === 'node_modules') continue;
      out.push(...walk(full, pred));
    } else if (pred(full)) out.push(full);
  }
  return out;
}

const SRC = () => walk(join(ROOT, 'src'), (f) => f.endsWith('.astro') || f.endsWith('.ts'));

/** Source with // and /* *​/ comments removed. A comment explaining that
 * an event is NOT emitted must never read as emitting it — that false
 * positive has already cost two debugging passes in this repo. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

const PII_FRAGMENTS = [
  'email', 'phone', 'first_name', 'last_name', 'firstname', 'lastname',
  'name', 'company', 'message', 'notes', 'attendee', 'booking_title', 'address',
];

// ============================================================
// L4 — the booked call. The one number that may be called a sale.
// ============================================================

describe('booking_confirmed is the only booked-call fact, and it is honest', () => {
  test('the event name is exactly booking_confirmed', () => {
    assert.equal(buildBookingConfirmedEvent(null).event, 'booking_confirmed');
  });

  test('exactly one module emits it, and it is not a click handler', () => {
    const emitters = SRC().filter((f) => codeOnly(readFileSync(f, 'utf8')).includes("event: 'booking_confirmed'"));
    assert.deepEqual(
      emitters.map((f) => f.slice(ROOT.length + 1)),
      ['src/lib/bookingConfirmation.ts'],
    );
  });

  test('no click tracker can reach it — proven against the built bundles', () => {
    // Source comments in the funnel/outbound trackers explain that they
    // do NOT emit it. This checks the shipped JavaScript instead, which
    // is the only thing a browser runs.
    const bundleFor = (route: string) => {
      const html = readFileSync(join(DIST, route, 'index.html'), 'utf8');
      return [...html.matchAll(/\/_astro\/([A-Za-z0-9._-]+\.js)/g)]
        .map((m) => join(DIST, '_astro', m[1]))
        .filter(existsSync)
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');
    };
    for (const route of ['.', 'contact', 'go/roofing', 'go/law-firms', 'plumbing-ai', 'free-ai-assessment']) {
      assert.equal(
        bundleFor(route).includes('booking_confirmed'),
        false,
        `${route}: a non-confirmation page ships the booked-call emitter`,
      );
    }
    assert.ok(bundleFor('booking-confirmed').includes('booking_confirmed'), 'the confirmation page must carry it');
  });

  test('no call_booked event exists anywhere in shipped code', () => {
    for (const f of SRC()) {
      const code = codeOnly(readFileSync(f, 'utf8'));
      assert.equal(/['"`]call_booked['"`]/.test(code), false, `${f.slice(ROOT.length + 1)} emits call_booked`);
    }
    for (const f of walk(DIST, (x) => x.endsWith('.js'))) {
      assert.equal(readFileSync(f, 'utf8').includes('call_booked'), false, `${f.slice(DIST.length)} ships call_booked`);
    }
  });

  test('a missing, empty or whitespace UID does not fire', () => {
    assert.equal(evaluateBookingConfirmedFiring(null, []).shouldFire, false);
    assert.equal(getBookingUid(new URLSearchParams('?booking_type=strategy')), null);
    assert.equal(getBookingUid(new URLSearchParams('?uid=%20%20%20')), null);
    assert.equal(getBookingUid(new URLSearchParams('?uid=')), null);
  });

  test('the same UID cannot count twice; a different one can', () => {
    const first = evaluateBookingConfirmedFiring('cal-abc', []);
    assert.equal(first.shouldFire, true);
    assert.equal(evaluateBookingConfirmedFiring('cal-abc', first.updatedSeen).shouldFire, false);
    assert.equal(evaluateBookingConfirmedFiring('cal-xyz', first.updatedSeen).shouldFire, true);
  });

  test('the dedupe list is bounded and persists across sessions', () => {
    let seen: string[] = [];
    for (let i = 0; i < 40; i++) seen = evaluateBookingConfirmedFiring(`b-${i}`, seen).updatedSeen;
    assert.equal(seen.length, 20);
    assert.equal(evaluateBookingConfirmedFiring('b-39', seen).shouldFire, false);
    const page = read('src/pages/booking-confirmed/index.astro');
    assert.match(page, /window\.localStorage\.getItem\(dedupeKey\)/);
    assert.equal(/window\.sessionStorage/.test(page), false, 'session storage forgets a UID that outlives the tab');
  });

  test('booking_type accepts only the five known values', () => {
    for (const t of ALLOWED_BOOKING_TYPES) {
      assert.equal(getBookingType(new URLSearchParams(`booking_type=${t}`)), t);
    }
    for (const bad of ['evil', 'strategy2', '', 'STRATEGY', '../admin']) {
      assert.equal(getBookingType(new URLSearchParams(`booking_type=${bad}`)), null, `accepted ${bad}`);
    }
    assert.equal(ALLOWED_BOOKING_TYPES.length, 5);
  });

  test('campaign attribution is a six-field allowlist, and nothing else survives', () => {
    const contaminated = {
      utm_id: 'a', utm_source: 'b', utm_medium: 'c', utm_campaign: 'd', utm_content: 'e', utm_term: 'f',
      gclid: 'g', gbraid: 'gb', wbraid: 'wb', keyword: 'buy ai now',
      landing_page: '/x', referrer: 'https://y', email: 'a@b.c', first_name: 'Bob',
    } as any;
    const ev = buildBookingConfirmedEvent('strategy', 'rep.1', contaminated);
    for (const k of CAMPAIGN_PARAM_KEYS) assert.ok(k in ev, `${k} should survive`);
    for (const k of ['gclid', 'gbraid', 'wbraid', 'keyword', 'landing_page', 'referrer', 'email', 'first_name']) {
      assert.equal(k in ev, false, `${k} leaked into the booked-call event`);
    }
  });

  test('rep_code is sanitized, and omitted rather than blank', () => {
    assert.equal(buildBookingConfirmedEvent('strategy', 'tony').rep_code, 'tony');
    assert.equal('rep_code' in buildBookingConfirmedEvent('strategy', null), false);
    assert.equal('rep_code' in buildBookingConfirmedEvent('strategy', ''), false);
    // The value can only originate from a URL we publish, and is stripped at capture.
    assert.equal(sanitizeRepCode('bob@example.com'), 'bobexample.com');
    assert.equal(sanitizeRepCode('<script>'), 'script');
    assert.equal(sanitizeRepCode('   '), null);
  });

  test('no PII-shaped key can appear in the payload', () => {
    const ev = buildBookingConfirmedEvent('comprehensive_audit', 'rep', { utm_source: 's' });
    for (const key of Object.keys(ev)) {
      for (const bad of PII_FRAGMENTS) {
        if (bad === 'name') continue; // legalName-style keys are not emitted here; checked exactly below
        assert.equal(key.toLowerCase().includes(bad), false, `payload key "${key}" looks like PII`);
      }
    }
    assert.deepEqual(Object.keys(ev).sort(), ['booking_source', 'booking_type', 'event', 'rep_code', 'utm_source']);
  });

  test('the confirmation page stays out of the index and the sitemap', () => {
    assert.match(readFileSync(join(DIST, 'booking-confirmed/index.html'), 'utf8'), /<meta name="robots" content="noindex/);
    assert.equal(read('public/sitemap.xml').includes('booking-confirmed'), false);
  });
});

// ============================================================
// L5/L6 — qualification and revenue are never fabricated here
// ============================================================

describe('Qualification and revenue never originate in the browser', () => {
  test('no client code emits qualified_lead or any CRM-state event', () => {
    const forbidden = ['qualified_lead', 'qualify_lead', 'close_convert_lead', 'purchase', 'appointment_booked'];
    for (const f of SRC()) {
      const code = codeOnly(readFileSync(f, 'utf8'));
      for (const name of forbidden) {
        assert.equal(
          new RegExp(`event:\\s*['"\`]${name}['"\`]`).test(code),
          false,
          `${f.slice(ROOT.length + 1)} emits ${name}`,
        );
      }
    }
  });

  test('nothing in the shipped bundles emits them either', () => {
    for (const f of walk(DIST, (x) => x.endsWith('.js'))) {
      const js = readFileSync(f, 'utf8');
      for (const name of ['qualified_lead', 'qualify_lead', 'close_convert_lead', 'appointment_booked']) {
        assert.equal(js.includes(name), false, `${f.slice(DIST.length)} ships ${name}`);
      }
    }
  });

  test('the lead join key exists and carries no personal data', () => {
    // qualified_lead will one day be sent server-side from the CRM. It
    // can only be joined back to a session if the website emitted a
    // non-PII correlation id, which it does.
    const ga4 = read('src/lib/assessment/ga4Events.ts');
    assert.match(ga4, /lead_id: leadId/);
    assert.match(read('src/pages/contact/index.astro'), /event: 'contact_form_submit', lead_id: leadId/);
    // And the click ids needed for an offline import are persisted.
    const attr = read('src/lib/attribution.ts');
    for (const id of ['gclid', 'gbraid', 'wbraid']) {
      assert.ok(attr.includes(`'${id}'`), `${id} must be captured for a future offline conversion import`);
    }
    assert.match(attr, /attribution_/, 'lead payload fields must be prefixed for CRM storage');
  });
});

// ============================================================
// L2 — intent must never dress as conversion
// ============================================================

describe('Booking clicks stay intent, not bookings', () => {
  const tracker = read('src/components/AnalyticsEvents.astro');

  test('every booking_click_* is emitted through the one choke point', () => {
    for (const e of [
      'booking_click_strategy', 'booking_click_enterprise', 'booking_click_training',
      'booking_click_executive_advisory', 'booking_click_comprehensive_audit',
    ]) {
      assert.ok(tracker.includes(`pushEvent('${e}'`), `${e} must go through pushEvent`);
    }
  });

  test('the choke point cannot emit a booked-call or lead-level name', () => {
    const emitted = [...codeOnly(tracker).matchAll(/pushEvent\('([a-z_]+)'/g)].map((m) => m[1]);
    for (const e of emitted) {
      assert.equal(e, e.replace('booking_confirmed', 'X'), 'the click tracker emits a booking');
      assert.equal(/^(qualified_lead|call_booked|purchase)$/.test(e), false, `click tracker emits ${e}`);
    }
    assert.ok(emitted.every((e) => /^(booking_click_|resource_cta_click)/.test(e)), `unexpected event: ${emitted}`);
  });

  test('an assessment start is not a lead, and completion is not a lead', () => {
    const ga4 = read('src/lib/assessment/ga4Events.ts');
    // Only lead_submit carries the lead id and score band.
    assert.match(ga4, /buildAssessmentLeadSubmitParams[\s\S]{0,300}lead_id/);
    const startFn = ga4.match(/export function buildAssessmentStartParams[\s\S]*?\n}/)?.[0] ?? '';
    assert.equal(/lead_id|score_band/.test(startFn), false, 'the start event carries lead-level fields');
  });

  test('both assessment flows emit the lead event only after confirmed delivery', () => {
    for (const app of ['src/components/assessment/quickAssessmentApp.ts', 'src/components/assessment/assessmentApp.ts']) {
      const src = read(app);
      // Both use the shared constant. A string literal in one of them is
      // how the two names drift apart on the next rename.
      assert.match(src, /event: ASSESSMENT_EVENTS\.leadSubmit/, `${app}: not using the shared constant`);
      // And the push sits AFTER the delivery guard, not before it.
      const guard = src.indexOf('if (!outcome.delivered)');
      const push = src.indexOf('event: ASSESSMENT_EVENTS.leadSubmit');
      assert.ok(guard > 0, `${app}: no delivery guard`);
      assert.ok(guard < push, `${app}: the lead event can fire before delivery is confirmed`);
    }
  });
});

// ============================================================
// L0/L1 — outbound diagnostics stay diagnostics
// ============================================================

describe('Cold-outbound diagnostics claim only what they can prove', () => {
  const id = { audience: 'roofing', campaign_id: 'roofing_outbound' } as const;

  test('the three names are diagnostic and none resembles a conversion', () => {
    assert.deepEqual(Object.values(OUTBOUND_EVENTS), ['cold_lp_view', 'cold_lp_engaged', 'outbound_cta_click']);
    for (const e of Object.values(OUTBOUND_EVENTS)) {
      assert.equal(/booking_confirmed|qualified_lead|call_booked|purchase/.test(e), false);
    }
  });

  test('engagement needs interaction OR visible dwell, and fires at most once', () => {
    const c = read('src/components/outbound/OutboundAnalytics.astro');
    assert.ok(DWELL_THRESHOLD_MS >= 10_000 && DWELL_THRESHOLD_MS <= 30_000);
    assert.match(c, /let engagedFired = false/);
    assert.match(c, /if \(engagedFired\) return/);
    // Hidden time must not accrue, or a background tab would "engage".
    assert.match(c, /visibilitychange/);
    assert.match(c, /document\.visibilityState === 'visible'/);
    assert.deepEqual([...ENGAGEMENT_SIGNALS], ['interaction', 'dwell']);
  });

  test('the outbound tracker adds no storage key and emits no booking', () => {
    const c = read('src/components/outbound/OutboundAnalytics.astro');
    assert.equal(/yai_|localStorage|sessionStorage/.test(c), false, 'per-pageview facts belong in memory');
    const literals = [...codeOnly(c).matchAll(/['"`]([a-z_]+)['"`]/g)].map((m) => m[1]);
    for (const l of literals) assert.equal(/^booking_click_|^booking_confirmed$/.test(l), false, `emits ${l}`);
  });

  test('an assessment CTA is never converted into booking intent', () => {
    const a = buildOutboundCtaClickParams(id, 'hero', 'assessment');
    assert.equal(a.cta_type, 'assessment');
    assert.equal(JSON.stringify(a).includes('booking'), false);
  });

  test('every outbound payload is PII-free and campaign-allowlisted', () => {
    const contaminated = { utm_source: 's', gclid: 'g', keyword: 'k', email: 'a@b.c', phone: '555' } as any;
    for (const p of [
      buildOutboundViewParams(id, contaminated),
      buildOutboundEngagedParams(id, 'dwell', contaminated),
      buildOutboundCtaClickParams(id, 'final', 'strategy_call', contaminated),
    ]) {
      assert.ok(isPiiFreeOutboundPayload(p));
      for (const k of ['gclid', 'keyword', 'email', 'phone']) assert.equal(k in p, false, `${k} leaked`);
      assert.equal(p.utm_source, 's');
    }
  });
});

// ============================================================
// No PII anywhere in analytics; no secrets anywhere at all
// ============================================================

describe('Analytics carries no personal data, and the bundle carries no secrets', () => {
  test('no dataLayer.push in src has a PII-shaped key', () => {
    const offenders: string[] = [];
    for (const f of SRC()) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/dataLayer\.push\(\s*(\{[\s\S]{0,700}?\})\s*\)/g)) {
        for (const km of m[1].matchAll(/(?:^|[{,\s])([A-Za-z_][A-Za-z_0-9]*)\s*:/g)) {
          const key = km[1].toLowerCase();
          if (PII_FRAGMENTS.some((p) => key.includes(p))) offenders.push(`${f.slice(ROOT.length + 1)}: ${km[1]}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('the site-wide tracker forwards only an allowlist, never an arbitrary object', () => {
    const t = read('src/components/AnalyticsEvents.astro');
    assert.match(t, /var CAMPAIGN_KEYS = \['utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'\]/);
    assert.match(t, /function withCampaign\(/);
    assert.match(t, /function repParams\(/);
  });

  test('no analytics or messaging secret ships to the browser', () => {
    const patterns = [
      /webhook_secret\s*[:=]\s*['"][^'"]{8,}/i,
      /measurement[_-]?api[_-]?secret\s*[:=]\s*['"][^'"]{8,}/i,
      /refresh_token\s*[:=]\s*['"][^'"]{8,}/i,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /"type"\s*:\s*"service_account"/,
      /\bAW-\d{9,}/,
    ];
    for (const f of [...SRC(), ...walk(DIST, (x) => /\.(js|html|css|json|txt)$/.test(x))]) {
      const s = readFileSync(f, 'utf8');
      for (const p of patterns) {
        assert.equal(p.test(s), false, `${f.replace(ROOT + '/', '')} matches ${p}`);
      }
    }
  });
});

// ============================================================
// Site search: the site has none, so it must never look like it does
// ============================================================

describe('The site has no internal search, and never produces search URLs', () => {
  test('there is no search input, route, or library', () => {
    for (const f of SRC()) {
      const s = readFileSync(f, 'utf8');
      assert.equal(/type="search"|role="search"/.test(s), false, `${f.slice(ROOT.length + 1)} has a search control`);
    }
    assert.equal(existsSync(join(ROOT, 'src/pages/search')), false);
    const pkg = JSON.parse(read('package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const d of ['pagefind', 'algoliasearch', 'fuse.js', 'lunr']) {
      assert.equal(d in deps, false, `${d} would introduce a real site search`);
    }
  });

  test('no built page links to a ?q= / ?s= / ?search= URL', () => {
    for (const f of walk(DIST, (x) => x.endsWith('.html'))) {
      const html = readFileSync(f, 'utf8');
      assert.equal(/href="[^"]*[?&](q|s|search|query)=/.test(html), false, `${f.slice(DIST.length)} emits a search URL`);
    }
  });

  test('keyword is captured for attribution but never reaches a GA4 event', () => {
    // `keyword` is a Google Ads ValueTrack field. It is genuinely useful
    // on a lead record and on a Cal.com handoff, and it is deliberately
    // NOT in the GA4 allowlist — which is also why the false
    // view_search_results events are not the website's doing.
    assert.equal(CAMPAIGN_PARAM_KEYS.includes('keyword' as never), false);
    const attr = read('src/lib/attribution.ts');
    assert.match(attr, /'keyword'/, 'keyword should still be captured for lead-level attribution');
    assert.match(attr, /mapField\('', latest, 'keyword', 'keyword'\)/, 'and still reach the lead payload');
  });
});

// ============================================================
// Developer traffic
// ============================================================

describe('Developer traffic is marked, not hidden', () => {
  const layout = read('src/layouts/BaseLayout.astro');

  test('the marker runs before GTM initialises', () => {
    const built = readFileSync(join(DIST, 'index.html'), 'utf8');
    const marker = built.indexOf('traffic_type');
    const gtm = built.indexOf('GTM-5G8Q7KKZ');
    assert.ok(marker > 0 && marker < gtm, 'the marker must precede the container');
  });

  test('it only fires off production, and carries no user data', () => {
    assert.match(layout, /window\.location\.hostname !== productionHost/);
    assert.match(layout, /traffic_type: 'internal'/);
    const built = readFileSync(join(DIST, 'index.html'), 'utf8');
    assert.match(built, /productionHost = "youraidepartment\.ai"/);
    // A fixed quoted literal, not anything derived from the visitor.
    const pushed = layout.match(/traffic_type:\s*([^,}\s]+)/)?.[1];
    assert.equal(pushed, "'internal'", `traffic_type is not a fixed literal: ${pushed}`);
  });

  test('GTM still loads everywhere, so the container remains testable', () => {
    assert.match(layout, /GTM-5G8Q7KKZ/);
    assert.equal(/import\.meta\.env\.PROD[\s\S]{0,120}GTM-/.test(layout), false, 'GTM must not be gated off production');
  });
});

// ============================================================
// Regression: earlier sprints
// ============================================================

describe('Sprints 13 and 14 are intact', () => {
  test('sitemap is 119, /go/ noindex and excluded, .htaccess present', () => {
    const sitemap = read('public/sitemap.xml');
    assert.equal([...sitemap.matchAll(/<loc>/g)].length, 119);
    for (const r of ['go/law-firms', 'go/roofing']) {
      assert.match(readFileSync(join(DIST, r, 'index.html'), 'utf8'), /<meta name="robots" content="noindex, follow">/);
      assert.equal(sitemap.includes(r), false);
    }
    assert.ok(existsSync(join(DIST, '.htaccess')));
    assert.ok(existsSync(join(DIST, 'og-default.png')));
  });

  test('the legal entity is unchanged and the future one is not published', () => {
    assert.match(readFileSync(join(DIST, 'index.html'), 'utf8'), /"legalName":"Catastrophic Solutions LLC"/);
    const leaks = walk(DIST, (f) => f.endsWith('.html'))
      .filter((f) => readFileSync(f, 'utf8').includes('Your AI Department LLC'));
    assert.deepEqual(leaks, []);
  });

  test('Sprint 14 schema and metadata still render', () => {
    const home = readFileSync(join(DIST, 'index.html'), 'utf8');
    assert.match(home, /"@type":"ImageObject"/);
    const article = readFileSync(join(DIST, 'resources/why-speed-to-lead-matters/index.html'), 'utf8');
    assert.match(article, /"@type":"Article"/);
    assert.match(article, /<title>Why Speed to Lead Matters for Service Businesses/);
  });
});
