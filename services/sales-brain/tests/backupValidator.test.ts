import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The backup validator, and the five nights it called good dumps bad.
 *
 * `deploy/backup.sh` verified each dump with `zgrep -q "CREATE TABLE public.<table>"`
 * once per required table. `grep -q` exits at the first match and closes the pipe.
 * systemd runs services with `IgnoreSIGPIPE=yes`, so `gzip` received EPIPE instead of
 * dying quietly by signal, exited non-zero, and zgrep reported failure on a dump that
 * plainly contained the table. Run by hand the same command passed, which is why it
 * read as a database problem for five nights rather than a validator one.
 *
 * And because the loop stopped at the first failure, the message always named
 * `accounts` -- first in the required list -- so the symptom pointed at the one table
 * everybody then went looking for. Six tables were required and only one was ever
 * checked.
 *
 * These tests run the real script. `trap '' PIPE` reproduces systemd's signal
 * disposition exactly, which is what makes the historical condition reproducible in a
 * suite that has no systemd.
 *
 * No database and no `setup.js`: this exercises a shell script against gzip fixtures,
 * and a validator test that needed a live database would be testing the wrong thing.
 */

const VERIFY = 'deploy/verify-backup.sh';
const REQUIRED = ['accounts', 'contacts', 'contact_endpoints', 'suppressions',
  'ownership_events', 'follow_ups'];

/**
 * A dump-shaped archive declaring the given tables.
 *
 * Shaped like a real dump on purpose: the tables come near the top and the bulk comes
 * after. That is what makes the historical failure reproducible -- `grep -q` matches
 * early and closes the pipe while `gzip` still has most of the archive left to write,
 * which is exactly the situation in a real dump where `accounts` sits at line 300 of
 * eleven thousand. Tables at the end produce no EPIPE at all, and a test built that
 * way would pin nothing.
 *
 * The filler is sized from measurement rather than taste: 1,000 lines never
 * reproduced it, 20,000 reproduced it five times out of five, and this uses ten times
 * that for margin.
 */
function fixture(tables: string[]): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'backup-validator-'));
  const path = join(dir, 'fixture.sql.gz');
  const sql = [
    '--',
    '-- PostgreSQL database dump',
    '--',
    'SET statement_timeout = 0;',
    ...tables.flatMap((table) => [
      `CREATE TABLE public.${table} (`,
      '    id uuid NOT NULL',
      ');',
      '',
      `COPY public.${table} (id) FROM stdin;`,
      '\\.',
      '',
    ]),
    ...Array.from({ length: 200_000 }, (_, at) => `-- filler line ${at}`),
  ].join('\n');
  const plain = join(dir, 'fixture.sql');
  writeFileSync(plain, sql);
  execFileSync('gzip', ['-9', plain]);
  return { dir, path };
}

/** Runs the real validator, optionally with SIGPIPE ignored as systemd does. */
function verify(path: string, options: { ignoreSigpipe: boolean }) {
  const script = options.ignoreSigpipe
    ? `trap '' PIPE; exec ${VERIFY} "$1"`
    : `exec ${VERIFY} "$1"`;
  return spawnSync('bash', ['-c', script, 'verify', path], { encoding: 'utf8' });
}

test('a valid dump passes with SIGPIPE ignored, which is how systemd runs it', () => {
  const { dir, path } = fixture([...REQUIRED, 'jobs', 'evidence_records']);
  try {
    const ignored = verify(path, { ignoreSigpipe: true });
    assert.equal(ignored.status, 0,
      'a dump containing every required table was rejected under systemd signal '
      + `semantics, which is the five-night failure: ${ignored.stderr}`);
    assert.match(ignored.stdout, /all 6 required present/);

    // And identically without the trap, because the two must not disagree. They did
    // for five nights, and that disagreement is what hid the defect.
    const plain = verify(path, { ignoreSigpipe: false });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout.trim(), ignored.stdout.trim(),
      'the validator behaves differently by hand and under systemd');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the historical approach still fails under the same condition', () => {
  // Pins the cause rather than the symptom. If this ever passes, `zgrep -q` has
  // stopped being dangerous and the comment in the script needs revisiting -- but the
  // fix does not depend on that.
  const { dir, path } = fixture(REQUIRED);
  try {
    const old = spawnSync('bash', ['-c',
      `trap '' PIPE; set -euo pipefail; zgrep -q "CREATE TABLE public.accounts" "$1"`,
      'old', path], { encoding: 'utf8' });
    assert.notEqual(old.status, 0,
      'the old zgrep -q check no longer reproduces the historical failure, so this '
      + 'test is no longer pinning anything');

    // The same file, through the validator that replaced it.
    assert.equal(verify(path, { ignoreSigpipe: true }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every required table is still checked, one at a time', () => {
  // Not weakened. Each of the six, individually removed, must be caught -- the old
  // loop only ever reached the first.
  for (const missing of REQUIRED) {
    const { dir, path } = fixture(REQUIRED.filter((table) => table !== missing));
    try {
      const result = verify(path, { ignoreSigpipe: true });
      assert.equal(result.status, 1,
        `a dump missing ${missing} was accepted`);
      assert.match(result.stderr, new RegExp(`missing 1 of 6 required tables: ${missing}`),
        `the failure for a missing ${missing} does not name it: ${result.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('all missing tables are named, not just the first', () => {
  // The reporting defect behind the misdiagnosis: `accounts` was named every night
  // because the loop exited there, so nobody learned the other five were fine.
  const { dir, path } = fixture(['contacts', 'follow_ups', 'jobs']);
  try {
    const result = verify(path, { ignoreSigpipe: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing 4 of 6 required tables:/);
    for (const table of ['accounts', 'contact_endpoints', 'suppressions', 'ownership_events']) {
      assert.match(result.stderr, new RegExp(table), `${table} was not named`);
    }
    assert.match(result.stderr, /declares 3 tables in total/,
      'the failure does not say how much the dump did contain');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a corrupt archive fails before any table check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backup-validator-'));
  const path = join(dir, 'corrupt.sql.gz');
  try {
    writeFileSync(path, 'this is not gzip at all');
    const result = verify(path, { ignoreSigpipe: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a valid gzip archive/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a decompression failure fails the verification rather than being swallowed', () => {
  // The other way this could have gone wrong: ignoring the pipeline's exit status to
  // dodge the SIGPIPE problem would make a truncated dump validate clean.
  const dir = mkdtempSync(join(tmpdir(), 'backup-validator-'));
  const path = join(dir, 'truncated.sql.gz');
  try {
    const { dir: full, path: source } = fixture(REQUIRED);
    const bytes = readFileSync(source);
    // Half an archive: gzip -t rejects it, and so must the validator.
    writeFileSync(path, bytes.subarray(0, Math.floor(bytes.length / 2)));
    rmSync(full, { recursive: true, force: true });

    const result = verify(path, { ignoreSigpipe: true });
    assert.equal(result.status, 1, 'a truncated archive was accepted');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the missing-file and usage cases are distinguishable', () => {
  const missing = verify('/nonexistent/dump.sql.gz', { ignoreSigpipe: true });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /does not exist/);

  const usage = spawnSync('bash', ['-c', `exec ${VERIFY}`], { encoding: 'utf8' });
  assert.equal(usage.status, 2, 'no argument should be a usage error, not a failure');
  assert.match(usage.stderr, /usage:/);
});

test('backup.sh verifies before it rotates, and delegates to the same script', () => {
  // Ordering is what saved the historical dumps: validation exits non-zero before the
  // retention sweep is reached, so five nights of good backups were never pruned.
  const script = readFileSync('deploy/backup.sh', 'utf8');
  const verifyAt = script.indexOf('deploy/verify-backup.sh');
  const rotateAt = script.indexOf('-mtime "+${RETAIN_DAYS}" -delete');
  assert.ok(verifyAt > 0, 'backup.sh no longer delegates to the verifier');
  assert.ok(rotateAt > 0, 'the retention sweep is gone');
  assert.ok(verifyAt < rotateAt,
    'the retention sweep now runs before verification, so a bad backup could delete '
    + 'a good one');
  assert.ok(!/zgrep -q/.test(script),
    'backup.sh uses zgrep -q again, which is the five-night failure');
  assert.match(script, /set -euo pipefail/,
    'without set -e a failed verification would not stop the rotation');
});

test('backup.sh re-emits the verification so a failure says why', () => {
  // In a systemd user unit only the main process's streams reach the journal: a
  // child's stdout *and* stderr are both dropped, which was verified by experiment
  // on this box. Moving verification into its own script therefore risked making a
  // failed backup appear as a bare non-zero exit with no reason -- worse than the
  // misleading "missing table accounts" this change exists to fix, because that at
  // least named something.
  const script = readFileSync('deploy/backup.sh', 'utf8');
  assert.match(script, /VERIFICATION="\$\("\$PACKAGE_DIR\/deploy\/verify-backup\.sh"/,
    'backup.sh no longer captures the verifier output, so a failure would be silent '
    + 'in the journal');
  assert.match(script, /printf '%s\\n' "\$VERIFICATION" >&2/,
    'the captured diagnostics are not re-emitted on failure');
  assert.match(script, /printf '%s\\n' "\$VERIFICATION"\n/,
    'the captured confirmation is not re-emitted on success');
  assert.match(script, /nothing was rotated/,
    'a failed verification does not say that rotation was skipped');

  // Capturing must not become swallowing: the status is still checked.
  assert.match(script, /if ! VERIFICATION=/,
    'the verifier exit status is no longer checked');
  const exitAt = script.indexOf('BACKUP FAILED: verification of');
  const rotateAt = script.indexOf('-mtime "+${RETAIN_DAYS}" -delete');
  assert.ok(exitAt > 0 && exitAt < rotateAt,
    'the failure path does not precede the retention sweep');
});

test('the runtime guard refuses a tree that is not the Sales Brain', () => {
  // The other half of the incident: the services ran from the general checkout,
  // which was later switched to a website branch that does not track services/ at
  // all. The source, the migrations and backup.sh vanished while api and worker kept
  // running from an ignored dist for days, and nothing failed at the moment it broke.
  const guard = readFileSync('deploy/assert-runtime.sh', 'utf8');
  assert.match(guard, /EXPECTED_BRANCH="feature\/outbound-sales-brain"/,
    'the guard does not pin the branch it must run from');
  // Tracked-ness is the exact discriminator: those files existed as ignored
  // artefacts in the broken runtime and were absent as tracked source.
  assert.match(guard, /git ls-files --error-unmatch/,
    'the guard checks files exist rather than that they are tracked, which is the '
    + 'condition that made the orphaned runtime look fine');
  for (const required of ['deploy/backup.sh', 'deploy/verify-backup.sh', 'migrations']) {
    assert.ok(guard.includes(required), `the guard does not require ${required}`);
  }
  assert.match(guard, /mode is \$ENV_MODE, expected 600/,
    'the guard does not check that .env is not world-readable');

  // Running the guard for real. Which half of this is assertable depends on where
  // the tests are being run from, and that is the point rather than a workaround:
  // the runtime is now a *frozen* worktree pinned to feature/outbound-sales-brain,
  // and development happens in a separate worktree on its own branch. This test
  // previously assumed those were the same tree, so it could only pass while
  // engineers built inside the live runtime -- exactly the coupling that made an
  // ordinary edit able to stop the API restarting.
  const result = spawnSync('bash', ['deploy/assert-runtime.sh'], { encoding: 'utf8' });
  const onRuntimeBranch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
    { encoding: 'utf8' }).stdout.trim() === 'feature/outbound-sales-brain';

  if (onRuntimeBranch) {
    // In the runtime worktree the guard must accept, and must name the commit.
    assert.equal(result.status, 0,
      `the guard rejects its own runtime: ${result.stderr}`);
    assert.match(result.stdout, /on feature\/outbound-sales-brain at [0-9a-f]{7}/,
      'the guard does not report which commit is running');
  } else {
    // Anywhere else it must refuse, and say why in terms an operator can act on.
    // This is the safety-relevant half, and it is asserted unconditionally.
    assert.notEqual(result.status, 0,
      'the guard accepted a tree that is not the pinned runtime branch');
    assert.match(result.stderr, /RUNTIME REFUSED/);
    assert.match(result.stderr, /not feature\/outbound-sales-brain/,
      'the refusal does not say which branch it expected');
  }
});
