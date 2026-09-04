import { query } from '../db/pool.js';

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

  const existing = await query<{ job_id: string }>(
    `select job_id from jobs
      where idempotency_key = $1 and status in ('QUEUED','RUNNING')
      order by created_at desc limit 1`,
    [input.idempotencyKey],
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

export async function enqueueMarketResearch(input: {
  verticalProfileId: string | null;
  geographyType: string | null;
  geographyValue: string | null;
  marketId: string | null;
  requestedBy: string;
}): Promise<EnqueueResult> {
  const key = `market_mine:${input.marketId ?? ''}:${input.verticalProfileId ?? ''}:${input.geographyType ?? ''}:${input.geographyValue ?? ''}`;
  return enqueue({
    jobType: 'market_mine',
    idempotencyKey: key,
    payload: {
      vertical_profile_id: input.verticalProfileId,
      geography_type: input.geographyType,
      geography_value: input.geographyValue,
      market_id: input.marketId,
    },
    requestedBy: input.requestedBy,
    marketId: input.marketId,
    priority: 80,
  });
}
