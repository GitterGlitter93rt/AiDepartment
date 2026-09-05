import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  scoreFromSignals, tierFor, SCORE_RULES, RULE_POINTS, MAX_POINTS,
  type ScoreRuleId, type ScoreSignals,
} from '../src/scoring/model.js';

/**
 * The scoring corpus, against the repository's own fixture file.
 * Authority: outbound-sales-brain-scoring-research-fixtures.yaml.
 *
 * The fixtures are the oracle and the TypeScript is the implementation, deliberately
 * kept apart: if the two ever disagree about what an HVAC advertiser is worth, this
 * file fails rather than the product quietly re-scoring everybody.
 *
 * Scoring was fully specified and entirely unimplemented. Nothing in the runtime
 * wrote manual_score or manual_tier except seed, demo and synthetic fixtures, which
 * means every company the miner has ever discovered has no score at all.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURE_PATH = resolve(repoRoot,
  'docs/09-software/outbound-sales-brain-scoring-research-fixtures.yaml');

interface Fixture {
  id: string;
  description?: string;
  inputs: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const corpus = parseYaml(readFileSync(FIXTURE_PATH, 'utf8')) as {
  score_rules: Record<string, number>;
  tiers: Record<string, string>;
  scoring_fixtures: Fixture[];
};

function signalsFrom(inputs: Record<string, unknown>): ScoreSignals {
  const signals: ScoreSignals = {};
  for (const rule of SCORE_RULES) {
    if (rule.derived) continue;
    if (inputs[rule.id] === true) signals[rule.id] = true;
  }
  return signals;
}

test('the implementation and the fixture file agree on what each rule is worth', () => {
  for (const [ruleId, points] of Object.entries(corpus.score_rules)) {
    assert.equal(RULE_POINTS[ruleId as ScoreRuleId], points,
      `${ruleId} is worth ${RULE_POINTS[ruleId as ScoreRuleId]} in code and ${points} in the fixtures`);
  }
  assert.equal(SCORE_RULES.length, Object.keys(corpus.score_rules).length,
    'a rule exists on one side and not the other');
  assert.equal(MAX_POINTS, 18);
});

test('the tier bands are the ones the fixture file declares', () => {
  assert.equal(corpus.tiers['A'], '>=9');
  assert.equal(corpus.tiers['B'], '6..8');
  assert.equal(corpus.tiers['C'], '3..5');
  assert.equal(corpus.tiers['D'], '0..2');

  for (let points = 0; points <= MAX_POINTS; points += 1) {
    const expected = points >= 9 ? 'A' : points >= 6 ? 'B' : points >= 3 ? 'C' : 'D';
    assert.equal(tierFor(points), expected, `${points} points`);
  }
});

test('every fixture in the corpus scores exactly what it says it should', () => {
  const wrong: string[] = [];
  for (const fixture of corpus.scoring_fixtures) {
    const result = scoreFromSignals(signalsFrom(fixture.inputs));
    const expectedPoints = Number(fixture.expected['total_points']);
    const expectedTier = String(fixture.expected['tier']);

    if (result.totalPoints !== expectedPoints) {
      wrong.push(`${fixture.id}: ${result.totalPoints} points, expected ${expectedPoints}`);
    }
    if (result.tier !== expectedTier) {
      wrong.push(`${fixture.id}: tier ${result.tier}, expected ${expectedTier}`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.ok(corpus.scoring_fixtures.length >= 9,
    `only ${corpus.scoring_fixtures.length} fixtures in the corpus`);
});

test('two independent paid channels are derived, never asserted', () => {
  // Google Search plus Google Local Services is still one channel, and the policy
  // says so. A caller cannot hand us the bonus.
  const googleOnly = scoreFromSignals({
    google_paid_search_confirmed: true,
    multiple_paid_channels_confirmed: true as never,
  });
  const multi = googleOnly.components.find((c) => c.ruleId === 'multiple_paid_channels_confirmed')!;
  assert.equal(multi.qualified, false, 'the multi-channel bonus was accepted from the caller');
  assert.equal(googleOnly.totalPoints, 4);

  const both = scoreFromSignals({
    google_paid_search_confirmed: true, meta_active_ads_confirmed: true });
  assert.equal(both.totalPoints, 4 + 3 + 1);
});

test('an unknown signal scores zero and says it is unknown, not that it is false', () => {
  const nothing = scoreFromSignals({});
  assert.equal(nothing.totalPoints, 0);
  assert.equal(nothing.tier, 'D');

  for (const component of nothing.components) {
    assert.equal(component.pointsAwarded, 0);
    // Every reason describes what we have or have not confirmed. None of them makes
    // a claim about the company: "no confirmed Google ad" is not "does not advertise".
    assert.ok(/no qualifying evidence|not .*confirmed|fewer than/i.test(component.reason),
      `${component.ruleId}: "${component.reason}"`);
    assert.ok(!/\bdoes not\b|\bno ads\b|not an advertiser|does not advertise/i.test(component.reason),
      `"${component.reason}" states the opposite fact rather than the absence of evidence`);
  }
});

test('the same evidence always produces the same score', () => {
  const signals: ScoreSignals = {
    google_paid_search_confirmed: true,
    high_value_economics_signal: true,
    emergency_after_hours: true,
    strong_phone_dependence: true,
  };
  const first = scoreFromSignals(signals);
  const second = scoreFromSignals(signals);
  assert.deepEqual(first, second);
  assert.equal(first.totalPoints, 4 + 2 + 1 + 1);
  assert.equal(first.tier, 'B');
});

test('every rule can be explained to a rep, not just numbered', () => {
  const result = scoreFromSignals({ google_paid_search_confirmed: true });
  for (const component of result.components) {
    assert.ok(component.description.length > 20, `${component.ruleId} has no explanation`);
    assert.ok(!/^rule_/.test(component.description));
  }
  const google = result.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!;
  assert.equal(google.pointsAwarded, 4);
  assert.match(google.reason, /Google/);
});

test('points never exceed what the rules can award', () => {
  const everything: ScoreSignals = {};
  for (const rule of SCORE_RULES) {
    if (!rule.derived) everything[rule.id] = true;
  }
  const result = scoreFromSignals(everything);
  assert.equal(result.totalPoints, MAX_POINTS);
  assert.equal(result.tier, 'A');
  assert.ok(result.components.every((c) => c.pointsAwarded <= c.pointsPossible));
});


test('the property assertions the fixture file makes actually hold', () => {
  // "Multiple observations of the same qualifying signal do not multiply that score
  // rule." A rule awards its points once, however much evidence supports it.
  const repeated = scoreFromSignals({
    google_paid_search_confirmed: {
      qualified: true,
      evidenceIds: ['e1', 'e2', 'e3', 'e4'],
    },
  });
  assert.equal(repeated.totalPoints, 4, 'four sightings of one ad awarded more than once');
  const google = repeated.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!;
  assert.equal(google.evidenceIds.length, 4, 'but all of the evidence is still cited');

  // "Unknown evidence awards zero points rather than negative points."
  const unknown = scoreFromSignals({});
  assert.ok(unknown.components.every((component) => component.pointsAwarded >= 0));
  assert.equal(unknown.totalPoints, 0);

  // "Multi-channel bonus requires at least two independently confirmed paid channels."
  assert.equal(scoreFromSignals({ meta_active_ads_confirmed: true })
    .components.find((c) => c.ruleId === 'multiple_paid_channels_confirmed')!.qualified, false);
});
