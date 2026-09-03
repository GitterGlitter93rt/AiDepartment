import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import { isManager, type Role } from './auth.js';

/**
 * Ownership commands. Server-authoritative and atomic.
 * Authority: rep-ownership-data-model.md §14-§15, rep-portal-api-contract.v1.md §8-§11,
 * rep-inventory-contract.v1.yaml claim_command.
 *
 * The concurrency guarantee comes from `select ... for update` on the Account row:
 * two simultaneous claims serialize, the second one sees the first one's owner, and
 * exactly one ownership event is written.
 */

export type ClaimRejectReason =
  | 'ALREADY_CLAIMED'
  | 'CLAIMED_BY_SELF'
  | 'SUPPRESSED'
  | 'CLIENT'
  | 'ACTIVE_OPPORTUNITY'
  | 'CLAIM_LIMIT'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND';

export interface ClaimOutcome {
  accountId: string;
  ok: boolean;
  reason?: ClaimRejectReason;
  ownerUserId?: string | null;
  ownerDisplayName?: string | null;
}

/** Relationship states that make an Account off-limits to a generic cold claim. */
const RELATIONSHIP_BLOCKS: Record<string, ClaimRejectReason> = {
  CLIENT: 'CLIENT',
  ACTIVE_OPPORTUNITY: 'ACTIVE_OPPORTUNITY',
  PROPOSAL: 'ACTIVE_OPPORTUNITY',
};

/** Default anti-hoarding ceiling when no per-user target is configured. */
export const DEFAULT_ACTIVE_CLAIM_TARGET = 250;

async function claimOneInTransaction(
  client: pg.PoolClient,
  accountId: string,
  actor: { userId: string; role: Role; activeClaimTarget: number | null },
  searchContextId: string | null,
): Promise<ClaimOutcome> {
  // Lock the ownership row first. Everything after this is evaluated against a
  // state no other transaction can change until we commit.
  const { rows } = await client.query<{
    account_id: string; ownership_state: string; relationship_state: string;
    current_owner_user_id: string | null; is_suppressed: boolean; owner_name: string | null;
  }>(
    `select a.account_id, a.ownership_state, a.relationship_state, a.current_owner_user_id,
            a.is_suppressed,
            (select display_name from users where user_id = a.current_owner_user_id) as owner_name
       from accounts a where a.account_id = $1 for update`,
    [accountId],
  );
  const account = rows[0];
  if (!account) return { accountId, ok: false, reason: 'NOT_FOUND' };

  if (account.is_suppressed || account.ownership_state === 'SUPPRESSED') {
    return { accountId, ok: false, reason: 'SUPPRESSED' };
  }

  const relationshipBlock = RELATIONSHIP_BLOCKS[account.relationship_state];
  if (relationshipBlock && account.current_owner_user_id !== actor.userId) {
    return {
      accountId, ok: false, reason: relationshipBlock,
      ownerUserId: account.current_owner_user_id, ownerDisplayName: account.owner_name,
    };
  }

  if (account.current_owner_user_id) {
    if (account.current_owner_user_id === actor.userId) {
      return { accountId, ok: false, reason: 'CLAIMED_BY_SELF', ownerUserId: actor.userId };
    }
    return {
      accountId, ok: false, reason: 'ALREADY_CLAIMED',
      ownerUserId: account.current_owner_user_id, ownerDisplayName: account.owner_name,
    };
  }

  // Anti-hoarding ceiling, counted inside the same transaction so a burst of
  // parallel claims cannot slip past it (browse-claim spec §7).
  const target = actor.activeClaimTarget ?? DEFAULT_ACTIVE_CLAIM_TARGET;
  const { rows: countRows } = await client.query<{ count: number }>(
    `select count(*)::bigint as count from accounts
      where current_owner_user_id = $1 and ownership_state in ('CLAIMED','MANAGER_ASSIGNED')`,
    [actor.userId],
  );
  if ((countRows[0]?.count ?? 0) >= target) {
    return { accountId, ok: false, reason: 'CLAIM_LIMIT' };
  }

  await client.query(
    `update accounts set ownership_state = 'CLAIMED', current_owner_user_id = $2,
                         ownership_updated_at = now(), claimed_at = now()
      where account_id = $1`,
    [accountId, actor.userId],
  );
  await client.query(
    `insert into ownership_events (account_id, event_type, previous_owner_user_id, new_owner_user_id,
                                   actor_user_id, search_context_id)
     values ($1, 'CLAIMED', null, $2, $2, $3)`,
    [accountId, actor.userId, searchContextId],
  );
  await client.query(
    `insert into activities (account_id, activity_type, channel, actor_user_id, owner_user_id, payload)
     values ($1, 'CLAIMED', 'system', $2, $2, $3)`,
    [accountId, actor.userId, JSON.stringify({ search_context_id: searchContextId })],
  );

  return { accountId, ok: true, ownerUserId: actor.userId };
}

export async function claimAccount(
  accountId: string,
  actor: { userId: string; role: Role; activeClaimTarget: number | null },
  searchContextId: string | null = null,
): Promise<ClaimOutcome> {
  return withTransaction((client) => claimOneInTransaction(client, accountId, actor, searchContextId));
}

export interface BatchClaimResult {
  requested: number;
  claimed: number;
  conflicts: number;
  results: ClaimOutcome[];
}

/**
 * Bulk claim. Each Account gets its own transaction: 22 successes stay successes
 * when 3 rows lost a race, and no single statement locks unrelated Accounts
 * (rep-ownership-data-model.md §15).
 */
export async function claimAccounts(
  accountIds: string[],
  actor: { userId: string; role: Role; activeClaimTarget: number | null },
  searchContextId: string | null = null,
): Promise<BatchClaimResult> {
  const results: ClaimOutcome[] = [];
  for (const accountId of accountIds) {
    try {
      results.push(await claimAccount(accountId, actor, searchContextId));
    } catch (error) {
      results.push({ accountId, ok: false, reason: 'NOT_FOUND' });
      console.error('[ownership] claim failed', accountId, error);
    }
  }
  const claimed = results.filter((r) => r.ok).length;
  return { requested: accountIds.length, claimed, conflicts: results.length - claimed, results };
}

/** Relationship states that must never be released or auto-reassigned away. */
export const PROTECTED_RELATIONSHIP_STATES = new Set([
  'CALLBACK_REQUESTED', 'POSITIVE_REPLY', 'MEETING_SCHEDULED',
  'ACTIVE_OPPORTUNITY', 'PROPOSAL', 'CLIENT',
]);

export type ReleaseRejectReason = 'NOT_FOUND' | 'NOT_OWNER' | 'PROTECTED_RELATIONSHIP' | 'NOT_CLAIMED';

export interface ReleaseOutcome {
  ok: boolean;
  reason?: ReleaseRejectReason;
  protectedBy?: string;
}

export async function releaseAccount(
  accountId: string,
  actor: { userId: string; role: Role },
  reason: string | null = null,
): Promise<ReleaseOutcome> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      current_owner_user_id: string | null; relationship_state: string; ownership_state: string;
      open_callbacks: number;
    }>(
      `select a.current_owner_user_id, a.relationship_state, a.ownership_state,
              (select count(*)::bigint from follow_ups f
                where f.account_id = a.account_id and f.status = 'OPEN'
                  and f.followup_type = 'CALLBACK' and f.prospect_requested) as open_callbacks
         from accounts a where a.account_id = $1 for update`,
      [accountId],
    );
    const account = rows[0];
    if (!account) return { ok: false, reason: 'NOT_FOUND' as const };
    if (!account.current_owner_user_id) return { ok: false, reason: 'NOT_CLAIMED' as const };

    const isOwner = account.current_owner_user_id === actor.userId;
    if (!isOwner && !isManager(actor.role)) return { ok: false, reason: 'NOT_OWNER' as const };

    if (PROTECTED_RELATIONSHIP_STATES.has(account.relationship_state)) {
      return { ok: false, reason: 'PROTECTED_RELATIONSHIP' as const, protectedBy: account.relationship_state };
    }
    if (account.open_callbacks > 0) {
      return { ok: false, reason: 'PROTECTED_RELATIONSHIP' as const, protectedBy: 'CALLBACK_REQUESTED' };
    }

    await client.query(
      `update accounts set ownership_state = 'UNCLAIMED', current_owner_user_id = null,
                           ownership_updated_at = now(), claimed_at = null
        where account_id = $1`,
      [accountId],
    );
    await client.query(
      `insert into ownership_events (account_id, event_type, previous_owner_user_id, new_owner_user_id,
                                     actor_user_id, reason)
       values ($1, 'RELEASED', $2, null, $3, $4)`,
      [accountId, account.current_owner_user_id, actor.userId, reason],
    );
    await client.query(
      `insert into activities (account_id, activity_type, channel, actor_user_id, notes)
       values ($1, 'RELEASED', 'system', $2, $3)`,
      [accountId, actor.userId, reason],
    );
    return { ok: true };
  });
}

export type ReassignRejectReason = 'NOT_FOUND' | 'PERMISSION_DENIED' | 'TARGET_NOT_FOUND' | 'SUPPRESSED';

export async function reassignAccount(
  accountId: string,
  newOwnerUserId: string,
  actor: { userId: string; role: Role },
  reason: string,
): Promise<{ ok: boolean; reason?: ReassignRejectReason }> {
  if (!isManager(actor.role)) return { ok: false, reason: 'PERMISSION_DENIED' };

  return withTransaction(async (client) => {
    const { rows: targetRows } = await client.query(
      'select user_id from users where user_id = $1 and is_active', [newOwnerUserId],
    );
    if (!targetRows[0]) return { ok: false, reason: 'TARGET_NOT_FOUND' as const };

    const { rows } = await client.query<{ current_owner_user_id: string | null; is_suppressed: boolean }>(
      'select current_owner_user_id, is_suppressed from accounts where account_id = $1 for update',
      [accountId],
    );
    const account = rows[0];
    if (!account) return { ok: false, reason: 'NOT_FOUND' as const };
    if (account.is_suppressed) return { ok: false, reason: 'SUPPRESSED' as const };

    await client.query(
      `update accounts set ownership_state = 'MANAGER_ASSIGNED', current_owner_user_id = $2,
                           ownership_updated_at = now(),
                           claimed_at = coalesce(claimed_at, now())
        where account_id = $1`,
      [accountId, newOwnerUserId],
    );
    // Prior owner history is preserved, never erased (API contract §11).
    await client.query(
      `insert into ownership_events (account_id, event_type, previous_owner_user_id, new_owner_user_id,
                                     actor_user_id, reason)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        accountId, account.current_owner_user_id ? 'REASSIGNED' : 'MANAGER_ASSIGNED',
        account.current_owner_user_id, newOwnerUserId, actor.userId, reason,
      ],
    );
    await client.query(
      `insert into activities (account_id, activity_type, channel, actor_user_id, owner_user_id, notes)
       values ($1, 'REASSIGNED', 'system', $2, $3, $4)`,
      [accountId, actor.userId, newOwnerUserId, reason],
    );
    await client.query(
      `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, detail)
       values ($1, 'account.reassign', 'account', $2, $3, $4)`,
      [actor.userId, accountId, reason, JSON.stringify({ from: account.current_owner_user_id, to: newOwnerUserId })],
    );
    return { ok: true };
  });
}

/** True when the actor may record sales activity against this Account. */
export async function assertCanWorkAccount(
  client: pg.PoolClient, accountId: string, actor: { userId: string; role: Role },
): Promise<{ ok: boolean; reason?: 'NOT_FOUND' | 'NOT_OWNER' }> {
  const { rows } = await client.query<{ current_owner_user_id: string | null }>(
    'select current_owner_user_id from accounts where account_id = $1', [accountId],
  );
  const account = rows[0];
  if (!account) return { ok: false, reason: 'NOT_FOUND' };
  if (account.current_owner_user_id === actor.userId) return { ok: true };
  if (isManager(actor.role)) return { ok: true };
  return { ok: false, reason: 'NOT_OWNER' };
}
