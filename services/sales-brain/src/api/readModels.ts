import { query } from '../db/pool.js';
import { isManager, type Role } from '../domain/auth.js';

/**
 * Purpose-built read models for the CRM pages.
 * Authority: YAD-SALES-CRM-UI-DATA-ACTION-CONTRACT.md §2.
 *
 * Pages consume these; they never rebuild ownership, channel status, endpoint
 * directness, booking state or DNC independently. One projection, many views.
 */

// ------------------------------------------------------------------ ReplyView

export interface ReplyRow {
  enrollment_id: string;
  account_id: string;
  company_name: string;
  geography: string | null;
  contact_id: string | null;
  contact_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  source_channel: string;
  reply_class: string | null;
  reply_excerpt: string | null;
  occurred_at: Date;
  relationship_state: string;
  is_suppressed: boolean;
  campaign_name: string | null;
  subject_variant: string | null;
  /** Whether a human has already acted on it. */
  has_open_task: boolean;
}

export async function listReplies(
  viewer: { userId: string; role: Role },
  filter: 'needs_response' | 'positive' | 'neutral' | 'negative' | 'unsubscribe' | 'all' = 'needs_response',
): Promise<ReplyRow[]> {
  const conditions: string[] = [`ev.event_type = 'REPLIED'`];
  const values: unknown[] = [];
  const push = (value: unknown): string => { values.push(value); return `$${values.length}`; };

  // A rep sees replies on the accounts they own; a manager sees the team's.
  if (!isManager(viewer.role)) conditions.push(`a.current_owner_user_id = ${push(viewer.userId)}`);

  switch (filter) {
    case 'needs_response':
      conditions.push(`ev.reply_class in ('POSITIVE_INTEREST','QUESTION','SEND_INFO','CORRECT_PERSON_REFERRAL','OTHER_REVIEW')`);
      conditions.push(`not exists (select 1 from follow_ups f
                        where f.account_id = a.account_id and f.status = 'OPEN')`);
      break;
    case 'positive':
      conditions.push(`ev.reply_class in ('POSITIVE_INTEREST','QUESTION','SEND_INFO')`);
      break;
    case 'neutral':
      conditions.push(`ev.reply_class in ('TIMING_LATER','OUT_OF_OFFICE','CORRECT_PERSON_REFERRAL','OTHER_REVIEW')`);
      break;
    case 'negative':
      conditions.push(`ev.reply_class in ('NOT_INTERESTED','ALREADY_SOLVED','WRONG_PERSON','WRONG_COMPANY')`);
      break;
    case 'unsubscribe':
      conditions.push(`ev.reply_class = 'UNSUBSCRIBE_OPT_OUT'`);
      break;
    default: break;
  }

  const { rows } = await query<ReplyRow>(
    `select en.enrollment_id, a.account_id, a.canonical_name as company_name,
            pi.geography_summary as geography, en.contact_id, c.full_name as contact_name,
            a.current_owner_user_id as owner_user_id, u.display_name as owner_name,
            'email' as source_channel, ev.reply_class, ev.reply_excerpt, ev.occurred_at,
            a.relationship_state, a.is_suppressed,
            camp.name as campaign_name, en.subject_variant,
            exists (select 1 from follow_ups f
                     where f.account_id = a.account_id and f.status = 'OPEN') as has_open_task
       from email_events ev
       join email_enrollments en on en.enrollment_id = ev.enrollment_id
       join accounts a on a.account_id = en.account_id
       left join prospect_inventory pi on pi.account_id = a.account_id
       left join contacts c on c.contact_id = en.contact_id
       left join users u on u.user_id = a.current_owner_user_id
       left join email_campaigns camp on camp.email_campaign_id = en.email_campaign_id
      where ${conditions.join(' and ')}
      order by ev.occurred_at desc
      limit 100`,
    values,
  );
  return rows;
}

export async function replyThread(enrollmentId: string): Promise<{
  messages: { direction: string; text: string; occurredAt: Date; replyClass: string | null }[];
  account: any;
} | null> {
  const { rows: accountRows } = await query(
    `select a.account_id, a.canonical_name, a.relationship_state, a.is_suppressed,
            pi.geography_summary, pi.manual_tier, pi.manual_score, pi.primary_hypothesis,
            u.display_name as owner_name, en.normalized_email, en.subject_variant,
            en.personalized_line, camp.name as campaign_name
       from email_enrollments en
       join accounts a on a.account_id = en.account_id
       left join prospect_inventory pi on pi.account_id = a.account_id
       left join users u on u.user_id = a.current_owner_user_id
       left join email_campaigns camp on camp.email_campaign_id = en.email_campaign_id
      where en.enrollment_id = $1`,
    [enrollmentId],
  );
  if (!accountRows[0]) return null;

  const { rows: events } = await query<{
    event_type: string; reply_excerpt: string | null; occurred_at: Date; reply_class: string | null;
  }>(
    `select event_type, reply_excerpt, occurred_at, reply_class from email_events
      where enrollment_id = $1 order by occurred_at asc`,
    [enrollmentId],
  );

  return {
    account: accountRows[0],
    messages: events
      .filter((event) => event.event_type === 'SENT' || event.event_type === 'REPLIED')
      .map((event) => ({
        direction: event.event_type === 'SENT' ? 'outbound' : 'inbound',
        text: event.reply_excerpt ?? (accountRows[0]!.personalized_line ?? '(message body not stored)'),
        occurredAt: event.occurred_at,
        replyClass: event.reply_class,
      })),
  };
}

// ---------------------------------------------------------------- MeetingView

export interface MeetingRow {
  booking_id: string;
  account_id: string;
  company_name: string;
  geography: string | null;
  contact_name: string | null;
  contact_title: string | null;
  attendee_name: string | null;
  attendee_email: string | null;
  calendar_upn: string;
  meeting_type: string;
  requested_start: Date;
  requested_end: Date;
  prospect_timezone: string | null;
  status: string;
  attended_state: string;
  provider_web_link: string | null;
  meeting_location_type: string;
  source_channel: string;
  owner_name: string | null;
  has_prep_brief: boolean;
}

export async function listMeetings(
  viewer: { userId: string; role: Role },
  tab: 'upcoming' | 'today' | 'completed' | 'needs_attention' = 'upcoming',
): Promise<MeetingRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const push = (value: unknown): string => { values.push(value); return `$${values.length}`; };

  if (!isManager(viewer.role)) {
    conditions.push(`(b.owner_user_id = ${push(viewer.userId)} or a.current_owner_user_id = $${values.length})`);
  }

  switch (tab) {
    case 'today':
      conditions.push(`b.status = 'CONFIRMED' and b.requested_start::date = now()::date`);
      break;
    case 'completed':
      conditions.push(`b.status in ('COMPLETED') or b.attended_state = 'ATTENDED'`);
      break;
    case 'needs_attention':
      // No-shows and cancellations both need a human decision. So does a booking
      // still waiting on the provider: we told the prospect we would send an invite,
      // the provider never confirmed, and it appears on no other tab. Silently
      // invisible is the worst of the three states, because nobody goes looking for
      // it. A few minutes of grace keeps in-flight requests out of the list.
      conditions.push(`(b.attended_state = 'NO_SHOW' or b.status in ('CANCELLED','FAILED')
        or (b.status = 'PENDING' and b.created_at < now() - interval '10 minutes'))`);
      break;
    default:
      conditions.push(`b.status = 'CONFIRMED' and b.requested_start >= now()`);
      break;
  }

  const { rows } = await query<MeetingRow>(
    `select b.booking_id, b.account_id, a.canonical_name as company_name,
            pi.geography_summary as geography, c.full_name as contact_name,
            c.raw_title as contact_title, b.attendee_name, b.attendee_email,
            b.calendar_upn, b.meeting_type, b.requested_start, b.requested_end,
            b.prospect_timezone, b.status, b.attended_state, b.provider_web_link,
            b.meeting_location_type, b.source_channel,
            u.display_name as owner_name,
            (b.prep_brief is not null) as has_prep_brief
       from meeting_bookings b
       join accounts a on a.account_id = b.account_id
       left join prospect_inventory pi on pi.account_id = a.account_id
       left join contacts c on c.contact_id = b.contact_id
       left join users u on u.user_id = coalesce(b.owner_user_id, a.current_owner_user_id)
      ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
      order by b.requested_start ${tab === 'completed' || tab === 'needs_attention' ? 'desc' : 'asc'}
      limit 100`,
    values,
  );
  return rows;
}

export async function getMeeting(bookingId: string): Promise<any | null> {
  const { rows } = await query(
    `select b.*, a.canonical_name as company_name, a.canonical_domain,
            pi.geography_summary as geography, pi.manual_tier, pi.manual_score,
            c.full_name as contact_name, c.raw_title as contact_title,
            u.display_name as owner_name
       from meeting_bookings b
       join accounts a on a.account_id = b.account_id
       left join prospect_inventory pi on pi.account_id = a.account_id
       left join contacts c on c.contact_id = b.contact_id
       left join users u on u.user_id = coalesce(b.owner_user_id, a.current_owner_user_id)
      where b.booking_id = $1`,
    [bookingId],
  );
  return rows[0] ?? null;
}

// ----------------------------------------------------------------- MarketView

export async function getMarket(marketId: string): Promise<any | null> {
  const { rows } = await query(
    `select m.*, v.display_name as vertical_display,
            count(pi.account_id)::int as researched,
            count(*) filter (where pi.ownership_state = 'UNCLAIMED')::int as unclaimed,
            count(*) filter (where pi.current_owner_user_id is not null)::int as claimed,
            count(*) filter (where pi.manual_tier = 'A')::int as tier_a,
            count(*) filter (where pi.manual_tier = 'B')::int as tier_b,
            count(*) filter (where pi.contactability_summary = 'PHONE_AND_EMAIL')::int as phone_email,
            count(*) filter (where pi.best_contact_name is not null
                               and coalesce(pi.best_contact_is_role_only,false) = false)::int as named_dm,
            count(*) filter (where coalesce(pi.google_paid,false) or coalesce(pi.google_lsa,false)
                               or coalesce(pi.meta_paid,false))::int as advertisers,
            count(*) filter (where pi.research_fresh_until > now())::int as fresh,
            max(pi.last_researched_at) as last_researched
       from saved_markets m
       left join vertical_profiles v on v.vertical_profile_id = m.vertical_profile_id
       left join account_market_membership mm on mm.market_id = m.market_id
       left join prospect_inventory pi on pi.account_id = mm.account_id and not pi.is_suppressed
      where m.market_id = $1
      group by m.market_id, v.display_name`,
    [marketId],
  );
  return rows[0] ?? null;
}

export async function marketResearchActivity(marketId: string): Promise<any[]> {
  const { rows } = await query(
    `select job_id, job_type, status, created_at, completed_at, last_error, progress, attempts
       from jobs where market_id = $1 order by created_at desc limit 15`,
    [marketId],
  );
  return rows;
}

// ------------------------------------------------------------ counts for nav

export async function navCountsFull(userId: string, role: Role) {
  const { rows } = await query<{
    my_prospects: number; follow_ups_due: number; replies: number;
    opportunities: number; meetings: number;
  }>(
    `select
       (select count(*)::int from accounts
         where current_owner_user_id = $1 and not is_suppressed) as my_prospects,
       (select count(*)::int from follow_ups
         where owner_user_id = $1 and status = 'OPEN' and due_at <= now() + interval '1 day')
         as follow_ups_due,
       (select count(*)::int from email_events ev
          join email_enrollments en on en.enrollment_id = ev.enrollment_id
          join accounts a on a.account_id = en.account_id
         where ev.event_type = 'REPLIED'
           and ev.reply_class in ('POSITIVE_INTEREST','QUESTION','SEND_INFO','CORRECT_PERSON_REFERRAL')
           and ($2 or a.current_owner_user_id = $1)
           and not exists (select 1 from follow_ups f
                            where f.account_id = a.account_id and f.status = 'OPEN')) as replies,
       (select count(*)::int from opportunities
         where stage not in ('CLOSED_WON','CLOSED_LOST')
           and ($2 or owner_user_id = $1)) as opportunities,
       (select count(*)::int from meeting_bookings b
          join accounts a on a.account_id = b.account_id
         where b.status = 'CONFIRMED' and b.requested_start >= now()
           and ($2 or a.current_owner_user_id = $1 or b.owner_user_id = $1)) as meetings`,
    [userId, isManager(role)],
  );
  const row = rows[0]!;
  return {
    myProspects: row.my_prospects,
    followUpsDue: row.follow_ups_due,
    replies: row.replies,
    opportunities: row.opportunities,
    meetings: row.meetings,
  };
}
