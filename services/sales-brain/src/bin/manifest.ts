import { readFileSync, writeFileSync } from 'node:fs';
import { releaseManifest, renderManifest, compareManifests } from '../release/manifest.js';
import { closePool } from '../db/pool.js';

/**
 * What this build is, to archive beside a deploy.
 *
 *   npm run manifest                          read it
 *   npm run manifest -- --json m.json         keep it
 *   npm run manifest -- --compare old.json    what changed since that one
 *
 * The doctor says what state the system is in. This says what is running, which is
 * the other half of "what changed between the run that worked and the one that did
 * not". Carries no secrets: whether a credential is present is a fact about the
 * build, its value is not.
 */
function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  return value && !value.startsWith('--') ? value : '';
}

const manifest = await releaseManifest();

const comparePath = flag('compare');
if (comparePath) {
  const before = JSON.parse(readFileSync(comparePath, 'utf8')) as typeof manifest;
  const changes = compareManifests(before, manifest);
  process.stdout.write(changes.length === 0
    ? `\n  Nothing changed since ${before.generatedAt}.\n\n`
    : `\n  Changed since ${before.generatedAt}:\n`
      + changes.map((change) => `     ${change}`).join('\n') + '\n\n');
  await closePool();
  process.exit(0);
}

const jsonPath = flag('json');
if (jsonPath) {
  writeFileSync(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`\n  written to ${jsonPath}\n`);
}
process.stdout.write(renderManifest(manifest));
await closePool();
