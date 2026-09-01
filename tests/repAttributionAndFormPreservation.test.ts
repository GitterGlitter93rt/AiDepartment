// Contact-form preservation + employee/business-card (rep) attribution.
// Run with: node --experimental-strip-types --test tests/repAttributionAndFormPreservation.test.ts
//
// Two subjects:
//   1. A validation failure must never erase what the visitor typed.
//      The bug: handleContactSubmit() called this.render(), which
//      rebuilt the contact form from a template string with no value
//      attributes — wiping every field after the visitor had already
//      completed the assessment.
//   2. rep_code (employee QR codes) reaching the approved analytics
//      events, without ever becoming a channel for PII.
//
// NOTE ON METHOD: this repository has no DOM harness, so the app-level
// guarantees are asserted as SOURCE CONTRACTS against the exact code
// paths that caused the bug, alongside real unit tests of the pure
// logic. A source contract is the right tool here: the regression is
// "someone calls this.render() in a validation branch", and that is
// precisely what these assertions forbid.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateQuickContactField, validateQuickContact } from '../src/lib/assessment/quickLeadSubmission.ts';
import { withRepCode, withCampaignParams, buildAssessmentStartParams, buildAssessmentLeadSubmitParams, ASSESSMENT_TYPE } from '../src/lib/assessment/ga4Events.ts';
import { buildBookingConfirmedEvent } from '../src/lib/bookingConfirmation.ts';
import { buildCtaClickParams, buildBookingClickEvent, buildFunnelViewParams, isPiiFreePayload } from '../src/lib/funnels/analytics.ts';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

const QUICK_APP = read('src/components/assessment/quickAssessmentApp.ts');
const FULL_APP = read('src/components/assessment/assessmentApp.ts');
const TRACKER = read('src/components/AnalyticsEvents.astro');
const CAPTURE = read('src/components/AttributionCapture.astro');

const APPS: [string, string][] = [
  ['quick (15-question)', QUICK_APP],
  ['comprehensive (64-question)', FULL_APP],
];

// ============================================================
// 1. THE FORM-CLEARING BUG
// ============================================================

describe('Validation failures never re-render the contact form', () => {
  test('no validation branch calls this.render() — the exact regression', () => {
    for (const [name, src] of APPS) {
      const start = src.indexOf('private handleContactSubmit');
      assert.ok(start > -1, `${name}: handler must exist`);
      // The handler body up to the point where submission genuinely
      // begins. Everything before that is validation.
      const submitAt = src.indexOf('this.isSubmitting = true;', start);
      const validationBody = src.slice(start, submitAt);
      assert.ok(submitAt > start, `${name}: could not locate the submission boundary`);
      assert.equal(
        /this\.render\(\)/.test(validationBody),
        false,
        `${name}: a validation branch calls this.render(), which erases the form`
      );
      assert.ok(validationBody.includes('this.showContactError('), `${name}: must report errors in place`);
    }
  });

  test('errors are shown by mutating the DOM, not replacing it', () => {
    for (const [name, src] of APPS) {
      const fn = src.slice(src.indexOf('private showContactError'), src.indexOf('private handleContactSubmit'));
      assert.ok(fn.length > 0, `${name}: showContactError must exist`);
      assert.equal(/innerHTML/.test(fn), false, `${name}: must not rebuild markup`);
      assert.ok(fn.includes('errorEl.textContent = message'), `${name}: message is set as text`);
    }
  });

  test('the error message is accessible and announced', () => {
    for (const [name, src] of APPS) {
      const fn = src.slice(src.indexOf('private showContactError'), src.indexOf('private handleContactSubmit'));
      assert.match(fn, /setAttribute\('role', 'alert'\)/, `${name}: role=alert`);
      assert.match(fn, /setAttribute\('aria-live', 'assertive'\)/, `${name}: aria-live`);
      assert.match(fn, /setAttribute\('aria-invalid', 'true'\)/, `${name}: marks the bad field`);
      assert.match(fn, /setAttribute\('aria-describedby', 'a-contact-error'\)/, `${name}: links field to message`);
      // Stale invalid flags are cleared before the new one is set.
      assert.match(fn, /querySelectorAll\('\[aria-invalid="true"\]'\)/, `${name}: clears stale flags`);
    }
  });

  test('the first invalid field is focused', () => {
    for (const [name, src] of APPS) {
      const fn = src.slice(src.indexOf('private showContactError'), src.indexOf('private handleContactSubmit'));
      assert.match(fn, /field\.focus\(\)/, `${name}: must focus the offending control`);
      // Consent failure targets the consent checkbox specifically.
      const handler = src.slice(src.indexOf('private handleContactSubmit'), src.indexOf('this.isSubmitting = true;', src.indexOf('private handleContactSubmit')));
      assert.match(handler, /showContactError\([\s\S]*?'consent',?\s*\)/, `${name}: consent failure focuses the consent box`);
      assert.match(handler, /fieldError\.field/, `${name}: field failure focuses that field`);
    }
  });

  test('every typed value is snapshotted and restored on any re-render', () => {
    for (const [name, src] of APPS) {
      assert.ok(src.includes('private captureContactDraft(form: HTMLFormElement)'), `${name}: needs a draft snapshot`);
      // Captured on submit AND continuously while typing, so even an
      // unrelated re-render restores the form.
      assert.match(src, /addEventListener\('input', \(\) => this\.captureContactDraft\(form\)\)/, `${name}: input listener`);
      assert.match(src, /addEventListener\('change', \(\) => this\.captureContactDraft\(form\)\)/, `${name}: change listener`);

      // renderContact must emit the stored values back into the markup.
      const render = src.slice(src.indexOf('private renderContact()'), src.indexOf('private renderSubmitError()'));
      for (const field of ['firstName', 'lastName', 'email', 'phone', 'company', 'website']) {
        assert.ok(render.includes(`\${v(d.${field})}`), `${name}: ${field} must be repopulated`);
      }
      for (const box of ['consent', 'marketingOptIn']) {
        assert.ok(render.includes(`\${c(d.${box})}`), `${name}: ${box} checkbox state must be repopulated`);
      }
      // Values are escaped on the way back into markup.
      assert.match(render, /const v = \(value: string \| undefined\) => \(value \? ` value="\$\{escapeHtml\(value\)\}"` : ''\)/, `${name}: values must be escaped`);
    }
  });

  test('no lead is sent and no completion/lead event fires before validation passes', () => {
    for (const [name, src] of APPS) {
      const start = src.indexOf('private handleContactSubmit');
      const submitAt = src.indexOf('this.isSubmitting = true;', start);
      const validationBody = src.slice(start, submitAt);
      assert.equal(/dataLayer/.test(validationBody), false, `${name}: no dataLayer push before validation passes`);
      assert.equal(/ASSESSMENT_EVENTS\.(complete|leadSubmit)/.test(validationBody), false, `${name}: no completion event`);
      assert.equal(/submit(Quick)?(Assessment)?Lead\(/.test(validationBody), false, `${name}: no lead delivery`);
      // Every early return happens before the submission boundary.
      assert.ok(validationBody.includes('return;'), `${name}: invalid submissions must return early`);
    }
  });

  test('duplicate-submit protection and retry behaviour are preserved', () => {
    for (const [name, src] of APPS) {
      assert.match(src, /if \(this\.isSubmitting\) return; \/\/ duplicate-submit protection/, `${name}: guard intact`);
      assert.ok(src.includes('attemptLeadSubmission'), `${name}: retry path intact`);
      assert.ok(src.includes('outcome.delivered'), `${name}: delivery confirmation gate intact`);
    }
  });
});

describe('Field-level validation', () => {
  const ok = { firstName: 'Tony', email: 'tony@example.com', company: 'Acme', website: undefined };

  test('a fully valid contact passes', () => {
    assert.equal(validateQuickContactField(ok), null);
  });

  test('required fields are reported individually, in reading order', () => {
    assert.deepEqual(validateQuickContactField({ ...ok, firstName: '' })?.field, 'firstName');
    assert.deepEqual(validateQuickContactField({ ...ok, email: '' })?.field, 'email');
    assert.deepEqual(validateQuickContactField({ ...ok, company: '' })?.field, 'company');
    // Whitespace is not a value.
    assert.equal(validateQuickContactField({ ...ok, firstName: '   ' })?.field, 'firstName');
  });

  test('email must look like an email', () => {
    assert.equal(validateQuickContactField({ ...ok, email: 'not-an-email' })?.field, 'email');
    assert.equal(validateQuickContactField({ ...ok, email: 'a@b' })?.field, 'email');
    assert.equal(validateQuickContactField({ ...ok, email: 'tony@example.co.uk' }), null);
  });

  test('website is optional, but must be valid when supplied', () => {
    assert.equal(validateQuickContactField({ ...ok, website: undefined }), null);
    assert.equal(validateQuickContactField({ ...ok, website: '' }), null);
    assert.equal(validateQuickContactField({ ...ok, website: 'https://acme.com' }), null);
    assert.equal(validateQuickContactField({ ...ok, website: 'acme.com' }), null, 'bare domains are accepted');
    assert.equal(validateQuickContactField({ ...ok, website: 'not a url' })?.field, 'website');
  });

  test('marketingOptIn is never required to submit', () => {
    // It is absent from the validator's contract entirely.
    assert.equal(validateQuickContactField(ok), null);
    const src = read('src/lib/assessment/quickLeadSubmission.ts');
    const fn = src.slice(src.indexOf('export function validateQuickContactField'));
    assert.equal(/marketingOptIn/.test(fn.slice(0, fn.indexOf('\n}'))), false, 'marketingOptIn must not gate submission');
    // And the checkbox carries no `required` attribute in either app.
    for (const [name, app] of APPS) {
      assert.match(app, /name="marketingOptIn"\$\{c\(d\.marketingOptIn\)\}/, `${name}: optional checkbox, no required`);
      assert.equal(/name="marketingOptIn"[^>]*required/.test(app), false, `${name}: must not be required`);
    }
  });

  test('the original message-only validator is unchanged for existing callers', () => {
    assert.equal(validateQuickContact({ firstName: 'A', email: 'a@b.com', company: 'C' }), null);
    assert.equal(
      validateQuickContact({ firstName: '', email: 'a@b.com', company: 'C' }),
      'First name, business email, and company are required.'
    );
  });
});

// ============================================================
// 2. REP ATTRIBUTION
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
  captureRepAttribution,
  getRepCode,
  sanitizeRepCode,
  parseRepFromSearch,
  buildRepLeadFields,
  buildCalComRepField,
  REP_ATTRIBUTION_RETENTION_DAYS,
} = await import('../src/lib/repAttribution.ts');

const { captureAttribution, buildCalComForwardFields, appendAttributionToUrl, getCampaignAttribution } =
  await import('../src/lib/attribution.ts');

function freshStorage() {
  (globalThis as any).window.localStorage = new MemoryStorage();
}

const TONY = 'tony-prendergast';
const BRENT = 'brent-blythe';
const TONY_QR = `?rep=${TONY}&utm_source=business_card&utm_medium=qr&utm_campaign=field_sales&utm_content=${TONY}`;
const BRENT_QR = `?rep=${BRENT}&utm_source=business_card&utm_medium=qr&utm_campaign=field_sales&utm_content=${BRENT}`;

describe('Employee QR capture', () => {
  test("Tony's QR code is captured and retained", () => {
    freshStorage();
    captureRepAttribution({ search: TONY_QR });
    assert.equal(getRepCode(), TONY);
    assert.deepEqual(buildRepLeadFields(), { rep_code: TONY });
  });

  test("Brent's QR code is captured in a fresh storage context", () => {
    freshStorage();
    captureRepAttribution({ search: BRENT_QR });
    assert.equal(getRepCode(), BRENT);
    assert.deepEqual(buildRepLeadFields(), { rep_code: BRENT });
  });

  test('both documented codes survive sanitization unchanged', () => {
    assert.equal(sanitizeRepCode(TONY), TONY);
    assert.equal(sanitizeRepCode(BRENT), BRENT);
    assert.equal(parseRepFromSearch(TONY_QR), TONY);
    assert.equal(parseRepFromSearch(BRENT_QR), BRENT);
  });

  test('the ?r= short alias still works, and ?rep= wins when both are present', () => {
    assert.equal(parseRepFromSearch(`?r=${BRENT}`), BRENT);
    assert.equal(parseRepFromSearch(`?rep=${TONY}&r=${BRENT}`), TONY);
  });

  test('rep_code persists on a later page whose URL has no rep parameter', () => {
    freshStorage();
    captureRepAttribution({ search: TONY_QR });
    captureRepAttribution({ search: '' });                       // homepage
    captureRepAttribution({ search: '?utm_source=google' });     // another page
    assert.equal(getRepCode(), TONY, 'attribution must survive internal navigation');
  });

  test('first capture wins — a later code cannot steal credit inside the window', () => {
    freshStorage();
    captureRepAttribution({ search: TONY_QR });
    captureRepAttribution({ search: BRENT_QR });
    assert.equal(getRepCode(), TONY, "Brent's link must not overwrite Tony's unexpired credit");
  });

  test('an EXPIRED attribution may be replaced normally', () => {
    freshStorage();
    const longAgo = new Date(Date.now() - (REP_ATTRIBUTION_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    captureRepAttribution({ search: TONY_QR, now: () => longAgo });
    assert.equal(getRepCode(), null, 'expired credit is not returned');
    captureRepAttribution({ search: BRENT_QR });
    assert.equal(getRepCode(), BRENT, 'a new scan may claim expired attribution');
  });

  test('the storage contract is unchanged: key and 180-day retention', () => {
    assert.equal(REP_ATTRIBUTION_RETENTION_DAYS, 180);
    freshStorage();
    captureRepAttribution({ search: TONY_QR });
    const raw = (globalThis as any).window.localStorage.getItem('yai_rep_attribution');
    assert.ok(raw, 'must use the yai_rep_attribution key');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.repCode, TONY);
    assert.deepEqual(Object.keys(parsed).sort(), ['capturedAt', 'repCode', 'version']);
  });

  test('organic visitors get no rep code at all', () => {
    freshStorage();
    captureRepAttribution({ search: '' });
    captureRepAttribution({ search: '?utm_source=smartlead&utm_medium=email' });
    assert.equal(getRepCode(), null);
    assert.deepEqual(buildRepLeadFields(), {}, 'no fabricated rep_code');
    assert.deepEqual(buildCalComRepField(), {});
  });

  test('blocked storage never throws', () => {
    const saved = (globalThis as any).window;
    (globalThis as any).window = {
      get localStorage() {
        throw new Error('storage blocked');
      },
    };
    assert.doesNotThrow(() => captureRepAttribution({ search: TONY_QR }));
    assert.doesNotThrow(() => getRepCode());
    assert.doesNotThrow(() => buildRepLeadFields());
    (globalThis as any).window = saved;
  });
});

describe('rep_code can never carry prospect PII', () => {
  test('form-shaped input is stripped to a harmless token or rejected', () => {
    // rep_code can only come from ?rep=/?r= on a URL we publish, and is
    // sanitized to [a-z0-9._-] with a 64-char cap. Even if someone
    // hand-crafted a URL, none of these survive intact.
    assert.equal(sanitizeRepCode('Tony Prendergast'), 'tonyprendergast', 'spaces stripped');
    assert.equal(sanitizeRepCode('tony@example.com'), 'tonyexample.com', '@ stripped — not a usable address');
    // Hyphens are legitimately part of a rep code (tony-prendergast),
    // so they survive — but the parentheses and spaces that make a
    // phone number readable do not.
    assert.equal(sanitizeRepCode('(555) 123-4567'), '555123-4567');
    assert.equal(sanitizeRepCode('<script>alert(1)</script>'), 'scriptalert1script');
    assert.equal(sanitizeRepCode('!!!'), null);
    assert.equal(sanitizeRepCode(''), null);
    assert.equal(sanitizeRepCode(null), null);
    assert.equal(sanitizeRepCode('x'.repeat(500))!.length, 64, 'length capped');
  });

  test('a sanitized code is never a valid email or phone number', () => {
    const fromEmail = sanitizeRepCode('someone@example.com')!;
    assert.equal(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail), false, 'cannot round-trip to an email');
    const fromPhone = sanitizeRepCode('+1 (555) 867-5309')!;
    assert.equal(/[()+\s]/.test(fromPhone), false, 'phone punctuation removed');
  });

  test('rep attribution stores no prospect fields', () => {
    freshStorage();
    captureRepAttribution({ search: TONY_QR });
    const raw = (globalThis as any).window.localStorage.getItem('yai_rep_attribution')!;
    for (const bad of ['email', 'phone', 'firstName', 'lastName', 'company', 'website', 'answers']) {
      assert.equal(raw.toLowerCase().includes(bad.toLowerCase()), false, `${bad} must not be stored`);
    }
  });
});

describe('rep_code on the approved analytics events', () => {
  test('assessment events carry rep_code when present and omit it when not', () => {
    const base = buildAssessmentStartParams(ASSESSMENT_TYPE.free);
    assert.equal(withRepCode(base, TONY).rep_code, TONY);
    assert.equal('rep_code' in withRepCode(base, null), false, 'organic: omitted');
    assert.equal('rep_code' in withRepCode(base, undefined), false);
    assert.equal('rep_code' in withRepCode(base, ''), false, 'never blank');
    // The base params survive untouched.
    assert.equal(withRepCode(base, TONY).assessment_type, 'free_opportunity');
  });

  test('rep_code composes with campaign params without disturbing them', () => {
    const campaign = { utm_source: 'business_card', utm_medium: 'qr', utm_campaign: 'field_sales', utm_content: TONY };
    const payload = withRepCode(
      withCampaignParams(buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.free, 'lead-1', 72), campaign),
      TONY,
    );
    assert.equal(payload.rep_code, TONY);
    assert.equal(payload.utm_campaign, 'field_sales');
    assert.equal(payload.assessment_type, 'free_opportunity');
    assert.equal(payload.lead_id, 'lead-1');
  });

  test('booking_confirmed carries rep_code, and stays PII-free', () => {
    const withRep = buildBookingConfirmedEvent('strategy', TONY);
    assert.equal(withRep.rep_code, TONY);
    assert.equal(withRep.event, 'booking_confirmed');
    assert.equal(withRep.booking_source, 'cal.com');
    assert.equal('rep_code' in buildBookingConfirmedEvent('strategy', null), false);
    assert.equal('rep_code' in buildBookingConfirmedEvent('strategy'), false, 'back-compatible signature');
  });

  test('funnel events carry rep_code', () => {
    const identity = { vertical: 'plumbing', funnel_id: 'plumbing_ai' } as const;
    const creative = { utm_content: 'plumbing_ugc_vsl_01' };
    const cta = buildCtaClickParams(identity, 'hero', 'demo', creative, TONY);
    assert.equal(cta.rep_code, TONY);
    assert.equal(cta.utm_content, 'plumbing_ugc_vsl_01');
    const booking = buildBookingClickEvent(identity, 'offer', 'demo', creative, TONY);
    assert.equal(booking.params.rep_code, TONY);
    assert.match(booking.event, /^booking_click_/);
    assert.equal('rep_code' in buildFunnelViewParams(identity, creative), false, 'organic: omitted');
    assert.equal('rep_code' in buildCtaClickParams(identity, 'hero', 'demo', creative, null), false);
  });

  test('rep_code passes the existing funnel PII guard — the allowlist is not weakened', () => {
    const identity = { vertical: 'plumbing', funnel_id: 'plumbing_ai' } as const;
    const payload = buildCtaClickParams(identity, 'hero', 'demo', { utm_content: 'x' }, TONY);
    assert.ok(isPiiFreePayload(payload), 'rep_code must not trip the PII key guard');
    assert.equal(isPiiFreePayload({ email: 'x' }), false, 'the guard still works');
    assert.equal(isPiiFreePayload({ first_name: 'x' }), false);
  });

  test('no assessment or funnel payload key looks like PII', () => {
    const identity = { vertical: 'plumbing', funnel_id: 'plumbing_ai' } as const;
    const payloads: Record<string, unknown>[] = [
      withRepCode(buildAssessmentStartParams(ASSESSMENT_TYPE.free), TONY),
      withRepCode(buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.comprehensive, 'lead-2', 40), TONY),
      buildBookingConfirmedEvent('comprehensive_audit', TONY),
      buildCtaClickParams(identity, 'final', 'demo', {}, TONY),
    ];
    const forbidden = ['firstname', 'lastname', 'email', 'phone', 'company', 'website', 'answer', 'message', 'address'];
    for (const payload of payloads) {
      for (const key of Object.keys(payload)) {
        for (const bad of forbidden) {
          assert.equal(key.toLowerCase().includes(bad), false, `key "${key}" looks like PII`);
        }
      }
    }
  });
});

describe('Event wiring for rep_code', () => {
  test('AttributionCapture publishes the sanitized code for the inline tracker', () => {
    assert.ok(CAPTURE.includes('getRepCode()'), 'must read the stored code');
    assert.match(CAPTURE, /yaiRep/, 'must publish it for AnalyticsEvents.astro');
    // Only set when present — no blank global for organic visitors.
    assert.match(CAPTURE, /if \(repCode\) \{/);
  });

  test('every event from the site-wide tracker carries rep_code when present', () => {
    // pushEvent is the single choke point for booking_click_strategy,
    // _enterprise, _training, _executive_advisory, _comprehensive_audit,
    // resource_cta_click and ai_assessment_start.
    assert.match(TRACKER, /window\.dataLayer\.push\(Object\.assign\(\{ event: eventName \}, extra \|\| \{\}, repParams\(\)\)\)/);
    assert.ok(TRACKER.includes('function repParams()'));
    assert.match(TRACKER, /typeof rep === 'string' && rep\.length > 0 \? \{ rep_code: rep \} : \{\}/, 'omitted when absent');
    for (const evt of [
      'booking_click_strategy',
      'booking_click_enterprise',
      'booking_click_training',
      'booking_click_executive_advisory',
      'booking_click_comprehensive_audit',
    ]) {
      assert.ok(TRACKER.includes(evt), `${evt} must still be emitted through pushEvent`);
    }
  });

  test('both assessment apps attach rep_code to complete and lead_submit', () => {
    for (const [name, src] of APPS) {
      assert.ok(src.includes("import { getRepCode } from '../../lib/repAttribution'"), `${name}: imports getRepCode`);
      assert.equal((src.match(/withRepCode\(/g) || []).length, 2, `${name}: exactly complete + lead_submit`);
    }
  });

  test('the funnel tracker reads and forwards the rep code', () => {
    const funnel = read('src/components/funnel/FunnelAnalytics.astro');
    assert.ok(funnel.includes("import { getRepCode } from '../../lib/repAttribution'"));
    assert.ok(funnel.includes('repCode = getRepCode()'));
    for (const call of ['buildFunnelViewParams(identity, creative, repCode)', 'buildCtaClickParams(identity, location, type, creative, repCode)', 'buildBookingClickEvent(identity, location, type, creative, repCode)']) {
      assert.ok(funnel.includes(call), `funnel tracker must forward repCode to ${call.split('(')[0]}`);
    }
  });

  test('booking-confirmed passes the rep code through', () => {
    const page = read('src/pages/booking-confirmed/index.astro');
    assert.ok(page.includes("import { getRepCode } from '../../lib/repAttribution'"));
    assert.ok(page.includes('buildBookingConfirmedEvent(bookingType, getRepCode())'));
  });
});

describe('Cal.com forwarding and lead delivery', () => {
  test('rep travels to the booking URL exactly once, destination unchanged', () => {
    freshStorage();
    captureAttribution({ search: TONY_QR, landingPage: '/free-ai-assessment/' });
    captureRepAttribution({ search: TONY_QR });

    const base = 'https://cal.com/youraidepartment/ai-strategy-call';
    const merged = { ...buildCalComForwardFields(), ...buildCalComRepField() };
    const enriched = appendAttributionToUrl(base, merged);
    const url = new URL(enriched);

    assert.equal(url.origin + url.pathname, base, 'destination event unchanged');
    assert.deepEqual(url.searchParams.getAll('rep'), [TONY], 'exactly one rep parameter');
    assert.equal((enriched.match(/[?&]rep=/g) || []).length, 1, 'not duplicated');
    // Campaign parameters ride along untouched.
    assert.equal(url.searchParams.get('utm_source'), 'business_card');
    assert.equal(url.searchParams.get('utm_campaign'), 'field_sales');
  });

  test('the booking-forwarding field is `rep`, the lead field is `rep_code`', () => {
    freshStorage();
    captureRepAttribution({ search: TONY_QR });
    assert.deepEqual(buildCalComRepField(), { rep: TONY });
    assert.deepEqual(buildRepLeadFields(), { rep_code: TONY });
  });

  test('rep_code reaches Web3Forms delivery and the readable Sales Rep line', () => {
    const submission = read('src/lib/assessment/quickLeadSubmission.ts');
    assert.ok(submission.includes('buildRepLeadFields'), 'rep fields merged into the payload');
    assert.ok(submission.includes('Object.assign(payload, attributionFields, repFields)'));
    assert.match(submission, /Sales Rep/i, 'readable Sales Rep line in the lead email');
  });

  test('the six Smartlead campaign parameters are unchanged by this work', () => {
    freshStorage();
    captureAttribution({
      search: '?utm_id=sl_roofing_20260820&utm_source=smartlead&utm_medium=email&utm_campaign=roofing_ai_assessment_cold_outreach_202608&utm_content=step_1&utm_term=roofing',
      landingPage: '/free-ai-assessment/',
    });
    assert.deepEqual(getCampaignAttribution(), {
      utm_id: 'sl_roofing_20260820',
      utm_source: 'smartlead',
      utm_medium: 'email',
      utm_campaign: 'roofing_ai_assessment_cold_outreach_202608',
      utm_content: 'step_1',
      utm_term: 'roofing',
    });
    // And a Smartlead visitor with no QR scan carries no rep_code.
    assert.equal(getRepCode(), null);
  });
});
