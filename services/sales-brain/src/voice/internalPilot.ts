import { query, withTransaction } from '../db/pool.js';
import { normalizePhone } from '../domain/normalize.js';
import { readPilotState } from '../domain/pilot.js';
import { buildCallPack, persistCallPack } from '../callbrain/callPack.js';
import { startCall } from '../callbrain/agent.js';
import { defaultDialConfig } from './dialController.js';

/**
 * Internal audio pilot.
 * Authority: outbound-sales-brain-ai-pilot-release-gates.v1.yaml G19,
 * outbound-sales-brain-shared-twilio-number-dual-service-spec.md §6, §10.
 *
 * This is the harness for making the first audio call to a handset we own. It is not
 * prospect calling and cannot become it:
 *
 *  - only an explicitly allowlisted number can be dialled, and a number that belongs
 *    to any Account in the database is refused from the allowlist;
 *  - the operator names the number and the count; nothing is selected automatically
 *    and there is no queue to drain;
 *  - outbound mode must be INTERNAL_TEST — not CONTROLLED_PILOT, not ENABLED_BY_POLICY;
 *  - one active call at a time, held by a unique index rather than by convention;
 *  - the clearance this module issues is INTERNAL_TEST_ALLOW, which is deliberately
 *    not one of the production eligibility decisions. Nothing in the production dial
 *    path reads it, and a test asserts that.
 *
 * The DNC provider is not consulted, because these are our own handsets and screening
 * them would tell us nothing. That exemption is the reason the clearance has its own
 * name: it must never be mistaken for a prospect being callable.
 */

export const INTERNAL_TEST_CLEARANCE = 'INTERNAL_TEST_ALLOW' as const;

export type PilotRefusal =
  | 'NUMBER_NOT_ALLOWLISTED'
  | 'ALLOWLIST_ENTRY_REVOKED'
  | 'NUMBER_BELONGS_TO_AN_ACCOUNT'
  | 'MODE_NOT_INTERNAL_TEST'
  | 'DIAL_CREATION_DISABLED'
  | 'BATCH_NOT_OPEN'
  | 'BATCH_CEILING_REACHED'
  | 'CALL_ALREADY_ACTIVE'
  | 'CALLER_ID_NOT_APPROVED'
  | 'NO_CALL_PACK';

export interface AllowlistResult {
  ok: boolean;
  internalTestNumberId?: string;
  message?: string;
}

/**
 * Adds a number to the internal allowlist.
 *
 * Refused if the number is already a contact endpoint on any Account. That is the
 * mechanism behind "no prospect can be dialled": a prospect's number cannot enter the
 * allowlist in the first place, so no later mistake can route a test call to one.
 */
export async function allowlistInternalNumber(input: {
  phone: string; label: string; justification: string; actorUserId: string;
}): Promise<AllowlistResult> {
  const normalized = normalizePhone(input.phone);
  if (!normalized) return { ok: false, message: 'That is not a phone number we can dial.' };
  if (input.justification.trim().length < 10) {
    return { ok: false, message: 'Say whose handset this is. An allowlist without a reason '
      + 'is not an allowlist.' };
  }

  const { rows: conflicts } = await query<{ canonical_name: string }>(
    `select a.canonical_name
       from contact_endpoints e
       join accounts a on a.account_id = e.account_id
      where e.endpoint_type = 'PHONE'
        and regexp_replace(e.normalized_value, '\\D', '', 'g')
            = regexp_replace($1, '\\D', '', 'g')
      limit 1`,
    [normalized],
  );
  if (conflicts[0]) {
    return { ok: false, message: `That number belongs to ${conflicts[0].canonical_name} in the `
      + 'database. An internal test number must be a handset we own.' };
  }

  const { rows } = await query<{ internal_test_number_id: string }>(
    `insert into internal_test_numbers
       (normalized_value, display_value, label, added_by, justification)
     values ($1, $2, $3, $4, $5)
     on conflict (normalized_value) do update
       set revoked_at = null, revoked_by = null, revoked_reason = null,
           label = excluded.label, justification = excluded.justification,
           added_by = excluded.added_by, added_at = now()
     returning internal_test_number_id`,
    [normalized, input.phone.trim(), input.label.trim(), input.actorUserId,
     input.justification.trim()],
  );

  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, detail)
     values ($1, 'internal_pilot.allowlist_number', 'internal_test_number', $2, $3, $4::jsonb)`,
    [input.actorUserId, rows[0]!.internal_test_number_id, input.justification.trim(),
     JSON.stringify({ label: input.label })],
  );
  return { ok: true, internalTestNumberId: rows[0]!.internal_test_number_id };
}

export async function revokeInternalNumber(input: {
  internalTestNumberId: string; actorUserId: string; reason: string;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.reason.trim()) return { ok: false, message: 'A reason is required.' };
  const { rowCount } = await query(
    `update internal_test_numbers
        set revoked_at = now(), revoked_by = $2, revoked_reason = $3
      where internal_test_number_id = $1 and revoked_at is null`,
    [input.internalTestNumberId, input.actorUserId, input.reason.trim()],
  );
  if (!rowCount) return { ok: false, message: 'No active allowlist entry with that id.' };
  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason)
     values ($1, 'internal_pilot.revoke_number', 'internal_test_number', $2, $3)`,
    [input.actorUserId, input.internalTestNumberId, input.reason.trim()],
  );
  return { ok: true };
}

export async function listInternalNumbers() {
  const { rows } = await query<any>(
    `select n.internal_test_number_id, n.normalized_value, n.display_value, n.label,
            n.justification, n.added_at, n.revoked_at, n.revoked_reason,
            u.display_name as added_by_name
       from internal_test_numbers n
       left join users u on u.user_id = n.added_by
      order by n.revoked_at nulls first, n.added_at desc`,
  );
  return rows;
}

export interface BatchResult { ok: boolean; batchId?: string; message?: string }

/** Opens a batch against one allowlisted number, with a ceiling the operator sets. */
export async function openAudioPilotBatch(input: {
  internalTestNumberId: string; maxCalls: number; purpose: string; actorUserId: string;
}): Promise<BatchResult> {
  if (input.purpose.trim().length < 10) {
    return { ok: false, message: 'Say what this batch is for.' };
  }
  if (!Number.isInteger(input.maxCalls) || input.maxCalls < 1 || input.maxCalls > 10) {
    return { ok: false, message: 'A batch is between one and ten calls.' };
  }
  const { rows: number } = await query<{ revoked_at: Date | null }>(
    `select revoked_at from internal_test_numbers where internal_test_number_id = $1`,
    [input.internalTestNumberId]);
  if (!number[0]) return { ok: false, message: 'That number is not on the allowlist.' };
  if (number[0].revoked_at) return { ok: false, message: 'That allowlist entry was revoked.' };

  const { rows } = await query<{ audio_pilot_batch_id: string }>(
    `insert into audio_pilot_batches
       (created_by, purpose, internal_test_number_id, max_calls)
     values ($1, $2, $3, $4)
     returning audio_pilot_batch_id`,
    [input.actorUserId, input.purpose.trim(), input.internalTestNumberId, input.maxCalls],
  );
  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, detail)
     values ($1, 'internal_pilot.open_batch', 'audio_pilot_batch', $2, $3, $4::jsonb)`,
    [input.actorUserId, rows[0]!.audio_pilot_batch_id, input.purpose.trim(),
     JSON.stringify({ maxCalls: input.maxCalls, dialled: false })],
  );
  return { ok: true, batchId: rows[0]!.audio_pilot_batch_id };
}

/** The destructive control: no further call is created from this batch. */
export async function stopAudioPilotBatch(input: {
  batchId: string; actorUserId: string; reason: string;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.reason.trim()) return { ok: false, message: 'A reason is required.' };
  const { rowCount } = await query(
    `update audio_pilot_batches
        set state = 'STOPPED', stopped_reason = $2, closed_at = now()
      where audio_pilot_batch_id = $1 and state in ('OPEN','PAUSED')`,
    // Who stopped it is on the audit row; the batch records why.
    [input.batchId, input.reason.trim()],
  );
  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason)
     values ($1, 'internal_pilot.stop_batch', 'audio_pilot_batch', $2, $3)`,
    [input.actorUserId, input.batchId, input.reason.trim()],
  );
  return rowCount ? { ok: true } : { ok: false, message: 'That batch was not open.' };
}

export interface PilotClearance {
  cleared: boolean;
  clearance: typeof INTERNAL_TEST_CLEARANCE | 'REFUSED';
  refusals: PilotRefusal[];
  detail: string[];
  attemptId?: string;
  /** Everything the transport needs, computed before the call rather than during it. */
  callPlan?: {
    toNumber: string;
    fromNumber: string;
    precomputedOpener: string;
    callPackId: string;
    agentProfileId: 'yad-sales-core-v1';
    modeAtStart: 'INTERNAL_TEST';
  };
}

/**
 * Decides whether one internal audio call may be created, and prepares it.
 *
 * Every refusal is recorded as an attempt with clearance REFUSED, so a call that did
 * not happen is as auditable as one that did. The opener is computed here so the
 * first thing the caller hears is not waiting on a model.
 */
export async function prepareInternalCall(input: {
  batchId: string; accountId: string; actorUserId: string; fromNumber?: string;
}): Promise<PilotClearance> {
  const refusals: PilotRefusal[] = [];
  const detail: string[] = [];
  const config = defaultDialConfig();

  const state = await readPilotState();
  // INTERNAL_TEST specifically. A batch must not run because outbound happens to be
  // switched on for something else.
  if (state.outboundMode !== 'INTERNAL_TEST') {
    refusals.push('MODE_NOT_INTERNAL_TEST');
    detail.push(`Outbound mode is ${state.outboundMode}; an internal audio call requires `
      + 'INTERNAL_TEST.');
  }
  if (!state.outboundDialEnabled) {
    refusals.push('DIAL_CREATION_DISABLED');
    detail.push('Dial creation is disarmed.');
  }

  const { rows: batches } = await query<any>(
    `select b.*, n.normalized_value, n.display_value, n.revoked_at
       from audio_pilot_batches b
       join internal_test_numbers n on n.internal_test_number_id = b.internal_test_number_id
      where b.audio_pilot_batch_id = $1`,
    [input.batchId]);
  const batch = batches[0];
  if (!batch) {
    return record({ cleared: false, clearance: 'REFUSED',
      refusals: ['BATCH_NOT_OPEN'], detail: ['No such batch.'] });
  }
  if (batch.state !== 'OPEN') {
    refusals.push('BATCH_NOT_OPEN');
    detail.push(`The batch is ${batch.state}.`);
  }
  if (batch.calls_started >= batch.max_calls) {
    refusals.push('BATCH_CEILING_REACHED');
    detail.push(`${batch.calls_started} of ${batch.max_calls} calls already started.`);
  }
  if (batch.revoked_at) {
    refusals.push('ALLOWLIST_ENTRY_REVOKED');
    detail.push('The allowlist entry for this number was revoked.');
  }

  // Re-checked at dial time, not trusted from when the batch was opened.
  const { rows: stillAllowlisted } = await query<{ n: number }>(
    `select count(*)::int as n from internal_test_numbers
      where normalized_value = $1 and revoked_at is null`,
    [batch.normalized_value]);
  if ((stillAllowlisted[0]?.n ?? 0) === 0) {
    refusals.push('NUMBER_NOT_ALLOWLISTED');
    detail.push('That number is not on the active allowlist.');
  }

  // And re-checked against the prospect database: if the number has since become a
  // contact endpoint on any Account, it is no longer an internal handset.
  const { rows: owned } = await query<{ canonical_name: string }>(
    `select a.canonical_name from contact_endpoints e
       join accounts a on a.account_id = e.account_id
      where e.endpoint_type = 'PHONE'
        and regexp_replace(e.normalized_value, '\\D', '', 'g')
            = regexp_replace($1, '\\D', '', 'g')
      limit 1`,
    [batch.normalized_value]);
  if (owned[0]) {
    refusals.push('NUMBER_BELONGS_TO_AN_ACCOUNT');
    detail.push(`That number now belongs to ${owned[0].canonical_name}.`);
  }

  const fromNumber = input.fromNumber ?? config.approvedCallerIds[0] ?? '';
  const approved = config.approvedCallerIds.map((value) => value.replace(/\D+/g, ''));
  if (!fromNumber || !approved.includes(fromNumber.replace(/\D+/g, ''))) {
    refusals.push('CALLER_ID_NOT_APPROVED');
    detail.push('No approved YAD caller ID is configured.');
  }

  // One at a time. The unique index is the real guard; this is the readable message.
  const { rows: active } = await query<{ n: number }>(
    `select count(*)::int as n from audio_pilot_attempts
      where clearance = 'INTERNAL_TEST_ALLOW' and outcome is null`);
  if ((active[0]?.n ?? 0) > 0) {
    refusals.push('CALL_ALREADY_ACTIVE');
    detail.push('An internal call is already open. The pilot runs one at a time.');
  }

  if (refusals.length > 0) {
    return record({ cleared: false, clearance: 'REFUSED', refusals, detail });
  }

  // The opener is computed and stored now, so the greeting does not wait on a model
  // and what was spoken is knowable afterwards.
  const pack = await buildCallPack(input.accountId);
  if (!pack) {
    return record({ cleared: false, clearance: 'REFUSED', refusals: ['NO_CALL_PACK'],
      detail: ['No Call Pack could be built, so there is nothing truthful to open with.'] });
  }
  const callPackId = await persistCallPack(pack, null);
  const { opening } = startCall({
    pack,
    tools: { booking: true, suppression: true, followUp: true, transfer: false, sms: false, email: true },
  });

  return record({
    cleared: true, clearance: INTERNAL_TEST_CLEARANCE, refusals: [],
    detail: ['Cleared for one internal audio call.'],
    callPlan: {
      toNumber: batch.normalized_value,
      fromNumber,
      precomputedOpener: opening.say,
      callPackId,
      agentProfileId: 'yad-sales-core-v1',
      modeAtStart: 'INTERNAL_TEST',
    },
  });

  async function record(result: Omit<PilotClearance, 'attemptId'>): Promise<PilotClearance> {
    const attempt = await withTransaction(async (client) => {
      const { rows } = await client.query<{ audio_pilot_attempt_id: string }>(
        `insert into audio_pilot_attempts
           (audio_pilot_batch_id, requested_by, clearance, refusal_reasons,
            precomputed_opener, call_pack_id)
         values ($1, $2, $3, $4, $5, $6)
         returning audio_pilot_attempt_id`,
        [input.batchId, input.actorUserId, result.clearance, result.refusals,
         result.callPlan?.precomputedOpener ?? null, result.callPlan?.callPackId ?? null],
      );
      if (result.cleared) {
        await client.query(
          `update audio_pilot_batches set calls_started = calls_started + 1
            where audio_pilot_batch_id = $1`, [input.batchId]);
      }
      return rows[0]!.audio_pilot_attempt_id;
    });

    await query(
      `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, detail)
       values ($1, 'internal_pilot.prepare_call', 'audio_pilot_attempt', $2, $3, $4::jsonb)`,
      [input.actorUserId, attempt, result.refusals.join(', ') || 'cleared',
       JSON.stringify({ clearance: result.clearance, dialled: false })],
    );
    return { ...result, attemptId: attempt };
  }
}

/**
 * Records what a call produced.
 *
 * Latency and barge-in come from the transport's own timeline, and the QA result is
 * entered by a person — a call does not score itself.
 */
export async function recordInternalCallResult(input: {
  attemptId: string; voiceCallId?: string | null; outcome: string;
  latencyMarks?: Record<string, unknown>; bargeInEvents?: unknown[];
}): Promise<void> {
  await query(
    `update audio_pilot_attempts
        set voice_call_id = coalesce($2, voice_call_id),
            outcome = $3,
            latency_marks = coalesce($4::jsonb, latency_marks),
            barge_in_events = coalesce($5::jsonb, barge_in_events)
      where audio_pilot_attempt_id = $1`,
    [input.attemptId, input.voiceCallId ?? null, input.outcome,
     input.latencyMarks ? JSON.stringify(input.latencyMarks) : null,
     input.bargeInEvents ? JSON.stringify(input.bargeInEvents) : null],
  );
}

export async function reviewInternalCall(input: {
  attemptId: string; qaResult: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; notes: string;
  actorUserId: string;
}): Promise<void> {
  await query(
    `update audio_pilot_attempts
        set qa_result = $2, qa_notes = $3, reviewed_by = $4, reviewed_at = now()
      where audio_pilot_attempt_id = $1`,
    [input.attemptId, input.qaResult, input.notes, input.actorUserId],
  );
  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, detail)
     values ($1, 'internal_pilot.review', 'audio_pilot_attempt', $2, $3::jsonb)`,
    [input.actorUserId, input.attemptId, JSON.stringify({ qaResult: input.qaResult })],
  );
}

export async function batchSummary(batchId: string) {
  const { rows } = await query<any>(
    `select b.audio_pilot_batch_id, b.purpose, b.max_calls, b.calls_started, b.state,
            b.stopped_reason, n.display_value as test_number, n.label as test_number_label,
            u.display_name as created_by_name,
            (select count(*)::int from audio_pilot_attempts a
              where a.audio_pilot_batch_id = b.audio_pilot_batch_id
                and a.clearance = 'REFUSED') as refused,
            (select count(*)::int from audio_pilot_attempts a
              where a.audio_pilot_batch_id = b.audio_pilot_batch_id
                and a.qa_result = 'PASS') as qa_passed,
            (select count(*)::int from audio_pilot_attempts a
              where a.audio_pilot_batch_id = b.audio_pilot_batch_id
                and a.qa_result = 'FAIL') as qa_failed
       from audio_pilot_batches b
       join internal_test_numbers n on n.internal_test_number_id = b.internal_test_number_id
       left join users u on u.user_id = b.created_by
      where b.audio_pilot_batch_id = $1`,
    [batchId]);
  return rows[0] ?? null;
}
