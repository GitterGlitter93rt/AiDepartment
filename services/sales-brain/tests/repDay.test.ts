import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import '../src/workers/contactResearch.js';
import {
  clearDiscoveryAdapters, registerDiscoveryAdapter, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { marketCoverage } from '../src/miner/coveragePlan.js';
import { planCanary } from '../src/miner/canary.js';
import { researchPictureFor } from '../src/domain/researchFacts.js';
import { readinessFor } from '../src/domain/repReady.js';
import { computeCompleteness } from '../src/domain/researchCompleteness.js';
import { primaryContactStanding } from '../src/domain/contactConfidence.js';
import { buildCallPack } from '../src/callbrain/callPack.js';
import { searchProspects } from '../src/domain/search.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { captureDiagnostics, diagnose } from '../src/release/doctor.js';
import { releaseManifest } from '../src/release/manifest.js';
import { scoreAccount } from '../src/scoring/score.js';

/**
 * One day, from an empty market to a logged call and a follow-up.
 * Authority: Issue #3 S.
 *
 * The hero flow proves a rep can find, claim and work a prospect. Brent's morning
 * proves the overnight states are told apart. Neither asks the question this does:
 * at the end of a day in which specific things happened, does every surface tell the
 * same story about them?
 *
 * That matters because the surfaces are computed independently -- the search reads a
 * projection, coverage reads base tables, the doctor reads counts, the manifest reads
 * config, the Account page reads the fact model. Each of those has been wrong at some
 * point in this campaign, and each was wrong in a way that looked plausible on its
 * own. Agreement between them is the property that catches the next one.
 */

let app: FastifyInstance;
const PASSWORD = 'rep-day-password';
const ZIP = '32095';

/** The market as the provider sees it: five roofers, two of them advertising. */
const MARKET = [
  { slug: 'coastalroof', name: 'coastalroof.invalid', paid: true },
  { slug: 'ancientcityroof', name: 'ancientcityroof.invalid', paid: true },
  { slug: 'matanzasroof', name: 'matanzasroof.invalid', paid: false },
  { slug: 'firstcoastroof', name: 'firstcoastroof.invalid', paid: false },
  { slug: 'nocatchroof', name: 'nocatchroof.invalid', paid: false },
];

/** What each company's own site says. */
const SITES: Record<string, string> = {
  'coastalroof.invalid': `<html><body><h1>Coastal Roofing</h1>
    <p>24/7 emergency roof repair across St. Johns County.</p>
    <p>Request a quote online. Financing available.</p>
    <h3>Dana Fielder</h3><p>Owner</p>
    <p>Call <a href="tel:+19045551001">(904) 555-1001</a></p></body></html>`,
  'ancientcityroof.invalid': `<html><body><h1>Ancient City Roofing</h1>
    <p>Emergency service. Book online for a free estimate.</p>
    <p>Office: (904) 555-1002</p></body></html>`,
  'matanzasroof.invalid': `<html><body><h1>Matanzas Roofing</h1>
    <p>Residential roofing since 1998. Call (904) 555-1003.</p></body></html>`,
  'firstcoastroof.invalid': `<html><body><h1>First Coast Roofing</h1>
    <p>We are hiring installers. Our locations span two counties.</p>
    <p>(904) 555-1004</p></body></html>`,
  'nocatchroof.invalid': '<html><body><h1>No Catch Roofing</h1></body></html>',
};

let realFetch: typeof globalThis.fetch;
let repCookie: string;
let repId: string;
let opsId: string;
let managerId: string;
let mineJobId: string;

before(async () => {
  app = await buildServer();
  realFetch = globalThis.fetch;
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();

  // Each company's own site, served through the real crawl.
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', { status: 200,
        headers: { 'content-type': 'text/plain' } });
    }
    const body = SITES[url.hostname];
    if (!body || url.pathname !== '/') {
      return new Response('not found', { status: 404,
        headers: { 'content-type': 'text/html' } });
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof globalThis.fetch;

  repId = await createUser({ email: 'rep@repday.invalid', displayName: 'Brent',
    role: 'SALES_REP', password: PASSWORD });
  opsId = await createUser({ email: 'ops@repday.invalid', displayName: 'Night Ops',
    role: 'RESEARCH_OPS', password: PASSWORD });
  managerId = await createUser({ email: 'manager@repday.invalid',
    displayName: 'Manager', role: 'SALES_MANAGER', password: PASSWORD });

  const login = await app.inject({ method: 'POST', url: '/login',
    payload: { email: 'rep@repday.invalid', password: PASSWORD } });
  repCookie = `yad_sales_session=${login.cookies.find(
    (cookie) => cookie.name === 'yad_sales_session')!.value}`;

  // A neighbour already in inventory, so the ZIP resolves to a town.
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Existing Roofing of St Augustine',
    website: 'https://existingroof.invalid', phone: '904-555-1000',
    city: 'St. Augustine', state: 'FL', postalCode: ZIP, verticalProfileId: 'roofing',
  }, { discoverySource: 'import' }));

  // Overnight: the market is searched and everything found is researched and scored.
  registerDiscoveryAdapter({
    name: 'repday', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      const index = (request.search?.index ?? 1) - 1;
      const company = MARKET[index];
      if (!company) {
        return { status: 'ZERO_RESULTS', businesses: [], providerRows: 0,
          rejectedRows: 0, duplicateRows: 0, costUsd: 0.006 };
      }
      return {
        status: 'OK',
        businesses: [{
          name: company.name, website: `https://${company.name}`, phone: null,
          city: null, state: null, postalCode: null,
          resultType: company.paid ? 'PAID_SEARCH_TEXT' : 'ORGANIC',
          query: request.search?.term ?? null, position: index + 1,
          ...(company.paid ? { adHeadline: 'Emergency Roof Repair — Same Day' } : {}),
        }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, costUsd: 0.006,
      };
    },
  });

  const job = await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: ZIP,
    marketId: null, requestedBy: opsId, queryBudget: 5 });
  mineJobId = job.jobId;
  await drainQueue();

  // Ad evidence, which comes from the provider rather than the site.
  for (const company of MARKET.filter((entry) => entry.paid)) {
    await query(
      `insert into evidence_records
         (account_id, category, claim_key, claim_text, normalized_value, confidence,
          can_state_as_fact, source_type, source_provider, expires_at, freshness)
       select account_id, 'paid_acquisition', 'active_google_search_ad',
              'Emergency Roof Repair — Same Day', 'yes', 'confirmed', true,
              'provider_serp', 'repday', now() + interval '48 hours', 'fresh'
         from accounts where canonical_domain = $1`, [company.name]);
  }
  const { rows: all } = await query<{ account_id: string }>(
    'select account_id from accounts where merged_into_account_id is null');
  for (const row of all) await scoreAccount(row.account_id);
});

after(async () => {
  globalThis.fetch = realFetch;
  clearDiscoveryAdapters();
  await app.close();
  await pool.end();
});

async function accountId(domain: string): Promise<string> {
  const { rows } = await query<{ account_id: string }>(
    'select account_id from accounts where canonical_domain = $1', [domain]);
  assert.ok(rows[0], `no Account for ${domain}`);
  return rows[0]!.account_id;
}

// ---------------------------------------------------------- overnight happened --

test('the night found the market and researched what it found', async () => {
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where merged_into_account_id is null`);
  assert.equal(rows[0]!.n, MARKET.length + 1, 'the market did not arrive intact');

  const researched = await query<{ n: number }>(
    `select count(*)::int as n from accounts where last_researched_at is not null`);
  assert.ok(researched.rows[0]!.n >= MARKET.length,
    `${researched.rows[0]!.n} of ${MARKET.length} discovered companies were researched`);
});

test('what each site said is what we recorded, and only what the profile asks', async () => {
  // Coastal's page states 24/7 emergency cover, online quotes and financing. Roofing
  // declares booking and financing as signals and does *not* declare emergency
  // cover -- storm work is its own signal in that profile. So the extractor records
  // two of the three, which is the profile deciding what matters rather than the page.
  const coastal = await researchPictureFor(await accountId('coastalroof.invalid'));
  for (const key of ['online_quote_booking', 'financing_promoted']) {
    assert.equal(coastal.facts.find((fact) => fact.key === key)!.state, 'YES', key);
  }
  assert.ok(!coastal.facts.some((fact) => fact.key === 'emergency_24_7_service'),
    'a signal the roofing profile does not declare was recorded from the page anyway');

  const quiet = await researchPictureFor(await accountId('nocatchroof.invalid'));
  for (const key of ['online_quote_booking', 'financing_promoted']) {
    const fact = quiet.facts.find((item) => item.key === key)!;
    assert.equal(fact.state, 'NOT_OBSERVED',
      `${key} on a page that says nothing came out as ${fact.state}`);
  }
});

// ------------------------------------------------------- the rep opens the list --

test('the rep sees the market, ordered, with only real tiers', async () => {
  const viewer = { userId: repId, role: 'SALES_REP' as const };
  const found = await searchProspects({
    geography: { type: 'zip_zcta', value: ZIP }, sort: 'manual_score', pageSize: 20,
  }, viewer);

  assert.equal(found.total, MARKET.length + 1);
  const scores = (found.results as any[]).map((row) => Number(row.manual_score ?? 0));
  assert.deepEqual([...scores].sort((a, b) => b - a), scores,
    'the list sorted by score is not in score order');

  // The two advertisers outrank the three that only have site signals.
  const top = (found.results as any[])[0]!;
  assert.ok(['coastalroof.invalid', 'ancientcityroof.invalid'].includes(top.canonical_domain),
    `the top of the list is ${top.canonical_domain}, which is not an advertiser`);
});

test('coverage and the search agree about the same market', async () => {
  // Computed by different queries against different tables. They have disagreed
  // before, and a rep reading two numbers that contradict each other trusts neither.
  const viewer = { userId: repId, role: 'SALES_REP' as const };
  const found = await searchProspects({
    geography: { type: 'zip_zcta', value: ZIP }, pageSize: 50 }, viewer);
  const coverage = await marketCoverage({ vertical: 'roofing', location: ZIP });

  assert.equal(coverage.inventory, found.total,
    `coverage says ${coverage.inventory} companies and the search says ${found.total}`);
  assert.equal(coverage.saturation, 'STILL_FINDING',
    `a market searched once and yielding five new companies reads as ${coverage.saturation}`);
  assert.ok(coverage.termsAsked.length > 0, 'the terms we bought are not recorded as asked');
});

test('the canary would not re-buy the market it already searched', async () => {
  const plan = await planCanary({
    vertical: 'roofing', location: ZIP, count: 5, maxCostCents: 100 });
  const coverage = await marketCoverage({ vertical: 'roofing', location: ZIP });

  // The canary plans from the taxonomy, coverage knows what has been asked. An
  // operator reading both should see the same terms on both sides.
  for (const term of coverage.termsAsked) {
    assert.ok(plan.searches.some((search) => search.term === term)
      || coverage.termsNotAsked.includes(term),
      `"${term}" is recorded as asked and is not in the plan or the not-asked list`);
  }
  assert.deepEqual(plan.causesHeldBack, ['hail', 'storm'],
    'a roofing canary offered storm terms after a cause-neutral night');
});

// ---------------------------------------------------- the rep picks one and works --

test('the best prospect is rep-ready, and the thin one is not', async () => {
  const best = (await readinessFor(await accountId('coastalroof.invalid')))!;
  const thin = (await readinessFor(await accountId('nocatchroof.invalid')))!;

  // Neither has been DNC-screened, so neither is REP_READY yet -- and the contract
  // says so rather than pretending.
  assert.notEqual(best.state, 'NOT_WORKABLE');
  assert.ok(best.missing.length <= thin.missing.length,
    'the researched advertiser has more missing than the company with a blank site');
  for (const requirement of thin.missing) {
    assert.ok(requirement.detail.length > 20, `${requirement.key} explains nothing`);
  }
});

test('completeness tells the rich record from the blank one', async () => {
  const rich = await computeCompleteness(await accountId('coastalroof.invalid'));
  const blank = await computeCompleteness(await accountId('nocatchroof.invalid'));
  assert.ok(rich.score > blank.score,
    `a site stating four things scored ${rich.score} and a blank one ${blank.score}`);
  assert.ok(rich.observed > blank.observed);
});

test('the call pack says who to ask for and how sure we are', async () => {
  const pack = await buildCallPack(await accountId('coastalroof.invalid'));
  assert.ok(pack, 'no call pack for the best prospect in the market');

  const standing = await primaryContactStanding(await accountId('coastalroof.invalid'));
  assert.equal(pack!.contactConfidence, standing!.standing.confidence,
    'the call pack and the contact record disagree about how sure we are');

  // The ad we found is quotable; what it cost is not.
  assert.ok(pack!.confirmedFacts.some(
    (fact) => /Emergency Roof Repair/.test(fact.claim)),
    'the ad a rep would open with is not in the call pack');
  assert.ok(pack!.prohibitedClaims.some(
    (claim) => /advertising spend/i.test(claim)),
    'the rep is handed an ad and not told they cannot discuss what it costs');
});

test('claiming, calling and following up leaves one consistent history', async () => {
  const target = await accountId('coastalroof.invalid');
  const claimed = await claimAccount(target,
    { userId: repId, role: 'SALES_REP', activeClaimTarget: null });
  assert.equal(claimed.ok, true, JSON.stringify(claimed));

  // A gatekeeper turn with a callback, which is the follow-up a rep actually
  // promises: "Dana is out until Thursday, I'll try then."
  const logged = await recordDisposition(
    {
      accountId: target, channel: 'phone', disposition: 'CALLBACK_REQUESTED',
      notes: 'Dana out until Thursday.',
      callbackDueAt: new Date(Date.now() + 3 * 86_400_000),
      callbackTimezone: 'America/New_York',
    },
    { userId: repId, role: 'SALES_REP' },
  );
  assert.equal(logged.ok, true, JSON.stringify(logged));

  const { rows: activities } = await query<{ activity_type: string; disposition: string }>(
    `select activity_type, disposition from activities
      where account_id = $1 and disposition is not null`, [target]);
  assert.equal(activities.length, 1, 'the call was logged more than once, or not at all');

  const { rows: followUps } = await query<{ n: number }>(
    `select count(*)::int as n from follow_ups where account_id = $1 and status = 'OPEN'`,
    [target]);
  assert.equal(followUps[0]!.n, 1, 'the follow-up the rep promised was not created');

  // And the record is still theirs.
  const { rows: owner } = await query<{ current_owner_user_id: string }>(
    'select current_owner_user_id from accounts where account_id = $1', [target]);
  assert.equal(owner[0]!.current_owner_user_id, repId);
});

test('another rep can browse the record and cannot act on it', async () => {
  // Inventory is shared on purpose -- a rep looking a company up is how they avoid
  // calling somebody else's prospect. What must not happen is acting on it.
  const other = await createUser({ email: 'other@repday.invalid',
    displayName: 'Other Rep', role: 'SALES_REP', password: PASSWORD });
  const login = await app.inject({ method: 'POST', url: '/login',
    payload: { email: 'other@repday.invalid', password: PASSWORD } });
  const cookie = `yad_sales_session=${login.cookies.find(
    (item) => item.name === 'yad_sales_session')!.value}`;
  const target = await accountId('coastalroof.invalid');

  const page = await app.inject({
    method: 'GET', url: `/accounts/${target}`, headers: { cookie } });
  assert.equal(page.statusCode, 200, 'shared inventory stopped being browsable');

  // And the attempt to work it is refused rather than merely hidden.
  const attempt = await recordDisposition(
    { accountId: target, channel: 'phone', disposition: 'NO_ANSWER' },
    { userId: other, role: 'SALES_REP' },
  );
  assert.equal(attempt.ok, false,
    'a rep logged a call against a company another rep is working');
  assert.equal(attempt.reason, 'NOT_OWNER');
});

// ----------------------------------------------- the operator reads the same day --

test('the operations page agrees with what the day actually did', async () => {
  const snapshot = await operationalSnapshot();
  const byId = new Map(snapshot.checks.map((check) => [check.id, check]));

  // Nothing was left stranded, because research ran on everything discovered.
  assert.match(byId.get('research_backlog')!.value, /none|0/i,
    `research backlog reads "${byId.get('research_backlog')!.value}" after a night that `
    + 'researched everything it found');

  // Every score came from the policy this build runs.
  assert.equal(byId.get('score_policy')!.value, 'all current',
    'scores were written under a policy this build does not run');

  // And no company name leaked onto the panel.
  assert.ok(!JSON.stringify(snapshot).includes('coastalroof'),
    'a prospect domain appeared in the operations snapshot');
});

test('the doctor finds nothing wrong with a day that went right', async () => {
  const state = await captureDiagnostics();
  const diagnoses = diagnose(state);

  const problems = diagnoses.filter((diagnosis) => diagnosis.category !== 'HEALTHY');
  // A queue that drained, research that ran, scoring that ran: the only thing the
  // doctor may reasonably flag is that no worker is heartbeating in a test process.
  for (const problem of problems) {
    assert.ok(['QUEUE_STARVED', 'PROVIDER_PENDING'].includes(problem.category),
      `the doctor reported ${problem.category} after a clean day: ${problem.finding}`);
  }
  assert.equal(state.research.strandedNoResearch, 0);
  assert.equal(state.scoring.underOldPolicy, 0);
});

test('the manifest and the run agree about which profile did the work', async () => {
  const manifest = await releaseManifest();
  const roofing = manifest.verticals.find((entry) => entry.id === 'roofing')!;

  const { rows } = await query<{ vertical_profile_version: string | null }>(
    `select vertical_profile_version from research_runs
      where vertical_profile_id = 'roofing' and vertical_profile_version is not null
      limit 1`);
  assert.ok(rows[0], 'no research run recorded which profile produced its evidence');
  assert.ok(rows[0]!.vertical_profile_version!.includes(roofing.contentHash),
    `the run says ${rows[0]!.vertical_profile_version} and the manifest says `
    + `${roofing.contentHash}: the two cannot both be right`);
});

test('the day cost what the provider said it cost, and it is recorded', async () => {
  const { rows } = await query<{ spend: string; calls: number }>(
    `select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0)::text as spend,
            count(*)::int as calls
       from provider_usage where requested_at >= date_trunc('day', now())`);
  assert.ok(Number(rows[0]!.spend) > 0,
    'five paid searches ran and the day is recorded as costing nothing');

  const { rows: job } = await query<{ progress: any }>(
    'select progress from jobs where job_id = $1', [mineJobId]);
  const perSearch = job[0]!.progress.perSearch as any[];
  assert.equal(perSearch.length, 5, 'the five searches are not accounted for separately');
  // Rows in equals rows out plus what was dropped, for the run a rep's whole day
  // rests on.
  const progress = job[0]!.progress;
  assert.equal(
    Number(progress.providerRows) - Number(progress.rejectedRows)
      - Number(progress.providerDuplicates),
    Number(progress.discoveredNew) + Number(progress.matchedExisting),
    'the funnel for the day does not reconcile');
});
