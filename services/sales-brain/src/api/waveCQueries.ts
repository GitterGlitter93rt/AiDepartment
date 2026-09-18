import {
  automatedDiscoveryPredicate,
  SYNTHETIC_SOURCES as SYNTHETIC_SOURCES_LIST,
} from '../domain/discoverySources.js';
import { query } from '../db/pool.js';

/** Read models for the Wave C operations pages. */

/**
 * Where an Account came from, for the Mining page.
 *
 * These are the `source_system` values written on the DISCOVERED activity when an
 * Account is first created. A miner discovery is the only one of them that is
 * mining output; the rest are a rep, a spreadsheet, or a fixture.
 */
/**
 * Which activities count as mining output.
 *
 * Read from the shared source list rather than restated here. This file had its own
 * copy, and when business listings became a second discovery source the copy did not
 * know: a company a provider found was counted as "created another way", which on
 * the Mining page reads as somebody having typed it in by hand. The miner looked
 * idle and a person looked busy, and both were false.
 */
export {
  AUTOMATED_DISCOVERY_EXACT as MINER_SOURCES,
  SYNTHETIC_SOURCES,
} from '../domain/discoverySources.js';

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
           and ${automatedDiscoveryPredicate('act.source_system')}) as discovered_by_miner_today,
       (select count(distinct act.account_id)::int from activities act
         where act.activity_type = 'DISCOVERED'
           and act.occurred_at > now() - interval '1 day'
           and act.source_system = 'import') as imported_today,
       (select count(distinct act.account_id)::int from activities act
         where act.activity_type = 'DISCOVERED'
           and act.occurred_at > now() - interval '1 day'
           and act.source_system = any($1::text[])) as synthetic_seeded_today,
       (select count(*)::int from accounts a
         where a.created_at > now() - interval '1 day'
           and not exists (select 1 from activities act
                            where act.account_id = a.account_id
                              and act.activity_type = 'DISCOVERED'
                              and (${automatedDiscoveryPredicate('act.source_system')}
                                or act.source_system = 'import'
                                or act.source_system = any($1::text[])))) as manually_added_today,
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
    // The automated-source test is built from the shared list rather than passed in,
    // so the two callers cannot drift apart again. Only the synthetic list is still a
    // parameter, and an unreferenced one would leave PostgreSQL unable to infer its
    // type at all.
    [[...SYNTHETIC_SOURCES_LIST]],
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
            -- The funnel between what the provider sent and what reached inventory.
            -- Without these four the Mining page shows one number an operator cannot
            -- check: "provider returned 50 rows" is not "50 businesses discovered".
            coalesce((j.progress->>'providerRows')::int, 0) as provider_rows,
            coalesce((j.progress->>'providerDuplicates')::int, 0) as provider_duplicates,
            coalesce((j.progress->>'rejectedRows')::int, 0) as rejected_rows,
            coalesce((j.progress->>'matchedExisting')::int, 0) as matched_existing,
            coalesce((j.progress->>'researchQueued')::int, 0) as research_queued,
            (j.progress->>'costUsd')::numeric as cost_usd,
            j.payload->>'vertical_profile_id' as vertical_profile_id,
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
     /*
      * "Website research unavailable", and never "broken website".
      *
      * This row used to be typed broken_website, which the page rendered as "Broken
      * Website" over the sentence "no page could be read on the last attempt". Those are
      * two different claims and only the second one is ours to make. Michael opened
      * three of them in a browser -- energyair.com, airmotionshvac.com, airworthac.com --
      * and every one was a live business site. One served 634 KB of HVAC content and was
      * discarded because its script manifest contains the word "captcha"; the other two
      * answered 403, which is a WAF refusing this crawler rather than a company without
      * a website.
      *
      * So the exception says what happened to us, and carries the reason the run
      * recorded, so a person reading it can tell a refusal from a dead domain.
      */
     (select a.account_id, a.canonical_name,
             'website_research_unavailable',
             'Sales Brain could not read this website on the last attempt'
               || case
                    when r.adapter_results->>'source_state' = 'REFUSED'
                      then ': the site refused our crawler'
                    when r.adapter_results->>'source_state' = 'UNREACHABLE'
                      then ': the site could not be reached'
                    when r.adapter_results->>'source_state' = 'HTTP_ERROR'
                      then ': the site answered with an error'
                    when r.adapter_results->>'source_state' = 'DISALLOWED'
                      then ': robots.txt asks us not to read it'
                    else ''
                  end
               || coalesce(' (' || (r.adapter_results->'blocked_pages'->0->>'reason') || ')', '')
               || '. That is a fact about our research, not about the company.'
               /*
                * And what is being done about it.
                *
                * An operator reading "we could not read this" has one question --
                * are we trying again? -- and until V3 the answer was no, silently,
                * for ever. A campaign says which attempt it is on and when the next
                * one is, so the row describes work in progress rather than a dead end.
                */
               || coalesce(
                    case c.state
                      when 'ACTIVE' then ' Attempt ' || c.attempts_made || ' of '
                        || c.max_attempts || '; next retry in '
                        || greatest(0, round(extract(epoch from (c.next_attempt_at - now())) / 60))
                        || ' minutes.'
                      when 'EXHAUSTED' then ' Retried ' || c.attempts_made
                        || ' times over as many hours without success; now being '
                        || 'researched from other public sources.'
                      when 'DISALLOWED' then ' robots.txt asks us not to, so we stopped '
                        || 'asking and are using other public sources.'
                      when 'TERMINAL' then ' Every candidate host answers 404, so we are '
                        || 'looking for where the company went.'
                      else null
                    end, ''),
             r.started_at
        from accounts a
        join research_runs r on r.account_id = a.account_id
        left join website_recovery_campaigns c on c.account_id = a.account_id
             and c.campaign_id = (select c2.campaign_id from website_recovery_campaigns c2
                                   where c2.account_id = a.account_id
                                   order by c2.started_at desc limit 1)
       where a.canonical_domain is not null and r.status = 'partial'
         and coalesce(c.state, '') <> 'RECOVERED'
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

/**
 * Website recovery, as an operator needs to read it.
 *
 * Separate from `researchExceptions` because a campaign in progress is not an exception:
 * it is work happening. A recovered site is not an exception either, and showing it as
 * one is how "we could not read this" came to look permanent.
 */
export async function websiteRecoveryStatus(): Promise<{
  active: number; recovered: number; exhausted: number; disallowed: number;
  terminal: number; recoveredByVariant: { variant: string; n: number }[];
  dueWithin60Minutes: number;
}> {
  const { rows } = await query<{ state: string; n: string }>(
    `select state, count(*)::text as n from website_recovery_campaigns group by state`);
  const by = new Map(rows.map((r) => [r.state, Number(r.n)]));

  const variants = await query<{ variant: string; n: string }>(
    `select a.variant, count(*)::text as n
       from website_recovery_attempts a
       join website_recovery_campaigns c on c.campaign_id = a.campaign_id
      where c.state = 'RECOVERED' and a.source_state = 'READ'
      group by a.variant order by 2 desc`);

  const due = await query<{ n: string }>(
    `select count(*)::text as n from website_recovery_campaigns
      where state = 'ACTIVE' and next_attempt_at <= now() + interval '60 minutes'`);

  return {
    active: by.get('ACTIVE') ?? 0,
    recovered: by.get('RECOVERED') ?? 0,
    exhausted: by.get('EXHAUSTED') ?? 0,
    disallowed: by.get('DISALLOWED') ?? 0,
    terminal: by.get('TERMINAL') ?? 0,
    recoveredByVariant: variants.rows.map((r) => ({ variant: r.variant, n: Number(r.n) })),
    dueWithin60Minutes: Number(due.rows[0]?.n ?? 0),
  };
}
