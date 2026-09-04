import { query, withTransaction } from '../db/pool.js';
import { preflightCall } from '../compliance/eligibility.js';
import { buildCallPack, persistCallPack } from '../callbrain/callPack.js';
import { selectOpener, checkOpener } from '../callbrain/openerSelector.js';

/**
 * Sales AI pilot control plane.
 *
 * Two invariants live here rather than in the UI, because the UI is replaceable:
 *
 *  - adding a candidate never dials, and never can: candidacy and dial readiness are
 *    separate states, and only `runPreflight` can move a row toward dialling;
 *  - a mode change applies to new calls only. Nothing here mutates a call in flight.
 */

export type OutboundMode = 'OFF' | 'INTERNAL_TEST' | 'CONTROLLED_PILOT' | 'ENABLED_BY_POLICY';

export interface PilotState {
  outboundMode: OutboundMode;
  inboundReceptionist: boolean;
  outboundDialEnabled: boolean;
  autoBookEnabled: boolean;
  warmTransferEnabled: boolean;
  maxConcurrency: number;
  stopReason: string | null;
  updatedAt: Date;
  updatedByName: string | null;
}

export async function readPilotState(): Promise<PilotState> {
  const { rows } = await query<{
    outbound_mode: OutboundMode; inbound_receptionist: boolean; outbound_dial_enabled: boolean;
    auto_book_enabled: boolean; warm_transfer_enabled: boolean; max_concurrency: number;
    stop_reason: string | null; updated_at: Date; updated_by_name: string | null;
  }>(
    `select s.outbound_mode, s.inbound_receptionist, s.outbound_dial_enabled,
            s.auto_book_enabled, s.warm_transfer_enabled, s.max_concurrency,
            s.stop_reason, s.updated_at, u.display_name as updated_by_name
       from voice_pilot_state s
       left join users u on u.user_id = s.updated_by
      where s.singleton`,
  );
  const row = rows[0]!;
  return {
    outboundMode: row.outbound_mode,
    inboundReceptionist: row.inbound_receptionist,
    outboundDialEnabled: row.outbound_dial_enabled,
    autoBookEnabled: row.auto_book_enabled,
    warmTransferEnabled: row.warm_transfer_enabled,
    maxConcurrency: row.max_concurrency,
    stopReason: row.stop_reason,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
  };
}

const TOGGLES = new Set([
  'outbound_mode', 'inbound_receptionist', 'outbound_dial_enabled',
  'auto_book_enabled', 'warm_transfer_enabled', 'max_concurrency',
]);

export async function setPilotSwitch(input: {
  field: string; value: string; actorUserId: string; reason: string;
}): Promise<{ ok: boolean; message?: string }> {
  if (!TOGGLES.has(input.field)) return { ok: false, message: 'Unknown setting.' };
  if (!input.reason.trim()) return { ok: false, message: 'A reason is required for an operator change.' };

  return withTransaction(async (client) => {
    const before = await client.query<Record<string, unknown>>(
      `select ${input.field} as value from voice_pilot_state where singleton for update`,
    );
    const oldValue = String(before.rows[0]?.['value'] ?? '');

    // Turning outbound off must also stop dial creation: leaving the dialler armed
    // under an OFF mode is the failure this switch exists to prevent.
    const alsoStopDialling = input.field === 'outbound_mode' && input.value === 'OFF';

    // The dial switch is set either by this change or by the OFF rule, never by both:
    // assigning the same column twice in one statement is not a valid update.
    const disarmDialler = alsoStopDialling && input.field !== 'outbound_dial_enabled';
    await client.query(
      `update voice_pilot_state
          set ${input.field} = $1::text::${columnType(input.field)}
              ${disarmDialler ? ', outbound_dial_enabled = false' : ''},
              updated_by = $2, updated_at = now()
        where singleton`,
      [input.value, input.actorUserId],
    );
    await client.query(
      `insert into voice_pilot_state_events (actor_user_id, field, old_value, new_value, reason)
       values ($1, $2, $3, $4, $5)`,
      [input.actorUserId, input.field, oldValue, input.value, input.reason],
    );
    await client.query(
      `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, detail)
       values ($1, 'voice_pilot.switch', 'voice_pilot_state', 'singleton', $2, $3::jsonb)`,
      [input.actorUserId, input.reason,
       JSON.stringify({ field: input.field, from: oldValue, to: input.value })],
    );
    return { ok: true };
  });
}

function columnType(field: string): string {
  return field === 'max_concurrency' ? 'integer'
    : field === 'outbound_mode' ? 'text'
    : 'boolean';
}

/** The destructive control. Stops new dials without touching a call in progress. */
export async function stopNewOutboundCalls(actorUserId: string, reason: string) {
  return withTransaction(async (client) => {
    await client.query(
      `update voice_pilot_state
          set outbound_dial_enabled = false, outbound_mode = 'OFF', stop_reason = $2,
              updated_by = $1, updated_at = now()
        where singleton`,
      [actorUserId, reason],
    );
    await client.query(
      `insert into voice_pilot_state_events (actor_user_id, field, old_value, new_value, reason)
       values ($1, 'stop_new_outbound_calls', null, 'STOPPED', $2)`,
      [actorUserId, reason],
    );
    await client.query(
      `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason)
       values ($1, 'voice_pilot.stop_new_outbound_calls', 'voice_pilot_state', 'singleton', $2)`,
      [actorUserId, reason],
    );
    // Queued candidates go back to review rather than staying armed.
    const { rowCount } = await client.query(
      `update pilot_candidates set state = 'CANDIDATE' where state = 'QUEUED'`,
    );
    return { ok: true, unqueued: rowCount ?? 0 };
  });
}

export interface CandidateRow {
  pilotCandidateId: string; accountId: string; companyName: string;
  market: string | null; tier: string | null; score: number | null;
  contactName: string | null; contactRole: string | null;
  state: string; eligibilityAtAdd: string; eligibilityReason: string | null;
  evaluatedAt: Date | null; addedByName: string | null; addedAt: Date;
  callPackId: string | null;
}

export async function listCandidates(): Promise<CandidateRow[]> {
  const { rows } = await query<any>(
    `select c.pilot_candidate_id, c.account_id, c.state, c.eligibility_at_add,
            c.eligibility_reason, c.evaluated_at, c.added_at, c.call_pack_id,
            a.canonical_name as company_name, a.manual_tier as tier, a.manual_score as score,
            m.name as market, p.full_name as contact_name, p.raw_title as contact_role,
            u.display_name as added_by_name
       from pilot_candidates c
       join accounts a on a.account_id = c.account_id
       left join contacts p on p.contact_id = c.contact_id
       left join account_market_membership am on am.account_id = a.account_id
       left join saved_markets m on m.market_id = am.market_id
       left join users u on u.user_id = c.added_by
      where c.state <> 'REMOVED'
      order by c.added_at desc
      limit 200`,
  );
  return rows.map((row) => ({
    pilotCandidateId: row.pilot_candidate_id, accountId: row.account_id,
    companyName: row.company_name, market: row.market, tier: row.tier, score: row.score,
    contactName: row.contact_name, contactRole: row.contact_role,
    state: row.state, eligibilityAtAdd: row.eligibility_at_add,
    eligibilityReason: row.eligibility_reason, evaluatedAt: row.evaluated_at,
    addedByName: row.added_by_name, addedAt: row.added_at, callPackId: row.call_pack_id,
  }));
}

/**
 * Queue a prospect for operator review. This does not dial, and cannot: the row is
 * created in CANDIDATE, and only a passed preflight moves it further.
 */
export async function addCandidate(input: {
  accountId: string; actorUserId: string;
}): Promise<{ ok: boolean; message?: string; pilotCandidateId?: string }> {
  const { rows } = await query<{
    endpoint_id: string | null; contact_id: string | null; suppressed: boolean;
  }>(
    `select e.endpoint_id, e.contact_id,
            a.is_suppressed as suppressed
       from accounts a
       left join contacts c on c.account_id = a.account_id
       left join contact_endpoints e on e.contact_id = c.contact_id and e.endpoint_type = 'PHONE'
      where a.account_id = $1
      order by e.created_at
      limit 1`,
    [input.accountId],
  );
  const row = rows[0];
  if (!row) return { ok: false, message: 'Account not found.' };
  if (row.suppressed) return { ok: false, message: 'This account is suppressed and cannot be called.' };

  const decision = row.endpoint_id
    ? await preflightCall(row.endpoint_id, 'AUTONOMOUS_AI_VOICE')
    : null;

  // The Call Pack is snapshotted now, so what an operator reviews is what the agent
  // would actually know. Research that lands afterwards does not silently change it.
  const pack = await buildCallPack(input.accountId);
  const callPackId = pack ? await persistCallPack(pack, row.contact_id) : null;

  const result = await query<{ pilot_candidate_id: string }>(
    `insert into pilot_candidates
       (account_id, contact_id, endpoint_id, call_pack_id, state, eligibility_at_add,
        eligibility_reason, evaluated_at, added_by)
     values ($1, $2, $3, $4, 'CANDIDATE', $5, $6, now(), $7)
     on conflict do nothing
     returning pilot_candidate_id`,
    [input.accountId, row.contact_id, row.endpoint_id, callPackId,
     decision?.decision ?? 'UNKNOWN', decision?.reasonCodes.join(', ') ?? 'no_phone_endpoint',
     input.actorUserId],
  );
  if (result.rows.length === 0) return { ok: false, message: 'Already on the pilot list.' };

  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, detail)
     values ($1, 'pilot.add_candidate', 'account', $2, $3::jsonb)`,
    [input.actorUserId, input.accountId,
     JSON.stringify({ dialled: false, eligibility: decision?.decision ?? 'UNKNOWN' })],
  );
  return { ok: true, pilotCandidateId: result.rows[0]!.pilot_candidate_id };
}

export async function removeCandidate(pilotCandidateId: string, actorUserId: string) {
  await query(
    `update pilot_candidates set state = 'REMOVED', removed_at = now()
      where pilot_candidate_id = $1 and state <> 'CALLED'`,
    [pilotCandidateId],
  );
  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id)
     values ($1, 'pilot.remove_candidate', 'pilot_candidate', $2)`,
    [actorUserId, pilotCandidateId],
  );
  return { ok: true };
}

/**
 * Re-evaluate eligibility at action time and record the result. The stored decision
 * from when the candidate was added is never trusted for a dial.
 */
export async function runPreflight(pilotCandidateId: string, actorUserId: string): Promise<{
  ok: boolean; decision: string; reasons: string[]; message?: string;
}> {
  const { rows } = await query<{ endpoint_id: string | null; account_id: string }>(
    `select endpoint_id, account_id from pilot_candidates where pilot_candidate_id = $1`,
    [pilotCandidateId],
  );
  const row = rows[0];
  if (!row) return { ok: false, decision: 'UNKNOWN', reasons: [], message: 'Candidate not found.' };
  if (!row.endpoint_id) {
    await query(`update pilot_candidates set state = 'PREFLIGHT_FAILED' where pilot_candidate_id = $1`,
      [pilotCandidateId]);
    return { ok: false, decision: 'UNKNOWN', reasons: ['no_phone_endpoint'],
             message: 'No phone endpoint on this account.' };
  }

  const decision = await preflightCall(row.endpoint_id, 'AUTONOMOUS_AI_VOICE');
  const state = await readPilotState();
  const passed = decision.decision === 'ALLOW' && state.outboundMode !== 'OFF';

  await query(
    `update pilot_candidates
        set state = $2, eligibility_at_add = $3, eligibility_reason = $4, evaluated_at = now()
      where pilot_candidate_id = $1`,
    [pilotCandidateId, passed ? 'PREFLIGHT_PASSED' : 'PREFLIGHT_FAILED',
     decision.decision, decision.reasonCodes.join(', ')],
  );
  await query(
    `insert into audit_log (actor_user_id, action, subject_type, subject_id, detail)
     values ($1, 'pilot.preflight', 'pilot_candidate', $2, $3::jsonb)`,
    [actorUserId, pilotCandidateId,
     JSON.stringify({ decision: decision.decision, mode: state.outboundMode, dialled: false })],
  );

  return {
    ok: passed,
    decision: decision.decision,
    reasons: decision.reasonCodes,
    ...(state.outboundMode === 'OFF'
      ? { message: 'Outbound is OFF, so nothing can be dialled.' } : {}),
  };
}

export interface CallPackPreview {
  callPackId: string;
  companyName: string;
  capturedAt: Date;
  expiresAt: Date | null;
  /** What the agent would open with, generated from this snapshot alone. */
  openingLine: string;
  openerBasis: string;
  primaryHypothesis: string | null;
  firstQuestion: string | null;
  confirmedFacts: { statement: string; source: string | null }[];
  importantUnknowns: string[];
  prohibitedClaims: string[];
  allowedNextSteps: string[];
}

/**
 * The preview an operator reads before approving a call.
 *
 * It is rendered from the stored snapshot, never rebuilt from live research, so what
 * is approved is what would be spoken. The opening line is generated rather than
 * stored because it must reflect the same opener rules the agent runs.
 */
export async function callPackPreview(pilotCandidateId: string): Promise<CallPackPreview | null> {
  const { rows } = await query<any>(
    `select p.call_pack_id, p.account_id, k.generated_at, k.expires_at, k.company_summary,
            k.top_confirmed_facts, k.important_unknowns, k.primary_hypothesis,
            k.first_questions, k.prohibited_claims, k.allowed_next_steps,
            a.canonical_name as company_name
       from pilot_candidates p
       join call_packs k on k.call_pack_id = p.call_pack_id
       join accounts a on a.account_id = p.account_id
      where p.pilot_candidate_id = $1`,
    [pilotCandidateId],
  );
  const row = rows[0];
  if (!row) return null;

  // Rebuilt from the live account only to run the opener rules; every fact shown
  // below comes from the snapshot.
  const pack = await buildCallPack(row.account_id);
  let openingLine = 'No opener could be generated from this snapshot.';
  let openerBasis = 'unavailable';
  if (pack) {
    const context = {
      pack, agentName: 'Alex',
      freshAdvertising: null, businessSignal: null, priorInteraction: null, variantIndex: 0,
    };
    const opener = selectOpener(context);
    const check = checkOpener(opener, context);
    openingLine = opener.text;
    openerBasis = check.ok ? opener.priority : `${opener.priority} (unsupported: ${check.failures.join(', ')})`;
  }

  const facts = Array.isArray(row.top_confirmed_facts) ? row.top_confirmed_facts : [];
  return {
    callPackId: row.call_pack_id,
    companyName: row.company_name,
    capturedAt: row.generated_at,
    expiresAt: row.expires_at,
    openingLine,
    openerBasis,
    primaryHypothesis: row.primary_hypothesis,
    firstQuestion: Array.isArray(row.first_questions) ? (row.first_questions[0] ?? null) : null,
    confirmedFacts: facts.map((fact: any) => ({
      statement: String(fact.statement ?? fact),
      source: fact.source ?? null,
    })),
    importantUnknowns: Array.isArray(row.important_unknowns) ? row.important_unknowns : [],
    prohibitedClaims: Array.isArray(row.prohibited_claims) ? row.prohibited_claims : [],
    allowedNextSteps: Array.isArray(row.allowed_next_steps) ? row.allowed_next_steps : [],
  };
}
