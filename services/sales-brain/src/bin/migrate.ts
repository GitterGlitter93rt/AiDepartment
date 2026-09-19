import { runMigrations } from '../db/migrate.js';
import { closePool } from '../db/pool.js';

const result = await runMigrations();
console.log(
  `[migrate] ${result.applied.length} applied, ${result.skipped.length} already present.`,
);
await closePool();
