import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  clearDiscoveryAdapters, registerDiscoveryAdapter, refusedDiscovery,
  type DiscoveryQuery, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import {
  planDiscoverySearches, renderSearchPlan, searchFingerprint,
} from '../src/miner/searchPlan.js';
import { observationsFor } from './support/observations.js';

/**
 * A count of searches is a count of searches.
 * Authority: Issue #3 A / M-14.
 *
 * `query_budget` meant "plan this many and buy the first one". The taxonomy was
 * read, ordered by intent, sliced to the budget, and then element zero was the only
 * thing a provider was ever asked for. An operator who set twenty-five got one, and
 * the job called it a completed market search either way -- so a market looked thin
 * because we asked one question about it and reported the answer as the whole truth.
 *
 * N now means N independent searches: separate keywords, separate provider tasks,
 * separate fingerprints, separate accounting, separate outcomes. "ac repair 32095"
 * and "air conditioning replacement 32095" are two questions with two answers, and
 * concatenating them asks something nobody types.
 */

const ZIP = '32095';

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { clearDiscoveryAdapters(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
});

function planRequest(count: number, overrides: Record<string, unknown> = {}) {
  return {
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: ZIP,
    miningMode: 'advertiser_first', count, ...overrides,
  } as Parameters<typeof planDiscoverySearches>[0];
}

// ------------------------------------------------------------------ planning ----

test('a plan of one is the highest-intent term, not a concatenation', async () => {
  const plan = await planDiscoverySearches(planRequest(1));
  assert.equal(plan.searches.length, 1);

  const only = plan.searches[0]!;
  // One search's keyword is one search's words plus the place. The old bug shape was
  // several terms joined together, which is a query no customer types and no provider
  // answers usefully.
  assert.ok(!only.keyword.includes(' and '), only.keyword);
  assert.equal(only.keyword.split(ZIP).length - 1, 1, 'the geography appears twice');
  assert.match(only.keyword, new RegExp(`${ZIP}$`));
  assert.ok(only.term.length > 0 && !only.term.includes(ZIP),
    'the term still carries the geography, so two places share one identity');
});

test('asking for ten gives ten different searches', async () => {
  const plan = await planDiscoverySearches(planRequest(10));

  // The hvac profile defines eight terms, so ten is honestly eight.
  assert.equal(plan.searches.length, plan.available);
  assert.equal(plan.requested, 10);
  assert.equal(plan.limitedBy, 'TAXONOMY');

  const keywords = plan.searches.map((search) => search.keyword);
  assert.equal(new Set(keywords).size, keywords.length, 'two planned searches are identical');
  const terms = plan.searches.map((search) => search.term);
  assert.equal(new Set(terms).size, terms.length);
});

test('twenty-five and fifty do not invent terms to fill the count', async () => {
  for (const count of [25, 50]) {
    const plan = await planDiscoverySearches(planRequest(count));
    assert.equal(plan.requested, count);
    assert.equal(plan.searches.length, plan.available,
      `asking for ${count} produced ${plan.searches.length} against ${plan.available} terms`);
    assert.equal(plan.limitedBy, 'TAXONOMY');
    assert.ok(plan.searches.length < count);
    // Every keyword still has to be a real query somebody would type.
    for (const search of plan.searches) {
      assert.ok(search.term.trim().length > 2, `"${search.term}" is not a search term`);
      assert.match(search.keyword, new RegExp(`${ZIP}$`));
    }
  }
});

test('a count of zero buys nothing and says so', async () => {
  const plan = await planDiscoverySearches(planRequest(0));
  assert.deepEqual(plan.searches, []);
  assert.equal(plan.limitedBy, 'REQUEST');
  assert.match(plan.refusal!.reason, /zero searches/);
});

test('the plan spends on finding the market before pricing it', async () => {
  const plan = await planDiscoverySearches(planRequest(8));

  // This asserted that intent never increases as the plan goes on, which is the rule
  // that bought "drain cleaning 32095" for Plumbing: service terms outscore the trade
  // on intent in every profile, so ordering by intent puts the narrowest query first
  // and the trade itself last. Intent now orders queries inside a phase; it no longer
  // decides what the market is. Expect intent to climb across the plan, because
  // discovery is spent first and commercial intelligence follows it.
  const purposes = plan.searches.map((search) => search.purpose);
  const firstCommercial = purposes.indexOf('COMMERCIAL_INTELLIGENCE');
  if (firstCommercial !== -1) {
    assert.ok(!purposes.slice(firstCommercial).includes('ENTITY_DISCOVERY'),
      `phases interleave, so coverage is not satisfied first: ${purposes.join(', ')}`);
  }
  assert.equal(purposes[0], 'ENTITY_DISCOVERY',
    'the first paid query is not an attempt to find the market');

  assert.deepEqual(plan.searches.map((search) => search.index),
    plan.searches.map((_, offset) => offset + 1));
});

// -------------------------------------------------------------- fingerprints ----

test('two searches of one market are two identities, not one', async () => {
  const plan = await planDiscoverySearches(planRequest(8));
  const prints = plan.searches.map((search) => search.fingerprint);
  assert.equal(new Set(prints).size, prints.length,
    'two searches share a fingerprint, so the second would look like the first’s '
    + 'outstanding task and never be bought');
});

test('the same words in the same place are the same search however they are typed', () => {
  const base = {
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: ZIP,
    miningMode: 'advertiser_first',
  };
  assert.equal(
    searchFingerprint({ ...base, term: 'AC Repair' }),
    searchFingerprint({ ...base, term: 'ac  repair' }),
    'the same query typed differently would be bought twice');
  assert.notEqual(
    searchFingerprint({ ...base, term: 'ac repair' }),
    searchFingerprint({ ...base, term: 'ac replacement' }));
  assert.notEqual(
    searchFingerprint({ ...base, term: 'ac repair' }),
    searchFingerprint({ ...base, geographyValue: '32084', term: 'ac repair' }),
    'the same words in two ZIPs share one identity');
  assert.notEqual(
    searchFingerprint({ ...base, term: 'ac repair' }),
    searchFingerprint({ ...base, marketId: 'a-market', term: 'ac repair' }));
});

// ------------------------------------------------------------------ dry run -----

test('the plan can be read before a penny is spent', async () => {
  const plan = await planDiscoverySearches(planRequest(4));
  const printed = renderSearchPlan(plan);

  for (const search of plan.searches) {
    assert.ok(printed.includes(search.keyword), `"${search.keyword}" is not in the plan`);
    assert.ok(printed.includes(search.fingerprint));
  }
  // A ZIP nothing in inventory sits in resolves to the country, deliberately: a ZIP
  // is not guessed into a town it might not be in. The plan shows what the provider
  // will actually be sent, which is the point of printing it.
  assert.match(printed, /in United States/);

  // With a company in that ZIP the town is known, and the plan says so.
  await query(
    `insert into accounts (canonical_name, normalized_name) values ('Plan Neighbour', 'plan neighbour')
     returning account_id`);
  await query(
    `insert into locations (account_id, location_type, city, state_region, postal_code)
     select account_id, 'service_area', 'St. Augustine', 'FL', $1 from accounts
      where canonical_name = 'Plan Neighbour'`, [ZIP]);

  const resolved = await planDiscoverySearches(planRequest(1));
  assert.match(renderSearchPlan(resolved), /in St\. Augustine,Florida,United States/,
    'a ZIP we do hold inventory in was still sent to the provider as a country');
});

test('a plan that cannot be built explains itself rather than printing nothing', async () => {
  const noVertical = await planDiscoverySearches(planRequest(5, { verticalProfileId: null }));
  assert.match(renderSearchPlan(noVertical), /Pick a vertical/);

  const badPlace = await planDiscoverySearches(planRequest(5, { geographyValue: 'nowhere' }));
  assert.match(renderSearchPlan(badPlace), /not a ZIP code/);
});

// ------------------------------------------------------- through the real run ----

/** Records every search it is asked for, and answers each one differently. */
function countingAdapter(state: { seen: DiscoveryQuery['search'][] }) {
  registerDiscoveryAdapter({
    name: 'counting', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      state.seen.push(request.search);
      const index = request.search?.index ?? 0;
      return {
        status: 'OK',
        observations: observationsFor([{
          name: `batch${index}.invalid`, website: `https://batch${index}.invalid`,
          phone: null, city: null, state: null, postalCode: null,
          resultType: 'PAID_SEARCH_TEXT', query: request.search?.term ?? null,
        }]),
        costUsd: 0.006,
      };
    },
  });
}

async function mine(count: number): Promise<Record<string, any>> {
  const ops = await makeUser(`Batch Ops ${Date.now()}${Math.random()}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: ZIP,
    marketId: null, requestedBy: ops.userId, queryBudget: count,
  });
  await drainQueue();
  const { rows } = await query<Record<string, any>>(
    'select outcome, outcome_reason, progress from jobs where job_id = $1', [job.jobId]);
  return rows[0]!;
}

test('a run asked for five searches makes five provider calls', async () => {
  const state = { seen: [] as DiscoveryQuery['search'][] };
  countingAdapter(state);
  const job = await mine(5);

  assert.equal(state.seen.length, 5,
    `five searches were asked for and ${state.seen.length} were made`);
  assert.equal(new Set(state.seen.map((search) => search!.keyword)).size, 5,
    'the same words were bought more than once');
  assert.equal(job['progress']['searchesPlanned'], 5);
  assert.equal(job['progress']['perSearch'].length, 5);
});

test('each search gets its own outcome, not a shared one', async () => {
  registerDiscoveryAdapter({
    name: 'mixed', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      const index = request.search?.index ?? 0;
      if (index === 1) {
        return { status: 'OK',
          observations: observationsFor([{ name: 'first.invalid', website: 'https://first.invalid', phone: null,
            city: null, state: null, postalCode: null }]),
          costUsd: 0.006 };
      }
      if (index === 2) return refusedDiscovery('OUTAGE', 'the provider did not answer');
      return { status: 'ZERO_RESULTS', observations: observationsFor([]), reason: 'nothing usable' };
    },
  });

  const job = await mine(3);
  const perSearch = job['progress']['perSearch'] as Record<string, any>[];
  assert.equal(perSearch.length, 3);
  assert.deepEqual(perSearch.map((row) => row['status']),
    ['OK', 'OUTAGE', 'ZERO_RESULTS'],
    'the searches were collapsed into one outcome, so four dead searches and one '
    + 'good one look the same as five good ones');

  // One of three failing is a partial market, not a complete one.
  assert.equal(job['outcome'], 'PARTIAL');
  assert.match(String(job['outcome_reason']), /part of the/);
  // And the note says which search failed, because "the provider did not answer" is
  // useless when three were asked.
  const notes = job['progress']['notes'] as string[];
  assert.ok(notes.some((note) => /^mixed "/.test(note)),
    `a note does not say which search it is about: ${notes.join(' | ')}`);
});

test('a search already owed is collected while its siblings are still bought', async () => {
  let submissions = 0;
  let collections = 0;
  registerDiscoveryAdapter({
    name: 'partial-owed', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      submissions += 1;
      if (request.search?.index === 1) {
        return { ...refusedDiscovery('PENDING', 'accepted, not ready'),
          providerTaskId: `owed-${request.search.index}` };
      }
      return { status: 'ZERO_RESULTS', observations: observationsFor([]), };
    },
    async collect(providerTaskId): Promise<DiscoveryResult> {
      collections += 1;
      return { status: 'OK',
        observations: observationsFor([{ name: 'collected.invalid', website: 'https://collected.invalid',
          phone: null, city: null, state: null, postalCode: null }]),
        providerTaskId };
    },
  });

  await mine(3);
  assert.equal(submissions, 3);
  assert.equal(collections, 0);

  // Second run: search one is owed and gets collected; two and three are bought again.
  await mine(3);
  assert.equal(collections, 1,
    'the outstanding task was not collected, or every sibling was treated as owed too');
  assert.equal(submissions, 5,
    `${submissions - 3} sibling searches ran on the second pass; one task outstanding `
    + 'must not stop the other two');
});

test('a provider ceiling below the count is reported, not silently obeyed', async () => {
  const plan = await planDiscoverySearches(planRequest(8, { providerMaxQueries: 3 }));
  assert.equal(plan.searches.length, 3);
  assert.equal(plan.limitedBy, 'PROVIDER_CEILING');
  assert.match(renderSearchPlan(plan), /per-run ceiling allows 3/);
});

test('the default is one search, so making the count real did not multiply the spend', async () => {
  const state = { seen: [] as DiscoveryQuery['search'][] };
  countingAdapter(state);
  const ops = await makeUser(`Default Ops ${Date.now()}`, 'RESEARCH_OPS');
  // No queryBudget at all: what a scheduled market refresh looks like.
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: ZIP,
    marketId: null, requestedBy: ops.userId,
  });
  await drainQueue();

  assert.equal(state.seen.length, 1,
    `an unspecified budget bought ${state.seen.length} searches. Making the count real `
    + 'must not turn every scheduled refresh into twenty-five paid searches.');
});
