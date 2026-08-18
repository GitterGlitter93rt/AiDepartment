// Central site configuration.
// Canonical domain + nav structure per docs/02-website/sitemap.md (v2.0, canonical)
// and docs/02-website/technical-seo-spec.md.

import { SCHEDULING } from './scheduling';

export { SCHEDULING } from './scheduling';

export const SITE = {
  name: 'Your AI Department',
  domain: 'https://youraidepartment.ai',
  tagline: 'Practical AI. Real Business Value.',
  defaultDescription:
    'Identify and implement high-value AI opportunities across marketing, sales, operations, employee productivity, automation, and customer experience with Your AI Department.',
};

export interface NavItem {
  label: string;
  href: string;
}

// Only routes that exist in production should appear here.
// As of this sprint, only "/" is live — remaining hrefs point to
// routes defined in sitemap.md that will be built in later sprints.
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Solutions', href: '/#solutions' },
  { label: 'Services', href: '/#services' },
  { label: 'Industries', href: '/#industries' },
  { label: 'Resources', href: '/resources/' },
  { label: 'Enterprise', href: '/enterprise/' },
  { label: 'About', href: '/about/' },
  { label: 'Contact', href: '/contact/' },
];

export interface DropdownItem extends NavItem {
  description: string;
}

// Canonical per docs/02-website/navigation.md "V1 Navigation Architecture
// Addendum" (Approved). This addendum explicitly supersedes an earlier
// ad-hoc instruction to place The AI Department Method inside the
// Solutions dropdown: "The AI Department Method should remain readily
// accessible through contextual navigation and the Company/footer
// structure unless a later approved navigation revision places it
// directly within the Solutions dropdown." No such revision exists, so
// Method is intentionally NOT included here — it remains reachable via
// the footer and contextual in-page links, per that explicit guidance.
export const SOLUTIONS_DROPDOWN: DropdownItem[] = [
  { label: 'AI Consulting', href: '/ai-consulting/', description: 'Identify where AI, automation, and better systems create business value.' },
  { label: 'AI Implementation', href: '/ai-implementation/', description: 'Build AI agents, automations, integrations, and internal assistants.' },
  { label: 'AI Growth Systems', href: '/ai-growth-systems/', description: 'Connect marketing, CRM, lead response, and attribution into one system.' },
  { label: 'Managed AI Department', href: '/managed-ai-department/', description: 'Ongoing strategy, implementation oversight, training, and optimization.' },
];

// Canonical per navigation.md's Services Dropdown — all six now built.
export const SERVICES_DROPDOWN: DropdownItem[] = [
  { label: 'Google Ads', href: '/google-ads/', description: 'Turn Google Ads into a measurable, attributed revenue system.' },
  { label: 'Meta Ads', href: '/meta-ads/', description: 'Facebook and Instagram advertising connected to real follow-up and sales.' },
  { label: 'SEO', href: '/seo/', description: 'Organic visibility, content, and technical foundations that convert.' },
  { label: 'AI Training', href: '/ai-training/', description: 'Practical, role-specific AI training for real business workflows.' },
  { label: 'AI Workshops', href: '/ai-workshops/', description: 'Focused sessions for opportunity discovery and team enablement.' },
  { label: 'Executive AI Coaching', href: '/executive-ai-coaching/', description: 'One-on-one AI advisory for owners, CEOs, and senior leaders.' },
];

// Canonical per navigation.md's Industries Dropdown — all six now built.
export const INDUSTRIES_DROPDOWN: DropdownItem[] = [
  { label: 'Collision Repair', href: '/industries/collision-repair/', description: 'Lead response, estimate follow-up, and customer communication.' },
  { label: 'Law Firms', href: '/industries/law-firms/', description: 'Intake speed, follow-up, and document workflows.' },
  { label: 'Roofing', href: '/industries/roofing/', description: 'Speed-to-lead, storm response, and estimate follow-up.' },
  { label: 'HVAC', href: '/industries/hvac/', description: 'Phone handling, scheduling, dispatch, and customer communication.' },
  { label: 'Construction', href: '/industries/construction/', description: 'Project communication, documentation, and admin workload.' },
  { label: 'Professional Services', href: '/industries/professional-services/', description: 'Employee capacity, knowledge access, and client communication.' },
  { label: 'Healthcare', href: '/industries/healthcare/', description: 'Administrative workflows, scheduling, and employee productivity.' },
  { label: 'Insurance', href: '/industries/insurance/', description: 'Claims-adjacent workflows, policyholder service, and contact center operations.' },
  { label: 'Manufacturing', href: '/industries/manufacturing/', description: 'RFQ workflows, documentation, and operational administration.' },
  { label: 'Automotive Dealer Groups', href: '/industries/automotive-dealers/', description: 'Multi-rooftop sales, BDC, service, and marketing coordination.' },
  { label: 'Home Services', href: '/industries/home-services/', description: 'Lead response, dispatch, and attribution across every home-service trade.' },
  { label: 'Solar', href: '/industries/solar/', description: 'Field sales, appointment setting, and consent-aware follow-up.' },
  { label: 'Fiber & Broadband', href: '/industries/fiber-broadband/', description: 'Territory launches, door-to-door sales, and installation scheduling.' },
  { label: 'Real Estate', href: '/industries/real-estate/', description: 'Lead response, database reactivation, and marketing attribution.' },
  { label: 'Property Management', href: '/industries/property-management/', description: 'Leasing response, maintenance intake, and vendor coordination.' },
  { label: 'E-commerce', href: '/industries/ecommerce/', description: 'Customer service, lifecycle marketing, and merchandising.' },
  { label: 'Financial Services', href: '/industries/financial-services/', description: 'Governance, data controls, and controlled AI adoption.' },
  { label: 'Logistics & Transportation', href: '/industries/logistics-transportation/', description: 'Dispatch communication, document processing, and reporting.' },
  { label: 'Energy', href: '/industries/energy/', description: 'Field operations knowledge, documentation, and enterprise productivity.' },
  { label: 'Defense & Aerospace', href: '/industries/defense-aerospace/', description: 'Governed enterprise AI for legitimate business operations.' },
];

export const PRIMARY_CTA = {
  label: 'Get Your AI Department Score',
  href: '/ai-assessment/',
};

// Centralized "Schedule a Strategy Call" destination — now the approved
// AI Strategy Call Cal.com event (docs/00-company/launch-decisions.md
// Sprint 9 Cal.com integration). Kept as one shared constant so a future
// change only needs to happen here rather than across every page.
export const SECONDARY_CTA = {
  label: 'Schedule a Strategy Call',
  href: SCHEDULING.strategyCall.url,
};

// AI Implementation's hero flips CTA priority per docs/03-products/ai-implementation.md
// ("Discuss an AI Implementation" is primary there, assessment is secondary).
// Per Sprint 9 CTA mapping, AI Implementation routes to the AI Strategy Call.
export const IMPLEMENTATION_CTA = {
  label: 'Discuss an AI Implementation',
  href: SCHEDULING.strategyCall.url,
};

// Enterprise uses its own approved CTA per docs/02-website/enterprise.md —
// enterprise prospects are not forced through the SMB free-assessment funnel.
// Per Sprint 9 CTA mapping, Enterprise routes to the Enterprise Engagement
// Discussion Cal.com event.
export const ENTERPRISE_CTA = {
  label: 'Discuss an Enterprise Engagement',
  href: SCHEDULING.enterpriseDiscussion.url,
};

// AI Training and AI Workshops route to the AI Training Consultation event.
export const TRAINING_CTA = {
  label: 'Schedule an AI Training Consultation',
  href: SCHEDULING.trainingConsultation.url,
};

// Executive AI Coaching's primary paid CTA routes to the paid Executive AI
// Advisory Session event.
export const EXECUTIVE_ADVISORY_CTA = {
  label: 'Book an Executive AI Advisory Session',
  href: SCHEDULING.executiveAdvisory.url,
};

export const FOOTER_LINKS = {
  solutions: [
    { label: 'AI Consulting', href: '/ai-consulting/' },
    { label: 'AI Implementation', href: '/ai-implementation/' },
    { label: 'AI Growth Systems', href: '/ai-growth-systems/' },
    { label: 'Managed AI Department', href: '/managed-ai-department/' },
    { label: 'Enterprise AI Transformation', href: '/enterprise/' },
    { label: 'AI Recruiting & HR Automation', href: '/ai-recruiting-automation/' },
  ],
  services: [
    { label: 'Google Ads', href: '/google-ads/' },
    { label: 'Meta Ads', href: '/meta-ads/' },
    { label: 'SEO', href: '/seo/' },
    { label: 'AI Training', href: '/ai-training/' },
    { label: 'AI Workshops', href: '/ai-workshops/' },
    { label: 'Executive AI Coaching', href: '/executive-ai-coaching/' },
  ],
  industries: [
    { label: 'Collision Repair', href: '/industries/collision-repair/' },
    { label: 'Law Firms', href: '/industries/law-firms/' },
    { label: 'Roofing', href: '/industries/roofing/' },
    { label: 'HVAC', href: '/industries/hvac/' },
    { label: 'Construction', href: '/industries/construction/' },
    { label: 'Professional Services', href: '/industries/professional-services/' },
    { label: 'Healthcare', href: '/industries/healthcare/' },
    { label: 'Insurance', href: '/industries/insurance/' },
    { label: 'Manufacturing', href: '/industries/manufacturing/' },
    { label: 'Automotive Dealer Groups', href: '/industries/automotive-dealers/' },
    { label: 'Home Services', href: '/industries/home-services/' },
    { label: 'Solar', href: '/industries/solar/' },
    { label: 'Fiber & Broadband', href: '/industries/fiber-broadband/' },
    { label: 'Real Estate', href: '/industries/real-estate/' },
    { label: 'Property Management', href: '/industries/property-management/' },
    { label: 'E-commerce', href: '/industries/ecommerce/' },
    { label: 'Financial Services', href: '/industries/financial-services/' },
    { label: 'Logistics & Transportation', href: '/industries/logistics-transportation/' },
    { label: 'Energy', href: '/industries/energy/' },
    { label: 'Defense & Aerospace', href: '/industries/defense-aerospace/' },
  ],
  company: [
    { label: 'The AI Department Method', href: '/ai-department-method/' },
    { label: 'Resources', href: '/resources/' },
    { label: 'Enterprise', href: '/enterprise/' },
    { label: 'About', href: '/about/' },
    { label: 'Contact', href: '/contact/' },
  ],
  legal: [
    { label: 'Privacy Policy', href: '/privacy/' },
    { label: 'Terms of Use', href: '/terms/' },
  ],
};
