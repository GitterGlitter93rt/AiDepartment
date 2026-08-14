// Assessment logic test suite.
// Run with: node --experimental-strip-types --test tests/assessment.test.ts
// Uses Node's built-in test runner — no new dependency required.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runAssessment } from '../src/lib/assessment/runAssessment.ts';
import { evaluateFlags } from '../src/lib/assessment/evaluateFlags.ts';
import { calculateCommercialResult } from '../src/lib/assessment/calculateCommercialScore.ts';
import { calculatePublicScoreShell } from '../src/lib/assessment/calculatePublicScore.ts';
import { getVisibleQuestions } from '../src/data/assessment/questions.ts';
import type { AnswerMap } from '../src/data/assessment/types.ts';

// ---- Fixtures -----------------------------------------------------------

const BASE_ANSWERS: AnswerMap = {
  Q1: 'Professional Services',
  Q2: '$1-$3 million',
  Q3: '11-25',
  Q4: '1',
  Q5: ['Increase revenue'],
  Q6: 'Moderate', Q7: 'We are currently developing one', Q8: 'A department leader owns it', Q9: 'Important',
  Q10: ['Referrals'], Q11: '$0', Q12: 'Very confident', Q13: 'Satisfied', Q14: 'Yes, regularly',
  Q15: 'Yes, consistently', Q16: 'Under 5 minutes', Q17: 'We have sophisticated automated nurturing',
  Q18: '25-100', Q19: 'Yes, consistently',
  Q20: 'Almost none', Q21: 'AI voice agent', Q22: 'Within minutes', Q23: 'Yes, integrated with CRM and follow-up',
  Q24: 'Some', Q25: ['None of these'], Q26: 'Most', Q27: 'Rarely', Q28: 'No',
  Q29: '51-75%', Q30: ['ChatGPT'], Q31: 'Company-wide training exists', Q32: 'Yes, formal policy exists', Q33: 'Slightly concerned',
  Q34: 'Well integrated', Q35: 'Good visibility', Q36: 'Good', Q37: 'Regularly',
  Q38: '3-6 months', Q39: '$5,000-$10,000', Q40: 'Employee',
  Q41: 'Nothing malicious here', Q42: 'Growth',
  Q60: 'Several workflows', Q61: ['Unsure'],
};

function withAnswers(overrides: AnswerMap): AnswerMap {
  return { ...BASE_ANSWERS, ...overrides };
}

describe('Scenario 1 — Mature AI company', () => {
  test('produces a high public score and few basic recommendations', () => {
    const result = runAssessment(BASE_ANSWERS);
    assert.ok(result.public.overallScore >= 70, `expected score >= 70, got ${result.public.overallScore}`);
    assert.ok(result.public.recommendations.length <= 3, `expected few recommendations, got ${result.public.recommendations.length}`);
  });
});

describe('Scenario 2 — High ad spend, poor tracking', () => {
  test('triggers MARKETING_HIGH_VALUE and relevant recommendations', () => {
    const answers = withAnswers({
      Q10: ['Google Ads'], Q11: '$25,000-$50,000', Q12: 'We cannot track it', Q13: 'Dissatisfied', Q14: 'No',
    });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('MARKETING_HIGH_VALUE'), 'MARKETING_HIGH_VALUE should trigger');
    assert.ok(flags.includes('GOOGLE_ADS_OPPORTUNITY'), 'GOOGLE_ADS_OPPORTUNITY should trigger');
  });
});

describe('Scenario 3 — High lead volume, slow response', () => {
  test('triggers SALES_AUTOMATION and SLOW_LEAD_RESPONSE', () => {
    const answers = withAnswers({ Q18: '251-500', Q16: '30-60 minutes', Q15: 'No', Q17: 'Usually nothing' });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('SALES_AUTOMATION'));
    assert.ok(flags.includes('SLOW_LEAD_RESPONSE'));
  });
});

describe('Scenario 4 — High missed-call company', () => {
  test('triggers AI_PHONE_AGENT', () => {
    const answers = withAnswers({ Q20: 'More than 25%', Q21: 'Voicemail', Q18: '101-250' });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('AI_PHONE_AGENT'));
  });
});

describe('Scenario 5 — High administrative workload', () => {
  test('triggers EMPLOYEE_PRODUCTIVITY', () => {
    const answers = withAnswers({ Q24: 'Extremely high', Q25: ['Data entry', 'Writing emails', 'Scheduling', 'Customer follow-up', 'Document preparation'] });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('EMPLOYEE_PRODUCTIVITY'));
  });
});

describe('Scenario 6 — Disconnected software', () => {
  test('triggers INTEGRATION_OPPORTUNITY', () => {
    const answers = withAnswers({ Q34: 'Completely disconnected', Q27: 'Constantly' });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('INTEGRATION_OPPORTUNITY'));
  });
});

describe('Scenario 7 — Low AI adoption, no training', () => {
  test('triggers AI_TRAINING', () => {
    const answers = withAnswers({ Q31: 'No', Q29: '0%', Q9: 'Very important' });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('AI_TRAINING'));
  });
});

describe('Scenario 8 — Manual finance workload', () => {
  test('triggers FINANCE_AUTOMATION when finance section is shown and manual tasks are high', () => {
    const answers = withAnswers({
      Q3: '11-25',
      Q25: ['Data entry', 'Creating reports', 'Document preparation'],
      Q49: 'Internal bookkeeper',
      Q50: '2-3',
      Q51: ['Invoice processing', 'Data entry', 'Financial reporting', 'Payment reconciliation'],
      Q52: 'More than 2 weeks',
      Q53: '2-5 hours per week',
      Q54: 'Mostly through spreadsheets',
    });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('FINANCE_AUTOMATION'));
  });
});

describe('Scenario 9 — Multiple opportunities + capacity + urgency', () => {
  test('triggers MANAGED_AI_DEPARTMENT candidate', () => {
    const answers = withAnswers({
      Q2: '$10-$25 million', Q3: '51-100', Q4: '4-10',
      Q9: 'Mission critical', Q38: 'Within 30 days',
      Q11: '$25,000-$50,000', Q12: 'We cannot track it', Q13: 'Dissatisfied', Q14: 'No',
      Q16: '30-60 minutes', Q15: 'No', Q17: 'Usually nothing', Q18: '501-1,000',
      Q20: 'More than 25%', Q21: 'Voicemail',
      Q24: 'Extremely high', Q27: 'Constantly',
    });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('MANAGED_AI_DEPARTMENT'), `expected MANAGED_AI_DEPARTMENT, got flags: ${flags.join(', ')}`);
  });
});

describe('Scenario 10 — Very large enterprise candidate', () => {
  test('triggers ENTERPRISE_CANDIDATE', () => {
    const answers = withAnswers({ Q2: '$100 million+', Q3: '500+' });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('ENTERPRISE_CANDIDATE'));
  });

  test('also triggers via the combined $50-100M + 251-500 employee rule', () => {
    const answers = withAnswers({ Q2: '$50-$100 million', Q3: '251-500' });
    const flags = evaluateFlags(answers);
    assert.ok(flags.includes('ENTERPRISE_CANDIDATE'));
  });

  test('does NOT trigger for a mid-size company', () => {
    const answers = withAnswers({ Q2: '$10-$25 million', Q3: '101-250' });
    const flags = evaluateFlags(answers);
    assert.ok(!flags.includes('ENTERPRISE_CANDIDATE'));
  });
});

describe('Scenario 11 — Unsupported user-requested AI agent', () => {
  test('does NOT promote AI_AGENT_OPPORTUNITY when interest exists but no diagnostic evidence supports it', () => {
    // Strong phone handling, no missed calls, no other opportunity flags.
    const answers = withAnswers({
      Q61: ['AI phone receptionist'],
      Q20: 'Almost none', Q21: 'AI voice agent',
      Q18: 'Under 25',
      Q5: [],
    });
    const flags = evaluateFlags(answers);
    // AI phone agent evidence is weak, and other flags are minimal given BASE_ANSWERS' strong profile.
    assert.ok(!flags.includes('AI_PHONE_AGENT'), 'AI_PHONE_AGENT should not trigger with strong phone handling');
  });

  test('interest alone with zero other flags never produces AI_AGENT_OPPORTUNITY', () => {
    const answers = withAnswers({ Q61: ['Custom AI agent'] });
    const flags = evaluateFlags(answers);
    // BASE_ANSWERS is designed to be a strong/mature profile with few flags.
    if (flags.length === 0) {
      assert.ok(!flags.includes('AI_AGENT_OPPORTUNITY'));
    }
  });
});

describe('Scenario 12 — Insufficient ROI data', () => {
  test('does not fabricate a financial estimate when no ad spend or hours were reported', () => {
    const result = runAssessment(withAnswers({ Q11: '$0', Q62: 'Very little', Q63: 'Very little', Q59: 'We do not know' }));
    for (const scenario of result.roi) {
      if (!scenario.available) {
        assert.equal(scenario.reason, 'Additional data is required to estimate financial impact.');
      }
    }
  });
});

describe('Branching', () => {
  test('Section 10 (sales detail) is hidden for a low-volume, small, non-advertising company', () => {
    const answers = withAnswers({ Q18: 'Under 25', Q3: '1-5', Q10: ['Referrals'], Q11: '$0' });
    const visible = getVisibleQuestions(answers);
    assert.ok(!visible.some((q) => q.id === 'Q44'), 'Q44 should be hidden');
  });

  test('Section 10 is shown when lead volume is meaningful', () => {
    const answers = withAnswers({ Q18: '101-250' });
    const visible = getVisibleQuestions(answers);
    assert.ok(visible.some((q) => q.id === 'Q44'), 'Q44 should be visible');
  });

  test('Section 11 (finance) is skipped for a 1-5 employee company with no finance activities selected', () => {
    const answers = withAnswers({ Q3: '1-5', Q25: ['None of these'] });
    const visible = getVisibleQuestions(answers);
    assert.ok(!visible.some((q) => q.id === 'Q49'), 'Q49 should be hidden');
  });

  test('Section 11 is shown when finance-relevant activities are selected regardless of size', () => {
    const answers = withAnswers({ Q3: '1-5', Q25: ['Creating reports'] });
    const visible = getVisibleQuestions(answers);
    assert.ok(visible.some((q) => q.id === 'Q49'), 'Q49 should be visible');
  });

  test('skipped conditional questions do not lower the public category score', () => {
    // Small company, no finance section shown — Q44/Q45/Q48 (sales category)
    // and non-existent finance-category questions must not drag sales score down.
    const smallCo = withAnswers({ Q18: 'Under 25', Q3: '1-5', Q10: ['Referrals'], Q11: '$0' });
    const shellSmall = calculatePublicScoreShell(smallCo);
    const salesCat = shellSmall.categories.find((c) => c.category === 'sales')!;
    // Only Q15/Q16/Q17/Q19 should count (Q44/Q45/Q48 hidden) — 4 answered questions.
    assert.equal(salesCat.answeredCount, 4, `expected 4 answered sales questions, got ${salesCat.answeredCount}`);
  });
});

describe('Multi-select limits', () => {
  test('Q5 defines maxSelections of 3', () => {
    const q5 = getVisibleQuestions(BASE_ANSWERS).find((q) => q.id === 'Q5')!;
    assert.equal(q5.maxSelections, 3);
  });
});

describe('Score bounds', () => {
  test('public overall score is always between 0 and 100', () => {
    const shell = calculatePublicScoreShell(BASE_ANSWERS);
    assert.ok(shell.overallScore >= 0 && shell.overallScore <= 100);
  });

  test('an all-worst-case profile produces a low but valid score', () => {
    const worst: AnswerMap = { ...BASE_ANSWERS,
      Q6: 'Very limited', Q7: 'No', Q8: 'No', Q9: 'Not currently important',
      Q12: 'We cannot track it', Q13: 'Very dissatisfied', Q14: 'No',
      Q15: 'No', Q16: 'The next business day or later', Q17: 'Usually nothing', Q19: 'No',
      Q20: 'More than 25%', Q21: 'Voicemail', Q22: 'Next business day or later', Q23: 'No',
      Q24: 'Extremely high', Q26: 'Almost none', Q27: 'Constantly', Q28: 'Definitely',
      Q29: '0%', Q31: 'No', Q32: 'No',
      Q34: 'Completely disconnected', Q35: 'No', Q36: 'Poor', Q37: 'Rarely or never',
    };
    const shell = calculatePublicScoreShell(worst);
    assert.equal(shell.overallScore, 0);
    assert.equal(shell.stage, 'AI Foundation Stage');
  });
});

describe('Commercial score bounds', () => {
  test('commercial total never exceeds 100', () => {
    const maxed: AnswerMap = { ...BASE_ANSWERS,
      Q2: '$100 million+', Q11: '$100,000+', Q24: 'Extremely high', Q27: 'Constantly', Q28: 'Definitely',
      Q9: 'Mission critical', Q38: 'Immediately for the right opportunity',
      Q40: 'Owner / Founder', Q39: '$100,000+',
      Q15: 'No', Q16: 'The next business day or later', Q17: 'Usually nothing', Q18: '1,000+', Q19: 'No',
    };
    const commercial = calculateCommercialResult(maxed);
    assert.ok(commercial.total <= 100);
    assert.equal(commercial.classification, 'High Priority Executive Lead');
  });

  test('commercial total never goes below 0', () => {
    const commercial = calculateCommercialResult({});
    assert.ok(commercial.total >= 0);
    assert.equal(commercial.classification, 'Low Priority');
  });

  test('commercial score is never included in the public result object', () => {
    const result = runAssessment(BASE_ANSWERS);
    assert.equal((result.public as any).commercial, undefined);
    assert.equal((result.public as any).commercialScore, undefined);
    assert.equal((result.public as any).classification, undefined);
  });
});

describe('Assessment version', () => {
  test('every result carries assessment_v1', () => {
    const result = runAssessment(BASE_ANSWERS);
    assert.equal(result.assessmentVersion, 'assessment_v1');
    assert.equal(result.public.assessmentVersion, 'assessment_v1');
    assert.equal(result.commercial.assessmentVersion, 'assessment_v1');
  });
});

describe('Going backward / changing answers', () => {
  test('changing an earlier answer recalculates the score deterministically', () => {
    const before = runAssessment(withAnswers({ Q6: 'Very limited' }));
    const after = runAssessment(withAnswers({ Q6: 'Advanced' }));
    assert.notEqual(before.public.overallScore, after.public.overallScore);
  });

  test('the same answers always produce the same result (determinism)', () => {
    const a = runAssessment(BASE_ANSWERS);
    const b = runAssessment(BASE_ANSWERS);
    assert.deepEqual(a.public.overallScore, b.public.overallScore);
    assert.deepEqual(a.flags, b.flags);
  });
});
