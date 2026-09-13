import { statfsSync } from 'node:fs';
import { growthProjection, renderGrowth } from '../release/growthProjection.js';
import { closePool } from '../db/pool.js';

/**
 * How big this gets if nobody intervenes.
 *
 *   npm run growth
 *
 * Reports only. Deciding what to delete, and after how long, is a business call
 * about how much provenance is worth keeping -- not something a report should make
 * on somebody's behalf.
 */
let diskBytesAvailable: number | null = null;
try {
  const stats = statfsSync(process.cwd());
  diskBytesAvailable = Number(stats.bavail) * Number(stats.bsize);
} catch { diskBytesAvailable = null; }

process.stdout.write(renderGrowth(await growthProjection({ diskBytesAvailable })));
await closePool();
