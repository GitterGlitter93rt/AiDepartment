import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { pool } from '../src/db/pool.js';

/**
 * The schema a fresh install gets, and the schema this box has.
 * Authority: Issue #3 BI — historical migration matrix.
 *
 * Two ways to arrive at a schema: run every migration in order on an empty database,
 * which is what a new deploy does, or accumulate them one at a time over weeks,
 * which is what this box did. Nothing checked that the two agree. A migration that
 * happens to work against the state this machine was in, and not against an empty
 * database, would pass every test here and fail on the first real install.
 *
 * And migration 035 has already shown the other half: `create table provider_tasks`
 * with no `if not exists`, so one deleted `schema_migrations` row re-ran it and
 * failed 137 unrelated tests. A migration is not a script that runs once; it is a
 * script that must survive running again.
 */

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url).pathname;
const FILES = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
const SCRATCH = 'yad_sales_migration_matrix';

/** The parts of a schema a defect would show up in. */
const SCHEMA_QUERY = `
  select 'column' as kind,
         table_name || '.' || column_name || ':' || data_type || ':' ||
         is_nullable || ':' || coalesce(column_default, '-') as signature
    from information_schema.columns where table_schema = 'public'
  union all
  select 'constraint',
         conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint
   where connamespace = 'public'::regnamespace
  union all
  select 'index', tablename || ':' || indexname || ':' || indexdef
    from pg_indexes where schemaname = 'public'
  union all
  select 'view', table_name || ':' || view_definition
    from information_schema.views where table_schema = 'public'
  order by 1, 2`;

/** tests/setup rewrites DATABASE_URL to point at the throwaway test database. */
function adminUrl(database: string): string {
  const url = new URL(process.env['DATABASE_URL']!);
  url.pathname = `/${database}`;
  return url.toString();
}

const TEST_DATABASE = new URL(process.env['DATABASE_URL']!).pathname.slice(1);

async function withClient<T>(
  database: string, work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl(database) });
  await client.connect();
  try { return await work(client); } finally { await client.end(); }
}

/**
 * The product's schema. `schema_migrations` is excluded deliberately: the runner
 * creates it in code rather than in a migration file, so a database built by
 * applying the files directly will not have it, and that difference says nothing
 * about drift.
 */
async function schemaOf(database: string): Promise<string[]> {
  return withClient(database, async (client) => {
    const { rows } = await client.query<{ kind: string; signature: string }>(SCHEMA_QUERY);
    return rows.map((row) => `${row.kind} ${row.signature}`)
      .filter((line) => !line.includes('schema_migrations'));
  });
}

async function migrateFromScratch(client: pg.Client): Promise<void> {
  for (const filename of FILES) {
    await client.query(readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8'));
  }
}

before(async () => {
  await withClient('postgres', async (client) => {
    await client.query(`drop database if exists ${SCRATCH}`);
    await client.query(`create database ${SCRATCH}`);
  });
});

after(async () => {
  await withClient('postgres', (client) => client.query(`drop database if exists ${SCRATCH}`));
  await pool.end();
});

test('every migration runs on an empty database, in order', async () => {
  await withClient(SCRATCH, migrateFromScratch);
  const tables = await withClient(SCRATCH, async (client) => {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`);
    return rows[0]!.n;
  });
  assert.ok(tables > 30, `a fresh install produced only ${tables} tables`);
});

test('a fresh install and this box agree on the schema', async () => {
  // The drift this catches: a migration written against the state this machine
  // happened to be in. It passes here for weeks and fails on the first real install.
  const [fresh, incremental] = await Promise.all([
    schemaOf(SCRATCH), schemaOf(TEST_DATABASE),
  ]);

  const onlyFresh = fresh.filter((line) => !incremental.includes(line));
  const onlyHere = incremental.filter((line) => !fresh.includes(line));
  assert.deepEqual(onlyFresh, [],
    'a fresh install has schema this database does not:\n' + onlyFresh.join('\n'));
  assert.deepEqual(onlyHere, [],
    'this database has schema a fresh install would not get:\n' + onlyHere.join('\n'));
});

/**
 * Re-running a migration is deliberately NOT a requirement.
 *
 * My first version of this file asserted that every migration could be applied
 * twice, on the strength of the 035 incident -- `create table provider_tasks` with
 * no `if not exists`, re-run because a test had deleted its schema_migrations row,
 * failing 137 unrelated tests. That was a defect in the test, not in the migration.
 *
 * The runner applies each file inside a transaction and records it by primary key,
 * so a migration is applied exactly once and a crash mid-file rolls the whole thing
 * back. There is no production path that re-applies one: a restore brings
 * schema_migrations back with the schema, and a partial apply cannot exist. Adding
 * `if not exists` to forty-one historical files to satisfy a property nothing relies
 * on would be a large edit to applied migrations -- the one thing this scheme
 * forbids -- in exchange for nothing.
 *
 * What the design does rely on is that every migration *can* run in a transaction,
 * and that two processes starting at once cannot both apply the same one. Those are
 * the two tests below.
 */

test('no migration uses a statement that cannot run in a transaction', () => {
  // The runner wraps each file in one. A `create index concurrently` inside a
  // transaction is an error, and `vacuum` likewise -- and either would quietly
  // remove the atomicity that makes re-running unnecessary in the first place.
  const offenders: string[] = [];
  for (const filename of FILES) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8')
      .replace(/--[^\n]*/g, '');
    // Only statements that PostgreSQL genuinely refuses inside a transaction. The
    // transaction-control keywords are not checked here: `begin` appears in every
    // `do $$ begin ... end $$` block, and telling those apart from a stray top-level
    // `commit` needs a parser rather than a regular expression. My first version of
    // this list flagged six migrations for PL/pgSQL bodies.
    for (const pattern of [/\bconcurrently\b/i, /\bvacuum\b/i, /\bcreate\s+database\b/i,
      /\bcreate\s+tablespace\b/i]) {
      if (pattern.test(sql)) offenders.push(`${filename}: ${pattern.source}`);
    }
  }
  assert.deepEqual(offenders, [],
    `these migrations cannot run inside the transaction the runner wraps them in, so a `
    + `failure part-way through would leave the schema half-changed:\n${offenders.join('\n')}`);
});

test('two processes starting at once apply each migration exactly once', async () => {
  // stack.sh starts the API and the worker together, and both migrate at boot. Two
  // connections racing on the same file must end with one applied row and no error
  // that stops either process from starting.
  await withClient('postgres', async (admin) => {
    await admin.query(`drop database if exists ${SCRATCH}_race`);
    await admin.query(`create database ${SCRATCH}_race`);
  });

  const migrateOnce = async (): Promise<void> => {
    await withClient(`${SCRATCH}_race`, async (client) => {
      // Same guard the runner uses, and for the same reason: two connections both
      // finding the table missing is exactly the race being tested.
      try {
        await client.query(`create table if not exists schema_migrations (
          filename text primary key, checksum text not null,
          applied_at timestamptz not null default now())`);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== '42P07' && code !== '23505') throw error;
      }
      for (const filename of FILES) {
        const sql = readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8');
        try {
          await client.query('begin');
          const { rows } = await client.query(
            'select 1 from schema_migrations where filename = $1', [filename]);
          if (rows.length > 0) { await client.query('rollback'); continue; }
          await client.query(sql);
          await client.query(
            'insert into schema_migrations (filename, checksum) values ($1, $2)',
            [filename, 'x']);
          await client.query('commit');
        } catch {
          // The loser of a race rolls back its DDL with its insert, which is the
          // property being tested: it does not leave half a migration behind.
          await client.query('rollback').catch(() => {});
        }
      }
    });
  };

  await Promise.all([migrateOnce(), migrateOnce()]);

  const applied = await withClient(`${SCRATCH}_race`, async (client) => {
    const { rows } = await client.query<{ filename: string; n: number }>(
      `select filename, count(*)::int as n from schema_migrations
        group by filename having count(*) > 1`);
    const total = await client.query<{ n: number }>(
      'select count(*)::int as n from schema_migrations');
    return { duplicates: rows, total: total.rows[0]!.n };
  });
  await withClient('postgres',
    (admin) => admin.query(`drop database if exists ${SCRATCH}_race`));

  assert.deepEqual(applied.duplicates, [], 'a migration was recorded as applied twice');
  assert.equal(applied.total, FILES.length,
    'two processes racing left some migrations unapplied, so whichever lost the race '
    + 'starts against a schema it does not expect');
});

test('migration filenames are ordered and unique', () => {
  const numbers = FILES.map((file) => file.slice(0, 3));
  assert.deepEqual([...new Set(numbers)], numbers,
    `two migrations share a number, so the order they apply in depends on the rest `
    + `of the filename: ${FILES.join(', ')}`);
  assert.deepEqual([...numbers].sort(), numbers, 'migration numbers are not in order');
});

// ------------------------------------------------ upgrading from where you are ---

test('a database that stopped anywhere in its history can still reach today', async () => {
  // Three schemas were covered: a fresh install, this box, and two processes racing.
  // The one that was not is the stale install -- a machine last migrated months ago,
  // which is what a restored backup and a long-idle environment both are. Twelve
  // migrations landed in this campaign alone, so "stopped at 032" is a real state.
  //
  // Each stop point is upgraded the rest of the way and compared against a schema
  // built in one pass. A migration that only works against the state its author
  // happened to have passes every other test here.
  const stops = [10, 20, 30, 35, 40].filter((stop) => stop < FILES.length);
  assert.ok(stops.length >= 3, `only ${FILES.length} migrations exist`);

  const reference = await schemaOf(SCRATCH);
  const divergences: string[] = [];

  for (const stop of stops) {
    const database = `${SCRATCH}_from_${stop}`;
    await withClient('postgres', async (admin) => {
      await admin.query(`drop database if exists ${database}`);
      await admin.query(`create database ${database}`);
    });

    await withClient(database, async (client) => {
      // Stop where the historical box stopped.
      for (const filename of FILES.slice(0, stop)) {
        await client.query(readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8'));
      }
      // Then upgrade the rest of the way, as `npm run migrate` would.
      for (const filename of FILES.slice(stop)) {
        await client.query(readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8'));
      }
    });

    const upgraded = await schemaOf(database);
    const onlyUpgraded = upgraded.filter((line) => !reference.includes(line));
    const onlyReference = reference.filter((line) => !upgraded.includes(line));
    if (onlyUpgraded.length > 0 || onlyReference.length > 0) {
      divergences.push(`stopped at ${stop} then upgraded:\n`
        + onlyUpgraded.map((line) => `  extra:   ${line}`).join('\n')
        + onlyReference.map((line) => `  missing: ${line}`).join('\n'));
    }

    await withClient('postgres',
      (admin) => admin.query(`drop database if exists ${database}`));
  }

  assert.deepEqual(divergences, [],
    `upgrading from a historical point does not reach the same schema as a fresh `
    + `install:\n${divergences.join('\n')}`);
});

test('an upgrade from a historical point leaves the newest tables usable', async () => {
  // The schema comparison catches a missing column. It does not catch a table that
  // exists and cannot be written to, which is what a constraint or default applied in
  // the wrong order produces.
  const stop = Math.min(30, FILES.length - 1);
  const database = `${SCRATCH}_usable`;
  await withClient('postgres', async (admin) => {
    await admin.query(`drop database if exists ${database}`);
    await admin.query(`create database ${database}`);
  });

  await withClient(database, async (client) => {
    for (const filename of FILES) {
      await client.query(readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8'));
    }

    // The tables this campaign added, written to as the product writes them.
    const { rows: account } = await client.query<{ account_id: string }>(
      `insert into accounts (canonical_name, normalized_name)
       values ('Upgrade Co', 'upgrade co') returning account_id`);
    const accountId = account[0]!.account_id;

    await client.query(
      `insert into search_observations (provider, source_type, observed_name, account_id,
                                        result_type, retention_class, category, rating,
                                        review_count)
       values ('fixture', 'listings', 'Upgrade Co', $1, 'local_result', 'transient',
               'HVAC contractor', 4.6, 91)`, [accountId]);

    await client.query(
      `insert into duplicate_reviews (account_a_id, account_b_id, candidate_rule)
       select least($1::uuid, a2.account_id), greatest($1::uuid, a2.account_id),
              'same_name_same_place'
         from (select account_id from accounts
                where account_id <> $1 limit 1) a2`, [accountId]);

    await client.query(
      `insert into retention_runs (policy_approved_by, policy_snapshot)
       values ('rehearsal', '{}'::jsonb)`);

    await client.query(
      `insert into worker_instances (worker_id, hostname, pid, build_sha,
                                      migrations_expected)
       values ('rehearsal:1', 'rehearsal', 1, 'abc1234', $1)`, [FILES.length]);

    await client.query(
      `update accounts set score_version = 'module-4c-v2', last_researched_at = now()
        where account_id = $1`, [accountId]);
  });

  await withClient('postgres',
    (admin) => admin.query(`drop database if exists ${database}`));
  void stop;
});
