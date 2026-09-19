import { writeFileSync } from 'node:fs';
import { supportBundle, renderSupportBundle } from '../release/supportBundle.js';
import { registerConfiguredDiscoveryAdapters } from '../miner/registry.js';
import { closePool } from '../db/pool.js';

/**
 * One file to hand over when something is wrong.
 *
 *   npm run support                      read it
 *   npm run support -- --json bundle.json  keep it, to send
 *
 * Safe to attach to an email: no credentials, no company names, no phone numbers, no
 * page content. The error text it does carry goes through the same redaction the
 * worker applies before storing a failure, because an exception from a database
 * driver carries the connection string.
 */
function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  return value && !value.startsWith('--') ? value : '';
}

registerConfiguredDiscoveryAdapters();

const bundle = await supportBundle();
const jsonPath = flag('json');
if (jsonPath) {
  writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`);
  process.stdout.write(`\n  written to ${jsonPath}\n`);
}
process.stdout.write(renderSupportBundle(bundle));
await closePool();
