import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { captureDiagnostics } from '../src/release/doctor.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Block D: operator truth, audited as a property of the page rather than check by
 * check.
 *
 * Every one of these checks was written honestly. The risk is not that one of them
 * lies today; it is that an empty database makes eight of them say UNKNOWN, a green
 * page is what everybody wants, and turning an UNKNOWN into an OK is a one-line
 * change that nothing would otherwise notice. "0 of 0 accounts are stale, therefore
 * inventory freshness is OK" is arithmetically true and operationally false: there is
 * no inventory, which is a different problem and a worse one.
 *
 * So the distinction itself is pinned. A check whose subject is a population must not
 * report a positive judgment when that population is empty.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

function checkFor(snapshot: { checks: { id: string; state: string; value: string;
                                        detail?: string; question: string;
                                        dimension: string }[] }, id: string) {
  const found = snapshot.checks.find((check) => check.id === id);
  assert.ok(found, `the ${id} check is missing from the snapshot`);
  return found!;
}

/**
 * The checks that judge a population, and must say UNKNOWN rather than OK when there
 * is no population to judge. Each one, spelled out, because the list is the claim.
 */
const POPULATION_CHECKS = [
  ['inventory_freshness', 'no accounts exist, so none of them can be stale'],
  ['unclaimed', 'no accounts exist, so none of them are unclaimed'],
  ['reps', 'nobody is set up, which is not the same as everybody being set up'],
  ['markets', 'no market is enabled, so nothing is being maintained on its own'],
  ['duplicates', 'no accounts exist, so none of them are duplicates'],
] as const;

test('D1 an empty database does not produce a green page', async () => {
  const snapshot = await operationalSnapshot();

  for (const [id, why] of POPULATION_CHECKS) {
    const check = checkFor(snapshot, id);
    assert.equal(check.state, 'UNKNOWN',
      `${id} reported ${check.state} on an empty database: ${why}`);
  }

  // And the one check whose OK is load-bearing is still allowed to be OK, because
  // "outbound calling is off" is a real answer about a real switch rather than a
  // judgment about an absent population.
  assert.equal(checkFor(snapshot, 'outbound_ai').state, 'OK');
});

test('D1 the population checks become real judgments once there is a population',
  async () => {
  // The other half: UNKNOWN must not be a permanent hiding place either. Give each
  // check something to judge and it has to judge it.
  await makeUser('D1 Rep', 'SALES_REP');
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Block D Fresh Co',
    website: 'https://blockd-fresh.invalid', phone: '904-555-8801',
    city: 'St. Augustine', state: 'FL', postalCode: '32095', verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));
  await query(
    `insert into saved_markets (name, vertical_profile_id, geography_type,
                                geography_definition, mining_mode, enabled)
     values ('Block D Market', 'hvac', 'zip_zcta',
             jsonb_build_object('value','32095'), 'advertiser_first', true)`);

  const snapshot = await operationalSnapshot();
  for (const id of ['inventory_freshness', 'unclaimed', 'reps', 'markets']) {
    const check = checkFor(snapshot, id);
    assert.notEqual(check.state, 'UNKNOWN',
      `${id} still says UNKNOWN when it has something to judge, so UNKNOWN is being `
      + 'used as a way of never being wrong');
  }
});

test('D1 every check names a question, a dimension and a value', async () => {
  // A check that arrives without a question is a number on a page. This is what stops
  // one being added that way.
  const snapshot = await operationalSnapshot();
  assert.ok(snapshot.checks.length >= 20,
    `only ${snapshot.checks.length} checks were produced`);
  const dimensions = new Set<string>();
  for (const check of snapshot.checks) {
    assert.ok(check.id.length > 0);
    assert.match(check.question, /\?$/,
      `${check.id}: "${check.question}" is not a question an operator asked`);
    assert.ok(check.value.length > 0, `${check.id} has no value`);
    assert.ok(['OK', 'ATTENTION', 'BLOCKED', 'UNKNOWN'].includes(check.state),
      `${check.id} has state "${check.state}"`);
    dimensions.add(check.dimension);
  }
  // Several axes, not one bucket: "can we search" and "may we afford to" are
  // different questions and a single tally of them answers neither.
  assert.ok(dimensions.size >= 4,
    `every check landed in ${dimensions.size} dimension(s)`);
});

test('D1 the summary counts agree with the checks they summarise', async () => {
  // The counts are what a dashboard renders when it does not render the checks. If
  // they can disagree, the page and the number beside it are two different reports.
  const snapshot = await operationalSnapshot();
  const tally: Record<string, number> = { OK: 0, ATTENTION: 0, BLOCKED: 0, UNKNOWN: 0 };
  for (const check of snapshot.checks) tally[check.state] = (tally[check.state] ?? 0) + 1;
  assert.deepEqual(snapshot.counts, tally);
  assert.equal(
    Object.values(snapshot.counts).reduce((total, n) => total + n, 0),
    snapshot.checks.length);
});

test('D1 the safety switch is BLOCKED when it cannot prove it is off', async () => {
  // The most important line on the page, and the one place where absence of evidence
  // must read as the alarming answer rather than the reassuring one. With no
  // voice_pilot_state row at all the mode is unknown, and unknown is not off.
  await query('delete from voice_pilot_state');
  const snapshot = await operationalSnapshot();
  const outbound = checkFor(snapshot, 'outbound_ai');
  assert.notEqual(outbound.state, 'OK',
    'with no settings row to read, the page said outbound AI calling was off');
  assert.equal(outbound.state, 'BLOCKED');
});

// =============================================================================
// D2 · two reports of the same facts must not disagree
// =============================================================================

/**
 * The operations page and `npm run doctor` are separate readers built at separate
 * times, and they both report the schema, the queue and the saved markets. Two
 * reports of one fact is how an operator ends up trusting whichever one they happened
 * to open -- and the specific way that has already bitten this project is a reader
 * that answers from its own process rather than from the database: systemd said the
 * worker was active while the database said no worker had ever reported in.
 *
 * Not a claim that the two should say the same words. A claim that where they both
 * report a number, it is the same number.
 */
test('D2 the doctor and the operations page agree about the schema and the queue',
  async () => {
  // Something in the queue and something in the markets, so the numbers are not all
  // zero and an accidental agreement at zero proves nothing.
  await query(
    `insert into jobs (job_type, payload, priority) values ('blockd_never','{}'::jsonb,50)`);
  await query(
    `insert into jobs (job_type, payload, priority) values ('blockd_never_2','{}'::jsonb,50)`);
  await query(
    `insert into saved_markets (name, vertical_profile_id, geography_type,
                                geography_definition, mining_mode, enabled)
     values ('Block D Agree', 'hvac', 'zip_zcta',
             jsonb_build_object('value','32096'), 'advertiser_first', true)`);

  const [snapshot, diagnostics] = await Promise.all([
    operationalSnapshot(), captureDiagnostics(),
  ]);

  // Schema: the doctor's applied count and the page's value are the same fact.
  const schema = checkFor(snapshot, 'schema');
  assert.match(schema.value, new RegExp(`^${diagnostics.schema.applied} applied`),
    `the page says "${schema.value}" and the doctor says `
    + `${diagnostics.schema.applied} applied`);

  // Queue depth: both count QUEUED jobs.
  const queue = checkFor(snapshot, 'queue');
  assert.match(queue.value, new RegExp(`^${diagnostics.queue.queued} queued`),
    `the page says "${queue.value}" and the doctor says `
    + `${diagnostics.queue.queued} queued`);

  // Enabled markets.
  const markets = checkFor(snapshot, 'markets');
  assert.match(markets.value, new RegExp(`^${diagnostics.savedMarkets.enabled} enabled`),
    `the page says "${markets.value}" and the doctor says `
    + `${diagnostics.savedMarkets.enabled} enabled`);

  // And neither invented a worker. This is the exact shape of the failure that
  // started this: a reader answering from its own process instead of the database.
  assert.equal(diagnostics.workers.online, 0);
  // BLOCKED rather than UNKNOWN, and deliberately so: there are two jobs waiting and
  // nothing has ever reported in to serve them. "We do not know" would be the wrong
  // answer -- what is known is that this work is going nowhere. I asserted UNKNOWN
  // here first and the page was right and I was wrong.
  assert.equal(checkFor(snapshot, 'worker').state, 'BLOCKED');
  assert.match(String(checkFor(snapshot, 'worker').detail), /nothing is serving them/i);
});

test('D2 a pending migration is reported as pending by both readers', async () => {
  // The disagreement that matters most, because it is the one that makes every other
  // number suspect: a build whose schema is behind it.
  const diagnostics = await captureDiagnostics();
  const snapshot = await operationalSnapshot();
  const schema = checkFor(snapshot, 'schema');

  if (diagnostics.schema.pending.length === 0) {
    // The state of a correctly migrated test database, asserted rather than assumed:
    // if this ever stops being true the test below is measuring nothing.
    assert.equal(schema.state, 'OK');
  } else {
    assert.notEqual(schema.state, 'OK',
      `the doctor found ${diagnostics.schema.pending.length} pending migration(s) `
      + 'and the page still reported the schema as OK');
  }
  assert.deepEqual(diagnostics.schema.changed, [],
    'a migration was edited after it was applied');
});
