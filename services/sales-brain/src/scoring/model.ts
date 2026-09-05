/**
 * The canonical prospect score.
 * Authority: outbound-sales-brain-score-recognition-policy.md,
 * outbound-sales-brain-scoring-research-fixtures.yaml, Module 4C.
 *
 * Arithmetic over recognized evidence, not an opinion. The policy is explicit about
 * why: `evidence -> deterministic recognizer -> points` can be explained to a rep and
 * reproduced tomorrow; "ask a model to rate this company out of eighteen" cannot.
 *
 * The one rule that shapes everything here: **no qualifying evidence scores zero, and
 * zero does not mean the opposite fact is true.** A company with no confirmed Google
 * ad is not a company that does not advertise. It is a company we have not confirmed
 * advertises, which is a different thing and must stay a different thing all the way
 * to the screen.
 */

/**
 * Which ruleset produced a score.
 *
 * Not decoration. The four recognizers added in `5b68f29` changed what the same
 * evidence is worth -- an HVAC advertiser that scored eight now scores fourteen --
 * so every score written before that was produced under different rules. Without a
 * version on the row, yesterday's eight and today's eight are indistinguishable, and
 * a rep comparing two prospects would be comparing two different policies.
 *
 * Bump this whenever the rules, their points, or what a recognizer accepts as
 * qualifying evidence change. `scoringRulesFingerprint()` and its pinned test make
 * forgetting hard: changing the rule set without bumping the version fails the suite.
 */
export const SCORE_VERSION = 'module-4c-v2';

export type ScoreRuleId =
  | 'google_paid_search_confirmed'
  | 'meta_active_ads_confirmed'
  | 'multiple_paid_channels_confirmed'
  | 'high_value_economics_signal'
  | 'operationally_important_lead_volume_signal'
  | 'emergency_after_hours'
  | 'appointment_estimate_consultation_intake_heavy'
  | 'multiple_locations_or_service_territories'
  | 'visible_growth_hiring'
  | 'strong_phone_dependence'
  | 'prominent_forms_booking_quote_consultation_cta';

export interface ScoreRule {
  id: ScoreRuleId;
  points: number;
  /** What a rep is told this rule means. */
  description: string;
  /**
   * Derived rules are computed from other rules rather than recognized from
   * evidence directly, so a caller cannot assert one into being true.
   */
  derived?: boolean;
}

export const SCORE_RULES: ScoreRule[] = [
  { id: 'google_paid_search_confirmed', points: 4,
    description: 'Confirmed current Google paid search or Local Services advertising' },
  { id: 'meta_active_ads_confirmed', points: 3,
    description: 'Confirmed current Meta advertising' },
  { id: 'multiple_paid_channels_confirmed', points: 1, derived: true,
    description: 'Paying for two independent channels, not two surfaces of one' },
  { id: 'high_value_economics_signal', points: 2,
    description: 'One job or contract is worth enough for lost calls to matter' },
  { id: 'operationally_important_lead_volume_signal', points: 2,
    description: 'Getting and handling enquiries is a real operating process here' },
  { id: 'emergency_after_hours', points: 1,
    description: 'Offers emergency, after-hours or 24/7 service' },
  { id: 'appointment_estimate_consultation_intake_heavy', points: 1,
    description: 'The sale runs through an appointment, estimate or consultation' },
  { id: 'multiple_locations_or_service_territories', points: 1,
    description: 'More than one real location or service territory' },
  { id: 'visible_growth_hiring', points: 1,
    description: 'Currently hiring or visibly expanding' },
  { id: 'strong_phone_dependence', points: 1,
    description: 'The phone is a primary way customers reach them' },
  { id: 'prominent_forms_booking_quote_consultation_cta', points: 1,
    description: 'A real lead-capture path, not a newsletter box' },
];

export const RULE_POINTS: Record<ScoreRuleId, number> = Object.fromEntries(
  SCORE_RULES.map((rule) => [rule.id, rule.points]),
) as Record<ScoreRuleId, number>;

export const MAX_POINTS = SCORE_RULES.reduce((total, rule) => total + rule.points, 0);

/**
 * A stable summary of the rule set, so a change to it cannot pass unnoticed.
 *
 * Covers the rule ids and their point values -- the things that make two scores
 * incomparable. A recognizer becoming stricter about evidence is not visible here,
 * which is why the version is bumped by hand and this only catches the coarse case.
 */
export function scoringRulesFingerprint(): string {
  return SCORE_RULES.map((rule) => `${rule.id}:${rule.points}`).sort().join('|');
}

export type Tier = 'A' | 'B' | 'C' | 'D';

/** Bands from the fixture set: A >= 9, B 6-8, C 3-5, D 0-2. */
export function tierFor(points: number): Tier {
  if (points >= 9) return 'A';
  if (points >= 6) return 'B';
  if (points >= 3) return 'C';
  return 'D';
}

/**
 * Why a rule did or did not award.
 *
 * `reason` is written for a rep reading the account page, not for a log. "No
 * confirmed Google ad observed" and "we have not looked" are different sentences and
 * the rep needs to be able to tell them apart.
 */
export interface ScoreComponent {
  ruleId: ScoreRuleId;
  description: string;
  pointsPossible: number;
  pointsAwarded: number;
  qualified: boolean;
  evidenceIds: string[];
  reason: string;
}

export interface ScoreSignal {
  qualified: boolean;
  evidenceIds?: string[];
  /** Overrides the default reason where the recognizer knows something better. */
  reason?: string;
}

export type ScoreSignals = Partial<Record<ScoreRuleId, ScoreSignal | boolean>>;

export interface ScoreResult {
  version: string;
  totalPoints: number;
  tier: Tier;
  components: ScoreComponent[];
}

function asSignal(value: ScoreSignal | boolean | undefined): ScoreSignal {
  if (value === undefined) return { qualified: false };
  if (typeof value === 'boolean') return { qualified: value };
  return value;
}

/**
 * Turns recognized signals into a score.
 *
 * Pure and total: the same signals give the same points on any machine, on any day,
 * which is the whole reason the policy forbids asking a model.
 */
export function scoreFromSignals(signals: ScoreSignals): ScoreResult {
  const google = asSignal(signals['google_paid_search_confirmed']);
  const meta = asSignal(signals['meta_active_ads_confirmed']);

  // Two channels, not two surfaces of one. Google Search plus Google Local Services
  // is still Google, and the policy says so explicitly; a Meta pixel is not a Meta
  // ad. So this is derived here rather than accepted from a caller.
  const paidChannels = (google.qualified ? 1 : 0) + (meta.qualified ? 1 : 0);
  const multiChannel: ScoreSignal = {
    qualified: paidChannels >= 2,
    evidenceIds: [...(google.evidenceIds ?? []), ...(meta.evidenceIds ?? [])],
    reason: paidChannels >= 2
      ? 'Confirmed paid activity on two independent channels'
      : 'Fewer than two independent paid channels confirmed',
  };

  const components: ScoreComponent[] = SCORE_RULES.map((rule) => {
    const signal = rule.id === 'multiple_paid_channels_confirmed'
      ? multiChannel : asSignal(signals[rule.id]);
    return {
      ruleId: rule.id,
      description: rule.description,
      pointsPossible: rule.points,
      pointsAwarded: signal.qualified ? rule.points : 0,
      qualified: signal.qualified,
      evidenceIds: signal.evidenceIds ?? [],
      reason: signal.reason
        ?? (signal.qualified
          ? rule.description
          // Not "no": not yet shown. The difference is the whole policy.
          : 'No qualifying evidence recorded'),
    };
  });

  const totalPoints = components.reduce((total, component) => total + component.pointsAwarded, 0);
  return { version: SCORE_VERSION, totalPoints, tier: tierFor(totalPoints), components };
}
