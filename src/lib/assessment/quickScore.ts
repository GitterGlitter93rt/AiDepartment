// Quick Score — deterministic scoring engine.
//
// SEPARATE from the full engine (calculatePublicScore.ts /
// runAssessment.ts). Rules are deliberately the same shape as the full
// engine's (docs/04-assessment/implementation-spec.md):
//   - Category Score = points earned / max possible points for ANSWERED
//     scored questions x 100
//   - Overall Score = sum(category score x weight), rounded to nearest
//     whole number
//   - same five maturity stages with the same thresholds
// Deterministic only: no AI, no randomness, no DOM, no storage — fully
// unit-testable in Node.

import {
  QUICK_ASSESSMENT_VERSION,
  QUICK_CATEGORY_LABELS,
  QUICK_CATEGORY_WEIGHTS,
  type QuickAnswerMap,
  type QuickCategory,
  type QuickCategoryScore,
  type QuickMaturityStage,
  type QuickQuestionDef,
  type QuickResult,
  type QuickSignal,
  type QuickSignalId,
} from '../../data/assessment/quickTypes.ts';
import { QUICK_QUESTIONS } from '../../data/assessment/quickQuestions.ts';

const CATEGORY_ORDER: QuickCategory[] = [
  'leadership', 'marketing', 'sales', 'customerExperience', 'operations', 'employees', 'technology',
];

function stageForScore(score: number): QuickMaturityStage {
  if (score <= 24) return 'AI Foundation Stage';
  if (score <= 49) return 'AI Opportunity Stage';
  if (score <= 69) return 'AI Adoption Stage';
  if (score <= 84) return 'AI Scaling Stage';
  return 'AI Leadership Stage';
}

/** Index of the selected option label, or -1 when unanswered/unknown. */
function selectedIndex(q: QuickQuestionDef, answer: string | undefined): number {
  if (typeof answer !== 'string') return -1;
  return q.options.findIndex((o) => o.label === answer);
}

export function calculateQuickCategoryScores(answers: QuickAnswerMap): QuickCategoryScore[] {
  return CATEGORY_ORDER.map((category) => {
    const questionsInCategory = QUICK_QUESTIONS.filter((q) => q.category === category && q.publicScores);

    let pointsEarned = 0;
    let maxPossible = 0;
    let answeredCount = 0;

    for (const q of questionsInCategory) {
      const idx = selectedIndex(q, answers[q.id]);
      if (idx < 0 || !q.publicScores) continue;
      pointsEarned += q.publicScores[idx] ?? 0;
      maxPossible += Math.max(...q.publicScores);
      answeredCount += 1;
    }

    const scorePercent = maxPossible > 0 ? Math.round((pointsEarned / maxPossible) * 100) : 0;
    return {
      category,
      label: QUICK_CATEGORY_LABELS[category],
      scorePercent,
      answeredCount,
      maxPossible,
      pointsEarned,
    };
  });
}

export function calculateQuickOverallScore(categories: QuickCategoryScore[]): number {
  const weighted = categories.reduce((sum, cat) => sum + cat.scorePercent * QUICK_CATEGORY_WEIGHTS[cat.category], 0);
  return Math.round(weighted);
}

export function getQuickStrongestAreas(categories: QuickCategoryScore[], count = 3): QuickCategory[] {
  return [...categories]
    .filter((c) => c.answeredCount > 0)
    .sort((a, b) => b.scorePercent - a.scorePercent)
    .slice(0, count)
    .map((c) => c.category);
}

// ---- Opportunity signals ------------------------------------------------
// Deterministic: each signal is answered-options only, mirroring the
// severity conditions the full engine's flag engine uses for the same
// source questions. A signal never fabricates a result the answers do
// not support.

interface SignalRule {
  id: QuickSignalId;
  /** Question id + option labels that trigger the signal. */
  when: { questionId: string; optionLabels: string[] }[];
  /** ALL listed conditions must hold (AND of ORs). */
  andAlso?: { questionId: string; optionLabels: string[] }[];
  copy: Omit<QuickSignal, 'id'>;
}

const SIGNAL_RULES: SignalRule[] = [
  {
    id: 'STRATEGY_GAP',
    when: [{ questionId: 'QS3', optionLabels: ['No', 'We have discussed it informally'] }],
    andAlso: [{ questionId: 'QS4', optionLabels: ['Important', 'Very important', 'Mission critical'] }],
    copy: {
      title: 'AI Strategy Gap',
      finding: 'AI matters to your business, but there is no documented strategy guiding where and how to adopt it.',
      action: 'Develop a documented AI strategy tied to your highest-value business priorities.',
      serviceHref: '/ai-consulting/',
      serviceLabel: 'AI Consulting',
    },
  },
  {
    id: 'TRACKING_GAP',
    when: [{ questionId: 'QS5', optionLabels: ['We cannot track it', 'Limited visibility'] }],
    copy: {
      title: 'Marketing Tracking Gap',
      finding: 'You cannot confidently connect marketing spend to revenue, which makes every budget decision harder.',
      action: 'Implement conversion tracking that connects leads and sales back to their marketing source.',
      serviceHref: '/conversion-tracking-analytics/',
      serviceLabel: 'Conversion Tracking and Attribution',
    },
  },
  {
    id: 'MARKETING_UNHAPPY',
    when: [{ questionId: 'QS6', optionLabels: ['Very dissatisfied', 'Dissatisfied'] }],
    copy: {
      title: 'Marketing Performance',
      finding: 'You are not satisfied with your current marketing performance.',
      action: 'Rebuild the underperforming parts of your marketing around clearer offers, better tracking, and consistent follow-up.',
      serviceHref: '/ai-growth-systems/',
      serviceLabel: 'AI Growth Systems',
    },
  },
  {
    id: 'LEAD_RESPONSE_GAP',
    when: [{ questionId: 'QS7', optionLabels: ['30-60 minutes', 'Several hours', 'The next business day or later'] }],
    copy: {
      title: 'Slow Lead Response',
      finding: 'New inbound leads typically wait 30 minutes or longer before anyone responds.',
      action: 'Automate first response so every lead receives contact within minutes, day or night.',
      serviceHref: '/ai-growth-systems/',
      serviceLabel: 'AI Growth Systems',
    },
  },
  {
    id: 'FOLLOWUP_GAP',
    when: [{ questionId: 'QS8', optionLabels: ['Usually nothing', 'A salesperson may try again manually'] }],
    copy: {
      title: 'Follow-Up Leakage',
      finding: 'When a lead does not answer the first attempt, follow-up is inconsistent — many opportunities are lost quietly.',
      action: 'Put a structured, automated follow-up sequence behind every lead.',
      serviceHref: '/ai-growth-systems/',
      serviceLabel: 'AI Growth Systems',
    },
  },
  {
    id: 'MISSED_CALLS',
    when: [{ questionId: 'QS9', optionLabels: ['10-25%', 'More than 25%'] }],
    copy: {
      title: 'Missed Calls',
      finding: 'A meaningful share of inbound calls go unanswered during business hours.',
      action: 'Deploy an AI phone agent that answers, qualifies, and books around the clock.',
      serviceHref: '/ai-agent-development/',
      serviceLabel: 'AI Phone and Voice Agents',
    },
  },
  {
    id: 'SLOW_CUSTOMER_REPLY',
    when: [{ questionId: 'QS10', optionLabels: ['Next business day or later', 'It varies widely'] }],
    copy: {
      title: 'Slow Customer Response',
      finding: 'Customer inquiries often wait a day or longer — or response time is unpredictable.',
      action: 'Automate acknowledgement and first response so customers hear from you quickly, every time.',
      serviceHref: '/ai-implementation/',
      serviceLabel: 'AI Implementation',
    },
  },
  {
    id: 'ADMIN_BURDEN',
    when: [{ questionId: 'QS11', optionLabels: ['Significant amount', 'Extremely high'] }],
    copy: {
      title: 'Administrative Workload',
      finding: 'Repetitive administrative work is consuming significant employee time.',
      action: 'Automate the highest-volume repetitive tasks first and give the time back to your team.',
      serviceHref: '/ai-implementation/',
      serviceLabel: 'AI Implementation',
    },
  },
  {
    id: 'AI_ADOPTION_LOW',
    when: [{ questionId: 'QS12', optionLabels: ['0%', 'Under 10%'] }],
    copy: {
      title: 'Low AI Adoption',
      finding: 'Almost no employees currently use AI tools at work.',
      action: 'Start with role-specific AI training so your team can use AI safely and productively.',
      serviceHref: '/ai-training/',
      serviceLabel: 'AI Training',
    },
  },
  {
    id: 'INTEGRATION_GAP',
    when: [{ questionId: 'QS13', optionLabels: ['Completely disconnected', 'Mostly disconnected'] }],
    copy: {
      title: 'Disconnected Systems',
      finding: 'Your major software systems do not share information, forcing manual re-entry and hiding your real numbers.',
      action: 'Integrate your core systems so data moves automatically between them.',
      serviceHref: '/ai-crm-integration/',
      serviceLabel: 'AI and CRM Integration',
    },
  },
  {
    id: 'REPORTING_GAP',
    when: [{ questionId: 'QS14', optionLabels: ['No', 'Reporting is mostly manual'] }],
    copy: {
      title: 'Reporting Gap',
      finding: 'Leadership cannot easily access accurate KPIs — important decisions are being made on manual or missing numbers.',
      action: 'Build automated, accurate reporting leadership can trust.',
      serviceHref: '/conversion-tracking-analytics/',
      serviceLabel: 'Conversion Tracking and Attribution',
    },
  },
];

function conditionHolds(answers: QuickAnswerMap, cond: { questionId: string; optionLabels: string[] }): boolean {
  const answer = answers[cond.questionId];
  return typeof answer === 'string' && cond.optionLabels.includes(answer);
}

/** Ordered top-to-bottom as defined — deterministic output order. */
export function evaluateQuickSignals(answers: QuickAnswerMap): QuickSignal[] {
  return SIGNAL_RULES.filter((rule) => {
    if (!rule.when.some((cond) => conditionHolds(answers, cond))) return false;
    if (rule.andAlso && !rule.andAlso.every((cond) => conditionHolds(answers, cond))) return false;
    return true;
  }).map((rule) => ({ id: rule.id, ...rule.copy }));
}

/** Enterprise identification mirrors the full engine's employee-band
 * rule (implementation-spec.md ENTERPRISE_QUALIFICATION_FLAG uses the
 * employee band alone when revenue data is absent here). */
export function isQuickEnterpriseCandidate(answers: QuickAnswerMap): boolean {
  return answers.QS2 === '500+';
}

/** Private urgency (0-5) from QS15 — lead routing only, never rendered. */
export function calculateQuickUrgency(answers: QuickAnswerMap): number {
  const q = QUICK_QUESTIONS.find((item) => item.id === 'QS15');
  if (!q || !q.urgencyScores) return 0;
  const idx = selectedIndex(q, answers.QS15);
  if (idx < 0) return 0;
  return q.urgencyScores[idx] ?? 0;
}

/** Orchestrator: quick answers -> full deterministic quick result.
 * The ONLY function quick UI code should call for scoring. */
export function runQuickScore(answers: QuickAnswerMap, now: () => Date = () => new Date()): QuickResult {
  const categories = calculateQuickCategoryScores(answers);
  const overallScore = calculateQuickOverallScore(categories);
  const enterpriseCandidate = isQuickEnterpriseCandidate(answers);

  return {
    assessmentVersion: QUICK_ASSESSMENT_VERSION,
    overallScore,
    stage: stageForScore(overallScore),
    categories,
    strongestAreas: getQuickStrongestAreas(categories),
    signals: evaluateQuickSignals(answers),
    enterpriseCandidate,
    commercial: {
      urgency: calculateQuickUrgency(answers),
      enterpriseCandidate,
      employeeBand: answers.QS2,
      timeframe: answers.QS15,
      industry: answers.QS1,
    },
    completedAt: now().toISOString(),
  };
}
