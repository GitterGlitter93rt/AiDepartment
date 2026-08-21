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
// The scenarios below use ONLY the actual low/high bounds of the band the
// respondent selected — never a single collapsed midpoint presented as if
// it were a precise figure, and never an invented ceiling for an
// open-ended top band ("$100,000+", "$1 million+", "More than 25 hours
// per week", etc.). An open-ended band is reported as a genuine lower
// bound ("$1,200,000+ annually"), not as a made-up range.

import type { AnswerMap, OpportunityFlag, ROIResult } from '../../data/assessment/types.ts';

const INSUFFICIENT_DATA_MESSAGE = 'Additional data is required to estimate financial impact.';

/** A band's actual bounds. `high: null` means the band is open-ended
 * (e.g. "$100,000+") — the true upper bound is unknown, and we do not
 * invent one. */
interface BandRange {
  low: number;
  high: number | null;
}

function rangeFromBand(band: string | undefined, map: Record<string, BandRange>): BandRange | undefined {
  if (!band) return undefined;
  return map[band];
}

const AD_SPEND_MONTHLY_RANGE: Record<string, BandRange> = {
  '$0': { low: 0, high: 0 },
  'Under $2,500': { low: 0, high: 2500 },
  '$2,500-$5,000': { low: 2500, high: 5000 },
  '$5,000-$10,000': { low: 5000, high: 10000 },
  '$10,000-$25,000': { low: 10000, high: 25000 },
  '$25,000-$50,000': { low: 25000, high: 50000 },
  '$50,000-$100,000': { low: 50000, high: 100000 },
  '$100,000+': { low: 100000, high: null },
};

const WEEKLY_HOURS_RANGE: Record<string, BandRange> = {
  'Very little': { low: 0, high: 2 },
  'A few hours per week': { low: 2, high: 5 },
  '5-10 hours per week': { low: 5, high: 10 },
  '10-25 hours per week': { low: 10, high: 25 },
  'More than 25 hours per week': { low: 25, high: null },
  'Under 5 hours per week company-wide': { low: 0, high: 5 },
  '5-20 hours per week': { low: 5, high: 20 },
  '20-50 hours per week': { low: 20, high: 50 },
  'More than 50 hours per week': { low: 50, high: null },
  'We do not know': { low: 0, high: 0 },
};

const ADMIN_LABOR_SPEND_RANGE: Record<string, BandRange> = {
  'Under $50,000': { low: 0, high: 50000 },
  '$50,000-$150,000': { low: 50000, high: 150000 },
  '$150,000-$300,000': { low: 150000, high: 300000 },
  '$300,000-$500,000': { low: 300000, high: 500000 },
  '$500,000-$1 million': { low: 500000, high: 1000000 },
  '$1 million+': { low: 1000000, high: null },
  'We do not know': { low: 0, high: 0 },
};

/** Format a currency low/high range honestly: a real "$X-$Y" range when
 * both bounds are known, an explicit "$X+" lower bound when the band is
 * open-ended, or a single "$X" when low equals high (e.g. "$0"). Never
 * a fabricated single midpoint presented as if it were precise. */
function formatCurrencyRange(low: number, high: number | null): string {
  const lowStr = `$${Math.round(low).toLocaleString()}`;
  if (high === null) return `${lowStr}+`;
  if (high === low) return lowStr;
  return `${lowStr}-$${Math.round(high).toLocaleString()}`;
}

function formatHoursRange(low: number, high: number | null): string {
  const lowStr = Math.round(low).toLocaleString();
  if (high === null) return `${lowStr}+ hours`;
  if (high === low) return `${lowStr} hours`;
  return `${lowStr}-${Math.round(high).toLocaleString()} hours`;
}

function annualAdSpendScenario(answers: AnswerMap): ROIResult {
  const range = rangeFromBand(typeof answers.Q11 === 'string' ? answers.Q11 : undefined, AD_SPEND_MONTHLY_RANGE);
  if (!range || (range.low <= 0 && range.high === 0)) {
    return { id: 'ad-spend', title: 'Annual Advertising Investment', available: false, reason: INSUFFICIENT_DATA_MESSAGE };
  }
  const annualLow = range.low * 12;
  const annualHigh = range.high === null ? null : range.high * 12;
  return {
    id: 'ad-spend',
    title: 'Annual Advertising Investment',
    available: true,
    unit: 'currency',
    summary: `Based on your reported monthly advertising spend, your company invests approximately this much in paid advertising annually. Improving tracking and conversion can increase the return on this existing investment.`,
    estimateLabel: formatCurrencyRange(annualLow, annualHigh),
    estimateLow: annualLow,
    estimateHigh: annualHigh ?? annualLow,
    assumptions: [
      'Based on the low/high bounds of your selected monthly ad spend range, not a single collapsed figure.',
      annualHigh === null
        ? 'Your selected range is open-ended ("$100,000+/month"), so this reflects a minimum — actual spend may be higher.'
        : 'Does not assume any change in performance or efficiency.',
    ],
  };
}

function knowledgeSearchHoursScenario(answers: AnswerMap): ROIResult {
  const q62 = rangeFromBand(typeof answers.Q62 === 'string' ? answers.Q62 : undefined, WEEKLY_HOURS_RANGE);
  const q63 = rangeFromBand(typeof answers.Q63 === 'string' ? answers.Q63 : undefined, WEEKLY_HOURS_RANGE);

  const ranges = [q62, q63].filter((r): r is BandRange => r !== undefined && !(r.low <= 0 && r.high === 0));
  if (ranges.length === 0) {
    return { id: 'knowledge-hours', title: 'Time Spent Searching for Information and Answering Questions', available: false, reason: INSUFFICIENT_DATA_MESSAGE };
  }
  const weeklyLow = ranges.reduce((sum, r) => sum + r.low, 0);
  const anyOpenEnded = ranges.some((r) => r.high === null);
  const weeklyHigh = anyOpenEnded ? null : ranges.reduce((sum, r) => sum + (r.high as number), 0);

  const annualLow = Math.round(weeklyLow * 48);
  const annualHigh = weeklyHigh === null ? null : Math.round(weeklyHigh * 48);

  return {
    id: 'knowledge-hours',
    title: 'Time Spent Searching for Information and Answering Questions',
    available: true,
    unit: 'hours',
    summary: `Based on your answers, employees may be spending roughly ${formatHoursRange(weeklyLow, weeklyHigh)} per week answering repetitive questions or searching for information across systems.`,
    estimateLabel: formatHoursRange(annualLow, annualHigh),
    estimateLow: annualLow,
    estimateHigh: annualHigh ?? annualLow,
    assumptions: [
      'Based on the low/high bounds of the time ranges you selected, not a single collapsed figure.',
      'Reflects time, not a dollar figure — converting this to a cost estimate would require your loaded labor cost, which was not collected.',
      'Assumes 48 productive weeks per year.',
    ],
  };
}

function adminLaborSpendScenario(answers: AnswerMap): ROIResult {
  const range = rangeFromBand(typeof answers.Q59 === 'string' ? answers.Q59 : undefined, ADMIN_LABOR_SPEND_RANGE);
  if (!range || (range.low <= 0 && range.high === 0)) {
    return { id: 'admin-labor-spend', title: 'Annual Administrative Labor Investment', available: false, reason: INSUFFICIENT_DATA_MESSAGE };
  }
  return {
    id: 'admin-labor-spend',
    title: 'Annual Administrative Labor Investment',
    available: true,
    unit: 'currency',
    summary: 'Based on your reported administrative and support labor spend, this reflects your current annual investment in that capacity. Automation may help this team handle more volume without proportional cost growth.',
    estimateLabel: formatCurrencyRange(range.low, range.high),
    estimateLow: range.low,
    estimateHigh: range.high ?? range.low,
    assumptions: [
      'Based on the low/high bounds of your selected annual spend range, not a single collapsed figure.',
      range.high === null
        ? 'Your selected range is open-ended ("$1 million+"), so this reflects a minimum — actual spend may be higher.'
        : 'Does not assume any specific percentage can be automated without further discovery.',
    ],
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
