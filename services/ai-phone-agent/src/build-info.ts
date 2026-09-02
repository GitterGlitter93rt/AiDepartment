// What is actually running.
//
// "Deploy commit X, then verify the service is on commit X" is not
// answerable from /health unless the process can say which commit it
// started from. Resolved once at startup: the git checkout it is
// running out of, or GIT_COMMIT when the deployment is not a checkout
// (a container, a tarball). Never fatal — a service that will not boot
// because it cannot find git is worse than one that says 'unknown'.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface BuildInfo {
  /** Full commit SHA, or 'unknown'. */
  commit: string;
  /** First 7 characters — what a human compares. */
  shortCommit: string;
  /** Checked-out branch, or 'unknown'. */
  branch: string;
  /** True when the working tree has uncommitted changes. A live demo
   * service should never report this. */
  dirty: boolean;
  /** ISO timestamp of process start. */
  startedAt: string;
  source: 'git' | 'env' | 'unknown';
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function resolveBuild(): BuildInfo {
  const startedAt = new Date().toISOString();
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..', '..');

  const commit = git(['rev-parse', 'HEAD'], repoRoot);
  if (commit) {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot) ?? 'unknown';
    const status = git(['status', '--porcelain'], repoRoot);
    return {
      commit,
      shortCommit: commit.slice(0, 7),
      branch,
      dirty: Boolean(status && status.length > 0),
      startedAt,
      source: 'git',
    };
  }

  const fromEnv = process.env.GIT_COMMIT;
  if (fromEnv) {
    return {
      commit: fromEnv,
      shortCommit: fromEnv.slice(0, 7),
      branch: process.env.GIT_BRANCH ?? 'unknown',
      dirty: false,
      startedAt,
      source: 'env',
    };
  }

  return { commit: 'unknown', shortCommit: 'unknown', branch: 'unknown', dirty: false, startedAt, source: 'unknown' };
}

export const BUILD: BuildInfo = resolveBuild();
