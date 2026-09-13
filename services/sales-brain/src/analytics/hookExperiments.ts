import { query } from '../db/pool.js';

/**
 * Hook attribution and variant comparison.
 * Authority: outbound-sales-brain-sales-ai-metric-definitions.v1.yaml,
 * outbound-sales-brain-sales-ai-hook-selection-matrix.v1.yaml.
 *
 * The engine exists to answer one question honestly: which opener produces meetings
 * worth having. Three rules follow, and all three are enforced here rather than left
 * to whoever reads the dashboard:
 *
 *  1. every rate carries its numerator and denominator, so nobody can quote a
 *     percentage without the population behind it;
 *  2. a variant with too small a denominator is reported as insufficient evidence,
 *     never as a winner. Six calls is not a result;
 *  3. booked is never the last word. A hook that books meetings scored one or two out
 *     of five is worse than one that books fewer good ones, so the comparison ranks on
 *     downstream quality and shows the booking rate beside it.
 */

/** Below this many attempts, a variant is not compared at all. */
export const MINIMUM_ATTEMPTS_FOR_COMPARISON = 30;
/** Below this denominator, a rate is shown but never ranked. */
export const MINIMUM_DENOMINATOR_FOR_RATE = 10;
/** Below this many scored meetings, a quality mean is not reported. */
export const MINIMUM_ATTENDED_FOR_QUALITY = 5;

export interface HookAttemptInput {
  accountId: string;
  contactId?: string | null;
  endpointId?: string | null;
  voiceCallId?: string | null;
  callPackId?: string | null;
  openerVersion: string;
  openerFrame: string;
  hookFamily?: string | null;
  hypothesisCategory?: string | null;
  evidenceIds?: string[];
  stakeholderRoute?: string | null;
  contactRouteClass?: string | null;
  verticalProfileId?: string | null;
  marketId?: string | null;
  agentProfileId: string;
  modelVersion?: string | null;
  promptVersion?: string | null;
  tier?: string | null;
  advertiserEvidenceClass?: string | null;
  researchCompletenessBand?: string | null;
  pilotBatchId?: string | null;
  campaignId?: string | null;
  attemptedAt?: Date;
  timezone?: string;
}

/** Local-hour buckets. When you call changes who answers, so it is a dimension. */
export function timeBucket(when: Date, timezone = 'America/New_York'): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', hour12: false,
  }).format(when)) % 24;
  if (hour < 9) return 'BEFORE_09';
  if (hour < 12) return 'MORNING_09_12';
  if (hour < 14) return 'MIDDAY_12_14';
  if (hour < 17) return 'AFTERNOON_14_17';
  if (hour < 19) return 'EVENING_17_19';
  return 'AFTER_19';
}

/** Records the attempt with every dimension the metric definitions call for. */
export async function recordHookAttempt(input: HookAttemptInput): Promise<string> {
  const attemptedAt = input.attemptedAt ?? new Date();
  const { rows } = await query<{ hook_attempt_id: string }>(
    `insert into hook_attempts
       (account_id, contact_id, endpoint_id, voice_call_id, call_pack_id,
        opener_version, opener_frame, hook_family, hypothesis_category, evidence_ids,
        stakeholder_route, contact_route_class, vertical_profile_id, market_id,
        time_bucket, agent_profile_id, model_version, prompt_version, tier,
        advertiser_evidence_class, research_completeness_band, pilot_batch_id,
        campaign_id, attempted_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     returning hook_attempt_id`,
    [input.accountId, input.contactId ?? null, input.endpointId ?? null,
     input.voiceCallId ?? null, input.callPackId ?? null,
     input.openerVersion, input.openerFrame, input.hookFamily ?? null,
     input.hypothesisCategory ?? null, input.evidenceIds ?? [],
     input.stakeholderRoute ?? null, input.contactRouteClass ?? null,
     input.verticalProfileId ?? null, input.marketId ?? null,
     timeBucket(attemptedAt, input.timezone), input.agentProfileId,
     input.modelVersion ?? null, input.promptVersion ?? null, input.tier ?? null,
     input.advertiserEvidenceClass ?? null, input.researchCompletenessBand ?? null,
     input.pilotBatchId ?? null, input.campaignId ?? null, attemptedAt],
  );
  return rows[0]!.hook_attempt_id;
}

export type BaseEvent =
  | 'connected' | 'human_answered' | 'right_stakeholder' | 'gatekeeper_route'
  | 'first_question_answered' | 'useful_fact' | 'problem_supported'
  | 'strategy_offer' | 'strategy_accepted' | 'strategy_booked'
  | 'meeting_attended' | 'opportunity_created' | 'closed_won'
  | 'dnc' | 'wrong_number' | 'no_sale';

const EVENT_COLUMN: Record<BaseEvent, string> = {
  connected: 'connected_at',
  human_answered: 'human_answered_at',
  right_stakeholder: 'right_stakeholder_at',
  gatekeeper_route: 'gatekeeper_route_at',
  first_question_answered: 'first_question_answered_at',
  useful_fact: 'useful_fact_at',
  problem_supported: 'problem_supported_at',
  strategy_offer: 'strategy_offer_at',
  strategy_accepted: 'strategy_accepted_at',
  strategy_booked: 'strategy_booked_at',
  meeting_attended: 'meeting_attended_at',
  opportunity_created: 'opportunity_created_at',
  closed_won: 'closed_won_at',
  dnc: 'dnc_at',
  wrong_number: 'wrong_number_at',
  no_sale: 'no_sale_at',
};

/**
 * Marks a base event once.
 *
 * Idempotent by design: a duplicate webhook or a retried write must not move a
 * timestamp or double-count a metric.
 */
export async function markHookEvent(input: {
  hookAttemptId: string; event: BaseEvent; at?: Date;
}): Promise<void> {
  const column = EVENT_COLUMN[input.event];
  await query(
    `update hook_attempts set ${column} = coalesce(${column}, $2)
      where hook_attempt_id = $1`,
    [input.hookAttemptId, input.at ?? new Date()],
  );
}

/** The host's rating of a meeting that actually happened. */
export async function recordMeetingQuality(input: {
  hookAttemptId: string; score: number; stakeholderFit: string;
  problemConfirmed: string; notes?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) {
    return { ok: false, message: 'A quality score is 1 to 5.' };
  }
  const { rowCount } = await query(
    `update hook_attempts
        set michael_quality_score = $2, quality_scored_at = now(),
            stakeholder_fit = $3, problem_confirmed_at_meeting = $4,
            notes = coalesce($5, notes)
      where hook_attempt_id = $1 and meeting_attended_at is not null`,
    [input.hookAttemptId, input.score, input.stakeholderFit, input.problemConfirmed,
     input.notes ?? null],
  );
  return rowCount
    ? { ok: true }
    : { ok: false, message: 'A meeting has to have been attended before it can be scored.' };
}

export interface CohortFilter {
  verticalProfileId?: string | null;
  marketId?: string | null;
  tier?: string | null;
  timeBucket?: string | null;
  contactRouteClass?: string | null;
  agentProfileId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}

export interface RateWithPopulation {
  numerator: number;
  denominator: number;
  /** Null when the denominator is zero: a rate off nothing is not a number. */
  rate: number | null;
  lowSample: boolean;
}

export interface VariantComparison {
  openerVersion: string;
  openerFrame: string;
  hookFamily: string | null;
  attempts: number;
  insufficientEvidence: boolean;
  reason: string | null;
  rates: Record<string, RateWithPopulation>;
  quality: {
    attended: number;
    meanScore: number | null;
    badBookingRate: RateWithPopulation;
    correctStakeholderRate: RateWithPopulation;
  };
}

export interface ExperimentReport {
  cohort: CohortFilter;
  totalAttempts: number;
  insufficientEvidence: boolean;
  message: string;
  variants: VariantComparison[];
  leader: { openerVersion: string; openerFrame: string; basis: string } | null;
}

function rate(numerator: number, denominator: number): RateWithPopulation {
  return {
    numerator, denominator,
    rate: denominator > 0 ? numerator / denominator : null,
    lowSample: denominator < MINIMUM_DENOMINATOR_FOR_RATE,
  };
}

/**
 * Compares opener variants inside one cohort.
 *
 * Nothing is promoted from a small sample. A variant under the attempt floor comes
 * back with `insufficientEvidence` and no ranking, and a leader is named only when at
 * least two variants cleared the floor.
 */
export async function compareHookVariants(cohort: CohortFilter = {}): Promise<ExperimentReport> {
  const { rows } = await query<any>(
    `select opener_version, opener_frame, hook_family,
            count(*)::int as attempts,
            count(human_answered_at)::int as human_answered,
            count(right_stakeholder_at)::int as right_stakeholder,
            count(gatekeeper_route_at)::int as gatekeeper_route,
            count(first_question_answered_at)::int as first_question_answered,
            count(useful_fact_at)::int as useful_fact,
            count(problem_supported_at)::int as problem_supported,
            count(strategy_offer_at)::int as strategy_offer,
            count(strategy_accepted_at)::int as strategy_accepted,
            count(strategy_booked_at)::int as strategy_booked,
            count(meeting_attended_at)::int as meeting_attended,
            count(opportunity_created_at)::int as opportunity_created,
            count(dnc_at)::int as dnc,
            count(michael_quality_score)::int as scored,
            coalesce(avg(michael_quality_score), 0)::float as mean_score,
            count(*) filter (where michael_quality_score <= 2)::int as bad_bookings,
            count(*) filter (where stakeholder_fit in
              ('DECISION_MAKER','PROCESS_OWNER','INFLUENCER'))::int as correct_stakeholder
       from hook_attempts
      where superseded_by is null
        and ($1::text is null or vertical_profile_id = $1::text)
        and ($2::uuid is null or market_id = $2::uuid)
        and ($3::text is null or tier = $3::text)
        and ($4::text is null or time_bucket = $4::text)
        and ($5::text is null or contact_route_class = $5::text)
        and ($6::text is null or agent_profile_id = $6::text)
        and ($7::date is null or attempted_at >= $7::date)
        and ($8::date is null or attempted_at < ($8::date + interval '1 day'))
      group by opener_version, opener_frame, hook_family
      order by attempts desc`,
    [cohort.verticalProfileId ?? null, cohort.marketId ?? null, cohort.tier ?? null,
     cohort.timeBucket ?? null, cohort.contactRouteClass ?? null,
     cohort.agentProfileId ?? null, cohort.fromDate ?? null, cohort.toDate ?? null],
  );

  const variants: VariantComparison[] = rows.map((row: any) => {
    const insufficient = row.attempts < MINIMUM_ATTEMPTS_FOR_COMPARISON;
    return {
      openerVersion: row.opener_version,
      openerFrame: row.opener_frame,
      hookFamily: row.hook_family,
      attempts: row.attempts,
      insufficientEvidence: insufficient,
      reason: insufficient
        ? `${row.attempts} attempt(s); ${MINIMUM_ATTEMPTS_FOR_COMPARISON} are needed before `
          + 'this variant is compared at all.'
        : null,
      rates: {
        human_answer: rate(row.human_answered, row.attempts),
        right_stakeholder_per_human_answer: rate(row.right_stakeholder, row.human_answered),
        routing_value: rate(
          Math.min(row.human_answered, row.right_stakeholder + row.gatekeeper_route),
          row.human_answered),
        first_question_answer: rate(row.first_question_answered, row.right_stakeholder),
        useful_fact: rate(row.useful_fact, row.right_stakeholder),
        meaningful_problem: rate(row.problem_supported, row.right_stakeholder),
        strategy_offer_per_problem: rate(row.strategy_offer, row.problem_supported),
        strategy_accept: rate(row.strategy_accepted, row.strategy_offer),
        booking_completion: rate(row.strategy_booked, row.strategy_accepted),
        attendance: rate(row.meeting_attended, row.strategy_booked),
        opportunity_per_attended: rate(row.opportunity_created, row.meeting_attended),
        dnc: rate(row.dnc, row.attempts),
      },
      quality: {
        attended: row.meeting_attended,
        meanScore: row.scored >= MINIMUM_ATTENDED_FOR_QUALITY
          ? Number(row.mean_score.toFixed(2)) : null,
        badBookingRate: rate(row.bad_bookings, row.meeting_attended),
        correctStakeholderRate: rate(row.correct_stakeholder, row.meeting_attended),
      },
    };
  });

  const comparable = variants.filter((variant) => !variant.insufficientEvidence);
  const totalAttempts = variants.reduce((sum, variant) => sum + variant.attempts, 0);

  let leader: ExperimentReport['leader'] = null;
  let message: string;

  if (comparable.length < 2) {
    message = comparable.length === 0
      ? `No variant has ${MINIMUM_ATTEMPTS_FOR_COMPARISON} attempts in this cohort, so there is `
        + 'nothing to compare. Six calls is not a result.'
      : 'Only one variant has enough attempts, so there is nothing to compare it against.';
  } else {
    // Ranked on a downstream measure, because a hook that books meetings nobody
    // wanted is not a better hook.
    const withQuality = comparable.filter((variant) => variant.quality.meanScore !== null);
    const pool = withQuality.length >= 2 ? withQuality : comparable;
    const sorted = [...pool].sort((a, b) => {
      const qualityGap = (b.quality.meanScore ?? 0) - (a.quality.meanScore ?? 0);
      if (Math.abs(qualityGap) > 0.001) return qualityGap;
      const opportunityGap = (b.rates['opportunity_per_attended']!.rate ?? 0)
        - (a.rates['opportunity_per_attended']!.rate ?? 0);
      if (Math.abs(opportunityGap) > 0.001) return opportunityGap;
      return (b.rates['booking_completion']!.rate ?? 0)
        - (a.rates['booking_completion']!.rate ?? 0);
    });
    const best = sorted[0]!;
    leader = {
      openerVersion: best.openerVersion, openerFrame: best.openerFrame,
      basis: withQuality.length >= 2
        ? `mean meeting quality ${best.quality.meanScore} over ${best.quality.attended} attended`
        : `qualified outcomes over ${best.attempts} attempts; no quality scores yet, so this is `
          + 'provisional',
    };
    message = `${comparable.length} variant(s) cleared the floor of `
      + `${MINIMUM_ATTEMPTS_FOR_COMPARISON} attempts. Ranked on downstream quality, not on `
      + 'bookings.';
    if (withQuality.length < 2) {
      message += ` Fewer than two variants have ${MINIMUM_ATTENDED_FOR_QUALITY} scored meetings, `
        + 'so no variant should be promoted yet.';
    }
  }

  return {
    cohort, totalAttempts,
    insufficientEvidence: comparable.length < 2,
    message, variants, leader,
  };
}

/**
 * Whether a variant may be promoted.
 *
 * Separate from the comparison on purpose: reading a report is not the same as acting
 * on it, and the conditions for acting are stricter.
 */
export async function promotionReadiness(cohort: CohortFilter = {}): Promise<{
  ready: boolean; reasons: string[];
}> {
  const report = await compareHookVariants(cohort);
  const reasons: string[] = [];

  const comparable = report.variants.filter((variant) => !variant.insufficientEvidence);
  if (comparable.length < 2) {
    reasons.push('Fewer than two variants have enough attempts to compare.');
  }
  const scored = report.variants.filter((variant) => variant.quality.meanScore !== null);
  if (scored.length < 2) {
    reasons.push(`Fewer than two variants have ${MINIMUM_ATTENDED_FOR_QUALITY} scored meetings, `
      + 'so nothing is known about whether the meetings were any good.');
  }
  if (report.leader && scored.length >= 2) {
    const best = scored.find(
      (variant) => variant.openerVersion === report.leader!.openerVersion);
    const others = scored.filter((variant) => variant !== best);
    const margin = (best?.quality.meanScore ?? 0)
      - Math.max(...others.map((variant) => variant.quality.meanScore ?? 0));
    if (margin < 0.5) {
      reasons.push(`The leader is ahead by ${margin.toFixed(2)} on a 1-5 scale, which is inside `
        + 'the noise of this sample size.');
    }
  }
  return { ready: reasons.length === 0, reasons };
}
