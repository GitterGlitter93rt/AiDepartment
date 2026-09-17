import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetFetchState } from '../src/resolver/fetcher.js';
import { urlVariants, crossDomainDestination, isTerminalForDomain } from '../src/resolver/recovery.js';
import {
  openCampaign, sweepWebsiteRecovery, RECOVERABLE_STATES,
} from '../src/workers/websiteRecovery.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/websiteRecovery.js';

/**
 * One failed fetch is not the end of research.
 *
 * V2 settled that a site we could not read is never evidence against a company, and then
 * left 53 Accounts unreadable for ever because research ran once and never again. These
 * tests pin the retry and, more importantly, its limits: it tries again, it never
 * circumvents, and an exhausted campaign still costs the company nothing.
 */

const realFetch = globalThis.fetch;
after(async () => { globalThis.fetch = realFetch; await pool.end(); });

beforeEach(async () => {
  await resetDatabase();
  resetFetchState();
  globalThis.fetch = realFetch;
  process.env['WEBSITE_RECOVERY_MAX_ATTEMPTS'] = '10';
});

/** Serves robots permissively and hands every other URL to the case's own handler. */
function serve(handler: (url: URL) => Response | Promise<Response>,
               robots = 'User-agent: *\nAllow: /\n'): void {
  globalThis.fetch = (async (input: unknown) => {
    let url = new URL(String(input));
    if (url.pathname === '/robots.txt') {
      return new Response(robots, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    // A stub has to follow redirects itself; the real fetch does it for us, and a test
    // that did not would be testing that a 301 is an error.
    let response = await handler(url);
    for (let hop = 0; hop < 5 && response.status >= 300 && response.status < 400; hop += 1) {
      const location = response.headers.get('location');
      if (!location) break;
      url = new URL(location, url);
      response = await handler(url);
    }
    return Object.defineProperty(response, 'url', { value: url.toString() });
  }) as typeof globalThis.fetch;
}

const page = (body = '<html><body><h1>Cool Air</h1><p>We fix air conditioners in Tampa.</p></body></html>') =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

async function account(domain: string): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Cool Air', website: `https://${domain}`, phone: '813-555-0100',
  }, { discoverySource: 'import' }));
  return accountId;
}

async function campaignOf(accountId: string) {
  const { rows } = await query<{
    campaign_id: string; state: string; attempts_made: number;
    recovered_url: string | null; recovered_on_attempt: number | null;
    candidate_domain: string | null; next_attempt_at: string | null;
  }>(`select campaign_id, state, attempts_made, recovered_url, recovered_on_attempt,
             candidate_domain, next_attempt_at
        from website_recovery_campaigns where account_id = $1
       order by started_at desc limit 1`, [accountId]);
  return rows[0];
}

/** Runs every recovery job that is due right now. */
async function runDueJobs(max = 6): Promise<number> {
  return drainQueue(max);
}

/* --------------------------------------------------------------- the variant set --- */

test('the candidate hosts are the finite set, deduplicated', () => {
  const variants = urlVariants('https://www.example.com');
  const urls = variants.map((v) => v.url);
  // Stored is already https://www, so four distinct requests rather than five.
  assert.equal(new Set(urls).size, urls.length, 'no URL is requested twice');
  assert.ok(urls.some((u) => u === 'https://example.com/' || u === 'https://example.com'));
  assert.ok(urls.some((u) => u.startsWith('http://example.com')));
  assert.ok(urls.some((u) => u.startsWith('http://www.example.com')));
  assert.equal(variants[0]!.variant, 'STORED', 'what we were told comes first');

  // HTTPS is offered before HTTP, so a working secure host is never passed over.
  const firstHttp = urls.findIndex((u) => u.startsWith('http://'));
  const lastHttps = urls.map((u) => u.startsWith('https://')).lastIndexOf(true);
  assert.ok(lastHttps < firstHttp, 'every https candidate precedes every http one');

  assert.deepEqual(urlVariants(null), []);
  assert.deepEqual(urlVariants('not a url at all /'), []);
});

/* ------------------------------------------------------------------- recovering --- */

test('https fails and http succeeds: the site is http-only, not broken', async () => {
  const id = await account('httponly.invalid');
  serve((url) => {
    if (url.protocol === 'https:') throw Object.assign(new Error('bad cert'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    return page();
  });

  await openCampaign({ accountId: id, url: 'https://httponly.invalid', sourceState: 'UNREACHABLE' });
  await runDueJobs();

  const campaign = await campaignOf(id);
  assert.equal(campaign?.state, 'RECOVERED');
  assert.match(campaign!.recovered_url!, /^http:\/\//);
  assert.equal(campaign?.recovered_on_attempt, 1);

  // And the TLS failure is recorded rather than smoothed over: "https does not work
  // here" is a fact about the company's hosting that a rep may need.
  const { rows } = await query<{ variant: string; tls_result: string | null; source_state: string }>(
    `select variant, tls_result, source_state from website_recovery_attempts
      where account_id = $1 order by attempt_id`, [id]);
  assert.ok(rows.some((r) => r.tls_result === 'HANDSHAKE_FAILED'));
  assert.ok(rows.some((r) => r.source_state === 'READ' && r.variant.startsWith('HTTP_')));
});

test('apex fails and www succeeds', async () => {
  const id = await account('apexdown.invalid');
  serve((url) => {
    if (!url.hostname.startsWith('www.')) {
      throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
    }
    return page();
  });

  await openCampaign({ accountId: id, url: 'https://apexdown.invalid', sourceState: 'UNREACHABLE' });
  await runDueJobs();

  const campaign = await campaignOf(id);
  assert.equal(campaign?.state, 'RECOVERED');
  assert.match(campaign!.recovered_url!, /www\.apexdown\.invalid/);

  // Air Worth is why this case exists: the apex challenged and www answered 202.
  const { rows } = await query<{ dns_result: string | null }>(
    `select dns_result from website_recovery_attempts where account_id = $1 and source_state <> 'READ'`,
    [id]);
  assert.ok(rows.some((r) => r.dns_result === 'NXDOMAIN_OR_SERVFAIL'));
});

test('www fails and apex succeeds', async () => {
  const id = await account('wwwdown.invalid');
  serve((url) => {
    if (url.hostname.startsWith('www.')) {
      throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
    }
    return page();
  });
  await openCampaign({ accountId: id, url: 'https://www.wwwdown.invalid', sourceState: 'UNREACHABLE' });
  await runDueJobs();
  const campaign = await campaignOf(id);
  assert.equal(campaign?.state, 'RECOVERED');
  assert.match(campaign!.recovered_url!, /^https:\/\/wwwdown\.invalid/);
});

test('a timeout on one attempt and a read on the next', async () => {
  const id = await account('slowthenup.invalid');
  let attempt = 0;
  serve(() => {
    attempt += 1;
    if (attempt <= 4) throw Object.assign(new Error('timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    return page();
  });

  await openCampaign({ accountId: id, url: 'https://slowthenup.invalid', sourceState: 'TIMEOUT' });
  await runDueJobs();
  assert.equal((await campaignOf(id))?.state, 'ACTIVE', 'still trying after one bad hour');

  // The next attempt is scheduled in the future, so it is a row rather than a timer.
  const scheduled = await query<{ run_after: Date; n: string }>(
    `select run_after, count(*) over ()::text as n from jobs
      where job_type = 'website_recovery' and status = 'QUEUED'`);
  assert.equal(Number(scheduled.rows[0]?.n ?? 0), 1);
  assert.ok(scheduled.rows[0]!.run_after.getTime() > Date.now() + 30 * 60_000,
    'the retry is about an hour away');

  // Bring it forward, as an hour passing would.
  await query(`update jobs set run_after = now() where job_type = 'website_recovery'`);
  await runDueJobs();

  const campaign = await campaignOf(id);
  assert.equal(campaign?.state, 'RECOVERED');
  assert.equal(campaign?.recovered_on_attempt, 2);
});

test('a success cancels the attempts that were already scheduled', async () => {
  const id = await account('recovers.invalid');
  let calls = 0;
  serve(() => { calls += 1; return page(); });

  await openCampaign({ accountId: id, url: 'https://recovers.invalid', sourceState: 'REFUSED' });
  await runDueJobs();
  assert.equal((await campaignOf(id))?.state, 'RECOVERED');

  const before = calls;
  // Any job still sitting in the queue must find the campaign closed and do nothing.
  await query(`update jobs set status = 'QUEUED', run_after = now(), leased_by = null
                where job_type = 'website_recovery'`);
  await runDueJobs();
  assert.equal(calls, before, 'no further requests were made to a site we can already read');
  assert.equal((await campaignOf(id))?.state, 'RECOVERED');
});

/* --------------------------------------------------------------- what it refuses --- */

test('robots.txt is never bypassed, and ends the campaign rather than being retried', async () => {
  const id = await account('noindex.invalid');
  let pageRequests = 0;
  serve((url) => {
    if (url.pathname !== '/robots.txt') pageRequests += 1;
    return page();
  }, 'User-agent: *\nDisallow: /\n');

  await openCampaign({ accountId: id, url: 'https://noindex.invalid', sourceState: 'REFUSED' });
  await runDueJobs();

  const campaign = await campaignOf(id);
  assert.equal(campaign?.state, 'DISALLOWED');
  assert.equal(pageRequests, 0, 'the disallowed path was never requested');

  // No further attempt is scheduled: a disallow is an instruction, and an hourly crawl
  // of a blocked path would be a way of not taking it.
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from jobs where job_type = 'website_recovery' and status = 'QUEUED'`);
  assert.equal(Number(rows[0]!.n), 0);

  // And a campaign is never opened for a DISALLOWED source in the first place.
  assert.equal(await openCampaign({
    accountId: id, url: 'https://noindex.invalid', sourceState: 'DISALLOWED' }), null);
});

test('a 403 is retried as itself and never with a different identity', async () => {
  const id = await account('waf.invalid');
  const agents = new Set<string>();
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers ?? {});
    agents.add(headers.get('user-agent') ?? '(none)');
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }) as typeof globalThis.fetch;

  await openCampaign({ accountId: id, url: 'https://waf.invalid', sourceState: 'REFUSED' });
  await runDueJobs();
  await query(`update jobs set run_after = now() where job_type = 'website_recovery'`);
  await runDueJobs();

  assert.equal(agents.size, 1, 'the same crawler identity every time; a refusal is an answer');
  const campaign = await campaignOf(id);
  assert.equal(campaign?.state, 'ACTIVE', 'still trying, because a site may change');

  const { rows } = await query<{ source_state: string; http_status: number }>(
    `select source_state, http_status from website_recovery_attempts where account_id = $1`, [id]);
  assert.ok(rows.every((r) => r.source_state === 'REFUSED' && r.http_status === 403));
});

test('ten attempts end the campaign, and the Account loses nothing', async () => {
  process.env['WEBSITE_RECOVERY_MAX_ATTEMPTS'] = '3';
  const id = await account('never.invalid');
  serve(() => new Response('Forbidden', { status: 403 }));

  await openCampaign({ accountId: id, url: 'https://never.invalid', sourceState: 'REFUSED' });
  for (let i = 0; i < 5; i += 1) {
    await query(`update jobs set run_after = now() where job_type = 'website_recovery'`);
    await runDueJobs();
  }

  const campaign = await campaignOf(id);
  assert.equal(campaign?.state, 'EXHAUSTED');
  assert.equal(campaign?.attempts_made, 3);

  // The whole point. An exhausted campaign is a fact about our research.
  const { rows } = await query<{ is_suppressed: boolean; entity_status: string;
                                 primary_vertical_profile_id: string | null }>(
    `select is_suppressed, entity_status, primary_vertical_profile_id
       from accounts where account_id = $1`, [id]);
  assert.equal(rows[0]?.is_suppressed, false);
  assert.notEqual(rows[0]?.entity_status, 'rejected');

  const { rows: queued } = await query<{ n: string }>(
    `select count(*)::text as n from jobs where job_type = 'website_recovery' and status = 'QUEUED'`);
  assert.equal(Number(queued[0]!.n), 0, 'it does not retry for ever');
});

/* ------------------------------------------------------------------ what it holds --- */

test('a redirect to another domain is a candidate, never a rewrite', async () => {
  const id = await account('oldname.invalid');
  serve((url) => {
    if (url.hostname.includes('oldname')) {
      return new Response('', { status: 301, headers: { location: 'https://newname.invalid/' } });
    }
    return page();
  });

  await openCampaign({ accountId: id, url: 'https://oldname.invalid', sourceState: 'UNREACHABLE' });
  await runDueJobs();

  const campaign = await campaignOf(id);
  assert.equal(campaign?.state, 'RECOVERED');
  assert.equal(campaign?.candidate_domain, 'newname.invalid');

  // A company that moved, a parked domain and an acquisition all look like this.
  const { rows } = await query<{ canonical_domain: string }>(
    `select canonical_domain from accounts where account_id = $1`, [id]);
  assert.equal(rows[0]?.canonical_domain, 'oldname.invalid',
    "the Account's website is not changed by a redirect");

  // The redirect chain is kept, so the candidate can be judged later.
  const { rows: attempts } = await query<{ redirect_chain: string[] }>(
    `select redirect_chain from website_recovery_attempts
      where account_id = $1 and source_state = 'READ'`, [id]);
  assert.ok((attempts[0]?.redirect_chain ?? []).length >= 2);
});

test('a dead domain stops the retries and asks where the company went', async () => {
  const id = await account('gone.invalid');
  serve(() => new Response('Not found', { status: 404 }));

  await openCampaign({ accountId: id, url: 'https://gone.invalid', sourceState: 'HTTP_ERROR' });
  await runDueJobs();
  assert.equal((await campaignOf(id))?.state, 'ACTIVE', 'one 404 could be a deploy');

  await query(`update jobs set run_after = now() where job_type = 'website_recovery'`);
  await runDueJobs();

  assert.equal((await campaignOf(id))?.state, 'TERMINAL', 'two agree, so it is dead');
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from jobs where job_type = 'domain_resolution'`);
  assert.equal(Number(rows[0]!.n), 1, 'replacement-domain research was queued instead');

  assert.equal(isTerminalForDomain([
    { httpStatus: 404 } as never, { httpStatus: 410 } as never]), true);
  assert.equal(isTerminalForDomain([
    { httpStatus: 404 } as never, { httpStatus: 200 } as never]), false);
});

test('NO_WEBSITE is not retried, because there is no URL to retry', async () => {
  const id = await account('nowebsite.invalid');
  assert.equal(await openCampaign({
    accountId: id, url: null, sourceState: 'NO_WEBSITE' }), null);
  assert.equal(await openCampaign({
    accountId: id, url: 'https://x.invalid', sourceState: 'NO_WEBSITE' }), null,
    'NO_WEBSITE is not in the recoverable set whatever URL is passed');
  assert.equal(RECOVERABLE_STATES.has('NO_WEBSITE'), false);
});

/* ------------------------------------------------------------------- durability --- */

test('a campaign survives a restart, because it is a row and not a timer', async () => {
  const id = await account('restart.invalid');
  serve(() => new Response('Forbidden', { status: 403 }));
  await openCampaign({ accountId: id, url: 'https://restart.invalid', sourceState: 'REFUSED' });
  await runDueJobs();

  const before = await campaignOf(id);
  assert.equal(before?.state, 'ACTIVE');
  const nextAt = new Date(before!.next_attempt_at!).getTime();
  assert.ok(nextAt, 'the next attempt has a time');

  // Nothing in this process knows about the campaign any more; a deploy replaced it.
  const after = await campaignOf(id);
  assert.equal(new Date(after!.next_attempt_at!).getTime(), nextAt,
    'the schedule is unchanged by the restart');

  // And the sweep picks up a due campaign whose job was lost with the process.
  await query(`delete from jobs where job_type = 'website_recovery'`);
  await query(`update website_recovery_campaigns set next_attempt_at = now()
                where account_id = $1`, [id]);
  const swept = await sweepWebsiteRecovery();
  assert.equal(swept.requeued, 1, 'a stalled campaign is put back on the queue');
});

test('two workers cannot start or schedule the same campaign twice', async () => {
  const id = await account('once.invalid');
  const first = await openCampaign({ accountId: id, url: 'https://once.invalid', sourceState: 'REFUSED' });
  const second = await openCampaign({ accountId: id, url: 'https://once.invalid', sourceState: 'REFUSED' });

  assert.equal(first?.created, true);
  assert.equal(second?.created, false, 'the second caller joined the first');
  assert.equal(first?.campaignId, second?.campaignId);

  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from website_recovery_campaigns where account_id = $1`, [id]);
  assert.equal(Number(rows[0]!.n), 1);

  // And two sweeps racing produce one queued attempt between them.
  await Promise.all([sweepWebsiteRecovery(), sweepWebsiteRecovery()]);
  const { rows: jobs } = await query<{ n: string }>(
    `select count(*)::text as n from jobs
      where job_type = 'website_recovery' and status in ('QUEUED','RUNNING')`);
  assert.equal(Number(jobs[0]!.n), 1);
});

test('every probe is recorded, including the ones that failed before the one that worked', () => {
  // "apex failed and www worked" is the fact an operator needs; discarding the failures
  // would make a recovery look like the original URL had simply started working.
  assert.equal(crossDomainDestination('https://a.invalid',
    { sourceState: 'READ', finalUrl: 'https://b.invalid/' } as never), 'b.invalid');
  assert.equal(crossDomainDestination('https://a.invalid',
    { sourceState: 'READ', finalUrl: 'https://www.a.invalid/x' } as never), null);
  assert.equal(crossDomainDestination('https://a.invalid',
    { sourceState: 'REFUSED', finalUrl: 'https://b.invalid/' } as never), null);
});
