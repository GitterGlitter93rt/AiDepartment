import { query } from '../db/pool.js';
import type { NavCounts } from '../web/layout.js';
import type { MarketCard, FollowUpRow, TeamRow } from '../web/pages/lists.js';

/** Read queries the portal pages need but that are not inventory search. */

export const STALE_CLAIM_THRESHOLD_DAYS = 21;

export async function navCountsFor(userId: string): Promise<NavCounts> {
  const { rows } = await query<{ my_prospects: number; follow_ups_due: number }>(
    `select
       (select count(*)::int from accounts
         where current_owner_user_id = $1 and not is_suppressed) as my_prospects,
       (select count(*)::int from follow_ups
         where owner_user_id = $1 and status = 'OPEN' and due_at <= now() + interval '1 day')
         as follow_ups_due`,
    [userId],
  );
  return { myProspects: rows[0]?.my_prospects ?? 0, followUpsDue: rows[0]?.follow_ups_due ?? 0 };
}

export async function overviewKpis(userId: string) {
  const { rows } = await query<{
    active_prospects: number; new_this_week: number; follow_ups_due: number;
    follow_ups_overdue: number; meetings_booked: number; not_contacted: number;
  }>(
    `select
       (select count(*)::int from accounts
         where current_owner_user_id = $1 and not is_suppressed) as active_prospects,
       (select count(*)::int from accounts
         where current_owner_user_id = $1 and claimed_at > now() - interval '7 days') as new_this_week,
       (select count(*)::int from follow_ups
         where owner_user_id = $1 and status = 'OPEN' and due_at <= now() + interval '1 day')
         as follow_ups_due,
       (select count(*)::int from follow_ups
         where owner_user_id = $1 and status = 'OPEN' and due_at < now()) as follow_ups_overdue,
       (select count(*)::int from meeting_bookings b
          join accounts a on a.account_id = b.account_id
         where a.current_owner_user_id = $1 and b.status = 'CONFIRMED') as meetings_booked,
       (select count(*)::int from prospect_inventory
         where current_owner_user_id = $1 and activity_count = 0) as not_contacted`,
    [userId],
  );
  return rows[0]!;
}

export async function dueFollowUpsFor(userId: string, limit = 6) {
  const { rows } = await query(
    `select f.followup_id, f.account_id, f.due_at, f.followup_type, f.prospect_requested, f.context,
            a.canonical_name as company_name
       from follow_ups f join accounts a on a.account_id = f.account_id
      where f.owner_user_id = $1 and f.status = 'OPEN'
      order by f.due_at asc limit $2`,
    [userId, limit],
  );
  return rows as any[];
}

export async function followUpsFor(userId: string): Promise<{ overdue: FollowUpRow[]; upcoming: FollowUpRow[] }> {
  const { rows } = await query<FollowUpRow & { is_overdue: boolean }>(
    `select f.followup_id, f.account_id, f.followup_type, f.due_at, f.prospect_requested, f.context,
            a.canonical_name as company_name, a.manual_tier, a.manual_score,
            u.display_name as owner_name,
            coalesce(pi.geography_summary, 'Location unknown') as geography_summary,
            (f.due_at < now()) as is_overdue
       from follow_ups f
       join accounts a on a.account_id = f.account_id
       left join users u on u.user_id = f.owner_user_id
       left join prospect_inventory pi on pi.account_id = f.account_id
      where f.owner_user_id = $1 and f.status = 'OPEN'
      order by f.due_at asc`,
    [userId],
  );
  return {
    overdue: rows.filter((row) => row.is_overdue),
    upcoming: rows.filter((row) => !row.is_overdue),
  };
}

export async function marketCards(): Promise<MarketCard[]> {
  // Counts are derived from Account state, never stored as sole truth
  // (rep-ownership-data-model.md §8).
  const { rows } = await query<MarketCard>(
    `select m.market_id, m.name, m.mining_mode, m.status, m.last_mined_at,
            v.display_name as vertical_display,
            coalesce(
              nullif(concat_ws(', ', m.geography_definition->>'city', m.geography_definition->>'state'), ''),
              m.geography_definition->>'zip', m.geography_type
            ) as geography_label,
            count(pi.account_id)::int as researched,
            count(*) filter (where pi.ownership_state = 'UNCLAIMED')::int as unclaimed,
            count(*) filter (where pi.current_owner_user_id is not null)::int as claimed,
            count(*) filter (where pi.manual_tier = 'A')::int as tier_a,
            count(*) filter (where pi.manual_tier = 'B')::int as tier_b,
            count(*) filter (where pi.contactability_summary = 'PHONE_AND_EMAIL')::int as phone_email,
            count(*) filter (where coalesce(pi.google_paid, false)
                                or coalesce(pi.google_lsa, false)
                                or coalesce(pi.meta_paid, false))::int as advertisers
       from saved_markets m
       left join vertical_profiles v on v.vertical_profile_id = m.vertical_profile_id
       left join account_market_membership mm on mm.market_id = m.market_id
       left join prospect_inventory pi on pi.account_id = mm.account_id and not pi.is_suppressed
      group by m.market_id, m.name, m.mining_mode, m.status, m.last_mined_at, v.display_name
      order by m.name`,
  );
  return rows;
}

export async function marketOptions(): Promise<{ market_id: string; name: string }[]> {
  const { rows } = await query<{ market_id: string; name: string }>(
    'select market_id, name from saved_markets order by name',
  );
  return rows;
}

export async function teamRows(): Promise<TeamRow[]> {
  const { rows } = await query<TeamRow>(
    `select u.user_id, u.display_name, u.role,
            count(a.account_id) filter (where a.current_owner_user_id = u.user_id
                                          and not a.is_suppressed)::int as active_prospects,
            count(*) filter (where a.current_owner_user_id = u.user_id
                               and pi.activity_count = 0)::int as uncontacted,
            (select count(*)::int from follow_ups f
              where f.owner_user_id = u.user_id and f.status = 'OPEN' and f.due_at < now())
              as overdue_followups,
            count(*) filter (where a.relationship_state = 'MEETING_SCHEDULED')::int as meetings,
            count(*) filter (where a.relationship_state in ('ACTIVE_OPPORTUNITY','PROPOSAL'))::int
              as opportunities,
            -- Hoarding signal only. Protected relationships are excluded so a flag
            -- never implies an Account is safe to take away.
            count(*) filter (
              where a.current_owner_user_id = u.user_id
                and a.claimed_at < now() - ($1 || ' days')::interval
                and coalesce(pi.last_activity_at, a.claimed_at) < now() - ($1 || ' days')::interval
                and a.relationship_state not in
                    ('CALLBACK_REQUESTED','POSITIVE_REPLY','MEETING_SCHEDULED',
                     'ACTIVE_OPPORTUNITY','PROPOSAL','CLIENT')
            )::int as stale_claims
       from users u
       left join accounts a on a.current_owner_user_id = u.user_id
       left join prospect_inventory pi on pi.account_id = a.account_id
      where u.is_active and u.role in ('SALES_REP','SALES_MANAGER')
      group by u.user_id, u.display_name, u.role
      order by u.display_name`,
    [String(STALE_CLAIM_THRESHOLD_DAYS)],
  );
  return rows;
}

export async function activeReps(): Promise<{ user_id: string; display_name: string }[]> {
  const { rows } = await query<{ user_id: string; display_name: string }>(
    `select user_id, display_name from users
      where is_active and role in ('SALES_REP','SALES_MANAGER') order by display_name`,
  );
  return rows;
}

export async function findUser(userId: string): Promise<{ user_id: string; display_name: string } | null> {
  const { rows } = await query<{ user_id: string; display_name: string }>(
    'select user_id, display_name from users where user_id = $1', [userId],
  );
  return rows[0] ?? null;
}

export async function recentlyClaimedFor(userId: string, limit = 6) {
  const { rows } = await query(
    `select * from prospect_inventory
      where current_owner_user_id = $1 order by claimed_at desc nulls last limit $2`,
    [userId, limit],
  );
  return rows as any[];
}

export async function topMarketsFor(limit = 4) {
  const { rows } = await query(
    `select m.market_id, m.name, m.last_mined_at,
            count(pi.account_id)::int as researched,
            count(*) filter (where pi.ownership_state = 'UNCLAIMED')::int as unclaimed,
            count(*) filter (where pi.manual_tier = 'A')::int as tier_a
       from saved_markets m
       left join account_market_membership mm on mm.market_id = m.market_id
       left join prospect_inventory pi on pi.account_id = mm.account_id and not pi.is_suppressed
      where m.status <> 'PAUSED'
      group by m.market_id, m.name, m.last_mined_at
      order by unclaimed desc limit $1`,
    [limit],
  );
  return rows as any[];
}
