import { validateProfiles, renderViolations, BLOCKING } from '../domain/profileContract.js';
import { closePool } from '../db/pool.js';

/**
 * Whether every active vertical profile says only things the runtime understands.
 *
 *   npm run profiles:validate
 *
 * Exits non-zero when a profile references something no canonical signal defines.
 * A signal that is understood but not collectable is printed and does not fail:
 * that is a source we do not have, not a mistake somebody made.
 */
const violations = await validateProfiles();
process.stdout.write(renderViolations(violations));
const blocking = violations.filter((violation) => BLOCKING.has(violation.kind)).length;
await closePool();
process.exit(blocking > 0 ? 1 : 0);
