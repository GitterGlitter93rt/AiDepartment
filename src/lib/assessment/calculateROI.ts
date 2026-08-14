// ROI scenario generation.
// Rule source: docs/04-assessment/roi-calculator.md and
// implementation-spec.md "ROI CALCULATION RULE".
//
// IMPORTANT: The V1 question set never collects loaded hourly labor cost or
// exact wages. Because roi-calculator.md's Labor Capacity Calculator
// requires that input, we cannot responsibly convert reported hours into a
// dollar figure — doing so would require inventing a wage. Where the
// necessary input does not exist, we say so explicitly rather than guessing.
//
// The scenarios below use ONLY numbers the respondent directly provided
// (band midpoints of their own answers), and never multiply hours by an
// invented hourly rate.

import type { AnswerMap, OpportunityFlag, ROIResult } from '../../data/assessment/types.ts';

const INSUFFICIENT_DATA_MESSAGE = 'Additional data is required to estimate financial impact.';

function midpointFromBand(band: string | undefined, map: Record<string, number>): number | undefined {
  if (!band) return undefined;
  return map[band];
}

const AD_SPEND_MONTHLY_MIDPOINT: Record<string, number> = {
  '$0': 0,
  'Under $2,500': 1250,
  '$2,500-$5,000': 3750,
  '$5,000-$10,000': 7500,
  '$10,000-$25,000': 17500,
  '$25,000-$50,000': 37500,
  '$50,000-$100,000': 75000,
  '$100,000+': 100000,
};

const WEEKLY_HOURS_MIDPOINT: Record<string, number> = {
  'Very little': 1,
  'A few hours per week': 3,
  '5-10 hours per week': 7.5,
  '10-25 hours per week': 17.5,
  'More than 25 hours per week': 25,
  'Under 5 hours per week company-wide': 2.5,
  '5-20 hours per week': 12.5,
  '20-50 hours per week': 35,
  'More than 50 hours per week': 50,
  'We do not know': 0,
};

const ADMIN_LABOR_SPEND_MIDPOINT: Record<string, number> = {
  'Under $50,000': 25000,
  '$50,000-$150,000': 100000,
  '$150,000-$300,000': 225000,
  '$300,000-$500,000': 400000,
  '$500,000-$1 million': 750000,
  '$1 million+': 1000000,
  'We do not know': 0,
};

function annualAdSpendScenario(answers: AnswerMap): ROIResult {
  const monthly = midpointFromBand(typeof answers.Q11 === 'string' ? answers.Q11 : undefined, AD_SPEND_MONTHLY_MIDPOINT);
  if (!monthly || monthly <= 0) {
    return { id: 'ad-spend', title: 'Annual Advertising Investment', available: false, reason: INSUFFICIENT_DATA_MESSAGE };
  }
  const annual = monthly * 12;
  return {
    id: 'ad-spend',
    title: 'Annual Advertising Investment',
    available: true,
    unit: 'currency',
    summary: `Based on your reported monthly advertising spend, your company invests approximately this much in paid advertising annually. Improving tracking and conversion can increase the return on this existing investment.`,
    estimateLabel: 'Estimated annual ad spend',
    estimateLow: annual,
    estimateHigh: annual,
    assumptions: ['Based on the midpoint of your selected monthly ad spend range.', 'Does not assume any change in performance or efficiency.'],
  };
}

function knowledgeSearchHoursScenario(answers: AnswerMap): ROIResult {
  const q62 = midpointFromBand(typeof answers.Q62 === 'string' ? answers.Q62 : undefined, WEEKLY_HOURS_MIDPOINT);
  const q63 = midpointFromBand(typeof answers.Q63 === 'string' ? answers.Q63 : undefined, WEEKLY_HOURS_MIDPOINT);

  const hours = [q62, q63].filter((v): v is number => typeof v === 'number' && v > 0);
  if (hours.length === 0) {
    return { id: 'knowledge-hours', title: 'Time Spent Searching for Information and Answering Questions', available: false, reason: INSUFFICIENT_DATA_MESSAGE };
  }
  const totalWeekly = hours.reduce((a, b) => a + b, 0);
  const annualHours = Math.round(totalWeekly * 48);

  return {
    id: 'knowledge-hours',
    title: 'Time Spent Searching for Information and Answering Questions',
    available: true,
    unit: 'hours',
    summary: `Based on your answers, employees may be spending around ${totalWeekly} hours per week answering repetitive questions or searching for information across systems.`,
    estimateLabel: 'Estimated hours per year',
    estimateLow: annualHours,
    estimateHigh: annualHours,
    assumptions: [
      'Based on the midpoint of the time ranges you selected.',
      'Reflects time, not a dollar figure — converting this to a cost estimate would require your loaded labor cost, which was not collected.',
      'Assumes 48 productive weeks per year.',
    ],
  };
}

function adminLaborSpendScenario(answers: AnswerMap): ROIResult {
  const annual = midpointFromBand(typeof answers.Q59 === 'string' ? answers.Q59 : undefined, ADMIN_LABOR_SPEND_MIDPOINT);
  if (!annual || annual <= 0) {
    return { id: 'admin-labor-spend', title: 'Annual Administrative Labor Investment', available: false, reason: INSUFFICIENT_DATA_MESSAGE };
  }
  return {
    id: 'admin-labor-spend',
    title: 'Annual Administrative Labor Investment',
    available: true,
    unit: 'currency',
    summary: 'Based on your reported administrative and support labor spend, this reflects your current annual investment in that capacity. Automation may help this team handle more volume without proportional cost growth.',
    estimateLabel: 'Estimated annual administrative labor spend',
    estimateLow: annual,
    estimateHigh: annual,
    assumptions: ['Based on the midpoint of your selected annual spend range.', 'Does not assume any specific percentage can be automated without further discovery.'],
  };
}

export function calculateROIScenarios(answers: AnswerMap, flags: OpportunityFlag[]): ROIResult[] {
  const scenarios: ROIResult[] = [];

  if (flags.includes('MARKETING_HIGH_VALUE') || flags.includes('GOOGLE_ADS_OPPORTUNITY') || flags.includes('META_ADS_OPPORTUNITY')) {
    scenarios.push(annualAdSpendScenario(answers));
  }

  if (flags.includes('KNOWLEDGE_ASSISTANT') || flags.includes('EMPLOYEE_PRODUCTIVITY')) {
    scenarios.push(knowledgeSearchHoursScenario(answers));
  }

  if (flags.includes('HIRING_AVOIDANCE_ANALYSIS') || flags.includes('EMPLOYEE_PRODUCTIVITY')) {
    scenarios.push(adminLaborSpendScenario(answers));
  }

  return scenarios;
}
