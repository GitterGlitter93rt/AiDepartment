import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, closePool } from '../src/db/pool.js';

/**
 * Closing the pool twice.
 *
 * `pg` throws "Called end on pool more than once", and the worker has two shutdown
 * paths that both legitimately close: the SIGTERM handler's two-second deadline, and
 * the normal return from `runWorker()`. Whichever finished first, the other threw --
 * from inside an async timer callback with nothing to catch it, so a deliberate
 * restart exited non-zero with a stack trace instead of reaching its `process.exit(0)`.
 *
 * This file deliberately has no `before`/`after` and does nothing else: ending the
 * shared pool is the thing under test, so it must be the last thing this process
 * does. Every other test file ends its own pool in an `after` hook and is unaffected,
 * because node's test runner gives each file its own process.
 */

test('the pool can be closed twice without throwing', async () => {
  // Live first, so this is a real pool being ended rather than an unused one.
  const { rows } = await query<{ ok: number }>('select 1 as ok');
  assert.equal(rows[0]!.ok, 1);

  await closePool();
  // The second call is the one that used to crash the worker on every fast shutdown.
  await closePool();
  // And a third, because idempotence that only survives one repeat is a coincidence.
  await closePool();

  assert.equal(pool.ended, true, 'the pool did not actually end');
});

test('concurrent closes await the same shutdown', async () => {
  // The reason it is memoised rather than flagged: two callers racing past a boolean
  // that is not yet true would both call end(). The pool is already ended by the test
  // above, which is exactly the state a late SIGTERM timer arrives in.
  await assert.doesNotReject(() => Promise.all([closePool(), closePool(), closePool()]));
});
