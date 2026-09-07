import { marketCoverage, renderMarketCoverage, recordSaturation } from '../miner/coveragePlan.js';
import { closePool, query } from '../db/pool.js';

/**
 * How much of a market we have, and what we have not asked.
 *
 *   npm run coverage -- --vertical roofing --location 32095
 *   npm run coverage -- --market <market-id>
 *
 * Reads only, except for recording the saturation conclusion against a saved market
 * -- the column has existed since the table was written and nothing has ever set it.
 */
function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  return value && !value.startsWith('--') ? value : '';
}

const marketId = flag('market') || null;
let vertical = flag('vertical') || null;
let location = flag('location') || null;

if (marketId) {
  const { rows } = await query<{
    vertical_profile_id: string | null; geography_definition: Record<string, unknown>;
  }>('select vertical_profile_id, geography_definition from saved_markets where market_id = $1',
    [marketId]);
  if (!rows[0]) {
    process.stderr.write(`\nNo saved market ${marketId}.\n\n`);
    await closePool();
    process.exit(2);
  }
  vertical = vertical ?? rows[0].vertical_profile_id;
  location = location ?? String(rows[0].geography_definition?.['value'] ?? '');
}

const coverage = await marketCoverage({ vertical, location, marketId });
process.stdout.write(renderMarketCoverage(coverage));

if (marketId) {
  await recordSaturation(marketId, coverage.saturation);
  process.stdout.write(`  saturation recorded against the saved market.\n\n`);
}
await closePool();
