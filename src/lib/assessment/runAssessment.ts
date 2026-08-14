// Orchestrator: answers -> full deterministic result.
// This is the ONLY function UI code should call to get results. It contains
// no business-rule formulas itself — it composes the calculation modules,
// each of which is independently unit-testable.

import { ASSESSMENT_VERSION, type AnswerMap, type FullAssessmentResult } from '../../data/assessment/types.ts';
import { calculatePublicScoreShell } from './calculatePublicScore.ts';
import { calculateCommercialResult } from './calculateCommercialScore.ts';
import { evaluateFlags } from './evaluateFlags.ts';
import { getRecommendations } from './getRecommendations.ts';
import { calculateROIScenarios } from './calculateROI.ts';

export function runAssessment(answers: AnswerMap): FullAssessmentResult {
  const flags = evaluateFlags(answers);
  const publicShell = calculatePublicScoreShell(answers);
  const recommendations = getRecommendations(flags, answers);
  const commercial = calculateCommercialResult(answers);
  const roi = calculateROIScenarios(answers, flags);

  return {
    assessmentVersion: ASSESSMENT_VERSION,
    completedAt: new Date().toISOString(),
    public: {
      assessmentVersion: ASSESSMENT_VERSION,
      overallScore: publicShell.overallScore,
      stage: publicShell.stage,
      categories: publicShell.categories,
      strongestAreas: publicShell.strongestAreas,
      priorityFlags: flags.filter((f) => f !== 'ENTERPRISE_CANDIDATE'),
      recommendations,
    },
    commercial,
    roi,
    flags,
  };
}
