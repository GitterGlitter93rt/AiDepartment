import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { classifyFetchFailure, politeFetch, resetFetchState } from '../src/resolver/fetcher.js';
import { researchFirstParty } from '../src/resolver/adapters/firstParty.js';

/**
 * A source we could not read is not a company with nothing to say.
 *
 * Production found the difference the hard way. A plumbing company's website refuses
 * the TLS our client offers, so the crawl fetched nothing -- and the run recorded zero
 * pages fetched, zero blocked, no notes and no error, which is byte-for-byte what a
 * crawl with nothing to do looks like. The rep was told the company had no usable
 * contact. What was true is that we never reached it.
 *
 * These tests pin the distinction at both ends: the fetcher must say why it failed,
 * and the crawl must keep that reason.
 */

test('a failure says which kind of failure it was', () => {
  const tls = Object.assign(new Error('write EPROTO'), {
    cause: Object.assign(new Error('handshake failure'), { code: 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE' }),
  });
  assert.equal(classifyFetchFailure(tls), 'tls_error');

  assert.equal(classifyFetchFailure(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), 'dns_error');
  assert.equal(classifyFetchFailure(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), 'connection_refused');
  assert.equal(classifyFetchFailure(Object.assign(new Error('x'), { name: 'AbortError' })), 'timeout');

  // Unrecognised stays general rather than being guessed into a specific cause: a
  // confident wrong reason is worse for an operator than an honest vague one.
  assert.equal(classifyFetchFailure(new Error('something else entirely')), 'fetch_error');
});

test('a host that refuses the connection is reported, not returned as an empty page', async () => {
  resetFetchState();
  // Port 1 is reserved and nothing listens on it, so the connection is refused
  // deterministically without depending on the network.
  const result = await politeFetch('http://127.0.0.1:1/');
  assert.equal(result.ok, false);
  assert.ok(result.failureReason, 'the fetcher returned a failure with no reason at all');
  assert.ok(['connection_refused', 'fetch_error', 'timeout'].includes(result.failureReason!),
    `unexpected reason ${result.failureReason}`);
  // `blockedReason` means "we declined", which is a different thing and must stay clear.
  assert.equal(result.blockedReason, undefined);
});

test('a crawl that cannot reach the site records why, instead of looking like a no-op',
  async () => {
    resetFetchState();
    const result = await researchFirstParty('http://127.0.0.1:1/', 'Unreachable Co');

    assert.equal(result.pagesFetched.length, 0);
    /**
     * The regression. This used to be zero: the crawl only recorded a page when it had
     * declined to read it, so a transport failure fell through and left the result
     * indistinguishable from a crawl with nothing to do.
     */
    assert.ok(result.pagesBlocked.length >= 1,
      'an unreachable host left no trace in the crawl result');
    assert.ok(result.notes.some((note) => /could not reach/i.test(note)),
      'nothing in the notes says the site was unreachable');
    // And nothing about the company was invented from the failure.
    assert.deepEqual(result.people, []);
    assert.deepEqual(result.endpoints, []);
  });

test('an unreachable host stops the crawl rather than retrying every candidate path',
  async () => {
    resetFetchState();
    const result = await researchFirstParty('http://127.0.0.1:1/', 'Unreachable Co');
    // One failure answers the question for the whole host. Without the break this
    // retried every path in CANDIDATE_PATHS against a host it already knew was down.
    assert.ok(result.pagesBlocked.length <= 2,
      `retried an unreachable host ${result.pagesBlocked.length} times`);
  });

test('a reachable site still crawls normally', async () => {
  resetFetchState();
  let server: Server | undefined;
  try {
    server = createServer((request, response) => {
      if (request.url === '/robots.txt') { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body><a href="/about">About</a><p>Call 904-555-0100</p></body></html>');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const result = await researchFirstParty(origin, 'Reachable Co');
    assert.ok(result.pagesFetched.length >= 1, 'a reachable site was not read');
    // The failure path must not have fired for a site that answered.
    assert.equal(result.notes.some((note) => /could not reach/i.test(note)), false);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});
