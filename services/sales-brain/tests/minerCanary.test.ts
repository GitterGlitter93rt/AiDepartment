import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  clearDiscoveryAdapters, registerDiscoveryAdapter, refusedDiscovery,
  type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { planCanary, canaryReport, renderCanaryPlan, MAX_CANARY_SEARCHES } from '../src/miner/canary.js';
import { researchPictureFor } from '../src/domain/researchFacts.js';
import { observationsFor } from './support/observations.js';

/**
 * A market search an operator can read before it costs anything.
 * Authority: Issue #3 F.
 *
 * Every defect this campaign found in the miner was invisible until money had been
 * spent and the results looked wrong: a budget of twenty-five buying one search, a
 * roofing run asking for hail damage, a provider search id used as a business
 * identity. None of them needed a live call to see. They needed somebody to be shown
 * the actual queries, the actual fingerprints and the actual cost before the run.
 *
 * So the plan is the product, and the live path is a second step that reuses the
 * ordinary job and provider-task machinery. A canary with its own fast path would
 * prove the canary works and tell us nothing about the system that will run.
 */

const ROOFING = {
  vertical: 'roofing', location: '32095', count: 10, maxCostCents: 200,
};

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { clearDiscoveryAdapters(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
});

/** Counts every provider call. Registering it is the only way one can happen. */
function countingProvider(state: { submits: number; collects: number }) {
  registerDiscoveryAdapter({
    name: 'canary-fixture', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      state.submits += 1;
      const index = request.search?.index ?? 0;
      return {
        status: 'OK',
        observations: observationsFor([{
          name: `canary${index}.invalid`, website: `https://canary${index}.invalid`,
          phone: null, city: null, state: null, postalCode: null,
          resultType: 'PAID_SEARCH_TEXT', query: request.search?.term ?? null,
        }]),
        costUsd: 0.006,
      };
    },
    async collect(providerTaskId): Promise<DiscoveryResult> {
      state.collects += 1;
      return { status: 'OK', observations: observationsFor([]), providerTaskId };
    },
  });
}

// ------------------------------------------------------------ nothing is spent ---

test('a dry run submits nothing to any provider', async () => {
  const state = { submits: 0, collects: 0 };
  countingProvider(state);

  const plan = await planCanary(ROOFING);
  assert.ok(plan.searches.length > 0, 'the plan is empty, so this proves nothing');
  assert.equal(state.submits, 0, 'planning a canary called a provider');
  assert.equal(state.collects, 0);
  assert.equal(plan.wouldRun, false, 'a dry run described itself as a go-ahead');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from provider_usage`);
  assert.equal(rows[0]!.n, 0, 'a dry run recorded provider usage');
});

test('the default invocation cannot spend money', async () => {
  // No --live anywhere. This is the command an operator types, and the one somebody
  // copies out of a runbook.
  const state = { submits: 0, collects: 0 };
  countingProvider(state);
  const plan = await planCanary(ROOFING);

  assert.equal(plan.live, false);
  assert.equal(plan.wouldRun, false);
  assert.equal(state.submits, 0);
});

test('a live run needs the ceiling stated twice', async () => {
  const state = { submits: 0, collects: 0 };
  countingProvider(state);

  // --live alone is one paste away from a run nobody meant.
  const unconfirmed = await planCanary({ ...ROOFING, live: true });
  assert.equal(unconfirmed.wouldRun, false);
  assert.ok(unconfirmed.refusals.some((refusal) => refusal.code === 'LIVE_NOT_CONFIRMED'));
  assert.equal(state.submits, 0);

  // The wrong number is not a confirmation either.
  const mismatched = await planCanary({
    ...ROOFING, live: true, confirmSpendCents: ROOFING.maxCostCents - 1 });
  assert.equal(mismatched.wouldRun, false);

  const confirmed = await planCanary({
    ...ROOFING, live: true, confirmSpendCents: ROOFING.maxCostCents });
  assert.equal(confirmed.wouldRun, true, confirmed.refusals.map((r) => r.code).join(', '));
});

test('the command in the runbook cannot be turned live by adding one flag', () => {
  // The dry-run command carries --max-cost-cents; --confirm-spend-cents is a second,
  // different flag with the same number in it. There is no ordering, environment
  // variable or shorthand that promotes the former into the latter.
  const source = readFileSync(new URL('../src/bin/miner-canary.ts', import.meta.url), 'utf8');
  assert.match(source, /confirm-spend-cents/);
  assert.doesNotMatch(source, /process\.env\[['"]\w*LIVE/,
    'an environment variable can make a canary live, which no runbook would show');
});

// ----------------------------------------------------------------- the count ----

test('ten means ten independent searches, never one query with ten terms', async () => {
  const plan = await planCanary({ vertical: 'hvac', location: '32095', count: 10,
    maxCostCents: 200 });

  // hvac defines eight terms, so ten is honestly eight.
  assert.equal(plan.searches.length, plan.availableTerms);
  assert.equal(plan.requestedCount, 10);

  const keywords = plan.searches.map((search) => search.keyword);
  assert.equal(new Set(keywords).size, keywords.length, 'two planned searches are identical');
  for (const keyword of keywords) {
    assert.ok(keyword.split(' ').length <= 6,
      `"${keyword}" looks like several terms concatenated into one query`);
  }
  const prints = plan.searches.map((search) => search.fingerprint);
  assert.equal(new Set(prints).size, prints.length,
    'two searches share an identity, so the second would look like the first’s '
    + 'outstanding task and never be bought');
});

test('a count above the canary ceiling is refused, not quietly trimmed', async () => {
  const plan = await planCanary({ ...ROOFING, count: MAX_CANARY_SEARCHES + 1 });
  assert.ok(plan.refusals.some((refusal) => refusal.code === 'COUNT_CEILING'));
  assert.match(plan.refusals.find((r) => r.code === 'COUNT_CEILING')!.message,
    /production run/);
});

// ------------------------------------------------------------- normalisation ----

test('the same place typed differently is the same searches', async () => {
  const plain = await planCanary({ ...ROOFING, location: '32095' });
  const spaced = await planCanary({ ...ROOFING, location: '  32095 ' });
  const plussed = await planCanary({ ...ROOFING, location: '32095-1234' });

  const prints = (plan: typeof plain) => plan.searches.map((search) => search.fingerprint);
  assert.deepEqual(prints(spaced), prints(plain), 'whitespace bought the market twice');
  assert.deepEqual(prints(plussed), prints(plain),
    'a ZIP+4 identifies a delivery route, not a market, and bought it again');
});

test('a different vertical, place, event or strategy is a different search', async () => {
  const base = await planCanary(ROOFING);
  const print = (plan: typeof base) => plan.searches[0]?.fingerprint ?? '';

  assert.notEqual(print(await planCanary({ ...ROOFING, vertical: 'plumbing' })), print(base));
  assert.notEqual(print(await planCanary({ ...ROOFING, location: '32084' })), print(base));
  assert.notEqual(
    print(await planCanary({ ...ROOFING, miningMode: 'broad_local' })), print(base));

  // A cause changes which searches run rather than renaming the same ones, so the
  // set differs even where an individual fingerprint does not.
  const withHail = await planCanary({ ...ROOFING, causes: ['hail'] });
  assert.notDeepEqual(
    withHail.searches.map((search) => search.term).sort(),
    base.searches.map((search) => search.term).sort());
});

test('roofing and a ZIP stays cause-neutral, and says what it held back', async () => {
  const plan = await planCanary(ROOFING);
  for (const search of plan.searches) {
    assert.doesNotMatch(search.keyword, /hail|storm/i,
      `"${search.keyword}" assumes weather nobody asked about`);
  }
  assert.deepEqual(plan.causesHeldBack, ['hail', 'storm']);
  assert.match(renderCanaryPlan(plan), /Pass --cause to include them/);
});

// ------------------------------------------------------------------- the cost ---

test('a ceiling below the predicted spend refuses the run', async () => {
  // Michael's own example: five roofing searches at the assumed five cents each is
  // twenty-five cents, and the ceiling is ten.
  const plan = await planCanary({ ...ROOFING, maxCostCents: 10 });
  const refusal = plan.refusals.find((item) => item.code === 'COST_CEILING');
  assert.ok(refusal, 'a run that would cost more than its ceiling was allowed');
  assert.match(refusal!.message, /before the money is spent/);

  const allowed = await planCanary({ ...ROOFING, maxCostCents: 200 });
  assert.equal(allowed.refusals.some((item) => item.code === 'COST_CEILING'), false);
});

test('a per-run ceiling is not a per-day ceiling', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.10';
  await query(
    `insert into provider_usage (provider, operation, requested_at, completed_at, units,
                                 estimated_cost_usd, actual_cost_usd, status)
     values ('canary-fixture', 'serp.discover', now(), now(), 1, 0, 0.09, 'OK')`);

  const plan = await planCanary({ ...ROOFING, maxCostCents: 500 });
  assert.ok(plan.refusals.some((refusal) => refusal.code === 'DAILY_BUDGET'),
    'a run that fits its own ceiling and blows the day was allowed');
  delete process.env['DISCOVERY_DAILY_BUDGET_USD'];
});

test('cost is estimated on what will run, not on what was asked for', async () => {
  // Roofing defines five cause-neutral terms; asking for twenty cannot cost twenty
  // searches' worth.
  const plan = await planCanary({ ...ROOFING, count: 20, maxCostCents: 500 });
  assert.equal(plan.cost.estimatedTotalUsd,
    Number((plan.searches.length * plan.cost.assumedPerSearchUsd).toFixed(4)));
  assert.ok(plan.searches.length < 20);
});

// --------------------------------------------------- nothing else may change ----

test('a canary changes no suppression or DNC state', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Suppressed Roofing', website: 'https://suppressed.invalid',
    phone: '904-555-8001', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'roofing',
  }, { discoverySource: 'import' }));
  await query(
    `update accounts set is_suppressed = true, suppression_summary = 'Asked not to be called'
      where account_id = $1`, [accountId]);

  await planCanary(ROOFING);

  const { rows } = await query<{ is_suppressed: boolean; summary: string }>(
    'select is_suppressed, suppression_summary as summary from accounts where account_id = $1',
    [accountId]);
  assert.equal(rows[0]!.is_suppressed, true);
  assert.match(rows[0]!.summary, /Asked not to be called/);
});

test('a canary changes no owner, even when a source re-finds the company', async () => {
  const rep = await makeUser(`Canary Rep ${Date.now()}`, 'SALES_REP');
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'canary1.invalid', website: 'https://canary1.invalid',
    phone: '904-555-8002', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'roofing',
  }, { discoverySource: 'import' }));
  await claimAccount(accountId,
    { userId: rep.userId, role: 'SALES_REP', activeClaimTarget: null });

  // A full live-shaped run through the ordinary queue, finding the same company.
  const state = { submits: 0, collects: 0 };
  countingProvider(state);
  const ops = await makeUser(`Canary Ops ${Date.now()}`, 'RESEARCH_OPS');
  await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 3 });
  await drainQueue();

  const { rows } = await query<{ current_owner_user_id: string }>(
    'select current_owner_user_id from accounts where account_id = $1', [accountId]);
  assert.equal(rows[0]!.current_owner_user_id, rep.userId,
    'a provider re-finding a company took it away from the rep working it');
});

test('nothing a canary does can dial, email or arm an outbound candidate', async () => {
  const state = { submits: 0, collects: 0 };
  countingProvider(state);
  const ops = await makeUser(`Canary Ops 2 ${Date.now()}`, 'RESEARCH_OPS');
  await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 3 });
  await drainQueue();

  for (const table of ['voice_calls', 'pilot_candidates', 'email_enrollments',
    'audio_pilot_attempts']) {
    const { rows } = await query<{ n: number }>(`select count(*)::int as n from ${table}`);
    assert.equal(rows[0]!.n, 0, `a mining run created a row in ${table}`);
  }

  const { rows: pilot } = await query<{ outbound_mode: string }>(
    'select outbound_mode from voice_pilot_state');
  assert.equal(pilot[0]?.outbound_mode ?? 'OFF', 'OFF',
    'a mining run changed the outbound pilot state');
});

test('the harness writes to the canonical tables and no others', () => {
  // No second inventory: the canary reads and writes the same Accounts everything
  // else does, and its report is assembled from those tables rather than kept in a
  // tally of its own, so the report and the Mining page cannot disagree.
  const source = readFileSync(new URL('../src/miner/canary.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /create table|insert into (canary|miner_)/i,
    'the canary keeps its own store');
  for (const table of ['jobs', 'search_observations', 'provider_tasks', 'accounts']) {
    assert.ok(source.includes(table), `the report does not read ${table}`);
  }
});

// ----------------------------------------------------- the live path is normal ---

test('a live run goes through the ordinary queue, not around it', () => {
  const source = readFileSync(new URL('../src/bin/miner-canary.ts', import.meta.url), 'utf8');
  assert.match(source, /enqueueMarketResearch/,
    'the live path does not enqueue an ordinary job');
  assert.doesNotMatch(source, /\.discover\(|\.collect\(/,
    'the canary calls an adapter directly, bypassing provider task persistence, '
    + 'restart recovery, idempotency, ingestion, provenance and cost accounting');
});

test('a restarted live run collects what it already paid for', async () => {
  let submits = 0;
  let collects = 0;
  registerDiscoveryAdapter({
    name: 'canary-pending', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request) {
      submits += 1;
      return { ...refusedDiscovery('PENDING', 'accepted, not ready'),
        providerTaskId: `canary-task-${request.search?.index}` };
    },
    async collect(providerTaskId) {
      collects += 1;
      return { status: 'OK' as const,
        observations: observationsFor([{ name: 'collected.invalid', website: 'https://collected.invalid',
          phone: null, city: null, state: null, postalCode: null }]),
        providerTaskId };
    },
  });

  const ops = await makeUser(`Canary Restart ${Date.now()}`, 'RESEARCH_OPS');
  const run = async () => {
    await enqueueMarketResearch({
      verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
      marketId: null, requestedBy: ops.userId, queryBudget: 3 });
    await drainQueue();
  };

  await run();
  assert.equal(submits, 3);
  await run();
  assert.equal(submits, 3, 'a restarted run bought searches the provider already owed us');
  assert.equal(collects, 3, 'the searches already paid for were never collected');
});

// ---------------------------------------------------------------- the report ----

test('a market of companies we already hold is coverage, not an empty market', async () => {
  // Every result matching something we hold is the market being covered. Reporting
  // it as ZERO_RESULTS tells a rep the ZIP is empty when it is fully known.
  for (let index = 1; index <= 3; index += 1) {
    await withTransaction((client) => upsertAccount(client, {
      canonicalName: `canary${index}.invalid`, website: `https://canary${index}.invalid`,
      phone: null, city: 'St. Augustine', state: 'FL', postalCode: '32095',
      verticalProfileId: 'roofing',
    }, { discoverySource: 'import' }));
  }

  const state = { submits: 0, collects: 0 };
  countingProvider(state);
  const ops = await makeUser(`Canary Coverage ${Date.now()}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 3 });
  await drainQueue();

  const report = (await canaryReport(job.jobId))!;
  assert.notEqual(report.outcome, 'ZERO_RESULTS',
    'a market we already hold entirely was reported as having nobody in it');
  assert.equal(report.totals.newAccounts, 0);
  assert.equal(report.totals.matchedExisting, 3);
  assert.ok(report.totals.providerRows > 0);
});

test('the report accounts for each search separately', async () => {
  registerDiscoveryAdapter({
    name: 'canary-mixed', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      const index = request.search?.index ?? 0;
      if (index === 1) {
        return { status: 'OK',
          observations: observationsFor([{ name: 'mixed.invalid', website: 'https://mixed.invalid',
            phone: null, city: null, state: null, postalCode: null }]),
          costUsd: 0.006 };
      }
      if (index === 2) return refusedDiscovery('OUTAGE', 'the provider did not answer');
      return { status: 'ZERO_RESULTS', observations: observationsFor([]), };
    },
  });

  const ops = await makeUser(`Canary Report ${Date.now()}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 3 });
  await drainQueue();

  const report = (await canaryReport(job.jobId))!;
  assert.equal(report.perSearch.length, 3);
  assert.deepEqual(report.perSearch.map((row) => row.state), ['OK', 'OUTAGE', 'ZERO_RESULTS']);
  assert.equal(report.totals.searchesCompleted, 2);
  assert.equal(report.totals.searchesFailed, 1);
  assert.equal(report.totals.duplicatePaidSubmits, 0);
  // Every search has its own fingerprint on the record, so a disputed charge can be
  // traced to the words that caused it.
  assert.equal(new Set(report.perSearch.map((row) => row.fingerprint)).size, 3);
});

test('a run whose cost no provider declared is not reported as free', async () => {
  registerDiscoveryAdapter({
    name: 'canary-silent', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return { status: 'ZERO_RESULTS', observations: observationsFor([]), };
    },
  });
  const ops = await makeUser(`Canary Silent ${Date.now()}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 2 });
  await drainQueue();

  const report = (await canaryReport(job.jobId))!;
  assert.equal(report.totals.totalSpendUsd, null,
    'a run whose cost is unknown was reported as costing nothing');
});

test('what the canary found keeps its unknowns', async () => {
  const state = { submits: 0, collects: 0 };
  countingProvider(state);
  const ops = await makeUser(`Canary Unknown ${Date.now()}`, 'RESEARCH_OPS');
  await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 2 });
  await drainQueue();

  const { rows } = await query<{ account_id: string }>(
    `select account_id from accounts where canonical_domain like 'canary%' limit 1`);
  const picture = await researchPictureFor(rows[0]!.account_id);

  for (const key of ['advertising_google_lsa', 'advertising_meta', 'rating_and_reviews']) {
    const fact = picture.facts.find((item) => item.key === key)!;
    assert.ok(['NOT_CHECKED', 'NOT_OBSERVED', 'UNKNOWN'].includes(fact.state),
      `${key} became ${fact.state} because a canary found the company`);
    assert.doesNotMatch(fact.detail, /does not advertise/);
  }
});
