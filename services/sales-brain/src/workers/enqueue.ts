import { query } from '../db/pool.js';
import { normalizeGeography } from '../miner/geography.js';

/**
 * Job enqueue helpers.
 * Idempotency keys stop a repeated button click from launching duplicate provider
 * spend (rep-portal-api-contract.v1.md §5, §17). The partial unique index on
 * `jobs.idempotency_key` covers QUEUED and RUNNING only, so a completed job can be
 * legitimately re-run later.
 */

export interface EnqueueResult {
  jobId: string;
  created: boolean;
}

async function enqueue(input: {
  jobType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  requestedBy?: string | null;
  accountId?: string | null;
  marketId?: string | null;
  priority?: number;
}): Promise<EnqueueResult> {
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, idempotency_key, payload, requested_by, account_id, market_id, priority)
     values ($1,$2,$3,$4,$5,$6,coalesce($7,100))
     on conflict (idempotency_key) where idempotency_key is not null and status in ('QUEUED','RUNNING')
     do nothing
     returning job_id`,
    [
      input.jobType, input.idempotencyKey, JSON.stringify(input.payload),
      input.requestedBy ?? null, input.accountId ?? null, input.marketId ?? null, input.priority ?? null,
    ],
  );

  if (rows[0]) return { jobId: rows[0].job_id, created: true };

  // Joining an existing run, which is the right answer: the work is already queued
  // and a second row would only buy the same thing twice.
  //
  // But who asked has to survive the join. The idempotency key deliberately does not
  // include the requester -- a market is a market however the request arrived -- so a
  // person clicking search on a market the scheduler has already queued is folded
  // into an automatic run, and an automatic pass is folded into a person's run. That
  // was harmless while both ran identically. It is not harmless now that the
  // market_mine handler asks whether a *person* wanted this work before it will buy
  // a search of a paused market: the answer would depend on which request happened to
  // arrive first, so the same two clicks in the other order spend money or do not.
  //
  // A requester is therefore recorded onto a run that had none. It only ever moves
  // from nobody to somebody -- a person did ask for this work, and that stays true --
  // and it never overwrites one person with another, because the first to ask is the
  // one who asked.
  const existing = await query<{ job_id: string }>(
    `update jobs
        set requested_by = coalesce(requested_by, $2)
      where idempotency_key = $1 and status in ('QUEUED','RUNNING')
      returning job_id`,
    [input.idempotencyKey, input.requestedBy ?? null],
  );
  return { jobId: existing.rows[0]?.job_id ?? '', created: false };
}

export async function enqueueContactResearch(
  accountId: string, requestedBy: string,
): Promise<EnqueueResult> {
  return enqueue({
    jobType: 'contact_research',
    idempotencyKey: `contact_research:${accountId}`,
    payload: { account_id: accountId },
    requestedBy,
    accountId,
    priority: 40,
  });
}

export async function enqueueAccountResearch(
  accountId: string, requestedBy: string | null = null, trigger = 'human_requested',
): Promise<EnqueueResult> {
  return enqueue({
    jobType: 'account_research',
    idempotencyKey: `account_research:${accountId}`,
    payload: { account_id: accountId, trigger },
    requestedBy,
    accountId,
    priority: 50,
  });
}

/**
 * The fingerprint two clicks have to share before they count as the same search.
 *
 * The key was a raw string join, so "Jacksonville" and "jacksonville " were two
 * different paid searches of the same market, and " 32095 " was a third thing again.
 * It also left out the mining mode, so a broad sweep and an advertiser-first search
 * of one market collapsed into whichever was queued first.
 *
 * Normalized, and including the strategy: equivalent clicks collapse, genuinely
 * different searches do not.
 */
export function discoveryFingerprint(input: {
  marketId?: string | null;
  verticalProfileId?: string | null;
  geographyType?: string | null;
  geographyValue?: string | null;
  miningMode?: string | null;
}): string {
  const geography = normalizeGeography(input.geographyType, input.geographyValue);
  const place = geography.ok
    ? `${geography.type}:${geography.value.toLowerCase()}`
    // Unreadable geography still gets a stable key, so a rep who clicks a broken
    // link twice does not queue the same doomed job twice.
    : `raw:${String(input.geographyValue ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;

  return [
    'market_mine',
    input.marketId ?? '',
    (input.verticalProfileId ?? '').trim().toLowerCase(),
    place,
    (input.miningMode ?? 'advertiser_first').trim().toLowerCase(),
  ].join(':');
}

export async function enqueueMarketResearch(input: {
  verticalProfileId: string | null;
  geographyType: string | null;
  geographyValue: string | null;
  marketId: string | null;
  requestedBy: string;
  miningMode?: string | null;
  /**
   * How many independent searches this run should buy. One unless asked.
   *
   * It is not part of the idempotency key: asking for more searches of a market
   * already queued should not create a second job for it. The queued job keeps the
   * count it was created with, which is the conservative reading -- a second click
   * must never silently multiply what the first one is already spending.
   */
  queryBudget?: number;
}): Promise<EnqueueResult> {
  // The payload carries the normalized geography, so the worker filters and searches
  // on the same value the fingerprint was built from.
  const geography = normalizeGeography(input.geographyType, input.geographyValue);

  return enqueue({
    jobType: 'market_mine',
    idempotencyKey: discoveryFingerprint(input),
    payload: {
      vertical_profile_id: input.verticalProfileId,
      geography_type: geography.ok ? geography.type : input.geographyType,
      geography_value: geography.ok ? geography.value : input.geographyValue,
      geography_state: geography.ok ? geography.state : null,
      geography_display: geography.ok ? geography.display : input.geographyValue,
      mining_mode: input.miningMode ?? 'advertiser_first',
      market_id: input.marketId,
      query_budget: Math.max(1, Math.floor(input.queryBudget ?? 1)),
    },
    requestedBy: input.requestedBy,
    marketId: input.marketId,
    priority: 80,
  });
}
