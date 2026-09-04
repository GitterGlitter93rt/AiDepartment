import pg from 'pg';
import { config } from '../config.js';

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
  max: Number(process.env.PG_POOL_MAX ?? 10),
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

export async function closePool(): Promise<void> {
  await pool.end();
}
