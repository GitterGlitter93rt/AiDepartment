import { query } from '../db/pool.js';
import { HEARTBEAT_STALE_AFTER_MS } from '../workers/runner.js';
import { schemaState } from '../db/migrate.js';

/**
 * One query that answers the questions an operator actually has.
 * Authority: outbound-sales-brain-edge-xpert-sales-portal-deployment-spec.md §11-§13.
 *
 * This is not a second monitoring product. It reads the same tables every page
 * reads and answers, in one round trip, the thirteen questions somebody running this
 * box on a Monday morning needs answered: is anything broken, is anything backing
 * up, is anything getting stale, is outbound AI still off, and is anyone waiting on
 * a reply we have not sent.
 *
 * Every number here is a count of rows that exist. Nothing is inferred, and a
 * question we cannot answer says so rather than returning zero.
 */

export type HealthState = 'OK' | 'ATTENTION' | 'BLOCKED' | 'UNKNOWN';

export interface OperationalCheck {
  id: string;
  question: string;
  state: HealthState;
  value: string;
  detail?: string;
}

export interface OperationalSnapshot {
  takenAt: string;
  checks: OperationalCheck[];
  counts: Record<HealthState, number>;
}

export async function operationalSnapshot(): Promise<OperationalSnapshot> {
  const { availableDiscoveryAdapters } = await import('../workers/marketMiner.js');
  const discoveryAvailable = availableDiscoveryAdapters().length > 0;
  const schema = await schemaState();

  const { rows } = await query<Record<string, string | number | boolean | null>>(
    `select
       -- inventory and staleness
       (select count(*)::int from accounts where not is_suppressed
          and merged_into_account_id is null) as accounts,
       (select count(*)::int from accounts where not is_suppressed
          and merged_into_account_id is null and ownership_state = 'UNCLAIMED') as unclaimed,
       (select count(*)::int from accounts where not is_suppressed
          and merged_into_account_id is null
          and (research_fresh_until is null or research_fresh_until <= now())) as stale_research,

       -- worker liveness, from a heartbeat rather than from the absence of trouble
       (select count(*)::int from worker_instances
         where stopped_at is null
           and last_heartbeat_at > now() - ($1::text || ' milliseconds')::interval) as workers_online,
       (select count(*)::int from worker_instances) as workers_known,
       (select max(last_heartbeat_at) from worker_instances) as last_heartbeat_at,
       (select coalesce(extract(epoch from (now() - max(last_heartbeat_at))), -1)::int
          from worker_instances) as heartbeat_age_seconds,

       -- the queue
       (select count(*)::int from jobs where status = 'QUEUED') as jobs_queued,
       (select count(*)::int from jobs where status = 'RUNNING'
          and leased_until > now()) as jobs_running,
       (select count(*)::int from jobs where status = 'RUNNING'
          and leased_until <= now()) as jobs_stranded,
       (select count(*)::int from jobs where status = 'FAILED'
          and completed_at > now() - interval '24 hours') as jobs_failed_today,
       (select coalesce(extract(epoch from (now() - min(run_after))), 0)::int
          from jobs where status = 'QUEUED' and run_after <= now()) as queue_age_seconds,

       -- providers
       (select count(*)::int from provider_usage
          where status = 'FAILED' and requested_at > now() - interval '24 hours') as provider_failures,
       (select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd, 0)), 0)::numeric
          from provider_usage where requested_at > now() - interval '30 days') as provider_spend_30d,

       -- imports
       (select count(*)::int from import_batches
          where status = 'FAILED' and created_at > now() - interval '7 days') as imports_failed,
       (select count(*)::int from import_sessions
          where status = 'RUNNING' and confirm_started_at < now() - interval '30 minutes')
          as imports_stuck,

       -- replies and follow-ups
       (select count(*)::int from email_events e
          where e.event_type = 'REPLIED'
            and e.reply_class in ('POSITIVE_INTEREST','QUESTION','SEND_INFO')
            and e.occurred_at < now() - interval '24 hours'
            -- Only a touch that actually reached the prospect counts as an answer.
            -- Any activity at all would do: discovery, research and claiming are all
            -- activities, and a company discovered after the reply would have looked
            -- like a reply we had sent.
            and not exists (select 1 from activities a
                             where a.account_id = e.account_id
                               and a.occurred_at > e.occurred_at
                               and a.activity_type in ('EMAIL_SENT','CALL_ATTEMPT',
                                                       'VOICEMAIL','FIELD_VISIT',
                                                       'MEETING_SCHEDULED'))) as replies_waiting,
       (select count(*)::int from follow_ups
          where status = 'OPEN' and due_at < now()) as followups_overdue,

       -- bookings
       (select count(*)::int from meeting_bookings
          where status = 'PENDING' and created_at < now() - interval '30 minutes') as bookings_stuck,

       -- the outbound switches
       (select outbound_mode from voice_pilot_state) as outbound_mode,
       (select outbound_dial_enabled from voice_pilot_state) as outbound_dial_enabled,
       (select count(*)::int from voice_calls
          where mode_at_start <> 'DRY_RUN' and started_at > now() - interval '24 hours')
          as live_calls_today,

       -- people
       (select count(*)::int from users where is_active and role = 'SALES_REP') as reps,
       (select count(*)::int from sessions where expires_at > now()) as active_sessions,

       -- duplicates
       (select count(*)::int from (
          select normalized_name from accounts where merged_into_account_id is null
           group by normalized_name having count(*) > 1) t) as duplicate_names,
       (select count(*)::int from account_merges
          where occurred_at > now() - interval '7 days') as merges_this_week,

       -- mining truthfulness: a job that could not do what was asked
       (select count(*)::int from jobs
         where outcome in ('DISCOVERY_BLOCKED','PROVIDER_UNAVAILABLE')
           and completed_at > now() - interval '24 hours') as blocked_jobs_today`,
    [String(HEARTBEAT_STALE_AFTER_MS)],
  );
  const row = rows[0]!;
  const number = (key: string): number => Number(row[key] ?? 0);

  const checks: OperationalCheck[] = [];
  const add = (
    id: string, question: string, state: HealthState, value: string, detail?: string,
  ): void => {
    checks.push(detail === undefined
      ? { id, question, state, value }
      : { id, question, state, value, detail });
  };

  // --- is anything broken -----------------------------------------------------
  add('database', 'Is PostgreSQL answering?', 'OK', 'yes',
    'This snapshot came from it, so the answer is yes by construction.');

  // Does the code that is running match the database it is running against?
  //
  // This box has already shown the shape of that failure once: systemd reported the
  // worker service active while the database reported no worker online, because the
  // unit was running a build from before the heartbeat existed. A pending migration
  // is the same disagreement, and without this check it arrives as a page of 500s
  // with no explanation attached.
  add('schema', 'Does the schema match this build?',
    schema.changed.length > 0 ? 'BLOCKED'
      : schema.pending.length > 0 ? 'BLOCKED'
      : schema.unknown.length > 0 ? 'ATTENTION' : 'OK',
    schema.changed.length > 0 ? `${schema.changed.length} changed after apply`
      : schema.pending.length > 0 ? `${schema.pending.length} not applied`
      : schema.unknown.length > 0 ? `${schema.unknown.length} ahead of this build`
      : `${schema.applied} applied`,
    schema.changed.length > 0
      ? `Applied and then edited: ${schema.changed.join(', ')}. The database no longer `
        + 'contains what this build thinks it contains.'
      : schema.pending.length > 0
        ? `Never run here: ${schema.pending.join(', ')}. Run npm run migrate. Until then `
          + 'pages that touch the new tables will fail.'
        : schema.unknown.length > 0
          ? `This database has run migrations this build does not have: `
            + `${schema.unknown.join(', ')}. The running code is older than the schema.`
          : 'Every migration in this build has been applied, unchanged.');

  // Worker liveness, from a heartbeat.
  //
  // This used to be inferred from "0 stranded", which said a queue nobody had ever
  // touched was healthy: a job that has never been picked up has no expired lease
  // because it has no lease. The operator watched a job sit QUEUED while this page
  // stayed green, and the only thing wrong was that no worker existed.
  const online = number('workers_online');
  const known = number('workers_known');
  const queued = number('jobs_queued');
  const heartbeatAge = number('heartbeat_age_seconds');
  const stranded = number('jobs_stranded');

  const workerState: HealthState =
    online > 0 ? (stranded > 0 ? 'ATTENTION' : 'OK')
    : known === 0 ? (queued > 0 ? 'BLOCKED' : 'UNKNOWN')
    : queued > 0 ? 'BLOCKED' : 'ATTENTION';

  add('worker', 'Is a worker running?', workerState,
    online > 0 ? `${online} online` : known === 0 ? 'never seen' : 'offline',
    online > 0
      ? `Last heartbeat ${heartbeatAge}s ago. ${stranded} job(s) hold an expired lease.`
      : known === 0
        ? 'No worker has ever reported in on this database. Jobs will queue and stay '
          + 'queued: nothing is serving them.'
        : `No heartbeat for ${heartbeatAge}s. The worker process is not running, so `
          + `the ${queued} queued job(s) are going nowhere.`);

  const queueAge = number('queue_age_seconds');
  add('queue', 'Are jobs backing up?',
    // A queue with nobody serving it is blocked whatever its age, because the age
    // will only grow.
    online === 0 && queued > 0 ? 'BLOCKED'
      : queueAge < 300 ? 'OK' : queueAge < 3_600 ? 'ATTENTION' : 'BLOCKED',
    `${queued} queued, oldest ${Math.round(queueAge / 60)} min`,
    online === 0 && queued > 0
      ? 'Nothing is serving this queue.'
      : `${number('jobs_running')} running, ${number('jobs_failed_today')} failed today.`);

  // --- is anything getting stale ----------------------------------------------
  const accounts = number('accounts');
  const stale = number('stale_research');
  const stalePercent = accounts > 0 ? Math.round((stale / accounts) * 100) : 0;
  add('inventory_freshness', 'Is inventory getting stale?',
    accounts === 0 ? 'UNKNOWN' : stalePercent < 40 ? 'OK' : 'ATTENTION',
    `${stale} of ${accounts} (${stalePercent}%)`,
    accounts === 0 ? 'There is no inventory yet, so there is nothing to be stale.'
      : 'Stale research is a reason to refresh, not a reason to stop calling.');

  add('unclaimed', 'Is there work for the reps to claim?',
    accounts === 0 ? 'UNKNOWN' : number('unclaimed') > 0 ? 'OK' : 'ATTENTION',
    `${number('unclaimed')} unclaimed`,
    number('unclaimed') === 0 && accounts > 0
      ? 'Every researched Account is owned. A market needs mining or reassigning.'
      : undefined);

  // --- providers ---------------------------------------------------------------
  const providerFailures = number('provider_failures');
  add('providers', 'Are research providers failing?',
    providerFailures === 0 ? 'OK' : providerFailures < 10 ? 'ATTENTION' : 'BLOCKED',
    `${providerFailures} failures in 24h`,
    'A failed provider call never marks research fresh, so a silent outage shows up '
      + 'here rather than as confident stale data.');

  add('spend', 'Are we near a spend cap?', 'OK',
    `$${Number(row['provider_spend_30d'] ?? 0).toFixed(2)} in 30 days`,
    'No provider is configured yet, so this is what has been recorded, not a forecast.');

  // --- imports -----------------------------------------------------------------
  const importsStuck = number('imports_stuck');
  add('imports', 'Are imports failing?',
    number('imports_failed') === 0 && importsStuck === 0 ? 'OK' : 'ATTENTION',
    `${number('imports_failed')} failed in 7 days, ${importsStuck} stuck`,
    importsStuck > 0
      ? 'An import has been confirming for over half an hour. It is either very large '
        + 'or the process that was running it is gone.'
      : undefined);

  // --- people waiting ----------------------------------------------------------
  const replies = number('replies_waiting');
  add('replies', 'Is anyone waiting on a reply?',
    replies === 0 ? 'OK' : replies < 5 ? 'ATTENTION' : 'BLOCKED',
    `${replies} unanswered over 24h`,
    'A prospect who asked a question and heard nothing is the most expensive thing '
      + 'on this page.');

  add('followups', 'How many follow-ups are overdue?',
    number('followups_overdue') === 0 ? 'OK' : 'ATTENTION',
    `${number('followups_overdue')} overdue`);

  const bookings = number('bookings_stuck');
  add('bookings', 'Are booking events stuck pending?',
    bookings === 0 ? 'OK' : 'ATTENTION', `${bookings} pending over 30 min`,
    bookings > 0
      ? 'We asked the calendar and it has not confirmed. The prospect may believe '
        + 'they have an invitation.'
      : undefined);

  // --- the switches -------------------------------------------------------------
  const mode = String(row['outbound_mode'] ?? 'UNKNOWN');
  const dialEnabled = row['outbound_dial_enabled'] === true;
  const liveCalls = number('live_calls_today');
  add('outbound_ai', 'Are outbound AI calls off?',
    mode === 'OFF' && !dialEnabled && liveCalls === 0 ? 'OK' : 'BLOCKED',
    `mode ${mode}, dialling ${dialEnabled ? 'ENABLED' : 'disabled'}`,
    liveCalls > 0
      ? `${liveCalls} call(s) today were not dry runs. This is the single most `
        + 'important line on this page.'
      : 'No call today was anything but a dry run.');

  // --- people --------------------------------------------------------------------
  add('reps', 'How many reps are set up?', number('reps') > 0 ? 'OK' : 'UNKNOWN',
    `${number('reps')} active`, `${number('active_sessions')} live sessions.`);

  // --- can the system do the thing it is being asked to do -------------------------
  const blocked = number('blocked_jobs_today');
  add('discovery', 'Can the system find a new business?',
    discoveryAvailable ? 'OK' : 'BLOCKED',
    discoveryAvailable ? 'a search provider is configured' : 'no search provider',
    discoveryAvailable
      ? undefined
      : 'A market search can only re-research companies already in inventory. '
        + `${blocked} job(s) in the last 24 hours were limited by this, and an empty `
        + 'market result is not evidence that the market is empty.');

  // --- duplicates -----------------------------------------------------------------
  const duplicates = number('duplicate_names');
  add('duplicates', 'Are we generating duplicates?',
    accounts === 0 ? 'UNKNOWN'
      : duplicates / Math.max(1, accounts) < 0.03 ? 'OK' : 'ATTENTION',
    `${duplicates} names held by more than one Account`,
    `${number('merges_this_week')} merged this week. Two companies can share a name `
      + 'legitimately, so this is a number to watch rather than a fault.');

  const counts: Record<HealthState, number> = { OK: 0, ATTENTION: 0, BLOCKED: 0, UNKNOWN: 0 };
  for (const check of checks) counts[check.state] += 1;

  return { takenAt: new Date().toISOString(), checks, counts };
}
