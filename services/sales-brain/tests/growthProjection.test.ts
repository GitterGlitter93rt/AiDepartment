import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { growthProjection, renderGrowth, formatBytes } from '../src/release/growthProjection.js';

/**
 * How big this gets if nobody intervenes.
 * Authority: Issue #3 BN.
 *
 * Most tables here are bounded by how many companies exist in the markets we watch,
 * which is a number that stops growing. A few are bounded by how long the system has
 * been running -- one row per job, per provider call, per sighting, for ever -- and
 * those decide when somebody gets woken up by a full disk on the EdgeXpert.
 *
 * The property this file mostly defends is the refusal to answer. My first version
 * of the report happily printed "fills in about 13,592,230 days" from a database
 * holding four megabytes and one job row: bytes-per-row measured on a table that is
 * almost entirely empty pages, multiplied by a rate measured over minutes. Somebody
 * would have planned around that number.
 */

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

test('an empty database gives no date, and says why', async () => {
  const projection = await growthProjection({ diskBytesAvailable: 500 * 1024 ** 3 });

  assert.equal(projection.tooEarlyToProject, true);
  assert.equal(projection.daysUntilFull, null,
    'a date was projected from a database with nothing in it');
  assert.equal(projection.bytesPerDay, 0);
  assert.match(projection.summary, /deliberately gives no date/);
  assert.match(projection.summary, /ask again/,
    'the report does not say what would make it answerable');
});

test('a handful of rows is not a growth rate', async () => {
  // Enough to look like data and nowhere near enough to extrapolate from.
  for (let index = 0; index < 40; index += 1) {
    await query(
      `insert into provider_usage (provider, operation, requested_at, completed_at,
                                   units, estimated_cost_usd, status)
       values ('growth', 'serp.discover', now() - ($1 || ' hours')::interval, now(),
               1, 0.006, 'OK')`, [String(index)]);
  }

  const projection = await growthProjection({ diskBytesAvailable: 500 * 1024 ** 3 });
  const usage = projection.tables.find((table) => table.table === 'provider_usage')!;
  assert.equal(usage.rowsPerDay, null, '40 rows produced a rate');
  assert.match(usage.rateUnavailable ?? '', /too few for the size per row/);
  assert.equal(projection.daysUntilFull, null);
});

test('the tables that grow with the clock are named, and marked unpruned', async () => {
  const projection = await growthProjection();
  const byName = new Map(projection.tables.map((table) => [table.table, table]));

  // The four that grow per run rather than per company in the market.
  for (const table of ['jobs', 'search_observations', 'provider_usage', 'provider_tasks']) {
    assert.equal(byName.get(table)?.unpruned, true,
      `${table} is not marked as growing without a retention policy`);
  }

  // And the ones housekeeping does clear are not counted as a leak.
  assert.equal(byName.get('sessions')?.unpruned, false);
  assert.equal(byName.get('login_attempts')?.unpruned, false);
});

test('the fastest-growing table says the thing that makes it fastest', async () => {
  const projection = await growthProjection();
  const observations = projection.tables.find(
    (table) => table.table === 'search_observations')!;
  assert.match(observations.note, /one row per business per search/i);
  // The retention_class column is written on every row and read by nothing. Naming
  // it here is how the decision gets made rather than discovered.
  assert.match(observations.note, /retention_class that nothing reads/);
});

test('a table bounded by the market is not reported as growing for ever', async () => {
  const projection = await growthProjection();
  const accounts = projection.tables.find((table) => table.table === 'accounts')!;
  assert.equal(accounts.unpruned, false);
  assert.match(accounts.note, /bounded by how many companies/i);
  assert.equal(accounts.rowsPerDay, null);
});

test('the report reads as something an operator can act on', async () => {
  const rendered = renderGrowth(await growthProjection());
  assert.match(rendered, /DATABASE GROWTH/);
  assert.match(rendered, /not enough data to give a rate/,
    'a database with nothing in it did not say so in the output');
  assert.doesNotMatch(rendered, /NaN|Infinity/,
    'the report printed a number arithmetic produced and nobody can use');
});

test('byte counts are readable rather than exact', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 kB');
  assert.equal(formatBytes(5 * 1024 ** 2), '5.0 MB');
  assert.equal(formatBytes(3 * 1024 ** 3), '3.00 GB');
});
