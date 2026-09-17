import { hostname } from 'node:os';
import { buildIdentity } from '../release/identity.js';
import { config, numeric } from '../config.js';
import { pool, query, withTransaction } from '../db/pool.js';
import { redactSecrets, terminalFailureReason } from './redaction.js';

/**
 * Durable job runner over the Postgres job table.
 * Authority: outbound-sales-brain-job-queue-spec.md, deployment spec §11, §13.
 *
 * Leases rather than deletes, so a worker that dies mid-job releases its work when
 * the lease expires instead of losing it. Runs in its own process: heavy crawling
 * must never share a runtime with the realtime voice path.
 */

export interface JobRecord {
  job_id: string;
  job_type: string;
  payload: Record<string, any>;
  attempts: number;
  max_attempts: number;
  account_id: string | null;
  market_id: string | null;
  requested_by: string | null;
}

/**
 * What a job actually achieved, separate from whether the handler returned.
 *
 * A queue status answers "did this run". An operator looking at a mining page is
 * asking "did the thing I wanted happen", and those are different questions: a
 * market search with no discovery provider registered runs perfectly and discovers
 * nothing, and reporting that as SUCCEEDED is how a person concludes their market
 * has no businesses in it.
 */
export type JobOutcome =
  | 'COMPLETED'
  | 'DISCOVERY_BLOCKED'
  | 'PROVIDER_UNAVAILABLE'
  /** The provider accepted an asynchronous task; its results are not back yet. */
  | 'PROVIDER_PENDING'
  | 'PARTIAL'
  | 'NOTHING_TO_DO'
  | 'ZERO_RESULTS'
  /**
   * The saved market was switched off before a new search could be submitted, so
   * nothing was bought. Not a failure and not an empty market: our own decision,
   * taken after the run was already queued.
   */
  | 'MARKET_DISABLED'
  | 'FAILED';

/**
 * A handler may return an outcome and a reason alongside its progress. Anything that
 * does not is recorded as COMPLETED, which is the right default for work that has
 * only one way to succeed.
 */
export interface JobResult extends Record<string, unknown> {
  outcome?: JobOutcome;
  outcomeReason?: string;
}

export type JobHandler = (job: JobRecord) => Promise<JobResult | void>;

const handlers = new Map<string, JobHandler>();

export function registerHandler(jobType: string, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

/**
 * What this process can actually run.
 *
 * A handler registers as a side effect of importing its module, so a process that
 * forgets the import serves a queue it cannot empty -- and every symptom of that
 * appears somewhere other than the missing import. Exposed so the parity check can
 * compare what can be enqueued against what can be run, rather than trusting that
 * two entry points were kept in step by hand.
 */
export function registeredJobTypes(): string[] {
  return [...handlers.keys()].sort();
}

const workerId = `${hostname()}:${process.pid}`;

/**
 * How long a job waits before its age outranks a newer job's priority.
 *
 * Strict priority has no floor. `contact_research` is 40, `account_research` 50 and
 * `market_mine` 80, so every research job outranks every market search -- including
 * the research jobs that a market search itself creates, one per business it
 * discovers. A market refresh queued six hours ago loses to a research job enqueued a
 * second ago, and keeps losing for as long as research keeps arriving. That is not a
 * slow queue, it is a starved one, and the numbers make it self-sustaining: mining
 * generates the very work that outranks mining.
 *
 * It also puts two layers of this system in direct contradiction. The scheduler goes
 * to real trouble not to starve a market -- "the oldest attempt goes first, so no
 * market can starve behind a busier one" -- and then hands its jobs to a queue that
 * starves them anyway. Every individual pass looks correct: the scheduler queues, the
 * worker is busy, nothing fails, and the markets page shows work that is never done.
 *
 * So age is a tiebreaker of last resort rather than a reordering. Priority still
 * decides everything among jobs that are waiting a normal amount of time; only a job
 * that has been eligible for longer than this gets to go first, and among those,
 * priority applies again. A rep's research still goes ahead of a background refresh.
 * It just cannot do so for ever.
 */
export const JOB_STARVATION_AFTER_MS = numeric('JOB_STARVATION_AFTER_MS', 60 * 60_000,
  { min: 1000 });

/**
 * How many lanes of this process may run a given job type at once.
 *
 * Concurrency is worth having for research, which is almost entirely waiting on other
 * people's web servers, and is worth nothing for a market search, which is bounded by
 * the provider rather than by us. Running two market searches at once would also put
 * two lanes either side of the daily spend ceiling: that check reads what has been
 * spent and then spends, and a second lane reading in the gap sees the first lane's
 * money as unspent. The ceiling is a precondition of a call, so the honest fix is for
 * there to be one caller rather than for the check to become a distributed reservation.
 *
 * In-process, which is what production is -- one worker unit under systemd. Two worker
 * processes on one database would each honour their own cap and the ceiling would be
 * back to being racy, so a second process is a deployment change rather than a knob.
 */
const LANES_PER_JOB_TYPE: Readonly<Record<string, number>> = {
  market_mine: 1,
  zip_research: 1,
};

const runningByType = new Map<string, number>();

/** How many lanes this process runs. See the note in `runWorker`. */
export function workerConcurrency(): number {
  return numeric('WORKER_CONCURRENCY', 2, { min: 1, max: 32 });
}

/**
 * Claiming is serialised within the process; running is not.
 *
 * The cap is counted in memory and incremented once a lease comes back, so four lanes
 * calling leaseJob in the same tick all passed the check before any of them had been
 * counted -- measured at four concurrent market searches under a cap of one. A lease is
 * a single UPDATE and takes no measurable time, so making the lanes take turns at the
 * claim costs nothing and makes the count true at the moment it is read. The handler
 * runs outside the gate, which is where the concurrency was wanted in the first place.
 */
let leaseGate: Promise<void> = Promise.resolve();

async function claimJob(laneId: string): Promise<JobRecord | null> {
  let release!: () => void;
  const previous = leaseGate;
  leaseGate = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const job = await leaseJob(laneId, typesAtCapacity());
    if (job) runningByType.set(job.job_type, (runningByType.get(job.job_type) ?? 0) + 1);
    return job;
  } finally {
    release();
  }
}

/** Job types this process is currently unable to take more of. */
function typesAtCapacity(): string[] {
  const full: string[] = [];
  for (const [type, cap] of Object.entries(LANES_PER_JOB_TYPE)) {
    if ((runningByType.get(type) ?? 0) >= cap) full.push(type);
  }
  return full;
}

/**
 * Claims one job atomically. `skip locked` lets several workers share the queue.
 *
 * Takes the claimant rather than assuming the process, because a process now runs
 * several lanes and `leased_by` is the only record of which one holds a job. Two lanes
 * of one process writing the same value would still be safe -- `skip locked` is what
 * prevents a double claim -- but an expired lease would name a process rather than the
 * lane that stopped making progress, and that is the thing an operator needs.
 */
async function leaseJob(leasedBy: string = workerId,
                        excludeTypes: string[] = []): Promise<JobRecord | null> {
  const { rows } = await query<JobRecord>(
    `update jobs set status = 'RUNNING',
                     leased_by = $1,
                     leased_until = now() + ($2 || ' seconds')::interval,
                     attempts = attempts + 1,
                     started_at = coalesce(started_at, now())
      where job_id = (
        select job_id from jobs
         -- Due-ness is part of the selection, not a check afterwards: claiming a
         -- backed-off job and then releasing it would burn a retry on every poll.
         where run_after <= now()
           and (status = 'QUEUED' or (status = 'RUNNING' and leased_until < now()))
           -- A type this process is already running as many of as it may. Excluded in
           -- the predicate rather than released afterwards, because claiming a job to
           -- hand it straight back increments attempts and spends a retry on a poll.
           and not (job_type = any($4::text[]))
         -- Age first, and only once it is genuinely excessive: see
         -- JOB_STARVATION_AFTER_MS. Measured from run_after rather than created_at,
         -- so a job that has been backed off repeatedly does not claim to have been
         -- starving during the interval it was deliberately asleep.
         order by (run_after <= now() - ($3 || ' milliseconds')::interval) desc,
                  priority asc, run_after asc, created_at asc
         for update skip locked
         limit 1
      )
      returning job_id, job_type, payload, attempts, max_attempts, account_id, market_id, requested_by`,
    [leasedBy, String(config.worker.leaseSeconds), String(JOB_STARVATION_AFTER_MS),
     excludeTypes],
  );
  return rows[0] ?? null;
}

async function completeJob(jobId: string, progress: JobResult | void): Promise<void> {
  const outcome = progress?.outcome ?? 'COMPLETED';
  // A handler's own reason quotes provider messages, so it goes through the same
  // filter as an exception does.
  const reason = progress?.outcomeReason ? redactSecrets(progress.outcomeReason) : null;
  const write = (value: string, note: string | null): Promise<unknown> => query(
    `update jobs set status = 'SUCCEEDED', completed_at = now(), leased_by = null,
                     leased_until = null, last_error = null, progress = $2,
                     outcome = $3, outcome_reason = $4
      where job_id = $1`,
    [jobId, JSON.stringify(progress ?? {}), value, note],
  );

  try {
    await write(outcome, reason);
  } catch (error) {
    // An outcome this database has never heard of.
    //
    // Both callers wrap the handler and this write in one try/catch, so a rejected
    // outcome was indistinguishable from a handler that threw: the work had already
    // happened -- businesses ingested, provider task closed, market outcome recorded
    // -- and the job was then marked for retry, the handler run again, and finally
    // recorded FAILED. Measured at three executions of a handler that succeeded every
    // time, with a raw check-constraint string as the only explanation.
    //
    // The cause is almost never the handler. It is a build that knows an outcome value
    // its schema does not, which is what an unapplied migration looks like from in
    // here. So the successful work keeps its record, the handler is not run again, and
    // the operator gets the actual diagnosis instead of Postgres's.
    if ((error as { code?: string }).code !== '23514') throw error;
    const explanation =
      `This job succeeded and reported the outcome "${outcome}", which this database `
      + 'does not recognise, so it is recorded as COMPLETED instead. That mismatch is '
      + 'a schema behind the running build -- check for an unapplied migration -- and '
      + 'not a fault in the work, which was done once and is not being repeated.'
      + (reason ? ` The handler said: ${reason}` : '');
    await write('COMPLETED', explanation.slice(0, 600));
  }
}

/**
 * A job of a type this process cannot run.
 *
 * Two code paths handled this and handled it differently: the worker loop wrote a
 * sentence naming the job type, drainQueue wrote the words "no handler", and neither
 * set an outcome -- so on the Mining page the row showed the fallback pill rather
 * than a failure. One condition, one answer, and an operator reason, because the
 * usual cause is a worker running an older build than the queue it is serving.
 */
async function failUnhandled(job: JobRecord): Promise<void> {
  const message = `No handler registered for job type "${job.job_type}". This worker `
    + 'cannot run this kind of work; it is usually a worker running an older build '
    + 'than the queue it is serving.';
  await query(
    `update jobs set status = 'FAILED', last_error = $2, outcome = 'FAILED',
                     outcome_reason = $2, completed_at = now(),
                     leased_by = null, leased_until = null
      where job_id = $1`,
    [job.job_id, message],
  );
}

async function failJob(job: JobRecord, error: unknown): Promise<void> {
  const raw = error instanceof Error ? error.message : String(error);
  // Redacted where it becomes durable, not where it is displayed: by display time
  // it is already in the database and in whatever was backed up.
  const message = redactSecrets(raw);
  const exhausted = job.attempts >= job.max_attempts;
  await query(
    `update jobs set status = $2, last_error = $3, leased_by = null, leased_until = null,
                     completed_at = case when $2 = 'FAILED' then now() else null end,
                     outcome = case when $2 = 'FAILED' then 'FAILED' else null end,
                     outcome_reason = case when $2 = 'FAILED' then $5 else null end,
                     -- Back off geometrically so a broken source is not hammered.
                     run_after = now() + (least(power(3, $4::int), 900) || ' seconds')::interval
      where job_id = $1`,
    [job.job_id, exhausted ? 'FAILED' : 'QUEUED', message.slice(0, 2000), job.attempts,
     // A terminal failure gets a sentence an operator can act on. A retry does not
     // need one: it is going to happen again in a moment.
     exhausted ? terminalFailureReason(job.job_type, message).slice(0, 600) : null],
  );
}

let running = false;
let stopping = false;

/**
 * Worker liveness.
 *
 * A queue with nobody serving it is not healthy, and the absence of stranded jobs
 * cannot tell the two apart: a job nobody has picked up has no expired lease
 * because it has no lease at all. So the worker says it is here, repeatedly, and
 * the operator surfaces read that rather than inferring health from silence.
 */
export const HEARTBEAT_INTERVAL_MS = numeric('WORKER_HEARTBEAT_MS', 15_000, { min: 1000 });

/**
 * How long after its last heartbeat a worker is presumed gone.
 *
 * Three intervals: one missed beat is a slow job or a busy box, three is a process
 * that is not coming back.
 */
export const HEARTBEAT_STALE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 3;

/**
 * The jobs this process is holding right now, by lane.
 *
 * Module state rather than a parameter because the heartbeat runs on its own timer and
 * has no lane to ask. A lane records what it holds; the timer reports all of it.
 */
const heldByLane = new Map<number, string>();

export async function recordHeartbeat(input: {
  processed?: number; lastJobAt?: Date | null; currentJobId?: string | null;
} = {}): Promise<void> {
  const identity = buildIdentity();
  // Ordered by lane so the oldest-numbered lane's job is the one a pre-concurrency
  // read model sees, rather than whichever finished most recently.
  const held = [...heldByLane.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id);
  const currentJobId = input.currentJobId ?? held[0] ?? null;
  await query(
    `insert into worker_instances (worker_id, hostname, pid, handlers, last_heartbeat_at,
                                   jobs_processed, last_job_at, draining_since, current_job_id,
                                   build_sha, migrations_expected, concurrency, current_job_ids)
     values ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (worker_id) do update set
       last_heartbeat_at = now(),
       handlers = excluded.handlers,
       -- A worker that restarts on a new build says so on its next heartbeat.
       build_sha = excluded.build_sha,
       migrations_expected = excluded.migrations_expected,
       jobs_processed = greatest(worker_instances.jobs_processed, excluded.jobs_processed),
       last_job_at = coalesce(excluded.last_job_at, worker_instances.last_job_at),
       -- Draining is sticky: once asked to stop, a worker does not go back to
       -- running just because its next heartbeat fires.
       draining_since = coalesce(worker_instances.draining_since, excluded.draining_since),
       current_job_id = excluded.current_job_id,
       concurrency = excluded.concurrency,
       current_job_ids = excluded.current_job_ids,
       stopped_at = null`,
    [workerId, hostname(), process.pid, [...handlers.keys()],
     input.processed ?? 0, input.lastJobAt ?? null,
     stopping ? new Date() : null, currentJobId,
     identity.sha, identity.migrationsExpected,
     workerConcurrency(), held],
  );
}

/** Marks this worker as stopped on purpose, so a clean shutdown is not an outage. */
export async function recordWorkerStopped(): Promise<void> {
  await query(
    `update worker_instances set stopped_at = now(), draining_since = null,
            current_job_id = null, current_job_ids = '{}'
      where worker_id = $1`, [workerId]);
}

/**
 * Records that this worker has been asked to stop and is finishing what it holds.
 *
 * Between the signal and the exit a worker is neither running normally nor stopped.
 * It takes no new work, so the queue behind it is going nowhere, and without this
 * the operations panel read it as perfectly healthy.
 */
export async function recordWorkerDraining(): Promise<void> {
  await query(
    `update worker_instances set draining_since = coalesce(draining_since, now())
      where worker_id = $1`, [workerId]);
}

/** True once this worker has been asked to stop. */
export function isDraining(): boolean {
  return stopping;
}

export const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

/** Bounded-growth maintenance. Safe to call at any time; each step is independent. */
export async function runHousekeeping(): Promise<{
  sessions: number; uploads: number; loginAttempts: number;
}> {
  const { purgeExpiredSessions, purgeOldLoginAttempts } = await import('../domain/auth.js');
  const { expireStaleSessions } = await import('../import/session.js');
  return {
    sessions: await purgeExpiredSessions(),
    uploads: await expireStaleSessions(),
    loginAttempts: await purgeOldLoginAttempts(),
  };
}

export async function runWorker(log: (message: string, meta?: unknown) => void = console.log): Promise<void> {
  running = true;
  stopping = false;
  // Read here rather than taken from `config`, which freezes its values at import.
  // A ceiling or a lane count captured at module load is one that ignores anything set
  // after the process started, and -- the reason it matters in practice -- one that no
  // test can vary. `dailyBudgetUsd` made the same decision for the same reason.
  const lanes = workerConcurrency();
  log(`[worker] ${workerId} started with ${lanes} lane(s); `
    + `handlers: ${[...handlers.keys()].join(', ') || 'none'}`);

  let processed = 0;
  let lastJobAt: Date | null = null;
  await recordHeartbeat({ processed, lastJobAt });
  // The heartbeat is on its own timer rather than tied to the poll loop, so a worker
  // stuck inside one long job still reports that it is alive.
  const heartbeat = setInterval(() => {
    void recordHeartbeat({ processed, lastJobAt }).catch((error: unknown) => {
      log('[worker] heartbeat failed', error);
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  // Housekeeping that nothing else owns: expired sessions, abandoned uploads and old
  // sign-in attempts. Each is a table that only ever grew, on a schedule that did not
  // exist. Hourly is often enough for all three and cheap enough to ignore.
  const housekeeping = setInterval(() => {
    void runHousekeeping().catch((error: unknown) => log('[worker] housekeeping failed', error));
  }, HOUSEKEEPING_INTERVAL_MS);
  housekeeping.unref?.();

  /**
   * One lane: lease, run, repeat, until asked to stop.
   *
   * `WORKER_CONCURRENCY` was declared in config.ts and consumed by nothing, so a worker
   * leased one job at a time whatever the value said -- scaling the V2 estate rebuild
   * meant starting extra processes by hand and killing them by hand afterwards. N lanes
   * inside one process is what the queue was already built for: `for update skip locked`
   * makes the claim atomic, and a lease is owned by whoever holds it rather than by a
   * process, so nothing about correctness depends on there being exactly one.
   *
   * What the lanes share is deliberately small -- the stop flag, the counters, and the
   * two timers -- because everything else is per-job state that was already local.
   */
  const lane = async (index: number): Promise<void> => {
    const laneId = lanes > 1 ? `${workerId}#${index}` : workerId;
    while (!stopping) {
      let job: JobRecord | null = null;
      try {
        job = await claimJob(laneId);
      } catch (error) {
        log(`[worker] lane ${index} failed to lease a job`, error);
        await sleep(config.worker.pollIntervalMs * 3);
        continue;
      }

      if (!job) {
        // Staggered, so N idle lanes do not poll the same table in the same
        // millisecond for ever. The jitter is a fraction of the interval and only
        // matters when there is nothing to do.
        await sleep(config.worker.pollIntervalMs + Math.floor(Math.random() * 250));
        continue;
      }

      const handler = handlers.get(job.job_type);
      if (!handler) {
        log(`[worker] no handler for job type ${job.job_type}; marking failed`);
        await failUnhandled(job);
        // The claim reserved a slot for this type; nothing ran, so give it back.
        runningByType.set(job.job_type, (runningByType.get(job.job_type) ?? 1) - 1);
        continue;
      }

      const startedAt = Date.now();
      heldByLane.set(index, job.job_id);
      await recordHeartbeat({ processed, lastJobAt })
        .catch(() => { /* a heartbeat is not worth failing a job over */ });
      try {
        const progress = await handler(job);
        await completeJob(job.job_id, progress);
        log(`[worker] ${job.job_type} ${job.job_id} succeeded in ${Date.now() - startedAt}ms`);
      } catch (error) {
        await failJob(job, error);
        log(`[worker] ${job.job_type} ${job.job_id} failed (attempt ${job.attempts}/${job.max_attempts})`, error);
      } finally {
        // Released even when the handler threw, so a crashed job does not leave this
        // process claiming to be working on it, nor a capped type permanently full.
        heldByLane.delete(index);
        runningByType.set(job.job_type, (runningByType.get(job.job_type) ?? 1) - 1);
      }
      processed += 1;
      lastJobAt = new Date();
    }
  };

  try {
    // Every lane finishes the job it holds before any of them returns, which is what
    // makes a deliberate shutdown finish work rather than abandon it to lease expiry.
    await Promise.all(Array.from({ length: lanes }, (_, index) => lane(index)));
  } finally {
    clearInterval(heartbeat);
    clearInterval(housekeeping);
    heldByLane.clear();
    runningByType.clear();
    await recordWorkerStopped().catch(() => { /* the process is going anyway */ });
  }

  running = false;
  log('[worker] stopped');
}

export function stopWorker(): void {
  stopping = true;
  // Say so immediately rather than at the next heartbeat: the whole point of the
  // state is that somebody watching a restart can see it happening.
  void recordWorkerDraining().catch(() => { /* the process is stopping anyway */ });
}

export function isRunning(): boolean {
  return running;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs the queue until it is empty. Used by tests and one-shot CLI runs. */
export async function drainQueue(limit = 50): Promise<number> {
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await leaseJob();
    if (!job) break;
    const handler = handlers.get(job.job_type);
    if (!handler) {
      await failUnhandled(job);
      continue;
    }
    try {
      await completeJob(job.job_id, await handler(job));
    } catch (error) {
      await failJob(job, error);
    }
    processed += 1;
  }
  return processed;
}

export { pool, withTransaction };
