import { canaryPacket, renderCanaryPacket } from '../release/canaryPacket.js';
import { closePool } from '../db/pool.js';

/**
 * What a first paid search would need, do, and prove.
 *
 *   npm run canary:packet
 *   npm run canary:packet -- --vertical hvac --location 32256 --count 3
 *
 * Executes nothing. Contacts no provider, needs no credential, writes nothing.
 * Environment variables are reported by name and presence only, because a readiness
 * packet is something you paste into a message.
 */
function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  return value && !value.startsWith('--') ? value : null;
}

const packet = await canaryPacket({
  vertical: flag('vertical') ?? undefined,
  location: flag('location') ?? undefined,
  count: flag('count') ? Number(flag('count')) : undefined,
  maxCostCents: flag('max-cost-cents') ? Number(flag('max-cost-cents')) : undefined,
});
process.stdout.write(renderCanaryPacket(packet));
await closePool();
