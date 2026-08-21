// AI Department Assessment — canonical V1 question set.
// Wording and options: docs/04-assessment/questions.md
// Scoring, commercial effects, branching: docs/04-assessment/implementation-spec.md
// Do not reorder options or edit scoring arrays without updating both docs.

import type { AnswerMap, QuestionDef } from './types';
import { INDUSTRIES } from '../../lib/industries.ts';

// Q1's options are generated from the central industry registry so the
// assessment always reflects every industry the site actually supports,
// plus a catch-all for anything not listed. Category is preserved on
// each option so the UI can render a grouped select instead of a long
// flat list. Adding an industry to the registry is sufficient — no
// change needed here.
const INDUSTRY_OPTIONS = [
  ...INDUSTRIES.map((i) => ({ label: i.name, group: i.category })),
  { label: 'Other / Not Listed', group: 'Other' },
];

// ---- Branching helpers -----------------------------------------------
// Options for band-style questions are defined in ascending order, so
// "at least X" is expressed as "selected option index >= X's index".

function selectedIndex(answers: AnswerMap, qid: string, options: string[]): number {
  const val = answers[qid];
  if (typeof val !== 'string') return -1;
  return options.indexOf(val);
}

function atLeast(answers: AnswerMap, qid: string, options: string[], threshold: string): boolean {
  const idx = selectedIndex(answers, qid, options);
  const thresholdIdx = options.indexOf(threshold);
  return idx >= 0 && thresholdIdx >= 0 && idx >= thresholdIdx;
}

function isOneOf(answers: AnswerMap, qid: string, values: string[]): boolean {
  const val = answers[qid];
  if (typeof val !== 'string') return false;
  return values.includes(val);
}

function multiIncludes(answers: AnswerMap, qid: string, value: string): boolean {
  const val = answers[qid];
  if (!Array.isArray(val)) return false;
  return val.includes(value);
}

function multiCountExcluding(answers: AnswerMap, qid: string, excluded: string[]): number {
  const val = answers[qid];
  if (!Array.isArray(val)) return 0;
  return val.filter((v) => !excluded.includes(v)).length;
}

// Option bands referenced repeatedly by branching conditions.
export const Q3_EMPLOYEE_BANDS = ['1-5', '6-10', '11-25', '26-50', '51-100', '101-250', '251-500', '500+'];
export const Q4_LOCATION_BANDS = ['1', '2-3', '4-10', '11-25', '26+'];
export const Q18_LEAD_VOLUME_BANDS = ['Under 25', '25-100', '101-250', '251-500', '501-1,000', '1,000+', 'We do not know'];
export const Q2_REVENUE_BANDS = [
  'Under $500,000',
  '$500,000-$1 million',
  '$1-$3 million',
  '$3-$10 million',
  '$10-$25 million',
  '$25-$50 million',
  '$50-$100 million',
  '$100 million+',
];

export const MANUAL_WORK_EXCLUDED = ['None of these'];

export const QUESTIONS: QuestionDef[] = [
  // ---------------- SECTION 1 — COMPANY PROFILE ----------------
  {
    id: 'Q1',
    number: 1,
    section: 'companyProfile',
    prompt: 'What industry best describes your business?',
    type: 'single',
    required: true,
    options: INDUSTRY_OPTIONS,
  },
  {
    id: 'Q2',
    number: 2,
    section: 'companyProfile',
    prompt: 'Approximately how much annual revenue does your company generate?',
    type: 'single',
    required: true,
    options: Q2_REVENUE_BANDS.map((label) => ({ label })),
    commercialEffects: [{ target: 'financialCapacity', pointsByOption: [1, 3, 6, 10, 14, 17, 20, 20] }],
  },
  {
    id: 'Q3',
    number: 3,
    section: 'companyProfile',
    prompt: 'Approximately how many employees does your company have?',
    type: 'single',
    required: true,
    options: Q3_EMPLOYEE_BANDS.map((label) => ({ label })),
  },
  {
    id: 'Q4',
    number: 4,
    section: 'companyProfile',
    prompt: 'How many physical locations does your company operate?',
    type: 'single',
    required: true,
    options: Q4_LOCATION_BANDS.map((label) => ({ label })),
  },
  {
    id: 'Q5',
    number: 5,
    section: 'companyProfile',
    prompt: "What are your company's biggest priorities over the next 12 months?",
    helpText: 'Select up to three.',
    type: 'multi',
    required: true,
    maxSelections: 3,
    options: [
      'Increase revenue', 'Generate more leads', 'Improve marketing ROI', 'Improve sales conversion',
      'Reduce operating costs', 'Improve employee productivity', 'Improve customer service',
      'Automate repetitive work', 'Hire fewer people while growing', 'Improve reporting and visibility',
      'Train employees to use AI', 'Modernize technology', 'Expand locations', 'Improve profitability',
    ].map((label) => ({ label })),
  },

  // ---------------- SECTION 2 — LEADERSHIP AND AI STRATEGY ----------------
  {
    id: 'Q6',
    number: 6,
    section: 'leadership',
    category: 'leadership',
    prompt: "How would you rate leadership's understanding of AI?",
    type: 'single',
    required: true,
    options: ['Very limited', 'Basic', 'Moderate', 'Strong', 'Advanced'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'Q7',
    number: 7,
    section: 'leadership',
    category: 'leadership',
    prompt: 'Does your company currently have a documented AI strategy or roadmap?',
    type: 'single',
    required: true,
    options: [
      'No', 'We have discussed it informally', 'We are currently developing one',
      'Yes, but it is limited', 'Yes, and it is actively being implemented',
    ].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'Q8',
    number: 8,
    section: 'leadership',
    category: 'leadership',
    prompt: 'Is anyone currently responsible for AI adoption inside the company?',
    type: 'single',
    required: true,
    options: [
      'No', 'Ownership is unclear', 'One employee handles it informally',
      'A department leader owns it', 'We have dedicated AI or technology leadership',
    ].map((label) => ({ label })),
    publicScores: [0, 0, 1, 3, 4],
  },
  {
    id: 'Q9',
    number: 9,
    section: 'leadership',
    category: 'leadership',
    prompt: 'How important is AI adoption to your company over the next 12 months?',
    type: 'single',
    required: true,
    options: ['Not currently important', 'Somewhat important', 'Important', 'Very important', 'Mission critical'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
    commercialEffects: [{ target: 'urgency', pointsByOption: [0, 1, 2, 4, 5] }],
  },

  // ---------------- SECTION 3 — MARKETING AND LEAD GENERATION ----------------
  {
    id: 'Q10',
    number: 10,
    section: 'marketing',
    prompt: 'Which channels currently generate leads for your business?',
    type: 'multi',
    required: true,
    options: [
      'Google Ads', 'Meta / Facebook Ads', 'SEO', 'Google Business Profile', 'Referrals', 'LinkedIn',
      'Email marketing', 'Direct mail', 'Organic social media', 'Cold outbound', 'Partnerships', 'Other',
      'We do not have a consistent lead source',
    ].map((label) => ({ label })),
  },
  {
    id: 'Q11',
    number: 11,
    section: 'marketing',
    prompt: 'Approximately how much does your company spend on paid advertising each month?',
    type: 'single',
    required: true,
    options: [
      '$0', 'Under $2,500', '$2,500-$5,000', '$5,000-$10,000', '$10,000-$25,000',
      '$25,000-$50,000', '$50,000-$100,000', '$100,000+',
    ].map((label) => ({ label })),
    commercialEffects: [{ target: 'advertising', pointsByOption: [0, 2, 4, 7, 10, 12, 15, 15] }],
  },
  {
    id: 'Q12',
    number: 12,
    section: 'marketing',
    category: 'marketing',
    prompt: 'How confident are you that you can accurately track which marketing channels generate revenue?',
    type: 'single',
    required: true,
    options: ['We cannot track it', 'Limited visibility', 'Somewhat confident', 'Very confident', 'Fully tracked from lead to revenue'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'Q13',
    number: 13,
    section: 'marketing',
    category: 'marketing',
    prompt: 'How satisfied are you with your current marketing performance?',
    type: 'single',
    required: true,
    options: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'Q14',
    number: 14,
    section: 'marketing',
    category: 'marketing',
    prompt: 'Do you actively optimize landing pages or website conversion rates?',
    type: 'single',
    required: true,
    options: ['No', 'Occasionally', 'Yes, but without structured testing', 'Yes, regularly', 'Yes, using structured conversion testing'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },

  // ---------------- SECTION 4 — SALES AND FOLLOW-UP ----------------
  {
    id: 'Q15',
    number: 15,
    section: 'sales',
    category: 'sales',
    prompt: 'Does your business use a CRM to track leads and sales opportunities?',
    type: 'single',
    required: true,
    options: ['No', 'Yes, but adoption is poor', 'Yes, partially', 'Yes, consistently', 'Yes, with advanced automation'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
    commercialEffects: [{ target: 'sales', pointsByOption: [2, 2, 1, 0, 0] }],
  },
  {
    id: 'Q16',
    number: 16,
    section: 'sales',
    category: 'sales',
    prompt: 'How quickly does your team typically respond to a new inbound lead?',
    type: 'single',
    required: true,
    options: ['Under 5 minutes', '5-15 minutes', '15-30 minutes', '30-60 minutes', 'Several hours', 'The next business day or later', 'We do not know'].map((label) => ({ label })),
    publicScores: [4, 3, 3, 2, 1, 0, 0],
    commercialEffects: [{ target: 'sales', pointsByOption: [0, 0, 1, 2, 3, 4, 2] }],
  },
  {
    id: 'Q17',
    number: 17,
    section: 'sales',
    category: 'sales',
    prompt: 'What happens when a new lead does not answer the first follow-up attempt?',
    type: 'single',
    required: true,
    options: ['Usually nothing', 'A salesperson may try again manually', 'We have a standard manual follow-up process', 'We have basic automated follow-up', 'We have sophisticated automated nurturing'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
    commercialEffects: [{ target: 'sales', pointsByOption: [4, 3, 2, 1, 0] }],
  },
  {
    id: 'Q18',
    number: 18,
    section: 'sales',
    prompt: 'Approximately how many new leads does your company receive per month?',
    type: 'single',
    required: true,
    options: Q18_LEAD_VOLUME_BANDS.map((label) => ({ label })),
    commercialEffects: [{ target: 'sales', pointsByOption: [0, 1, 2, 3, 3, 3, 0] }],
  },
  {
    id: 'Q19',
    number: 19,
    section: 'sales',
    category: 'sales',
    prompt: 'Do you know your lead-to-customer conversion rate?',
    type: 'single',
    required: true,
    options: ['No', 'We estimate it', 'We track it occasionally', 'Yes, consistently', 'Yes, by marketing source and salesperson'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
    commercialEffects: [{ target: 'sales', pointsByOption: [2, 2, 1, 0, 0] }],
  },

  // ---------------- SECTION 5 — CUSTOMER SERVICE ----------------
  {
    id: 'Q20',
    number: 20,
    section: 'customerExperience',
    category: 'customerExperience',
    prompt: 'Approximately what percentage of inbound phone calls go unanswered during business hours?',
    type: 'single',
    required: true,
    options: ['Almost none', 'Under 5%', '5-10%', '10-25%', 'More than 25%', 'We do not know'].map((label) => ({ label })),
    publicScores: [4, 3, 2, 1, 0, 1],
  },
  {
    id: 'Q21',
    number: 21,
    section: 'customerExperience',
    category: 'customerExperience',
    prompt: 'What happens to calls received after business hours?',
    type: 'single',
    required: true,
    options: ['Voicemail', 'Answering service', 'On-call employee', 'Automated system', 'AI voice agent', 'We are unsure'].map((label) => ({ label })),
    publicScores: [0, 2, 3, 3, 4, 1],
  },
  {
    id: 'Q22',
    number: 22,
    section: 'customerExperience',
    category: 'customerExperience',
    prompt: 'How quickly are customer emails, messages, or inquiries typically answered?',
    type: 'single',
    required: true,
    options: ['Within minutes', 'Within one hour', 'Within several hours', 'Same business day', 'Next business day or later', 'It varies widely'].map((label) => ({ label })),
    publicScores: [4, 3, 2, 1, 0, 1],
  },
  {
    id: 'Q23',
    number: 23,
    section: 'customerExperience',
    category: 'customerExperience',
    prompt: 'Does your company use automated appointment scheduling?',
    type: 'single',
    required: true,
    options: ['No', 'Partially', 'Yes', 'Yes, integrated with CRM and follow-up'].map((label) => ({ label })),
    publicScores: [0, 1, 3, 4],
    // Same contradiction class as Q44: "integrated with CRM" presupposes
    // CRM ownership, which Q15 already ruled out. Hiding just this one
    // option preserves the other 3 valid answers and leaves scoring
    // untouched (publicScores still indexes against the full array).
    hideOptionIf: (a, optionLabel) => optionLabel === 'Yes, integrated with CRM and follow-up' && a.Q15 === 'No',
  },

  // ---------------- SECTION 6 — OPERATIONS AND AUTOMATION ----------------
  {
    id: 'Q24',
    number: 24,
    section: 'operations',
    category: 'operations',
    prompt: 'How much repetitive administrative work exists inside your company?',
    type: 'single',
    required: true,
    options: ['Very little', 'Some', 'Moderate amount', 'Significant amount', 'Extremely high'].map((label) => ({ label })),
    publicScores: [4, 3, 2, 1, 0],
    commercialEffects: [{ target: 'labor', pointsByOption: [0, 1, 2, 4, 5] }],
  },
  {
    id: 'Q25',
    number: 25,
    section: 'operations',
    prompt: 'Which activities consume significant employee time?',
    type: 'multi',
    required: true,
    options: [
      'Data entry', 'Writing emails', 'Creating reports', 'Scheduling', 'Customer follow-up',
      'Document preparation', 'Searching for information', 'Updating CRM records',
      'Preparing estimates or proposals', 'Internal reporting', 'Reviewing documents', 'Meeting notes',
      'Customer support', 'Marketing content', 'None of these',
    ].map((label) => ({ label })),
  },
  {
    id: 'Q26',
    number: 26,
    section: 'operations',
    category: 'operations',
    prompt: 'Are your important business processes documented as SOPs?',
    type: 'single',
    required: true,
    options: ['Almost none', 'A few', 'About half', 'Most', 'Nearly all'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'Q27',
    number: 27,
    section: 'operations',
    category: 'operations',
    prompt: 'How often do employees manually move information between different software systems?',
    type: 'single',
    required: true,
    options: ['Rarely', 'Occasionally', 'Weekly', 'Daily', 'Constantly'].map((label) => ({ label })),
    publicScores: [4, 3, 2, 1, 0],
    commercialEffects: [{ target: 'labor', pointsByOption: [0, 1, 2, 3, 4] }],
  },
  {
    id: 'Q28',
    number: 28,
    section: 'operations',
    category: 'operations',
    prompt: 'If your company grew 50% next year, would you need to increase administrative headcount significantly?',
    type: 'single',
    required: true,
    options: ['No', 'Probably not', 'Unsure', 'Probably', 'Definitely'].map((label) => ({ label })),
    publicScores: [4, 3, 2, 1, 0],
    commercialEffects: [{ target: 'labor', pointsByOption: [0, 1, 2, 3, 4] }],
  },

  // ---------------- SECTION 7 — EMPLOYEES AND TRAINING ----------------
  {
    id: 'Q29',
    number: 29,
    section: 'employees',
    category: 'employees',
    prompt: 'Approximately what percentage of employees currently use AI tools for work?',
    type: 'single',
    required: true,
    options: ['0%', 'Under 10%', '10-25%', '26-50%', '51-75%', 'More than 75%', 'We do not know'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4, 4, 1],
  },
  {
    id: 'Q30',
    number: 30,
    section: 'employees',
    prompt: 'Which AI tools are currently used inside your organization?',
    type: 'multi',
    required: true,
    options: [
      'ChatGPT', 'Claude', 'Microsoft Copilot', 'Google Gemini', 'Industry-specific AI tools',
      'AI features inside existing software', 'Other', 'None', 'We do not know',
    ].map((label) => ({ label })),
  },
  {
    id: 'Q31',
    number: 31,
    section: 'employees',
    category: 'employees',
    prompt: 'Has your company formally trained employees on how to use AI?',
    type: 'single',
    required: true,
    options: ['No', 'Informal tips only', 'A few employees received training', 'Some departments received training', 'Company-wide training exists'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'Q32',
    number: 32,
    section: 'employees',
    category: 'employees',
    prompt: 'Does your company have an AI usage policy covering privacy, confidential information, or acceptable use?',
    type: 'single',
    required: true,
    options: ['No', 'We are developing one', 'Basic guidelines exist', 'Yes, formal policy exists', 'Yes, and employees receive recurring training'].map((label) => ({ label })),
    publicScores: [0, 2, 3, 4, 4],
  },
  {
    id: 'Q33',
    number: 33,
    section: 'employees',
    prompt: 'How concerned is leadership about employees using AI incorrectly or exposing sensitive information?',
    type: 'single',
    required: true,
    options: ['Not concerned', 'Slightly concerned', 'Moderately concerned', 'Very concerned', 'Extremely concerned'].map((label) => ({ label })),
  },

  // ---------------- SECTION 8 — TECHNOLOGY AND DATA ----------------
  {
    id: 'Q34',
    number: 34,
    section: 'technology',
    category: 'technology',
    prompt: 'How well integrated are your major business software systems?',
    type: 'single',
    required: true,
    options: ['Completely disconnected', 'Mostly disconnected', 'Some integrations', 'Well integrated', 'Highly integrated and automated'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'Q35',
    number: 35,
    section: 'technology',
    category: 'technology',
    prompt: 'Can leadership easily access accurate business KPIs and reporting?',
    type: 'single',
    required: true,
    options: ['No', 'Reporting is mostly manual', 'Some dashboards exist', 'Good visibility', 'Real-time visibility across the company'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'Q36',
    number: 36,
    section: 'technology',
    category: 'technology',
    prompt: "How would you rate the quality and accessibility of your company's business data?",
    type: 'single',
    required: true,
    options: ['Poor', 'Inconsistent', 'Average', 'Good', 'Excellent'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },
  {
    id: 'Q37',
    number: 37,
    section: 'technology',
    category: 'technology',
    prompt: 'Does your company regularly evaluate new software or AI tools?',
    type: 'single',
    required: true,
    options: ['Rarely or never', 'Occasionally', 'When a problem arises', 'Regularly', 'We have a formal evaluation process'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
  },

  // ---------------- SECTION 9 — GROWTH AND BUYING INTENT (all UNSCORED publicly) ----------------
  {
    id: 'Q38',
    number: 38,
    section: 'growthIntent',
    prompt: 'If we identified an AI or automation opportunity with clear ROI, how quickly could your company move forward?',
    type: 'single',
    required: true,
    options: ['We are only researching', '6-12 months', '3-6 months', '1-3 months', 'Within 30 days', 'Immediately for the right opportunity'].map((label) => ({ label })),
    commercialEffects: [{ target: 'urgency', pointsByOption: [0, 1, 2, 3, 4, 5] }],
  },
  {
    id: 'Q39',
    number: 39,
    section: 'growthIntent',
    prompt: 'What level of investment would your company consider for an initiative with a strong business case?',
    type: 'single',
    required: true,
    options: ['Under $2,500', '$2,500-$5,000', '$5,000-$10,000', '$10,000-$25,000', '$25,000-$50,000', '$50,000-$100,000', '$100,000+', 'Depends entirely on ROI'].map((label) => ({ label })),
    commercialEffects: [{ target: 'budget', pointsByOption: [1, 2, 4, 6, 8, 9, 10, 7] }],
  },
  {
    id: 'Q40',
    number: 40,
    section: 'growthIntent',
    prompt: 'What is your role in the company?',
    type: 'single',
    required: true,
    options: ['Owner / Founder', 'CEO / President', 'Executive', 'Partner', 'Department Leader', 'Marketing Leader', 'Operations Leader', 'IT / Technology', 'Employee', 'Consultant / Advisor', 'Other'].map((label) => ({ label })),
    commercialEffects: [{ target: 'authority', pointsByOption: [10, 10, 8, 8, 6, 5, 5, 5, 2, 2, 2] }],
  },
  {
    id: 'Q41',
    number: 41,
    section: 'growthIntent',
    prompt: 'What would you most like AI to help your company accomplish?',
    type: 'text',
    required: false,
    maxLength: 600,
  },
  {
    id: 'Q42',
    number: 42,
    section: 'growthIntent',
    prompt: "What is the biggest bottleneck currently limiting your company's growth?",
    type: 'text',
    required: false,
    maxLength: 600,
  },

  // ---------------- SECTION 10 — DETAILED SALES PROCESS (conditional) ----------------
  {
    id: 'Q43',
    number: 43,
    section: 'salesDetail',
    prompt: 'How many employees are directly involved in sales or lead handling?',
    type: 'single',
    required: true,
    options: ['0', '1', '2-5', '6-10', '11-25', '26+'].map((label) => ({ label })),
    displayIf: (a) => section10DisplayCondition(a),
  },
  {
    id: 'Q44',
    number: 44,
    section: 'salesDetail',
    category: 'sales',
    prompt: 'How are new leads assigned to salespeople?',
    type: 'single',
    required: true,
    options: ['Manually', 'Whoever answers first', 'Spreadsheet', 'CRM assignment', 'Automated routing', 'AI-assisted qualification and routing', 'We do not have a consistent process'].map((label) => ({ label })),
    publicScores: [1, 1, 1, 3, 4, 4, 0],
    displayIf: (a) => section10DisplayCondition(a),
    // "CRM assignment" presupposes CRM ownership. A respondent who
    // already answered "No" to Q15 ("Does your business use a CRM to
    // track leads and sales opportunities?") cannot also legitimately
    // report that a CRM assigns their leads — that would be a direct
    // self-contradiction within the same completed assessment. Hiding
    // just this one option (not the whole question) preserves every
    // other valid answer path and leaves scoring untouched, since
    // publicScores/commercialEffects still index against the full,
    // unfiltered options array above.
    hideOptionIf: (a, optionLabel) => optionLabel === 'CRM assignment' && a.Q15 === 'No',
  },
  {
    id: 'Q45',
    number: 45,
    section: 'salesDetail',
    category: 'sales',
    prompt: 'Does your team use a documented sales process?',
    type: 'single',
    required: true,
    options: ['No', 'Mostly informal', 'Partially documented', 'Yes', 'Yes, and performance is measured consistently'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
    displayIf: (a) => section10DisplayCondition(a),
  },
  {
    id: 'Q46',
    number: 46,
    section: 'salesDetail',
    prompt: 'How much salesperson time is spent on administrative work instead of selling?',
    type: 'single',
    required: true,
    options: ['Very little', 'Under 5 hours per week', '5-10 hours per week', '10-20 hours per week', 'More than 20 hours per week', 'We do not know'].map((label) => ({ label })),
    displayIf: (a) => section10DisplayCondition(a),
  },
  {
    id: 'Q47',
    number: 47,
    section: 'salesDetail',
    prompt: 'Which sales tasks are still primarily manual?',
    type: 'multi',
    required: true,
    options: [
      'Lead qualification', 'Lead assignment', 'Follow-up emails', 'Follow-up text messages', 'Calling leads',
      'Scheduling', 'CRM data entry', 'Meeting notes', 'Proposal creation', 'Estimate creation',
      'Pipeline reporting', 'Sales forecasting', 'Lost-lead follow-up', 'Customer reactivation', 'None',
    ].map((label) => ({ label })),
    displayIf: (a) => section10DisplayCondition(a),
  },
  {
    id: 'Q48',
    number: 48,
    section: 'salesDetail',
    category: 'sales',
    prompt: 'Does your company systematically follow up with old leads or past customers?',
    type: 'single',
    required: true,
    options: ['No', 'Occasionally', 'Manually', 'Some automation', 'Yes, consistently with automated campaigns'].map((label) => ({ label })),
    publicScores: [0, 1, 2, 3, 4],
    displayIf: (a) => section10DisplayCondition(a),
  },

  // ---------------- SECTION 11 — FINANCE AND ACCOUNTING (conditional) ----------------
  {
    id: 'Q49',
    number: 49,
    section: 'finance',
    prompt: 'How is bookkeeping and accounting handled?',
    type: 'single',
    required: true,
    options: ['Business owner handles it', 'Internal bookkeeper', 'Internal accounting department', 'External bookkeeper', 'External accounting firm', 'Combination of internal and external', 'Other'].map((label) => ({ label })),
    displayIf: (a) => section11DisplayCondition(a),
  },
  {
    id: 'Q50',
    number: 50,
    section: 'finance',
    prompt: 'How many internal employees spend meaningful time on bookkeeping, accounting, billing, collections, or financial administration?',
    type: 'single',
    required: true,
    options: ['0', '1', '2-3', '4-10', '11+', 'We do not know'].map((label) => ({ label })),
    displayIf: (a) => section11DisplayCondition(a),
  },
  {
    id: 'Q51',
    number: 51,
    section: 'finance',
    prompt: 'Which finance or accounting activities require significant manual work?',
    type: 'multi',
    required: true,
    options: [
      'Invoice processing', 'Invoice creation', 'Expense categorization', 'Receipt processing',
      'Accounts receivable follow-up', 'Accounts payable', 'Payment reconciliation', 'Data entry',
      'Financial reporting', 'Management reports', 'Budget preparation', 'Forecasting',
      'Document collection', 'Payroll administration', 'Expense approvals', 'None', 'We do not know',
    ].map((label) => ({ label })),
    displayIf: (a) => section11DisplayCondition(a),
  },
  {
    id: 'Q52',
    number: 52,
    section: 'finance',
    prompt: 'How long does it typically take leadership to receive accurate monthly financial reporting?',
    type: 'single',
    required: true,
    options: ['Real time or near real time', '1-3 days', '4-7 days', '1-2 weeks', 'More than 2 weeks', 'Reporting is inconsistent', 'We do not know'].map((label) => ({ label })),
    displayIf: (a) => section11DisplayCondition(a),
  },
  {
    id: 'Q53',
    number: 53,
    section: 'finance',
    prompt: 'How much time is spent manually chasing customers for unpaid invoices?',
    type: 'single',
    required: true,
    options: ['Almost none', 'Under 2 hours per week', '2-5 hours per week', '5-10 hours per week', 'More than 10 hours per week', 'We do not know'].map((label) => ({ label })),
    displayIf: (a) => section11DisplayCondition(a),
  },
  {
    id: 'Q54',
    number: 54,
    section: 'finance',
    prompt: 'Does leadership have easy access to cash flow, profitability, receivables, expenses, and other key financial KPIs?',
    type: 'single',
    required: true,
    options: ['No', 'Mostly through spreadsheets', 'Available monthly', 'Dashboard exists', 'Real-time or near-real-time visibility'].map((label) => ({ label })),
    displayIf: (a) => section11DisplayCondition(a),
  },

  // ---------------- SECTION 12 — ADMINISTRATIVE WORK AND CAPACITY (conditional) ----------------
  {
    id: 'Q55',
    number: 55,
    section: 'capacity',
    prompt: 'Which departments currently feel understaffed or overloaded?',
    type: 'multi',
    required: true,
    options: [
      'Executive / Leadership', 'Sales', 'Marketing', 'Customer Service', 'Operations',
      'Accounting / Finance', 'Human Resources', 'Administration', 'IT', 'Scheduling / Dispatch',
      'No major capacity problems', 'Other',
    ].map((label) => ({ label })),
    displayIf: (a) => section12DisplayCondition(a),
  },
  {
    id: 'Q56',
    number: 56,
    section: 'capacity',
    prompt: 'Are employees regularly working overtime because of administrative or repetitive workload?',
    type: 'single',
    required: true,
    options: ['No', 'Occasionally', 'Some departments', 'Frequently', 'Yes, across multiple departments'].map((label) => ({ label })),
    commercialEffects: [{ target: 'labor', pointsByOption: [0, 1, 2, 3, 4] }],
    displayIf: (a) => section12DisplayCondition(a),
  },
  {
    id: 'Q57',
    number: 57,
    section: 'capacity',
    prompt: 'If repetitive work could be automated, what would your company most likely do with the additional capacity?',
    type: 'multi',
    required: true,
    options: [
      'Handle more customers', 'Increase sales activity', 'Improve customer service', 'Reduce overtime',
      'Avoid future hiring', 'Reassign employees to higher-value work', 'Reduce headcount where appropriate',
      'Improve reporting', 'Expand the business', 'Unsure',
    ].map((label) => ({ label })),
    displayIf: (a) => section12DisplayCondition(a),
  },
  {
    id: 'Q58',
    number: 58,
    section: 'capacity',
    prompt: 'Is your company currently planning to hire additional administrative, customer service, sales support, bookkeeping, or operations employees?',
    type: 'single',
    required: true,
    options: ['No', 'Possibly within 12 months', 'Yes, within 6-12 months', 'Yes, within 3-6 months', 'Yes, currently hiring'].map((label) => ({ label })),
    commercialEffects: [{ target: 'labor', pointsByOption: [0, 1, 2, 3, 3] }],
    displayIf: (a) => section12DisplayCondition(a),
  },
  {
    id: 'Q59',
    number: 59,
    section: 'capacity',
    prompt: 'Approximately what does your company spend annually on administrative and support labor?',
    type: 'single',
    required: true,
    options: ['Under $50,000', '$50,000-$150,000', '$150,000-$300,000', '$300,000-$500,000', '$500,000-$1 million', '$1 million+', 'We do not know'].map((label) => ({ label })),
    displayIf: (a) => section12DisplayCondition(a),
  },

  // ---------------- SECTION 13 — AI AGENT OPPORTUNITIES ----------------
  {
    id: 'Q60',
    number: 60,
    section: 'aiAgents',
    prompt: 'Does your company currently use any AI agents or AI-powered automation?',
    type: 'single',
    required: true,
    options: ['No', 'We are experimenting', 'One or two workflows', 'Several workflows', 'AI agents are used throughout the business', 'We do not know'].map((label) => ({ label })),
  },
  {
    id: 'Q61',
    number: 61,
    section: 'aiAgents',
    prompt: 'Which AI-powered capabilities would be most valuable to your company?',
    type: 'multi',
    required: true,
    options: [
      'AI phone receptionist', 'AI customer service agent', 'AI sales assistant', 'AI lead qualification',
      'AI appointment scheduling', 'AI employee assistant', 'AI knowledge base', 'AI accounting assistant',
      'AI reporting assistant', 'AI marketing assistant', 'AI proposal or estimate generation',
      'AI document processing', 'AI recruiting assistant', 'AI training assistant', 'Custom AI agent', 'Unsure',
    ].map((label) => ({ label })),
  },
  {
    id: 'Q62',
    number: 62,
    section: 'aiAgents',
    prompt: 'How much employee time is spent answering repetitive internal questions?',
    helpText: 'Examples may include questions about procedures, pricing, policies, products, customers, or company information.',
    type: 'single',
    required: true,
    options: ['Very little', 'A few hours per week', '5-10 hours per week', '10-25 hours per week', 'More than 25 hours per week', 'We do not know'].map((label) => ({ label })),
    displayIf: (a) => section13DeepDisplayCondition(a),
  },
  {
    id: 'Q63',
    number: 63,
    section: 'aiAgents',
    prompt: 'How much time do employees spend searching for information across emails, documents, shared drives, software, or internal systems?',
    type: 'single',
    required: true,
    options: ['Very little', 'Under 5 hours per week company-wide', '5-20 hours per week', '20-50 hours per week', 'More than 50 hours per week', 'We do not know'].map((label) => ({ label })),
    displayIf: (a) => section13DeepDisplayCondition(a),
  },
  {
    id: 'Q64',
    number: 64,
    section: 'aiAgents',
    prompt: 'Which repetitive communications could potentially be automated?',
    type: 'multi',
    required: true,
    options: [
      'New lead responses', 'Appointment reminders', 'Customer status updates', 'Frequently asked questions',
      'Sales follow-up', 'Review requests', 'Collections reminders', 'Employee questions',
      'Vendor communications', 'Recruiting communications', 'Internal reports', 'None', 'Unsure',
    ].map((label) => ({ label })),
    displayIf: (a) => section13DeepDisplayCondition(a),
  },
];

// ---- Section display conditions (implementation-spec.md) --------------

export function section10DisplayCondition(a: AnswerMap): boolean {
  return (
    atLeast(a, 'Q18', Q18_LEAD_VOLUME_BANDS, '25-100') ||
    atLeast(a, 'Q3', Q3_EMPLOYEE_BANDS, '11-25') ||
    multiIncludes(a, 'Q10', 'Cold outbound') ||
    (multiIncludes(a, 'Q10', 'Google Ads') && isOneOf(a, 'Q11', ['Under $2,500', '$2,500-$5,000', '$5,000-$10,000', '$10,000-$25,000', '$25,000-$50,000', '$50,000-$100,000', '$100,000+'])) ||
    (multiIncludes(a, 'Q10', 'Meta / Facebook Ads') && isOneOf(a, 'Q11', ['Under $2,500', '$2,500-$5,000', '$5,000-$10,000', '$10,000-$25,000', '$25,000-$50,000', '$50,000-$100,000', '$100,000+']))
  );
}

const FINANCE_TRIGGER_ACTIVITIES = ['Data entry', 'Creating reports', 'Document preparation', 'Internal reporting', 'Reviewing documents'];

export function section11DisplayCondition(a: AnswerMap): boolean {
  const employeesQualify = atLeast(a, 'Q3', Q3_EMPLOYEE_BANDS, '6-10');
  const activitySelected = FINANCE_TRIGGER_ACTIVITIES.some((act) => multiIncludes(a, 'Q25', act));
  if (a.Q3 === '1-5' && !activitySelected) return false;
  return employeesQualify || activitySelected;
}

export function section12DisplayCondition(a: AnswerMap): boolean {
  return (
    atLeast(a, 'Q24', ['Very little', 'Some', 'Moderate amount', 'Significant amount', 'Extremely high'], 'Moderate amount') ||
    isOneOf(a, 'Q28', ['Unsure', 'Probably', 'Definitely']) ||
    multiCountExcluding(a, 'Q25', MANUAL_WORK_EXCLUDED) >= 3 ||
    atLeast(a, 'Q3', Q3_EMPLOYEE_BANDS, '11-25')
  );
}

const AI_AGENT_DEEP_ACTIVITIES = ['Searching for information', 'Customer support', 'Customer follow-up', 'Scheduling', 'Writing emails'];

export function section13DeepDisplayCondition(a: AnswerMap): boolean {
  return (
    atLeast(a, 'Q3', Q3_EMPLOYEE_BANDS, '6-10') ||
    atLeast(a, 'Q24', ['Very little', 'Some', 'Moderate amount', 'Significant amount', 'Extremely high'], 'Moderate amount') ||
    AI_AGENT_DEEP_ACTIVITIES.some((act) => multiIncludes(a, 'Q25', act))
  );
}

export function getQuestionById(id: string): QuestionDef | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

export function getVisibleQuestions(answers: AnswerMap): QuestionDef[] {
  return QUESTIONS.filter((q) => !q.displayIf || q.displayIf(answers));
}

export { selectedIndex, atLeast, isOneOf, multiIncludes, multiCountExcluding };
