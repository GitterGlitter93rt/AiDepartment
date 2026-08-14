// Deterministic opportunity-flag evaluation.
// Rule source: docs/04-assessment/implementation-spec.md "OPPORTUNITY FLAG ENGINE"
// Every trigger below is transcribed directly from that spec. Do not add
// triggers not defined there (MANAGEMENT_VISIBILITY / MEASUREMENT_GAP are the
// two flags the spec describes only qualitatively — see notes below).

import type { AnswerMap, OpportunityFlag } from '../../data/assessment/types.ts';
import { Q18_LEAD_VOLUME_BANDS, Q3_EMPLOYEE_BANDS, Q4_LOCATION_BANDS, Q2_REVENUE_BANDS, MANUAL_WORK_EXCLUDED, atLeast, isOneOf, multiIncludes, multiCountExcluding } from '../../data/assessment/questions.ts';
import { calculateCommercialResult } from './calculateCommercialScore.ts';

function idxOf(options: string[], value: string): number {
  return options.indexOf(value);
}

function answerIndex(a: AnswerMap, qid: string, options: string[]): number {
  const val = a[qid];
  return typeof val === 'string' ? idxOf(options, val) : -1;
}

const Q12_OPTIONS = ['We cannot track it', 'Limited visibility', 'Somewhat confident', 'Very confident', 'Fully tracked from lead to revenue'];
const Q13_OPTIONS = ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'];
const Q14_OPTIONS = ['No', 'Occasionally', 'Yes, but without structured testing', 'Yes, regularly', 'Yes, using structured conversion testing'];
const Q16_OPTIONS = ['Under 5 minutes', '5-15 minutes', '15-30 minutes', '30-60 minutes', 'Several hours', 'The next business day or later', 'We do not know'];
const Q15_OPTIONS = ['No', 'Yes, but adoption is poor', 'Yes, partially', 'Yes, consistently', 'Yes, with advanced automation'];
const Q17_OPTIONS = ['Usually nothing', 'A salesperson may try again manually', 'We have a standard manual follow-up process', 'We have basic automated follow-up', 'We have sophisticated automated nurturing'];
const Q44_OPTIONS = ['Manually', 'Whoever answers first', 'Spreadsheet', 'CRM assignment', 'Automated routing', 'AI-assisted qualification and routing', 'We do not have a consistent process'];
const Q48_OPTIONS = ['No', 'Occasionally', 'Manually', 'Some automation', 'Yes, consistently with automated campaigns'];
const Q20_OPTIONS = ['Almost none', 'Under 5%', '5-10%', '10-25%', 'More than 25%', 'We do not know'];
const Q22_OPTIONS = ['Within minutes', 'Within one hour', 'Within several hours', 'Same business day', 'Next business day or later', 'It varies widely'];
const Q23_OPTIONS = ['No', 'Partially', 'Yes', 'Yes, integrated with CRM and follow-up'];
const Q24_OPTIONS = ['Very little', 'Some', 'Moderate amount', 'Significant amount', 'Extremely high'];
const Q27_OPTIONS = ['Rarely', 'Occasionally', 'Weekly', 'Daily', 'Constantly'];
const Q29_OPTIONS = ['0%', 'Under 10%', '10-25%', '26-50%', '51-75%', 'More than 75%', 'We do not know'];
const Q31_OPTIONS = ['No', 'Informal tips only', 'A few employees received training', 'Some departments received training', 'Company-wide training exists'];
const Q32_OPTIONS = ['No', 'We are developing one', 'Basic guidelines exist', 'Yes, formal policy exists', 'Yes, and employees receive recurring training'];
const Q33_OPTIONS = ['Not concerned', 'Slightly concerned', 'Moderately concerned', 'Very concerned', 'Extremely concerned'];
const Q34_OPTIONS = ['Completely disconnected', 'Mostly disconnected', 'Some integrations', 'Well integrated', 'Highly integrated and automated'];
const Q35_OPTIONS = ['No', 'Reporting is mostly manual', 'Some dashboards exist', 'Good visibility', 'Real-time visibility across the company'];
const Q52_OPTIONS = ['Real time or near real time', '1-3 days', '4-7 days', '1-2 weeks', 'More than 2 weeks', 'Reporting is inconsistent', 'We do not know'];
const Q53_OPTIONS = ['Almost none', 'Under 2 hours per week', '2-5 hours per week', '5-10 hours per week', 'More than 10 hours per week', 'We do not know'];
const Q54_OPTIONS = ['No', 'Mostly through spreadsheets', 'Available monthly', 'Dashboard exists', 'Real-time or near-real-time visibility'];
const Q56_OPTIONS = ['No', 'Occasionally', 'Some departments', 'Frequently', 'Yes, across multiple departments'];
const Q58_OPTIONS = ['No', 'Possibly within 12 months', 'Yes, within 6-12 months', 'Yes, within 3-6 months', 'Yes, currently hiring'];
const Q62_OPTIONS = ['Very little', 'A few hours per week', '5-10 hours per week', '10-25 hours per week', 'More than 25 hours per week', 'We do not know'];
const Q63_OPTIONS = ['Very little', 'Under 5 hours per week company-wide', '5-20 hours per week', '20-50 hours per week', 'More than 50 hours per week', 'We do not know'];

function manualWorkCount(a: AnswerMap): number {
  return multiCountExcluding(a, 'Q25', MANUAL_WORK_EXCLUDED);
}

function financeManualTaskCount(a: AnswerMap): number {
  return multiCountExcluding(a, 'Q51', ['None', 'We do not know']);
}

export function isEnterpriseCandidate(a: AnswerMap): boolean {
  if (a.Q2 === '$100 million+') return true;
  if (a.Q3 === '500+') return true;
  if (a.Q2 === '$50-$100 million' && a.Q3 === '251-500') return true;
  return false;
}

export function evaluateFlags(answers: AnswerMap): OpportunityFlag[] {
  const flags = new Set<OpportunityFlag>();
  const commercial = calculateCommercialResult(answers);

  // MARKETING_HIGH_VALUE
  if (
    atLeast(answers, 'Q11', ['$0', 'Under $2,500', '$2,500-$5,000', '$5,000-$10,000', '$10,000-$25,000', '$25,000-$50,000', '$50,000-$100,000', '$100,000+'], '$10,000-$25,000') &&
    (isOneOf(answers, 'Q12', Q12_OPTIONS.slice(0, 3)) || isOneOf(answers, 'Q13', Q13_OPTIONS.slice(0, 3)) || isOneOf(answers, 'Q14', Q14_OPTIONS.slice(0, 3)))
  ) {
    flags.add('MARKETING_HIGH_VALUE');
  }

  // GOOGLE_ADS_OPPORTUNITY / META_ADS_OPPORTUNITY
  const q11GreaterThanZero = typeof answers.Q11 === 'string' && answers.Q11 !== '$0';
  const weakSignal =
    answerIndex(answers, 'Q12', Q12_OPTIONS) >= 0 && answerIndex(answers, 'Q12', Q12_OPTIONS) <= 2 ||
    answerIndex(answers, 'Q13', Q13_OPTIONS) >= 0 && answerIndex(answers, 'Q13', Q13_OPTIONS) <= 2 ||
    answerIndex(answers, 'Q14', Q14_OPTIONS) >= 0 && answerIndex(answers, 'Q14', Q14_OPTIONS) <= 2 ||
    answerIndex(answers, 'Q16', Q16_OPTIONS) >= 3; // score <=2 corresponds to index >=3 in this descending-score array

  if (multiIncludes(answers, 'Q10', 'Google Ads') && q11GreaterThanZero && weakSignal) flags.add('GOOGLE_ADS_OPPORTUNITY');
  if (multiIncludes(answers, 'Q10', 'Meta / Facebook Ads') && q11GreaterThanZero && weakSignal) flags.add('META_ADS_OPPORTUNITY');

  // SEO_OPPORTUNITY
  if (
    (multiIncludes(answers, 'Q10', 'SEO') && answerIndex(answers, 'Q13', Q13_OPTIONS) >= 0 && answerIndex(answers, 'Q13', Q13_OPTIONS) <= 2) ||
    (multiIncludes(answers, 'Q10', 'We do not have a consistent lead source') && multiIncludes(answers, 'Q5', 'Generate more leads'))
  ) {
    flags.add('SEO_OPPORTUNITY');
  }

  // SALES_AUTOMATION
  if (
    isOneOf(answers, 'Q15', Q15_OPTIONS.slice(0, 2)) ||
    answerIndex(answers, 'Q16', Q16_OPTIONS) >= 3 ||
    isOneOf(answers, 'Q17', Q17_OPTIONS.slice(0, 3)) ||
    isOneOf(answers, 'Q44', [Q44_OPTIONS[0], Q44_OPTIONS[1], Q44_OPTIONS[2], Q44_OPTIONS[6]]) ||
    multiCountExcluding(answers, 'Q47', ['None']) >= 5
  ) {
    flags.add('SALES_AUTOMATION');
  }

  // SLOW_LEAD_RESPONSE
  const q16Idx = answerIndex(answers, 'Q16', Q16_OPTIONS);
  if (
    (q16Idx >= 3 && q16Idx <= 5) ||
    (answers.Q16 === 'We do not know' && atLeast(answers, 'Q18', Q18_LEAD_VOLUME_BANDS, '101-250'))
  ) {
    flags.add('SLOW_LEAD_RESPONSE');
  }

  // LEAD_REACTIVATION
  if (isOneOf(answers, 'Q48', Q48_OPTIONS.slice(0, 3)) && atLeast(answers, 'Q18', Q18_LEAD_VOLUME_BANDS, '25-100')) {
    flags.add('LEAD_REACTIVATION');
  }

  // AI_PHONE_AGENT
  if (
    (answerIndex(answers, 'Q20', Q20_OPTIONS) >= 3 && answerIndex(answers, 'Q20', Q20_OPTIONS) <= 4 || answers.Q21 === 'Voicemail') &&
    (
      atLeast(answers, 'Q18', Q18_LEAD_VOLUME_BANDS, '25-100') ||
      multiIncludes(answers, 'Q5', 'Generate more leads') ||
      multiIncludes(answers, 'Q5', 'Improve customer service') ||
      multiIncludes(answers, 'Q64', 'New lead responses')
    )
  ) {
    flags.add('AI_PHONE_AGENT');
  }

  // CUSTOMER_SERVICE_AUTOMATION
  if (
    isOneOf(answers, 'Q22', [Q22_OPTIONS[3], Q22_OPTIONS[4], Q22_OPTIONS[5]]) ||
    isOneOf(answers, 'Q23', Q23_OPTIONS.slice(0, 2)) ||
    ['Customer status updates', 'Frequently asked questions', 'Appointment reminders'].some((v) => multiIncludes(answers, 'Q64', v))
  ) {
    flags.add('CUSTOMER_SERVICE_AUTOMATION');
  }

  // EMPLOYEE_PRODUCTIVITY
  if (
    isOneOf(answers, 'Q24', Q24_OPTIONS.slice(3)) ||
    manualWorkCount(answers) >= 5 ||
    answerIndex(answers, 'Q62', Q62_OPTIONS) >= 3 ||
    answerIndex(answers, 'Q63', Q63_OPTIONS) >= 3 ||
    isOneOf(answers, 'Q56', Q56_OPTIONS.slice(3))
  ) {
    flags.add('EMPLOYEE_PRODUCTIVITY');
  }

  // AI_TRAINING
  if (
    isOneOf(answers, 'Q31', Q31_OPTIONS.slice(0, 3)) ||
    (answerIndex(answers, 'Q29', Q29_OPTIONS) >= 0 && answerIndex(answers, 'Q29', Q29_OPTIONS) <= 2 && isOneOf(answers, 'Q9', ['Important', 'Very important', 'Mission critical']))
  ) {
    flags.add('AI_TRAINING');
  }

  // AI_GOVERNANCE
  if (isOneOf(answers, 'Q32', Q32_OPTIONS.slice(0, 2)) && isOneOf(answers, 'Q33', Q33_OPTIONS.slice(2))) {
    flags.add('AI_GOVERNANCE');
  }

  // INTEGRATION_OPPORTUNITY
  if (isOneOf(answers, 'Q34', Q34_OPTIONS.slice(0, 2)) || isOneOf(answers, 'Q27', Q27_OPTIONS.slice(3))) {
    flags.add('INTEGRATION_OPPORTUNITY');
  }

  // EXECUTIVE_REPORTING
  if (
    isOneOf(answers, 'Q35', Q35_OPTIONS.slice(0, 2)) ||
    isOneOf(answers, 'Q52', [Q52_OPTIONS[3], Q52_OPTIONS[4], Q52_OPTIONS[5]]) ||
    isOneOf(answers, 'Q54', Q54_OPTIONS.slice(0, 2))
  ) {
    flags.add('EXECUTIVE_REPORTING');
  }

  // FINANCE_AUTOMATION
  if (
    financeManualTaskCount(answers) >= 3 ||
    isOneOf(answers, 'Q53', Q53_OPTIONS.slice(2, 5)) ||
    isOneOf(answers, 'Q52', [Q52_OPTIONS[3], Q52_OPTIONS[4], Q52_OPTIONS[5]])
  ) {
    flags.add('FINANCE_AUTOMATION');
  }

  // AR_AUTOMATION
  if (isOneOf(answers, 'Q53', Q53_OPTIONS.slice(2, 5)) || multiIncludes(answers, 'Q51', 'Accounts receivable follow-up')) {
    flags.add('AR_AUTOMATION');
  }

  // KNOWLEDGE_ASSISTANT
  if (
    answerIndex(answers, 'Q62', Q62_OPTIONS) >= 3 ||
    answerIndex(answers, 'Q63', Q63_OPTIONS) >= 3 ||
    (multiIncludes(answers, 'Q25', 'Searching for information') && answerIndex(answers, 'Q63', Q63_OPTIONS) >= 2)
  ) {
    flags.add('KNOWLEDGE_ASSISTANT');
  }

  // MULTI_LOCATION_STANDARDIZATION
  if (atLeast(answers, 'Q4', Q4_LOCATION_BANDS, '4-10')) {
    flags.add('MULTI_LOCATION_STANDARDIZATION');
  }

  // HIRING_AVOIDANCE_ANALYSIS
  if (
    isOneOf(answers, 'Q58', Q58_OPTIONS.slice(1)) &&
    (isOneOf(answers, 'Q24', Q24_OPTIONS.slice(2)) || isOneOf(answers, 'Q27', Q27_OPTIONS.slice(2)) || manualWorkCount(answers) >= 3)
  ) {
    flags.add('HIRING_AVOIDANCE_ANALYSIS');
  }

  // MANAGEMENT_VISIBILITY / MEASUREMENT_GAP
  // The spec describes these qualitatively ("may trigger... where relevant")
  // without a precise formula like the flags above. We apply the most direct,
  // literal reading: a visibility problem (can't see KPIs) vs. a measurement
  // gap (can't track marketing attribution).
  if (answers.Q35 === 'No') flags.add('MANAGEMENT_VISIBILITY');
  if (answers.Q12 === 'We cannot track it') flags.add('MEASUREMENT_GAP');

  // AI_AGENT_OPPORTUNITY — interest alone is never sufficient.
  const q61 = answers.Q61;
  const hasCapabilityInterest = Array.isArray(q61) && q61.some((v) => v !== 'Unsure');
  if (hasCapabilityInterest && flags.size > 0) {
    flags.add('AI_AGENT_OPPORTUNITY');
  }

  // EXECUTIVE_STRATEGY
  if (
    isOneOf(answers, 'Q7', ['No', 'We have discussed it informally', 'We are currently developing one']) &&
    isOneOf(answers, 'Q9', ['Important', 'Very important', 'Mission critical']) &&
    (
      atLeast(answers, 'Q2', Q2_REVENUE_BANDS, '$1-$3 million') ||
      commercial.total >= 60 ||
      flags.size >= 3
    )
  ) {
    flags.add('EXECUTIVE_STRATEGY');
  }

  // MANAGED_AI_DEPARTMENT
  const meaningfulFlagCount = flags.size;
  if (
    meaningfulFlagCount >= 3 &&
    commercial.financialCapacity >= 10 &&
    commercial.urgency >= 5 &&
    (
      atLeast(answers, 'Q3', Q3_EMPLOYEE_BANDS, '26-50') ||
      atLeast(answers, 'Q4', Q4_LOCATION_BANDS, '4-10') ||
      commercial.total >= 70
    )
  ) {
    flags.add('MANAGED_AI_DEPARTMENT');
  }

  // ENTERPRISE_CANDIDATE
  if (isEnterpriseCandidate(answers)) {
    flags.add('ENTERPRISE_CANDIDATE');
  }

  return Array.from(flags);
}
