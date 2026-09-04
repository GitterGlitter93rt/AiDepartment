import { config } from '../config.js';
import { query, withTransaction, type Queryable } from '../db/pool.js';

/**
 * Deterministic phone channel eligibility.
 * Authority: outbound-sales-brain-global-phone-channel-eligibility-dnc-spec.md.
 *
 * No model decides any of this (§5: "No LLM decides these rules"). Every decision is
 * a pure function of stored state plus the clock, is recorded with the policy version
 * that produced it, and is re-evaluated immediately before any call.
 *
 * The governing asymmetry: a number a human may dial is not automatically a number an
 * AI may dial. Collapsing the two into one CALL_READY flag is a release hard fail.
 */

export const POLICY_VERSION = 'phone-eligibility-v1';

export type Channel = 'HUMAN_MANUAL_CALL' | 'AUTONOMOUS_AI_VOICE' | 'SMS';
export type Decision = 'ALLOW' | 'BLOCK' | 'REVIEW_REQUIRED' | 'NOT_APPLICABLE';

/** Reason codes are safe to show a rep. They never leak registry membership. */
export type ReasonCode =
  | 'YAD_DNC'
  | 'ENDPOINT_SUPPRESSED'
  | 'ACCOUNT_SUPPRESSED'
  | 'WRONG_NUMBER'
  | 'DISCONNECTED'
  | 'REGISTRY_RESTRICTED'
  | 'REGISTRY_SCREEN_FAILED'
  | 'REGISTRY_NOT_SCREENED'
  | 'AI_VOICE_NOT_APPROVED'
  | 'AI_VOICE_PILOT_DISABLED'
  | 'LINE_TYPE_UNKNOWN'
  | 'PERSONAL_MOBILE'
  | 'OUTSIDE_CALLING_WINDOW'
  | 'ATTEMPT_COOLDOWN'
  | 'ENDPOINT_INACTIVE'
  | 'BUSINESS_LINE_VERIFIED'
  | 'OK';

export interface EligibilityResult {
  endpointId: string;
  humanManualCall: Decision;
  autonomousAiVoice: Decision;
  reasonCodes: ReasonCode[];
  nextHumanEligibleAt: Date | null;
  nextAiEligibleAt: Date | null;
  lineType: string;
  policyVersion: string;
  evaluatedAt: Date;
}

interface EndpointState {
  endpoint_id: string;
  account_id: string;
  normalized_value: string;
  endpoint_role: string;
  quality_state: string;
  line_type: string;
  is_active: boolean;
  is_suppressed: boolean;
  account_suppressed: boolean;
  timezone: string | null;
  dnc_suppression: boolean;
  registry_result: string | null;
  registry_expired: boolean;
  last_attempt_at: Date | null;
  attempts_last_7d: number;
}

/**
 * Calling window in the destination's local time.
 * Conservative default of 09:00–19:00 local, weekdays and Saturday.
 */
const CALLING_WINDOW = { startHour: 9, endHour: 19 };
const ATTEMPT_COOLDOWN_HOURS = 24;
const MAX_ATTEMPTS_PER_WEEK = 3;

/** Endpoint roles that clearly represent a business, not a person's private line. */
const BUSINESS_ROLES = new Set([
  'MAIN_BUSINESS_LINE', 'DIRECT_BUSINESS_LINE', 'LOCATION_BUSINESS_LINE',
  'EXTENSION', 'TOLL_FREE_BUSINESS', 'CALL_TRACKING_NUMBER',
]);

function localHour(timezone: string | null, now: Date): number | null {
  if (!timezone) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: '2-digit', hour12: false,
    }).format(now);
    return Number(formatted) % 24;
  } catch {
    return null;
  }
}

function nextWindowOpen(timezone: string | null, now: Date): Date | null {
  if (!timezone) return null;
  // Step forward hour by hour until the destination's local clock is inside the
  // window. Cheap, and correct across DST without a timezone library.
  for (let offset = 1; offset <= 48; offset += 1) {
    const candidate = new Date(now.getTime() + offset * 3_600_000);
    const hour = localHour(timezone, candidate);
    if (hour !== null && hour >= CALLING_WINDOW.startHour && hour < CALLING_WINDOW.endHour) {
      return candidate;
    }
  }
  return null;
}

/**
 * Evaluates both channels for one endpoint.
 *
 * Order is deliberate: absolute blocks first, then channel-specific policy, then
 * timing. A timing restriction produces `next_eligible_at`, not a permanent block.
 */
export function decide(state: EndpointState, now: Date = new Date()): EligibilityResult {
  const reasons: ReasonCode[] = [];
  let human: Decision = 'ALLOW';
  let ai: Decision = 'ALLOW';

  // --- absolute blocks, both channels ---------------------------------------
  // Collected first and checked as a set, so no later rule can soften one.
  const absoluteBlocks: ReasonCode[] = [];
  if (state.dnc_suppression) absoluteBlocks.push('YAD_DNC');
  if (state.account_suppressed) absoluteBlocks.push('ACCOUNT_SUPPRESSED');
  if (state.is_suppressed || state.quality_state === 'SUPPRESSED') absoluteBlocks.push('ENDPOINT_SUPPRESSED');
  if (state.quality_state === 'WRONG_NUMBER') absoluteBlocks.push('WRONG_NUMBER');
  if (state.quality_state === 'DISCONNECTED') absoluteBlocks.push('DISCONNECTED');
  if (!state.is_active) absoluteBlocks.push('ENDPOINT_INACTIVE');

  if (absoluteBlocks.length > 0) {
    return finish(state, 'BLOCK', 'BLOCK', absoluteBlocks, null, null, now);
  }

  // --- registry screening ----------------------------------------------------
  // A screening failure is never silently treated as a clean result (§19).
  const isBusinessLine = BUSINESS_ROLES.has(state.endpoint_role)
    && state.line_type !== 'mobile';

  if (state.registry_result === 'MATCH') {
    // A registry match restricts telemarketing calls. A verified business line is
    // generally out of scope, but that determination belongs to reviewed policy,
    // not to this code guessing — so it becomes a review rather than an allow.
    if (!isBusinessLine) {
      return finish(state, 'BLOCK', 'BLOCK', ['REGISTRY_RESTRICTED'], null, null, now);
    }
    human = 'REVIEW_REQUIRED';
    ai = 'BLOCK';
    reasons.push('REGISTRY_RESTRICTED');
  } else if (state.registry_result === 'SCREEN_FAILED') {
    human = 'REVIEW_REQUIRED';
    ai = 'BLOCK';
    reasons.push('REGISTRY_SCREEN_FAILED');
  } else if (state.registry_result === null || state.registry_result === 'NOT_SCREENED'
             || state.registry_expired) {
    // Unscreened is not the same as clear. A human may proceed on a verified
    // business line; an AI may not proceed on anything unscreened.
    if (isBusinessLine) {
      reasons.push('REGISTRY_NOT_SCREENED');
    } else {
      human = 'REVIEW_REQUIRED';
      reasons.push('REGISTRY_NOT_SCREENED');
    }
    ai = 'BLOCK';
  }

  // --- line type -------------------------------------------------------------
  if (state.line_type === 'unknown' && !isBusinessLine) {
    if (human === 'ALLOW') human = 'REVIEW_REQUIRED';
    reasons.push('LINE_TYPE_UNKNOWN');
    ai = 'BLOCK';
  }
  if (state.line_type === 'mobile' && !BUSINESS_ROLES.has(state.endpoint_role)) {
    // A personal mobile carries stricter rules than a published business line.
    if (human === 'ALLOW') human = 'REVIEW_REQUIRED';
    reasons.push('PERSONAL_MOBILE');
    ai = 'BLOCK';
  }

  // --- AI voice authorization ------------------------------------------------
  // The pilot gate has not been reached. AI voice stays blocked regardless of how
  // clean the endpoint is (CLAUDE-CURRENT-TASK.md §5).
  if (!config.outbound.dialEnabled) {
    ai = 'BLOCK';
    if (!reasons.includes('AI_VOICE_PILOT_DISABLED')) reasons.push('AI_VOICE_PILOT_DISABLED');
  } else if (ai === 'ALLOW' && !isBusinessLine) {
    ai = 'REVIEW_REQUIRED';
    reasons.push('AI_VOICE_NOT_APPROVED');
  }

  // --- timing ----------------------------------------------------------------
  let nextHuman: Date | null = null;
  let nextAi: Date | null = null;

  const hour = localHour(state.timezone, now);
  if (hour !== null && (hour < CALLING_WINDOW.startHour || hour >= CALLING_WINDOW.endHour)) {
    reasons.push('OUTSIDE_CALLING_WINDOW');
    const reopen = nextWindowOpen(state.timezone, now);
    if (human === 'ALLOW') { human = 'REVIEW_REQUIRED'; nextHuman = reopen; }
    if (ai === 'ALLOW') { ai = 'BLOCK'; nextAi = reopen; }
  }

  if (state.last_attempt_at) {
    const hoursSince = (now.getTime() - state.last_attempt_at.getTime()) / 3_600_000;
    if (hoursSince < ATTEMPT_COOLDOWN_HOURS) {
      reasons.push('ATTEMPT_COOLDOWN');
      const readyAt = new Date(state.last_attempt_at.getTime() + ATTEMPT_COOLDOWN_HOURS * 3_600_000);
      if (human === 'ALLOW') { human = 'REVIEW_REQUIRED'; nextHuman = readyAt; }
      if (ai === 'ALLOW') { ai = 'BLOCK'; nextAi = readyAt; }
    }
  }
  if (state.attempts_last_7d >= MAX_ATTEMPTS_PER_WEEK) {
    reasons.push('ATTEMPT_COOLDOWN');
    if (human === 'ALLOW') human = 'REVIEW_REQUIRED';
    ai = 'BLOCK';
  }

  if (reasons.length === 0) {
    reasons.push(isBusinessLine ? 'BUSINESS_LINE_VERIFIED' : 'OK');
  }

  return finish(state, human, ai, reasons, nextHuman, nextAi, now);
}

function finish(
  state: EndpointState, human: Decision, ai: Decision, reasons: ReasonCode[],
  nextHuman: Date | null, nextAi: Date | null, now: Date,
): EligibilityResult {
  return {
    endpointId: state.endpoint_id,
    humanManualCall: human,
    autonomousAiVoice: ai,
    reasonCodes: reasons,
    nextHumanEligibleAt: nextHuman,
    nextAiEligibleAt: nextAi,
    lineType: state.line_type,
    policyVersion: POLICY_VERSION,
    evaluatedAt: now,
  };
}

/** Loads the state one endpoint's decision depends on. */
async function loadEndpointState(
  client: Queryable, endpointId: string,
): Promise<EndpointState | null> {
  const { rows } = await client.query<EndpointState>(
    `select e.endpoint_id, e.account_id, e.normalized_value, e.endpoint_role, e.quality_state,
            e.line_type, e.is_active, e.is_suppressed,
            a.is_suppressed as account_suppressed,
            coalesce(l.timezone, 'America/New_York') as timezone,
            exists (
              select 1 from suppressions s
               where s.is_active and s.suppression_type in ('DNC','LEGAL_POLICY','CLIENT_NO_COLD_OUTREACH')
                 and (s.expires_at is null or s.expires_at > now())
                 and (s.endpoint_id = e.endpoint_id
                      or s.normalized_value = e.normalized_value
                      or (s.account_id = e.account_id and s.scope = 'ACCOUNT'))
            ) as dnc_suppression,
            (select r.result from registry_screen_results r
              where r.endpoint_id = e.endpoint_id
              order by r.screened_at desc limit 1) as registry_result,
            coalesce((select r.expires_at < now() from registry_screen_results r
                       where r.endpoint_id = e.endpoint_id
                       order by r.screened_at desc limit 1), true) as registry_expired,
            (select max(ca.started_at) from contact_attempts ca where ca.endpoint_id = e.endpoint_id)
              as last_attempt_at,
            (select count(*)::int from contact_attempts ca
              where ca.endpoint_id = e.endpoint_id and ca.started_at > now() - interval '7 days')
              as attempts_last_7d
       from contact_endpoints e
       join accounts a on a.account_id = e.account_id
       left join locations l on l.location_id = e.location_id
      where e.endpoint_id = $1 and e.endpoint_type = 'PHONE'`,
    [endpointId],
  );
  return rows[0] ?? null;
}

/**
 * Evaluates and persists the current decision for one endpoint.
 * Called on endpoint creation, on claim, and — critically — immediately before any
 * call action (§11 screening moments).
 */
export async function evaluateAndStore(
  endpointId: string, now: Date = new Date(),
): Promise<EligibilityResult | null> {
  return withTransaction(async (client) => {
    const state = await loadEndpointState(client, endpointId);
    if (!state) return null;

    const result = decide(state, now);

    await client.query(
      `update contact_endpoints
          set human_manual_call = $2, autonomous_ai_voice = $3,
              eligibility_reason_codes = $4, eligibility_evaluated_at = $5,
              eligibility_policy_version = $6,
              next_human_eligible_at = $7, next_ai_eligible_at = $8
        where endpoint_id = $1`,
      [
        endpointId, result.humanManualCall, result.autonomousAiVoice, result.reasonCodes,
        result.evaluatedAt, result.policyVersion, result.nextHumanEligibleAt, result.nextAiEligibleAt,
      ],
    );

    for (const [channel, decision, nextAt] of [
      ['HUMAN_MANUAL_CALL', result.humanManualCall, result.nextHumanEligibleAt],
      ['AUTONOMOUS_AI_VOICE', result.autonomousAiVoice, result.nextAiEligibleAt],
    ] as const) {
      await client.query(
        `insert into channel_eligibility_decisions (endpoint_id, account_id, channel, decision,
                                                    reason_codes, policy_version, line_type,
                                                    next_eligible_at, evaluated_at, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz, $9::timestamptz + interval '15 minutes')`,
        [
          endpointId, state.account_id, channel, decision, result.reasonCodes,
          result.policyVersion, state.line_type, nextAt, result.evaluatedAt,
        ],
      );
    }

    return result;
  });
}

export interface PreflightResult {
  allowed: boolean;
  decision: Decision;
  decisionId: number | null;
  reasonCodes: ReasonCode[];
  /** Plain text a rep can act on. Never mentions registry membership. */
  message: string;
  nextEligibleAt: Date | null;
}

/**
 * The gate immediately before a call is placed.
 * A stored decision is never trusted: it is recomputed here, because suppression may
 * have arrived seconds ago and the calling window moves.
 */
export async function preflightCall(
  endpointId: string, channel: 'HUMAN_MANUAL_CALL' | 'AUTONOMOUS_AI_VOICE',
  now: Date = new Date(),
): Promise<PreflightResult> {
  const result = await evaluateAndStore(endpointId, now);
  if (!result) {
    return {
      allowed: false, decision: 'BLOCK', decisionId: null, reasonCodes: [],
      message: 'That number could not be found.', nextEligibleAt: null,
    };
  }

  const decision = channel === 'HUMAN_MANUAL_CALL' ? result.humanManualCall : result.autonomousAiVoice;
  const nextEligibleAt = channel === 'HUMAN_MANUAL_CALL'
    ? result.nextHumanEligibleAt : result.nextAiEligibleAt;

  const { rows } = await query<{ decision_id: number }>(
    `select decision_id from channel_eligibility_decisions
      where endpoint_id = $1 and channel = $2 order by evaluated_at desc limit 1`,
    [endpointId, channel],
  );

  return {
    allowed: decision === 'ALLOW',
    decision,
    decisionId: rows[0]?.decision_id ?? null,
    reasonCodes: result.reasonCodes,
    message: explain(decision, result.reasonCodes, nextEligibleAt),
    nextEligibleAt,
  };
}

/**
 * Rep-facing explanation. Deliberately does not say "this number is on a registry":
 * registry membership is purpose-limited and must not become a stated fact (§6).
 */
export function explain(
  decision: Decision, reasons: ReasonCode[], nextEligibleAt: Date | null,
): string {
  if (decision === 'ALLOW') return 'Cleared to call.';

  if (reasons.includes('YAD_DNC') || reasons.includes('ACCOUNT_SUPPRESSED')) {
    return 'Do not call — this company asked not to be contacted.';
  }
  if (reasons.includes('ENDPOINT_SUPPRESSED')) return 'Do not call — this number is suppressed.';
  if (reasons.includes('WRONG_NUMBER')) return 'Marked wrong number — do not use.';
  if (reasons.includes('DISCONNECTED')) return 'This number is disconnected.';
  if (reasons.includes('REGISTRY_RESTRICTED')) {
    return 'Calling restrictions apply to this number. A manager must review before it is used.';
  }
  if (reasons.includes('REGISTRY_SCREEN_FAILED')) {
    return 'Screening could not be completed, so this number is not cleared yet. Try again shortly.';
  }
  if (reasons.includes('OUTSIDE_CALLING_WINDOW')) {
    return nextEligibleAt
      ? `Outside local calling hours. Callable from ${nextEligibleAt.toLocaleString('en-US')}.`
      : 'Outside local calling hours.';
  }
  if (reasons.includes('ATTEMPT_COOLDOWN')) {
    return nextEligibleAt
      ? `Recently attempted. Next attempt allowed from ${nextEligibleAt.toLocaleString('en-US')}.`
      : 'This number has been attempted too recently.';
  }
  if (reasons.includes('AI_VOICE_PILOT_DISABLED')) {
    return 'Autonomous AI voice is switched off.';
  }
  if (reasons.includes('PERSONAL_MOBILE')) {
    return 'This looks like a personal mobile rather than a published business line. Review before calling.';
  }
  if (reasons.includes('LINE_TYPE_UNKNOWN') || reasons.includes('REGISTRY_NOT_SCREENED')) {
    return 'Not yet cleared for calling. Screening is pending.';
  }
  return 'Not cleared for calling.';
}

/** Re-evaluates every phone endpoint on an Account. Used after a claim. */
export async function evaluateAccount(accountId: string, now: Date = new Date()): Promise<number> {
  const { rows } = await query<{ endpoint_id: string }>(
    `select endpoint_id from contact_endpoints where account_id = $1 and endpoint_type = 'PHONE'`,
    [accountId],
  );
  for (const row of rows) await evaluateAndStore(row.endpoint_id, now);
  return rows.length;
}
