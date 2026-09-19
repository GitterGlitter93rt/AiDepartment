import { query } from '../db/pool.js';
import { planDiscoverySearches } from './searchPlan.js';
import { assumedRunCostUsd } from './spend.js';
import { classifyGeographyForInventory } from './geography.js';
import { miningModeOrDefault } from './miningMode.js';

/**
 * How much of a market we have, and what we have not asked.
 *
 * The one thing this must never do is report a percentage. Nobody knows how many
 * roofers are in 32095 -- not us, not the provider, not the ZIP -- so "68% covered"
 * would be a number with no denominator, and an operator would plan against it.
 *
 * What can be said honestly is smaller and more useful: which search terms we have
 * asked, which we have not, what the last few searches yielded, and whether new
 * searches are still finding companies we did not have. That last one is the real
 * coverage signal, and it has a boundary worth stating -- a market is saturated *for
 * the terms we asked*, which is not the same as exhausted.
 *
 * Two columns exist for this and neither has ever been used.
 * `saved_markets.saturation_state` is written by nothing and read by nothing.
 * `target_inventory_depth` is printed on the Markets page as "Target depth: not set"
 * and influences no decision anywhere -- an operator can state a goal the system
 * then ignores, which is worse than having no field at all.
 */

export type Saturation =
  /** Nothing has ever searched this market. */
  | 'NEVER_SEARCHED'
  /** Searches are still turning up companies we did not hold. */
  | 'STILL_FINDING'
  /** The terms we have asked have stopped finding anyone new. Other terms remain. */
  | 'SATURATED_FOR_TERMS_ASKED'
  /** Every term the vertical defines has been asked, and the last ones found nobody. */
  | 'SATURATED_FOR_VERTICAL'
  /** Runs happened but none of them reached a provider, so nothing is known. */
  | 'UNKNOWN';

export interface TermYield {
  term: string;
  newAccounts: number;
  matchedExisting: number;
  lastRunAt: Date;
}

export interface MarketCoverage {
  vertical: string | null;
  geography: { type: string; value: string; display: string } | null;
  inventory: number;
  repReady: number;
  /** Terms the vertical defines and this system would ask. */
  termsDefined: number;
  termsAsked: string[];
  termsNotAsked: string[];
  lastMinedAt: Date | null;
  recentYield: TermYield[];
  saturation: Saturation;
  /** What the unasked terms would cost to run. */
  nextSearches: { term: string; keyword: string; fingerprint: string }[];
  estimatedCostUsd: number;
  /** The operator's stated goal for this market, when they set one. */
  targetDepth: number | null;
  /** Progress against that goal, or null when none is set. */
  towardTarget: { held: number; target: number; shortfall: number } | null;
  /** The sentence that stops this being read as a percentage. */
  denominatorNote: string;
}

export async function marketCoverage(input: {
  vertical: string | null;
  location: string | null;
  marketId?: string | null;
  miningMode?: string;
}): Promise<MarketCoverage> {
  const classified = input.location ? classifyGeographyForInventory(input.location) : null;
  const geography = classified?.ok
    ? { type: classified.type, value: classified.value, display: classified.display }
    : null;

  // What we hold here, from the base tables rather than the inventory view: the
  // question is a count, and counting through seven lateral subqueries to get one is
  // how the coverage endpoint used to cost 229ms.
  const scope: string[] = ['a.merged_into_account_id is null', 'not a.is_suppressed'];
  const values: unknown[] = [];
  if (input.vertical) {
    values.push(input.vertical);
    scope.push(`a.primary_vertical_profile_id = $${values.length}`);
  }
  if (geography) {
    values.push(geography.value);
    const column = geography.type === 'zip_zcta' ? 'l.postal_code'
      : geography.type === 'state' ? 'l.state_region' : 'l.city';
    const comparison = geography.type === 'zip_zcta'
      ? `${column} = $${values.length}`
      : `lower(${column}) = lower($${values.length})`;
    // Verified address, or the market it was discovered in -- the same reading the
    // rep's search uses. The miner no longer invents a location from the searched
    // geography, so a company found in a ZIP without a published address has no
    // location row; counting only addresses would tell a rep the market holds one
    // company while the list beside it shows six.
    scope.push(`(exists (select 1 from locations l
                          where l.account_id = a.account_id and ${comparison})
                 or a.discovered_for_geography = $${values.length})`);
  }

  const { rows: inventoryRows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts a where ${scope.join(' and ')}`, values);
  const inventory = inventoryRows[0]!.n;

  // Rep-ready is per-Account work, so a bounded sample rather than the whole scope.
  const { rows: sampleRows } = await query<{ account_id: string }>(
    `select a.account_id from accounts a where ${scope.join(' and ')}
      order by a.updated_at desc limit 50`, values);
  const { readinessFor } = await import('../domain/repReady.js');
  let repReady = 0;
  for (const row of sampleRows) {
    const readiness = await readinessFor(row.account_id);
    if (readiness?.state === 'REP_READY') repReady += 1;
  }

  // What has actually been asked. Read from the observations, because that is the
  // record of a search that reached a provider and came back.
  //
  // Scoped by the job that made the search, not by the Accounts it produced. The
  // vertical used to be established through `o.account_id`, which meant a search
  // whose rows all turned out to be directories -- no Account, so no account row to
  // join to -- counted as never asked, and the coverage page would propose buying it
  // again. A term that cost money and returned a page of directories has been asked;
  // what it found is a separate question, and the columns beside it answer that.
  const { rows: askedRows } = await query<{
    query: string; new_accounts: number; matched: number; last_run: Date;
  }>(
    `select o.query,
            count(distinct case when act.activity_type = 'DISCOVERED'
                                 and act.occurred_at >= o.observed_at - interval '1 minute'
                               then o.account_id end)::int as new_accounts,
            count(distinct o.account_id)::int as matched,
            max(o.observed_at) as last_run
       from search_observations o
       left join jobs j on j.job_id = o.job_id
       left join activities act on act.account_id = o.account_id
      where o.query is not null
        and ($1::text is null
             or j.payload->>'vertical_profile_id' = $1
             -- Observations written before jobs carried a payload vertical, and
             -- listings rows that belong to no job at all.
             or exists (
               select 1 from accounts a where a.account_id = o.account_id
                 and a.primary_vertical_profile_id = $1))
      group by o.query
      order by max(o.observed_at) desc`,
    [input.vertical]);

  const plan = await planDiscoverySearches({
    verticalProfileId: input.vertical,
    geographyType: geography?.type ?? null,
    geographyValue: geography?.value ?? null,
    miningMode: miningModeOrDefault(input.miningMode),
    count: 100,
    ...(input.marketId ? { marketId: input.marketId } : {}),
  });

  // A term is "asked" when a search of it produced an observation here. Matched on
  // the term inside the keyword, because the keyword carries the geography too.
  const askedTerms = new Set(askedRows.map((row) => row.query.toLowerCase()));
  const asked: string[] = [];
  const notAsked: typeof plan.searches = [];
  for (const search of plan.searches) {
    const hit = [...askedTerms].some((query) => query.includes(search.term.toLowerCase()));
    if (hit) asked.push(search.term);
    else notAsked.push(search);
  }

  const { rows: minedRows } = await query<{ last_mined: Date | null; answered: number }>(
    `select max(completed_at) as last_mined,
            count(*) filter (where outcome in ('COMPLETED','ZERO_RESULTS','PARTIAL'))::int
              as answered
       from jobs
      where job_type = 'market_mine' and status = 'SUCCEEDED'
        and ($1::text is null or payload->>'geography_value' = $1)`,
    [geography?.value ?? null]);
  const lastMinedAt = minedRows[0]?.last_mined ?? null;
  const answeredRuns = minedRows[0]?.answered ?? 0;

  const recentYield: TermYield[] = askedRows.slice(0, 5).map((row) => ({
    term: row.query,
    newAccounts: row.new_accounts,
    matchedExisting: Math.max(0, row.matched - row.new_accounts),
    lastRunAt: row.last_run,
  }));

  // Saturation, with its boundary said out loud.
  //
  // "The terms we asked stopped finding anyone" is a fact about our questions. It
  // becomes a fact about the vertical only when there are no questions left.
  let saturation: Saturation;
  if (asked.length === 0 && answeredRuns === 0) saturation = 'NEVER_SEARCHED';
  else if (answeredRuns === 0) saturation = 'UNKNOWN';
  else if (recentYield.length > 0 && recentYield.some((entry) => entry.newAccounts > 0)) {
    saturation = 'STILL_FINDING';
  } else if (notAsked.length === 0) saturation = 'SATURATED_FOR_VERTICAL';
  else saturation = 'SATURATED_FOR_TERMS_ASKED';

  const { rows: marketRows } = input.marketId
    ? await query<{ target: number | null }>(
      'select target_inventory_depth as target from saved_markets where market_id = $1',
      [input.marketId])
    : { rows: [] as { target: number | null }[] };
  const targetDepth = marketRows[0]?.target ?? null;

  return {
    vertical: input.vertical,
    geography,
    inventory,
    repReady,
    termsDefined: plan.available,
    termsAsked: asked,
    termsNotAsked: notAsked.map((search) => search.term),
    lastMinedAt,
    recentYield,
    saturation,
    nextSearches: notAsked.map((search) => ({
      term: search.term, keyword: search.keyword, fingerprint: search.fingerprint,
    })),
    estimatedCostUsd: Number((notAsked.length * assumedRunCostUsd()).toFixed(4)),
    targetDepth,
    towardTarget: targetDepth === null ? null : {
      held: inventory, target: targetDepth,
      shortfall: Math.max(0, targetDepth - inventory),
    },
    denominatorNote:
      'There is no percentage here on purpose. Nobody knows how many businesses of a '
      + 'trade are in a place — not us, not the provider — so a coverage figure would '
      + 'be a fraction with an invented denominator. What is below is what we asked, '
      + 'what we found, and what we have not asked yet.',
  };
}

/**
 * Records what the planner concluded, so the column means something.
 *
 * `saturation_state` has existed since the markets table was written and nothing has
 * ever set it. Written here rather than guessed at read time, because the conclusion
 * depends on run history that gets pruned and on terms that change when a profile is
 * edited.
 */
export async function recordSaturation(
  marketId: string, saturation: Saturation,
): Promise<void> {
  await query(
    'update saved_markets set saturation_state = $2, updated_at = now() where market_id = $1',
    [marketId, saturation]);
}

const SATURATION_WORDS: Record<Saturation, string> = {
  NEVER_SEARCHED: 'nothing has searched this market yet',
  STILL_FINDING: 'searches are still turning up companies we did not have',
  SATURATED_FOR_TERMS_ASKED:
    'the terms we have asked have stopped finding anyone new — others remain unasked',
  SATURATED_FOR_VERTICAL:
    'every term this vertical defines has been asked, and the last ones found nobody new',
  UNKNOWN: 'runs happened but none reached a provider, so nothing is known either way',
};

export function renderMarketCoverage(coverage: MarketCoverage): string {
  const lines = ['', 'MARKET COVERAGE', ''];
  lines.push(`  ${coverage.vertical ?? 'no vertical'} in `
    + `${coverage.geography?.display ?? 'nowhere given'}`);
  lines.push('');
  lines.push(`  held         ${coverage.inventory} compan(ies)`);
  lines.push(`  rep-ready    ${coverage.repReady} of the most recent 50`);
  lines.push(`  last mined   ${coverage.lastMinedAt?.toISOString().slice(0, 16) ?? 'never'}`);
  lines.push(`  saturation   ${coverage.saturation} — ${SATURATION_WORDS[coverage.saturation]}`);

  if (coverage.towardTarget) {
    lines.push(`  target       ${coverage.towardTarget.held} of `
      + `${coverage.towardTarget.target} wanted`
      + (coverage.towardTarget.shortfall > 0
        ? `, ${coverage.towardTarget.shortfall} short` : ', reached'));
  } else {
    lines.push('  target       not set for this market');
  }
  lines.push('');

  lines.push(`  asked (${coverage.termsAsked.length} of ${coverage.termsDefined} terms)`);
  lines.push(coverage.termsAsked.length === 0 ? '     none'
    : coverage.termsAsked.map((term) => `     ${term}`).join('\n'));
  lines.push('');

  if (coverage.recentYield.length > 0) {
    lines.push('  what the last searches found');
    for (const entry of coverage.recentYield) {
      lines.push(`     "${entry.term}": ${entry.newAccounts} new, `
        + `${entry.matchedExisting} already held`);
    }
    lines.push('');
  }

  lines.push(`  not asked (${coverage.termsNotAsked.length} terms, `
    + `~$${coverage.estimatedCostUsd.toFixed(3)} to run)`);
  lines.push(coverage.nextSearches.length === 0
    // Zero unasked terms out of zero defined is not the same as having asked them
    // all. Without a vertical there is no taxonomy, and "every term has been asked"
    // is vacuously true -- it reads as complete coverage of a market nobody searched.
    ? (coverage.termsDefined === 0
      ? '     none — this market has no term list, so there is nothing to ask'
      : '     none — every term has been asked')
    : coverage.nextSearches.map((search) => `     "${search.keyword}"`).join('\n'));
  lines.push('');
  lines.push(`  ${coverage.denominatorNote}`);
  lines.push('');
  return lines.join('\n');
}
