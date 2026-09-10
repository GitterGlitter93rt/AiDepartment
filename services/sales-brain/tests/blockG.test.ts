import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { scoreAccount, latestScore } from '../src/scoring/score.js';
import { SCORE_VERSION } from '../src/scoring/model.js';
import { scoreRuleForReference } from '../src/scoring/recognize.js';
import { allSignals, signalFor } from '../src/domain/signalRegistry.js';
import { validateProfiles, BLOCKING } from '../src/domain/profileContract.js';
import { resetDatabase } from './helpers.js';

/**
 * Block G: where the Speed-to-Lead probe meets everything that already existed.
 *
 * The integration is deliberately the smallest one available. The probe publishes
 * `evidence_records` by claim key; the hypothesis engine already reads those; the
 * call pack already reads hypotheses. No second route into the call pack, because a
 * second route is a second place for a claim to be born.
 *
 * That leaves one question worth an audit, and it is the one the instruction named:
 * can a probe measurement change the canonical Module 4C score without anybody
 * deciding that it should?
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Block G Co ${sequence}`,
    website: `https://blockg-${sequence}.invalid`,
    phone: `904-555-${String(5100 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095', verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:dataforseo' }));
  return accountId;
}

async function evidence(accountId: string, claimKey: string, options: {
  value?: string; confidence?: string;
} = {}): Promise<void> {
  await query(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, normalized_value, confidence,
        can_state_as_fact, source_type, source_reference, observed_at)
     values ($1, 'operations', $2, $3, $4, $5, true, 'COMPANY_WEBSITE',
             'https://blockg.invalid/probe', now())`,
    [accountId, claimKey, `Block G evidence for ${claimKey}`,
     options.value ?? 'yes', options.confidence ?? 'confirmed']);
}

/** The probe's signals, as the registry declares them. */
function probeSignals() {
  return allSignals().filter((signal) => signal.consumers.includes('probe/evidence'));
}

// =============================================================================
// G1 · a probe measurement cannot move a canonical score
// =============================================================================

test('G1 the registry gives the probe no route into the scorer', async () => {
  const probes = probeSignals();
  assert.ok(probes.length >= 9,
    `only ${probes.length} probe signals found; the fixture is not reading the registry`);
  for (const signal of probes) {
    assert.ok(!signal.consumers.includes('scoring/recognize'),
      `${signal.id} declares the scorer as a consumer, so a probe measurement is part `
      + 'of the canonical score');
    // What they are for instead, stated so a future edit has to argue with it.
    assert.ok(signal.consumers.includes('domain/hypotheses'),
      `${signal.id} feeds nothing a rep would read`);
  }
});

test('G1 probe evidence on an Account changes neither its score nor its tier',
  async () => {
  // The end-to-end version of the same claim, through the real scorer rather than
  // through the registry. The scorer reads *every* evidence row an Account has, so
  // this is the assertion that matters: it selects `where account_id = $1` and then
  // consumes only the claim keys the profile maps to a rule.
  const accountId = await account();
  await evidence(accountId, 'active_google_search_ad');
  await query(
    `update accounts set last_researched_at = now(),
            research_fresh_until = now() + interval '30 days'
      where account_id = $1`, [accountId]);

  const before = await scoreAccount(accountId);
  assert.ok(before.totalPoints > 0, 'the fixture produced no score to compare against');

  // Every probe signal the registry knows, written as confident, stateable evidence.
  for (const signal of probeSignals()) {
    await evidence(accountId, signal.id, { value: 'yes', confidence: 'confirmed' });
  }
  const after = await scoreAccount(accountId);

  assert.equal(after.totalPoints, before.totalPoints,
    'a probe measurement changed the canonical score');
  assert.equal(after.tier, before.tier, 'a probe measurement changed the tier');
  // And the components are the same rules, not a different set summing to the same.
  assert.deepEqual(
    after.components.filter((c) => c.qualified).map((c) => c.ruleId).sort(),
    before.components.filter((c) => c.qualified).map((c) => c.ruleId).sort());

  // The stored projection agrees, and still names the current policy.
  const stored = await latestScore(accountId);
  assert.equal(stored!.totalPoints, before.totalPoints);
  assert.equal(stored!.version, SCORE_VERSION);
});

// =============================================================================
// G2 · and the boundary is enforced rather than merely observed
// =============================================================================

/**
 * The scorer reads whichever claim keys the *vertical profile* maps to a score rule,
 * so which facts move a company's tier is decided in profile data rather than in
 * code. That is deliberate -- it is how a vertical expresses its own model -- and it
 * means the line between "a signal a rep reads" and "a signal that changes a score"
 * was a configuration boundary held up by nothing. One line in one profile would
 * re-tier every scored company in that vertical on the next recompute sweep, and the
 * only trace would be a score that moved.
 */
test('G2 wiring a probe signal into a score rule is a blocking contract violation',
  async () => {
  const probe = probeSignals()[0]!;
  // A real score rule reference, so this is the case that would actually score.
  const reference = 'module4c_after_hours_plus1';
  assert.ok(scoreRuleForReference(reference),
    'the fixture is using a reference that feeds no rule, so it proves nothing');

  const { rows } = await query<{ definition: any }>(
    `select definition from vertical_profiles where vertical_profile_id = 'hvac'`);
  const definition = rows[0]!.definition;
  const profile = definition.profile ?? definition;
  profile.public_signal_rules = [
    ...(profile.public_signal_rules ?? []),
    { signal_id: 'blockg_probe_wired_into_score', evidence_claim_key: probe.id,
      score_rule_reference: reference, confidence_required: 'confirmed' },
  ];
  await query(
    `update vertical_profiles set definition = $1::jsonb
      where vertical_profile_id = 'hvac'`,
    [JSON.stringify(definition)]);

  const violations = await validateProfiles();
  const found = violations.filter((v) => v.kind === 'SIGNAL_NOT_SCOREABLE');
  assert.equal(found.length, 1,
    `expected one SIGNAL_NOT_SCOREABLE, got ${found.length}: `
    + violations.map((v) => v.kind).join(', '));
  assert.match(found[0]!.reference, new RegExp(probe.id));
  assert.ok(BLOCKING.has('SIGNAL_NOT_SCOREABLE'),
    'the violation is reported but does not fail the build, so it is a note rather '
    + 'than a boundary');
  // It says what to do instead, including that the old scores stop being comparable.
  assert.match(found[0]!.detail, /SCORE_VERSION/);
  assert.match(found[0]!.detail, /re-tiered/);
});

test('G2 a signal a vertical merely cares about is not a scoring violation', async () => {
  // The narrowing this check needed. `vertical_priority_signal_only` deliberately
  // feeds no rule -- it is how a profile says a signal matters to a vertical without
  // being worth points -- and the shipped roofing profile uses it for
  // `storm_hail_market_signal`, a hypothesis-only market signal. My first version of
  // this guard reported that as a violation, which would have made a correct profile
  // fail the build.
  assert.equal(scoreRuleForReference('vertical_priority_signal_only'), null);

  const probe = probeSignals()[0]!;
  const { rows } = await query<{ definition: any }>(
    `select definition from vertical_profiles where vertical_profile_id = 'hvac'`);
  const definition = rows[0]!.definition;
  const profile = definition.profile ?? definition;
  profile.public_signal_rules = [
    ...(profile.public_signal_rules ?? []),
    { signal_id: 'blockg_priority_only', evidence_claim_key: probe.id,
      score_rule_reference: 'vertical_priority_signal_only' },
  ];
  await query(
    `update vertical_profiles set definition = $1::jsonb
      where vertical_profile_id = 'hvac'`,
    [JSON.stringify(definition)]);

  const violations = await validateProfiles();
  assert.equal(violations.filter((v) => v.kind === 'SIGNAL_NOT_SCOREABLE').length, 0,
    'a signal declared as priority-only was reported as wired into the score');
});

test('G2 the shipped profiles satisfy the boundary', async () => {
  // Run against what is actually configured, so the guard is exercised on real data
  // rather than only on fixtures built to trip it.
  const violations = await validateProfiles();
  const scoreable = violations.filter((v) => v.kind === 'SIGNAL_NOT_SCOREABLE');
  assert.deepEqual(scoreable, [],
    'a shipped profile wires a non-scoring signal into the canonical score');
  // And the score-bearing signals do declare the scorer, so the discriminator is
  // real in both directions rather than vacuously true.
  const scoring = allSignals().filter((s) => s.consumers.includes('scoring/recognize'));
  assert.ok(scoring.length >= 10,
    `only ${scoring.length} signals declare the scorer as a consumer`);
  assert.ok(signalFor('active_google_search_ad')!.consumers.includes('scoring/recognize'));
});
