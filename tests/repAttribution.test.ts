// Sales-rep attribution test suite.
// Run with: node --experimental-strip-types --test tests/repAttribution.test.ts
//
// Covers sanitize/parse/capture/persist/expiry behavior for the ?rep=
// code that attributes leads and bookings to the sales rep who shared
// the link. Same MemoryStorage mock pattern as the other suites.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

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

import {
  sanitizeRepCode,
  parseRepFromSearch,
  captureRepAttribution,
  getRepCode,
  buildRepLeadFields,
  buildCalComRepField,
  REP_ATTRIBUTION_RETENTION_DAYS,
} from '../src/lib/repAttribution.ts';

function freshStorage() {
  (globalThis as any).window.localStorage = new MemoryStorage();
}

// ---- Sanitization ---------------------------------------------------------

describe('Rep code sanitization', () => {
  test('lowercases and strips invalid characters but keeps useful ones', () => {
    assert.equal(sanitizeRepCode('  Jane_Doe '), 'jane_doe');
    assert.equal(sanitizeRepCode('John.Smith-42'), 'john.smith-42');
    assert.equal(sanitizeRepCode('JANE!'), 'jane');
  });

  test('caps length at 64 characters', () => {
    assert.equal(sanitizeRepCode('a'.repeat(80)).length, 64);
  });

  test('rejects empty/whitespace/invalid-only values', () => {
    assert.equal(sanitizeRepCode(null), null);
    assert.equal(sanitizeRepCode('   '), null);
    assert.equal(sanitizeRepCode('!!!'), null);
    assert.equal(sanitizeRepCode(''), null);
  });
});

// ---- Parsing --------------------------------------------------------------

describe('URL parsing', () => {
  test('reads the primary rep param', () => {
    assert.equal(parseRepFromSearch('?rep=michael'), 'michael');
  });

  test('reads the r alias', () => {
    assert.equal(parseRepFromSearch('?r=sarah'), 'sarah');
  });

  test('rep wins when both rep and r are present', () => {
    assert.equal(parseRepFromSearch('?rep=michael&r=sarah'), 'michael');
  });

  test('sanitizes parsed values', () => {
    // '%20' decodes to a space, which sanitization strips entirely.
    assert.equal(parseRepFromSearch('?rep=Jane%20Doe'), 'janedoe');
    assert.equal(parseRepFromSearch('?rep=John_Doe-99!'), 'john_doe-99');
  });

  test('no params yields null', () => {
    assert.equal(parseRepFromSearch(''), null);
    assert.equal(parseRepFromSearch('?utm_source=google'), null);
  });
});

// ---- Capture semantics -----------------------------------------------------

describe('Capture and persistence', () => {
  test('captures a valid code and reads it back', () => {
    freshStorage();
    captureRepAttribution({ search: '?rep=michael' });
    assert.equal(getRepCode(), 'michael');
  });

  test('first capture wins — a later ?rep= does not steal credit', () => {
    freshStorage();
    captureRepAttribution({ search: '?rep=alice' });
    captureRepAttribution({ search: '?rep=bob' });
    assert.equal(getRepCode(), 'alice');
  });

  test('an expired code can be replaced by a new capture', () => {
    freshStorage();
    const old = new Date(Date.now() - (REP_ATTRIBUTION_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    captureRepAttribution({ search: '?rep=alice', now: () => old });
    assert.equal(getRepCode(), null); // expired -> not readable
    captureRepAttribution({ search: '?rep=bob' });
    assert.equal(getRepCode(), 'bob');
  });

  test('no param is a no-op and never fabricates a code', () => {
    freshStorage();
    captureRepAttribution({ search: '' });
    captureRepAttribution({ search: '?utm_source=google' });
    assert.equal(getRepCode(), null);
  });

  test('retention boundary: within window kept, just outside dropped', () => {
    freshStorage();
    const almost = new Date(Date.now() - (REP_ATTRIBUTION_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000);
    captureRepAttribution({ search: '?rep=carol', now: () => almost });
    assert.equal(getRepCode(), 'carol');

    freshStorage();
    const justOver = new Date(Date.now() - (REP_ATTRIBUTION_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    captureRepAttribution({ search: '?rep=carol', now: () => justOver });
    assert.equal(getRepCode(), null);
  });
});

// ---- Lead payload builders --------------------------------------------------

describe('Lead payload builders', () => {
  test('buildRepLeadFields returns rep_code only when captured', () => {
    freshStorage();
    assert.deepEqual(buildRepLeadFields(), {});
    captureRepAttribution({ search: '?rep=michael' });
    assert.deepEqual(buildRepLeadFields(), { rep_code: 'michael' });
  });

  test('buildCalComRepField uses the booking-facing key', () => {
    freshStorage();
    captureRepAttribution({ search: '?rep=michael' });
    assert.deepEqual(buildCalComRepField(), { rep: 'michael' });
    freshStorage();
    assert.deepEqual(buildCalComRepField(), {});
  });
});
