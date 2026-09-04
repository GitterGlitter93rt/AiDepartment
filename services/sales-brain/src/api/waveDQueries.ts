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

/**
 * One campaign in full: who is in it, where they came from, what has happened, and
 * what else is touching the same accounts.
 */
export async function campaignDetail(campaignId: string) {
  const { rows } = await query<any>(
    `select c.*, v.display_name as vertical_name, u.display_name as created_by_name
       from email_campaigns c
       left join vertical_profiles v on v.vertical_profile_id = c.vertical_profile_id
       left join users u on u.user_id = c.created_by
      where c.email_campaign_id = $1`,
    [campaignId],
  );
  const campaign = rows[0];
  if (!campaign) return null;

  const [outcomes, sources, members, conflicts, pending] = await Promise.all([
    query<any>(
      `select e.status, count(*)::int as n
         from email_enrollments e where e.email_campaign_id = $1
        group by e.status order by n desc`, [campaignId]),
    // Where the audience came from. A campaign that cannot say where its list came
    // from is not auditable.
    query<any>(
      `select coalesce(e.discovery_source, 'unrecorded') as source, count(*)::int as n
         from email_enrollments e where e.email_campaign_id = $1
        group by 1 order by n desc`, [campaignId]),
    query<any>(
      `select e.enrollment_id, e.status, e.normalized_email, e.exported_at, e.last_event_at,
              e.stop_reason, e.subject_variant, e.provider_lead_id,
              a.account_id, a.canonical_name as company_name, a.relationship_state,
              a.is_suppressed, u.display_name as owner_name
         from email_enrollments e
         join accounts a on a.account_id = e.account_id
         left join users u on u.user_id = a.current_owner_user_id
        where e.email_campaign_id = $1
        order by e.created_at desc limit 200`, [campaignId]),
    // Relationship state outranks campaign membership, so a member who is no longer
    // cold is shown first rather than left to be discovered by a send.
    query<any>(
      `select a.account_id, a.canonical_name as company_name, a.relationship_state,
              e.status as enrollment_status
         from email_enrollments e
         join accounts a on a.account_id = e.account_id
        where e.email_campaign_id = $1
          and e.status not in ('PAUSED','STOPPED','UNSUBSCRIBED')
          and (a.is_suppressed or a.relationship_state in
               ('ENGAGED','CALLBACK_REQUESTED','ACTIVE_OPPORTUNITY','MEETING_SCHEDULED','CUSTOMER'))
        order by a.canonical_name`, [campaignId]),
    query<any>(
      `select o.operation, o.status, count(*)::int as n, max(o.last_error) as last_error
         from email_outbox o
         join email_enrollments e on e.enrollment_id = o.enrollment_id
        where e.email_campaign_id = $1
        group by o.operation, o.status`, [campaignId]),
  ]);

  return {
    campaign,
    outcomes: outcomes.rows,
    sources: sources.rows,
    members: members.rows,
    conflicts: conflicts.rows,
    outbox: pending.rows,
  };
}

// ------------------------------------------------------------------ analytics

export interface AnalyticsFilters {
  fromDate: string | null;
  toDate: string | null;
  ownerUserId: string | null;
  verticalProfileId: string | null;
  marketId: string | null;
  /** Which outreach channel the attempt used. */
  channel: string | null;
  /** The offer hypothesis family the account was approached on. */
  hook: string | null;
  /** A specific call/email outcome, for drilling into one disposition. */
  outcome: string | null;
}

export function emptyFilters(): AnalyticsFilters {
  return {
    fromDate: null, toDate: null, ownerUserId: null, verticalProfileId: null,
    marketId: null, channel: null, hook: null, outcome: null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses the query string into filters.
 *
 * A value that cannot be a filter — a malformed id, a date that is not a date — is
 * dropped and named in `ignored`, so the page can say the scope is wider than the URL
 * suggests. Silently showing unfiltered numbers under a filtered URL is worse than
 * showing none.
 */
export function parseAnalyticsFilters(
  params: URLSearchParams,
): AnalyticsFilters & { ignored: string[] } {
  const ignored: string[] = [];
  const text = (name: string) => {
    const raw = (params.get(name) ?? '').trim();
    return raw.length > 0 ? raw.slice(0, 100) : null;
  };
  const shaped = (name: string, pattern: RegExp, label: string) => {
    const raw = text(name);
    if (raw === null) return null;
    if (pattern.test(raw)) return raw;
    ignored.push(label);
    return null;
  };

  return {
    fromDate: shaped('from', ISO_DATE, 'from date'),
    toDate: shaped('to', ISO_DATE, 'to date'),
    ownerUserId: shaped('rep', UUID, 'rep'),
    verticalProfileId: text('vertical'),
    marketId: shaped('market', UUID, 'market'),
    channel: text('channel'),
    hook: text('hook'),
    outcome: text('outcome'),
    ignored,
  };
}

/** Filter options, read from what the data actually contains. */
export async function analyticsFilterOptions() {
  const [reps, markets, verticals, hooks] = await Promise.all([
    query<any>(`select u.user_id as id, u.display_name as label
                  from users u where u.is_active order by u.display_name`),
    query<any>(`select m.market_id as id, m.name as label
                  from saved_markets m order by m.name limit 100`),
    query<any>(`select v.vertical_profile_id as id, v.display_name as label
                  from vertical_profiles v where v.is_active order by v.display_name`),
    query<any>(`select distinct h.offer_family as id, h.offer_family as label
                  from offer_hypotheses h where h.is_current and h.offer_family is not null
                  order by 1 limit 50`),
  ]);
  return {
    reps: reps.rows, markets: markets.rows, verticals: verticals.rows, hooks: hooks.rows,
    channels: [
      { id: 'HUMAN_MANUAL_CALL', label: 'Human call' },
      { id: 'AUTONOMOUS_AI_VOICE', label: 'AI voice' },
      { id: 'EMAIL', label: 'Email' },
      { id: 'SMS', label: 'SMS' },
      { id: 'FIELD', label: 'Field' },
    ],
    outcomes: [
      'NO_ANSWER', 'VOICEMAIL', 'GATEKEEPER', 'DECISION_MAKER_REACHED', 'SEND_INFORMATION',
      'CALLBACK_REQUESTED', 'POSSIBLE_OPPORTUNITY', 'MEETING_SCHEDULED', 'NOT_A_FIT',
      'WRONG_NUMBER', 'DO_NOT_CONTACT',
    ].map((id) => ({ id, label: id.replace(/_/g, ' ').toLowerCase() })),
  };
}

/**
 * Funnel counts with defined denominators.
 *
 * Every stage counts distinct Accounts inside one scope, so the stages are directly
 * comparable and a share is meaningful. Booked and attended are separate counts and
 * are never collapsed: a booking is not an attendance, and reporting it as one is
 * how a pipeline flatters itself.
 *
 * The channel, hook and outcome filters narrow the *scope*, so a funnel filtered to
 * AI voice counts only accounts approached that way at every stage rather than
 * mixing a phone-attempt denominator with an email numerator.
 */
export async function analyticsFunnel(filters: AnalyticsFilters) {
  const { rows } = await query<any>(
    `with scoped as (
       select distinct a.account_id
         from accounts a
         left join account_market_membership am on am.account_id = a.account_id
        where ($1::date is null or a.created_at >= $1::date)
          and ($2::date is null or a.created_at < ($2::date + interval '1 day'))
          and ($3::uuid is null or a.current_owner_user_id = $3::uuid)
          and ($4::text is null or a.primary_vertical_profile_id = $4::text)
          and ($5::uuid is null or am.market_id = $5::uuid)
          and ($6::text is null or exists (
                select 1 from contact_attempts at
                 where at.account_id = a.account_id and at.channel = $6::text))
          and ($7::text is null or exists (
                select 1 from offer_hypotheses h
                 where h.account_id = a.account_id and h.is_current
                   and h.offer_family = $7::text))
          and ($8::text is null or exists (
                select 1 from contact_attempts at
                 where at.account_id = a.account_id and at.disposition = $8::text))
     )
     select
       (select count(*)::int from scoped) as researched,
       -- Contactable means we could contact them. An Account under a DNC could not,
       -- and account-scope suppression does not flip the endpoint rows -- the trigger
       -- only does that for endpoint-scope suppressions -- so the endpoint test alone
       -- counted suppressed companies as reachable. They are reported separately in
       -- the suppressed stage, never hidden, but they are not the top of a funnel.
       (select count(distinct e.account_id)::int from contact_endpoints e
          join scoped s on s.account_id = e.account_id
          join accounts sa on sa.account_id = e.account_id
         where e.is_active and not e.is_suppressed and not sa.is_suppressed) as contactable,
       (select count(distinct at.account_id)::int from contact_attempts at
          join scoped s on s.account_id = at.account_id
         where ($6::text is null or at.channel = $6::text)) as attempted,
       (select count(distinct at.account_id)::int from contact_attempts at
          join scoped s on s.account_id = at.account_id
         where ($6::text is null or at.channel = $6::text)
           and at.disposition in ('DECISION_MAKER_REACHED','GATEKEEPER','SEND_INFORMATION',
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
    [filters.fromDate, filters.toDate, filters.ownerUserId, filters.verticalProfileId,
     filters.marketId, filters.channel, filters.hook, filters.outcome],
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

// --------------------------------------------------------------- global search

export interface SearchHit {
  accountId: string;
  companyName: string;
  city: string | null;
  state: string | null;
  ownerName: string | null;
  isSuppressed: boolean;
  relationshipState: string | null;
  matchedOn: string;
  matchedValue: string;
}

/**
 * Global search across company, person, phone, email, city and known alias.
 *
 * Every hit resolves to a canonical Account, so a person or a phone number found
 * here opens the same record the rest of the product uses. Suppression travels with
 * the hit rather than being discovered later.
 */
export async function globalSearch(term: string, limit = 25): Promise<SearchHit[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  const lower = trimmed.toLowerCase();
  const like = `%${lower}%`;
  const prefix = `${lower}%`;
  // Digits only, so "(904) 555-0142" finds a number stored as +19045550142. Seven
  // digits is the shortest that identifies a line rather than an area code.
  const digits = trimmed.replace(/\D+/g, '');
  const phoneSearch = digits.length >= 7 ? digits : '';

  const { rows } = await query<any>(
    `with hits as (
       select a.account_id, 'Company' as matched_on, a.canonical_name as matched_value,
              case when lower(a.canonical_name) = $1 then 0
                   when lower(a.canonical_name) like $4 then 1
                   else 3 end as rank
         from accounts a where lower(a.canonical_name) like $2
       union all
       select d.account_id, 'Website', d.hostname,
              case when lower(d.hostname) = $1 then 0
                   when lower(d.hostname) like $4 then 2 else 4 end
         from account_domains d where lower(d.hostname) like $2
       union all
       select c.account_id, 'Person', c.full_name,
              case when lower(c.full_name) = $1 then 0
                   when lower(c.full_name) like $4 then 1 else 3 end
         from contacts c where lower(c.full_name) like $2
       union all
       select e.account_id, 'Phone', e.display_value, 0
         from contact_endpoints e
        where e.endpoint_type = 'PHONE' and $3 <> ''
          and regexp_replace(e.normalized_value, '\\D', '', 'g') like '%' || $3 || '%'
       union all
       select e.account_id, 'Email', e.display_value,
              case when lower(e.normalized_value) = $1 then 0 else 2 end
         from contact_endpoints e
        where e.endpoint_type = 'EMAIL' and lower(e.normalized_value) like $2
       union all
       select l.account_id, 'City', l.city, 5
         from locations l where lower(l.city) like $2
     ),
     best as (
       select distinct on (h.account_id)
              h.account_id, h.matched_on, h.matched_value, h.rank
         from hits h
        order by h.account_id, h.rank, h.matched_on
     )
     select b.account_id, b.matched_on, b.matched_value, b.rank,
            a.canonical_name as company_name, a.is_suppressed,
            a.relationship_state, l.city, l.state_region as state,
            u.display_name as owner_name
       from best b
       join accounts a on a.account_id = b.account_id
       left join locations l on l.account_id = a.account_id and l.is_headquarters
       left join users u on u.user_id = a.current_owner_user_id
      -- Best match first, then the ones a rep can actually act on.
      order by b.rank, a.is_suppressed, a.canonical_name
      limit $5`,
    [lower, like, phoneSearch, prefix, limit],
  );

  return rows.map((row) => ({
    accountId: row.account_id,
    companyName: row.company_name,
    city: row.city,
    state: row.state,
    ownerName: row.owner_name,
    isSuppressed: row.is_suppressed,
    relationshipState: row.relationship_state,
    matchedOn: row.matched_on,
    matchedValue: row.matched_value,
  }));
}

// ---------------------------------------------------------------- audit trail

export interface AuditFilters {
  actorUserId: string | null;
  action: string | null;
  subjectType: string | null;
  subjectId: string | null;
  fromDate: string | null;
  toDate: string | null;
}

export function parseAuditFilters(params: URLSearchParams): AuditFilters & { ignored: string[] } {
  const ignored: string[] = [];
  const text = (name: string) => {
    const raw = (params.get(name) ?? '').trim();
    return raw.length > 0 ? raw.slice(0, 100) : null;
  };
  const uuid = (name: string, label: string) => {
    const raw = text(name);
    if (raw === null) return null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return raw;
    ignored.push(label);
    return null;
  };
  const date = (name: string, label: string) => {
    const raw = text(name);
    if (raw === null) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    ignored.push(label);
    return null;
  };
  return {
    actorUserId: uuid('actor', 'actor'),
    action: text('action'),
    subjectType: text('subjectType'),
    subjectId: uuid('subject', 'subject'),
    fromDate: date('from', 'from date'),
    toDate: date('to', 'to date'),
    ignored,
  };
}

/**
 * The audit trail, read-only.
 *
 * An audit row is a record of what someone did, so nothing here can edit one — the
 * table has no update path anywhere in the service. The actor is resolved to a name
 * for reading; the row itself keeps the id.
 */
export async function listAuditEvents(filters: AuditFilters, limit = 200) {
  // Ownership is recorded in its own append-only ledger rather than duplicated into
  // audit_log, so a review that read only audit_log could not answer the question
  // managers ask most often: who took this Account, and who gave it away. The two
  // ledgers are unioned for reading; neither is written twice.
  // The page is selected before the Account name is resolved, and the join key is a
  // uuid rather than a text cast of one.
  //
  // Joining `accounts.account_id::text = subject_id` cannot use the primary key, so
  // it cost a sequential scan of accounts for every audit row: 505 ms for 200 rows
  // against 25,000 accounts. Casting the audit side to uuid instead -- guarded,
  // because subject_id also holds non-uuid subjects -- and resolving names only for
  // the rows that survive the limit brings it to a couple of milliseconds.
  const { rows } = await query<any>(
    `with entries as (
       select l.audit_id, l.action, l.subject_type, l.subject_id, l.reason, l.detail,
              l.occurred_at, l.actor_user_id
         from audit_log l
       union all
       select -o.ownership_event_id as audit_id,
              'ownership.' || lower(o.event_type) as action,
              'account' as subject_type,
              o.account_id::text as subject_id,
              o.reason,
              jsonb_strip_nulls(jsonb_build_object(
                'previous_owner', p.display_name, 'new_owner', n.display_name)) as detail,
              o.occurred_at, o.actor_user_id
         from ownership_events o
         left join users p on p.user_id = o.previous_owner_user_id
         left join users n on n.user_id = o.new_owner_user_id
     ),
     page as (
       select e.*,
              case when e.subject_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                then e.subject_id::uuid end as subject_uuid
         from entries e
        where ($1::uuid is null or e.actor_user_id = $1::uuid)
          and ($2::text is null or e.action = $2::text)
          and ($3::text is null or e.subject_type = $3::text)
          and ($4::uuid is null or e.subject_id = $4::text)
          and ($5::date is null or e.occurred_at >= $5::date)
          and ($6::date is null or e.occurred_at < ($6::date + interval '1 day'))
        order by e.occurred_at desc, e.audit_id desc
        limit $7
     )
     select p.audit_id, p.action, p.subject_type, p.subject_id, p.reason, p.detail,
            p.occurred_at, u.display_name as actor_name, p.actor_user_id,
            a.canonical_name as subject_account_name
       from page p
       left join users u on u.user_id = p.actor_user_id
       left join accounts a on a.account_id = p.subject_uuid
      order by p.occurred_at desc, p.audit_id desc`,
    [filters.actorUserId, filters.action, filters.subjectType, filters.subjectId,
     filters.fromDate, filters.toDate, limit],
  );
  return rows;
}

/** The distinct actions and subject types actually recorded, for the filter menus. */
export async function auditFilterOptions() {
  const [actions, subjects, actors] = await Promise.all([
    query<any>(`select distinct action as id, action as label from (
                  select action from audit_log
                  union select 'ownership.' || lower(event_type) from ownership_events
                ) t order by 1 limit 100`),
    query<any>(`select distinct subject_type as id, subject_type as label from (
                  select subject_type from audit_log where subject_type is not null
                  union select 'account' from ownership_events limit 1
                ) t order by 1 limit 50`),
    query<any>(`select u.user_id as id, u.display_name as label from users u
                 where exists (select 1 from audit_log l where l.actor_user_id = u.user_id)
                    or exists (select 1 from ownership_events o where o.actor_user_id = u.user_id)
                 order by u.display_name`),
  ]);
  return { actions: actions.rows, subjects: subjects.rows, actors: actors.rows };
}

/** Everything recorded against one Account, for the history tab on its page. */
export async function accountAuditHistory(accountId: string, limit = 50) {
  const { rows } = await query<any>(
    `select e.audit_id, e.action, e.reason, e.detail, e.occurred_at,
            u.display_name as actor_name
       from (
         select l.audit_id, l.action, l.reason, l.detail, l.occurred_at, l.actor_user_id,
                l.subject_id
           from audit_log l
         union all
         select -o.ownership_event_id, 'ownership.' || lower(o.event_type), o.reason,
                jsonb_strip_nulls(jsonb_build_object(
                  'previous_owner', p.display_name, 'new_owner', n.display_name)),
                o.occurred_at, o.actor_user_id, o.account_id::text
           from ownership_events o
           left join users p on p.user_id = o.previous_owner_user_id
           left join users n on n.user_id = o.new_owner_user_id
       ) e
       left join users u on u.user_id = e.actor_user_id
      where e.subject_id = $1
      order by e.occurred_at desc
      limit $2`,
    [accountId, limit],
  );
  return rows;
}
