import { query } from '../db/pool.js';

/** Read models for Campaigns, Analytics and Call Review. */

// ------------------------------------------------------------------ campaigns

export async function listCampaigns() {
  const { rows } = await query<any>(
    `select c.email_campaign_id, c.name, c.provider, c.status, c.hook_family,
            c.minimum_email_quality, c.created_at,
            v.display_name as vertical_name,
            u.display_name as created_by_name,
            count(distinct e.account_id)::int as accounts,
            count(distinct e.enrollment_id) filter (
              where e.status in ('SENT','DELIVERED','REPLIED','BOUNCED'))::int as attempted,
            count(distinct e.enrollment_id) filter (where e.status = 'REPLIED')::int as replied,
            count(distinct e.enrollment_id) filter (
              where e.status in ('PAUSED','STOPPED'))::int as paused,
            count(distinct s.account_id)::int as suppressed
       from email_campaigns c
       left join vertical_profiles v on v.vertical_profile_id = c.vertical_profile_id
       left join users u on u.user_id = c.created_by
       left join email_enrollments e on e.email_campaign_id = c.email_campaign_id
       left join suppressions s on s.account_id = e.account_id and s.is_active
      group by c.email_campaign_id, v.display_name, u.display_name
      order by c.created_at desc
      limit 100`,
  );
  return rows;
}

/**
 * Accounts a campaign would treat as cold but whose relationship state says otherwise.
 * Relationship state wins over campaign newness, so this is surfaced, not hidden.
 */
export async function campaignRelationshipConflicts() {
  const { rows } = await query<any>(
    `select c.name as campaign_name, a.canonical_name as company_name, a.account_id,
            a.relationship_state, e.status as enrollment_status
       from email_enrollments e
       join email_campaigns c on c.email_campaign_id = e.email_campaign_id
       join accounts a on a.account_id = e.account_id
      where c.status = 'ACTIVE'
        and e.status not in ('PAUSED','STOPPED','UNSUBSCRIBED')
        and (a.relationship_state in ('ENGAGED','CALLBACK_REQUESTED','ACTIVE_OPPORTUNITY',
                                      'MEETING_SCHEDULED','CUSTOMER')
             or a.is_suppressed)
      order by a.canonical_name
      limit 50`,
  );
  return rows;
}

// ------------------------------------------------------------------ analytics

export interface AnalyticsFilters {
  fromDate: string | null; toDate: string | null;
  ownerUserId: string | null; verticalProfileId: string | null;
}

/**
 * Funnel counts with defined denominators. Every stage states what it counts, and
 * booked meetings are never reported as attended meetings.
 */
export async function analyticsFunnel(filters: AnalyticsFilters) {
  const from = filters.fromDate ?? null;
  const to = filters.toDate ?? null;
  const owner = filters.ownerUserId ?? null;
  const vertical = filters.verticalProfileId ?? null;

  const { rows } = await query<any>(
    `with scoped as (
       select a.account_id
         from accounts a
        where ($1::date is null or a.created_at >= $1::date)
          and ($2::date is null or a.created_at < ($2::date + interval '1 day'))
          and ($3::uuid is null or a.current_owner_user_id = $3::uuid)
          and ($4::text is null or a.primary_vertical_profile_id = $4::text)
     )
     select
       (select count(*)::int from scoped) as researched,
       (select count(distinct e.account_id)::int from contact_endpoints e
          join scoped s on s.account_id = e.account_id
         where e.is_active and not e.is_suppressed) as contactable,
       (select count(distinct at.account_id)::int from contact_attempts at
          join scoped s on s.account_id = at.account_id) as attempted,
       (select count(distinct at.account_id)::int from contact_attempts at
          join scoped s on s.account_id = at.account_id
         where at.disposition in ('DECISION_MAKER_REACHED','GATEKEEPER','SEND_INFORMATION',
                                  'CALLBACK_REQUESTED','POSSIBLE_OPPORTUNITY',
                                  'MEETING_SCHEDULED','NOT_A_FIT')) as connected,
       (select count(distinct o.account_id)::int from opportunities o
          join scoped s on s.account_id = o.account_id) as qualified,
       (select count(distinct b.account_id)::int from meeting_bookings b
          join scoped s on s.account_id = b.account_id
         where b.status = 'CONFIRMED') as booked,
       (select count(distinct b.account_id)::int from meeting_bookings b
          join scoped s on s.account_id = b.account_id
         where b.attended_state = 'ATTENDED') as attended,
       (select count(distinct sp.account_id)::int from suppressions sp
          join scoped s on s.account_id = sp.account_id
         where sp.is_active) as suppressed`,
    [from, to, owner, vertical],
  );
  return rows[0];
}

export async function analyticsBreakdown(dimension: 'vertical' | 'owner' | 'market' | 'hypothesis') {
  const sql = {
    vertical: `select coalesce(v.display_name, 'Unclassified') as label,
                      count(*)::int as accounts,
                      count(*) filter (where a.ownership_state = 'CLAIMED')::int as claimed
                 from accounts a
                 left join vertical_profiles v on v.vertical_profile_id = a.primary_vertical_profile_id
                group by 1 order by accounts desc limit 12`,
    owner: `select coalesce(u.display_name, 'Unclaimed') as label,
                   count(*)::int as accounts,
                   count(*) filter (where a.relationship_state <> 'NONE')::int as claimed
              from accounts a
              left join users u on u.user_id = a.current_owner_user_id
             group by 1 order by accounts desc limit 12`,
    market: `select m.name as label, count(*)::int as accounts,
                    count(*) filter (where a.ownership_state = 'CLAIMED')::int as claimed
               from account_market_membership am
               join saved_markets m on m.market_id = am.market_id
               join accounts a on a.account_id = am.account_id
              group by 1 order by accounts desc limit 12`,
    hypothesis: `select coalesce(h.offer_family, 'Unclassified') as label,
                        count(distinct h.account_id)::int as accounts,
                        count(distinct h.account_id) filter (where h.rank = 1)::int as claimed
                   from offer_hypotheses h
                  where h.is_current
                  group by 1 order by accounts desc limit 12`,
  }[dimension];
  const { rows } = await query<any>(sql);
  return rows;
}

// ---------------------------------------------------------------- call review

export async function listVoiceCalls(limit = 50) {
  const { rows } = await query<any>(
    `select c.voice_call_id, c.direction, c.agent_profile_id, c.started_at, c.ended_at,
            c.duration_seconds, c.outcome, c.disposition, c.qa_score, c.qa_hard_failure,
            c.root_cause, c.reviewed_at, c.mode_at_start,
            a.canonical_name as company_name, p.full_name as contact_name
       from voice_calls c
       left join accounts a on a.account_id = c.account_id
       left join contacts p on p.contact_id = c.contact_id
      order by c.started_at desc
      limit $1`,
    [limit],
  );
  return rows;
}

export async function voiceCallDetail(voiceCallId: string) {
  const { rows } = await query<any>(
    `select c.*, a.canonical_name as company_name, p.full_name as contact_name,
            p.raw_title as contact_role, u.display_name as reviewed_by_name
       from voice_calls c
       left join accounts a on a.account_id = c.account_id
       left join contacts p on p.contact_id = c.contact_id
       left join users u on u.user_id = c.reviewed_by
      where c.voice_call_id = $1`,
    [voiceCallId],
  );
  const call = rows[0];
  if (!call) return null;

  const [turns, events] = await Promise.all([
    query<any>(
      `select turn_index, speaker, text, offset_ms, interrupted, component_id
         from voice_call_turns where voice_call_id = $1 order by turn_index`,
      [voiceCallId],
    ),
    query<any>(
      `select occurred_at, offset_ms, kind, label, detail
         from voice_call_events where voice_call_id = $1 order by occurred_at, event_id`,
      [voiceCallId],
    ),
  ]);
  return { call, turns: turns.rows, events: events.rows };
}
