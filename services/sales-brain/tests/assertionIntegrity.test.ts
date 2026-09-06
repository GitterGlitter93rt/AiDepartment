import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tests that cannot fail.
 *
 * Twice tonight a test of mine carried a correct name over an assertion of whatever
 * the code happened to do -- `registering twice does not double the provider`
 * asserting `first + 1`, and `a market with a provider task still owed is never
 * re-bought` asserting that the market is never *queued*, which is what stranded the
 * paid task. Both read as coverage. Neither was.
 *
 * No static check finds that; it is a question about meaning. But there is a
 * mechanical cousin worth catching, and it is how a good test quietly stops being
 * one: a `doesNotMatch` guarding a sentence the product no longer says. Rename the
 * copy and the guard passes for ever, still sitting in the file looking like
 * protection. The Brent tests forbid five sentences of product copy each; a wording
 * change would disarm all of them in silence.
 */

const TESTS_DIR = new URL('./', import.meta.url).pathname;
const SRC = new URL('../src/', import.meta.url).pathname;

function filesUnder(dir: string, suffix: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(path, suffix, found);
    else if (entry.name.endsWith(suffix)) found.push(path);
  }
  return found;
}

const TEST_FILES = readdirSync(TESTS_DIR).filter((file) => file.endsWith('.test.ts'));
const SOURCE = filesUnder(SRC, '.ts').map((file) => readFileSync(file, 'utf8')).join('\n');

test('every forbidden sentence is one the product can still say', () => {
  // Only prose: three or more spaces, no regex metacharacters. A single token like a
  // credential or an internal identifier is forbidden precisely because it should
  // never appear, so its absence from the source proves nothing either way.
  const orphaned: string[] = [];

  for (const file of TEST_FILES) {
    const text = readFileSync(join(TESTS_DIR, file), 'utf8');
    for (const match of text.matchAll(/assert\.doesNotMatch\([^,]+,\s*\/([^/\\]+)\//g)) {
      const phrase = match[1]!;
      if (/[[\](){}|+*?^$]/.test(phrase)) continue;
      if ((phrase.match(/ /g) ?? []).length < 3) continue;
      if (!SOURCE.includes(phrase)) orphaned.push(`${file}: "${phrase}"`);
    }
  }

  assert.deepEqual(orphaned, [],
    'these tests forbid sentences the product no longer contains, so they pass whatever '
    + `the code does and protect nothing:\n${orphaned.join('\n')}`);
});

test('no test in a file shares a name with another in the same file', () => {
  // Within one file, a repeated name is a copied test whose name was not updated:
  // the list reads as two covered properties and one of them is checking something
  // else. Across files it means nothing -- two subjects can honestly deserve the
  // same sentence, and "a provider failure is never spoken as a confirmed booking"
  // is a fair title in both booking and voice. My first version of this failed on
  // exactly those and would have pushed somebody to make two good names worse.
  const duplicates: string[] = [];
  let total = 0;

  for (const file of TEST_FILES) {
    const text = readFileSync(join(TESTS_DIR, file), 'utf8');
    const seen = new Set<string>();
    for (const match of text.matchAll(/^test\(\s*'((?:[^'\\]|\\.)*)'/gm)) {
      total += 1;
      const name = match[1]!;
      if (seen.has(name)) duplicates.push(`${file}: "${name}"`);
      seen.add(name);
    }
  }

  assert.deepEqual(duplicates, [],
    `these files define the same test name twice:\n${duplicates.join('\n')}`);
  assert.ok(total > 900, `only ${total} test names were found; the parser is wrong`);
});

test('no assertion compares a value with itself', () => {
  const tautologies: string[] = [];
  for (const file of TEST_FILES) {
    // This file names the patterns it looks for, so reading itself would report
    // itself.
    if (file === 'assertionIntegrity.test.ts') continue;
    const text = readFileSync(join(TESTS_DIR, file), 'utf8');
    for (const match of text.matchAll(
      /assert\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*[,)]/g,
    )) {
      if (match[1]!.trim() === match[2]!.trim()) tautologies.push(`${file}: ${match[0]}`);
    }
    for (const literal of ['assert.ok(true', 'assert.ok(1)']) {
      if (text.includes(literal)) tautologies.push(`${file}: ${literal}`);
    }
  }
  assert.deepEqual(tautologies, [], `assertions that cannot fail:\n${tautologies.join('\n')}`);
});

/**
 * Isolation between test files.
 * Authority: Issue #3 BJ.
 *
 * Each file spawns its own process, so a module-level registry cannot leak between
 * them -- but the database is shared, and a file that reads state a previous file
 * left behind passes in the suite and fails on its own. That is a test which reports
 * on whatever ran before it.
 *
 * Checked here rather than by running the suite twice: the whole suite in reverse
 * file order is `npm run test:isolation`, which is a several-minute proof and not
 * something to run inside itself.
 */

test('every file that touches the database resets it, or says why not', () => {
  // Two exemptions, both deliberate and both narrow. Neither reads product data.
  const exempt = new Set([
    // Builds and drops its own scratch databases; resetting the shared one would
    // destroy the very state it compares a fresh install against.
    'migrationHistory.test.ts',
    // Reads source files and the adapter registry. Its one database call is the
    // pool being closed.
    'registrationParity.test.ts',
  ]);

  const unreset: string[] = [];
  for (const file of TEST_FILES) {
    if (exempt.has(file)) continue;
    const text = readFileSync(join(TESTS_DIR, file), 'utf8');
    if (!text.includes('db/pool.js')) continue;
    if (!text.includes('resetDatabase')) unreset.push(file);
  }

  assert.deepEqual(unreset, [],
    'these files use the database and never reset it, so they pass or fail on state '
    + `left behind by whichever file ran before them:\n${unreset.join('\n')}`);
});

test('every file that opens the pool closes it', () => {
  // A pool left open holds the process past its last test. Node then reports the
  // file as passing while its connections sit in the database, and the next file's
  // reset can block behind them.
  const leaked: string[] = [];
  for (const file of TEST_FILES) {
    const text = readFileSync(join(TESTS_DIR, file), 'utf8');
    if (!text.includes('db/pool.js')) continue;
    if (!text.includes('pool.end()')) leaked.push(file);
  }
  assert.deepEqual(leaked, [], `these files never close the pool:\n${leaked.join('\n')}`);
});
