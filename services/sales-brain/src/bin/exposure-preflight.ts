import { exposurePreflight, renderPreflight } from '../release/exposurePreflight.js';
import { closePool } from '../db/pool.js';

/**
 * Run before putting this portal behind a public hostname.
 *
 *   npm run preflight
 *
 * Exits non-zero when anything fails or is unchecked, so it can gate a deploy step
 * rather than only inform one.
 */
const report = await exposurePreflight();
process.stdout.write(renderPreflight(report));
await closePool();
process.exit(report.safeToExpose ? 0 : 1);
