import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// Timestamps come back as Date objects; keep numerics as strings only where precision
// matters. bigint (int8) is parsed to number: our id ranges are far below 2^53.
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'yad-sales-brain',
});

pool.on('error', (error) => {
  console.error('[db] idle client error', error);
});

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
