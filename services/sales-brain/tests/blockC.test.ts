import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { registerHandler, drainQueue, JOB_STARVATION_AFTER_MS } from '../src/workers/runner.js';
import { resetDatabase } from './helpers.js';

/**
 * Block C: the queue under load, and the two layers that disagreed about fairness.
 *
 * The worker's own failure modes are well covered -- leases, crashes mid-handler,
 * two workers on one queue, poison jobs, redaction. What was not covered is what the
 * queue does when it is busy in the ordinary way, which turns out to be where the
 * interesting answer is: the scheduler goes to real trouble not to starve a market,
 * and then hands its jobs to a queue that starved them anyway.
 */

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); ran.length = 0; });

const ran: string[] = [];

registerHandler('blockc_background', async () => { ran.push('background'); });
registerHandler('blockc_urgent', async () => { ran.push('urgent'); });
/** Creates more of itself, which is what continuous rep-driven inflow looks like. */
registerHandler('blockc_urgent_chain', async () => {
  ran.push('urgent');
  if (ran.filter((entry) => entry === 'urgent').length < 25) {
    await query(
      `insert into jobs (job_type, payload, priority)
       values ('blockc_urgent_chain', '{}'::jsonb, 40)`);
  }
});

async function enqueueRaw(input: {
  jobType: string; priority: number; eligibleSince?: string;
}): Promise<void> {
  await query(
    `insert into jobs (job_type, payload, priority, created_at, run_after)
     values ($1, '{}'::jsonb, $2,
             now() - ($3::text || ' milliseconds')::interval,
             now() - ($3::text || ' milliseconds')::interval)`,
    [input.jobType, input.priority, input.eligibleSince ?? '0']);
}

// =============================================================================
// C1 · a background job that waits for ever behind work that keeps arriving
// =============================================================================

/**
 * The defect, stated as the thing an operator would see: markets due, a worker that
 * is never idle, nothing failing, and market searches that never happen.
 *
 * `contact_research` is priority 40, `account_research` 50, `market_mine` 80. A
 * market search discovers businesses and enqueues one research job per business --
 * so mining generates the work that outranks mining. Strict priority has no floor,
 * so the older job does not merely go last, it goes last for ever.
 */
test('C1 a long-waiting background job is not overtaken for ever', async () => {
  // Eligible for well past the starvation threshold.
  await enqueueRaw({ jobType: 'blockc_background', priority: 80,
    eligibleSince: String(JOB_STARVATION_AFTER_MS * 2) });
  await enqueueRaw({ jobType: 'blockc_urgent_chain', priority: 40 });

  await drainQueue(60);

  const at = ran.indexOf('background');
  assert.notEqual(at, -1, 'the background job never ran at all');
  assert.ok(at < 3,
    `the starving job ran at position ${at} of ${ran.length}: age is not outranking `
    + 'a newer job’s priority, so continuous higher-priority inflow starves it');
});

test('C1 priority still decides among jobs waiting a normal amount of time', async () => {
  // The fix must not become "oldest wins", which would put every background refresh
  // ahead of a rep waiting on research they asked for.
  await enqueueRaw({ jobType: 'blockc_background', priority: 80, eligibleSince: '2000' });
  await enqueueRaw({ jobType: 'blockc_urgent', priority: 40, eligibleSince: '1000' });

  await drainQueue(10);

  assert.deepEqual(ran, ['urgent', 'background'],
    'a newer high-priority job lost to an older low-priority one that was not starving');
});

test('C1 among starving jobs, priority applies again', async () => {
  // Two jobs both past the threshold: the more important one still goes first.
  await enqueueRaw({ jobType: 'blockc_background', priority: 80,
    eligibleSince: String(JOB_STARVATION_AFTER_MS * 3) });
  await enqueueRaw({ jobType: 'blockc_urgent', priority: 40,
    eligibleSince: String(JOB_STARVATION_AFTER_MS * 2) });

  await drainQueue(10);

  assert.deepEqual(ran, ['urgent', 'background'],
    'once both jobs are starving, priority should decide between them');
});

test('C1 a job asleep on a backoff is not treated as starving', async () => {
  // Age is measured from run_after, not created_at. A job created hours ago and
  // deliberately deferred has not been waiting -- it has been asleep -- and letting
  // it claim starvation priority would hand the front of the queue to whatever is
  // failing most persistently.
  await query(
    `insert into jobs (job_type, payload, priority, created_at, run_after, attempts)
     values ('blockc_background', '{}'::jsonb, 80,
             now() - ($1::text || ' milliseconds')::interval,
             now() - interval '1 second', 4)`,
    [String(JOB_STARVATION_AFTER_MS * 5)]);
  await enqueueRaw({ jobType: 'blockc_urgent', priority: 40 });

  await drainQueue(10);

  assert.deepEqual(ran, ['urgent', 'background'],
    'a repeatedly backed-off job claimed to have been starving while it was asleep');
});

test('C1 the queue still drains completely under continuous inflow', async () => {
  // Anti-starvation must not cost throughput or leave anything behind.
  await enqueueRaw({ jobType: 'blockc_background', priority: 80,
    eligibleSince: String(JOB_STARVATION_AFTER_MS * 2) });
  await enqueueRaw({ jobType: 'blockc_urgent_chain', priority: 40 });

  await drainQueue(60);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where status in ('QUEUED','RUNNING')`);
  assert.equal(rows[0]!.n, 0, 'the queue did not drain');
  const { rows: failed } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where status = 'FAILED'`);
  assert.equal(failed[0]!.n, 0, 'anti-starvation ordering broke a job');
});

// =============================================================================
// C2 · a build that knows an outcome its schema does not
// =============================================================================

/**
 * Not hypothetical: this repository is in exactly that state right now. Migration
 * 050 adds MARKET_DISABLED to `jobs_outcome_check` and is deliberately unapplied in
 * production, so a build carrying it that ran against the live schema would hit this
 * on the first market anybody paused.
 *
 * What used to happen, measured: both callers wrap the handler and the completion
 * write in one try/catch, so a rejected outcome was indistinguishable from a handler
 * that threw. The work had already happened -- businesses ingested, provider task
 * closed, market outcome recorded -- and the job was marked for retry, the handler
 * run again, and finally recorded FAILED after three executions of a handler that
 * succeeded every time. The only explanation an operator got was a raw
 * check-constraint string, which points at the job rather than at the unapplied
 * migration that actually caused it.
 */
let unknownOutcomeRuns = 0;
registerHandler('blockc_unknown_outcome', async () => {
  unknownOutcomeRuns += 1;
  return { outcome: 'A_VALUE_THIS_SCHEMA_HAS_NEVER_HEARD_OF' as never,
           outcomeReason: 'the work itself went fine' };
});

test('C2 an unrecognised outcome does not turn successful work into a failure',
  async () => {
  unknownOutcomeRuns = 0;
  await query(`insert into jobs (job_type, payload, max_attempts)
               values ('blockc_unknown_outcome', '{}'::jsonb, 3)`);

  // Several passes, so a retry loop would show up as repeated execution.
  for (let pass = 0; pass < 5; pass += 1) {
    await query(`update jobs set run_after = now() - interval '1 second'
                  where job_type = 'blockc_unknown_outcome'`);
    await drainQueue(5);
  }

  assert.equal(unknownOutcomeRuns, 1,
    `the handler ran ${unknownOutcomeRuns} times: work that succeeded is being `
    + 'repeated because its outcome could not be recorded');

  const { rows } = await query<Record<string, any>>(
    `select status, outcome, outcome_reason, last_error, attempts from jobs
      where job_type = 'blockc_unknown_outcome'`);
  const job = rows[0]!;
  assert.equal(job.status, 'SUCCEEDED', 'successful work was recorded as failed');
  assert.equal(job.outcome, 'COMPLETED');
  assert.equal(job.last_error, null);

  // And the reason names the real cause rather than quoting Postgres at somebody.
  assert.match(job.outcome_reason, /A_VALUE_THIS_SCHEMA_HAS_NEVER_HEARD_OF/,
    'the outcome the handler actually reported is not recorded anywhere');
  assert.match(job.outcome_reason, /unapplied migration/,
    'the operator is not pointed at the schema, which is the usual cause');
  assert.match(job.outcome_reason, /not being repeated/);
  assert.doesNotMatch(job.outcome_reason, /check constraint/,
    'the operator is still being shown the database’s own error text');
});

test('C2 a handler that genuinely throws is still a failure', async () => {
  // The fix must not swallow real faults. Only the completion write is forgiving, and
  // only for the one error the database raises when it does not know a value.
  registerHandler('blockc_real_throw', async () => {
    throw new Error('the provider is on fire');
  });
  await query(`insert into jobs (job_type, payload, max_attempts)
               values ('blockc_real_throw', '{}'::jsonb, 1)`);
  await drainQueue(5);

  const { rows } = await query<Record<string, any>>(
    `select status, outcome, last_error from jobs where job_type = 'blockc_real_throw'`);
  assert.equal(rows[0]!.status, 'FAILED');
  assert.equal(rows[0]!.outcome, 'FAILED');
  assert.match(rows[0]!.last_error, /on fire/);
});

test('C2 a known outcome is recorded exactly as the handler reported it', async () => {
  // The ordinary path, unchanged: no explanation bolted onto a normal run.
  registerHandler('blockc_known_outcome', async () => ({
    outcome: 'ZERO_RESULTS' as const, outcomeReason: 'nothing in this market' }));
  await query(`insert into jobs (job_type, payload) values ('blockc_known_outcome','{}'::jsonb)`);
  await drainQueue(5);

  const { rows } = await query<Record<string, any>>(
    `select status, outcome, outcome_reason from jobs
      where job_type = 'blockc_known_outcome'`);
  assert.equal(rows[0]!.status, 'SUCCEEDED');
  assert.equal(rows[0]!.outcome, 'ZERO_RESULTS');
  assert.equal(rows[0]!.outcome_reason, 'nothing in this market');
});
