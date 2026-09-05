import { query } from '../db/pool.js';
import { enqueueAccountResearch } from './enqueue.js';

/**
 * Accounts that were discovered and then forgotten.
 *
 * Discovery creates Accounts in one transaction each and queues their research
 * afterwards. A worker that dies in between leaves companies that exist, have never
 * been researched, have no research queued, and have nothing that will ever notice:
 * a name and a phone number sitting in inventory for ever, which is precisely the
 * state Phase I exists to prevent.
 *
 * This is the sweep that notices. It is deliberately narrow -- only Accounts a
 * discovery provider created, only ones with no research at all, only ones old
 * enough that the normal enqueue has had its chance -- because a reconciler that
 * queues work nobody asked for is worse than the gap it closes.
 *
 * Imported Accounts are excluded on purpose. A list the operator chose to load is
 * theirs to decide about, and researching two hundred and thirty companies because
 * a CSV landed is a spending decision, not a repair.
 */

/** How long after creation an Account counts as stranded rather than in flight. */
export const STRANDED_AFTER_MINUTES = Number(
  process.env['RESEARCH_STRANDED_AFTER_MINUTES'] ?? '10');

/**
 * How long a failed research job suppresses another attempt.
 *
 * Without this the sweep re-queues a permanently broken Account every fifteen
 * minutes for ever. The Account stays visible and an operator can retry it by hand;
 * what stops is the loop.
 */
export const RETRY_AFTER_FAILURE_HOURS = Number(
  process.env['RESEARCH_RETRY_AFTER_FAILURE_HOURS'] ?? '6');

export interface ReconcileResult {
  /** Discovered Accounts with no research and nothing queued. */
  stranded: number;
  /** How many were queued this pass. */
  queued: number;
  /** Held back because their last research attempt failed recently. */
  heldAfterFailure: number;
  /** Researched Accounts that had never been scored, and now are. */
  scored: number;
}

const STRANDED_SQL = `
  from accounts a
 where not a.is_suppressed
   and a.merged_into_account_id is null
   and a.last_researched_at is null
   and a.created_at < now() - ($1 || ' minutes')::interval
   -- Only what a discovery provider created. An import is the operator's decision.
   and exists (
     select 1 from activities d
      where d.account_id = a.account_id
        and d.activity_type = 'DISCOVERED'
        and d.source_system like 'market_miner:%')
   -- Nothing already on its way.
   and not exists (
     select 1 from jobs j
      where j.account_id = a.account_id
        and j.job_type in ('account_research', 'contact_research')
        and j.status in ('QUEUED', 'RUNNING'))
   -- And it has genuinely never been researched, not merely never finished.
   and not exists (
     select 1 from research_runs r
      where r.account_id = a.account_id
        and r.status in ('completed', 'partial'))
`;

/**
 * Finds discovered Accounts that never reached research, and queues them.
 *
 * Safe to call at any time and safe to call twice: the enqueue is idempotent over
 * queued and running jobs, so a second pass while the first is still working adds
 * nothing.
 */
export async function reconcileMissingResearch(options: {
  limit?: number;
} = {}): Promise<ReconcileResult> {
  const limit = options.limit ?? 100;

  const { rows: counts } = await query<{ stranded: number; held: number }>(
    `select count(*)::int as stranded,
            count(*) filter (where exists (
              select 1 from jobs f
               where f.account_id = a.account_id
                 and f.job_type in ('account_research', 'contact_research')
                 and f.status = 'FAILED'
                 and f.completed_at > now() - ($2 || ' hours')::interval))::int as held
     ${STRANDED_SQL}`,
    [String(STRANDED_AFTER_MINUTES), String(RETRY_AFTER_FAILURE_HOURS)],
  );

  const { rows: candidates } = await query<{ account_id: string }>(
    `select a.account_id
     ${STRANDED_SQL}
       and not exists (
         select 1 from jobs f
          where f.account_id = a.account_id
            and f.job_type in ('account_research', 'contact_research')
            and f.status = 'FAILED'
            and f.completed_at > now() - ($2 || ' hours')::interval)
     order by a.created_at asc
     limit ${Math.max(1, Math.min(1000, limit))}`,
    [String(STRANDED_AFTER_MINUTES), String(RETRY_AFTER_FAILURE_HOURS)],
  );

  let queued = 0;
  for (const row of candidates) {
    const result = await enqueueAccountResearch(row.account_id, null, 'newly_discovered');
    if (result.created) queued += 1;
  }

  const scored = await scoreResearchedButUnscored({ limit });

  return {
    stranded: counts[0]?.stranded ?? 0,
    queued,
    heldAfterFailure: counts[0]?.held ?? 0,
    scored,
  };
}

/**
 * Accounts that were researched before there was anything to score them with.
 *
 * Scoring runs at the end of a research run, so every Account researched before
 * scoring existed has evidence and no tier -- and a tier filter hides an Account
 * with no tier. Without this they would stay invisible until something happened to
 * research them again, which for a fresh Account is never.
 *
 * Bounded per pass so a database with thousands of them recovers steadily rather
 * than in one long transaction nobody can interrupt.
 */
export async function scoreResearchedButUnscored(options: {
  limit?: number;
} = {}): Promise<number> {
  const { rows } = await query<{ account_id: string }>(
    `select a.account_id
       from accounts a
      where a.merged_into_account_id is null
        and a.manual_tier is null
        and exists (
          select 1 from research_runs r
           where r.account_id = a.account_id
             and r.status in ('completed', 'partial'))
        and not exists (
          select 1 from canonical_scores c where c.account_id = a.account_id)
      order by a.created_at asc
      limit ${Math.max(1, Math.min(1000, options.limit ?? 100))}`,
  );

  const { scoreAccount } = await import('../scoring/score.js');
  let scored = 0;
  for (const row of rows) {
    try {
      await scoreAccount(row.account_id);
      scored += 1;
    } catch {
      // One Account that cannot be scored must not stop the rest of the sweep.
    }
  }
  return scored;
}

/** The same count, for the operations panel. Reads nothing and queues nothing. */
export async function strandedResearchCount(): Promise<number> {
  const { rows } = await query<{ stranded: number }>(
    `select count(*)::int as stranded ${STRANDED_SQL}`,
    [String(STRANDED_AFTER_MINUTES)],
  );
  return rows[0]?.stranded ?? 0;
}
