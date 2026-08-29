// Quick Score model — core type definitions.
//
// This is a SEPARATE model from the canonical 64-question engine
// (src/data/assessment/types.ts). It is intentionally a parallel
// implementation: the full engine (assessment_v1) must remain untouched
// and versioned independently. Nothing in the quick path imports from
// the full engine's data/scoring modules, and vice versa.
//
// Design rules carried over from the full engine's spec
// (docs/04-assessment/implementation-spec.md) so both models feel
// consistent:
//   - 0-4 public points per option, aligned to the option order
//   - Category Score = points earned / max possible for ANSWERED
//     scored questions x 100
//   - Overall Score = sum(category score x weight), rounded to whole
//   - same five maturity stages, same stage thresholds
//   - deterministic only — no AI, no random, no client state in scoring

export const QUICK_ASSESSMENT_VERSION = 'assessment_quick_v1' as const;

/** Same seven public categories as the full engine — shared labels and
 * weights keep the two models comparable (a quick score should mean the
 * same thing as a full score at the category level). */
export type QuickCategory =
  | 'leadership'
  | 'marketing'
  | 'sales'
  | 'customerExperience'
  | 'operations'
  | 'employees'
  | 'technology';

export const QUICK_CATEGORY_LABELS: Record<QuickCategory, string> = {
  leadership: 'Leadership and AI Strategy',
  marketing: 'Marketing and Growth',
  sales: 'Sales and Follow-Up',
  customerExperience: 'Customer Experience',
  operations: 'Operations and Automation',
  employees: 'Employee AI Readiness',
  technology: 'Technology and Data',
};

// Identical weights to the full engine (must sum to 1).
export const QUICK_CATEGORY_WEIGHTS: Record<QuickCategory, number> = {
  leadership: 0.15,
  marketing: 0.15,
  sales: 0.15,
  customerExperience: 0.1,
  operations: 0.2,
  employees: 0.1,
  technology: 0.15,
};

export type QuickQuestionType = 'single';

export interface QuickQuestionOption {
  label: string;
  /** Optional grouping label for the industry <select> (render-only). */
  group?: string;
}

export interface QuickQuestionDef {
  id: string; // e.g. "QS1"
  /** 1-based position in the flow. */
  number: number;
  category?: QuickCategory;
  prompt: string;
  helpText?: string;
  type: QuickQuestionType;
  required: boolean;
  options: QuickQuestionOption[];
  /** Public score per option index (0-4). Absent for profile questions. */
  publicScores?: number[];
  /**
   * Commercial urgency points per option index (private, lead-routing
   * only — never shown to the respondent). Mirrors the full engine's Q38.
   */
  urgencyScores?: number[];
}

export type QuickAnswerMap = Record<string, string>;

export type QuickMaturityStage =
  | 'AI Foundation Stage'
  | 'AI Opportunity Stage'
  | 'AI Adoption Stage'
  | 'AI Scaling Stage'
  | 'AI Leadership Stage';

export interface QuickCategoryScore {
  category: QuickCategory;
  label: string;
  scorePercent: number; // 0-100
  answeredCount: number;
  maxPossible: number;
  pointsEarned: number;
}

export type QuickSignalId =
  | 'STRATEGY_GAP'
  | 'TRACKING_GAP'
  | 'MARKETING_UNHAPPY'
  | 'LEAD_RESPONSE_GAP'
  | 'FOLLOWUP_GAP'
  | 'MISSED_CALLS'
  | 'SLOW_CUSTOMER_REPLY'
  | 'ADMIN_BURDEN'
  | 'AI_ADOPTION_LOW'
  | 'INTEGRATION_GAP'
  | 'REPORTING_GAP';

export interface QuickSignal {
  id: QuickSignalId;
  /** Human-readable headline for the results screen. */
  title: string;
  /** One-sentence restatement of what the answers showed. */
  finding: string;
  /** One-sentence recommended action. */
  action: string;
  /** Related service page for deeper reading. */
  serviceHref: string;
  serviceLabel: string;
}

export interface QuickResult {
  assessmentVersion: typeof QUICK_ASSESSMENT_VERSION;
  overallScore: number; // 0-100, rounded
  stage: QuickMaturityStage;
  categories: QuickCategoryScore[];
  strongestAreas: QuickCategory[];
  signals: QuickSignal[];
  enterpriseCandidate: boolean;
  /** Private, lead-routing only — never rendered to the respondent. */
  commercial: {
    urgency: number; // 0-5
    enterpriseCandidate: boolean;
    employeeBand?: string;
    timeframe?: string;
    industry?: string;
  };
  completedAt: string; // ISO timestamp, client-generated
}
