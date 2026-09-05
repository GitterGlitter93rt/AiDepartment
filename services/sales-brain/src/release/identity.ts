import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Which build is this, and which schema does it expect.
 *
 * The failure this exists to make visible: the API and the worker are separate
 * processes, restarted separately, and a deploy that misses one leaves them running
 * different code against the same database. Every symptom of that appears somewhere
 * else -- a job type nothing can run, a column a page reads and the worker never
 * writes, a search that works from one process and not the other -- and none of
 * them says "these two are different builds".
 *
 * The runner already answers "no handler for this job type" with the sentence "it is
 * usually a worker running an older build than the queue it is serving." That
 * sentence was a guess. This makes it checkable.
 */

export interface BuildIdentity {
  /** The commit this build came from, or 'unknown' when nothing recorded one. */
  sha: string;
  /** How many migrations this build ships. Compare against what the database ran. */
  migrationsExpected: number;
}

let cached: BuildIdentity | null = null;

/**
 * Read once per process.
 *
 * BUILD_SHA is what a deploy sets. The git fallback is for a box where the code was
 * checked out rather than deployed -- which is every developer machine and the
 * EdgeXpert -- and it is allowed to fail silently, because a missing build id must
 * degrade to 'unknown' rather than stop a process from starting.
 */
export function buildIdentity(): BuildIdentity {
  if (cached) return cached;

  let sha = process.env['BUILD_SHA']?.trim() ?? '';
  if (!sha) {
    try {
      sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000 }).trim();
    } catch { sha = ''; }
  }

  let migrationsExpected = 0;
  try {
    const dir = new URL('../../migrations/', import.meta.url).pathname;
    migrationsExpected = readdirSync(dir).filter((file) => file.endsWith('.sql')).length;
  } catch { migrationsExpected = 0; }

  cached = { sha: sha || 'unknown', migrationsExpected };
  return cached;
}

/** Only for tests, which need to re-read after changing the environment. */
export function resetBuildIdentity(): void { cached = null; }
