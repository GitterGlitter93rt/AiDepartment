import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase } from './helpers.js';
import {
  MAX_CONTACT_QUERIES, MAX_DECISION_MAKER_QUERIES, MAX_QUERIES_PER_ACCOUNT,
  planStageD, planStageDQueries, stageDRunnable, type StageDFacts,
} from '../src/research/stageD.js';
import { observedUnitCost, previewStageDBatch } from '../src/research/stageDPreview.js';
import { formatContactYield, measureContactYield } from '../src/research/contactYield.js';

/**
 * SB-V2-5 — Stage D is planned and priced, and does not run.
 *
 * The question this exists to answer is "what would a hundred Accounts cost", and the
 * whole point is answering it without spending anything to find out. So these tests
 * hold two things: that a plan is built only from facts already established, and that
 * no path through this code reaches a provider.
 */

const PRICING = { unitCostUsd: 0.006, basis: 'a test' };

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

function facts(overrides: Partial<StageDFacts> = {}): StageDFacts {
  return {
    companyName: 'Sunbright HVAC LLC',
    domain: 'sunbrightair.invalid',
    knownPersonName: null,
    knownPersonRole: null,
    publishedStreet: null,
    publishedCity: null,
    publishedRegion: null,
    verticalProfileId: 'hvac',
    hasNamedEmail: false,
    hasDecisionMaker: false,
    ...overrides,
  };
}

// ------------------------------------------------------------------ the budget

test('an account that is already answered plans nothing', () => {
  const plan = planStageD(
    facts({ hasDecisionMaker: true, hasNamedEmail: true, knownPersonName: 'A Person' }),
    PRICING);
  assert.deepEqual(plan.queries, []);
  assert.equal(plan.estimatedCostUsd, 0);
  assert.match(plan.reason, /nothing left for a paid search/i);
});

test('a name that is page copy buys nothing', () => {
  // Found by running the preview against production: the first plan it produced was
  // `"HVAC Tune-Up in Saint Petersburg, FL 33703 - AGNI" owner OR president`. Nobody
  // calls the company that. Gating on it took the batch from 275 planned queries to
  // 123, and took the accounts needing nothing from 3 to 57.
  const plan = planStageD(
    facts({ companyName: 'HVAC Tune-Up in Saint Petersburg, FL 33703 - AGNI' }), PRICING);
  assert.deepEqual(plan.queries, []);
  assert.equal(plan.estimatedCostUsd, 0);
  assert.match(plan.reason, /page copy/);
  assert.match(plan.reason, /Fix the name first/);

  // A real company name is not caught by it.
  const real = planStageD(facts({ companyName: 'Sunbright HVAC LLC' }), PRICING);
  assert.ok(real.queries.length > 0);
});

test('the ceiling is five searches and the plan stops well short of it', () => {
  const everything = planStageDQueries(facts({
    knownPersonName: 'A Person', knownPersonRole: 'Owner', hasDecisionMaker: true,
    publishedStreet: '1969 S Alafaya Trl', publishedCity: 'Orlando', publishedRegion: 'FL',
  }));
  assert.ok(everything.length <= MAX_QUERIES_PER_ACCOUNT);
  assert.equal(MAX_QUERIES_PER_ACCOUNT, MAX_DECISION_MAKER_QUERIES + MAX_CONTACT_QUERIES);

  // A company with nothing established but a name asks the smallest useful question.
  const bare = planStageDQueries(facts({ domain: null }));
  assert.equal(bare.length, 1);
  assert.match(bare[0]!.query, /Sunbright HVAC LLC/);
});

test('a query is built only from facts already established', () => {
  const planned = planStageDQueries(facts({
    knownPersonName: 'Hector Andres Guerrero', hasDecisionMaker: true,
    publishedStreet: '1969 S Alafaya Trl', publishedCity: 'Orlando',
  }));

  for (const entry of planned) {
    assert.ok(entry.builtFrom.length > 0, `${entry.query} does not say what it is built from`);
    for (const source of entry.builtFrom) {
      // The searched geography is the one thing a query may never be built from: a
      // search for where we looked returns results about where we looked.
      assert.equal(/searched|discovery geograph/i.test(source), false,
        `a query was built from the search rather than from the company: ${source}`);
    }
  }

  // The person's exact name is quoted, so a provider does not match two of the words.
  assert.ok(planned.some((entry) => entry.query.includes('"Hector Andres Guerrero"')));
});

test('a named person changes the question from who to whether', () => {
  const unknown = planStageDQueries(facts());
  assert.ok(unknown.every((entry) => !entry.query.includes('"A Person"')));
  assert.match(unknown[0]!.query, /owner OR president/);

  const known = planStageDQueries(facts({
    knownPersonName: 'A Person', hasDecisionMaker: true }));
  assert.match(known[0]!.rationale, /[Cc]orroborates/);
});

// -------------------------------------------------------------- the cost model

test('the price comes from what we have actually been charged', async () => {
  const empty = await observedUnitCost();
  assert.match(empty.basis, /no paid task has ever been recorded/);

  await query(
    `insert into provider_tasks (provider, provider_native_id, fingerprint, status, cost_usd)
     values ('dataforseo', 'task-1', 'fp-1', 'COLLECTED', 0.0060),
            ('dataforseo', 'task-2', 'fp-2', 'COLLECTED', 0.0075)`);

  const observed = await observedUnitCost();
  // The worst price charged, not the average: an estimate that is right on the cheap
  // day and wrong on the expensive one is the wrong way round for a spending decision.
  assert.equal(observed.unitCostUsd, 0.0075);
  assert.match(observed.basis, /highest price actually charged across 2/);
});

test('a batch preview prices what it would ask, and buys nothing', async () => {
  for (let i = 0; i < 3; i += 1) {
    await withTransaction((client) => upsertAccount(client, {
      canonicalName: `Preview Air ${i}`, website: `https://preview${i}.invalid`,
      phone: `407-555-01${10 + i}`, verticalProfileId: 'hvac',
    }, { discoverySource: 'import' }));
  }
  await query(`update accounts set entity_status = 'verified'`);

  const before = await query<{ n: number }>(
    'select count(*)::int as n from provider_tasks');
  const preview = await previewStageDBatch(100);
  const after = await query<{ n: number }>(
    'select count(*)::int as n from provider_tasks');

  assert.equal(after.rows[0]!.n, before.rows[0]!.n,
    'previewing what a batch would cost created a provider task');
  assert.equal(preview.accounts.length, 3);
  assert.ok(preview.totalQueries > 0);
  assert.ok(preview.estimatedCostPer100Usd > 0);
  assert.ok(preview.estimatedCostPer100Usd <= preview.worstCasePer100Usd,
    'the estimate exceeds the worst case, which means one of them is wrong');
});

test('a query is never built from a location the company did not publish', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Unpublished Air', website: 'https://unpublished.invalid',
    phone: '407-555-0155', verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));
  await query(`update accounts set entity_status = 'verified' where account_id = $1`,
    [accountId]);
  // A location with no basis: the searched geography, or a line a provider printed.
  await query(
    `insert into locations (account_id, city, state_region, postal_code, location_type)
     values ($1, 'Nowhere', 'FL', '32095', 'service_area')`, [accountId]);

  const preview = await previewStageDBatch(10);
  const entry = preview.accounts.find((row) => row.accountId === accountId)!;
  assert.equal(entry.facts.publishedCity, null,
    'an unprovenanced location was used to build a paid query');
  for (const planned of entry.plan.queries) {
    assert.equal(planned.query.includes('Nowhere'), false);
  }
});

// ------------------------------------------------------------------- the gate

test('Stage D refuses to run, twice over', () => {
  const off = stageDRunnable({} as NodeJS.ProcessEnv);
  assert.equal(off.runnable, false);
  assert.match(off.reason, /disabled/i);

  // And with the flag on, because there is no executor to turn on.
  const on = stageDRunnable({ STAGE_D_ENABLED: 'true' } as NodeJS.ProcessEnv);
  assert.equal(on.runnable, false);
  assert.match(on.reason, /no executor exists/i);
});

test('the preview command refuses --run explicitly', () => {
  const script = resolve(import.meta.dirname, '..', 'src', 'bin', 'stage-d-preview.ts');
  let stderr = '';
  let status = 0;
  try {
    execFileSync('npx', ['tsx', script, '--run'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LOG_LEVEL: 'silent' },
    });
  } catch (error) {
    const failure = error as { status: number; stderr: string };
    status = failure.status;
    stderr = failure.stderr;
  }
  assert.equal(status, 2, 'the preview command did not refuse a live run');
  assert.match(stderr, /REFUSED: Stage D does not run/);
});

// ------------------------------------------------- SB-V2-6, the yield report

test('a mailbox whose role says "person" with no person attached is not a named email',
  async () => {
    // Production holds 98 rows shaped exactly like this: the role was assigned from the
    // shape of the mailbox before the rule that now governs it existed, and not one of
    // them is linked to a contact. Counting them as named emails would report the
    // measurement this whole experiment exists to take as already solved.
    const { accountId } = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Shaped Like A Name Air', website: 'https://shaped.invalid',
      phone: '407-555-0177', verticalProfileId: 'hvac',
    }, { discoverySource: 'import' }));
    await query(
      `insert into contact_endpoints
         (account_id, endpoint_type, normalized_value, display_value, endpoint_role)
       values ($1, 'EMAIL', 'dana@shaped.invalid', 'dana@shaped.invalid',
               'DIRECT_PERSON_EMAIL')`, [accountId]);

    const measured = await measureContactYield(10);
    assert.equal(measured.email.roleSaysPerson, 1);
    assert.equal(measured.email.attributedToPerson, 0,
      'a mailbox with nobody attached was counted as a named person\'s email');
    assert.equal(measured.email.accountsWithNamedEmail, 0);

    const report = formatContactYield(measured);
    assert.match(report, /person actually attached 0/);
    assert.match(report, /role assigned from the shape of the mailbox/);
  });

test('a stage that has not run is reported as not run, never as nothing found', async () => {
  const measured = await measureContactYield(5);
  assert.equal(measured.officialSources.state, 'NOT_RUN');
  assert.match(measured.officialSources.reason, /not the same as their having nothing to say/);
  assert.equal(measured.searchStage.state, 'PREVIEW_ONLY');

  const report = formatContactYield(measured);
  assert.match(report, /nothing in this report was bought/);
  // And the report refuses to draw the conclusion it exists to inform.
  assert.match(report, /does not say a paid contact provider is unnecessary/);
});

test('every rate in the report carries the population it came from', async () => {
  const measured = await measureContactYield(5);
  const report = formatContactYield(measured);
  for (const line of report.split('\n')) {
    if (!/\d+%/.test(line)) continue;
    assert.match(line, /\(\d+ of \d+\)/,
      `a percentage with no population behind it: ${line.trim()}`);
  }
});
