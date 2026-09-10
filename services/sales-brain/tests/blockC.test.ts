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
