/**
 * List import CLI.
 *
 *   npm run import -- --file ./list.csv --source "airtable-brent-2026-08" [--vertical hvac]
 *                     [--kind apollo_export] [--dry-run]
 *
 * Import never triggers outreach. Imported accounts land in shared inventory as
 * unclaimed, exactly like mined ones.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { closePool, query } from '../db/pool.js';
import { importCsvFile, formatImportReport } from '../import/importer.js';
import { syncVerticalProfiles } from '../domain/verticals.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const file = arg('file');
if (!file) {
  console.error('Usage: npm run import -- --file <path.csv> --source <name> [--vertical <id>] [--kind <kind>] [--dry-run]');
  process.exit(1);
}
const path = resolve(file);
if (!existsSync(path)) {
  console.error(`File not found: ${path}`);
  process.exit(1);
}

const vertical = arg('vertical') ?? null;
if (vertical) {
  await syncVerticalProfiles();
  const { rows } = await query('select 1 from vertical_profiles where vertical_profile_id = $1', [vertical]);
  if (rows.length === 0) {
    const available = await query<{ vertical_profile_id: string }>(
      'select vertical_profile_id from vertical_profiles order by 1',
    );
    console.error(
      `Unknown vertical "${vertical}". Available: ${available.rows.map((r) => r.vertical_profile_id).join(', ')}`,
    );
    process.exit(1);
  }
}

try {
  const report = await importCsvFile(path, {
    sourceName: arg('source') ?? path,
    sourceKind: (arg('kind') as never) ?? 'csv',
    defaultVerticalProfileId: vertical,
    dryRun: flag('dry-run'),
  });
  if (flag('dry-run')) console.log('DRY RUN — nothing was written.\n');
  console.log(formatImportReport(report));
} catch (error) {
  console.error(`Import failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
