import { loadPolicy } from '../retention/policy.js';
import { planRetention, renderRetentionPlan } from '../retention/plan.js';
import { closePool } from '../db/pool.js';

/**
 * What a retention run would delete, if there were a policy.
 *
 *   npm run retention:plan                      inventory: what exists, how old
 *   npm run retention:plan -- --policy p.json   what that policy would delete
 *
 * There is no apply command in this build. Not a flag that refuses, not a guarded
 * path -- no code that deletes any of it. INPUT-006 is Michael's decision, and an
 * engine that could act on a policy nobody has written is an engine one typo away
 * from deleting the provenance behind every score in the system.
 */
function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  return value && !value.startsWith('--') ? value : '';
}

const { policy, error } = await loadPolicy(flag('policy') || null);
const plan = await planRetention(policy, error);
process.stdout.write(renderRetentionPlan(plan));
await closePool();
process.exit(error ? 1 : 0);
