import { closePool } from '../db/pool.js';
import { formatContactYield, measureContactYield } from '../research/contactYield.js';

/**
 * What the free stages produce, and what the cheapest paid one would cost.
 *
 *   npm run contact:yield
 *   npm run contact:yield -- --sample 250
 *   npm run contact:yield -- --json
 *
 * Read-only. The report exists so that a decision about buying contact data is taken
 * against measurements rather than impressions, and so that the same command can be run
 * again afterwards to say whether the money changed anything.
 */
const argv = process.argv.slice(2);
const sizeIndex = argv.indexOf('--sample');
const size = sizeIndex >= 0 ? Number(argv[sizeIndex + 1]) : 100;

const measured = await measureContactYield(Number.isFinite(size) ? size : 100);
console.log(argv.includes('--json')
  ? JSON.stringify(measured, null, 2)
  : formatContactYield(measured));
await closePool();
