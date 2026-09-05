import { query } from '../db/pool.js';
import { SCORE_VERSION } from './model.js';

/**
 * Why this company is ranked where it is.
 *
 * The answer to "why is this guy Tier A" must not be "because the database says 14".
 * It has to be four reasons with evidence behind each: what was observed, by whom,
 * when, whether it is still current, and which policy turned it into points.
 *
 * Every field here comes from a row that already exists. Nothing is recomputed for
 * display, so what a rep is shown is what the score was actually made of.
 */

export interface ScoreLineageComponent {
  ruleId: string;
  description: string;
  pointsAwarded: number;
  pointsPossible: number;
  qualified: boolean;
  reason: string;
  evidence: {
    evidenceId: string;
    claimKey: string;
    claimText: string | null;
    sourceType: string | null;
    sourceProvider: string | null;
    sourceReference: string | null;
    observedAt: Date;
    expiresAt: Date | null;
    /** Whether this observation is still inside its window right now. */
    current: boolean;
    contradicted: boolean;
  }[];
}

export interface ScoreLineage {
  accountId: string;
  companyName: string;
  totalPoints: number;
  tier: string;
  policyVersion: string;
  /** True when the score was produced by the ruleset this build is running. */
  policyCurrent: boolean;
  calculatedAt: Date;
  components: ScoreLineageComponent[];
}

/** The full lineage of one Account's most recent score. */
export async function explainScore(accountId: string): Promise<ScoreLineage | null> {
  const { rows: scoreRows } = await query<{
    total_points: number; tier: string; score_version: string; calculated_at: Date;
    components: any; canonical_name: string;
  }>(
    `select c.total_points, c.tier, c.score_version, c.calculated_at, c.components,
            a.canonical_name
       from canonical_scores c
       join accounts a on a.account_id = c.account_id
      where c.account_id = $1
      order by c.calculated_at desc limit 1`,
    [accountId],
  );
  const score = scoreRows[0];
  if (!score) return null;

  const components = Array.isArray(score.components) ? score.components : [];
  const evidenceIds = components.flatMap((component: any) =>
    Array.isArray(component.evidence_ids) ? component.evidence_ids : []);

  const { rows: evidenceRows } = evidenceIds.length === 0
    ? { rows: [] as any[] }
    : await query<any>(
      `select evidence_id, claim_key, claim_text, source_type, source_provider,
              source_reference, observed_at, expires_at,
              (expires_at is null or expires_at > now()) as current,
              (contradicted_by_evidence_id is not null) as contradicted
         from evidence_records where evidence_id = any($1::uuid[])`,
      [evidenceIds],
    );
  const byId = new Map(evidenceRows.map((row) => [row.evidence_id, row]));

  return {
    accountId,
    companyName: score.canonical_name,
    totalPoints: score.total_points,
    tier: score.tier,
    policyVersion: score.score_version,
    policyCurrent: score.score_version === SCORE_VERSION,
    calculatedAt: score.calculated_at,
    components: components.map((component: any) => ({
      ruleId: String(component.rule_id),
      description: String(component.description ?? ''),
      pointsAwarded: Number(component.points_awarded ?? 0),
      pointsPossible: Number(component.points_possible ?? 0),
      qualified: Number(component.points_awarded ?? 0) > 0,
      reason: String(component.reason ?? ''),
      evidence: (Array.isArray(component.evidence_ids) ? component.evidence_ids : [])
        .map((id: string) => byId.get(id))
        .filter(Boolean)
        .map((row: any) => ({
          evidenceId: row.evidence_id,
          claimKey: row.claim_key,
          claimText: row.claim_text,
          sourceType: row.source_type,
          sourceProvider: row.source_provider,
          sourceReference: row.source_reference,
          observedAt: row.observed_at,
          expiresAt: row.expires_at,
          current: row.current,
          contradicted: row.contradicted,
        })),
    })),
  };
}

/** The same thing as text, for an operator at a terminal. */
export function renderScoreLineage(lineage: ScoreLineage): string {
  const lines: string[] = [
    `${lineage.companyName}`,
    `Score ${lineage.totalPoints} of 18   Tier ${lineage.tier}`,
    `Policy ${lineage.policyVersion}${lineage.policyCurrent ? '' : '  (SUPERSEDED — this '
      + `score was produced under an older ruleset; the current one is ${SCORE_VERSION})`}`,
    `Calculated ${lineage.calculatedAt.toISOString()}`,
    '',
    'Earned:',
  ];

  const earned = lineage.components.filter((component) => component.qualified);
  const missed = lineage.components.filter((component) => !component.qualified);

  if (earned.length === 0) lines.push('  nothing yet');
  for (const component of earned) {
    lines.push(`  +${component.pointsAwarded}  ${component.description}`);
    lines.push(`        ${component.reason}`);
    for (const evidence of component.evidence) {
      const age = evidence.current ? 'current' : 'expired';
      lines.push(`        - ${evidence.claimKey} (${age}) from `
        + `${evidence.sourceProvider ?? evidence.sourceType ?? 'unknown source'} `
        + `on ${evidence.observedAt.toISOString().slice(0, 10)}`);
      if (evidence.claimText) lines.push(`          "${evidence.claimText}"`);
    }
  }

  lines.push('', 'Not earned:');
  for (const component of missed) {
    lines.push(`   0/${component.pointsPossible}  ${component.description}`);
    lines.push(`        ${component.reason}`);
  }

  return lines.join('\n');
}
