import './setup.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../src/db/pool.js';
import { registeredJobTypes } from '../src/workers/runner.js';
import { availableDiscoveryAdapters, clearDiscoveryAdapters } from '../src/workers/marketMiner.js';
import { registerConfiguredDiscoveryAdapters } from '../src/miner/registry.js';
// Exactly what src/bin/worker.ts imports for its side effects, and nothing else.
// If that list and this one drift apart, the assertions below stop meaning anything,
// so the file itself is checked further down.
import '../src/workers/contactResearch.js';
import '../src/workers/marketMiner.js';

/**
 * One source of registration truth.
 * Authority: Issue #3 — provider registry parity; M-15.
 *
 * M-15 was not a bug in the DataForSEO adapter. Every part of it was correct: the
 * result contract, the task table, the payload, the budget, the governance gate. It
 * was constructed in one file for health reporting and never handed to the registry
 * the miner reads, so `availableDiscoveryAdapters()` returned an empty list whatever
 * the environment held. "Add the credentials" would not have worked, and nothing in
 * a suite of adapter tests could have said so.
 *
 * Registration by import side effect has that shape wherever it appears, and it
 * appears twice here: discovery adapters and job handlers. Both are checked, and the
 * check reads the entry points rather than trusting that two files were kept in step.
 */

after(async () => { await pool.end(); });

const SRC = new URL('../src/', import.meta.url).pathname;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (entry.endsWith('.ts')) found.push(path);
  }
  return found;
}

const FILES = sourceFiles(SRC);
function read(relative: string): string { return readFileSync(join(SRC, relative), 'utf8'); }

// -------------------------------------------------------- discovery adapters ----

test('exactly one place in the product registers a discovery adapter', () => {
  const callers = FILES.filter((file) => /registerDiscoveryAdapter\s*\(/.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(SRC.length))
    .filter((file) => file !== 'workers/marketMiner.ts'); // where it is defined

  assert.deepEqual(callers, ['miner/registry.ts'],
    'a second place registers providers, so which providers exist depends on which '
    + `file happened to be imported: ${callers.join(', ')}`);
});

test('both processes that need a provider go through that one place', () => {
  for (const entry of ['bin/api.ts', 'bin/worker.ts']) {
    assert.match(read(entry), /registerConfiguredDiscoveryAdapters/,
      `${entry} does not register providers, so it will answer "no provider is `
      + 'configured" while the other process is busy searching');
  }
});

test('an adapter constructed for a health check is not a registered adapter', () => {
  // The exact shape of M-15: settings.ts builds one to report on it. That is fine,
  // and it must never be mistaken for availability.
  const settings = FILES.find((file) => file.endsWith('/settings.ts'));
  if (settings) {
    const text = readFileSync(settings, 'utf8');
    if (/createDataForSeoAdapter/.test(text)) {
      assert.doesNotMatch(text, /registerDiscoveryAdapter/,
        'the health-check construction site also registers, which is two sources of truth');
    }
  }
  clearDiscoveryAdapters();
  assert.equal(availableDiscoveryAdapters().length, 0,
    'importing modules made a provider available without anybody registering one');
});

test('registering is idempotent, so two callers cannot double a provider', () => {
  clearDiscoveryAdapters();
  const env = {
    DATAFORSEO_LOGIN: 'parity@example.invalid', DATAFORSEO_PASSWORD: 'x',
    DATAFORSEO_ENABLED: 'true', DATAFORSEO_GOVERNANCE_REVIEWED: 'true',
  };
  registerConfiguredDiscoveryAdapters(env);
  registerConfiguredDiscoveryAdapters(env);
  assert.equal(availableDiscoveryAdapters().length, 1,
    'the API and the worker both registering produced two of the same provider, '
    + 'which would search twice and bill twice');
  clearDiscoveryAdapters();
});

// ------------------------------------------------------------- job handlers -----

/** Every job type the product can put on the queue. */
function enqueueableJobTypes(): string[] {
  const enqueue = read('workers/enqueue.ts');
  const types = new Set<string>();
  for (const match of enqueue.matchAll(/jobType:\s*'([a-z_]+)'/g)) types.add(match[1]!);
  for (const match of enqueue.matchAll(/enqueueJob\(\s*\{?\s*'([a-z_]+)'/g)) types.add(match[1]!);
  // The scheduler and the miner enqueue their own follow-up work.
  for (const file of ['workers/marketMiner.ts', 'workers/marketScheduler.ts']) {
    try {
      for (const match of read(file).matchAll(/jobType:\s*'([a-z_]+)'/g)) types.add(match[1]!);
    } catch { /* the file may not exist */ }
  }
  return [...types].sort();
}

test('every job type that can be queued has a handler in the worker', () => {
  const enqueueable = enqueueableJobTypes();
  assert.ok(enqueueable.length >= 3, `found only ${enqueueable.join(', ')}`);

  const registered = new Set(registeredJobTypes());
  const orphaned = enqueueable.filter((type) => !registered.has(type));
  assert.deepEqual(orphaned, [],
    `these job types can be enqueued and nothing can run them, so they would queue `
    + `for ever: ${orphaned.join(', ')}`);
});

test('the worker imports the modules that register those handlers', () => {
  const worker = read('bin/worker.ts');
  // A handler registers as a side effect of its module being imported. The worker
  // that forgets one serves a queue it cannot empty, and the symptom -- jobs sitting
  // in QUEUED for ever -- appears nowhere near the missing line.
  const registrars = FILES
    .filter((file) => /registerHandler\s*\(\s*'/.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(SRC.length).replace(/\.ts$/, '.js'));

  for (const module of registrars) {
    assert.match(worker, new RegExp(module.replace(/[/.]/g, '\\$&')),
      `bin/worker.ts never imports ${module}, so the job types it registers cannot run`);
  }
});

test('a job type nobody can run is not silently retried for ever', () => {
  // The runner answers this at runtime; the point here is that the answer names the
  // usual cause, because "no handler" alone sends an operator to the wrong place.
  const runner = read('workers/runner.ts');
  assert.match(runner, /No handler registered for job type/);
  assert.match(runner, /older build/,
    'the failure does not tell the operator that this is usually a version skew');
});
