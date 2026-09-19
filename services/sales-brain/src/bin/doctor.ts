import { writeFileSync } from 'node:fs';
import {
  captureDiagnostics, diagnose, diagnoseRun, renderDiagnostics,
} from '../release/doctor.js';
import { registerConfiguredDiscoveryAdapters } from '../miner/registry.js';
import { closePool } from '../db/pool.js';

/**
 * What state is this system in, and where does it look like it broke.
 *
 *   npm run doctor                     read it
 *   npm run doctor -- --json out.json  keep it, to compare with a later one
 *   npm run doctor -- --run <job-id>   judge one run rather than the whole database
 *
 * Safe to run at any time and safe to paste anywhere: it reads, never writes, and
 * carries no credentials or provider response bodies.
 */
function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  return value && !value.startsWith('--') ? value : '';
}

registerConfiguredDiscoveryAdapters();

const state = await captureDiagnostics();
const runId = flag('run');
const diagnoses = runId ? await diagnoseRun(runId) : diagnose(state);

const jsonPath = flag('json');
if (jsonPath) {
  writeFileSync(jsonPath, `${JSON.stringify({ state, diagnoses }, null, 2)}\n`);
  process.stdout.write(`\n  written to ${jsonPath}\n`);
}
process.stdout.write(renderDiagnostics(state, diagnoses));
await closePool();
