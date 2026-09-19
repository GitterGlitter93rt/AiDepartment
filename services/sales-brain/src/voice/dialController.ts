import { query } from '../db/pool.js';
import { preflightCall } from '../compliance/eligibility.js';
import { readPilotState, type OutboundMode } from '../domain/pilot.js';

/**
 * Outbound dial controller for the Production Outbound Sales service.
 *
 * This is the layer that decides whether a call may be *created*. It holds no
 * transport: no Twilio client, no WebSocket, no TwiML. That separation is what lets
 * every rule below be tested without placing a call, and it is why this module can
 * later sit in front of the proven ConversationRelay transport without either side
 * knowing about the other (voice-runtime-reuse-audit §3).
 *
 * The rules, in the order a call must survive them:
 *
 *  1. the operator's mode allows outbound at all;
 *  2. dial creation is armed;
 *  3. concurrency is below the cap the operator set;
 *  4. the destination is eligible for AI voice *at this moment*, re-checked rather
 *     than read from whatever was stored when the candidate was added;
 *  5. the caller ID is an approved YAD number.
 *
 * Nothing here is advisory. A refusal is returned as a refusal with its reasons.
 */

export type DialRefusal =
  | 'OUTBOUND_MODE_OFF'
  | 'DIAL_CREATION_DISABLED'
  | 'CONCURRENCY_CAP_REACHED'
  | 'DESTINATION_NOT_ELIGIBLE'
  | 'CALLER_ID_NOT_APPROVED'
  | 'INTERNAL_TEST_DESTINATION_NOT_ALLOWLISTED'
  | 'NO_ENDPOINT';

export interface DialDecision {
  allowed: boolean;
  refusals: DialRefusal[];
  detail: string[];
  mode: OutboundMode;
  /** The immutable snapshot a permitted call must be created with. */
  snapshot?: {
    agentProfileId: string;
    modeAtStart: OutboundMode;
    endpointId: string;
    accountId: string;
    fromNumber: string;
    toNumber: string;
  };
}

export interface DialControllerConfig {
  /** Numbers YAD controls and may present as caller ID. */
  approvedCallerIds: string[];
  /** In INTERNAL_TEST, the only destinations that may be dialled. */
  internalTestDestinations: string[];
  agentProfileId: string;
}

export function defaultDialConfig(env: NodeJS.ProcessEnv = process.env): DialControllerConfig {
  const list = (name: string) =>
    (env[name] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return {
    approvedCallerIds: list('OUTBOUND_APPROVED_CALLER_IDS'),
    internalTestDestinations: list('OUTBOUND_INTERNAL_TEST_DESTINATIONS'),
    agentProfileId: 'yad-sales-core-v1',
  };
}

/** Digits only, so a stored `+19045550142` and a typed `(904) 555-0142` compare equal. */
function digits(value: string): string {
  return value.replace(/\D+/g, '');
}

export async function mayPlaceCall(input: {
  endpointId: string;
  fromNumber: string;
  now?: Date;
  config?: DialControllerConfig;
}): Promise<DialDecision> {
  const config = input.config ?? defaultDialConfig();
  const now = input.now ?? new Date();
  const refusals: DialRefusal[] = [];
  const detail: string[] = [];

  const state = await readPilotState();

  if (state.outboundMode === 'OFF') {
    refusals.push('OUTBOUND_MODE_OFF');
    detail.push('Outbound Sales AI is switched off.');
  }
  if (!state.outboundDialEnabled) {
    refusals.push('DIAL_CREATION_DISABLED');
    detail.push('Dial creation is disarmed.');
  }

  // Concurrency counts calls that are actually open, not calls ever made.
  const { rows: active } = await query<{ n: number }>(
    `select count(*)::int as n from voice_calls
      where direction = 'OUTBOUND' and ended_at is null`,
  );
  if ((active[0]?.n ?? 0) >= state.maxConcurrency) {
    refusals.push('CONCURRENCY_CAP_REACHED');
    detail.push(`${active[0]?.n ?? 0} outbound call(s) already open; the cap is ${state.maxConcurrency}.`);
  }

  const { rows: endpoints } = await query<{
    endpoint_id: string; account_id: string; normalized_value: string;
  }>(
    `select endpoint_id, account_id, normalized_value from contact_endpoints where endpoint_id = $1`,
    [input.endpointId],
  );
  const endpoint = endpoints[0];
  if (!endpoint) {
    refusals.push('NO_ENDPOINT');
    detail.push('That endpoint no longer exists.');
    return { allowed: false, refusals, detail, mode: state.outboundMode };
  }

  // Re-checked here, at the moment of the call. A decision stored when the candidate
  // was queued says nothing about whether the number may be called now.
  const eligibility = await preflightCall(input.endpointId, 'AUTONOMOUS_AI_VOICE', now);
  if (!eligibility.allowed) {
    refusals.push('DESTINATION_NOT_ELIGIBLE');
    detail.push(eligibility.message ?? `Not eligible: ${eligibility.reasonCodes.join(', ')}`);
  }

  // Only a YAD-controlled number may be presented. No rotating local numbers to fake
  // proximity (shared-number spec §9).
  const approved = config.approvedCallerIds.map(digits);
  if (approved.length === 0 || !approved.includes(digits(input.fromNumber))) {
    refusals.push('CALLER_ID_NOT_APPROVED');
    detail.push('That caller ID is not an approved YAD number.');
  }

  // Internal test dials only reach numbers we own.
  if (state.outboundMode === 'INTERNAL_TEST') {
    const allowlisted = config.internalTestDestinations.map(digits);
    if (!allowlisted.includes(digits(endpoint.normalized_value))) {
      refusals.push('INTERNAL_TEST_DESTINATION_NOT_ALLOWLISTED');
      detail.push('Internal test mode may only dial an allow-listed internal number.');
    }
  }

  if (refusals.length > 0) {
    return { allowed: false, refusals, detail, mode: state.outboundMode };
  }

  return {
    allowed: true, refusals: [], detail: ['Cleared to dial.'], mode: state.outboundMode,
    snapshot: {
      agentProfileId: config.agentProfileId,
      modeAtStart: state.outboundMode,
      endpointId: endpoint.endpoint_id,
      accountId: endpoint.account_id,
      fromNumber: input.fromNumber,
      toNumber: endpoint.normalized_value,
    },
  };
}

/**
 * Creates the call record for a permitted call.
 *
 * The snapshot is written with the row: an operator toggle after this point changes
 * new calls only, never this one (shared-number spec §7).
 */
export async function openCallRecord(snapshot: NonNullable<DialDecision['snapshot']>, input: {
  providerCallSid?: string | null; promptVersion?: string | null; contactId?: string | null;
  callPackId?: string | null;
}): Promise<string> {
  const { rows } = await query<{ voice_call_id: string }>(
    `insert into voice_calls
       (direction, agent_profile_id, prompt_version, mode_at_start, account_id, contact_id,
        endpoint_id, call_pack_id, provider_call_sid, from_number, to_number)
     values ('OUTBOUND', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning voice_call_id`,
    [snapshot.agentProfileId, input.promptVersion ?? null, snapshot.modeAtStart,
     snapshot.accountId, input.contactId ?? null, snapshot.endpointId, input.callPackId ?? null,
     input.providerCallSid ?? null, snapshot.fromNumber, snapshot.toNumber],
  );
  return rows[0]!.voice_call_id;
}

/** Records a refusal so a call that never happened is still explainable afterwards. */
export async function recordDialRefusal(input: {
  endpointId: string; decision: DialDecision; actorUserId?: string | null;
}): Promise<void> {
  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, detail)
     values ($1, 'voice.dial_refused', 'contact_endpoint', $2, $3, $4::jsonb)`,
    [input.actorUserId ?? null, input.endpointId,
     input.decision.refusals.join(', '),
     JSON.stringify({ mode: input.decision.mode, detail: input.decision.detail })],
  );
}
