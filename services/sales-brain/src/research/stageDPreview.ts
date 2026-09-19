import { query } from '../db/pool.js';
import { assumedRunCostUsd } from '../miner/spend.js';
import {
  MAX_QUERIES_PER_ACCOUNT, planStageD, type StageDFacts, type StageDPlan,
} from './stageD.js';

/**
 * What Stage D would ask, and what it would cost, before anybody agrees to pay for it.
 *
 * Read-only in the strongest sense: it selects, it plans, it prices, and there is no
 * code path from here to a provider. The number it produces is the thing being asked
 * for -- "what would a hundred Accounts cost" is a question that has to be answerable
 * without spending anything to find out.
 */

/**
 * The price of one search, taken from what we have actually been charged.
 *
 * `provider_tasks.cost_usd` is the paid ledger: 44 collected tasks in production, every
 * one of them $0.0060. A constant in the code would be a price nobody has checked since
 * the day it was typed, and provider pricing moves. The configured assumption is the
 * fallback for a database that has never bought anything, and it says so.
 */
export async function observedUnitCost(): Promise<{ unitCostUsd: number; basis: string }> {
  const { rows } = await query<{ n: number; avg: string | null; max: string | null }>(
    `select count(*)::int as n, avg(cost_usd)::text as avg, max(cost_usd)::text as max
       from provider_tasks
      where cost_usd is not null and operation = 'serp.discover'`);
  const row = rows[0];
  const n = Number(row?.n ?? 0);
  if (n === 0 || !row?.avg) {
    const assumed = assumedRunCostUsd();
    return {
      unitCostUsd: assumed,
      basis: `no paid task has ever been recorded, so DISCOVERY_ASSUMED_RUN_COST_USD `
        + `($${assumed.toFixed(4)}) is used instead`,
    };
  }
  // The worst observed price, not the average: an estimate that is right on the cheap
  // day and wrong on the expensive one is the wrong way round for a spending decision.
  const worst = Number(row.max ?? row.avg);
  return {
    unitCostUsd: worst,
    basis: `the highest price actually charged across ${n} paid task(s) on the ledger`,
  };
}

export interface AccountStageDPreview {
  accountId: string;
  companyName: string;
  plan: StageDPlan;
  facts: StageDFacts;
}

export interface StageDBatchPreview {
  accounts: AccountStageDPreview[];
  unitCostUsd: number;
  unitCostBasis: string;
  /** Accounts that need nothing bought at all. */
  alreadyAnswered: number;
  totalQueries: number;
  totalCostUsd: number;
  averageQueriesPerAccount: number;
  estimatedCostPer100Usd: number;
  /** The ceiling, for comparison with what the plan actually came to. */
  worstCasePer100Usd: number;
}

/**
 * The facts a query may be built from, read from what is already established.
 *
 * Every column here is something the system holds because it read it: a published
 * address, a contact resolved from a page, a trade supported by evidence. The searched
 * geography is deliberately absent -- a query built from where we looked would return
 * results about where we looked.
 */
async function factsFor(limit: number, offset: number): Promise<AccountStageDPreview[]> {
  // `locations.basis` arrives with migration 053, and this report has to keep running
  // against a database that has not had it applied -- the question it answers is a
  // spending question about production, and production is by definition behind the
  // branch asking. Where the column does not exist, no location can account for itself,
  // so none may shape a query, which is the same answer the column would give.
  const { rows: hasBasis } = await query<{ present: boolean }>(
    `select exists (select 1 from information_schema.columns
                     where table_name = 'locations' and column_name = 'basis') as present`);
  const publishedLocation = hasBasis[0]?.present
    ? `select l.address_line_1, l.city, l.state_region from locations l
        where l.account_id = a.account_id and l.location_type = 'physical'
          and l.basis is not null
        order by l.is_headquarters desc limit 1`
    : `select null::text as address_line_1, null::text as city, null::text as state_region`;

  const { rows } = await query<{
    account_id: string; canonical_name: string; canonical_domain: string | null;
    vertical_profile_id: string | null; person_name: string | null;
    person_role: string | null; street: string | null; city: string | null;
    region: string | null; has_named_email: boolean; has_decision_maker: boolean;
  }>(
    `select a.account_id, a.canonical_name, a.canonical_domain,
            a.primary_vertical_profile_id as vertical_profile_id,
            dm.full_name as person_name,
            dm.raw_title as person_role,
            loc.address_line_1 as street, loc.city, loc.state_region as region,
            exists (select 1 from contact_endpoints e
                     where e.account_id = a.account_id and e.endpoint_type = 'EMAIL'
                       and e.endpoint_role = 'DIRECT_PERSON_EMAIL'
                       and e.quality_state <> 'GUESSED_UNVERIFIED') as has_named_email,
            dm.full_name is not null as has_decision_maker
       from accounts a
       left join lateral (
         select c.full_name, c.raw_title from contacts c
          where c.account_id = a.account_id and c.status = 'ACTIVE'
            and coalesce(c.company_relationship, 'unknown') <> 'registered_agent'
          order by c.decision_maker_priority asc nulls last limit 1
       ) dm on true
       -- Only a location the company published. A row with no basis is the searched
       -- geography or a provider's printed line, and neither may shape a query.
       left join lateral (${publishedLocation}) loc on true
      where a.merged_into_account_id is null and not a.is_suppressed
        and a.entity_status = 'verified'
      order by a.created_at desc
      limit $1 offset $2`, [limit, offset]);

  const pricing = await observedUnitCost();
  return rows.map((row) => {
    const facts: StageDFacts = {
      companyName: row.canonical_name,
      domain: row.canonical_domain,
      knownPersonName: row.person_name,
      knownPersonRole: row.person_role,
      publishedStreet: row.street,
      publishedCity: row.city,
      publishedRegion: row.region,
      verticalProfileId: row.vertical_profile_id,
      hasNamedEmail: row.has_named_email,
      hasDecisionMaker: row.has_decision_maker,
    };
    return {
      accountId: row.account_id,
      companyName: row.canonical_name,
      facts,
      plan: planStageD(facts, pricing),
    };
  });
}

/** What a batch of this size would ask and cost. Buys nothing. */
export async function previewStageDBatch(
  size = 100, offset = 0,
): Promise<StageDBatchPreview> {
  const accounts = await factsFor(size, offset);
  const pricing = await observedUnitCost();

  const totalQueries = accounts.reduce((sum, entry) => sum + entry.plan.queries.length, 0);
  const totalCostUsd = Number((totalQueries * pricing.unitCostUsd).toFixed(4));
  const alreadyAnswered = accounts.filter((entry) => entry.plan.queries.length === 0).length;
  const average = accounts.length > 0 ? totalQueries / accounts.length : 0;

  return {
    accounts,
    unitCostUsd: pricing.unitCostUsd,
    unitCostBasis: pricing.basis,
    alreadyAnswered,
    totalQueries,
    totalCostUsd,
    averageQueriesPerAccount: Number(average.toFixed(2)),
    estimatedCostPer100Usd: Number((average * 100 * pricing.unitCostUsd).toFixed(2)),
    worstCasePer100Usd: Number(
      (MAX_QUERIES_PER_ACCOUNT * 100 * pricing.unitCostUsd).toFixed(2)),
  };
}
