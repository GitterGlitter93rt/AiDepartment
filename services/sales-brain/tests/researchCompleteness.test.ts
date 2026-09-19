import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser, markEntityVerified } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { searchProspects } from '../src/domain/search.js';
import {
  computeCompleteness, storeCompleteness, evidenceDebtSummary,
} from '../src/domain/researchCompleteness.js';

/**
 * How much of what matters we have actually looked at.
 * Authority: Issue #3 M.
 *
 * `accounts.research_completeness` is a filter on Find Prospects offering COMPLETE,
 * GOOD, PARTIAL and STALE. Its only writer set THIN or STALE and nothing else -- the
 * `case` left a researched, fresh Account unchanged, which for a new record meant
 * null for ever. So three of the four options matched nothing at all, the one value
 * the data actually held was not offered, and a rep filtering for well-researched
 * prospects read "no researched prospects match those filters" and concluded the
 * inventory was thin.
 *
 * The `research_completeness` table, with a score and a components breakdown, had
 * never had a row written by anything but a fixture.
 *
 * The label is the smaller half of this. The useful half is the debt: which of the
 * things this trade says matter has nobody looked at for this company.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(options: {
  researched?: boolean; stale?: boolean; signals?: string[];
} = {}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Completeness Co ${sequence}`,
    website: `https://completeness${sequence}.invalid`,
    phone: `904-555-${String(8000 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'listings:fixture' }));
  // Stands for a candidate the resolver promoted: the only way a machine
  // makes an Account now.
  await markEntityVerified(accountId);

  if (options.researched) {
    await query(
      `insert into research_runs (account_id, trigger, started_at, completed_at, status,
                                  adapter_results)
       values ($1, 'newly_discovered', now(), now(), 'completed', '{"pages_fetched":4}'::jsonb)`,
      [accountId]);
    await query(
      `update accounts set last_researched_at = now(),
              research_fresh_until = now() + ($2 || ' days')::interval
        where account_id = $1`, [accountId, options.stale ? '-1' : '10']);
  }

  for (const claim of options.signals ?? []) {
    await query(
      `insert into evidence_records
         (account_id, category, claim_key, claim_text, normalized_value, confidence,
          can_state_as_fact, source_type, expires_at, freshness)
       values ($1, 'operations', $2, $3, 'yes', 'confirmed', true, 'first_party',
               now() + interval '30 days', 'fresh')`,
      [accountId, claim, `${claim} on the site`]);
  }
  return accountId;
}

// ------------------------------------------------------- the unreachable filter --

test('a researched company can now reach a positive completeness state', async () => {
  // The defect: the only writer could produce THIN or STALE, so COMPLETE, GOOD and
  // PARTIAL were unreachable and their filter options matched nothing, ever.
  const thorough = await account({
    researched: true,
    signals: ['emergency_24_7_service', 'online_quote_booking', 'multiple_locations',
      'active_google_search_ad', 'active_meta_ad'],
  });
  const completeness = await computeCompleteness(thorough);
  assert.ok(['COMPLETE', 'GOOD', 'PARTIAL'].includes(completeness.label),
    `a thoroughly researched company scored ${completeness.label} at ${completeness.score}`);
  assert.ok(completeness.score > 0);
});

test('an unresearched company is thin, and says there is nothing to be complete about', async () => {
  const untouched = await account();
  const completeness = await computeCompleteness(untouched);
  assert.equal(completeness.label, 'THIN');
  assert.match(completeness.summary, /nothing to be complete or incomplete about/);
});

test('stale research wins over whatever it once covered', async () => {
  const stale = await account({
    researched: true, stale: true,
    signals: ['emergency_24_7_service', 'online_quote_booking', 'multiple_locations'],
  });
  const completeness = await computeCompleteness(stale);
  assert.equal(completeness.label, 'STALE',
    'aged research was reported as complete because it once covered a lot');
  assert.match(completeness.summary, /not.*said in the present tense/i);
});

test('the filter can now select every state the data holds', async () => {
  const rep = await makeUser(`Completeness Rep ${Date.now()}`, 'SALES_REP');
  const viewer = { userId: rep.userId, role: 'SALES_REP' as const };

  const thin = await account();
  await query(
    `update accounts set research_completeness = 'THIN' where account_id = $1`, [thin]);

  // THIN was the only value besides STALE that anything wrote, and it was not a
  // filter option at all: those companies were unreachable.
  const found = await searchProspects({ research: ['THIN'] }, viewer);
  assert.equal(found.total, 1,
    'companies in the one state the data holds are still unreachable by the filter');
});

// -------------------------------------------------------------- evidence debt ---

test('the debt names what nobody has looked at, not just how much', async () => {
  const partial = await account({
    researched: true, signals: ['emergency_24_7_service'] });
  const completeness = await computeCompleteness(partial);

  assert.ok(completeness.debt.neverLooked.length > 0
    || completeness.debt.lookedAndAbsent.length > 0);
  for (const fact of [...completeness.debt.neverLooked, ...completeness.debt.lookedAndAbsent]) {
    assert.ok(fact.label.length > 0, `${fact.key} has no words for a rep`);
  }
});

test('"we looked and it is not there" is an answer, not a debt', async () => {
  // Treating a checked absence as a gap would make a thoroughly researched company
  // with few signals look unresearched, and send somebody to research it again.
  const researched = await account({ researched: true });
  const completeness = await computeCompleteness(researched);

  assert.ok(completeness.debt.lookedAndAbsent.length > 0,
    'a researched company recorded no checked absences at all');
  for (const fact of completeness.debt.lookedAndAbsent) {
    assert.ok(!completeness.debt.neverLooked.some((gap) => gap.key === fact.key),
      `${fact.key} is counted as both looked-at and never-looked-at`);
  }
  assert.ok(completeness.answered > 0);
});

test('our own machinery is not counted as knowledge about the company', async () => {
  // "Did we read the website" is a fact about us. Counting it would let a score rise
  // because the crawler had a good day.
  const researched = await account({ researched: true });
  const completeness = await computeCompleteness(researched);
  for (const group of [completeness.debt.neverLooked, completeness.debt.lookedAndAbsent]) {
    assert.ok(!group.some((fact) => fact.key === 'website_read'),
      'whether we read the website was counted as a fact about the prospect');
  }
});

// ------------------------------------------------------------ where it is kept --

test('completeness is written where the filter reads and where the history lives', async () => {
  const accountId = await account({
    researched: true, signals: ['emergency_24_7_service', 'online_quote_booking'] });
  const completeness = await computeCompleteness(accountId);
  await storeCompleteness(accountId, completeness);

  const projection = await query<{ research_completeness: string }>(
    'select research_completeness from accounts where account_id = $1', [accountId]);
  assert.equal(projection.rows[0]!.research_completeness, completeness.label);

  // The table that had never had a row written to it by anything but a fixture.
  const history = await query<{ label: string; numeric_score: number; components: any }>(
    'select label, numeric_score, components from research_completeness where account_id = $1',
    [accountId]);
  assert.equal(history.rows.length, 1,
    'the completeness history table is still written by nothing');
  assert.equal(history.rows[0]!.label, completeness.label.toLowerCase(),
    'the row was rejected or stored in the wrong vocabulary');
  assert.equal(history.rows[0]!.numeric_score, completeness.score);
  assert.ok(Array.isArray(history.rows[0]!.components.never_looked));
});

test('re-running keeps the history rather than overwriting it', async () => {
  const accountId = await account({ researched: true });
  await storeCompleteness(accountId, await computeCompleteness(accountId));
  await storeCompleteness(accountId, await computeCompleteness(accountId));

  const { rows } = await query<{ n: number }>(
    'select count(*)::int as n from research_completeness where account_id = $1',
    [accountId]);
  assert.equal(rows[0]!.n, 2,
    'the history was overwritten, so "was this better researched in March" is unanswerable');
});

// ------------------------------------------------------------ across inventory --

test('the debt summary says which one thing to go and do', async () => {
  await account({ researched: true, signals: ['emergency_24_7_service'] });
  await account({ researched: true });
  await account({ researched: true });

  const summary = await evidenceDebtSummary();
  assert.equal(summary.sampled, 3);
  assert.ok(summary.byFact.length > 0);
  // Ordered, so the top of the list is the job worth scheduling.
  const counts = summary.byFact.map((fact) => fact.neverLooked);
  assert.deepEqual([...counts].sort((a, b) => b - a), counts,
    'the debt summary is not ordered, so there is no "one thing to do next"');
  assert.ok(Object.keys(summary.byLabel).length > 0);
});
