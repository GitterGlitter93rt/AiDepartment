import { query } from '../db/pool.js';
import { normalizePhone } from '../domain/normalize.js';

/**
 * Recent-outbound callback routing.
 * Authority: outbound-sales-brain-shared-twilio-number-dual-service-spec.md §8, §3, §7.
 *
 * A prospect we called back may ring the same number. That call arrives on the
 * inbound webhook and belongs to Production Inbound — it must never restart the cold
 * script, because they are answering us, not being approached.
 *
 * So this module decides three things and nothing else:
 *
 *   1. which Account, if any, the caller is;
 *   2. what the receptionist may safely say about why we called;
 *   3. where the call should go — a person, a callback capture, or ordinary intake.
 *
 * It never returns the sales agent profile. The only profile it can produce is the
 * receptionist's, and a test asserts that.
 */

export const INBOUND_PROFILE = 'yad-receptionist-v1';

/** How long an outbound attempt stays relevant to an inbound callback. */
export const CALLBACK_WINDOW_DAYS = 14;

export type CallbackRoute =
  | 'ORDINARY_INTAKE'
  | 'SUPPRESSED_NO_PITCH'
  | 'WRONG_NUMBER_NO_HISTORY'
  | 'CONFIRM_EXISTING_MEETING'
  | 'ROUTE_TO_OWNER'
  | 'CAPTURE_CALLBACK_INTENT';

export interface CallbackDecision {
  route: CallbackRoute;
  agentProfileId: typeof INBOUND_PROFILE;
  accountId: string | null;
  companyName: string | null;
  /** The rep who owns the relationship, when there is one to transfer to. */
  ownerUserId: string | null;
  ownerName: string | null;
  /**
   * What the receptionist may say out loud about the earlier contact. Empty when
   * nothing may be referenced — which is not the same as nothing being known.
   */
  spokenContext: string;
  /** Whether a warm transfer is worth attempting. */
  offerTransfer: boolean;
  reasonCodes: string[];
}

interface CallerRow {
  account_id: string;
  canonical_name: string;
  is_suppressed: boolean;
  relationship_state: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  last_outbound_at: Date | null;
  last_outbound_disposition: string | null;
  wrong_number: boolean;
  confirmed_meeting_at: Date | null;
  has_open_opportunity: boolean;
}

/**
 * Resolves an inbound caller against the canonical Account.
 *
 * Matching is on the normalized digits of a *business* endpoint we hold. A caller
 * whose number we do not hold is simply unknown; nothing is inferred from an area
 * code or a name, because a wrong guess here would have the receptionist greet a
 * stranger as a prospect.
 */
async function resolveCaller(fromNumber: string, now: Date): Promise<CallerRow | null> {
  const normalized = normalizePhone(fromNumber);
  if (!normalized) return null;
  const digits = normalized.replace(/\D+/g, '');
  if (digits.length < 10) return null;

  const { rows } = await query<CallerRow>(
    `select a.account_id, a.canonical_name, a.is_suppressed, a.relationship_state,
            a.current_owner_user_id as owner_user_id, u.display_name as owner_name,
            (select max(at.started_at) from contact_attempts at
              where at.account_id = a.account_id
                and at.channel in ('HUMAN_MANUAL_CALL','AUTONOMOUS_AI_VOICE')
                and at.started_at > $2::timestamptz - ($3::text || ' days')::interval
            ) as last_outbound_at,
            (select at.disposition from contact_attempts at
              where at.account_id = a.account_id
                and at.channel in ('HUMAN_MANUAL_CALL','AUTONOMOUS_AI_VOICE')
              order by at.started_at desc limit 1) as last_outbound_disposition,
            exists (select 1 from contact_attempts at
                     where at.account_id = a.account_id
                       and at.disposition = 'WRONG_NUMBER') as wrong_number,
            (select min(b.requested_start) from meeting_bookings b
              where b.account_id = a.account_id and b.status = 'CONFIRMED'
                and b.requested_start > $2::timestamptz) as confirmed_meeting_at,
            exists (select 1 from opportunities o
                     where o.account_id = a.account_id
                       and o.stage not in ('CLOSED_WON','CLOSED_LOST')) as has_open_opportunity
       from contact_endpoints e
       join accounts a on a.account_id = e.account_id
       left join users u on u.user_id = a.current_owner_user_id
      where e.endpoint_type = 'PHONE'
        and regexp_replace(e.normalized_value, '\\D', '', 'g') like '%' || $1
      order by e.created_at
      limit 1`,
    [digits.slice(-10), now, String(CALLBACK_WINDOW_DAYS)],
  );
  return rows[0] ?? null;
}

/**
 * Decides how an inbound call is handled.
 *
 * The order matters and is deliberate. Suppression comes first, because a company
 * that told us not to contact them must not hear a reference to our outreach. A
 * recorded wrong number comes next, because the person holding this handset is not
 * the company we were calling and has no relationship to be reminded of.
 */
export async function routeInboundCall(input: {
  fromNumber: string; now?: Date;
}): Promise<CallbackDecision> {
  const now = input.now ?? new Date();
  const caller = await resolveCaller(input.fromNumber, now);

  const base = {
    agentProfileId: INBOUND_PROFILE as typeof INBOUND_PROFILE,
    accountId: caller?.account_id ?? null,
    companyName: caller?.canonical_name ?? null,
    ownerUserId: caller?.owner_user_id ?? null,
    ownerName: caller?.owner_name ?? null,
  };

  if (!caller) {
    return {
      ...base, route: 'ORDINARY_INTAKE', spokenContext: '', offerTransfer: false,
      reasonCodes: ['caller_not_recognised'],
    };
  }

  // A company on the suppression list is answered normally and never reminded that
  // we called. Referencing our outreach to someone who asked us to stop is the exact
  // harm the suppression exists to prevent.
  if (caller.is_suppressed) {
    return {
      ...base, route: 'SUPPRESSED_NO_PITCH', spokenContext: '', offerTransfer: false,
      reasonCodes: ['account_suppressed', 'no_outbound_context_spoken'],
    };
  }

  // The number reached the wrong company once. Whoever is holding it now has no
  // relationship with us, so there is nothing to recall.
  if (caller.wrong_number) {
    return {
      ...base, route: 'WRONG_NUMBER_NO_HISTORY', accountId: null, companyName: null,
      spokenContext: '', offerTransfer: false,
      reasonCodes: ['recorded_wrong_number', 'no_outbound_context_spoken'],
    };
  }

  if (caller.confirmed_meeting_at) {
    return {
      ...base, route: 'CONFIRM_EXISTING_MEETING',
      spokenContext: `${caller.canonical_name} has a confirmed strategy call booked.`,
      offerTransfer: Boolean(caller.owner_user_id),
      reasonCodes: ['confirmed_meeting_exists'],
    };
  }

  if (caller.has_open_opportunity || caller.relationship_state === 'ACTIVE_OPPORTUNITY') {
    return {
      ...base, route: 'ROUTE_TO_OWNER',
      spokenContext: caller.owner_name
        ? `${caller.canonical_name} is already working with ${caller.owner_name}.`
        : `${caller.canonical_name} is already in conversation with us.`,
      offerTransfer: Boolean(caller.owner_user_id),
      reasonCodes: ['open_opportunity'],
    };
  }

  if (caller.last_outbound_at) {
    return {
      ...base, route: 'CAPTURE_CALLBACK_INTENT',
      // Only that we called, and roughly when. Never the hypothesis, the score, the
      // opener that was used, or anything else from the research.
      spokenContext: `We called ${caller.canonical_name} recently`
        + `${caller.owner_name ? ` — that was ${caller.owner_name}` : ''}.`,
      offerTransfer: Boolean(caller.owner_user_id),
      reasonCodes: ['recent_outbound_attempt', 'returning_our_call'],
    };
  }

  return {
    ...base, route: 'ORDINARY_INTAKE', spokenContext: '', offerTransfer: false,
    reasonCodes: ['known_account_no_recent_outbound'],
  };
}

/**
 * Records the inbound call against the canonical Account.
 *
 * Written whatever the route, including for an unrecognised caller, so the inbound
 * side of the shared number is as auditable as the outbound side.
 */
export async function recordInboundCall(input: {
  decision: CallbackDecision; fromNumber: string; toNumber: string;
  providerCallSid?: string | null;
}): Promise<string> {
  const { rows } = await query<{ voice_call_id: string }>(
    `insert into voice_calls
       (direction, agent_profile_id, mode_at_start, account_id, provider_call_sid,
        from_number, to_number)
     values ('INBOUND', $1, 'INBOUND_RECEPTIONIST', $2, $3, $4, $5)
     returning voice_call_id`,
    [input.decision.agentProfileId, input.decision.accountId,
     input.providerCallSid ?? null, input.fromNumber, input.toNumber],
  );
  const voiceCallId = rows[0]!.voice_call_id;

  await query(
    `insert into voice_call_events (voice_call_id, kind, label, detail)
     values ($1, 'POLICY', $2, $3::jsonb)`,
    [voiceCallId, `Inbound routed: ${input.decision.route}`,
     JSON.stringify({ reasonCodes: input.decision.reasonCodes,
                      spokeOutboundContext: input.decision.spokenContext.length > 0 })],
  );
  return voiceCallId;
}

/**
 * Captures what a returning caller wanted, so the callback becomes work rather than
 * a note nobody reads.
 *
 * The follow-up goes to the Account's owner where there is one. Where there is not,
 * it is created unowned and appears on the manager's queue — an inbound callback
 * from an unclaimed prospect is exactly the case that must not be dropped.
 *
 * Nothing here books, dials or promises anything. It records an intent for a human.
 */
export async function captureCallbackIntent(input: {
  decision: CallbackDecision;
  voiceCallId: string;
  /** What the caller actually said, in their words. */
  callerStatement: string;
  dueAt?: Date;
  timezone?: string | null;
}): Promise<{ ok: boolean; followupId?: number; reason?: string }> {
  if (!input.decision.accountId) {
    return { ok: false, reason: 'no_account_to_attach_to' };
  }
  if (input.decision.route === 'SUPPRESSED_NO_PITCH') {
    // A suppressed company calling in is answered, but no sales follow-up is created
    // off the back of it.
    return { ok: false, reason: 'account_suppressed' };
  }

  const statement = input.callerStatement.trim().slice(0, 2000);

  // The callback is recorded on the Account first, because that is the record that
  // survives whoever ends up owning it.
  await query(
    `insert into activities
       (account_id, owner_user_id, activity_type, channel, disposition, notes, source_system)
     values ($1, $2, 'CALLBACK_REQUESTED', 'phone', 'CALLBACK_REQUESTED', $3, 'inbound_voice')`,
    [input.decision.accountId, input.decision.ownerUserId,
     `Inbound callback: ${statement}`],
  );

  // A follow-up always belongs to somebody, so an unowned Account cannot have one.
  // Rather than inventing an owner, the Account is moved to CALLBACK_REQUESTED, which
  // is a protected state: it surfaces in inventory and cannot be quietly recycled.
  if (!input.decision.ownerUserId) {
    await query(
      `update accounts set relationship_state = 'CALLBACK_REQUESTED', updated_at = now()
        where account_id = $1 and not is_suppressed`,
      [input.decision.accountId],
    );
    await query(
      `insert into voice_call_events (voice_call_id, kind, label, detail)
       values ($1, 'TOOL_RESULT', 'Callback recorded on an unowned account', $2::jsonb)`,
      [input.voiceCallId, JSON.stringify({ routedTo: 'unclaimed inventory, callback requested' })],
    );
    return { ok: true, reason: 'recorded_on_account_pending_owner' };
  }

  const { rows } = await query<{ followup_id: number }>(
    `insert into follow_ups
       (account_id, owner_user_id, followup_type, due_at, timezone, prospect_requested, context)
     values ($1, $2, 'CALLBACK', $3, $4, true, $5)
     returning followup_id`,
    [input.decision.accountId, input.decision.ownerUserId,
     input.dueAt ?? new Date(Date.now() + 60 * 60 * 1000),
     input.timezone ?? null,
     `Inbound callback: ${statement}`],
  );

  await query(
    `insert into voice_call_events (voice_call_id, kind, label, detail)
     values ($1, 'TOOL_RESULT', 'Callback intent captured', $2::jsonb)`,
    [input.voiceCallId, JSON.stringify({
      followupId: rows[0]!.followup_id, routedTo: input.decision.ownerName ?? 'owner',
    })],
  );

  return { ok: true, followupId: rows[0]!.followup_id };
}
