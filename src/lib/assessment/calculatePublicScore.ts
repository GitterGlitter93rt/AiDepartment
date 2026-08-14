// Deterministic public score calculation.
// Rule source: docs/04-assessment/implementation-spec.md "PUBLIC SCORING RULE"
//
// Category Score = points earned / maximum possible points for ANSWERED
// scored questions × 100. Conditional questions not displayed do not count
// against the category. Overall Score = sum(categoryScore × categoryWeight),
// rounded to the nearest whole number.

import {
  PUBLIC_CATEGORY_LABELS,
  PUBLIC_CATEGORY_WEIGHTS,
  type AnswerMap,
  type CategoryScoreResult,
  type MaturityStage,
  type PublicCategory,
  type PublicResult,
} from '../../data/assessment/types.ts';
import { getVisibleQuestions } from '../../data/assessment/questions.ts';

const CATEGORY_ORDER: PublicCategory[] = [
  'leadership', 'marketing', 'sales', 'customerExperience', 'operations', 'employees', 'technology',
];

function stageForScore(score: number): MaturityStage {
  if (score <= 24) return 'AI Foundation Stage';
  if (score <= 49) return 'AI Opportunity Stage';
  if (score <= 69) return 'AI Adoption Stage';
  if (score <= 84) return 'AI Scaling Stage';
  return 'AI Leadership Stage';
}

/**
 * Calculates each category's 0-100 score using only questions that are
 * (a) visible under current branching and (b) actually answered.
 */
export function calculateCategoryScores(answers: AnswerMap): CategoryScoreResult[] {
  const visible = getVisibleQuestions(answers);

  return CATEGORY_ORDER.map((category) => {
    const questionsInCategory = visible.filter((q) => q.category === category && q.publicScores);

    let pointsEarned = 0;
    let maxPossible = 0;
    let answeredCount = 0;

    for (const q of questionsInCategory) {
      const answer = answers[q.id];
      if (typeof answer !== 'string') continue; // unanswered/skipped — excluded entirely
      const idx = q.options?.findIndex((o) => o.label === answer) ?? -1;
      if (idx < 0 || !q.publicScores) continue;

      const maxForQuestion = Math.max(...q.publicScores);
      pointsEarned += q.publicScores[idx] ?? 0;
      maxPossible += maxForQuestion;
      answeredCount += 1;
    }

    const scorePercent = maxPossible > 0 ? Math.round((pointsEarned / maxPossible) * 100) : 0;

    return {
      category,
      label: PUBLIC_CATEGORY_LABELS[category],
      scorePercent,
      answeredCount,
      maxPossible,
      pointsEarned,
    };
  });
}

export function calculateOverallScore(categories: CategoryScoreResult[]): number {
  const weighted = categories.reduce((sum, cat) => {
    const weight = PUBLIC_CATEGORY_WEIGHTS[cat.category];
    return sum + cat.scorePercent * weight;
  }, 0);
  return Math.round(weighted);
}

export function getStrongestAreas(categories: CategoryScoreResult[], count = 3): PublicCategory[] {
  return [...categories]
    .filter((c) => c.answeredCount > 0)
    .sort((a, b) => b.scorePercent - a.scorePercent)
    .slice(0, count)
    .map((c) => c.category);
}

/**
 * Computes the full public result shell (score, stage, categories, strongest
 * areas). Flags/recommendations are attached by the orchestrator.
 */
export function calculatePublicScoreShell(answers: AnswerMap): Pick<PublicResult, 'overallScore' | 'stage' | 'categories' | 'strongestAreas'> {
  const categories = calculateCategoryScores(answers);
  const overallScore = calculateOverallScore(categories);
  return {
    overallScore,
    stage: stageForScore(overallScore),
    categories,
    strongestAreas: getStrongestAreas(categories),
  };
}
