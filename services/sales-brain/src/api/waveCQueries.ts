import { query } from '../db/pool.js';

/** Read models for the Wave C operations pages. */

/**
 * Where an Account came from, for the Mining page.
 *
 * These are the `source_system` values written on the DISCOVERED activity when an
 * Account is first created. A miner discovery is the only one of them that is
 * mining output; the rest are a rep, a spreadsheet, or a fixture.
 */
export const MINER_SOURCES = ['dataforseo', 'market_miner', 'serp'] as const;
export const SYNTHETIC_SOURCES = ['SYNTHETIC_FIXTURE', 'DEMO_FIXTURE'] as const;

export interface MiningKpis {
  active: number;
  queued: number;
  failed: number;
  /** Accounts a discovery provider actually found today. */
  discoveredByMinerToday: number;
  importedToday: number;
  syntheticSeededToday: number;
  manuallyAddedToday: number;
  /** Every Account created today, whatever created it. The sum of the four above. */
  createdTodayTotal: number;
  /** Accounts a research job actually re-researched today. */
  refreshedByWorkerToday: number;
  /**
   * Accounts whose research timestamp is recent for any reason, including a seed
   * that wrote one. Reported beside the worker figure precisely so the two cannot be
   * confused: on a freshly seeded database the second is large and the first is zero.
   */
  freshTimestampToday: number;
  /** True when a discovery provider is registered and could actually find anything. */
  discoveryAvailable: boolean;
  discoveryBlockedJobsToday: number;
}

/**
 * Mining KPIs, by provenance.
 *
 * "Accounts added today: 59" counted every Account created by any means and put it
 * on the Mining page, where it reads as mining output. All 59 were demo seed rows.
 * "Accounts refreshed: 58" counted a timestamp rather than a worker run, and a seed
 * that writes last_researched_at inflates it to the size of the seed.
 *
 * Every number here names what produced it.
 */
export async function miningKpis(): Promise<MiningKpis> {
  const { rows } = await query<Record<string, number | boolean>>(
    `select
       (select count(*)::int from jobs where status = 'RUNNING') as active,
       (select count(*)::int from jobs where status = 'QUEUED') as queued,
       (select count(*)::int from jobs where status = 'FAILED') as failed,

       -- Provenance comes from the DISCOVERED activity written when the Account was
       -- created, which is durable and cannot be confused with a later edit.
       (select count(distinct act.account_id)::int from activities act
         where act.activity_type = 'DISCOVERED'
           and act.occurred_at > now() - interval '1 day'
           and act.source_system = any($1::text[])) as discovered_by_miner_today,
       (select count(distinct act.account_id)::int from activities act
         where act.activity_type = 'DISCOVERED'
           and act.occurred_at > now() - interval '1 day'
           and act.source_system = 'import') as imported_today,
       (select count(distinct act.account_id)::int from activities act
         where act.activity_type = 'DISCOVERED'
           and act.occurred_at > now() - interval '1 day'
           and act.source_system = any($2::text[])) as synthetic_seeded_today,
       (select count(*)::int from accounts a
         where a.created_at > now() - interval '1 day'
           and not exists (select 1 from activities act
                            where act.account_id = a.account_id
                              and act.activity_type = 'DISCOVERED'
                              and (act.source_system = any($1::text[])
                                or act.source_system = 'import'
                                or act.source_system = any($2::text[])))) as manually_added_today,
       (select count(*)::int from accounts
         where created_at > now() - interval '1 day') as created_today_total,

       -- A refresh is a research run that completed, not a timestamp somebody wrote.
       (select count(distinct r.account_id)::int from research_runs r
         where r.completed_at > now() - interval '1 day'
           and r.status in ('completed','partial')) as refreshed_by_worker_today,
       (select count(*)::int from accounts
         where last_researched_at > now() - interval '1 day') as fresh_timestamp_today,

       (select count(*)::int from jobs
         where outcome = 'DISCOVERY_BLOCKED'
           and completed_at > now() - interval '1 day') as discovery_blocked_jobs_today`,
    [[...MINER_SOURCES], [...SYNTHETIC_SOURCES]],
  );
  const row = rows[0]!;
  const number = (key: string): number => Number(row[key] ?? 0);

  const { availableDiscoveryAdapters } = await import('../workers/marketMiner.js');

  return {
    active: number('active'),
    queued: number('queued'),
    failed: number('failed'),
    discoveredByMinerToday: number('discovered_by_miner_today'),
    importedToday: number('imported_today'),
    syntheticSeededToday: number('synthetic_seeded_today'),
    manuallyAddedToday: number('manually_added_today'),
    createdTodayTotal: number('created_today_total'),
    refreshedByWorkerToday: number('refreshed_by_worker_today'),
    freshTimestampToday: number('fresh_timestamp_today'),
    discoveryAvailable: availableDiscoveryAdapters().length > 0,
    discoveryBlockedJobsToday: number('discovery_blocked_jobs_today'),
  };
}

export async function miningJobs() {
  const { rows } = await query(
    `select j.job_id, j.job_type, j.status, j.outcome, j.outcome_reason,
            j.created_at, j.started_at, j.completed_at,
            j.attempts, j.max_attempts, j.last_error, j.progress,
            coalesce((j.progress->>'discoveredNew')::int, 0) as discovered_new,
            coalesce((j.progress->>'refreshQueued')::int, 0) as refresh_queued,
            coalesce((j.progress->>'discoveryAvailable')::boolean, false) as discovery_available,
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
