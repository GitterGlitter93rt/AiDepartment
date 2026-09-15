import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { politeFetch, resetFetchState } from '../src/resolver/fetcher.js';

/**
 * The crawler is pointed by strangers.
 *
 * Every URL it is given came from outside: a domain a discovery provider returned,
 * or a link on a page that domain served. Nothing upstream guarantees the host is on
 * the public internet, and a company website recorded as 169.254.169.254 would have
 * had this worker read the cloud metadata service and file the result as evidence
 * about a prospect.
 */

/**
 * These tests assert production behaviour, so they run with the test harness's
 * loopback allowance switched off. Without this they would pass against a guard that
 * was not actually guarding.
 */
let allowance: string | undefined;
before(() => {
  allowance = process.env['RESEARCH_ALLOW_PRIVATE_ADDRESSES'];
  delete process.env['RESEARCH_ALLOW_PRIVATE_ADDRESSES'];
});
after(() => {
  if (allowance !== undefined) process.env['RESEARCH_ALLOW_PRIVATE_ADDRESSES'] = allowance;
});

beforeEach(() => { resetFetchState(); });

test('the loopback allowance is off by default, so the guard is real', () => {
  assert.equal(process.env['RESEARCH_ALLOW_PRIVATE_ADDRESSES'], undefined);
});

test('loopback is refused, by name and by address', async () => {
  for (const url of [
    'http://127.0.0.1:8080/', 'http://localhost:3000/', 'https://[::1]/',
    'http://127.0.0.1/healthz',
  ]) {
    const result = await politeFetch(url);
    assert.equal(result.ok, false, `${url} was fetched`);
    assert.equal(result.blockedReason, 'private_address', `${url} was not refused as private`);
  }
});

test('cloud metadata and link-local are refused', async () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
  ]) {
    const result = await politeFetch(url);
    assert.equal(result.blockedReason, 'private_address', `${url} was reachable`);
  }
});

test('RFC1918 ranges are refused', async () => {
  for (const url of [
    'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.4.4/',
    'http://100.64.0.1/',
  ]) {
    const result = await politeFetch(url);
    assert.equal(result.blockedReason, 'private_address', `${url} was reachable`);
  }
});

test('an IPv4-mapped IPv6 loopback does not slip past', async () => {
  const result = await politeFetch('http://[::ffff:127.0.0.1]/');
  assert.equal(result.blockedReason, 'private_address');
});

test('non-HTTP schemes are refused outright', async () => {
  for (const url of ['file:///etc/passwd', 'gopher://127.0.0.1/', 'ftp://10.0.0.1/']) {
    const result = await politeFetch(url);
    assert.equal(result.ok, false, `${url} was fetched`);
  }
});

test('a host that simply does not resolve fails, and is not called internal', async () => {
  // The guard answers "does this point somewhere internal", not "does this resolve".
  // Refusing unresolvable names would make it depend on live DNS for correctness --
  // a false negative offline, and a test that passes for the wrong reason.
  const result = await politeFetch('https://this-host-does-not-exist.invalid/');
  assert.equal(result.ok, false);
  assert.notEqual(result.blockedReason, 'private_address',
    'an ordinary DNS failure was reported as an internal-address refusal');
});

test('a credential does not follow a redirect to another origin', async () => {
  // extraHeaders carries a registered API key. If the source redirects off-host, the
  // key must not go with it: it belongs to the origin it was issued for.
  const seen: { url: string; hadKey: boolean }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url, hadKey: 'api-key' in headers });
    if (url.includes('robots.txt')) {
      return new Response('User-agent: *\nAllow: /\n',
        { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (url.startsWith('https://api.example/')) {
      return new Response('', { status: 302,
        headers: { location: 'https://elsewhere.example/landing' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;

  try {
    await politeFetch('https://api.example/data', { 'api-key': 'secret-value' });
  } finally {
    globalThis.fetch = realFetch;
  }

  const first = seen.find((entry) => entry.url.startsWith('https://api.example/data'))!;
  const redirected = seen.find((entry) => entry.url.startsWith('https://elsewhere.example/'));
  assert.equal(first.hadKey, true, 'the key was not sent to the origin it belongs to');
  if (redirected) {
    assert.equal(redirected.hadKey, false,
      'the API key was handed to whoever answered the redirect');
  }
  assert.ok(!seen.some((entry) =>
    entry.url.includes('elsewhere') && entry.hadKey),
  'a credential crossed an origin boundary');
});
