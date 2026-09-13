import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import { clearDiscoveryAdapters } from '../src/workers/marketMiner.js';
import { registerConfiguredDiscoveryAdapters } from '../src/miner/registry.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { scoreAccount } from '../src/scoring/score.js';
import { searchProspects, coverageFor } from '../src/domain/search.js';

/**
 * One market, a hundred rows, and an answer that must not drift.
 * Authority: Issue #3 AX.
 *
 * Every other test here proves one rule about one company. This one asks the
 * question an operator asks: a rep searched a market, so what came back, in what
 * order, and does the arithmetic between the provider's rows and the rep's list
 * still add up? At this size the failures are different in kind -- a dedupe rule
 * that is slightly too eager merges two real companies rather than one duplicate,
 * an unstable sort reorders the list between page loads, and a coverage count and
 * an inventory count quietly stop agreeing.
 *
 * The market is constructed rather than sampled: every row is a function of its
 * index, so the expected answer is arithmetic and a drift is a diff, not a
 * judgement call.
 */

const CREDENTIALLED: NodeJS.ProcessEnv = {
  DATAFORSEO_LOGIN: 'golden@example.invalid', DATAFORSEO_PASSWORD: 'golden-secret',
  DATAFORSEO_ENABLED: 'true', DATAFORSEO_GOVERNANCE_REVIEWED: 'true',
  DATAFORSEO_POLL_INTERVAL_MS: '0', DATAFORSEO_MODE: 'live',
};

const COMPANIES = 80;
/** Companies that bought the ad and also rank organically: two rows, one company. */
const ALSO_ORGANIC = 12;
/** Rows with nothing to identify them: a heading, a category page, a map label. */
const UNIDENTIFIABLE = 8;

function slug(index: number): string { return `golden${String(index).padStart(3, '0')}`; }

/**
 * The market, built from the index and nothing else.
 *
 * Every fourth company is a paid advertiser, every seventh has no website and must
 * be identified by its phone, and the rest rank organically.
 */
function marketItems(): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  let rank = 0;

  for (let index = 0; index < COMPANIES; index += 1) {
    rank += 1;
    const paid = index % 4 === 0;
    const phoneOnly = index % 7 === 3;
    items.push({
      type: paid ? 'paid' : 'organic',
      rank_group: rank, rank_absolute: rank,
      title: paid
        ? `Emergency AC Repair — Book Today #${index}`
        : `Golden HVAC ${index}`,
      domain: phoneOnly ? undefined : `${slug(index)}.invalid`,
      phone: phoneOnly ? `+1 904-555-${String(2000 + index).slice(-4)}` : undefined,
      url: phoneOnly ? undefined : `https://${slug(index)}.invalid/ac-repair`,
      description: 'Licensed and insured.',
    });
  }

  // The same companies again, organically. These must collapse, and the paid row
  // must be the one that survives.
  for (let index = 0; index < ALSO_ORGANIC; index += 1) {
    const target = index * 4; // the paid ones
    rank += 1;
    items.push({
      type: 'organic', rank_group: rank, rank_absolute: rank,
      title: `Golden HVAC ${target} — Service Area`,
      domain: `${slug(target)}.invalid`,
      url: `https://${slug(target)}.invalid/service-area`,
    });
  }

  // Rows a provider returns that are not companies.
  for (let index = 0; index < UNIDENTIFIABLE; index += 1) {
    rank += 1;
    items.push({
      type: index % 2 === 0 ? 'local_pack' : 'organic',
      rank_group: rank, rank_absolute: rank,
      title: `HVAC Contractors in St. Augustine (${index})`,
    });
  }

  return items;
}

const TOTAL_ROWS = COMPANIES + ALSO_ORGANIC + UNIDENTIFIABLE;

/** Indices of the companies identified only by a phone number. */
const PHONE_ONLY = [...Array(COMPANIES).keys()].filter((index) => index % 7 === 3);

/**
 * The duplicate pairs that cannot collapse, and should not.
 *
 * A company whose ad shows a phone and no website, and whose organic row shows a
 * website and no phone, shares no identifier between its two rows. The adapter
 * collapses on domain, or on phone when there is no domain, and deliberately goes no
 * further: guessing that two rows are one company because they look similar is how a
 * rep ends up calling one business about another's advertising. Entity resolution
 * merges these later, when it has fetched the website and can see the phone number
 * on it -- with more to go on than a single search page.
 */
const AMBIGUOUS_PAIRS = [...Array(ALSO_ORGANIC).keys()]
  .map((index) => index * 4)
  .filter((target) => PHONE_ONLY.includes(target));

const COLLAPSING_PAIRS = ALSO_ORGANIC - AMBIGUOUS_PAIRS.length;

/**
 * Which of these eighty companies the promotion rules will actually accept.
 *
 * Derived from the index like everything else here, because the answer moved and a
 * hand-counted number would hide why. An advertiser whose only row is a text ad is
 * no longer promoted: its title is ad copy -- "Emergency AC Repair — Book Today
 * #48" -- and nothing else in the response says whose domain that is. Naming an
 * Account after a slogan is what put sixty-five page titles in a rep's list, and a
 * paid placement on an otherwise unattested domain is equally consistent with an
 * aggregator, a franchise portal or a lead-generation marketplace.
 *
 * They are not lost. Each is a `NEEDS_REVIEW` candidate with its ad copy, its domain
 * and the reason recorded, waiting for a verification step that can read the site.
 *
 * A company promotes when one of these is true:
 *   - it is not an advertiser, so its own organic title names it;
 *   - it advertises *and* also ranks organically, so the organic row names it;
 *   - it has no website and a non-paid row gives it a name and a phone.
 */
const isPaid = (index: number): boolean => index % 4 === 0;
const isPhoneOnly = (index: number): boolean => index % 7 === 3;
/** The advertisers that also rank organically, by company index. */
const ALSO_ORGANIC_TARGETS = new Set([...Array(ALSO_ORGANIC).keys()].map((i) => i * 4));

const PROMOTED = [...Array(COMPANIES).keys()].filter((index) => {
  if (!isPaid(index)) return true;
  return ALSO_ORGANIC_TARGETS.has(index);
});
/**
 * Advertisers whose ad is all we have. Kept as candidates, not promoted.
 * Includes the phone-only advertiser with no organic row: an advertised number with
 * no name we can trust is not a company either.
 */
const UNCORROBORATED_ADVERTISERS = [...Array(COMPANIES).keys()]
  .filter((index) => isPaid(index) && !ALSO_ORGANIC_TARGETS.has(index));

/**
 * One Account per promoted company.
 *
 * The ambiguous pair no longer adds one. Company 24 advertises with a phone and no
 * website and also ranks organically on its own domain: the domain identity promotes
 * from the organic row, and the advertised phone -- named only by ad copy -- does not.
 */
const EXPECTED_ACCOUNTS = PROMOTED.length;
/**
 * Paid rows that end up attached to an Account.
 *
 * Not simply "promoted advertisers". Company 24 advertises with a phone and no
 * website, so its ad is held under the phone as an identity of its own -- and that
 * identity is named by ad copy alone, so it stays a candidate. The company itself is
 * an Account, promoted from its organic row on its own domain. One company, two
 * identities, and only one of them is attached to it.
 */
const PAID_COMPANIES = PROMOTED.filter((index) => isPaid(index) && !isPhoneOnly(index)).length;
/** Every row the provider sent, all of which are recorded whatever they became. */
const EXPECTED_OBSERVATIONS = TOTAL_ROWS;

/**
 * What the evidence written below is worth, per the ruleset rather than per my
 * arithmetic. Every second Account gets Google (4), every fourth also gets Meta (3),
 * every eighth also gets an emergency claim (1) -- and two independent paid channels
 * earn a further point that no caller asserts, which is exactly the sort of thing a
 * hand-counted expectation misses.
 */
function expectedScore(position: number): number {
  let points = 0;
  if (position % 2 === 0) points += 4;                 // google_paid_search_confirmed
  if (position % 4 === 0) points += 3 + 1;             // meta + the derived two-channel point
  if (position % 8 === 0) points += 1;                 // emergency_after_hours
  return points;
}

const EXPECTED_TIERS = [...Array(EXPECTED_ACCOUNTS).keys()]
  .reduce<Record<string, number>>((counts, position) => {
    const points = expectedScore(position);
    const tier = points >= 9 ? 'A' : points >= 6 ? 'B' : points >= 3 ? 'C' : 'D';
    counts[tier] = (counts[tier] ?? 0) + 1;
    return counts;
  }, {});

const BEST_SCORE = Math.max(...[...Array(EXPECTED_ACCOUNTS).keys()].map(expectedScore));

function response(): unknown {
  return {
    version: '0.1.20260801', status_code: 20000, status_message: 'Ok.', cost: 0.0075,
    tasks_count: 1, tasks_error: 0,
    tasks: [{
      id: 'golden-task-1', status_code: 20000, status_message: 'Ok.', cost: 0.0075,
      result_count: 1,
      result: [{
        keyword: 'ac repair 32095', type: 'organic',
        location_name: 'St. Augustine,Florida,United States', language_code: 'en',
        check_url: 'https://www.google.com/search?q=ac+repair+32095',
        datetime: '2026-09-05 06:00:00 +00:00',
        items_count: TOTAL_ROWS, items: marketItems(),
      }],
    }],
  };
}

let realFetch: typeof globalThis.fetch;
/**
 * The market is mined once and then only read.
 *
 * Every assertion below is a question about the same market, so re-mining per test
 * would spend seven minutes proving the miner is deterministic -- which the second
 * assertion in the paging test already proves in one line.
 */
let minedProgress: Record<string, any>;

before(async () => {
  realFetch = globalThis.fetch;
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  globalThis.fetch = (async () => new Response(JSON.stringify(response()),
    { status: 200, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch;
  minedProgress = (await mineTheMarket()).progress;
  await scoreTheMarket();
});
after(async () => { globalThis.fetch = realFetch; clearDiscoveryAdapters(); await pool.end(); });

async function mineTheMarket(): Promise<{ jobId: string; progress: Record<string, any> }> {
  const ops = await makeUser(`Golden Ops ${Date.now()}${Math.random()}`, 'RESEARCH_OPS');
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId,
  });
  await drainQueue();
  const { rows } = await query<{ progress: Record<string, any> }>(
    'select progress from jobs where job_id = $1', [job.jobId]);
  return { jobId: job.jobId, progress: rows[0]!.progress };
}

// ------------------------------------------------------------ the arithmetic ----

test('the funnel from provider rows to inventory adds up exactly', async () => {
  const progress = minedProgress;

  assert.equal(progress['providerRows'], TOTAL_ROWS,
    'the provider sent a hundred rows and the run counted a different number');
  assert.equal(progress['rejectedRows'], UNIDENTIFIABLE,
    'rows with nothing to identify them were kept, or real companies were dropped');
  assert.equal(progress['providerDuplicates'], COLLAPSING_PAIRS,
    'a company that bought the ad and also ranks organically was counted twice');
  assert.equal(progress['discoveredNew'], EXPECTED_ACCOUNTS);
  assert.equal(progress['matchedExisting'], 0);

  // The advertisers we could not attribute are reported, not silently absent. This
  // is the number that makes the arithmetic below readable: without it a market of
  // eighty companies yielding seventy-two Accounts looks like eight lost rows.
  assert.equal(Number(progress['entitiesNeedingReview']),
    UNCORROBORATED_ADVERTISERS.length + AMBIGUOUS_PAIRS.length,
    'an advertiser nothing corroborated was dropped rather than kept for review');
  assert.equal(Number(progress['entitiesRejected']), 0,
    'this market contains no directories or publishers, so nothing should be refused');

  // Rows in equals identities out plus what was dropped, at the run level and not
  // only inside the adapter. Identities, not Accounts: an identity that was not
  // promoted is still an identity the run resolved and recorded.
  const identities = Number(progress['discoveredNew']) + Number(progress['matchedExisting'])
    + Number(progress['entitiesNeedingReview']) + Number(progress['entitiesRejected']);
  assert.equal(
    Number(progress['providerRows']) - Number(progress['rejectedRows'])
      - Number(progress['providerDuplicates']),
    identities,
    'the operator cannot reconcile what the provider sent with what reached inventory');
});

test('every company in the market becomes exactly one Account', async () => {
  const accounts = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(accounts.rows[0]!.n, EXPECTED_ACCOUNTS);

  // Every row the provider sent is on record, whatever it became. This used to be
  // one observation per Account, written inside the promotion loop -- so a refused
  // row left no trace and the evidence for a decision existed only when the decision
  // was yes.
  const observations = await query<{ n: number }>(
    `select count(*)::int as n from search_observations where source_type = 'discovery'`);
  assert.equal(observations.rows[0]!.n, EXPECTED_OBSERVATIONS,
    'the provider sent a hundred rows and fewer than a hundred were recorded');

  // And the rows that became a company are attached to it; the rest are not.
  const attached = await query<{ n: number }>(
    `select count(distinct account_id)::int as n from search_observations
      where account_id is not null`);
  assert.equal(attached.rows[0]!.n, EXPECTED_ACCOUNTS);

  const paid = await query<{ n: number }>(
    `select count(*)::int as n from search_observations
      where result_type = 'paid_search' and account_id is not null`);
  assert.equal(paid.rows[0]!.n, PAID_COMPANIES,
    'an organic row displaced a paid one somewhere in the collapse, losing the ad evidence');
});

test('two rows with no identifier in common stay two candidates', async () => {
  // Not a defect: the adapter refuses to guess, and says so by leaving the pair
  // apart for entity resolution rather than merging on a resemblance.
  assert.equal(AMBIGUOUS_PAIRS.length, 1, 'the fixture no longer contains this case');
  const target = AMBIGUOUS_PAIRS[0]!;

  // Two identities, still. What changed is that only one of them is a company: the
  // organic row names the domain, and the advertised phone is named by ad copy alone.
  const { rows } = await query<{ identity: string; entity_status: string }>(
    `select identity, entity_status from discovery_candidates
      where identity = $1 or identity like $2 order by identity`,
    [`${slug(target)}.invalid`, `%${String(2000 + target).slice(-4)}%`]);
  assert.equal(rows.length, 2,
    'the resolver merged an ad and an organic result that share no identifier, which '
    + 'is a guess about which company is which');
  assert.deepEqual(rows.map((row) => row.entity_status).sort(),
    ['NEEDS_REVIEW', 'VERIFIED']);

  const accounts = await query<{ n: number }>(
    `select count(*)::int as n from accounts where canonical_domain = $1`,
    [`${slug(target)}.invalid`]);
  assert.equal(accounts.rows[0]!.n, 1);
});

test('no two companies in one market were merged into each other', async () => {
  // The failure this guards is the one that hid behind a shared provider id: at this
  // size it shows up as a count, and as a canonical domain held by two Accounts.
  const { rows } = await query<{ canonical_domain: string; n: number }>(
    `select canonical_domain, count(*)::int as n from accounts
      where canonical_domain is not null group by canonical_domain having count(*) > 1`);
  assert.deepEqual(rows, []);

  const distinct = await query<{ n: number }>(
    'select count(distinct canonical_name)::int as n from accounts');
  assert.equal(distinct.rows[0]!.n, EXPECTED_ACCOUNTS, 'two companies ended up sharing a name');
});

// ------------------------------------------------------------ the rep’s list ----

/**
 * Evidence for a known slice of the market, written from the index so the expected
 * tiers are arithmetic rather than a guess.
 *
 * The research the mine queued is deliberately not run here. The crawler spaces
 * requests 1.5 seconds apart per host, which is correct and must not be weakened for
 * a test -- and eighty-one companies each crawling their own host is twelve minutes
 * to prove something this file is not about. The research pipeline is exercised
 * properly in researchFixtures and repDay, on a handful of companies with real page
 * content. Here the Accounts are stamped as researched directly, in the same place
 * and for the same reason the evidence is written by hand: the subject is dedupe,
 * funnel arithmetic and ranking.
 */
async function scoreTheMarket(): Promise<void> {
  const { rows } = await query<{ account_id: string; canonical_name: string }>(
    'select account_id, canonical_name from accounts order by canonical_name');

  for (const [position, account] of rows.entries()) {
    const claims: string[] = [];
    if (position % 2 === 0) claims.push('active_google_search_ad');
    if (position % 4 === 0) claims.push('active_meta_ad');
    if (position % 8 === 0) claims.push('emergency_24_7_service');
    for (const claim of claims) {
      await query(
        `insert into evidence_records
           (account_id, category, claim_key, claim_text, normalized_value, confidence,
            can_state_as_fact, source_type, source_provider, expires_at, freshness)
         values ($1, 'paid_acquisition', $2, $3, 'yes', 'confirmed', true, 'provider_serp',
                 'dataforseo', now() + interval '48 hours', 'fresh')`,
        [account.account_id, claim, `${claim} observed`]);
    }
    await scoreAccount(account.account_id);
  }

  await query(
    `update accounts set last_researched_at = now(),
            research_fresh_until = now() + interval '10 days'
      where merged_into_account_id is null`);
}

test('the ranked list is the same list twice, and the top of it is the right top', async () => {
  const rep = await makeUser(`Golden Rep ${Date.now()}`, 'SALES_REP');
  const viewer = { userId: rep.userId, role: 'SALES_REP' as const };
  const request = {
    geography: { type: 'zip_zcta' as const, value: '32095' },
    sort: 'manual_score' as const, pageSize: 10,
  };

  const first = await searchProspects(request, viewer);
  const again = await searchProspects(request, viewer);
  assert.deepEqual(
    again.results.map((row: any) => row.account_id),
    first.results.map((row: any) => row.account_id),
    'the same search returned the same companies in a different order, so page two '
    + 'can repeat or skip a company from page one');

  const scores = first.results.map((row: any) => Number(row.manual_score));
  assert.deepEqual([...scores].sort((a, b) => b - a), scores,
    'the list sorted by score is not in score order');
  assert.equal(scores[0], BEST_SCORE, `the strongest company in the market scored ${scores[0]}`);
});

test('paging a market never repeats or loses a company', async () => {
  const rep = await makeUser(`Golden Pager ${Date.now()}`, 'SALES_REP');
  const viewer = { userId: rep.userId, role: 'SALES_REP' as const };

  const seen = new Set<string>();
  for (let page = 1; page <= Math.ceil(EXPECTED_ACCOUNTS / 20); page += 1) {
    const result = await searchProspects({
      geography: { type: 'zip_zcta', value: '32095' },
      sort: 'manual_score', page, pageSize: 20,
    }, viewer);
    for (const row of result.results as any[]) {
      assert.ok(!seen.has(row.account_id),
        `page ${page} repeated a company already shown on an earlier page`);
      seen.add(row.account_id);
    }
  }
  assert.equal(seen.size, EXPECTED_ACCOUNTS,
    'paging through the market did not show every company');
});

test('the tier distribution is the one the evidence implies', async () => {

  const { rows } = await query<{ manual_tier: string; n: number }>(
    `select manual_tier, count(*)::int as n from accounts
      where manual_tier is not null group by manual_tier order by manual_tier`);
  const byTier = Object.fromEntries(rows.map((row) => [row.manual_tier, row.n]));
  assert.deepEqual(byTier, EXPECTED_TIERS,
    'the tiers this market produces are not the ones its evidence implies');
  assert.equal(Object.values(byTier).reduce((sum, n) => sum + n, 0), EXPECTED_ACCOUNTS,
    'some companies came out of the pipeline with no tier at all');
});

test('coverage and inventory tell the operator the same story', async () => {
  const rep = await makeUser(`Golden Coverage ${Date.now()}`, 'SALES_REP');
  const viewer = { userId: rep.userId, role: 'SALES_REP' as const };
  const request = { geography: { type: 'zip_zcta' as const, value: '32095' }, pageSize: 200 };

  const search = await searchProspects(request, viewer);
  const coverage = await coverageFor(request);

  assert.equal(search.total, EXPECTED_ACCOUNTS);
  // Everything here was researched by the run that found it, so the two counts the
  // page shows side by side have to agree.
  assert.equal(coverage.inScopeCount, EXPECTED_ACCOUNTS,
    `the search says ${search.total} companies and coverage says ${coverage.inScopeCount}`);
  assert.equal(coverage.unclaimedCount, EXPECTED_ACCOUNTS,
    'a company was claimed by nobody’s action');

  // Discovered and then researched, because the run that found them queued research
  // and the golden setup drains the queue. Research now stamps the Account, so these
  // count as researched -- which is the point of the two numbers agreeing.
  assert.equal(coverage.researchedCount, EXPECTED_ACCOUNTS,
    `${coverage.researchedCount} of ${EXPECTED_ACCOUNTS} were recorded as researched`);
  assert.equal(coverage.state, 'FRESH',
    `a market researched moments ago reports as ${coverage.state}`);
});
