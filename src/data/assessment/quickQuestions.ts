// Quick Score question set — 15 questions (12 scored + 3 profile).
//
// SEPARATE from the full 64-question engine (questions.ts). Wording and
// options are reused verbatim from docs/04-assessment/questions.md so
// both models speak the same language, but every question here is a
// new, self-contained definition — the full engine's data is never
// imported or modified.
//
// Question map (source question in parentheses):
//   QS1  industry (Q1, unscored)          QS9  missed calls (Q20)
//   QS2  employees (Q3, unscored)          QS10 customer reply speed (Q22)
//   QS3  AI strategy (Q7)                 QS11 repetitive admin work (Q24)
//   QS4  AI importance (Q9)               QS12 employee AI usage (Q29)
//   QS5  marketing tracking (Q12)         QS13 system integration (Q34)
//   QS6  marketing satisfaction (Q13)     QS14 leadership reporting (Q35)
//   QS7  lead response speed (Q16)        QS15 implementation timeframe (Q38, unscored)
//   QS8  follow-up process (Q17)

import type { QuickQuestionDef } from './quickTypes';
import { INDUSTRIES } from '../../lib/industries.ts';

const INDUSTRY_OPTIONS = [
  ...INDUSTRIES.map((i) => ({ label: i.name, group: i.category })),
  { label: 'Other / Not Listed', group: 'Other' },
];

export const QUICK_EMPLOYEE_BANDS = ['1-5', '6-10', '11-25', '26-50', '51-100', '101-250', '251-500', '500+'];

export const QUICK_QUESTIONS: QuickQuestionDef[] = [
  {
    id: 'QS1',
    number: 1,
    prompt: 'What industry best describes your business?',
    type: 'single',
    required: true,
    options: INDUSTRY_OPTIONS,
  },
  {
    id: 'QS2',
    number: 2,
    prompt: 'Approximately how many employees does your company have?',
    type: 'single',
    required: true,
    options: QUICK_EMPLOYEE_BANDS.map((label) => ({ label })),
  },
  {
    id: 'QS3',
    number: 3,
    category: 'leadership',
    prompt: 'Does your company currently have a documented AI strategy or roadmap?',
    type: 'single',
    required: true,
    options: [
      'No',
      'We have discussed it informally',
      'We are currently developing one',
      'Yes, but it is limited',
      'Yes, and it is actively being implemented',
    ].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'QS4',
    number: 4,
    category: 'leadership',
    prompt: 'How important is AI adoption to your company over the next 12 months?',
    type: 'single',
    required: true,
    options: [
      'Not currently important',
      'Somewhat important',
      'Important',
      'Very important',
      'Mission critical',
    ].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'QS5',
    number: 5,
    category: 'marketing',
    prompt: 'How confident are you that you can accurately track which marketing channels generate revenue?',
    type: 'single',
    required: true,
    options: [
      'We cannot track it',
      'Limited visibility',
      'Somewhat confident',
      'Very confident',
      'Fully tracked from lead to revenue',
    ].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'QS6',
    number: 6,
    category: 'marketing',
    prompt: 'How satisfied are you with your current marketing performance?',
    type: 'single',
    required: true,
    options: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'QS7',
    number: 7,
    category: 'sales',
    prompt: 'How quickly does your team typically respond to a new inbound lead?',
    type: 'single',
    required: true,
    options: [
      'Under 5 minutes',
      '5-15 minutes',
      '15-30 minutes',
      '30-60 minutes',
      'Several hours',
      'The next business day or later',
      'We do not know',
    ].map((label) => ({ label })),
    // Mirrors the full engine's Q16 public scores [4,3,3,2,1,0,0] in
    // implementation-spec.md, with the 15-30 band aligned to the option
    // set used here.
    publicScores: [4, 3, 3, 2, 1, 0, 0],
  },
  {
    id: 'QS8',
    number: 8,
    category: 'sales',
    prompt: 'What happens when a new lead does not answer the first follow-up attempt?',
    type: 'single',
    required: true,
    options: [
      'Usually nothing',
      'A salesperson may try again manually',
      'We have a standard manual follow-up process',
      'We have basic automated follow-up',
      'We have sophisticated automated nurturing',
    ].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'QS9',
    number: 9,
    category: 'customerExperience',
    prompt: 'Approximately what percentage of inbound phone calls go unanswered during business hours?',
    type: 'single',
    required: true,
    options: ['Almost none', 'Under 5%', '5-10%', '10-25%', 'More than 25%', 'We do not know'].map((label) => ({ label })),
    // Same as the full engine's Q20: unknown does not receive the
    // absolute lowest score (unknown-answer rule).
    publicScores: [4, 3, 2, 1, 0, 1],
  },
  {
    id: 'QS10',
    number: 10,
    category: 'customerExperience',
    prompt: 'How quickly are customer emails, messages, or inquiries typically answered?',
    type: 'single',
    required: true,
    options: [
      'Within minutes',
      'Within one hour',
      'Within several hours',
      'Same business day',
      'Next business day or later',
      'It varies widely',
    ].map((label) => ({ label })),
    // Same as the full engine's Q22 [4,3,2,1,0,1].
    publicScores: [4, 3, 2, 1, 0, 1],
  },
  {
    id: 'QS11',
    number: 11,
    category: 'operations',
    prompt: 'How much repetitive administrative work exists inside your company?',
    type: 'single',
    required: true,
    options: ['Very little', 'Some', 'Moderate amount', 'Significant amount', 'Extremely high'].map((label) => ({ label })),
    publicScores: [4, 3, 2, 1, 0],
  },
  {
    id: 'QS12',
    number: 12,
    category: 'employees',
    prompt: 'Approximately what percentage of employees currently use AI tools for work?',
    type: 'single',
    required: true,
    options: ['0%', 'Under 10%', '10-25%', '26-50%', '51-75%', 'More than 75%', 'We do not know'].map((label) => ({ label })),
    // Same as the full engine's Q29 [0,1,2,3,4,4,1].
    publicScores: [0, 1, 2, 3, 4, 4, 1],
  },
  {
    id: 'QS13',
    number: 13,
    category: 'technology',
    prompt: 'How well integrated are your major business software systems?',
    type: 'single',
    required: true,
    options: [
      'Completely disconnected',
      'Mostly disconnected',
      'Some integrations',
      'Well integrated',
      'Highly integrated and automated',
    ].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'QS14',
    number: 14,
    category: 'technology',
    prompt: 'Can leadership easily access accurate business KPIs and reporting?',
    type: 'single',
    required: true,
    options: ['No', 'Reporting is mostly manual', 'Some dashboards exist', 'Good visibility', 'Real-time visibility across the company'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'QS15',
    number: 15,
    prompt: 'If we identified an AI or automation opportunity with clear ROI, how quickly could your company move forward?',
    type: 'single',
    required: true,
    options: [
      'We are only researching',
      '6-12 months',
      '3-6 months',
      '1-3 months',
      'Within 30 days',
      'Immediately for the right opportunity',
    ].map((label) => ({ label })),
    // Mirrors the full engine's Q38 urgency points (implementation-spec.md).
    urgencyScores: [0, 1, 2, 3, 4, 5],
  },
];

export function getQuickQuestion(id: string): QuickQuestionDef | undefined {
  return QUICK_QUESTIONS.find((q) => q.id === id);
}
