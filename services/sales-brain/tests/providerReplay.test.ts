import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';
import { renderAccountPage } from '../src/web/pages/account.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import { clearDiscoveryAdapters, availableDiscoveryAdapters } from '../src/workers/marketMiner.js';
import { registerConfiguredDiscoveryAdapters } from '../src/miner/registry.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';

/**
 * A provider response shaped like the real thing, replayed through the real wiring.
 * Authority: Issue #3 BX / AW.
 *
 * Every provider test so far builds the payload it wants to parse, which proves the
 * parser handles the parser's own idea of a response. DataForSEO does not send that.
 * It sends an envelope around a list of tasks around a list of results around a list
 * of items, half of them block types this product has no interest in, with fields
 * that are absent rather than null, extra fields nobody documented, and a two-step
 * submit-then-collect flow in the mode the config defaults to.
 *
 * And it is replayed through `registerConfiguredDiscoveryAdapters` and the global
 * fetch, not through a hand-constructed adapter with an injected transport -- the
 * defect that hid for weeks was construction without registration, and a test that
 * constructs its own adapter could never have seen it. This one goes through the
 * function the API and the worker both call, over the transport they both use.
 */

const CREDENTIALLED: NodeJS.ProcessEnv = {
  DATAFORSEO_LOGIN: 'replay@example.invalid',
  DATAFORSEO_PASSWORD: 'replay-secret',
  DATAFORSEO_ENABLED: 'true',
  DATAFORSEO_GOVERNANCE_REVIEWED: 'true',
  DATAFORSEO_POLL_INTERVAL_MS: '0',
  DATAFORSEO_MAX_POLL_ATTEMPTS: '3',
};

const SERP_READ_AT = '2026-09-05 09:12:41 +00:00';

/**
 * One task_get response, as DataForSEO actually returns it.
 *
 * Kept verbatim in shape: the envelope counters, the echoed request under `data`,
 * the block types mixed into a single `items` array, and the fields that simply are
 * not there rather than being null.
 */
function taskGetBody(): unknown {
  return {
    version: '0.1.20260801',
    status_code: 20000,
    status_message: 'Ok.',
    time: '0.4181 sec.',
    cost: 0.0006,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{
      id: '09051241-1535-0066-0000-8a1b2c3d4e5f',
      status_code: 20000,
      status_message: 'Ok.',
      time: '0.3120 sec.',
      cost: 0.0006,
      result_count: 1,
      path: ['v3', 'serp', 'google', 'organic', 'task_get', 'advanced'],
      data: {
        api: 'serp', function: 'task_get', se: 'google', se_type: 'organic',
        keyword: 'ac repair 32095', location_name: 'St. Augustine,Florida,United States',
        language_code: 'en', device: 'desktop', depth: 100,
      },
      result: [{
        keyword: 'ac repair 32095',
        type: 'organic',
        se_domain: 'google.com',
        location_code: 1015214,
        location_name: 'St. Augustine,Florida,United States',
        language_code: 'en',
        check_url: 'https://www.google.com/search?q=ac+repair+32095&num=100',
        datetime: SERP_READ_AT,
        spell: null,
        refinement_chips: null,
        item_types: ['paid', 'organic', 'local_pack', 'people_also_ask', 'related_searches'],
        se_results_count: 1840000,
        items_count: 8,
        items: [
          {
            type: 'paid',
            rank_group: 1, rank_absolute: 1, position: 'left',
            xpath: '/html[1]/body[1]/div[7]/div[1]/div[9]',
            domain: 'Coastalairfl.com',
            title: 'Same-Day AC Repair St. Augustine — 24/7 Emergency Service',
            description: 'Licensed HVAC techs. Flat-rate pricing. Book online in 60 seconds.',
            url: 'https://coastalairfl.com/ac-repair?gclid=abc123',
            breadcrumb: 'https://www.coastalairfl.com › ac-repair',
            // Fields the parser has never seen and must not choke on.
            highlighted: ['Same-Day'], extra: { ad_aclk: 'CjwKCAjw' },
            rectangle: { x: 180, y: 322, width: 652, height: 118 },
          },
          {
            // The same company, ranking organically as well. One candidate, not two,
            // and the paid row is the one worth keeping.
            type: 'organic',
            rank_group: 4, rank_absolute: 7, position: 'left',
            domain: 'coastalairfl.com',
            title: 'Coastal Air — HVAC Repair & Installation',
            description: 'Serving St. Johns County since 2009.',
            url: 'https://coastalairfl.com/',
            breadcrumb: 'https://www.coastalairfl.com',
            is_featured_snippet: false, is_malicious: false, is_web_story: false,
          },
          {
            type: 'local_services',
            rank_group: 1, rank_absolute: 2,
            title: 'Ancient City Heating & Air',
            phone: '+1 904-555-0177',
            url: 'https://www.google.com/localservices/prolist?src=abc',
            // No domain at all: identity has to come from the phone number.
            rating: { rating_type: 'Max5', value: 4.9, votes_count: 212 },
          },
          {
            type: 'local_pack',
            rank_group: 2, rank_absolute: 3,
            title: 'Matanzas Mechanical',
            domain: 'matanzasmech.com',
            phone: '+1 904-555-0198',
            url: 'https://matanzasmech.com/',
            address: '1200 US-1 S, St. Augustine, FL 32084',
          },
          {
            // A block with nothing to identify: no domain, no phone. It must not be
            // turned into a company somebody then tries to call.
            type: 'local_pack',
            rank_group: 3, rank_absolute: 4,
            title: 'HVAC Contractors Near You',
          },
          {
            type: 'people_also_ask',
            rank_group: 1, rank_absolute: 5,
            items: [{ type: 'people_also_ask_element', title: 'How much is an AC repair call?' }],
          },
          {
            type: 'shopping',
            rank_group: 1, rank_absolute: 6,
            title: 'Goodman 3-Ton Condenser', domain: 'hvacdirect.com',
            price: { current: 1899.0, currency: 'USD' },
          },
          {
            type: 'related_searches',
            rank_group: 1, rank_absolute: 8,
            items: ['ac repair near me', 'emergency hvac st augustine'],
            // No title, no domain, no phone -- every optional absent.
          },
        ],
      }],
    }],
  };
}

function taskPostBody(): unknown {
  return {
    version: '0.1.20260801', status_code: 20000, status_message: 'Ok.',
    time: '0.0821 sec.', cost: 0.0006, tasks_count: 1, tasks_error: 0,
    tasks: [{
      id: '09051241-1535-0066-0000-8a1b2c3d4e5f',
      status_code: 20100, status_message: 'Task Created.',
      time: '0.0068 sec.', cost: 0.0006, result_count: 0,
      path: ['v3', 'serp', 'google', 'organic', 'task_post'],
      data: { api: 'serp', function: 'task_post', se: 'google' },
      result: null,
    }],
  };
}

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

let calls: Call[] = [];
let realFetch: typeof globalThis.fetch;

/**
 * Replaces the global fetch rather than injecting a transport.
 *
 * The registry builds the adapter with no transport, so it uses the default closure
 * over `fetch`. Injecting past that would leave the line the production path
 * actually runs untested.
 */
function replayFetch(plan: { post?: unknown; get?: unknown; getStatus?: number } = {}): void {
  globalThis.fetch = (async (input: unknown, init: any = {}) => {
    const url = String(input);
    calls.push({
      url, method: init.method ?? 'GET', headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (url.includes('task_post')) {
      return new Response(JSON.stringify(plan.post ?? taskPostBody()),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(plan.get ?? taskGetBody()),
      { status: plan.getStatus ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
}

before(async () => { realFetch = globalThis.fetch; });
after(async () => { globalThis.fetch = realFetch; await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  calls = [];
  globalThis.fetch = realFetch;
});

/** A neighbour in the ZIP, so the provider gets a town rather than five digits. */
async function seedNeighbour(): Promise<void> {
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Existing Air of St Augustine',
    website: 'https://existingair.invalid', phone: '904-555-0100',
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'seed' }));
}

/**
 * The Accounts a miner run created. Provenance lives on the DISCOVERED activity,
 * not on a column of `accounts`.
 */
const discoveredNames = `select a.canonical_name from accounts a
   where exists (select 1 from activities act
                  where act.account_id = a.account_id
                    and act.source_system = 'market_miner:dataforseo')
   order by a.canonical_name`;

async function runMine(): Promise<Record<string, any>> {
  const ops = await makeUser(`Replay Ops ${Date.now()}${Math.random()}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId,
  });
  await drainQueue();
  const { rows } = await query<Record<string, any>>(
    'select status, outcome, outcome_reason, progress from jobs where job_id = $1', [job.jobId]);
  return rows[0]!;
}

// ------------------------------------------------------------- registry path -----

test('the registry, the credential and the global fetch produce a real search', async () => {
  await seedNeighbour();
  replayFetch();
  const registered = registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  assert.deepEqual(registered, ['dataforseo'],
    'the function both processes call did not make the provider available');
  assert.equal(availableDiscoveryAdapters().length, 1);

  const job = await runMine();
  assert.equal(job['outcome'], 'COMPLETED',
    `a fully configured provider did not search: ${job['outcome_reason']}`);
  assert.ok(calls.length >= 2, 'standard mode did not submit and then collect');
  assert.match(calls[0]!.url, /task_post/);
  assert.match(calls[1]!.url, /task_get\/advanced\//);
});

test('the request carries a place the provider knows and a term somebody searches', async () => {
  await seedNeighbour();
  replayFetch();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  await runMine();

  const posted = (calls[0]!.body as any[])[0];
  assert.equal(posted.location_name, 'St. Augustine,Florida,United States',
    'the provider was sent a bare ZIP, which it cannot geocode');
  assert.match(String(posted.keyword), /32095$/);
  assert.doesNotMatch(String(posted.keyword), /advertiser_first/,
    'the internal strategy name reached the provider as a search term');
  assert.equal(calls[0]!.headers['authorization']?.startsWith('Basic '), true);
  assert.doesNotMatch(calls[0]!.url, /replay-secret/, 'the credential leaked into the URL');
});

// --------------------------------------------------------- reading the response --

test('a real response yields companies and drops the blocks that are not companies', async () => {
  await seedNeighbour();
  replayFetch();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  const job = await runMine();

  // Coastal Air (paid + organic, one company), Ancient City (phone only),
  // Matanzas (domain). Not: the titled local_pack with nothing to identify it, the
  // people-also-ask block, the shopping ad, the related searches.
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(progress['discoveredNew'], 3, `discovered: ${JSON.stringify(progress)}`);

  const { rows } = await query<{ canonical_name: string }>(discoveredNames);
  const names = rows.map((row) => row.canonical_name);
  assert.equal(rows.length, 3);
  assert.ok(names.some((name) => /coastalairfl\.com|Coastal Air/i.test(name)),
    `a text ad's slogan became the company name: ${names.join(' | ')}`);
  assert.ok(!names.some((name) => /24\/7 Emergency Service/.test(name)),
    'the rep list shows a slogan where a company should be');
  assert.ok(names.some((name) => /Ancient City/i.test(name)));
  assert.ok(!names.some((name) => /HVAC Contractors Near You/i.test(name)),
    'a heading with no company behind it became an Account somebody could call');
  assert.ok(!names.some((name) => /Goodman/i.test(name)), 'a shopping ad became a prospect');
});

test('the stored result type is one the database accepts, for every block we keep', async () => {
  await seedNeighbour();
  replayFetch();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  await runMine();

  // The check constraint is the point: the adapter speaks PAID_SEARCH_TEXT and the
  // column accepts paid_search. Every real discovery would have thrown on row one.
  const { rows } = await query<{ result_type: string | null; n: number }>(
    `select result_type, count(*)::int as n from search_observations
      where source_type = 'discovery' group by result_type order by result_type`);
  const types = new Set(rows.map((row) => row.result_type));
  assert.ok(types.has('paid_search'), `stored types were ${[...types].join(', ')}`);
  assert.ok(types.has('local_service_ad'));
  assert.ok(types.has('local_result'));
});

test('the paid row wins over the same company’s organic row', async () => {
  await seedNeighbour();
  replayFetch();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  await runMine();

  const { rows } = await query<{ result_type: string; position: number; ad_headline: string }>(
    `select result_type, position, ad_headline from search_observations
      where observed_domain like '%coastalairfl%'`);
  assert.equal(rows.length, 1, 'one company appeared twice in the inventory');
  assert.equal(rows[0]!.result_type, 'paid_search',
    'the organic row displaced the paid one, losing the ad evidence');
  assert.equal(rows[0]!.position, 1);
});

test('every company in one search stays a separate company', async () => {
  // The collapse: account resolution matches on provider identity before it looks at
  // domain or phone, and the adapter used to fall back to the *task* id when a row
  // carried no id of its own -- which is every real organic and paid SERP row. All
  // three businesses here would resolve to whichever was ingested first, and the run
  // would report the other two as "already in inventory". A twenty-result search
  // would have produced one prospect.
  await seedNeighbour();
  replayFetch();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  const job = await runMine();

  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(progress['matchedExisting'], 0,
    'businesses this search had never seen were resolved onto each other');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from source_identities where provider = 'dataforseo'`);
  assert.equal(rows[0]!.n, 0,
    'a search id was stored as if it identified a business, and it will keep matching');
});

// ------------------------------------------------------- provenance that lands ---

test('what the ad said, where it sat and what was searched are all kept', async () => {
  await seedNeighbour();
  replayFetch();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  await runMine();

  const { rows } = await query<{
    query: string | null; position: number | null; ad_headline: string | null;
    advertised_service: string | null; landing_url: string | null;
    provider_native_id: string | null; observed_at: Date;
  }>(`select query, position, ad_headline, advertised_service, landing_url,
             provider_native_id, observed_at
        from search_observations where result_type = 'paid_search'`);
  const paid = rows[0]!;

  assert.match(String(paid.ad_headline), /Same-Day AC Repair/,
    'the one line a rep can open the call with was dropped between the adapter and the row');
  assert.match(String(paid.query), /ac repair/i);
  assert.equal(paid.position, 1);
  assert.match(String(paid.landing_url), /coastalairfl\.com\/ac-repair/);
  // Null here is the correct answer: these SERP blocks carry no id for the business.
  assert.equal(paid.provider_native_id, null);
});

test('a SERP read yesterday is not recorded as read now', async () => {
  await seedNeighbour();
  replayFetch();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  await runMine();

  const { rows } = await query<{ observed_at: Date }>(
    `select observed_at from search_observations where result_type = 'paid_search'`);
  assert.equal(rows[0]!.observed_at.toISOString(), new Date(SERP_READ_AT).toISOString(),
    'the provider told us when it read the page and we stamped the row with collection '
    + 'time instead, which makes an old sighting look like today’s');
});

test('a rep can see how we found the company, and quote it', async () => {
  await seedNeighbour();
  replayFetch();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  await runMine();

  const { rows } = await query<{ account_id: string }>(
    `select account_id from accounts where canonical_domain = 'coastalairfl.com'`);
  const manager = await makeUser(`Replay Manager ${Date.now()}`, 'SALES_MANAGER');
  const detail = await getAccountDetail(rows[0]!.account_id,
    { userId: manager.userId, role: 'SALES_MANAGER' });

  assert.equal(detail!.discoveries.length, 1);
  assert.match(String(detail!.discoveries[0]!.ad_headline), /Same-Day AC Repair/);

  const page = renderAccountPage(detail!, { ...manager, role: 'SALES_MANAGER' } as any,
    {} as any, undefined);
  assert.match(page, /How we found them/);
  assert.match(page, /Same-Day AC Repair/, 'the page does not show the ad we found them by');
  assert.match(page, /Paid ad/, 'the page shows our internal vocabulary instead of words');
});

// ------------------------------------------------------------- realistic faults --

test('a task still in the provider’s queue is pending, not an empty market', async () => {
  await seedNeighbour();
  replayFetch({ get: {
    version: '0.1.20260801', status_code: 20000, status_message: 'Ok.', cost: 0,
    tasks_count: 1, tasks_error: 0,
    tasks: [{
      id: '09051241-1535-0066-0000-8a1b2c3d4e5f',
      status_code: 40602, status_message: 'Task In Queue.', cost: 0, result_count: 0,
      path: ['v3', 'serp', 'google', 'organic', 'task_get', 'advanced'], result: null,
    }],
  } });
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  const job = await runMine();

  assert.notEqual(job['outcome'], 'ZERO_RESULTS',
    'a search the provider has not finished was reported as a market with nobody in it');
  assert.match(String(job['outcome_reason']), /not finished|collected/i);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from provider_tasks where status <> 'COLLECTED'`);
  assert.equal(rows[0]!.n, 1, 'a task we paid for was not recorded for later collection');
});

test('a provider error inside a 200 response is not read as a result', async () => {
  await seedNeighbour();
  // DataForSEO answers HTTP 200 and puts the failure in the envelope.
  replayFetch({ get: {
    version: '0.1.20260801', status_code: 40501, status_message: 'Invalid Field: location_name.',
    cost: 0, tasks_count: 1, tasks_error: 1,
    tasks: [{
      id: '09051241-1535-0066-0000-8a1b2c3d4e5f',
      status_code: 40501, status_message: 'Invalid Field: location_name.',
      cost: 0, result_count: 0, result: null,
    }],
  } });
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  const job = await runMine();

  assert.notEqual(job['outcome'], 'COMPLETED');
  assert.notEqual(job['outcome'], 'ZERO_RESULTS',
    'a rejected request was reported as a market with nobody in it');
  const { rows } = await query<{ canonical_name: string }>(discoveredNames);
  assert.equal(rows.length, 0);
});

test('a task_post that returns no id is not silently retried into spend', async () => {
  await seedNeighbour();
  replayFetch({ post: {
    version: '0.1.20260801', status_code: 20000, status_message: 'Ok.',
    tasks_count: 1, tasks_error: 1,
    tasks: [{ status_code: 40006, status_message: 'Task Handed.', result: null }],
  } });
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  const job = await runMine();

  assert.notEqual(job['outcome'], 'ZERO_RESULTS');
  assert.equal(calls.filter((call) => call.url.includes('task_get')).length, 0,
    'we polled for a task that was never created');
});

test('an unparseable body is a provider failure, not a market with nobody in it', async () => {
  await seedNeighbour();
  globalThis.fetch = (async (input: unknown, init: any = {}) => {
    calls.push({ url: String(input), method: init.method ?? 'GET', headers: init.headers ?? {}, body: null });
    return new Response('<html><body>502 Bad Gateway</body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof globalThis.fetch;
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  const job = await runMine();

  assert.notEqual(job['outcome'], 'ZERO_RESULTS');
  assert.notEqual(job['outcome'], 'COMPLETED');
});

test('nothing about the credential reaches the job record', async () => {
  await seedNeighbour();
  replayFetch({ getStatus: 401, get: { status_code: 40100, status_message: 'Unauthorized.' } });
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  const job = await runMine();

  const serialized = JSON.stringify(job);
  assert.doesNotMatch(serialized, /replay-secret/);
  assert.doesNotMatch(serialized, /Basic [A-Za-z0-9+/=]{8,}/);
});
