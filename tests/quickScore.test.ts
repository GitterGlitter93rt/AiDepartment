// Quick Score model test suite.
// Run with: node --experimental-strip-types --test tests/quickScore.test.ts
//
// Verifies the deterministic 15-question quick scoring model
// (assessment_quick_v1) independently of the preserved 64-question
// engine — scoring math, stage mapping, opportunity signals,
// enterprise identification, and urgency.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateQuickCategoryScores,
  calculateQuickOverallScore,
  evaluateQuickSignals,
  isQuickEnterpriseCandidate,
  calculateQuickUrgency,
  runQuickScore,
} from '../src/lib/assessment/quickScore.ts';
import { QUICK_QUESTIONS } from '../src/data/assessment/quickQuestions.ts';
import { QUICK_CATEGORY_WEIGHTS } from '../src/data/assessment/quickTypes.ts';
import type { QuickAnswerMap } from '../src/data/assessment/quickTypes.ts';

// ---- Fixtures -----------------------------------------------------------

/** Everything answered at maximum maturity. */
const BEST_ANSWERS: QuickAnswerMap = {
  QS1: 'Professional Services',
  QS2: '11-25',
  QS3: 'Yes, and it is actively being implemented',
  QS4: 'Mission critical',
  QS5: 'Fully tracked from lead to revenue',
  QS6: 'Very satisfied',
  QS7: 'Under 5 minutes',
  QS8: 'We have sophisticated automated nurturing',
  QS9: 'Almost none',
  QS10: 'Within minutes',
  QS11: 'Very little',
  QS12: 'More than 75%',
  QS13: 'Highly integrated and automated',
  QS14: 'Real-time visibility across the company',
  QS15: 'Immediately for the right opportunity',
};

/** Everything answered at the weakest end, with QS4 at 'Important' so
 * STRATEGY_GAP's severity combination is exercisable. */
const WORST_ANSWERS: QuickAnswerMap = {
  QS1: 'Other / Not Listed',
  QS2: '1-5',
  QS3: 'No',
  QS4: 'Important',
  QS5: 'We cannot track it',
  QS6: 'Very dissatisfied',
  QS7: 'The next business day or later',
  QS8: 'Usually nothing',
  QS9: 'More than 25%',
  QS10: 'Next business day or later',
  QS11: 'Extremely high',
  QS12: '0%',
  QS13: 'Completely disconnected',
  QS14: 'No',
  QS15: 'We are only researching',
};

/** Mid-maturity answers for stage-band coverage. */
const MID_ANSWERS: QuickAnswerMap = {
  QS1: 'Professional Services',
  QS2: '11-25',
  QS3: 'We are currently developing one',
  QS4: 'Important',
  QS5: 'Somewhat confident',
  QS6: 'Neutral',
  QS7: '15-30 minutes',
  QS8: 'We have a standard manual follow-up process',
  QS9: 'Under 5%',
  QS10: 'Within one hour',
  QS11: 'Moderate amount',
  QS12: '26-50%',
  QS13: 'Some integrations',
  QS14: 'Some dashboards exist',
  QS15: '3-6 months',
};

function withAnswers(overrides: QuickAnswerMap): QuickAnswerMap {
  return { ...MID_ANSWERS, ...overrides };
}

// ---- Structure ----------------------------------------------------------

describe('Question set structure', () => {
  test('contains 15 questions (12-15 target band)', () => {
    assert.equal(QUICK_QUESTIONS.length, 15);
  });

  test('exactly 12 scored questions across all 7 categories', () => {
    const scored = QUICK_QUESTIONS.filter((q) => q.publicScores);
    assert.equal(scored.length, 12);
    const categories = new Set(scored.map((q) => q.category));
    assert.equal(categories.size, 7);
  });

  test('every publicScores array aligns with its option count', () => {
    for (const q of QUICK_QUESTIONS) {
      if (q.publicScores) {
        assert.equal(
          q.publicScores.length,
          q.options.length,
          `${q.id}: publicScores length must match options length`
        );
      }
      if (q.urgencyScores) {
        assert.equal(q.urgencyScores.length, q.options.length, `${q.id}: urgencyScores misaligned`);
      }
    }
  });

  test('category weights sum to 1 (same as full engine)', () => {
    const total = Object.values(QUICK_CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });
});

// ---- Scoring ------------------------------------------------------------

describe('Deterministic scoring', () => {
  test('best answers score 100 and reach AI Leadership Stage with no signals', () => {
    const result = runQuickScore(BEST_ANSWERS);
    assert.equal(result.overallScore, 100);
    assert.equal(result.stage, 'AI Leadership Stage');
    assert.equal(result.signals.length, 0);
    assert.equal(result.assessmentVersion, 'assessment_quick_v1');
  });

  test('worst answers land in AI Foundation Stage with heavy signals', () => {
    const result = runQuickScore(WORST_ANSWERS);
    assert.ok(result.overallScore <= 24, `expected Foundation band, got ${result.overallScore}`);
    assert.equal(result.stage, 'AI Foundation Stage');
    assert.ok(result.signals.length >= 10, `expected 10+ signals, got ${result.signals.length}`);
  });

  test('mid answers land in AI Adoption Stage (50-69 band)', () => {
    const result = runQuickScore(MID_ANSWERS);
    assert.ok(result.overallScore >= 50 && result.overallScore <= 69, `got ${result.overallScore}`);
    assert.equal(result.stage, 'AI Adoption Stage');
  });

  test('category score is points earned / max possible x 100', () => {
    const categories = calculateQuickCategoryScores(WORST_ANSWERS);
    // leadership: QS3 = 0/4, QS4 = 2/4 -> 2/8 = 25%
    const leadership = categories.find((c) => c.category === 'leadership')!;
    assert.equal(leadership.pointsEarned, 2);
    assert.equal(leadership.maxPossible, 8);
    assert.equal(leadership.scorePercent, 25);
    assert.equal(leadership.answeredCount, 2);
  });

  test('overall score is the weighted category sum, rounded', () => {
    const categories = calculateQuickCategoryScores(BEST_ANSWERS);
    const manual = Math.round(
      categories.reduce((sum, c) => sum + c.scorePercent * QUICK_CATEGORY_WEIGHTS[c.category], 0)
    );
    assert.equal(calculateQuickOverallScore(categories), manual);
    assert.equal(manual, 100);
  });

  test('strongest areas are the highest-scoring categories', () => {
    const result = runQuickScore(MID_ANSWERS);
    const best = Math.max(...result.categories.map((c) => c.scorePercent));
    assert.equal(result.categories.find((c) => c.category === result.strongestAreas[0])!.scorePercent, best);
  });

  test('same inputs always produce the same outputs (no hidden state)', () => {
    const a = runQuickScore(MID_ANSWERS);
    const b = runQuickScore(MID_ANSWERS);
    assert.deepEqual(a, b);
  });
});

// ---- Signals ------------------------------------------------------------

describe('Opportunity signals', () => {
  test('STRATEGY_GAP requires weak strategy AND high importance', () => {
    assert.ok(evaluateQuickSignals(WORST_ANSWERS).some((s) => s.id === 'STRATEGY_GAP'));
    const lowImportance = withAnswers({ QS3: 'No', QS4: 'Not currently important' });
    assert.equal(evaluateQuickSignals(lowImportance).some((s) => s.id === 'STRATEGY_GAP'), false);
    const strongStrategy = withAnswers({ QS3: 'Yes, and it is actively being implemented', QS4: 'Mission critical' });
    assert.equal(evaluateQuickSignals(strongStrategy).some((s) => s.id === 'STRATEGY_GAP'), false);
  });

  test('each single-condition signal fires on its trigger answer and only then', () => {
    const cases: { id: string; questionId: string; trigger: string; escape: string }[] = [
      { id: 'TRACKING_GAP', questionId: 'QS5', trigger: 'We cannot track it', escape: 'Fully tracked from lead to revenue' },
      { id: 'MARKETING_UNHAPPY', questionId: 'QS6', trigger: 'Very dissatisfied', escape: 'Satisfied' },
      { id: 'LEAD_RESPONSE_GAP', questionId: 'QS7', trigger: '30-60 minutes', escape: '5-15 minutes' },
      { id: 'FOLLOWUP_GAP', questionId: 'QS8', trigger: 'Usually nothing', escape: 'We have basic automated follow-up' },
      { id: 'MISSED_CALLS', questionId: 'QS9', trigger: '10-25%', escape: 'Under 5%' },
      { id: 'SLOW_CUSTOMER_REPLY', questionId: 'QS10', trigger: 'It varies widely', escape: 'Within several hours' },
      { id: 'ADMIN_BURDEN', questionId: 'QS11', trigger: 'Significant amount', escape: 'Some' },
      { id: 'AI_ADOPTION_LOW', questionId: 'QS12', trigger: '0%', escape: '10-25%' },
      { id: 'INTEGRATION_GAP', questionId: 'QS13', trigger: 'Mostly disconnected', escape: 'Some integrations' },
      { id: 'REPORTING_GAP', questionId: 'QS14', trigger: 'No', escape: 'Some dashboards exist' },
    ];
    for (const c of cases) {
      const fired = evaluateQuickSignals(withAnswers({ [c.questionId]: c.trigger } as QuickAnswerMap));
      assert.ok(fired.some((s) => s.id === c.id), `${c.id} should fire on ${c.trigger}`);
      const notFired = evaluateQuickSignals(withAnswers({ [c.questionId]: c.escape } as QuickAnswerMap));
      assert.equal(notFired.some((s) => s.id === c.id), false, `${c.id} should not fire on ${c.escape}`);
    }
  });

  test('unknown answers do not fire severity signals', () => {
    const unknowns = withAnswers({ QS7: 'We do not know', QS9: 'We do not know' } as QuickAnswerMap);
    const ids = evaluateQuickSignals(unknowns).map((s) => s.id);
    assert.equal(ids.includes('LEAD_RESPONSE_GAP'), false);
    assert.equal(ids.includes('MISSED_CALLS'), false);
  });

  test('signals carry readable copy and a valid service link', () => {
    const signals = evaluateQuickSignals(WORST_ANSWERS);
    for (const s of signals) {
      assert.ok(s.title.length > 0);
      assert.ok(s.finding.length > 0);
      assert.ok(s.action.length > 0);
      assert.ok(s.serviceHref.startsWith('/'));
      assert.ok(s.serviceLabel.length > 0);
    }
  });

  test('signal output order is deterministic', () => {
    const a = evaluateQuickSignals(WORST_ANSWERS).map((s) => s.id);
    const b = evaluateQuickSignals(WORST_ANSWERS).map((s) => s.id);
    assert.deepEqual(a, b);
  });
});

// ---- Commercial context (private) ----------------------------------------

describe('Enterprise identification and urgency', () => {
  test('enterprise candidate only at 500+ employees', () => {
    assert.ok(isQuickEnterpriseCandidate({ QS2: '500+' }));
    assert.equal(isQuickEnterpriseCandidate({ QS2: '251-500' }), false);
    assert.equal(isQuickEnterpriseCandidate({ QS2: '101-250' }), false);
  });

  test('runQuickScore propagates enterprise flag into public and private views', () => {
    const result = runQuickScore({ ...BEST_ANSWERS, QS2: '500+' });
    assert.equal(result.enterpriseCandidate, true);
    assert.equal(result.commercial.enterpriseCandidate, true);
    assert.equal(result.commercial.employeeBand, '500+');
  });

  test('urgency maps QS15 per the full engine Q38 scale', () => {
    assert.equal(calculateQuickUrgency({ QS15: 'We are only researching' }), 0);
    assert.equal(calculateQuickUrgency({ QS15: '6-12 months' }), 1);
    assert.equal(calculateQuickUrgency({ QS15: '3-6 months' }), 2);
    assert.equal(calculateQuickUrgency({ QS15: '1-3 months' }), 3);
    assert.equal(calculateQuickUrgency({ QS15: 'Within 30 days' }), 4);
    assert.equal(calculateQuickUrgency({ QS15: 'Immediately for the right opportunity' }), 5);
    assert.equal(calculateQuickUrgency({}), 0);
  });

  test('commercial context carries industry and timeframe for the lead email', () => {
    const result = runQuickScore(MID_ANSWERS);
    assert.equal(result.commercial.industry, 'Professional Services');
    assert.equal(result.commercial.timeframe, '3-6 months');
  });
});
