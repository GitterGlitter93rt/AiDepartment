import { query } from '../db/pool.js';

/** Read models for the Wave C operations pages. */

export async function miningKpis() {
  const { rows } = await query<{
    active: number; queued: number; added_today: number; refreshed_today: number; failed: number;
  }>(
    `select
       (select count(*)::int from jobs where status = 'RUNNING') as active,
       (select count(*)::int from jobs where status = 'QUEUED') as queued,
       (select count(*)::int from accounts where created_at > now() - interval '1 day') as added_today,
       (select count(*)::int from accounts
         where last_researched_at > now() - interval '1 day') as refreshed_today,
       (select count(*)::int from jobs where status = 'FAILED') as failed`,
  );
  const row = rows[0]!;
  return {
    active: row.active, queued: row.queued, addedToday: row.added_today,
    refreshedToday: row.refreshed_today, failed: row.failed,
  };
}

export async function miningJobs() {
  const { rows } = await query(
    `select j.job_id, j.job_type, j.status, j.created_at, j.started_at, j.completed_at,
            j.attempts, j.max_attempts, j.last_error, j.progress,
            m.name as market_name,
            j.payload->>'geography_value' as geography,
            u.display_name as requested_by_name
       from jobs j
       left join saved_markets m on m.market_id = j.market_id
       left join users u on u.user_id = j.requested_by
      order by
        case j.status when 'RUNNING' then 1 when 'QUEUED' then 2 when 'FAILED' then 3 else 4 end,
        j.created_at desc
      limit 60`,
  );
  return rows;
}

export async function researchHealthMetrics() {
  const { rows } = await query<Record<string, number>>(
    `select
       count(*)::int as total,
       count(*) filter (where research_fresh_until > now())::int as fresh,
       count(*) filter (where research_fresh_until <= now()
                          and research_fresh_until > now() - interval '7 days')::int as aging,
       count(*) filter (where research_fresh_until <= now() - interval '7 days')::int as stale,
       count(*) filter (where last_researched_at is null)::int as never,
       count(*) filter (where canonical_domain is not null)::int as with_website,
       count(*) filter (where best_contact_name is not null
                          and coalesce(best_contact_is_role_only,false) = false)::int as named_dm,
       count(*) filter (where coalesce(best_contact_is_role_only,false))::int as role_only,
       count(*) filter (where coalesce(has_direct_phone,false)
                          or coalesce(has_named_email,false))::int as direct_route,
       count(*) filter (where best_contact_name is not null
                          and coalesce(best_contact_is_role_only,false) = false
                          and not coalesce(has_direct_phone,false))::int as named_via_main,
       count(*) filter (where contactability_summary = 'RESEARCH_NEEDED')::int as no_contact
       from prospect_inventory where not is_suppressed`,
  );
  const row = rows[0]!;
  // The page reads product names, not column names. Returning the raw row meant three
  // metrics rendered as the word "undefined" on the Research Health page.
  return {
    total: row['total'] ?? 0,
    fresh: row['fresh'] ?? 0,
    aging: row['aging'] ?? 0,
    stale: row['stale'] ?? 0,
    never: row['never'] ?? 0,
    withWebsite: row['with_website'] ?? 0,
    namedDm: row['named_dm'] ?? 0,
    roleOnly: row['role_only'] ?? 0,
    directRoute: row['direct_route'] ?? 0,
    namedViaMain: row['named_via_main'] ?? 0,
    noContact: row['no_contact'] ?? 0,
  };
}

/**
 * Data-quality exceptions needing a human decision. Each row is something the system
 * genuinely cannot resolve on its own, not a routine gap.
 */
export async function researchExceptions() {
  const { rows } = await query(
    `(select a.account_id, a.canonical_name as company_name,
             'stale_evidence' as exception_type,
             'All research on this account has aged past its freshness window' as detail,
             a.research_fresh_until as since
        from accounts a
       where not a.is_suppressed and a.current_owner_user_id is not null
         and a.research_fresh_until < now() - interval '14 days'
       limit 20)
     union all
     (select a.account_id, a.canonical_name,
             'broken_website',
             'A primary website is recorded but no page could be read on the last attempt',
             r.started_at
        from accounts a
        join research_runs r on r.account_id = a.account_id
       where a.canonical_domain is not null and r.status = 'partial'
         and not exists (select 1 from evidence_records e
                          where e.account_id = a.account_id and e.source_type = 'COMPANY_FIRST_PARTY')
       limit 20)
     union all
     (select a.account_id, a.canonical_name,
             'contact_disagreement',
             'A contact was reported as no longer current but a replacement has not been resolved',
             c.updated_at
        from accounts a
        join contacts c on c.account_id = a.account_id
       where c.status = 'LEFT_COMPANY'
         and not exists (select 1 from contacts c2
                          where c2.account_id = a.account_id and c2.status = 'ACTIVE')
       limit 20)
     union all
     (select a.account_id, a.canonical_name,
             'provider_failure',
             coalesce(j.last_error, 'A research job failed after exhausting its retries'),
             j.completed_at
        from jobs j join accounts a on a.account_id = j.account_id
       where j.status = 'FAILED'
       limit 20)
     order by since desc nulls last
     limit 60`,
  );
  return rows;
}
