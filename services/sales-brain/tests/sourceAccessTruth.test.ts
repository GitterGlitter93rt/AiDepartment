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
import { applyForAccount, planRemediation } from '../src/remediation/apply.js';

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

test('a challenge that arrives as a 202 redirect is a refusal, not an empty page', () => {
  // airworthac.com: the apex answers 403 and the www host answers 202 with 167 bytes --
  // a meta refresh to /.well-known/sgcaptcha/. Status says yes and there is no site in
  // it, so without this the run records a successful read of nothing.
  serve(() => new Response(
    '<html><head><link rel="icon" href="data:;">'
    + '<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F&y=ipc:1.2.3.4">'
    + '</meta></head></html>',
    { status: 202, headers: { 'content-type': 'text/html' } }));
  return research('challenged-202.invalid').then((outcome) => {
    assert.equal(outcome.state, 'REFUSED',
      `a captcha interstitial was recorded as ${outcome.state}`);
    assert.ok(outcome.reasons.includes('anti_bot'));
    assert.equal(outcome.pages, 0);
  }).finally(() => { globalThis.fetch = realFetch; });
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

// ------------------ the hard guard: five things a failed fetch may never cause

test('a site we could not read may never cause any of the five negative outcomes',
  async () => {
    // One Account that would otherwise trip every instrument at once: a page-copy name,
    // a trade held up only by an organic result, a legacy status, and a stale endpoint
    // role. The only thing standing between it and all of them is that our crawler was
    // refused -- which is exactly the case Michael found live.
    const { accountId } = await withTransaction((client) => upsertAccount(client, {
      canonicalName: '10 Best HVAC Companies in Miami, FL - Air Motions HVAC',
      website: 'https://airmotions.invalid', phone: '407-555-0303',
      verticalProfileId: 'hvac',
    }, { discoverySource: 'market_miner:dataforseo' }));
    await query(`update accounts set entity_status = 'legacy_unverified' where account_id = $1`,
      [accountId]);
    await query(
      `insert into search_observations (provider, source_type, observed_name, result_type,
                                        retention_class, account_id, query, observed_at)
       values ('dataforseo','discovery','Air Motions HVAC','organic','transient',$1,
               'HVAC contractor 33133', now())`, [accountId]);
    await query(
      `insert into contact_endpoints (account_id, endpoint_type, normalized_value,
                                      display_value, endpoint_role)
       values ($1, 'EMAIL', 'info@airmotions.invalid', 'info@airmotions.invalid',
               'DIRECT_PERSON_EMAIL')`, [accountId]);
    await query(
      `insert into research_runs (account_id, trigger, status, started_at, completed_at,
                                  adapter_results)
       values ($1, 'stale_evidence', 'partial', now() - interval '1 hour', now(),
               '{"pages_fetched":0,"pages_blocked":1,"source_state":"REFUSED",
                 "blocked_pages":[{"url":"https://airmotions.invalid/","reason":"access_denied"}]}'::jsonb)`,
      [accountId]);

    const plan = await planRemediation();
    const planned = plan.changes.filter((change) => change.accountId === accountId);
    assert.deepEqual(planned, [],
      `a refused fetch produced ${planned.map((c) => c.action).join(', ')}`);

    // And it is in review with the reason, rather than silently dropped.
    const reviewed = plan.review.filter((entry) => entry.accountId === accountId);
    assert.ok(reviewed.length > 0, 'the Account vanished instead of going to review');
    assert.ok(reviewed.every((entry) => /not evidence against a company/.test(entry.why)));

    // Even handed every change directly, the transaction refuses all five.
    const forced = await applyForAccount(accountId, [
      { accountId, companyName: 'x', action: 'SUPPRESS_NON_COMPANY', code: 'NON_COMPANY_ENTITY',
        reason: 'forced', before: {}, after: {} },
      { accountId, companyName: 'x', action: 'CLEAR_UNSUPPORTED_VERTICAL',
        code: 'VERTICAL_FROM_QUERY_ONLY', reason: 'forced', before: {}, after: {} },
      { accountId, companyName: 'x', action: 'TRIM_PAGE_COPY_NAME',
        code: 'CANONICAL_NAME_IS_PAGE_COPY', reason: 'forced',
        before: {}, after: { canonicalName: 'Air Motions HVAC' } },
      { accountId, companyName: 'x', action: 'RECLASSIFY_ENDPOINT_ROLE',
        code: 'ENDPOINT_ROLE_PREDATES_RULE', reason: 'forced', before: {}, after: {} },
      { accountId, companyName: 'x', action: 'VERIFY_FROM_SITE_IDENTITY',
        code: 'LEGACY_UNVERIFIED', reason: 'forced', before: {}, after: {} },
    ]);
    assert.equal(forced.applied.length, 0, 'the transaction applied a change anyway');
    assert.equal(forced.skipped.length, 5);

    const { rows } = await query<{
      name: string; vertical: string | null; suppressed: boolean; status: string; role: string;
    }>(
      `select a.canonical_name as name, a.primary_vertical_profile_id as vertical,
              a.is_suppressed as suppressed, a.entity_status as status,
              (select endpoint_role from contact_endpoints where account_id = a.account_id limit 1) as role
         from accounts a where a.account_id = $1`, [accountId]);
    assert.equal(rows[0]!.name, '10 Best HVAC Companies in Miami, FL - Air Motions HVAC');
    assert.equal(rows[0]!.vertical, 'hvac');
    assert.equal(rows[0]!.suppressed, false);
    assert.equal(rows[0]!.status, 'legacy_unverified');
    assert.equal(rows[0]!.role, 'DIRECT_PERSON_EMAIL');
  });

test('a run that read nothing and never said why is treated as unreadable, not as nothing',
  async () => {
    // Every one of production's 94 such runs predates the source state. Not knowing why
    // nothing was read has to behave like a refusal, never like an empty site.
    const { accountId } = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Top 10 Roofers in Somewhere, FL', website: 'https://legacy.invalid',
      phone: '407-555-0404', verticalProfileId: 'roofing',
    }, { discoverySource: 'market_miner:dataforseo' }));
    await query(
      `insert into research_runs (account_id, trigger, status, started_at, completed_at,
                                  adapter_results)
       values ($1, 'newly_discovered', 'partial', now() - interval '2 hours', now(),
               '{"pages_fetched":0,"pages_blocked":0}'::jsonb)`, [accountId]);

    const plan = await planRemediation();
    assert.deepEqual(plan.changes.filter((change) => change.accountId === accountId), []);
    assert.ok(plan.review.some((entry) => entry.accountId === accountId
      && /did not record why/.test(entry.why)));
  });

test('an Account with no website at all is not shielded by the guard', async () => {
  // Nothing failed here. An article headline with no domain has no site to read, and
  // that absence is a fact about the record rather than a failure of ours.
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'An 82-year-old Vietnam veteran in St. Augustine says he\'s ...',
    phone: '904-555-0505',
  }, { discoverySource: 'market_miner:dataforseo' }));

  const plan = await planRemediation();
  assert.ok(
    plan.changes.some((change) => change.accountId === accountId
      && change.action === 'SUPPRESS_NON_COMPANY'),
    'the guard shielded a record that never had a website to fail at');
});
