import { runMigrations } from '../db/migrate.js';
import { pool, query } from '../db/pool.js';
import { seedPilotDemo, clearPilotDemo, DEMO_MARKER } from '../synthetic/demoFixture.js';

/**
 * Seeds the human-rep pilot demonstration into the current database.
 *
 *   npx tsx src/bin/demo-seed.ts [--owner <email>] [--clear]
 *
 * Eleven companies, one of them under DNC and one of them barely researched, so the
 * whole flow is walkable: filter, inspect, claim, work, follow up, reply, opportunity,
 * meeting. Every domain is `.invalid` and every phone is a 555 number, so no demo
 * company can be confused with a prospect or reached by accident.
 */

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
}

await runMigrations(() => {});

if (process.argv.includes('--clear')) {
  const removed = await clearPilotDemo();
  console.log(`[demo] removed ${removed} demo accounts`);
  await pool.end();
  process.exit(0);
}

const ownerEmail = argument('owner');
let ownerUserId: string | null = null;
let managerUserId: string | null = null;

if (ownerEmail) {
  const { rows } = await query<{ user_id: string }>(
    'select user_id from users where email_normalized = lower($1)', [ownerEmail]);
  if (!rows[0]) {
    console.error(`No user with email ${ownerEmail}. Create one first, or omit --owner.`);
    process.exit(1);
  }
  ownerUserId = rows[0].user_id;
}
const { rows: managers } = await query<{ user_id: string }>(
  `select user_id from users where role in ('SALES_MANAGER','ADMIN') order by created_at limit 1`);
managerUserId = managers[0]?.user_id ?? null;

const existing = await query<{ n: number }>(
  'select count(*)::int as n from source_identities where provider = $1', [DEMO_MARKER]);
if (existing.rows[0]!.n > 0) {
  console.log(`[demo] ${existing.rows[0]!.n} demo accounts are already present. `
    + 'Run with --clear first to reseed.');
  await pool.end();
  process.exit(0);
}

const fixture = await seedPilotDemo({ ownerUserId, managerUserId });
console.log(`[demo] seeded ${fixture.accountIds.length} companies, all marked ${DEMO_MARKER}`);
console.log(`[demo] the hero company is Coastal Air & Heat (${fixture.targetAccountId})`);
console.log('[demo] walk it: /find?vertical=hvac&where=32256&ownership=UNCLAIMED&tier=B&ad=google_paid');
console.log('[demo] remove it again with --clear');
await pool.end();
