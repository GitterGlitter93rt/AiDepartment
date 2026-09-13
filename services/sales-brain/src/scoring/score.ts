import { query, withTransaction } from '../db/pool.js';
import { recognizeSignals } from './recognize.js';
import { scoreFromSignals, SCORE_VERSION, type ScoreResult } from './model.js';

/**
 * Scoring an Account from what we actually know about it.
 *
 * Nothing in the runtime wrote a score. `manual_score` and `manual_tier` were only
 * ever set by the seed script, the demo fixture, the synthetic generator and a
 * release drill -- so every company the miner has ever discovered had no tier at
 * all, and a rep filtering "Tier B and better" could not see one of them.
 *
 * The score is arithmetic over evidence and it is stored with its working: the
 * components say which rule fired, what it was worth, which evidence records
 * supported it, and -- when it did not fire -- whether that is because the evidence
 * aged out, was contradicted, was not confident enough, or was never gathered.
 */

export interface ScoredAccount extends ScoreResult {
  accountId: string;
  /** True when nothing in the evidence supported any rule. */
  unsupported: boolean;
}

/** Recomputes and stores an Account's score. Safe to call repeatedly. */
export async function scoreAccount(
  accountId: string, options: { researchRunId?: string | null } = {},
): Promise<ScoredAccount> {
  const signals = await recognizeSignals(accountId);
  const result = scoreFromSignals(signals);
  const unsupported = result.components.every((component) => !component.qualified);

  await withTransaction(async (client) => {
    await client.query(
      `insert into canonical_scores
         (account_id, research_run_id, score_version, total_points, tier, components)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        accountId, options.researchRunId ?? null, SCORE_VERSION,
        result.totalPoints, result.tier,
        JSON.stringify(result.components.map((component) => ({
          rule_id: component.ruleId,
          description: component.description,
          points_possible: component.pointsPossible,
          points_awarded: component.pointsAwarded,
          evidence_ids: component.evidenceIds,
          reason: component.reason,
        }))),
      ],
    );

    // The projection the search and the pages read. Kept in step with the ledger
    // row above rather than being a second opinion.
    await client.query(
      `update accounts set manual_score = $2, manual_tier = $3, score_version = $4,
              updated_at = now()
        where account_id = $1`,
      [accountId, result.totalPoints, result.tier, SCORE_VERSION],
    );
  });

  return { ...result, accountId, unsupported };
}

/** The stored score with its working, for the account page. */
export async function latestScore(accountId: string): Promise<{
  totalPoints: number; tier: string; version: string; calculatedAt: Date;
  components: { rule_id: string; description: string; points_possible: number;
                points_awarded: number; evidence_ids: string[]; reason: string }[];
} | null> {
  const { rows } = await query<{
    total_points: number; tier: string; score_version: string; calculated_at: Date;
    components: any;
  }>(
    `select total_points, tier, score_version, calculated_at, components
       from canonical_scores where account_id = $1
      order by calculated_at desc limit 1`,
    [accountId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    totalPoints: row.total_points,
    tier: row.tier,
    version: row.score_version,
    calculatedAt: row.calculated_at,
    components: Array.isArray(row.components) ? row.components : [],
  };
}
