// Recommendation content library.
// Copy derived from docs/04-assessment/recommendations.md — one entry per
// opportunity flag that should ever surface as a prospect-facing
// recommendation. ENTERPRISE_CANDIDATE and MANAGEMENT_VISIBILITY /
// MEASUREMENT_GAP are qualification signals, not standalone recommendations,
// and are intentionally excluded here.

import type { OpportunityFlag, RecommendationPriority } from './types';

export interface RecommendationContent {
  flag: OpportunityFlag;
  title: string;
  finding: string;
  recommendedAction: string;
  service: string;
  basePriority: RecommendationPriority;
}

export const RECOMMENDATION_CONTENT: Partial<Record<OpportunityFlag, RecommendationContent>> = {
  EXECUTIVE_STRATEGY: {
    flag: 'EXECUTIVE_STRATEGY',
    title: 'Executive AI Strategy',
    finding: 'Your company has meaningful interest in AI but lacks a coordinated implementation strategy.',
    recommendedAction: 'Create a company-wide AI roadmap identifying the highest-value opportunities, implementation priorities, governance requirements, and expected ROI.',
    service: 'Executive AI Strategy',
    basePriority: 1,
  },
  MANAGED_AI_DEPARTMENT: {
    flag: 'MANAGED_AI_DEPARTMENT',
    title: 'Managed AI Department',
    finding: 'Your company has AI opportunities across several areas but does not currently have dedicated leadership responsible for evaluating, prioritizing, and implementing them.',
    recommendedAction: 'Establish ongoing AI leadership and implementation management rather than one-off projects.',
    service: 'Managed AI Department',
    basePriority: 1,
  },
  EMPLOYEE_PRODUCTIVITY: {
    flag: 'EMPLOYEE_PRODUCTIVITY',
    title: 'Workflow Automation',
    finding: 'Employees are spending substantial time on repetitive administrative tasks that may be partially or fully automated.',
    recommendedAction: 'Map high-volume repetitive workflows and automate tasks that do not require significant human judgment.',
    service: 'AI Implementation',
    basePriority: 2,
  },
  KNOWLEDGE_ASSISTANT: {
    flag: 'KNOWLEDGE_ASSISTANT',
    title: 'AI Employee Assistant',
    finding: 'Employees spend substantial time searching for procedures, customer information, policies, pricing, or internal knowledge.',
    recommendedAction: 'Create a secure internal AI assistant that helps authorized employees retrieve company information quickly.',
    service: 'Custom AI Implementation',
    basePriority: 2,
  },
  AI_TRAINING: {
    flag: 'AI_TRAINING',
    title: 'Employee AI Training',
    finding: 'Employees have access to AI tools but lack structured training on how to use them effectively and safely.',
    recommendedAction: 'Train employees around role-specific AI use cases relevant to their day-to-day work.',
    service: 'AI Training',
    basePriority: 3,
  },
  AI_GOVERNANCE: {
    flag: 'AI_GOVERNANCE',
    title: 'AI Governance and Policy',
    finding: 'Employees may be using AI tools without a formal usage policy, while leadership has expressed real concern about incorrect use or data exposure.',
    recommendedAction: 'Develop company-wide AI usage guidelines covering approved tools, confidential information, and verification requirements.',
    service: 'AI Governance Consulting',
    basePriority: 3,
  },
  AI_PHONE_AGENT: {
    flag: 'AI_PHONE_AGENT',
    title: 'AI Phone Agent',
    finding: 'Potential customers may be lost because calls are not consistently answered or followed up with quickly.',
    recommendedAction: 'Evaluate AI-assisted or automated phone handling for missed calls and after-hours coverage.',
    service: 'AI Phone Agent Implementation',
    basePriority: 2,
  },
  SLOW_LEAD_RESPONSE: {
    flag: 'SLOW_LEAD_RESPONSE',
    title: 'Lead Response Automation',
    finding: 'Your company generates leads, but delayed follow-up may be reducing how many of them convert.',
    recommendedAction: 'Create immediate, persistent, and measurable lead-response workflows.',
    service: 'AI Growth Systems',
    basePriority: 1,
  },
  SALES_AUTOMATION: {
    flag: 'SALES_AUTOMATION',
    title: 'CRM and Sales Automation',
    finding: 'Manual lead assignment, tracking, or follow-up appears to be creating inconsistency in your sales process.',
    recommendedAction: 'Create a centralized lead and sales management system with automated follow-up.',
    service: 'AI Growth Systems',
    basePriority: 2,
  },
  LEAD_REACTIVATION: {
    flag: 'LEAD_REACTIVATION',
    title: 'Lead Reactivation',
    finding: 'Your company may already own a valuable database of past leads or customers that is not being consistently followed up with.',
    recommendedAction: 'Build automated reactivation campaigns to re-engage old leads and past customers.',
    service: 'AI Growth Systems',
    basePriority: 3,
  },
  MARKETING_HIGH_VALUE: {
    flag: 'MARKETING_HIGH_VALUE',
    title: 'Marketing Attribution and Optimization',
    finding: 'Your company invests meaningfully in paid advertising, but visibility into which channels actually produce revenue is limited.',
    recommendedAction: 'Implement conversion tracking and revenue attribution so ad spend can be evaluated by actual results.',
    service: 'AI Growth Systems',
    basePriority: 2,
  },
  GOOGLE_ADS_OPPORTUNITY: {
    flag: 'GOOGLE_ADS_OPPORTUNITY',
    title: 'Google Ads Optimization',
    finding: 'Your company spends on Google Ads, but tracking, satisfaction, or conversion signals suggest performance is not fully optimized.',
    recommendedAction: 'Review campaign structure, tracking, and conversion paths to improve return on ad spend.',
    service: 'Google Ads Management',
    basePriority: 3,
  },
  META_ADS_OPPORTUNITY: {
    flag: 'META_ADS_OPPORTUNITY',
    title: 'Meta Ads Optimization',
    finding: 'Your company spends on Meta / Facebook Ads, but tracking, satisfaction, or conversion signals suggest performance is not fully optimized.',
    recommendedAction: 'Review campaign structure, tracking, and conversion paths to improve return on ad spend.',
    service: 'Meta Ads Management',
    basePriority: 3,
  },
  SEO_OPPORTUNITY: {
    flag: 'SEO_OPPORTUNITY',
    title: 'SEO',
    finding: 'Organic search is a lead source for your business, but marketing satisfaction signals suggest room for improvement — or your business lacks a consistent lead source entirely.',
    recommendedAction: 'Evaluate organic search visibility and content strategy as a durable, lower-cost lead source.',
    service: 'SEO',
    basePriority: 3,
  },
  CUSTOMER_SERVICE_AUTOMATION: {
    flag: 'CUSTOMER_SERVICE_AUTOMATION',
    title: 'Customer Service Automation',
    finding: 'Response times to customer inquiries, or handling of routine communications, may be slower than customers expect.',
    recommendedAction: 'Automate routine customer communications such as status updates, FAQs, and appointment reminders.',
    service: 'AI Implementation',
    basePriority: 2,
  },
  FINANCE_AUTOMATION: {
    flag: 'FINANCE_AUTOMATION',
    title: 'Finance Workflow Automation',
    finding: 'Accounting and finance work — invoice processing, reporting, or data entry — appears to require significant manual effort.',
    recommendedAction: 'Conduct a finance workflow analysis to identify which repetitive tasks can be safely automated alongside qualified accounting oversight.',
    service: 'AI Implementation',
    basePriority: 3,
  },
  AR_AUTOMATION: {
    flag: 'AR_AUTOMATION',
    title: 'Accounts Receivable Automation',
    finding: 'Meaningful staff time is spent manually chasing customers for unpaid invoices.',
    recommendedAction: 'Automate appropriate portions of the accounts receivable communication process, such as reminders and escalation workflows.',
    service: 'Workflow Automation',
    basePriority: 3,
  },
  EXECUTIVE_REPORTING: {
    flag: 'EXECUTIVE_REPORTING',
    title: 'Executive Reporting',
    finding: 'Leadership waits longer than necessary for accurate business metrics, or key KPIs are not easily accessible.',
    recommendedAction: 'Centralize critical business metrics into an executive dashboard sourced directly from your existing systems.',
    service: 'Data Integration',
    basePriority: 3,
  },
  INTEGRATION_OPPORTUNITY: {
    flag: 'INTEGRATION_OPPORTUNITY',
    title: 'Software Integration',
    finding: 'Employees regularly move information manually between disconnected software systems.',
    recommendedAction: 'Connect core systems through APIs or automation platforms to eliminate duplicate data entry.',
    service: 'Software Integration',
    basePriority: 3,
  },
  HIRING_AVOIDANCE_ANALYSIS: {
    flag: 'HIRING_AVOIDANCE_ANALYSIS',
    title: 'Evaluate Automation Before Hiring',
    finding: 'Your company is planning to add administrative or support headcount while also carrying meaningful repetitive workload.',
    recommendedAction: 'Evaluate whether automation can increase existing team capacity before committing to a new hire.',
    service: 'AI Implementation',
    basePriority: 2,
  },
  MULTI_LOCATION_STANDARDIZATION: {
    flag: 'MULTI_LOCATION_STANDARDIZATION',
    title: 'Multi-Location Standardization',
    finding: 'Operating multiple locations increases the value of standardized reporting, systems, and processes.',
    recommendedAction: 'Standardize core workflows and reporting across locations before scaling automation further.',
    service: 'Managed AI Department',
    basePriority: 3,
  },
  AI_AGENT_OPPORTUNITY: {
    flag: 'AI_AGENT_OPPORTUNITY',
    title: 'Custom AI Agent',
    finding: 'You expressed interest in specific AI capabilities, and your diagnostic answers support at least one related opportunity.',
    recommendedAction: 'Scope a focused AI agent around the highest-evidence workflow identified in this assessment.',
    service: 'Custom AI Implementation',
    basePriority: 3,
  },
};
