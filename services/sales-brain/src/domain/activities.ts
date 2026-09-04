import { withTransaction } from '../db/pool.js';
import type { Role } from './auth.js';
import { assertCanWorkAccount } from './ownership.js';

/**
 * Dispositions, callbacks, DNC and wrong-number handling.
 * Authority: rep-portal-api-contract.v1.md §13-§16,
 * contact-endpoint-quality-spec.md §7, §13.
 */

export type Disposition =
  | 'NO_ANSWER' | 'VOICEMAIL' | 'GATEKEEPER' | 'DECISION_MAKER_REACHED' | 'SEND_INFORMATION'
  | 'CALLBACK_REQUESTED' | 'POSSIBLE_OPPORTUNITY' | 'MEETING_SCHEDULED' | 'NOT_A_FIT'
  | 'WRONG_NUMBER' | 'DO_NOT_CONTACT';

/** How each disposition moves the Account's relationship state. Null = leave it alone. */
const RELATIONSHIP_TRANSITIONS: Record<Disposition, string | null> = {
  NO_ANSWER: 'CONTACTED',
  VOICEMAIL: 'CONTACTED',
  GATEKEEPER: 'CONTACTED',
  DECISION_MAKER_REACHED: 'ENGAGED',
  SEND_INFORMATION: 'ENGAGED',
  CALLBACK_REQUESTED: 'CALLBACK_REQUESTED',
  POSSIBLE_OPPORTUNITY: 'ACTIVE_OPPORTUNITY',
  MEETING_SCHEDULED: 'MEETING_SCHEDULED',
  NOT_A_FIT: 'DISQUALIFIED',
  WRONG_NUMBER: null,
  DO_NOT_CONTACT: null,
};

const ACTIVITY_TYPE_FOR: Record<Disposition, string> = {
  NO_ANSWER: 'CALL_ATTEMPT',
  VOICEMAIL: 'VOICEMAIL',
  GATEKEEPER: 'CALL_ATTEMPT',
  DECISION_MAKER_REACHED: 'CALL_ATTEMPT',
  SEND_INFORMATION: 'CALL_ATTEMPT',
  CALLBACK_REQUESTED: 'CALLBACK_REQUESTED',
  POSSIBLE_OPPORTUNITY: 'CALL_ATTEMPT',
  MEETING_SCHEDULED: 'MEETING_SCHEDULED',
  NOT_A_FIT: 'CALL_ATTEMPT',
  WRONG_NUMBER: 'WRONG_ENDPOINT',
  DO_NOT_CONTACT: 'DNC',
};

export interface DispositionInput {
  accountId: string;
  disposition: Disposition;
  contactId?: string | null;
  endpointId?: string | null;
  channel?: 'phone' | 'sms' | 'email' | 'human_field' | 'other';
  notes?: string | null;
  occurredAt?: Date;
  /** CALLBACK_REQUESTED only. */
  callbackDueAt?: Date | null;
  callbackTimezone?: string | null;
  prospectRequested?: boolean;
  /** Verbatim prospect statements worth preserving. */
  prospectStatements?: { category: string; text: string }[];
}

export interface DispositionResult {
  ok: boolean;
  reason?: 'NOT_FOUND' | 'NOT_OWNER' | 'CALLBACK_TIME_REQUIRED';
  activityId?: number;
  followupId?: number;
  suppressionCreated?: boolean;
}

export async function recordDisposition(
  input: DispositionInput,
  actor: { userId: string; role: Role },
): Promise<DispositionResult> {
  if (input.disposition === 'CALLBACK_REQUESTED' && !input.callbackDueAt) {
    return { ok: false, reason: 'CALLBACK_TIME_REQUIRED' };
  }

  return withTransaction(async (client) => {
    const permitted = await assertCanWorkAccount(client, input.accountId, actor);
    if (!permitted.ok) return { ok: false, reason: permitted.reason! };

    const { rows: ownerRows } = await client.query<{ current_owner_user_id: string | null }>(
      'select current_owner_user_id from accounts where account_id = $1', [input.accountId],
    );
    const ownerUserId = ownerRows[0]?.current_owner_user_id ?? actor.userId;

    const { rows: activityRows } = await client.query<{ activity_id: number }>(
      `insert into activities (account_id, contact_id, endpoint_id, actor_user_id, owner_user_id,
                               activity_type, channel, disposition, occurred_at, notes, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9, now()),$10,$11)
       returning activity_id`,
      [
        input.accountId, input.contactId ?? null, input.endpointId ?? null, actor.userId, ownerUserId,
        ACTIVITY_TYPE_FOR[input.disposition], input.channel ?? 'phone', input.disposition,
        input.occurredAt ?? null, input.notes ?? null,
        JSON.stringify({ prospect_requested: input.prospectRequested ?? false }),
      ],
    );
    const activityId = activityRows[0]!.activity_id;

    // Preserve exactly what the prospect said, unparaphrased (data-contract §26).
    for (const statement of input.prospectStatements ?? []) {
      await client.query(
        `insert into prospect_statements (account_id, contact_id, activity_id, category,
                                          statement_text, source_class, captured_by)
         values ($1,$2,$3,$4,$5,'prospect_verified',$6)`,
        [input.accountId, input.contactId ?? null, activityId, statement.category, statement.text, actor.userId],
      );
    }

    // Close the attempt this outcome belongs to.
    //
    // contact_attempts records that a number was dialled -- written when the rep
    // presses Call, after the eligibility check. The outcome was only ever written to
    // activities, so contact_attempts.disposition stayed null for every call ever
    // made. Analytics counts connections from that column, which meant the funnel
    // reported zero connections however many decision-makers a rep reached, and the
    // outcome filter matched nothing at all.
    //
    // The most recent open attempt by this actor on this Account is the one being
    // reported on; when an endpoint is named it has to match, so a call to the main
    // line is not closed by an outcome logged against a mobile.
    await client.query(
      `update contact_attempts
          set disposition = $3, completed_at = now(), activity_id = $4, notes = $5
        where attempt_id = (
          select attempt_id from contact_attempts
           where account_id = $1 and actor_user_id = $2 and completed_at is null
             and ($6::uuid is null or endpoint_id = $6::uuid)
           order by started_at desc limit 1
        )`,
      [input.accountId, actor.userId, input.disposition, activityId, input.notes ?? null,
       input.endpointId ?? null],
    );

    const nextState = RELATIONSHIP_TRANSITIONS[input.disposition];
    if (nextState) {
      // Never walk a relationship backwards: a DISQUALIFIED note should not
      // downgrade an Account that already became a client.
      await client.query(
        `update accounts set relationship_state = $2
          where account_id = $1 and relationship_state not in ('CLIENT','PROPOSAL')`,
        [input.accountId, nextState],
      );
    }

    let followupId: number | undefined;
    if (input.disposition === 'CALLBACK_REQUESTED' && input.callbackDueAt) {
      const { rows } = await client.query<{ followup_id: number }>(
        `insert into follow_ups (account_id, contact_id, owner_user_id, followup_type, due_at,
                                 timezone, prospect_requested, created_from_activity_id, context)
         values ($1,$2,$3,'CALLBACK',$4,$5,$6,$7,$8)
         returning followup_id`,
        [
          input.accountId, input.contactId ?? null, ownerUserId, input.callbackDueAt,
          input.callbackTimezone ?? null, input.prospectRequested ?? true, activityId, input.notes ?? null,
        ],
      );
      followupId = rows[0]!.followup_id;
    }

    let suppressionCreated = false;

    if (input.disposition === 'WRONG_NUMBER' && input.endpointId) {
      // Wrong number kills the endpoint, not the company (endpoint-quality-spec §7).
      await client.query(
        `update contact_endpoints
            set quality_state = 'WRONG_NUMBER', is_active = false,
                last_failure_at = now(), failure_reason = 'rep_marked_wrong_number'
          where endpoint_id = $1 and account_id = $2`,
        [input.endpointId, input.accountId],
      );
    }

    if (input.disposition === 'DO_NOT_CONTACT') {
      const { rows: endpointRows } = await client.query<{ normalized_value: string }>(
        'select normalized_value from contact_endpoints where endpoint_id = $1', [input.endpointId ?? null],
      );
      await client.query(
        `insert into suppressions (scope, account_id, contact_id, endpoint_id, normalized_value,
                                   suppression_type, source, reason, created_by, source_activity_id)
         values ('ACCOUNT', $1, $2, $3, $4, 'DNC', 'rep_disposition', $5, $6, $7)`,
        [
          input.accountId, input.contactId ?? null, input.endpointId ?? null,
          endpointRows[0]?.normalized_value ?? null,
          input.notes ?? 'Prospect requested do not contact', actor.userId, activityId,
        ],
      );
      // The suppressions trigger flips accounts.is_suppressed and drops the Account
      // out of claimable cold inventory. Ownership is cleared here so nobody keeps
      // working it, but the history stays.
      await client.query(
        `update accounts set ownership_state = 'SUPPRESSED', current_owner_user_id = null,
                             relationship_state = 'DISQUALIFIED', ownership_updated_at = now()
          where account_id = $1`,
        [input.accountId],
      );
      await client.query(
        `update follow_ups set status = 'CANCELLED' where account_id = $1 and status = 'OPEN'`,
        [input.accountId],
      );
      await client.query(
        `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason)
         values ($1, 'account.dnc', 'account', $2, $3)`,
        [actor.userId, input.accountId, input.notes ?? null],
      );
      suppressionCreated = true;
    }

    return { ok: true, activityId, followupId, suppressionCreated };
  });
}

export async function completeFollowUp(
  followupId: number, actor: { userId: string; role: Role },
): Promise<{ ok: boolean; reason?: 'NOT_FOUND' | 'NOT_OWNER' }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ owner_user_id: string; account_id: string }>(
      'select owner_user_id, account_id from follow_ups where followup_id = $1 for update', [followupId],
    );
    const followUp = rows[0];
    if (!followUp) return { ok: false, reason: 'NOT_FOUND' as const };

    const permitted = await assertCanWorkAccount(client, followUp.account_id, actor);
    if (!permitted.ok) return { ok: false, reason: 'NOT_OWNER' as const };

    await client.query(
      `update follow_ups set status = 'COMPLETED', completed_at = now() where followup_id = $1`,
      [followupId],
    );
    return { ok: true };
  });
}

export async function addNote(
  accountId: string, note: string, actor: { userId: string; role: Role },
): Promise<{ ok: boolean; reason?: 'NOT_FOUND' | 'NOT_OWNER' }> {
  return withTransaction(async (client) => {
    const permitted = await assertCanWorkAccount(client, accountId, actor);
    if (!permitted.ok) return { ok: false, reason: permitted.reason! };
    await client.query(
      `insert into activities (account_id, activity_type, channel, actor_user_id, notes)
       values ($1, 'NOTE', 'other', $2, $3)`,
      [accountId, actor.userId, note],
    );
    return { ok: true };
  });
}
