import { query, withTransaction } from '../db/pool.js';
import { isManager, type Role } from './auth.js';
import { assertCanWorkAccount } from './ownership.js';

/**
 * Opportunity lifecycle.
 * Authority: outbound-sales-brain-opportunity-qualification-spec.md,
 * YAD-SALES-CRM-UI-DATA-ACTION-CONTRACT.md §4.
 *
 * Two rules govern everything here:
 *   - an opportunity requires a stated problem, never positive sentiment;
 *   - a stage transition is a server action with a reason and an audit row. There is
 *     no browser-only drag and drop.
 */

export type Stage =
  | 'DISCOVERY' | 'FINANCIAL_DIAGNOSIS' | 'STRATEGY' | 'PROPOSAL_DECISION'
  | 'CLOSED_WON' | 'CLOSED_LOST';

export const STAGES: Stage[] = [
  'DISCOVERY', 'FINANCIAL_DIAGNOSIS', 'STRATEGY', 'PROPOSAL_DECISION', 'CLOSED_WON',
];

export const STAGE_LABEL: Record<Stage, string> = {
  DISCOVERY: 'Discovery',
  FINANCIAL_DIAGNOSIS: 'Financial Diagnosis',
  STRATEGY: 'Strategy',
  PROPOSAL_DECISION: 'Proposal / Decision',
  CLOSED_WON: 'Closed Won',
  CLOSED_LOST: 'Closed Lost',
};

/**
 * Legal transitions. Forward one step, or backward for a correction, or closed from
 * anywhere. Skipping straight from Discovery to Proposal is how a pipeline starts
 * lying about itself.
 */
const ALLOWED_TRANSITIONS: Record<Stage, Stage[]> = {
  DISCOVERY: ['FINANCIAL_DIAGNOSIS', 'CLOSED_LOST'],
  FINANCIAL_DIAGNOSIS: ['STRATEGY', 'DISCOVERY', 'CLOSED_LOST'],
  STRATEGY: ['PROPOSAL_DECISION', 'FINANCIAL_DIAGNOSIS', 'CLOSED_LOST'],
  PROPOSAL_DECISION: ['CLOSED_WON', 'CLOSED_LOST', 'STRATEGY'],
  CLOSED_WON: [],
  CLOSED_LOST: ['DISCOVERY'],
};

export function allowedTransitions(stage: Stage): Stage[] {
  return ALLOWED_TRANSITIONS[stage] ?? [];
}

export interface CreateOpportunityInput {
  accountId: string;
  contactId?: string | null;
  /** The problem in their words. Ten characters minimum, enforced by the schema too. */
  problemSummary: string;
  desiredOutcome?: string | null;
  sourceChannel?: string | null;
  sourceActivityId?: number | null;
  sourceBookingId?: string | null;
  title?: string | null;
}

export type CreateReject =
  | 'NOT_OWNER' | 'ACCOUNT_NOT_FOUND' | 'SUPPRESSED' | 'ALREADY_OPEN'
  | 'PROBLEM_REQUIRED' | 'NO_QUALIFYING_EVIDENCE';

export interface CreateResult {
  ok: boolean;
  opportunityId?: string;
  reason?: CreateReject;
  message?: string;
}

/**
 * Creates an opportunity.
 *
 * Requires a stated problem AND some evidence the conversation actually happened —
 * a prospect statement, a decision-maker contact, or a booked meeting. Positive
 * sentiment alone is explicitly not qualification.
 */
export async function createOpportunity(
  input: CreateOpportunityInput, actor: { userId: string; role: Role },
): Promise<CreateResult> {
  const problem = (input.problemSummary ?? '').trim();
  // A stated problem is a sentence, not a word. "interested" cleared a bare
  // character count, which is exactly the placeholder this is meant to stop.
  if (problem.length < 20 || problem.split(/\s+/).filter(Boolean).length < 4) {
    return {
      ok: false, reason: 'PROBLEM_REQUIRED',
      message: 'Describe the problem the prospect actually stated, in their terms. '
        + 'An opportunity is not a feeling.',
    };
  }

  return withTransaction(async (client) => {
    const { rows: accountRows } = await client.query<{
      canonical_name: string; is_suppressed: boolean; current_owner_user_id: string | null;
    }>(
      'select canonical_name, is_suppressed, current_owner_user_id from accounts where account_id = $1 for update',
      [input.accountId],
    );
    const account = accountRows[0];
    if (!account) return { ok: false, reason: 'ACCOUNT_NOT_FOUND' as const };

    // Suppression is checked before ownership. A DNC clears the owner, so an
    // ownership error here would hide the real and more important reason.
    if (account.is_suppressed) return { ok: false, reason: 'SUPPRESSED' as const };

    const permitted = await assertCanWorkAccount(client, input.accountId, actor);
    if (!permitted.ok) {
      return { ok: false, reason: permitted.reason === 'NOT_FOUND' ? 'ACCOUNT_NOT_FOUND' : 'NOT_OWNER' };
    }

    const { rows: existing } = await client.query<{ opportunity_id: string }>(
      `select opportunity_id from opportunities
        where account_id = $1 and stage not in ('CLOSED_WON','CLOSED_LOST')`,
      [input.accountId],
    );
    if (existing[0]) {
      return {
        ok: false, reason: 'ALREADY_OPEN' as const,
        message: 'This account already has an open opportunity.',
      };
    }

    // Something must show a real conversation took place.
    const { rows: evidenceRows } = await client.query<{ statements: number; meetings: number; reached: number }>(
      `select
         (select count(*)::int from prospect_statements where account_id = $1) as statements,
         (select count(*)::int from meeting_bookings
           where account_id = $1 and status = 'CONFIRMED') as meetings,
         (select count(*)::int from activities
           where account_id = $1
             and disposition in ('DECISION_MAKER_REACHED','POSSIBLE_OPPORTUNITY','MEETING_SCHEDULED')) as reached`,
      [input.accountId],
    );
    const evidence = evidenceRows[0]!;
    if (evidence.statements === 0 && evidence.meetings === 0 && evidence.reached === 0) {
      return {
        ok: false, reason: 'NO_QUALIFYING_EVIDENCE' as const,
        message: 'Record what the prospect said, or a decision-maker conversation, before opening '
          + 'an opportunity. Positive sentiment is not qualification.',
      };
    }

    const ownerUserId = account.current_owner_user_id ?? actor.userId;
    const { rows } = await client.query<{ opportunity_id: string }>(
      `insert into opportunities (account_id, contact_id, owner_user_id, title, stage,
                                  problem_summary, desired_outcome, source_channel,
                                  source_activity_id, source_booking_id, next_step)
       values ($1,$2,$3,$4,'DISCOVERY',$5,$6,$7,$8,$9,$10)
       returning opportunity_id`,
      [
        input.accountId, input.contactId ?? null, ownerUserId,
        input.title ?? `${account.canonical_name} — ${problem.slice(0, 60)}`,
        problem, input.desiredOutcome ?? null, input.sourceChannel ?? 'manual',
        input.sourceActivityId ?? null, input.sourceBookingId ?? null,
        'Map the workflow and confirm the numbers.',
      ],
    );
    const opportunityId = rows[0]!.opportunity_id;

    await client.query(
      `insert into opportunity_stage_events (opportunity_id, from_stage, to_stage, reason, actor_user_id)
       values ($1, null, 'DISCOVERY', $2, $3)`,
      [opportunityId, 'Opportunity opened', actor.userId],
    );
    await client.query(
      `update accounts set relationship_state = 'ACTIVE_OPPORTUNITY', active_opportunity_id = $2
        where account_id = $1 and relationship_state not in ('CLIENT','PROPOSAL')`,
      [input.accountId, opportunityId],
    );
    await client.query(
      `insert into activities (account_id, contact_id, activity_type, channel, actor_user_id,
                               owner_user_id, notes, payload)
       values ($1,$2,'OPPORTUNITY_CREATED','system',$3,$4,$5,$6)`,
      [
        input.accountId, input.contactId ?? null, actor.userId, ownerUserId,
        problem, JSON.stringify({ opportunity_id: opportunityId }),
      ],
    );

    return { ok: true, opportunityId };
  });
}

export type TransitionReject =
  | 'NOT_FOUND' | 'NOT_OWNER' | 'ILLEGAL_TRANSITION' | 'REASON_REQUIRED' | 'CLOSE_REASON_REQUIRED';

export async function transitionOpportunity(input: {
  opportunityId: string; targetStage: Stage; reason: string; closeReason?: string | null;
}, actor: { userId: string; role: Role }): Promise<{ ok: boolean; reason?: TransitionReject; message?: string }> {
  const reason = (input.reason ?? '').trim();
  if (!reason) {
    return { ok: false, reason: 'REASON_REQUIRED', message: 'A stage change needs a reason.' };
  }

  return withTransaction(async (client) => {
    // Account first, then the child row. Locking the opportunity first would put
    // this transaction the wrong way round against anything that locks the Account
    // and then touches its opportunity, which is how a deadlock is built.
    const { rows: located } = await client.query<{ account_id: string }>(
      'select account_id from opportunities where opportunity_id = $1', [input.opportunityId],
    );
    if (!located[0]) return { ok: false, reason: 'NOT_FOUND' as const };
    await client.query('select account_id from accounts where account_id = $1 for update',
      [located[0].account_id]);

    const { rows } = await client.query<{
      stage: Stage; owner_user_id: string; account_id: string;
    }>(
      'select stage, owner_user_id, account_id from opportunities where opportunity_id = $1 for update',
      [input.opportunityId],
    );
    const opportunity = rows[0];
    if (!opportunity) return { ok: false, reason: 'NOT_FOUND' as const };

    if (opportunity.owner_user_id !== actor.userId && !isManager(actor.role)) {
      return { ok: false, reason: 'NOT_OWNER' as const };
    }

    if (!allowedTransitions(opportunity.stage).includes(input.targetStage)) {
      return {
        ok: false, reason: 'ILLEGAL_TRANSITION' as const,
        message: `Cannot move from ${STAGE_LABEL[opportunity.stage]} to ${STAGE_LABEL[input.targetStage]}.`,
      };
    }

    const closing = input.targetStage === 'CLOSED_WON' || input.targetStage === 'CLOSED_LOST';
    if (closing && !(input.closeReason ?? '').trim()) {
      return { ok: false, reason: 'CLOSE_REASON_REQUIRED' as const };
    }

    await client.query(
      `update opportunities set stage = $2, close_reason = $3,
              closed_at = case when $4 then now() else null end
        where opportunity_id = $1`,
      [input.opportunityId, input.targetStage, closing ? input.closeReason : null, closing],
    );
    await client.query(
      `insert into opportunity_stage_events (opportunity_id, from_stage, to_stage, reason, actor_user_id)
       values ($1,$2,$3,$4,$5)`,
      [input.opportunityId, opportunity.stage, input.targetStage, reason, actor.userId],
    );
    await client.query(
      `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, detail)
       values ($1,'opportunity.transition','opportunity',$2,$3,$4)`,
      [actor.userId, input.opportunityId, reason,
       JSON.stringify({ from: opportunity.stage, to: input.targetStage })],
    );

    if (closing) {
      await client.query(
        `update accounts set relationship_state = $2, active_opportunity_id = null
          where account_id = $1`,
        [opportunity.account_id, input.targetStage === 'CLOSED_WON' ? 'CLIENT' : 'DISQUALIFIED'],
      );
    } else if (input.targetStage === 'PROPOSAL_DECISION') {
      await client.query(
        `update accounts set relationship_state = 'PROPOSAL' where account_id = $1`,
        [opportunity.account_id],
      );
    }

    return { ok: true };
  });
}

export interface OpportunityRow {
  opportunity_id: string;
  account_id: string;
  company_name: string;
  geography: string | null;
  owner_name: string | null;
  owner_user_id: string;
  stage: Stage;
  title: string;
  problem_summary: string;
  next_step: string | null;
  next_step_at: Date | null;
  value_amount: string | null;
  value_basis: string | null;
  meeting_status: string | null;
  meeting_start: Date | null;
  source_channel: string | null;
  updated_at: Date;
  created_at: Date;
}

export async function listOpportunities(viewer: { userId: string; role: Role }, filters: {
  stage?: Stage | null; ownerUserId?: string | null; mineOnly?: boolean;
} = {}): Promise<OpportunityRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const push = (value: unknown): string => { values.push(value); return `$${values.length}`; };

  // A rep sees their own book; a manager sees the team.
  if (!isManager(viewer.role) || filters.mineOnly) {
    conditions.push(`o.owner_user_id = ${push(viewer.userId)}`);
  } else if (filters.ownerUserId) {
    conditions.push(`o.owner_user_id = ${push(filters.ownerUserId)}`);
  }
  if (filters.stage) conditions.push(`o.stage = ${push(filters.stage)}`);

  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const { rows } = await query<OpportunityRow>(
    `select o.opportunity_id, o.account_id, a.canonical_name as company_name,
            pi.geography_summary as geography, u.display_name as owner_name, o.owner_user_id,
            o.stage, o.title, o.problem_summary, o.next_step, o.next_step_at,
            o.value_amount, o.value_basis, o.source_channel, o.updated_at, o.created_at,
            b.status as meeting_status, b.requested_start as meeting_start
       from opportunities o
       join accounts a on a.account_id = o.account_id
       left join prospect_inventory pi on pi.account_id = o.account_id
       left join users u on u.user_id = o.owner_user_id
       left join lateral (
         select status, requested_start from meeting_bookings mb
          where mb.account_id = o.account_id and mb.status in ('CONFIRMED','PENDING')
          order by requested_start asc limit 1
       ) b on true
       ${where}
      order by
        case o.stage when 'PROPOSAL_DECISION' then 1 when 'STRATEGY' then 2
                     when 'FINANCIAL_DIAGNOSIS' then 3 when 'DISCOVERY' then 4 else 5 end,
        o.updated_at desc`,
    values,
  );
  return rows;
}

export async function getOpportunity(
  opportunityId: string, viewer: { userId: string; role: Role },
): Promise<{ opportunity: any; stageEvents: any[]; timeline: any[]; canEdit: boolean } | null> {
  const { rows } = await query(
    `select o.*, a.canonical_name as company_name, a.canonical_domain,
            pi.geography_summary as geography, pi.manual_tier, pi.manual_score,
            u.display_name as owner_name, c.full_name as contact_name, c.raw_title as contact_title
       from opportunities o
       join accounts a on a.account_id = o.account_id
       left join prospect_inventory pi on pi.account_id = o.account_id
       left join users u on u.user_id = o.owner_user_id
       left join contacts c on c.contact_id = o.contact_id
      where o.opportunity_id = $1`,
    [opportunityId],
  );
  const opportunity = rows[0];
  if (!opportunity) return null;

  const [stageEvents, timeline, statements] = await Promise.all([
    query(
      `select e.*, u.display_name as actor_name from opportunity_stage_events e
         left join users u on u.user_id = e.actor_user_id
        where e.opportunity_id = $1 order by e.occurred_at desc`,
      [opportunityId],
    ),
    query(
      `select a.*, u.display_name as actor_name from activities a
         left join users u on u.user_id = a.actor_user_id
        where a.account_id = $1 order by a.occurred_at desc limit 40`,
      [opportunity.account_id],
    ),
    query(
      `select statement_text, category, captured_at, source_class from prospect_statements
        where account_id = $1 order by captured_at desc limit 20`,
      [opportunity.account_id],
    ),
  ]);

  return {
    opportunity: { ...opportunity, prospect_statements: statements.rows },
    stageEvents: stageEvents.rows,
    timeline: timeline.rows,
    canEdit: opportunity.owner_user_id === viewer.userId || isManager(viewer.role),
  };
}
