import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { pool, withTransaction } from './pool.js';

const migrationsDir = resolve(config.packageRoot, 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export interface SchemaState {
  /** Migration files on disk that this database has never run. */
  pending: string[];
  /** Migrations this database has run that are not in this build. */
  unknown: string[];
  /** Applied migrations whose file no longer matches what was applied. */
  changed: string[];
  applied: number;
}

/**
 * What this build's migrations say, against what this database actually contains.
 *
 * The running code and the schema can disagree, and until now nothing said so. The
 * shape of that failure is already familiar on this box: systemd reported the worker
 * service active while the database reported no worker online, because the unit was
 * running a build that predated the heartbeat. `pending` is that same disagreement,
 * named before it turns into a page of 500s nobody can explain.
 */
export async function schemaState(): Promise<SchemaState> {
  const { rows } = await pool.query<{ filename: string; checksum: string }>(
    `select filename, checksum from schema_migrations`,
  ).catch(() => ({ rows: [] as { filename: string; checksum: string }[] }));
  const appliedByName = new Map(rows.map((row) => [row.filename, row.checksum]));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const pending: string[] = [];
  const changed: string[] = [];

  for (const filename of files) {
    const previous = appliedByName.get(filename);
    if (!previous) { pending.push(filename); continue; }
    const checksum = createHash('sha256')
      .update(readFileSync(resolve(migrationsDir, filename), 'utf8')).digest('hex');
    if (previous !== checksum) changed.push(filename);
  }

  const onDisk = new Set(files);
  const unknown = [...appliedByName.keys()].filter((name) => !onDisk.has(name)).sort();

  return { pending, unknown, changed, applied: appliedByName.size };
}

/**
 * Forward-only migrations. Each file runs once inside its own transaction and is
 * recorded with a checksum, so an edited-after-apply migration is caught rather
 * than silently diverging from what the database actually contains.
 */
export async function runMigrations(log: (message: string) => void = console.log): Promise<MigrationResult> {
  await pool.query(`
    create table if not exists schema_migrations (
      filename    text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `);

  const { rows } = await pool.query<{ filename: string; checksum: string }>(
    'select filename, checksum from schema_migrations',
  );
  const alreadyApplied = new Map(rows.map((row) => [row.filename, row.checksum]));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const filename of files) {
    const sql = readFileSync(resolve(migrationsDir, filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = alreadyApplied.get(filename);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${filename} changed after it was applied. Add a new migration instead of editing an applied one.`,
        );
      }
      skipped.push(filename);
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('insert into schema_migrations (filename, checksum) values ($1, $2)', [
        filename,
        checksum,
      ]);
    });
    applied.push(filename);
    log(`  applied ${filename}`);
  }

  return { applied, skipped };
}
