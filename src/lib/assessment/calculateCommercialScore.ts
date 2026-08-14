// Private Commercial Opportunity Score.
// Rule source: docs/04-assessment/implementation-spec.md "COMMERCIAL OPPORTUNITY SCORE"
// THIS OUTPUT MUST NEVER BE RENDERED TO THE PROSPECT.

import type { AnswerMap, CommercialClassification, CommercialResult } from '../../data/assessment/types.ts';
import { QUESTIONS, Q2_REVENUE_BANDS, Q3_EMPLOYEE_BANDS } from '../../data/assessment/questions.ts';

function optionValue(answers: AnswerMap, questionId: string, pointsByOption: number[]): number {
  const q = QUESTIONS.find((qq) => qq.id === questionId);
  const answer = answers[questionId];
  if (!q?.options || typeof answer !== 'string') return 0;
  const idx = q.options.findIndex((o) => o.label === answer);
  if (idx < 0) return 0;
  return pointsByOption[idx] ?? 0;
}

function sumCommercialEffect(answers: AnswerMap, target: string): number {
  let total = 0;
  for (const q of QUESTIONS) {
    if (!q.commercialEffects) continue;
    for (const effect of q.commercialEffects) {
      if (effect.target !== target) continue;
      total += optionValue(answers, q.id, effect.pointsByOption);
    }
  }
  return total;
}

function classify(total: number): CommercialClassification {
  if (total <= 39) return 'Low Priority';
  if (total <= 59) return 'Nurture';
  if (total <= 79) return 'Qualified Opportunity';
  return 'High Priority Executive Lead';
}

function isEnterpriseCandidate(answers: AnswerMap): boolean {
  const q2 = answers.Q2;
  const q3 = answers.Q3;
  if (q2 === '$100 million+') return true;
  if (q3 === '500+') return true;
  if (q2 === '$50-$100 million' && q3 === '251-500') return true;
  return false;
}

export function calculateCommercialResult(answers: AnswerMap): CommercialResult {
  // Financial capacity — Q2 only, max 20.
  const financialCapacity = Math.min(20, sumCommercialEffect(answers, 'financialCapacity'));

  // Advertising opportunity — Q11 only, max 15.
  const advertising = Math.min(15, sumCommercialEffect(answers, 'advertising'));

  // Labor automation opportunity — Q24 + Q27 + Q28 + Q56 (if asked) + Q58 (if asked), max 20.
  const labor = Math.min(20, sumCommercialEffect(answers, 'labor'));

  // Sales opportunity — Q15+Q16+Q17+Q18+Q19, max 15.
  const sales = Math.min(15, sumCommercialEffect(answers, 'sales'));

  // AI urgency — Q9 (max 5) + Q38 (max 5), max 10.
  const urgency = Math.min(10, sumCommercialEffect(answers, 'urgency'));

  // Buying authority — Q40 only, max 10.
  const authority = Math.min(10, sumCommercialEffect(answers, 'authority'));

  // Budget willingness — Q39 only, max 10. PRIVATE FIELD.
  const budget = Math.min(10, sumCommercialEffect(answers, 'budget'));

  const total = Math.min(100, financialCapacity + advertising + labor + sales + urgency + authority + budget);

  return {
    assessmentVersion: 'assessment_v1',
    financialCapacity,
    advertising,
    labor,
    sales,
    urgency,
    authority,
    budget,
    total,
    classification: classify(total),
    enterpriseCandidate: isEnterpriseCandidate(answers),
  };
}

export { Q2_REVENUE_BANDS, Q3_EMPLOYEE_BANDS };
