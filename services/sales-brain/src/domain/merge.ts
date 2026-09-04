import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import { isManager, type Role } from './auth.js';

/**
 * Merging two Accounts that turned out to be one company.
 * Authority: data-contract §7 (identity resolution), rep-ownership-data-model.md §12
 * (suppression survives everything), §16 (the projection is not canonical truth).
 *
 * Two rules shape this file.
 *
 * Nothing is merged because one field matched. Automatic resolution already runs at
 * write time and is deliberately conservative -- a shared phone number is a strip
 * mall, not one company -- so anything that reaches here is a human saying "these
 * two records are the same business", and the human's reason is recorded.
 *
 * Nothing is discarded. Everything that hangs off the merged Account moves to the
 * survivor, the merged row survives as a tombstone so its id still resolves, and the
 * suppression of either becomes the suppression of the survivor. The one thing that
 * cannot be undone is the merge itself: see `mergeAccounts` on why unmerge is not
 * offered rather than offered badly.
 */

export type MergeReject =
  | 'NOT_FOUND' | 'SAME_ACCOUNT' | 'PERMISSION_DENIED' | 'REASON_REQUIRED'
  | 'ALREADY_MERGED' | 'OWNER_CONFLICT';

export interface MergeResult {
  ok: boolean;
  reason?: MergeReject;
  message?: string;
  survivingAccountId?: string;
  movedCounts?: Record<string, number>;
}

/** Every table that points at an account and must follow it to the survivor. */
const CHILD_TABLES: { table: string; column: string }[] = [
  { table: 'locations', column: 'account_id' },
  { table: 'contacts', column: 'account_id' },
  { table: 'contact_endpoints', column: 'account_id' },
  { table: 'account_domains', column: 'account_id' },
  // evidence_records and ownership_events are deliberately absent: both are
  // append-only ledgers, and rewriting a row's account_id is editing history. They
  // stay attached to the record they were written against, which is why the merged
  // Account survives as a tombstone rather than being deleted. Reads follow the
  // merge chain instead -- see `mergedIdsFor`.

  { table: 'opportunity_hypotheses', column: 'account_id' },
  { table: 'offer_hypotheses', column: 'account_id' },
  { table: 'canonical_scores', column: 'account_id' },
  { table: 'research_completeness', column: 'account_id' },
  { table: 'prospect_statements', column: 'account_id' },
  { table: 'activities', column: 'account_id' },
  { table: 'follow_ups', column: 'account_id' },
  { table: 'opportunities', column: 'account_id' },
  { table: 'meeting_bookings', column: 'account_id' },
  { table: 'email_enrollments', column: 'account_id' },
  { table: 'email_events', column: 'account_id' },
  { table: 'call_packs', column: 'account_id' },
  { table: 'voice_calls', column: 'account_id' },
  { table: 'hook_attempts', column: 'account_id' },
  { table: 'contact_attempts', column: 'account_id' },
  { table: 'channel_eligibility_decisions', column: 'account_id' },
  { table: 'suppressions', column: 'account_id' },
  { table: 'source_identities', column: 'account_id' },
  { table: 'account_market_membership', column: 'account_id' },
  { table: 'import_rows', column: 'account_id' },
  { table: 'jobs', column: 'account_id' },
  { table: 'pilot_candidates', column: 'account_id' },
  { table: 'research_runs', column: 'account_id' },
  { table: 'search_observations', column: 'account_id' },
];

/** Relationship states in the order a company moves through them. */
const RELATIONSHIP_ORDER = [
  'COLD', 'CONTACTED', 'ENGAGED', 'CALLBACK_REQUESTED', 'POSITIVE_REPLY',
  'MEETING_SCHEDULED', 'ACTIVE_OPPORTUNITY', 'PROPOSAL', 'CLIENT',
];

function furtherAlong(a: string, b: string): string {
  // DISQUALIFIED is not a stage on the way anywhere; it loses to any live state.
  const rank = (state: string) => RELATIONSHIP_ORDER.indexOf(state);
  if (rank(a) === -1) return b;
  if (rank(b) === -1) return a;
  return rank(a) >= rank(b) ? a : b;
}

export interface MergeInput {
  survivingAccountId: string;
  mergedAccountId: string;
  /** Why a person believes these are one company. Recorded, not optional. */
  reason: string;
  /** How the duplicate was spotted, for the manager reading it later. */
  matchRule?: string;
  /** Set when both Accounts are owned and a manager has decided which owner keeps it. */
  keepOwnerUserId?: string | null;
}

/**
 * Merges one Account into another.
 *
 * Managers only. A merge moves another rep's work into somebody else's book, which
 * is not a decision a rep makes about their own patch.
 *
 * There is no unmerge, and that is a decision rather than an omission. Undoing this
 * honestly would mean knowing which of the survivor's rows came from which record
 * *after* both have been worked -- a call logged against the survivor tomorrow
 * belongs to neither original -- so an unmerge would either restore a fiction or
 * silently drop the work done since. What is offered instead is the record of what
 * happened: the tombstone, the counts of what moved, the reason a person gave, and
 * an audit row. If two records are merged in error, the honest repair is to create
 * the second company again and move what belongs to it, deliberately.
 */
export async function mergeAccounts(
  input: MergeInput, actor: { userId: string; role: Role },
): Promise<MergeResult> {
  if (!isManager(actor.role)) {
    return { ok: false, reason: 'PERMISSION_DENIED',
      message: 'Merging Accounts moves another rep’s work. A manager has to decide it.' };
  }
  if (input.survivingAccountId === input.mergedAccountId) {
    return { ok: false, reason: 'SAME_ACCOUNT' };
  }
  if (!input.reason?.trim()) {
    return { ok: false, reason: 'REASON_REQUIRED',
      message: 'Say why these are the same company. A manager reading this later needs it.' };
  }

  return withTransaction(async (client) => {
    // Both rows are locked, in id order, so two merges cannot deadlock against each
    // other by taking the same pair in opposite directions.
    const [first, second] = [input.survivingAccountId, input.mergedAccountId].sort();
    const { rows } = await client.query<{
      account_id: string; ownership_state: string; current_owner_user_id: string | null;
      relationship_state: string; is_suppressed: boolean; canonical_name: string;
      merged_into_account_id: string | null; manual_score: number | null; manual_tier: string | null;
      research_fresh_until: Date | null; last_researched_at: Date | null;
    }>(
      `select account_id, ownership_state, current_owner_user_id, relationship_state,
              is_suppressed, canonical_name, merged_into_account_id, manual_score,
              manual_tier, research_fresh_until, last_researched_at
         from accounts where account_id in ($1, $2) order by account_id for update`,
      [first, second],
    );
    const surviving = rows.find((row) => row.account_id === input.survivingAccountId);
    const merged = rows.find((row) => row.account_id === input.mergedAccountId);
    if (!surviving || !merged) return { ok: false, reason: 'NOT_FOUND' as const };
    if (surviving.merged_into_account_id || merged.merged_into_account_id) {
      return { ok: false, reason: 'ALREADY_MERGED' as const,
        message: 'One of these Accounts has already been merged into another.' };
    }

    // Two owners is a decision, not a default. Picking one silently moves a rep's
    // book without telling them.
    const owners = [surviving.current_owner_user_id, merged.current_owner_user_id]
      .filter((id): id is string => Boolean(id));
    const distinctOwners = [...new Set(owners)];
    if (distinctOwners.length > 1 && !input.keepOwnerUserId) {
      return {
        ok: false, reason: 'OWNER_CONFLICT' as const,
        message: 'Both Accounts are owned, by different reps. Say which owner keeps the '
          + 'merged company, and tell the other rep.',
      };
    }
    const keepOwner = input.keepOwnerUserId ?? distinctOwners[0] ?? null;
    if (input.keepOwnerUserId && !distinctOwners.includes(input.keepOwnerUserId)) {
      return { ok: false, reason: 'OWNER_CONFLICT' as const,
        message: 'The owner to keep must be one of the two current owners.' };
    }

    // Move everything.
    const movedCounts: Record<string, number> = {};
    for (const { table, column } of CHILD_TABLES) {
      const { rowCount } = await client.query(
        `update ${table} set ${column} = $1 where ${column} = $2`,
        [input.survivingAccountId, input.mergedAccountId],
      );
      if (rowCount) movedCounts[table] = rowCount;
    }

    // Suppression is the one thing that must never be lost in a merge: if either
    // record said do not contact, the survivor says do not contact.
    const suppressed = surviving.is_suppressed || merged.is_suppressed;
    const relationship = suppressed
      ? 'DISQUALIFIED'
      : furtherAlong(surviving.relationship_state, merged.relationship_state);
    const ownershipState = suppressed ? 'SUPPRESSED'
      : keepOwner ? 'CLAIMED' : 'UNCLAIMED';

    await client.query(
      `update accounts set
         relationship_state = $2,
         ownership_state = $3,
         current_owner_user_id = $4,
         ownership_updated_at = now(),
         is_suppressed = $5,
         -- Keep the better score and the fresher research: both were true of the
         -- same company, and discarding the better one would lose real work.
         manual_score = greatest(coalesce(manual_score, 0), coalesce($6::int, 0)),
         manual_tier = case when $7::text is null then manual_tier
                            when manual_tier is null then $7::text
                            when $7::text < manual_tier then $7::text
                            else manual_tier end,
         research_fresh_until = greatest(research_fresh_until, $8::timestamptz),
         last_researched_at = greatest(last_researched_at, $9::timestamptz),
         updated_at = now()
       where account_id = $1`,
      [input.survivingAccountId, relationship, ownershipState, suppressed ? null : keepOwner,
       suppressed, merged.manual_score, merged.manual_tier,
       merged.research_fresh_until, merged.last_researched_at],
    );

    // The tombstone. Kept, not deleted: the id has been in URLs and in other
    // systems' records of us, and a dead link is a worse answer than a redirect.
    await client.query(
      `update accounts set merged_into_account_id = $2, merged_at = now(),
              ownership_state = 'UNCLAIMED', current_owner_user_id = null,
              updated_at = now()
        where account_id = $1`,
      [input.mergedAccountId, input.survivingAccountId],
    );

    await client.query(
      `insert into account_merges (surviving_account_id, merged_account_id, match_rule,
                                   detail, reason, moved_counts, actor_user_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [input.survivingAccountId, input.mergedAccountId, input.matchRule ?? 'manual_review',
       JSON.stringify({
         surviving_name: surviving.canonical_name, merged_name: merged.canonical_name,
         owners_before: { surviving: surviving.current_owner_user_id,
                          merged: merged.current_owner_user_id },
         suppressed_before: { surviving: surviving.is_suppressed, merged: merged.is_suppressed },
       }),
       input.reason.trim(), JSON.stringify(movedCounts), actor.userId],
    );

    await client.query(
      `insert into audit_log (actor_user_id, action, subject_type, subject_id, reason, detail)
       values ($1, 'account.merge', 'account', $2, $3, $4)`,
      [actor.userId, input.survivingAccountId, input.reason.trim(),
       JSON.stringify({ merged_account_id: input.mergedAccountId, moved: movedCounts })],
    );

    // If the survivor changed hands, that is an ownership event like any other.
    if (keepOwner && keepOwner !== surviving.current_owner_user_id && !suppressed) {
      await client.query(
        `insert into ownership_events (account_id, event_type, previous_owner_user_id,
                                       new_owner_user_id, actor_user_id, reason)
         values ($1, 'REASSIGNED', $2, $3, $4, $5)`,
        [input.survivingAccountId, surviving.current_owner_user_id, keepOwner, actor.userId,
         `Merged with ${merged.canonical_name}: ${input.reason.trim()}`],
      );
    }

    await client.query(
      `insert into activities (account_id, activity_type, channel, actor_user_id, notes)
       values ($1, 'NOTE', 'system', $2, $3)`,
      [input.survivingAccountId, actor.userId,
       `Merged with "${merged.canonical_name}". ${input.reason.trim()}`],
    );

    return { ok: true, survivingAccountId: input.survivingAccountId, movedCounts };
  });
}

/**
 * An Account and every record that was merged into it, for reading history.
 *
 * The two append-only ledgers keep pointing at the record they were written against,
 * so a merged company's evidence and ownership history are read through this rather
 * than moved. History is not rewritten; it is followed.
 */
export async function mergedIdsFor(
  client: pg.PoolClient | { query: pg.PoolClient['query'] }, accountId: string,
): Promise<string[]> {
  const { rows } = await client.query<{ account_id: string }>(
    `with recursive chain as (
       select account_id from accounts where account_id = $1
       union all
       select a.account_id from accounts a
         join chain c on a.merged_into_account_id = c.account_id
     )
     select account_id from chain`,
    [accountId],
  );
  return rows.map((row) => row.account_id);
}

/** Follows a tombstone to the Account that survived, however many merges deep. */
export async function resolveAccountId(
  client: pg.PoolClient | { query: pg.PoolClient['query'] }, accountId: string,
): Promise<string | null> {
  let current = accountId;
  // A chain longer than a handful means something is wrong; stop rather than loop.
  for (let hop = 0; hop < 10; hop += 1) {
    const { rows } = await client.query<{ merged_into_account_id: string | null }>(
      'select merged_into_account_id from accounts where account_id = $1', [current]);
    if (rows.length === 0) return null;
    const next = rows[0]!.merged_into_account_id;
    if (!next) return current;
    current = next;
  }
  return null;
}
