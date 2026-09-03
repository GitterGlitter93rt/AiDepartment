import { syncVerticalProfiles } from '../domain/verticals.js';
import { closePool } from '../db/pool.js';

const count = await syncVerticalProfiles();
console.log(`[verticals] synced ${count} vertical profiles from the repository.`);
await closePool();
