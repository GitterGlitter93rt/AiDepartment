// AI Department Assessment — core type definitions.
// Source of truth for behavior: docs/04-assessment/implementation-spec.md
// Do not add fields that imply behavior not defined in that spec.

export const ASSESSMENT_VERSION = 'assessment_v1' as const;

export type QuestionType = 'single' | 'multi' | 'text';

export type PublicCategory =
  | 'leadership'
  | 'marketing'
  | 'sales'
  | 'customerExperience'
  | 'operations'
  | 'employees'
  | 'technology';

export const PUBLIC_CATEGORY_LABELS: Record<PublicCategory, string> = {
  leadership: 'Leadership and AI Strategy',
  marketing: 'Marketing and Growth',
  sales: 'Sales and Follow-Up',
  customerExperience: 'Customer Experience',
  operations: 'Operations and Automation',
  employees: 'Employee AI Readiness',
  technology: 'Technology and Data',
};

// Weights per implementation-spec.md "PUBLIC SCORE CATEGORIES" — must sum to 1.
export const PUBLIC_CATEGORY_WEIGHTS: Record<PublicCategory, number> = {
  leadership: 0.15,
  marketing: 0.15,
  sales: 0.15,
  customerExperience: 0.1,
  operations: 0.2,
  employees: 0.1,
  technology: 0.15,
};

// Sections used purely for assessment UI navigation/grouping. Not all map to
// a scored public category (Company Profile, Growth/Buying Intent, and all
// conditional Section 10-13 questions are unscored per spec).
export type SectionId =
  | 'companyProfile'
  | 'leadership'
  | 'marketing'
  | 'sales'
  | 'customerExperience'
  | 'operations'
  | 'employees'
  | 'technology'
  | 'growthIntent'
  | 'salesDetail'
  | 'finance'
  | 'capacity'
  | 'aiAgents';

export interface QuestionOption {
  /** Exact option label per questions.md — do not reword. */
  label: string;
  /** Optional machine-readable value for options whose text differs from a stable slug (e.g. channel flags). */
  value?: string;
  /** Optional grouping label for rendering as a grouped/categorized
   * select (currently used only by Q1's industry selector). Purely a
   * rendering hint — does not affect scoring or validation. */
  group?: string;
}

export interface CommercialEffect {
  /** Which commercial sub-score bucket this question contributes to. */
  target:
    | 'financialCapacity'
    | 'advertising'
    | 'labor'
    | 'sales'
    | 'urgency'
    | 'authority'
    | 'budget';
  /** Points per option index, aligned to `options`. */
  pointsByOption: number[];
}

export interface QuestionDef {
  id: string; // e.g. "Q1"
  number: number;
  section: SectionId;
  /** Public scored category. Undefined if UNSCORED per spec. */
  category?: PublicCategory;
  prompt: string;
  helpText?: string;
  type: QuestionType;
  required: boolean;
  options?: QuestionOption[];
  /** Max selections allowed for type "multi". */
  maxSelections?: number;
  /**
   * Public score per option index (0-4), aligned to `options`.
   * Absent for UNSCORED questions.
   */
  publicScores?: number[];
  /** One or more commercial scoring contributions. */
  commercialEffects?: CommercialEffect[];
  /**
   * Returns true if this question should be displayed, given all answers so
   * far. Absent means "always shown" (core Q1-Q42 minus explicitly
   * conditional items use this).
   */
  displayIf?: (answers: AnswerMap) => boolean;
  /** Optional, render-only filter that hides a specific option from the
   * choices shown to the respondent, based on a prior answer — used to
   * prevent a respondent from selecting a self-contradictory answer
   * (e.g. "CRM assignment" as a lead-routing mechanism after already
   * stating no CRM is in use). This intentionally does NOT modify
   * `options` itself: scoring (calculatePublicScore.ts,
   * calculateCommercialScore.ts) resolves a selected answer by matching
   * its label against the full, unfiltered `options` array, so hiding
   * an option from display has zero effect on publicScores/
   * commercialEffects index alignment. */
  hideOptionIf?: (answers: AnswerMap, optionLabel: string) => boolean;
  /** Free-text max length (safety/consent — not a scoring mechanism). */
  maxLength?: number;
}

export type AnswerValue = string | string[] | undefined;

export interface AnswerMap {
  [questionId: string]: AnswerValue;
}

export type OpportunityFlag =
  | 'MARKETING_HIGH_VALUE'
  | 'GOOGLE_ADS_OPPORTUNITY'
  | 'META_ADS_OPPORTUNITY'
  | 'SEO_OPPORTUNITY'
  | 'SALES_AUTOMATION'
  | 'SLOW_LEAD_RESPONSE'
  | 'LEAD_REACTIVATION'
  | 'AI_PHONE_AGENT'
  | 'CUSTOMER_SERVICE_AUTOMATION'
  | 'EMPLOYEE_PRODUCTIVITY'
  | 'AI_TRAINING'
  | 'AI_GOVERNANCE'
  | 'INTEGRATION_OPPORTUNITY'
  | 'EXECUTIVE_REPORTING'
  | 'FINANCE_AUTOMATION'
  | 'AR_AUTOMATION'
  | 'KNOWLEDGE_ASSISTANT'
  | 'AI_AGENT_OPPORTUNITY'
  | 'EXECUTIVE_STRATEGY'
  | 'MANAGED_AI_DEPARTMENT'
  | 'MULTI_LOCATION_STANDARDIZATION'
  | 'HIRING_AVOIDANCE_ANALYSIS'
  | 'ENTERPRISE_CANDIDATE'
  | 'MANAGEMENT_VISIBILITY'
  | 'MEASUREMENT_GAP';

export type MaturityStage =
  | 'AI Foundation Stage'
  | 'AI Opportunity Stage'
  | 'AI Adoption Stage'
  | 'AI Scaling Stage'
  | 'AI Leadership Stage';

export type CommercialClassification =
  | 'Low Priority'
  | 'Nurture'
  | 'Qualified Opportunity'
  | 'High Priority Executive Lead';

export interface CategoryScoreResult {
  category: PublicCategory;
  label: string;
  scorePercent: number; // 0-100, this category only
  answeredCount: number;
  maxPossible: number;
  pointsEarned: number;
}

export interface PublicResult {
  assessmentVersion: typeof ASSESSMENT_VERSION;
  overallScore: number; // 0-100, rounded
  stage: MaturityStage;
  categories: CategoryScoreResult[];
  strongestAreas: PublicCategory[];
  priorityFlags: OpportunityFlag[];
  recommendations: RecommendationResult[];
}

export interface CommercialResult {
  assessmentVersion: typeof ASSESSMENT_VERSION;
  financialCapacity: number; // /20
  advertising: number; // /15
  labor: number; // /20
  sales: number; // /15
  urgency: number; // /10
  authority: number; // /10
  budget: number; // /10
  total: number; // /100
  classification: CommercialClassification;
  enterpriseCandidate: boolean;
}

export type RecommendationPriority = 1 | 2 | 3 | 4;

export interface RecommendationResult {
  id: string;
  title: string;
  finding: string;
  recommendedAction: string;
  service: string;
  priority: RecommendationPriority;
  supportingFlags: OpportunityFlag[];
}

export interface ROIScenario {
  id: string;
  title: string;
  available: true;
  unit: 'currency' | 'hours';
  summary: string;
  estimateLabel: string;
  estimateLow?: number;
  estimateHigh?: number;
  assumptions: string[];
}

export interface ROIUnavailable {
  id: string;
  title: string;
  available: false;
  reason: string;
}

export type ROIResult = ROIScenario | ROIUnavailable;

export interface FullAssessmentResult {
  assessmentVersion: typeof ASSESSMENT_VERSION;
  completedAt: string; // ISO timestamp, client-generated
  public: PublicResult;
  commercial: CommercialResult; // never rendered to the prospect
  roi: ROIResult[];
  flags: OpportunityFlag[];
}
