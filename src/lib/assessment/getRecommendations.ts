// Recommendation generation.
// Rule source: docs/04-assessment/implementation-spec.md "RECOMMENDATION
// RANKING", "PRIORITY LEVELS", "USER-STATED INTEREST RULE".
//
// Every recommendation returned here is backed by at least one deterministic
// opportunity flag, which is itself evidence-gated (see evaluateFlags.ts).
// User interest (Q5, Q61) never manufactures a recommendation on its own —
// it can only be reflected via AI_AGENT_OPPORTUNITY, which itself requires a
// supporting diagnostic flag to exist first.

import type { AnswerMap, OpportunityFlag, RecommendationResult } from '../../data/assessment/types.ts';
import { RECOMMENDATION_CONTENT } from '../../data/assessment/recommendationContent.ts';
import { calculateCommercialResult } from './calculateCommercialScore.ts';

/**
 * Priority is nudged up when the user's own stated priorities (Q5) align
 * with the recommendation, and when financial capacity supports acting on
 * it — but never assigned without a supporting flag already present.
 */
function priorityFor(flag: OpportunityFlag, basePriority: 1 | 2 | 3 | 4, answers: AnswerMap): 1 | 2 | 3 | 4 {
  const stated = answers.Q5;
  const statedPriorities = Array.isArray(stated) ? stated : [];
  const commercial = calculateCommercialResult(answers);

  const alignsWithStatedPriority: Partial<Record<OpportunityFlag, string[]>> = {
    SLOW_LEAD_RESPONSE: ['Generate more leads', 'Improve sales conversion'],
    SALES_AUTOMATION: ['Improve sales conversion', 'Automate repetitive work'],
    EMPLOYEE_PRODUCTIVITY: ['Improve employee productivity', 'Automate repetitive work'],
    AI_PHONE_AGENT: ['Improve customer service', 'Generate more leads'],
    CUSTOMER_SERVICE_AUTOMATION: ['Improve customer service'],
    MARKETING_HIGH_VALUE: ['Improve marketing ROI'],
    GOOGLE_ADS_OPPORTUNITY: ['Improve marketing ROI'],
    META_ADS_OPPORTUNITY: ['Improve marketing ROI'],
    SEO_OPPORTUNITY: ['Generate more leads', 'Improve marketing ROI'],
    EXECUTIVE_REPORTING: ['Improve reporting and visibility'],
    AI_TRAINING: ['Train employees to use AI'],
    HIRING_AVOIDANCE_ANALYSIS: ['Hire fewer people while growing'],
  };

  let priority = basePriority;

  const aligned = alignsWithStatedPriority[flag]?.some((p) => statedPriorities.includes(p));
  if (aligned && priority > 1) {
    priority = (priority - 1) as typeof priority;
  }

  // Strong financial capacity can raise (never lower) mid-tier items slightly,
  // reflecting real implementation feasibility — never overrides evidence.
  if (commercial.financialCapacity >= 14 && priority === 3) {
    priority = 2;
  }

  return priority;
}

export function getRecommendations(flags: OpportunityFlag[], answers: AnswerMap): RecommendationResult[] {
  const results: RecommendationResult[] = [];

  for (const flag of flags) {
    const content = RECOMMENDATION_CONTENT[flag];
    if (!content) continue; // qualification-only flags (e.g. ENTERPRISE_CANDIDATE) never become recommendations directly

    results.push({
      id: content.flag,
      title: content.title,
      finding: content.finding,
      recommendedAction: content.recommendedAction,
      service: content.service,
      priority: priorityFor(flag, content.basePriority, answers),
      supportingFlags: [flag],
    });
  }

  // Rank by priority (1 = highest), stable within a priority tier.
  return results.sort((a, b) => a.priority - b.priority);
}
