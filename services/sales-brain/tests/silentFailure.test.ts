import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { flag, numeric } from '../src/config.js';
import { dailyBudgetUsd, assumedRunCostUsd, spendPosition } from '../src/miner/spend.js';
import { planRetention } from '../src/retention/plan.js';
import { NO_POLICY } from '../src/retention/policy.js';
import { releaseManifest } from '../src/release/manifest.js';
import { exposurePreflight } from '../src/release/exposurePreflight.js';
import { buildIdentity, resetBuildIdentity } from '../src/release/identity.js';
import { planCanary } from '../src/miner/canary.js';

/**
 * Failures that told nobody.
 * Authority: Issue #3 W.
 *
 * The last item in the queue, and the one that had to be done by reading rather than
 * running: every case here is a path where the system already behaved wrongly and
 * every test stayed green, because the wrong behaviour was to say nothing.
 *
 * Three of them are the same mistake. A number read from the environment with
 * `Number()` becomes NaN when the value is not a number, and every comparison
 * against NaN is false -- so `if (spent > budget) refuse` does not refuse, and the
 * ceiling an operator believes they set is not there. It reached the daily spend
 * ceiling, the DNC snapshot staleness block and a webhook's replay window: money,
 * compliance and authentication, from one coercion.
 */

const NUMERIC_KEYS = [
  'DISCOVERY_DAILY_BUDGET_USD', 'DISCOVERY_ASSUMED_RUN_COST_USD',
  'DNC_SNAPSHOT_BLOCK_HOURS', 'SMARTLEAD_WEBHOOK_TOLERANCE_SECONDS',
];

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => {
  for (const key of NUMERIC_KEYS) delete process.env[key];
  delete process.env['OUTBOUND_DIAL_ENABLED'];
  resetBuildIdentity();
  await pool.end();
});
beforeEach(async () => {
  for (const key of NUMERIC_KEYS) delete process.env[key];
  delete process.env['OUTBOUND_DIAL_ENABLED'];
});

// ------------------------------------------- a ceiling that is not a number -----

test('a budget nobody can parse is refused, not read as no budget', () => {
  // `$20` is what a person writes when asked for a dollar amount. Read with
  // Number() it is NaN, `!(NaN > 0)` is true, and the ceiling reports itself as
  // unset -- so a 24/7 miner spends the night against a limit that was typed in.
  for (const written of ['$20', '20 USD', 'twenty', '20,00', '2O']) {
    process.env['DISCOVERY_DAILY_BUDGET_USD'] = written;
    assert.throws(() => dailyBudgetUsd(),
      (error: Error) => error.message.includes('DISCOVERY_DAILY_BUDGET_USD')
        && error.message.includes(written),
      `"${written}" was accepted as a spend ceiling`);
  }
});

test('an unset budget still means no ceiling, which is the documented behaviour', () => {
  assert.equal(dailyBudgetUsd(), 0);
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '';
  assert.equal(dailyBudgetUsd(), 0, 'an empty value is unset, not malformed');
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '20';
  assert.equal(dailyBudgetUsd(), 20);
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '20.50';
  assert.equal(dailyBudgetUsd(), 20.5);
});

test('the assumed run cost is the other half of the same ceiling', async () => {
  // A valid budget with an unreadable run cost is still no ceiling: the comparison
  // is `spent + assumed > budget`, and NaN on either side makes it false.
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '1.00';
  process.env['DISCOVERY_ASSUMED_RUN_COST_USD'] = 'five cents';
  assert.throws(() => assumedRunCostUsd(), /DISCOVERY_ASSUMED_RUN_COST_USD/);
  await assert.rejects(() => spendPosition(), /DISCOVERY_ASSUMED_RUN_COST_USD/,
    'a run priced in words was allowed to proceed against a real budget');
});

test('a negative ceiling is a typo, not a ceiling of minus twenty', () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '-20';
  assert.throws(() => dailyBudgetUsd(), /DISCOVERY_DAILY_BUDGET_USD/);
});

test('the same rule covers the compliance and authentication windows', async () => {
  // Same coercion, different consequence. The DNC snapshot block is what stops a
  // call being made against a scrub list of unknown age; the webhook tolerance is
  // what stops a captured request being replayed.
  const { defaultFreshnessPolicy } = await import('../src/compliance/dncProvider.js');
  assert.throws(
    () => defaultFreshnessPolicy({ DNC_SNAPSHOT_BLOCK_HOURS: 'a month' } as any),
    /DNC_SNAPSHOT_BLOCK_HOURS/,
    'a scrub-list staleness block that cannot be parsed never fires');

  const { smartleadWebhookConfig } = await import('../src/email/smartleadWebhook.js');
  assert.throws(
    () => smartleadWebhookConfig({ SMARTLEAD_WEBHOOK_TOLERANCE_SECONDS: '5 minutes' } as any),
    /SMARTLEAD_WEBHOOK_TOLERANCE_SECONDS/,
    'a replay window that cannot be parsed accepts every timestamp');
});

test('numeric() itself is the one rule, and it says which variable', () => {
  assert.equal(numeric('NOT_SET_ANYWHERE_X', 7), 7);
  process.env['NOT_SET_ANYWHERE_X'] = 'nope';
  try {
    assert.throws(() => numeric('NOT_SET_ANYWHERE_X', 7),
      /NOT_SET_ANYWHERE_X.*"nope"|"nope".*NOT_SET_ANYWHERE_X/s);
    // A bound is part of the meaning: a poll count of zero collects nothing.
    process.env['NOT_SET_ANYWHERE_X'] = '0';
    assert.throws(() => numeric('NOT_SET_ANYWHERE_X', 7, { min: 1 }), /at least 1/);
  } finally { delete process.env['NOT_SET_ANYWHERE_X']; }
});

// ------------------------------------ one word, two meanings, three readers -----

test('what arms the dialler and what reports it armed are the same reader', async () => {
  // The live defect: config accepted 'true', '1' and 'yes'; the release manifest and
  // the exposure preflight each tested `=== 'true'`. So OUTBOUND_DIAL_ENABLED=1
  // armed outbound dialling while the preflight page said exposure could not cause a
  // call. True of the code, false of the screen.
  for (const written of ['true', '1', 'yes', 'on']) {
    process.env['OUTBOUND_DIAL_ENABLED'] = written;
    assert.equal(flag('OUTBOUND_DIAL_ENABLED', false), true, written);

    const manifest = await releaseManifest();
    assert.equal(manifest.safety.outboundDialEnabled, true,
      `the manifest reports dialling disabled while "${written}" arms it`);

    const preflight = await exposurePreflight();
    const dial = preflight.checks.find((check) => check.id === 'outbound_dialling')!;
    assert.notEqual(dial.state, 'PASS',
      `the preflight reassures that exposure cannot cause a call while "${written}" arms it`);
  }
});

test('false in any of its spellings is still false', () => {
  for (const written of ['false', '0', 'no', 'off', '']) {
    process.env['OUTBOUND_DIAL_ENABLED'] = written;
    assert.equal(flag('OUTBOUND_DIAL_ENABLED', false), false, written);
  }
});

test('a flag set to something unrecognised is a typo, and says so', () => {
  process.env['OUTBOUND_DIAL_ENABLED'] = 'disabled?';
  assert.throws(() => flag('OUTBOUND_DIAL_ENABLED', false),
    /OUTBOUND_DIAL_ENABLED/,
    'a value nobody can interpret was interpreted');
});

// ------------------------------------------ reports that omit what they lack ----

test('a table the retention plan cannot read is named, not dropped', async () => {
  // The plan is the artefact an operator approves. A table it silently omitted would
  // be a deletion nobody signed for -- or, as here, an inventory that understates
  // what the database holds.
  await query('alter table search_observations rename to search_observations_hidden');
  try {
    const plan = await planRetention(NO_POLICY);
    const entry = plan.tables.find((table) => table.table === 'search_observations');
    assert.ok(entry, 'the table vanished from the plan instead of being reported');
    assert.equal(entry!.totalRows, -1);
    assert.match(entry!.unreadableReason ?? '', /does not exist|could not be read/i);
  } finally {
    await query('alter table search_observations_hidden rename to search_observations');
  }
});

test('a migration count nobody could read is not the number zero', async () => {
  // 0 shipped against 44 applied reads as "the database is ahead of the build", which
  // sends support looking for a migration that was never the problem. The truth is
  // that this build could not count its own migrations.
  const identity = buildIdentity();
  assert.equal(typeof identity.migrationsExpected, 'number');
  assert.ok((identity.migrationsExpected ?? 0) > 0, 'this checkout has migrations');

  resetBuildIdentity();
  const broken = buildIdentity({ migrationsDir: '/nonexistent-path-for-this-test' });
  assert.equal(broken.migrationsExpected, null,
    'an unreadable migrations directory was reported as shipping none');
  resetBuildIdentity();

  // And it is a finding, not just a blank in a line of text: honest is not the same
  // as actionable, and the fix is not the one BUILD_SKEW usually points at.
  // Built from a real reading with one field changed, rather than a hand-made shape:
  // a fixture that has to invent the whole object stops testing the real one.
  const { diagnose, captureDiagnostics } = await import('../src/release/doctor.js');
  const real = await captureDiagnostics();
  const found = diagnose({
    ...real, build: { ...real.build, migrationsExpected: null },
  });
  assert.ok(found.some((diagnosis) => /could not count the migrations/.test(diagnosis.finding)),
    'a build that cannot count its own migrations produced no finding');
});

test('a provider validation that ran no checks does not say OK', async () => {
  const { rollUp } = await import('../src/providers/validation.js');
  const empty = rollUp('somebody', []);
  assert.notEqual(empty.status, 'OK',
    'a provider nothing was asked about was reported as working');
  assert.ok(empty.checks.length > 0, 'the reason it cannot be judged is not recorded');
});

// -------------------------------------------------- money guards that failed ----

test('a canary that cannot read the spend position refuses the live run', async () => {
  // The old comment said "reporting only". Two lines later the value decided a
  // refusal, so a failure to read today's spend removed the daily ceiling from a
  // live run rather than stopping it.
  //
  // Broken the way it would actually break -- the query fails -- rather than through
  // an injection point that exists only for this test.
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '1.00';
  await query('alter table provider_usage rename to provider_usage_hidden');
  try {
    const live = await planCanary({
      vertical: 'roofing', location: '32095', count: 3, maxCostCents: 10,
      live: true, confirmSpendCents: 10,
    });
    assert.ok(live.refusals.some((refusal) => refusal.code === 'SPEND_UNKNOWN'),
      'a live run proceeded without knowing what today has already cost: '
      + live.refusals.map((refusal) => refusal.code).join(', '));

    // Dry is free, so it is allowed to be incomplete -- but it has to say so rather
    // than print a spend line of zero as though that were the position.
    const dry = await planCanary({
      vertical: 'roofing', location: '32095', count: 3, maxCostCents: 10,
    });
    assert.ok(dry.refusals.some((refusal) => refusal.code === 'SPEND_UNKNOWN'),
      'the dry run printed a spend position it could not read');
  } finally {
    await query('alter table provider_usage_hidden rename to provider_usage');
  }
});

test('an empty gate list does not clear a real pilot', async () => {
  // Same vacuous truth as the roll-up above, in the artefact that authorises calls
  // to real people: `filter(...).length === 0` over an empty list is zero failures,
  // and zero failures read as eligible.
  const { REAL_PILOT_GATES, INTERNAL_TEST_GATES } = await import('../src/release/gates.js');
  assert.ok(REAL_PILOT_GATES.length > 0,
    'no gate is required for a real pilot, so every release would clear one');
  assert.ok(INTERNAL_TEST_GATES.length > 0);
});

test('the machine user is not a credential in whichever variable carries it', async () => {
  // SUDO_USER is set for anything started with sudo, matches the service-login rule,
  // and holds the same name that appears in every path an error quotes.
  const { redactSecrets } = await import('../src/workers/redaction.js');
  const previous = process.env['SUDO_USER'];
  process.env['SUDO_USER'] = 'roothecks';
  try {
    const text = redactSecrets("ENOENT: '/home/roothecks/AiDepartment/x.yaml'");
    assert.match(text, /\/home\/roothecks\/AiDepartment/,
      'the path was redacted because the shell user matched the login rule');
  } finally {
    if (previous === undefined) delete process.env['SUDO_USER'];
    else process.env['SUDO_USER'] = previous;
  }
});

test('a report about an unreadable ceiling does not print a number', async () => {
  // Two of my own, found by running the tool rather than the test: the manifest
  // printed its unreadable line twice, and printed the budget as $0.00 underneath
  // it. A report that says "unreadable" and "$0.00" in the same breath is the same
  // disagreement between screen and guard this whole item is about.
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '$20';
  const manifest = await releaseManifest();
  assert.deepEqual(manifest.safety.unreadable, ['DISCOVERY_DAILY_BUDGET_USD']);

  const { renderManifest } = await import('../src/release/manifest.js');
  const rendered = renderManifest(manifest);
  assert.equal(rendered.match(/UNREADABLE/g)?.length, 1,
    'the same warning was printed more than once');
  assert.doesNotMatch(rendered, /daily discovery budget \$0\.00/,
    'a ceiling nobody could read was printed as a ceiling of nothing');
  assert.match(rendered, /daily discovery budget set to a value that is not a number/);
});
