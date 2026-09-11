import pg from 'pg';
import { config, numeric } from '../config.js';

const { Pool } = pg;

// Timestamps come back as Date objects; keep numerics as strings only where precision
// matters. bigint (int8) is parsed to number: our id ranges are far below 2^53.
pg.types.setTypeParser(20, (value: string) => Number(value));

/**
 * PostgreSQL's JIT is off for this application.
 *
 * The CRM's read models join several lateral subqueries, which gives them a high
 * estimated cost -- prospect_inventory alone plans at about four million -- so every
 * one of them trips the default jit_above_cost of 100,000 and gets LLVM-compiled
 * before it runs. Measured against the 25,000-account synthetic dataset, compilation
 * cost 148 ms on a count that then executed in 154 ms, and 183 ms on a page fetch
 * that executed in 149 ms: roughly half the wall clock of the two slowest queries in
 * the product, spent compiling a query that returns fifty rows.
 *
 * JIT earns its keep on analytic queries that run for seconds. Nothing here does.
 * It is passed as a startup option rather than a SET on each connection, so it costs
 * no extra round trip. Set YAD_PG_JIT=on to measure the difference.
 */
const startupOptions = `-c jit=${process.env.YAD_PG_JIT === 'on' ? 'on' : 'off'}`;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: numeric('PG_POOL_MAX', 10, { min: 1 }),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'yad-sales-brain',
  options: startupOptions,
});

pool.on('error', (error) => {
  console.error('[db] idle client error', error);
});

/**
 * PostgreSQL's JIT is off for this application.
 *
 * The CRM's read models join several lateral subqueries, which gives them a high
 * estimated cost -- prospect_inventory alone plans at about four million -- so every
 * one of them trips the default jit_above_cost of 100,000 and gets LLVM-compiled
 * before it runs. Measured against the 25,000-account synthetic dataset, compilation
 * cost 148 ms on a count that then executed in 154 ms, and 183 ms on a page fetch
 * that executed in 149 ms: roughly half the wall clock of the two slowest queries in
 * the product, spent compiling a query that returns fifty rows.
 *
 * JIT earns its keep on analytic queries that run for seconds. Nothing here does.
 * Set YAD_PG_JIT=on to put it back for a session that wants to measure the
 * difference.
 */


export type Queryable = Pick<pg.PoolClient, 'query'>;

/**
 * Runs many small units of work with one commit per batch instead of one per unit.
 *
 * A commit costs a WAL flush, so a ten-thousand row import that committed per row
 * spent almost all of its 208 seconds waiting on fsync. Batching alone would trade
 * that for a worse property -- one bad row rolling back a hundred good ones -- so
 * each unit runs inside a savepoint. A unit that throws is rolled back to its own
 * savepoint and the rest of the batch is unaffected, which is the isolation the
 * per-row transaction was providing, at a fraction of the cost.
 *
 * Every batch is committed on `finish`, and the client is always released.
 */
export class BatchedWriter {
  private client: pg.PoolClient | null = null;
  private inBatch = 0;
  private savepoint = 0;

  constructor(private readonly batchSize = 100) {}

  /** Runs one unit inside the current batch, opening or committing one as needed. */
  async run<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    if (!this.client) {
      this.client = await pool.connect();
      await this.client.query('begin');
      this.inBatch = 0;
    }
    const client = this.client;
    this.savepoint += 1;
    const name = `import_row_${this.savepoint}`;
    await client.query(`savepoint ${name}`);
    try {
      const result = await fn(client);
      await client.query(`release savepoint ${name}`);
      this.inBatch += 1;
      if (this.inBatch >= this.batchSize) {
        await client.query('commit');
        await client.query('begin');
        this.inBatch = 0;
      }
      return result;
    } catch (error) {
      await client.query(`rollback to savepoint ${name}`);
      throw error;
    }
  }

  /** Commits whatever is open and hands the connection back. */
  async finish(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.query('commit');
    } finally {
      this.client.release();
      this.client = null;
      this.inBatch = 0;
    }
  }

  /** Abandons whatever is open. Used when the caller is already failing. */
  async abort(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.query('rollback');
    } catch {
      // The connection may already be unusable; releasing it is what matters.
    } finally {
      this.client.release();
      this.client = null;
      this.inBatch = 0;
    }
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values);
}

/**
 * Runs `fn` inside a transaction, rolling back on any throw.
 * Every ownership-changing command goes through this.
 */
/**
 * Runs `fn` in a transaction and rolls it back, whatever it returns.
 *
 * For asking "what would this do" by doing it and undoing it. The import preview
 * used to answer that question with a second implementation of the write path, and
 * the two disagreed: three identical rows previewed as three new companies and
 * confirmed as one, because the preview resolved each row against the database and
 * never against the rows above it. An operator approving "500 new companies" got
 * three hundred.
 *
 * Two implementations of one decision drift. One implementation, run twice, cannot.
 */
export async function withRollback<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    try {
      return await fn(client);
    } finally {
      // Always. A preview that could commit by accident is worse than no preview.
      await client.query('rollback').catch(() => { /* connection already gone */ });
    }
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* the connection is already broken; the pool will discard it */
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Ending the pool, once, however many times it is asked.
 *
 * `pg` throws "Called end on pool more than once" on a second call, and the worker
 * has two shutdown paths that both legitimately want to close: the SIGTERM handler's
 * two-second deadline, and the normal return from `runWorker()`. Whichever finished
 * first, the other threw -- from inside an async timer callback with nothing to catch
 * it, so a deliberate restart exited non-zero with a stack trace instead of the clean
 * `process.exit(0)` it was trying to reach. Six of those are in the worker's error log.
 *
 * Memoised rather than flagged, so concurrent callers await the same shutdown instead
 * of racing past a boolean that is not yet true. A genuine failure to close still
 * propagates -- this makes a second close a no-op, not a swallowed error.
 *
 * Fixed here rather than in the worker because thirty-five call sites reach it and
 * "close the pool" should mean the same thing at all of them.
 */
let closing: Promise<void> | null = null;

export async function closePool(): Promise<void> {
  if (!closing) closing = pool.end();
  return closing;
}
