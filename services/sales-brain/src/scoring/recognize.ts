import { query } from '../db/pool.js';
import { getVerticalProfile } from '../domain/verticals.js';
import type { ScoreRuleId, ScoreSignals } from './model.js';

/**
 * Evidence to signals.
 *
 * The vertical profiles have carried this mapping all along: each one lists
 * `public_signal_rules`, and each rule names the evidence claim key that proves it,
 * the confidence required, and the Module 4C rule it feeds. Nothing read it, so
 * nothing has ever been scored.
 *
 * Reading it rather than hard-coding a list means a new vertical brings its own
 * signals with it, and the reason a company scored what it did can be traced to a
 * document somebody wrote on purpose.
 */

/** The profile's word for a score rule, in our vocabulary. */
const RULE_BY_REFERENCE: Record<string, ScoreRuleId> = {
  module4c_google_ads_plus4: 'google_paid_search_confirmed',
  module4c_meta_ads_plus3: 'meta_active_ads_confirmed',
  module4c_after_hours_plus1: 'emergency_after_hours',
  module4c_multiple_locations_plus1: 'multiple_locations_or_service_territories',
  module4c_growth_plus1: 'visible_growth_hiring',
  module4c_lead_capture_plus1: 'prominent_forms_booking_quote_consultation_cta',
  module4c_high_value_plus2_if_vertical_model_rule_satisfied: 'high_value_economics_signal',
  // Deliberately not a score rule. A vertical may care about a signal without it
  // being worth points in the canonical model, and the profiles say so.
  vertical_priority_signal_only: undefined as unknown as ScoreRuleId,
};

interface SignalRule {
  claimKey: string;
  ruleId: ScoreRuleId;
  confidenceRequired: string;
}

/** The claim keys this vertical says are worth points, and which rule each feeds. */
export async function signalRulesFor(verticalProfileId: string | null): Promise<SignalRule[]> {
  if (!verticalProfileId) return [];
  const definition = await getVerticalProfile(verticalProfileId) as Record<string, unknown> | null;
  if (!definition) return [];

  const declared = definition['public_signal_rules'];
  if (!Array.isArray(declared)) return [];

  const rules: SignalRule[] = [];
  for (const entry of declared as Record<string, unknown>[]) {
    const claimKey = typeof entry['evidence_claim_key'] === 'string'
      ? entry['evidence_claim_key'].trim() : '';
    const reference = typeof entry['score_rule_reference'] === 'string'
      ? entry['score_rule_reference'].trim() : '';
    const ruleId = RULE_BY_REFERENCE[reference];
    if (!claimKey || !ruleId) continue;
    rules.push({
      claimKey,
      ruleId,
      confidenceRequired: typeof entry['confidence_required'] === 'string'
        ? entry['confidence_required'] : 'confirmed',
    });
  }
  return rules;
}

interface EvidenceRow {
  evidence_id: string;
  claim_key: string;
  confidence: string | null;
  can_state_as_fact: boolean;
  expired: boolean;
  contradicted: boolean;
}

/**
 * The signals an Account's current evidence supports.
 *
 * Three things disqualify a piece of evidence and each is a separate fact worth
 * keeping: it has been contradicted, it has aged past its window, or it was never
 * confident enough to count. None of them makes the opposite claim true, so a rule
 * that does not fire says which of the three happened rather than announcing that
 * the company does not advertise.
 */
export async function recognizeSignals(accountId: string): Promise<ScoreSignals> {
  const { rows: accountRows } = await query<{ primary_vertical_profile_id: string | null }>(
    'select primary_vertical_profile_id from accounts where account_id = $1', [accountId]);
  const rules = await signalRulesFor(accountRows[0]?.primary_vertical_profile_id ?? null);
  if (rules.length === 0) return {};

  const { rows } = await query<EvidenceRow>(
    `select evidence_id, claim_key, confidence, can_state_as_fact,
            (expires_at is not null and expires_at <= now()) as expired,
            (contradicted_by_evidence_id is not null) as contradicted
       from evidence_records
      where account_id = $1 and claim_key = any($2::text[])`,
    [accountId, rules.map((rule) => rule.claimKey)],
  );

  const byClaim = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const held = byClaim.get(row.claim_key) ?? [];
    held.push(row);
    byClaim.set(row.claim_key, held);
  }

  const signals: ScoreSignals = {};
  for (const rule of rules) {
    const evidence = byClaim.get(rule.claimKey) ?? [];
    const usable = evidence.filter((row) =>
      !row.contradicted && !row.expired
      && (rule.confidenceRequired !== 'confirmed'
        || row.can_state_as_fact || row.confidence === 'confirmed'));

    // A rule already satisfied by another claim key stays satisfied: two profile
    // signals can feed one Module 4C rule, and the rule awards once either way.
    const existing = signals[rule.ruleId];
    const alreadyQualified = typeof existing === 'object' ? existing.qualified : Boolean(existing);
    const existingIds = typeof existing === 'object' ? existing.evidenceIds ?? [] : [];

    if (usable.length > 0) {
      signals[rule.ruleId] = {
        qualified: true,
        evidenceIds: [...existingIds, ...usable.map((row) => row.evidence_id)],
        reason: `Confirmed by current ${rule.claimKey.replace(/_/g, ' ')} evidence`,
      };
      continue;
    }
    if (alreadyQualified) continue;

    const contradicted = evidence.some((row) => row.contradicted);
    const stale = evidence.some((row) => row.expired);
    signals[rule.ruleId] = {
      qualified: false,
      evidenceIds: [],
      reason: contradicted
        ? `Earlier ${rule.claimKey.replace(/_/g, ' ')} evidence was contradicted and has not been re-confirmed`
        : stale
          ? `The ${rule.claimKey.replace(/_/g, ' ')} evidence we had has aged out and has not been re-confirmed`
          : evidence.length > 0
            ? `${rule.claimKey.replace(/_/g, ' ')} was observed but not to the confidence this rule requires`
            : `No ${rule.claimKey.replace(/_/g, ' ')} evidence has been recorded yet`,
    };
  }

  return signals;
}
