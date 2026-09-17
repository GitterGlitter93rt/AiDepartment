import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase } from './helpers.js';
import { researchFirstParty, sourceAccessState } from '../src/resolver/adapters/firstParty.js';
import { resetFetchState } from '../src/resolver/fetcher.js';
import { researchExceptions } from '../src/api/waveCQueries.js';
import { planRemediation } from '../src/remediation/apply.js';

/**
 * A failed fetch is a fact about our crawler, not about the company.
 *
 * Michael opened three Accounts that Research Health was calling "Broken Website" and
 * found three live HVAC businesses. The audit found three separate defects behind that
 * one label:
 *
 *   energyair.com answered 200 with 634 KB of its own content, and the crawler threw the
 *   page away because the word "captcha" appears in its script manifest;
 *   airmotionshvac.com and airworthac.com answered 403, which the fetcher called
 *   "login_required" -- a WAF refusing a crawler is not a login wall;
 *   and the run recorded only "0 pages fetched", so nothing downstream could tell a
 *   refusal from a dead domain.
 *
 * These tests hold all three ends: what the fetcher concludes, what the run records, and
 * what the product is allowed to say about it.
 */

after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  resetFetchState();
});

const realFetch = globalThis.fetch;

/** A site that answers however the case needs, with robots always permitting. */
function serve(handler: (url: URL) => Response): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n',
        { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return handler(url);
  }) as typeof globalThis.fetch;
}

async function research(host: string): Promise<{
  state: string; reasons: string[]; pages: number;
}> {
  const result = await researchFirstParty(`https://${host}`, 'A Company');
  return {
    state: sourceAccessState(result, true),
    reasons: result.pagesBlocked.map((page) => page.reason),
    pages: result.pagesFetched.length,
  };
}

// ------------------------------------------------ 1-6: each failure keeps its own name

test('a TLS failure is unreachable research, not a broken website', async () => {
  serve(() => { throw new Error('write EPROTO ... SSL routines:tls_error'); });
  try {
    const outcome = await research('tls.invalid');
    assert.equal(outcome.state, 'UNREACHABLE');
    assert.ok(outcome.reasons.includes('tls_error'), outcome.reasons.join(','));
  } finally { globalThis.fetch = realFetch; }
});

test('a timeout is unreachable research, not a broken website', async () => {
  serve(() => { throw new Error('The operation was aborted due to timeout'); });
  try {
    const outcome = await research('slow.invalid');
    assert.equal(outcome.state, 'UNREACHABLE');
    assert.ok(outcome.reasons.includes('timeout'));
  } finally { globalThis.fetch = realFetch; }
});

test('a WAF refusing the crawler is a refusal, not a login wall and not a broken site',
  async () => {
    // The airmotionshvac.com and airworthac.com case, exactly: 403 with an HTML body.
    serve(() => new Response('<html><body>Access denied</body></html>',
      { status: 403, headers: { 'content-type': 'text/html' } }));
    try {
      const outcome = await research('waf.invalid');
      assert.equal(outcome.state, 'REFUSED');
      assert.ok(outcome.reasons.includes('access_denied'),
        `403 was recorded as ${outcome.reasons.join(',')}`);
      assert.equal(outcome.reasons.includes('login_required'), false,
        'a WAF refusal was recorded as a login wall');
    } finally { globalThis.fetch = realFetch; }
  });

test('a DNS failure is one failed attempt, not a dead domain', async () => {
  serve(() => { throw new Error('getaddrinfo ENOTFOUND nowhere.invalid'); });
  try {
    const outcome = await research('nowhere.invalid');
    assert.equal(outcome.state, 'UNREACHABLE');
    assert.ok(outcome.reasons.includes('dns_error'));
    // Nothing in the outcome claims the domain is gone. One attempt cannot say that.
    assert.equal(outcome.state === 'UNREACHABLE', true);
  } finally { globalThis.fetch = realFetch; }
});

test('a site that mentions a captcha in its own code is still read', async () => {
  // energyair.com: 200, real content, and a script manifest listing a captcha module.
  const page = '<html><head><title>Energy Air - Trusted HVAC</title>'
    + '<script>var modules=["appmonitoring","assetsloader","businesslogger","captcha",'
    + '"clickhandlerregistrar"];</script></head><body><h1>Energy Air</h1>'
    + `<p>${'Commercial AC services in Florida. '.repeat(400)}</p></body></html>`;
  serve(() => new Response(page, { status: 200, headers: { 'content-type': 'text/html' } }));
  try {
    const outcome = await research('energyair.invalid');
    assert.equal(outcome.state, 'READ', `a live site was recorded as ${outcome.state}`);
    assert.ok(outcome.pages >= 1);
  } finally { globalThis.fetch = realFetch; }
});

test('a real challenge page is still recognised', async () => {
  serve(() => new Response(
    '<html><head><title>Attention Required! | Cloudflare</title></head>'
    + '<body>Checking your browser before accessing the site. Please verify you are human.'
    + '</body></html>',
    { status: 503, headers: { 'content-type': 'text/html' } }));
  try {
    const outcome = await research('challenged.invalid');
    assert.equal(outcome.state, 'REFUSED');
    assert.ok(outcome.reasons.includes('anti_bot'));
  } finally { globalThis.fetch = realFetch; }
});

test('an HTTP error is an HTTP error, and a successful fetch raises no exception at all',
  async () => {
    serve(() => new Response('<html><body>not found</body></html>',
      { status: 404, headers: { 'content-type': 'text/html' } }));
    try {
      const outcome = await research('gone.invalid');
      assert.equal(outcome.state, 'HTTP_ERROR');
    } finally { globalThis.fetch = realFetch; }

    serve(() => new Response('<html><body><h1>A Company</h1>We fix air conditioners.</body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } }));
    try {
      const outcome = await research('fine.invalid');
      assert.equal(outcome.state, 'READ');
      assert.deepEqual(outcome.reasons, []);
    } finally { globalThis.fetch = realFetch; }
  });

// --------------------------------------- 7-8: what the product may say, and may not do

test('the exception says research failed, and never that the website is broken', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Energy Air', website: 'https://energyair.invalid', phone: '407-555-0101',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));
  await query(
    `insert into research_runs (account_id, trigger, status, started_at, completed_at,
                                adapter_results)
     values ($1, 'stale_evidence', 'partial', now() - interval '1 hour', now(),
             '{"pages_fetched":0,"pages_blocked":1,"source_state":"REFUSED",
               "blocked_pages":[{"url":"https://energyair.invalid/","reason":"access_denied"}]}'::jsonb)`,
    [accountId]);

  const exceptions = await researchExceptions();
  const row = exceptions.find((entry: any) => entry.account_id === accountId) as any;
  assert.ok(row, 'a run that read nothing produced no exception at all');
  assert.equal(row.exception_type, 'website_research_unavailable');
  assert.equal(/broken/i.test(row.exception_type), false);
  assert.equal(/broken/i.test(row.detail), false,
    `the detail still claims the website is broken: ${row.detail}`);
  assert.match(row.detail, /could not read/i);
  assert.match(row.detail, /refused our crawler/i);
  assert.match(row.detail, /not about the company/i);
});

test('a website we could not read never costs an Account its trade or its inventory',
  async () => {
    const { accountId } = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Air Worth Heating & Cooling', website: 'https://airworth.invalid',
      phone: '407-555-0102', verticalProfileId: 'hvac',
    }, { discoverySource: 'import' }));
    // The company was found by a provider listing, so its trade rests on that.
    await query(
      `insert into search_observations (provider, source_type, observed_name, result_type,
                                        retention_class, account_id, query, observed_at)
       values ('dataforseo','discovery','Air Worth Heating & Cooling','local_result',
               'transient',$1,'HVAC contractor 32810', now())`, [accountId]);
    await query(
      `insert into research_runs (account_id, trigger, status, started_at, completed_at,
                                  adapter_results)
       values ($1, 'stale_evidence', 'partial', now() - interval '1 hour', now(),
               '{"pages_fetched":0,"pages_blocked":1,"source_state":"REFUSED",
                 "blocked_pages":[{"url":"https://airworth.invalid/","reason":"access_denied"}]}'::jsonb)`,
      [accountId]);

    const plan = await planRemediation();
    const changes = plan.changes.filter((change) => change.accountId === accountId);
    assert.deepEqual(
      changes.map((change) => change.action).filter((action) =>
        action === 'SUPPRESS_NON_COMPANY' || action === 'CLEAR_UNSUPPORTED_VERTICAL'),
      [],
      'an Account was suppressed or lost its trade because our crawler was refused');
  });
