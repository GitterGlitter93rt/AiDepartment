import { config } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { closePool } from '../db/pool.js';
import { syncVerticalProfiles } from '../domain/verticals.js';
import { simulateBatch, renderBatchReport } from '../probe/packet.js';

/**
 * The Speed-to-Lead dry-run operator packet.
 *
 *   npm run probe:packet                    # 100 prospects, 10 pool numbers
 *   npm run probe:packet -- --size 25
 *
 * Seeds synthetic companies, runs them through the real planner, form analyzer,
 * allocator, attribution ladder and evidence layer, and prints what would have
 * happened. Sends nothing: there is no HTTP client anywhere in `src/probe`.
 *
 * It refuses to run against the live database. The packet writes synthetic accounts,
 * and a fixture company in working inventory is worse than no packet at all -- a rep
 * would eventually see "Probe Fixture 044" in a worklist and have no idea why.
 */

const LIVE_DATABASE = 'yad_sales';

function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

const target = databaseName(config.databaseUrl);
if (target === LIVE_DATABASE) {
  process.stderr.write(
    `REFUSED: this packet seeds synthetic companies and would write them into the\n`
    + `live database "${LIVE_DATABASE}".\n\n`
    + `Point DATABASE_URL at a scratch database and run it again, for example:\n`
    + `  DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2- | `
    + `sed 's#/${LIVE_DATABASE}#/yad_sales_walk#') npm run probe:packet\n`);
  process.exit(2);
}

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  return process.argv[at + 1] ?? '';
}

const size = Number(flag('size') ?? '100');
if (!Number.isFinite(size) || size < 1 || size > 1000) {
  process.stderr.write('--size must be between 1 and 1000\n');
  process.exit(2);
}

process.stdout.write(`(database: ${target})\n\n`);
// Self-sufficient against an empty database: `accounts.primary_vertical_profile_id`
// is a foreign key, so the fixtures cannot exist without the profiles.
await runMigrations(() => {});
await syncVerticalProfiles();
const report = await simulateBatch({ size, poolSize: 10 });
process.stdout.write(`${renderBatchReport(report)}\n`);
await closePool();
