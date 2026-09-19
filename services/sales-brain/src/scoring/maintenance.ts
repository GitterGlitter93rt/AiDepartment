import { query } from '../db/pool.js';
import { recognizeSignals } from './recognize.js';
import { scoreFromSignals, SCORE_VERSION, type ScoreResult } from './model.js';
import { scoreAccount } from './score.js';

export interface FitRefreshOptions {
  allActive?: boolean;
  accountId?: string | null;
  vertical?: string | null;
}

export interface FitPreviewRow {
  accountId: string;
  company: string;
  currentLetter: string | null;
  currentNumeric: number | null;
  recalculatedLetter: string;
  recalculatedNumeric: number;
  changed: boolean;
  upgraded: boolean;
  downgraded: boolean;
  components: ScoreResult['components'];
}

/**
 * Read-only calculation of the canonical FIT projection. It deliberately uses the
 * same recognizer and pure scorer as scoreAccount, so a preview cannot drift from
 * the value APPLY will write.
 */
export async function previewFitRefresh(options: FitRefreshOptions = {}): Promise<FitPreviewRow[]> {
  const clauses = ['not a.is_suppressed', 'a.merged_into_account_id is null'];
  const values: unknown[] = [];
  if (options.accountId) { values.push(options.accountId); clauses.push(`a.account_id = $${values.length}`); }
  if (options.vertical) { values.push(options.vertical); clauses.push(`a.primary_vertical_profile_id = $${values.length}`); }
  if (!options.allActive && !options.accountId && !options.vertical) {
    throw new Error('scope is required: use --all-active, --account-id, or --vertical');
  }
  const { rows } = await query<{
    account_id: string; canonical_name: string; manual_tier: string | null; manual_score: number | null;
  }>(`select a.account_id, a.canonical_name, a.manual_tier, a.manual_score
        from accounts a where ${clauses.join(' and ')} order by a.account_id`, values);
  const result: FitPreviewRow[] = [];
  for (const row of rows) {
    const scored = scoreFromSignals(await recognizeSignals(row.account_id));
    const oldScore = row.manual_score === null ? null : Number(row.manual_score);
    const changed = oldScore !== scored.totalPoints || row.manual_tier !== scored.tier;
    const rank = (tier: string | null): number => tier === 'A' ? 4 : tier === 'B' ? 3 : tier === 'C' ? 2 : tier === 'D' ? 1 : 0;
    result.push({
      accountId: row.account_id, company: row.canonical_name,
      currentLetter: row.manual_tier, currentNumeric: oldScore,
      recalculatedLetter: scored.tier, recalculatedNumeric: scored.totalPoints,
      changed, upgraded: changed && (rank(scored.tier) > rank(row.manual_tier)
        || (rank(scored.tier) === rank(row.manual_tier) && scored.totalPoints > (oldScore ?? -1))),
      downgraded: changed && (rank(scored.tier) < rank(row.manual_tier)
        || (rank(scored.tier) === rank(row.manual_tier) && scored.totalPoints < (oldScore ?? 99))),
      components: scored.components,
    });
  }
  return result;
}

/** Applies only the existing score projection, one Account per transaction. */
export async function applyFitRefresh(rows: FitPreviewRow[]): Promise<number> {
  let applied = 0;
  for (const row of rows) {
    await scoreAccount(row.accountId);
    applied += 1;
  }
  return applied;
}

export { SCORE_VERSION };
