import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { pool, withTransaction, query } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { enqueueContactResearch } from '../src/workers/enqueue.js';
import { drainQueue } from '../src/workers/runner.js';
import { runContactResearch } from '../src/workers/contactResearch.js';
import { politeFetch, resetFetchState } from '../src/resolver/fetcher.js';
import { researchFirstParty } from '../src/resolver/adapters/firstParty.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * End-to-end contact research against a local fixture site.
 * No external network is touched: the fixture server stands in for a prospect's
 * website so the crawl, the robots rules and the walls are all exercised for real.
 */

let server: Server;
let origin: string;

/** A small business site with a team page, a main line, and one published direct line. */
const PAGES: Record<string, { status?: number; type?: string; body: string }> = {
  '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /private/\nCrawl-delay: 0\n' },
  '/': {
    body: `<html><head>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"LocalBusiness","name":"Northgate Air",
       "telephone":"+1-904-555-0100","email":"info@northgate.example.com"}
      </script></head><body>
      <nav><a href="/about">About Us</a><a href="/contact">Contact</a>
           <a href="/private/team">Our Team</a></nav>
      <h1>Northgate Air &amp; Heating</h1>
      <a href="tel:+19045550100">904-555-0100</a>
      </body></html>`,
  },
  '/about': {
    body: `<html><body>
      <div class="team">
        <div><h3>Dana Fielder</h3><p>Director of Operations</p></div>
        <div><h3>Riley Marsh</h3><p>Owner</p></div>
      </div>
      <p>Northgate Air was founded by Riley Marsh in 2004.</p>
      <p>Call Dana Fielder directly at 904-555-0188.</p>
      </body></html>`,
  },
  '/contact': {
    body: `<html><body>
      <a href="tel:+19045550100">Main office: 904-555-0100</a>
      <a href="mailto:info@northgate.example.com">info@northgate.example.com</a>
      </body></html>`,
  },
  // A page the crawler genuinely wants, which robots.txt forbids.
  '/private/team': { body: '<html><body><h3>Hidden Person</h3><p>Secret Title</p></body></html>' },
};

before(async () => {
  await resetDatabase();
  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]!;
    const page = PAGES[path];
    if (!page) { response.writeHead(404).end('not found'); return; }
    response.writeHead(page.status ?? 200, { 'content-type': page.type ?? 'text/html' });
    response.end(page.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

beforeEach(async () => { await resetDatabase(); resetFetchState(); });

async function seedAccount(domain: string): Promise<string> {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(
      client,
      { canonicalName: 'Northgate Air & Heating', website: domain, city: 'Jacksonville', state: 'FL' },
      { discoverySource: 'test' },
    ),
  );
  await query(
    `insert into opportunity_hypotheses (account_id, category, hypothesis_text, confidence, priority)
     values ($1, 'after_hours', 'Paid emergency demand may arrive outside staffed hours.', 'unknown', 10)`,
    [accountId],
  );
  return accountId;
}

test('robots.txt disallow is honoured', async () => {
  const allowed = await politeFetch(`${origin}/about`);
  assert.equal(allowed.ok, true);

  const disallowed = await politeFetch(`${origin}/private/team`);
  assert.equal(disallowed.ok, false);
  assert.equal(disallowed.blockedReason, 'robots_disallow');
  assert.equal(disallowed.body, '', 'a disallowed page is not read at all');
});

test('the crawl finds team pages and never reads a disallowed one', async () => {
  const result = await researchFirstParty(origin);
  assert.ok(result.pagesFetched.length >= 2, 'the home page and at least one linked page were read');
  assert.equal(
    result.pagesFetched.some((url) => url.includes('/private/')), false,
    'the disallowed path was never fetched',
  );
  assert.ok(result.pagesBlocked.some((page) => page.reason === 'robots_disallow'));

  const names = result.people.map((person) => person.personName);
  assert.ok(names.includes('Dana Fielder'));
  assert.ok(names.includes('Riley Marsh'));
  // The secret title behind the disallowed page must not appear.
  assert.equal(result.people.some((p) => p.rawTitle === 'Secret Title'), false);
});

test('a login wall stops the crawl instead of being worked around', async () => {
  const walled = createServer((_request, response) => {
    response.writeHead(403, { 'content-type': 'text/html' });
    response.end('<html><body>Access denied</body></html>');
  });
  await new Promise<void>((resolve) => walled.listen(0, '127.0.0.1', resolve));
  const walledOrigin = `http://127.0.0.1:${(walled.address() as AddressInfo).port}`;

  try {
    const response = await politeFetch(`${walledOrigin}/`);
    assert.equal(response.ok, false);
    assert.equal(response.blockedReason, 'login_required');

    const result = await researchFirstParty(walledOrigin);
    assert.equal(result.pagesFetched.length, 0);
    assert.ok(result.notes.some((note) => /login required/i.test(note)));
  } finally {
    await new Promise<void>((resolve) => walled.close(() => resolve()));
  }
});

test('an anti-bot interstitial is treated as a wall, not a page', async () => {
  const bot = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body>Checking your browser before accessing… __cf_chl</body></html>');
  });
  await new Promise<void>((resolve) => bot.listen(0, '127.0.0.1', resolve));
  const botOrigin = `http://127.0.0.1:${(bot.address() as AddressInfo).port}`;
  try {
    const response = await politeFetch(`${botOrigin}/`);
    assert.equal(response.blockedReason, 'anti_bot');
    assert.equal(response.body, '');
  } finally {
    await new Promise<void>((resolve) => bot.close(() => resolve()));
  }
});

test('contact research resolves a named operations contact and a main-line route', async () => {
  const accountId = await seedAccount(origin);
  const outcome = await runContactResearch(accountId);

  // The hypothesis is after_hours, so operations outranks the owner.
  assert.equal(outcome.primaryPerson, 'Dana Fielder');
  assert.equal(outcome.status, 'NAMED_DIRECT_READY', 'the site publishes her direct line explicitly');
  assert.ok(outcome.pagesFetched >= 2);

  const contacts = await query<{
    full_name: string; role_category: string; role_confidence: string; decision_maker_priority: number;
  }>(
    `select full_name, role_category, role_confidence, decision_maker_priority
       from contacts where account_id = $1 and status = 'ACTIVE'
      order by decision_maker_priority`,
    [accountId],
  );
  assert.equal(contacts.rows[0]!.full_name, 'Dana Fielder');
  assert.equal(contacts.rows[0]!.role_category, 'operations');
  // One source class supports her, so LIKELY is the honest answer. CONFIRMED would
  // require corroboration from a second independent source.
  assert.equal(contacts.rows[0]!.role_confidence, 'LIKELY_CURRENT_ROLE');
  assert.ok(contacts.rows.some((row) => row.full_name === 'Riley Marsh'), 'the owner is kept as an alternate');

  const endpoints = await query<{
    display_value: string; endpoint_role: string; relationship_to_person: string;
    quality_state: string; contact_id: string | null;
  }>(
    `select display_value, endpoint_role, relationship_to_person, quality_state, contact_id
       from contact_endpoints where account_id = $1 order by endpoint_role`,
    [accountId],
  );

  const direct = endpoints.rows.find((e) => e.endpoint_role === 'DIRECT_BUSINESS_LINE');
  assert.ok(direct, 'the explicitly published direct line is stored as one');
  assert.equal(direct!.relationship_to_person, 'DIRECT_CONFIRMED');
  assert.ok(direct!.contact_id, 'and is attached to the person');

  const main = endpoints.rows.find((e) => e.endpoint_role === 'MAIN_BUSINESS_LINE');
  assert.ok(main);
  assert.equal(main!.relationship_to_person, 'COMPANY_ROUTE');
  assert.equal(main!.contact_id, null, 'a main line is never attached to a person');

  const generalEmail = endpoints.rows.find((e) => e.endpoint_role === 'GENERAL_BUSINESS_EMAIL');
  assert.ok(generalEmail, 'info@ is stored as a general mailbox');
  assert.equal(generalEmail!.contact_id, null);
});

test('research records which stages ran and which were deliberately skipped', async () => {
  const accountId = await seedAccount(origin);
  const outcome = await runContactResearch(accountId);

  assert.ok(outcome.stagesRun.includes('A_company_first_party'));
  const skipped = new Map(outcome.stagesSkipped.map((s) => [s.stage, s.reason]));
  assert.match(skipped.get('B_public_company_registry') ?? '', /governance/i);
  assert.match(skipped.get('H_paid_enrichment') ?? '', /PUBLIC_ONLY/);

  const runs = await query<{ status: string; adapter_results: any }>(
    'select status, adapter_results from research_runs where account_id = $1', [accountId],
  );
  assert.equal(runs.rows[0]!.status, 'completed');
  assert.ok(Array.isArray(runs.rows[0]!.adapter_results.stages_skipped));
});

test('an account with no website still resolves to an honest role route', async () => {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(
      client,
      { canonicalName: 'Sable Run Roofing', phone: '904-555-0303', city: 'St. Augustine', state: 'FL' },
      { discoverySource: 'test' },
    ),
  );
  await query(
    `insert into opportunity_hypotheses (account_id, category, hypothesis_text, confidence, priority)
     values ($1, 'unsold_estimate', 'Estimate follow-up may be inconsistent.', 'unknown', 10)`,
    [accountId],
  );

  const outcome = await runContactResearch(accountId);
  assert.equal(outcome.primaryPerson, null, 'no person is invented');
  assert.ok(outcome.stagesSkipped.some((s) => s.stage === 'A_company_first_party'));

  const contacts = await query<{ is_role_placeholder: boolean; role_category: string }>(
    `select is_role_placeholder, role_category from contacts where account_id = $1`, [accountId],
  );
  assert.equal(contacts.rows[0]!.is_role_placeholder, true);
  // unsold_estimate routes to sales leadership first.
  assert.equal(contacts.rows[0]!.role_category, 'sales');
});

test('the job queue runs contact research and is idempotent', async () => {
  const rep = await makeUser('Rep A');
  const accountId = await seedAccount(origin);

  const first = await enqueueContactResearch(accountId, rep.userId);
  const second = await enqueueContactResearch(accountId, rep.userId);
  assert.equal(first.created, true);
  assert.equal(second.created, false, 'a repeated request does not queue a second job');
  assert.equal(first.jobId, second.jobId);

  const processed = await drainQueue();
  assert.equal(processed, 1);

  const jobs = await query<{ status: string; progress: any }>(
    'select status, progress from jobs where job_id = $1', [first.jobId],
  );
  assert.equal(jobs.rows[0]!.status, 'SUCCEEDED');
  assert.equal(jobs.rows[0]!.progress.primaryPerson, 'Dana Fielder');

  // Once complete, the same request may legitimately be made again.
  const third = await enqueueContactResearch(accountId, rep.userId);
  assert.equal(third.created, true);
});

test('a failing job is retried with backoff, then marked failed', async () => {
  const rep = await makeUser('Rep A');
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, idempotency_key, payload, requested_by, max_attempts)
     values ('contact_research', 'missing-account', '{"account_id":"00000000-0000-0000-0000-000000000000"}', $1, 2)
     returning job_id`,
    [rep.userId],
  );
  const jobId = rows[0]!.job_id;

  await drainQueue();
  let state = await query<{ status: string; attempts: number; last_error: string | null }>(
    'select status, attempts, last_error from jobs where job_id = $1', [jobId],
  );
  assert.equal(state.rows[0]!.status, 'QUEUED', 'first failure is retried');
  assert.match(state.rows[0]!.last_error ?? '', /not found/);

  // The backoff pushes run_after into the future; clear it to exercise the last attempt.
  await query('update jobs set run_after = now() where job_id = $1', [jobId]);
  await drainQueue();
  state = await query<{ status: string; attempts: number; last_error: string | null }>(
    'select status, attempts, last_error from jobs where job_id = $1', [jobId],
  );
  assert.equal(state.rows[0]!.status, 'FAILED', 'attempts are exhausted');
  assert.equal(state.rows[0]!.attempts, 2);
});

test('a gatekeeper correction retires the stale contact on the next research run', async () => {
  const accountId = await seedAccount(origin);
  await runContactResearch(accountId);

  // A gatekeeper says Dana has left and Riley now handles it.
  await query(
    `insert into prospect_statements (account_id, category, statement_text, source_class, confidence)
     values ($1, 'decision_maker', 'Dana left last month; talk to Riley.', 'gatekeeper_supplied', 'confirmed')`,
    [accountId],
  );
  await query(
    `update contacts set status = 'LEFT_COMPANY', currentness = 'STALE',
                         role_confidence = 'HISTORICAL_ROLE'
      where account_id = $1 and full_name = 'Dana Fielder'`,
    [accountId],
  );

  // Re-crawling the unchanged site must not resurrect her.
  await runContactResearch(accountId);
  const contacts = await query<{ full_name: string; status: string }>(
    `select full_name, status from contacts where account_id = $1 order by full_name`, [accountId],
  );
  const dana = contacts.rows.find((row) => row.full_name === 'Dana Fielder')!;
  assert.equal(dana.status, 'LEFT_COMPANY', 'a re-crawl does not undo a gatekeeper correction');
});
