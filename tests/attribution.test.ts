// Attribution + booking-confirmation logic test suite.
// Run with: node --experimental-strip-types --test tests/attribution.test.ts
//
// Covers Sprint 12.5 test requirements 1-13 and 16-17 (attribution
// module) and 20-24 (booking-confirmation module) directly as unit
// tests against the pure logic. Requirements 14-15 and 18-19 involve
// live DOM/fetch/build-output behavior (delegated click handling,
// Web3Forms fetch success gating, noindex meta tag presence, sitemap
// exclusion) and are covered instead by the browser-based QA and the
// build-output metadata/sitemap audits run separately for this sprint
// — not re-implemented here as Node unit tests, since that would
// either require a full DOM/fetch mock or just re-check the build
// output, which the dedicated audit scripts already do more directly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---- Minimal browser-global mocks, set up before importing the module
// under test (attribution.ts checks `typeof window === 'undefined'` at
// call time, not at import time, so setting these globals before the
// first call is sufficient — no import-order trick needed). ----

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

import {
  parseAttributionFromSearch,
  captureAttribution,
  getFirstTouch,
  getLatestTouch,
  buildLeadAttributionFields,
  generateLeadId,
  appendAttributionToUrl,
  buildCalComForwardFields,
} from '../src/lib/attribution.ts';

function freshStorage() {
  (globalThis as any).window.localStorage = new MemoryStorage();
}

describe('Attribution capture', () => {
  test('1. GCLID is captured from landing URL', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=abc123', landingPage: '/' });
    const latest = getLatestTouch();
    assert.equal(latest?.gclid, 'abc123');
  });

  test('2. GCLID survives internal navigation (no query string on the next pageview)', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=abc123', landingPage: '/' });
    captureAttribution({ search: '', landingPage: '/industries/solar/' });
    const latest = getLatestTouch();
    assert.equal(latest?.gclid, 'abc123');
  });

  test('3. Blank/direct visits do not erase previously stored attribution', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=xyz', landingPage: '/' });
    captureAttribution({ search: '', landingPage: '/contact/' });
    captureAttribution({ search: '', landingPage: '/resources/' });
    const latest = getLatestTouch();
    assert.equal(latest?.gclid, 'xyz');
  });

  test('4. First touch is not overwritten by a later, different touch', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=first-click', landingPage: '/' });
    captureAttribution({ search: '?gclid=second-click&utm_source=google', landingPage: '/google-ads/' });
    const first = getFirstTouch();
    assert.equal(first?.gclid, 'first-click');
  });

  test('5. Latest touch updates when a genuinely new qualifying touch occurs', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=first-click', landingPage: '/' });
    captureAttribution({ search: '?gclid=second-click', landingPage: '/google-ads/' });
    const latest = getLatestTouch();
    assert.equal(latest?.gclid, 'second-click');
  });

  test('6. UTM fields persist across the session', () => {
    freshStorage();
    captureAttribution({ search: '?utm_source=google&utm_medium=cpc&utm_campaign=summer_sale', landingPage: '/' });
    captureAttribution({ search: '', landingPage: '/about/' });
    const latest = getLatestTouch();
    assert.equal(latest?.utm_source, 'google');
    assert.equal(latest?.utm_medium, 'cpc');
    assert.equal(latest?.utm_campaign, 'summer_sale');
  });

  test('7. ValueTrack fields persist across the session', () => {
    freshStorage();
    captureAttribution({
      search: '?campaignid=111&adgroupid=222&keyword=ai+department&matchtype=e&device=m&network=g&creative=333&targetid=kwd-1',
      landingPage: '/',
    });
    captureAttribution({ search: '', landingPage: '/contact/' });
    const latest = getLatestTouch();
    assert.equal(latest?.campaignid, '111');
    assert.equal(latest?.adgroupid, '222');
    assert.equal(latest?.keyword, 'ai department');
    assert.equal(latest?.matchtype, 'e');
    assert.equal(latest?.device, 'm');
    assert.equal(latest?.network, 'g');
    assert.equal(latest?.creative, '333');
    assert.equal(latest?.targetid, 'kwd-1');
  });

  test('8. Unrelated query parameters are ignored and do not erase existing attribution', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=real-click', landingPage: '/' });
    captureAttribution({ search: '?foo=bar&irrelevant=1', landingPage: '/resources/' });
    const latest = getLatestTouch();
    assert.equal(latest?.gclid, 'real-click');
    const parsedUnrelated = parseAttributionFromSearch('?foo=bar&irrelevant=1');
    assert.deepEqual(parsedUnrelated, {});
  });

  test('9. Malformed URL data fails safely (does not throw)', () => {
    freshStorage();
    assert.doesNotThrow(() => captureAttribution({ search: '%%%not-a-valid-query%%%', landingPage: '/' }));
    assert.doesNotThrow(() => parseAttributionFromSearch('???&&&==='));
  });

  test('10. Cal.com URL preserves original destination', () => {
    const base = 'https://cal.com/youraidepartment/ai-strategy-call';
    const result = appendAttributionToUrl(base, { utm_source: 'google' });
    const url = new URL(result);
    assert.equal(url.origin + url.pathname, base);
  });

  test('11. Standard UTMs append correctly to a Cal.com URL', () => {
    const base = 'https://cal.com/youraidepartment/ai-strategy-call';
    const result = appendAttributionToUrl(base, {
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'brand',
    });
    const url = new URL(result);
    assert.equal(url.searchParams.get('utm_source'), 'google');
    assert.equal(url.searchParams.get('utm_medium'), 'cpc');
    assert.equal(url.searchParams.get('utm_campaign'), 'brand');
  });

  test('12. Custom ValueTrack fields append correctly to a Cal.com URL', () => {
    const base = 'https://cal.com/youraidepartment/enterprise-engagement-discussion';
    const result = appendAttributionToUrl(base, {
      campaignid: '111',
      adgroupid: '222',
      keyword: 'enterprise ai',
      matchtype: 'p',
    });
    const url = new URL(result);
    assert.equal(url.searchParams.get('campaignid'), '111');
    assert.equal(url.searchParams.get('adgroupid'), '222');
    assert.equal(url.searchParams.get('keyword'), 'enterprise ai');
    assert.equal(url.searchParams.get('matchtype'), 'p');
  });

  test('13. Empty/undefined fields are omitted, never appended as blank parameters', () => {
    const base = 'https://cal.com/youraidepartment/ai-strategy-call';
    const result = appendAttributionToUrl(base, {
      utm_source: 'google',
      utm_medium: '',
      utm_campaign: undefined,
    });
    const url = new URL(result);
    assert.equal(url.searchParams.get('utm_source'), 'google');
    assert.equal(url.searchParams.has('utm_medium'), false);
    assert.equal(url.searchParams.has('utm_campaign'), false);
  });

  test('16. Attribution fields are shaped correctly for the Web3Forms lead payload', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=lead-click&utm_source=google&utm_medium=cpc', landingPage: '/contact/' });
    const fields = buildLeadAttributionFields();
    assert.equal(fields.attribution_gclid, 'lead-click');
    assert.equal(fields.attribution_utm_source, 'google');
    assert.equal(fields.attribution_utm_medium, 'cpc');
    assert.ok(fields.attribution_latest_timestamp);
  });

  test('17. No PII field names ever appear in attribution output', () => {
    freshStorage();
    captureAttribution({ search: '?gclid=abc&utm_source=google', landingPage: '/contact/' });
    const fields = buildLeadAttributionFields();
    const forbidden = ['name', 'email', 'phone', 'message', 'firstname', 'lastname'];
    for (const key of Object.keys(fields)) {
      const lower = key.toLowerCase();
      for (const bad of forbidden) {
        assert.equal(lower.includes(bad), false, `attribution field "${key}" looks like it could contain PII`);
      }
    }
  });

  test('buildCalComForwardFields returns only populated latest-touch fields', () => {
    freshStorage();
    captureAttribution({ search: '?utm_source=google&campaignid=999', landingPage: '/' });
    const forward = buildCalComForwardFields();
    assert.equal(forward.utm_source, 'google');
    assert.equal(forward.campaignid, '999');
    assert.equal('gclid' in forward, false);
  });

  test('generateLeadId produces a non-empty, unique-looking string', () => {
    const a = generateLeadId();
    const b = generateLeadId();
    assert.ok(a.length > 0);
    assert.ok(b.length > 0);
    assert.notEqual(a, b);
  });
});

import {
  getBookingUid,
  getBookingType,
  evaluateBookingConfirmedFiring,
  buildBookingConfirmedEvent,
  ALLOWED_BOOKING_TYPES,
} from '../src/lib/bookingConfirmation.ts';

describe('Booking confirmation', () => {
  test('20. booking_confirmed does not fire without a UID', () => {
    const result = evaluateBookingConfirmedFiring(null, []);
    assert.equal(result.shouldFire, false);
  });

  test('20b. getBookingUid returns null when no candidate parameter is present', () => {
    const params = new URLSearchParams('?booking_type=strategy');
    assert.equal(getBookingUid(params), null);
  });

  test('21. booking_confirmed fires once with a valid UID', () => {
    const result = evaluateBookingConfirmedFiring('booking-123', []);
    assert.equal(result.shouldFire, true);
    assert.deepEqual(result.updatedSeen, ['booking-123']);
  });

  test('22. Reload does not duplicate booking_confirmed for the same UID', () => {
    const first = evaluateBookingConfirmedFiring('booking-123', []);
    const second = evaluateBookingConfirmedFiring('booking-123', first.updatedSeen);
    assert.equal(second.shouldFire, false);
  });

  test('a genuinely new UID in the same session still fires', () => {
    const first = evaluateBookingConfirmedFiring('booking-123', []);
    const second = evaluateBookingConfirmedFiring('booking-456', first.updatedSeen);
    assert.equal(second.shouldFire, true);
  });

  test('23. Invalid booking_type fails safely (returns null, does not throw)', () => {
    const params = new URLSearchParams('?booking_type=not-a-real-type');
    assert.doesNotThrow(() => getBookingType(params));
    assert.equal(getBookingType(params), null);
  });

  test('23b. Missing booking_type fails safely', () => {
    const params = new URLSearchParams('');
    assert.equal(getBookingType(params), null);
  });

  test('24. All five booking types are supported (incl. the paid comprehensive audit)', () => {
    for (const type of ALLOWED_BOOKING_TYPES) {
      const params = new URLSearchParams(`?booking_type=${type}`);
      assert.equal(getBookingType(params), type);
    }
    assert.equal(ALLOWED_BOOKING_TYPES.length, 5);
  });

  test('buildBookingConfirmedEvent never includes PII-shaped fields', () => {
    const event = buildBookingConfirmedEvent('strategy');
    const forbidden = ['email', 'phone', 'name', 'attendee', 'message', 'notes', 'title'];
    for (const key of Object.keys(event)) {
      const lower = key.toLowerCase();
      for (const bad of forbidden) {
        assert.equal(lower.includes(bad), false, `booking_confirmed field "${key}" looks like it could contain PII`);
      }
    }
    assert.equal(event.event, 'booking_confirmed');
    assert.equal(event.booking_source, 'cal.com');
    assert.equal(event.booking_type, 'strategy');
  });

  test('buildBookingConfirmedEvent omits booking_type when null', () => {
    const event = buildBookingConfirmedEvent(null);
    assert.equal('booking_type' in event, false);
  });

  test('UID candidate parameter names are checked defensively', () => {
    assert.equal(getBookingUid(new URLSearchParams('?uid=a')), 'a');
    assert.equal(getBookingUid(new URLSearchParams('?bookingUid=b')), 'b');
    assert.equal(getBookingUid(new URLSearchParams('?booking_uid=c')), 'c');
    assert.equal(getBookingUid(new URLSearchParams('?bookingId=d')), 'd');
  });
});
