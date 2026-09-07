import { query } from '../db/pool.js';
import { buildIdentity } from './identity.js';
import { schemaState } from '../db/migrate.js';
import { redactSecrets } from '../workers/redaction.js';

/**
 * Where it broke, rather than a wall of numbers.
 *
 * The live canary will fail the first time in a way nobody predicted, and the
 * question in that moment is always the same: is this the API and the worker running
 * different builds, a queue nobody is serving, a provider that owes us an answer, a
 * collection that failed, an ingestion that dropped everything, research that never
 * ran, scoring that never ran, or a page reading a projection that has not caught up?
 *
 * Those are eight different next actions and the numbers alone do not choose between
 * them. This captures the state and then says which of the eight the state looks
 * like -- and says "nothing here explains it" when it cannot tell, because a
 * diagnosis invented from insufficient evidence is worse than none.
 *
 * Two rules on content: no credentials, and no raw provider bodies. An operator
 * pastes this into a chat window when something is wrong.
 */

export interface Diagnostics {
  takenAt: string;
  build: { api: string; workers: string[]; migrationsExpected: number | null };
  schema: { applied: number; pending: string[]; changed: string[]; unknown: string[] };
  workers: {
    online: number; known: number; draining: number;
    lastHeartbeatSecondsAgo: number | null;
  };
  queue: {
    queued: number; running: number; failed24h: number;
    oldestQueuedSeconds: number | null;
    byType: { jobType: string; status: string; n: number }[];
  };
  providerTasks: { status: string; n: number; oldestHours: number }[];
  savedMarkets: {
    enabled: number; due: number; blocked: number; withConsecutiveFailures: number;
  };
  spend: { todayUsd: number; estimatedPortionUsd: number; runsToday: number };
  research: {
    accountsTotal: number; neverResearched: number; researchedFresh: number;
    researchJobsQueued: number; researchJobsFailed24h: number; strandedNoResearch: number;
  };
  scoring: { scored: number; unscored: number; underOldPolicy: number };
  readiness: { sampled: number; repReady: number; researchNeeded: number; notWorkable: number };
}

export interface Diagnosis {
  /** Which layer the state looks like it broke in, or null when nothing explains it. */
  category:
    | 'BUILD_SKEW' | 'QUEUE_STARVED' | 'PROVIDER_PENDING' | 'COLLECTION_FAILED'
    | 'INGESTION_DROPPED' | 'RESEARCH_FAILED' | 'SCORING_FAILED' | 'PROJECTION_STALE'
    | 'HEALTHY' | 'UNEXPLAINED';
  finding: string;
  /** What to do about it. */
  action: string;
}

export async function captureDiagnostics(): Promise<Diagnostics> {
  const identity = buildIdentity();
  const schema = await schemaState();

  const { rows: workerRows } = await query<{
    online: number; known: number; draining: number; last_seconds: number | null;
    builds: string | null;
  }>(
    `select count(*) filter (where stopped_at is null
              and last_heartbeat_at > now() - interval '45 seconds')::int as online,
            count(*)::int as known,
            count(*) filter (where draining_since is not null and stopped_at is null)::int
              as draining,
            extract(epoch from (now() - max(last_heartbeat_at)))::int as last_seconds,
            string_agg(distinct coalesce(build_sha, 'unknown'), ',') as builds
       from worker_instances`);
  const worker = workerRows[0]!;

  const { rows: queueRows } = await query<{
    queued: number; running: number; failed: number; oldest: number | null;
  }>(
    `select count(*) filter (where status = 'QUEUED')::int as queued,
            count(*) filter (where status = 'RUNNING')::int as running,
            count(*) filter (where status = 'FAILED'
              and completed_at > now() - interval '1 day')::int as failed,
            (select extract(epoch from (now() - min(run_after)))::int from jobs
              where status = 'QUEUED' and run_after <= now()) as oldest
       from jobs`);

  const { rows: byType } = await query<{ job_type: string; status: string; n: number }>(
    `select job_type, status, count(*)::int as n from jobs
      where created_at > now() - interval '1 day'
      group by job_type, status order by job_type, status`);

  const { rows: taskRows } = await query<{ status: string; n: number; oldest: number }>(
    `select status, count(*)::int as n,
            coalesce(max(extract(epoch from (now() - submitted_at)) / 3600), 0)::int as oldest
       from provider_tasks group by status order by status`);

  const { rows: marketRows } = await query<{
    enabled: number; due: number; blocked: number; failing: number;
  }>(
    `select count(*) filter (where enabled)::int as enabled,
            count(*) filter (where enabled and (next_refresh_at is null
              or next_refresh_at <= now()))::int as due,
            count(*) filter (where blocker_reason is not null)::int as blocked,
            count(*) filter (where coalesce(consecutive_failures, 0) > 0)::int as failing
       from saved_markets`);

  const { rows: spendRows } = await query<{
    total: string; estimated: string; runs: number;
  }>(
    `select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0)::text as total,
            coalesce(sum(case when actual_cost_usd is null
                              then estimated_cost_usd else 0 end), 0)::text as estimated,
            count(*)::int as runs
       from provider_usage where requested_at >= date_trunc('day', now())`);

  const { strandedResearchCount } = await import('../workers/researchReconcile.js');
  const { rows: researchRows } = await query<{
    total: number; never: number; fresh: number; queued: number; failed: number;
  }>(
    `select count(*)::int as total,
            count(*) filter (where last_researched_at is null)::int as never,
            count(*) filter (where research_fresh_until > now())::int as fresh,
            (select count(*)::int from jobs
              where job_type in ('account_research','contact_research')
                and status in ('QUEUED','RUNNING')) as queued,
            (select count(*)::int from jobs
              where job_type in ('account_research','contact_research')
                and status = 'FAILED' and completed_at > now() - interval '1 day') as failed
       from accounts where merged_into_account_id is null`);

  const { SCORE_VERSION } = await import('../scoring/model.js');
  const { rows: scoreRows } = await query<{ scored: number; unscored: number; old: number }>(
    `select count(*) filter (where manual_tier is not null)::int as scored,
            count(*) filter (where manual_tier is null)::int as unscored,
            count(*) filter (where manual_tier is not null
              and (score_version is null or score_version <> $1))::int as old
       from accounts where merged_into_account_id is null and not is_suppressed`,
    [SCORE_VERSION]);

  // Readiness is per-Account work, so a sample rather than the whole table: the
  // question here is "does anything come out rep-ready", not an exact census.
  const { rows: sampleRows } = await query<{ account_id: string }>(
    `select account_id from accounts
      where merged_into_account_id is null and not is_suppressed
      order by updated_at desc limit 25`);
  const { readinessFor } = await import('../domain/repReady.js');
  const readiness = { sampled: 0, repReady: 0, researchNeeded: 0, notWorkable: 0 };
  for (const row of sampleRows) {
    const state = await readinessFor(row.account_id);
    if (!state) continue;
    readiness.sampled += 1;
    if (state.state === 'REP_READY') readiness.repReady += 1;
    else if (state.state === 'NOT_WORKABLE') readiness.notWorkable += 1;
    else readiness.researchNeeded += 1;
  }

  return {
    takenAt: new Date().toISOString(),
    build: {
      api: identity.sha,
      workers: (worker.builds ?? '').split(',').filter(Boolean),
      migrationsExpected: identity.migrationsExpected,
    },
    schema: {
      applied: schema.applied, pending: schema.pending,
      changed: schema.changed, unknown: schema.unknown,
    },
    workers: {
      online: worker.online, known: worker.known, draining: worker.draining,
      lastHeartbeatSecondsAgo: worker.last_seconds,
    },
    queue: {
      queued: queueRows[0]!.queued, running: queueRows[0]!.running,
      failed24h: queueRows[0]!.failed, oldestQueuedSeconds: queueRows[0]!.oldest,
      byType: byType.map((row) => ({ jobType: row.job_type, status: row.status, n: row.n })),
    },
    providerTasks: taskRows.map((row) => ({
      status: row.status, n: row.n, oldestHours: row.oldest,
    })),
    savedMarkets: {
      enabled: marketRows[0]!.enabled, due: marketRows[0]!.due,
      blocked: marketRows[0]!.blocked,
      withConsecutiveFailures: marketRows[0]!.failing,
    },
    spend: {
      todayUsd: Number(spendRows[0]!.total),
      estimatedPortionUsd: Number(spendRows[0]!.estimated),
      runsToday: spendRows[0]!.runs,
    },
    research: {
      accountsTotal: researchRows[0]!.total,
      neverResearched: researchRows[0]!.never,
      researchedFresh: researchRows[0]!.fresh,
      researchJobsQueued: researchRows[0]!.queued,
      researchJobsFailed24h: researchRows[0]!.failed,
      strandedNoResearch: await strandedResearchCount(),
    },
    scoring: {
      scored: scoreRows[0]!.scored, unscored: scoreRows[0]!.unscored,
      underOldPolicy: scoreRows[0]!.old,
    },
    readiness,
  };
}

/**
 * Which of the eight layers the state looks like it broke in.
 *
 * Ordered so a cause is named before its symptoms. A queue nobody serves also looks
 * like research that never ran, and telling an operator to investigate research when
 * no worker is running sends them to the wrong place entirely.
 */
export function diagnose(state: Diagnostics): Diagnosis[] {
  const found: Diagnosis[] = [];

  if (state.schema.pending.length > 0 || state.schema.changed.length > 0) {
    found.push({
      category: 'BUILD_SKEW',
      finding: state.schema.changed.length > 0
        ? `Migrations were applied and then edited: ${state.schema.changed.join(', ')}. `
          + 'The database no longer holds what this build believes it holds.'
        : `${state.schema.pending.length} migration(s) have never run here.`,
      action: 'Run npm run migrate before trusting anything else in this report.',
    });
  }

  if (state.build.migrationsExpected === null) {
    found.push({
      category: 'BUILD_SKEW',
      finding: 'This build could not count the migrations it ships, so nothing here '
        + 'can say whether the database is up to date. A deploy that copied dist/ '
        + 'without migrations/ looks exactly like this.',
      action: 'Check that the migrations directory shipped alongside the build.',
    });
  }

  const otherBuilds = state.build.workers.filter((sha) => sha !== state.build.api);
  if (state.build.workers.length > 0 && otherBuilds.length > 0) {
    found.push({
      category: 'BUILD_SKEW',
      finding: `This API is ${state.build.api} and the worker(s) are `
        + `${state.build.workers.join(', ')}. A page can read a column the worker `
        + 'never writes, or queue a job it cannot run.',
      action: 'Restart whichever process is behind, then take this report again.',
    });
  }

  if (state.workers.online === 0 && (state.queue.queued > 0 || state.queue.running > 0)) {
    found.push({
      category: 'QUEUE_STARVED',
      finding: `${state.queue.queued} job(s) are queued and no worker has heartbeated `
        + `${state.workers.lastHeartbeatSecondsAgo === null
          ? 'ever' : `in ${state.workers.lastHeartbeatSecondsAgo} second(s)`}. Nothing `
        + 'below this line is a fault in the miner: none of it has run.',
      action: 'Start the worker (./deploy/stack.sh start), then take this report again.',
    });
  } else if (state.workers.draining > 0 && state.queue.queued > 0) {
    found.push({
      category: 'QUEUE_STARVED',
      finding: `${state.workers.draining} worker(s) are draining and taking no new work `
        + `while ${state.queue.queued} job(s) wait.`,
      action: 'Finish the restart, or start another worker.',
    });
  }

  const pending = state.providerTasks.find((task) => task.status === 'PENDING');
  if (pending && pending.n > 0) {
    found.push({
      category: pending.oldestHours > 24 ? 'COLLECTION_FAILED' : 'PROVIDER_PENDING',
      finding: pending.oldestHours > 24
        ? `${pending.n} provider task(s) have been outstanding for up to `
          + `${pending.oldestHours} hours. These were paid for and never read.`
        : `${pending.n} provider task(s) are outstanding: the provider has accepted `
          + 'the searches and not answered yet.',
      action: pending.oldestHours > 24
        ? 'Check the provider task log for collection errors; the next run collects '
          + 'rather than re-buys, and gives up after the poll ceiling.'
        : 'Wait for the next worker cycle; it collects before it submits.',
    });
  }

  const failedTasks = state.providerTasks.find((task) => task.status === 'FAILED');
  if (failedTasks && failedTasks.n > 0) {
    found.push({
      category: 'COLLECTION_FAILED',
      finding: `${failedTasks.n} provider task(s) failed.`,
      action: 'Read the error codes on provider_tasks; a credential or rate-limit '
        + 'failure is a different fix from a malformed response.',
    });
  }

  if (state.research.strandedNoResearch > 0) {
    found.push({
      category: 'RESEARCH_FAILED',
      finding: `${state.research.strandedNoResearch} discovered compan(ies) have never `
        + 'been researched and have nothing queued. They are a name and a URL until '
        + 'the sweep picks them up.',
      action: 'The worker sweep runs every fifteen minutes and will queue them. If the '
        + 'count is not falling, look at why research jobs are failing.',
    });
  }
  if (state.research.researchJobsFailed24h > 0) {
    found.push({
      category: 'RESEARCH_FAILED',
      finding: `${state.research.researchJobsFailed24h} research job(s) failed in the `
        + 'last day.',
      action: 'Read jobs.last_error for those rows. A blocked website is expected and '
        + 'recorded; a thrown error is not.',
    });
  }

  if (state.scoring.unscored > 0 && state.research.researchedFresh > 0) {
    found.push({
      category: 'SCORING_FAILED',
      finding: `${state.scoring.unscored} Account(s) have no tier while `
        + `${state.research.researchedFresh} have fresh research. A researched company `
        + 'with no score is not ranked, so a rep never sees it.',
      action: 'The worker back-fills these on its sweep. If the count is static, look '
        + 'at the scoring step of the research job.',
    });
  }
  if (state.scoring.underOldPolicy > 0) {
    found.push({
      category: 'PROJECTION_STALE',
      finding: `${state.scoring.underOldPolicy} score(s) were produced under an older `
        + 'ruleset. Comparing two of them compares two policies.',
      action: 'The recompute sweep handles these. Nothing needs doing unless the count '
        + 'is not falling.',
    });
  }

  if (found.length === 0) {
    found.push({
      category: 'HEALTHY',
      finding: 'Nothing in the captured state looks broken.',
      action: 'If something is still wrong, the cause is not in this report — say what '
        + 'you saw and it becomes the next check to add.',
    });
  }
  return found;
}

/**
 * Ingestion is judged against a specific run, not against the whole database.
 *
 * "Rows came back and no Accounts appeared" is only a fault if it happened in *this*
 * run; a database with a million Accounts and a quiet day looks identical in
 * aggregate.
 */
export async function diagnoseRun(jobId: string): Promise<Diagnosis[]> {
  const { rows } = await query<{
    outcome: string | null; progress: Record<string, any>; status: string;
  }>('select outcome, progress, status from jobs where job_id = $1', [jobId]);
  const job = rows[0];
  if (!job) {
    return [{ category: 'UNEXPLAINED', finding: `No job ${jobId}.`,
      action: 'Check the job id.' }];
  }

  const progress = job.progress ?? {};
  const providerRows = Number(progress['providerRows'] ?? 0);
  const created = Number(progress['discoveredNew'] ?? 0);
  const matched = Number(progress['matchedExisting'] ?? 0);
  const excluded = Number(progress['excludedByVertical'] ?? 0);
  const rejected = Number(progress['rejectedRows'] ?? 0);

  const found: Diagnosis[] = [];
  if (providerRows > 0 && created === 0 && matched === 0 && excluded === 0 && rejected === 0) {
    found.push({
      category: 'INGESTION_DROPPED',
      finding: `The provider returned ${providerRows} row(s) and none of them became `
        + 'or matched an Account, and none was rejected or excluded. The rows went '
        + 'somewhere unaccounted for.',
      action: 'This is an ingestion fault rather than a thin market. Compare the '
        + 'funnel counters on the job with the provider row count.',
    });
  }
  if (providerRows > 0 && created === 0 && matched > 0) {
    found.push({
      category: 'HEALTHY',
      finding: `Every one of the ${matched} compan(ies) found was already in `
        + 'inventory. That is the market being covered, not an empty market.',
      action: 'Nothing to do.',
    });
  }
  if (job.outcome === 'DISCOVERY_BLOCKED') {
    found.push({
      category: 'UNEXPLAINED',
      finding: redactSecrets(String(progress['outcomeReason']
        ?? 'The search was blocked before it ran.')),
      action: 'The reason above names what to change: a credential, a budget, or a '
        + 'vertical.',
    });
  }
  return found.length > 0 ? found : [{
    category: 'HEALTHY', finding: 'This run looks ordinary.', action: 'Nothing to do.' }];
}

export function renderDiagnostics(state: Diagnostics, diagnoses: Diagnosis[]): string {
  const lines = ['', 'SALES BRAIN DOCTOR', `  taken ${state.takenAt}`, ''];

  lines.push('  what it looks like');
  for (const diagnosis of diagnoses) {
    lines.push(`     [${diagnosis.category}] ${diagnosis.finding}`);
    lines.push(`        -> ${diagnosis.action}`);
  }
  lines.push('');

  lines.push('  build');
  lines.push(`     api ${state.build.api}   worker(s) ${state.build.workers.join(', ') || 'none online'}`);
  lines.push(`     migrations applied ${state.schema.applied} of `
    + `${state.build.migrationsExpected ?? 'an unknown number this build could not count'}`
    + `${state.schema.pending.length > 0 ? `, ${state.schema.pending.length} pending` : ''}`);
  lines.push('  workers');
  lines.push(`     ${state.workers.online} online of ${state.workers.known} known`
    + `, ${state.workers.draining} draining`
    + `, ${state.workers.lastHeartbeatSecondsAgo === null
      ? 'no heartbeat ever recorded'
      : `last heartbeat ${state.workers.lastHeartbeatSecondsAgo}s ago`}`);
  lines.push('  queue');
  lines.push(`     ${state.queue.queued} queued, ${state.queue.running} running, `
    + `${state.queue.failed24h} failed today, oldest waiting `
    + `${state.queue.oldestQueuedSeconds ?? 0}s`);
  lines.push('  provider tasks');
  lines.push(state.providerTasks.length === 0 ? '     none'
    : state.providerTasks.map((task) =>
      `     ${task.status}: ${task.n} (oldest ${task.oldestHours}h)`).join('\n'));
  lines.push('  saved markets');
  lines.push(`     ${state.savedMarkets.enabled} enabled, ${state.savedMarkets.due} due, `
    + `${state.savedMarkets.blocked} blocked, `
    + `${state.savedMarkets.withConsecutiveFailures} failing`);
  lines.push('  spend today');
  lines.push(`     $${state.spend.todayUsd.toFixed(4)} across ${state.spend.runsToday} `
    + `provider call(s), $${state.spend.estimatedPortionUsd.toFixed(4)} of it estimated`);
  lines.push('  research');
  lines.push(`     ${state.research.accountsTotal} accounts, `
    + `${state.research.neverResearched} never researched, `
    + `${state.research.researchedFresh} fresh, `
    + `${state.research.researchJobsQueued} queued, `
    + `${state.research.researchJobsFailed24h} failed today, `
    + `${state.research.strandedNoResearch} stranded`);
  lines.push('  scoring');
  lines.push(`     ${state.scoring.scored} scored, ${state.scoring.unscored} unscored, `
    + `${state.scoring.underOldPolicy} under an older ruleset`);
  lines.push('  readiness (most recent 25)');
  lines.push(`     ${state.readiness.repReady} rep-ready, `
    + `${state.readiness.researchNeeded} research needed, `
    + `${state.readiness.notWorkable} not workable`);
  lines.push('');
  lines.push('  No credentials or provider response bodies appear in this report.');
  lines.push('');
  return lines.join('\n');
}
