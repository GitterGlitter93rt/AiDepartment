// Central site configuration.
// Canonical domain + nav structure per docs/02-website/sitemap.md (v2.0, canonical)
// and docs/02-website/technical-seo-spec.md.

import { SCHEDULING } from './scheduling';
import { INDUSTRIES, industriesByCategory } from './industries';

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
  { label: 'Industries', href: '/industries/' },
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

// Services mega-menu structure per Sprint 12.1 requirement 6. Several
// items intentionally point to the same substantial commercial page,
// highlighting a different capability described within it — per explicit
// instruction not to create a thin doorway page per bullet.
export interface ServiceMenuItem extends NavItem {
  description: string;
}

export const SERVICES_MENU: { category: string; items: ServiceMenuItem[] }[] = [
  {
    category: 'AI & Automation',
    items: [
      // Premium paid diagnostic — the only priced offer in the nav, kept
      // in the Services mega-menu (desktop + mobile render from this
      // same list) so the free assessment remains the primary CTA.
      { label: 'Comprehensive AI Business Audit', href: '/comprehensive-ai-business-audit/', description: 'A $495 deeper diagnostic with a personalized audit report and a 45-minute strategy review.' },
      { label: 'AI Implementation', href: '/ai-implementation/', description: 'Build AI agents, automations, integrations, and internal assistants.' },
      { label: 'AI Agent Development', href: '/ai-agent-development/', description: 'Practical business agents for support, lead response, and internal knowledge.' },
      { label: 'AI Phone & Voice Agents', href: '/ai-agent-development/', description: 'Voice-based intake and follow-up integrated with human escalation.' },
      { label: 'Workflow Automation', href: '/ai-implementation/', description: 'Connect systems and automate repetitive operational handoffs.' },
    ],
  },
  {
    category: 'CRM & Integration',
    items: [
      { label: 'CRM Setup & Automation', href: '/crm-setup-automation/', description: 'Pipeline architecture, lifecycle stages, and task automation.' },
      { label: 'AI + CRM Integration', href: '/ai-crm-integration/', description: 'Connect AI tools to your existing CRM without replacing it.' },
      { label: 'Software & API Integration', href: '/ai-crm-integration/', description: 'Webhooks, APIs, and integration platforms connecting your systems.' },
    ],
  },
  {
    category: 'Analytics & Tracking',
    items: [
      { label: 'Conversion Tracking & Attribution', href: '/conversion-tracking-analytics/', description: 'Connect marketing activity to booked, sold, and completed revenue.' },
      { label: 'GA4 & Google Tag Manager', href: '/conversion-tracking-analytics/', description: 'Event tracking, tag implementation, and measurement architecture.' },
      { label: 'Google Ads Conversion Tracking', href: '/conversion-tracking-analytics/', description: 'Conversion actions, enhanced conversions, and offline feedback.' },
      { label: 'Call & Lead Attribution', href: '/conversion-tracking-analytics/', description: 'Phone-click tracking and source preservation through the CRM.' },
    ],
  },
  {
    category: 'Growth',
    items: [
      { label: 'Google Ads', href: '/google-ads/', description: 'Turn Google Ads into a measurable, attributed revenue system.' },
      { label: 'Meta Ads', href: '/meta-ads/', description: 'Facebook and Instagram advertising connected to real follow-up and sales.' },
      { label: 'SEO', href: '/seo/', description: 'Organic visibility, content, and technical foundations that convert.' },
    ],
  },
  {
    category: 'Training & Advisory',
    items: [
      { label: 'AI Training', href: '/ai-training/', description: 'Practical, role-specific AI training for real business workflows.' },
      { label: 'AI Workshops', href: '/ai-workshops/', description: 'Focused sessions for opportunity discovery and team enablement.' },
      { label: 'Executive AI Coaching', href: '/executive-ai-coaching/', description: 'One-on-one AI advisory for owners, CEOs, and senior leaders.' },
    ],
  },
];

// Flat view for the Header component's shared dropdown-rendering logic.
export const SERVICES_DROPDOWN: DropdownItem[] = SERVICES_MENU.flatMap((cat) => cat.items);

// Industries mega-menu data, derived entirely from the central registry
// (src/lib/industries.ts) — adding an industry there is sufficient; no
// separate list needs to be maintained here. Normalized to the same
// {label, href, description} shape as SERVICES_MENU so Header.astro can
// render both mega-menus with one shared code path.
export const INDUSTRIES_MEGA_MENU: { category: string; items: ServiceMenuItem[] }[] = industriesByCategory().map((cat) => ({
  category: cat.category,
  items: cat.items.map((i) => ({ label: i.name, href: i.href, description: i.description })),
}));

// Footer's curated, strategically-important subset (not all 28 — see
// Industry.showInFooter in the registry for which ones qualify).
export const FOOTER_INDUSTRIES: DropdownItem[] = INDUSTRIES.filter((i) => i.showInFooter).map((i) => ({
  label: i.name,
  href: i.href,
  description: i.description,
}));

export const PRIMARY_CTA = {
  label: 'Get Your AI Department Score',
  // The short free funnel's canonical public route. (/ai-assessment/
  // is a legacy compatibility choice page; /ai-assessment/full/ is the
  // underlying 64-question engine.)
  href: '/free-ai-assessment/',
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
    { label: 'Comprehensive AI Business Audit', href: '/comprehensive-ai-business-audit/' },
    { label: 'AI Agent Development', href: '/ai-agent-development/' },
    { label: 'CRM Setup & Automation', href: '/crm-setup-automation/' },
    { label: 'AI + CRM Integration', href: '/ai-crm-integration/' },
    { label: 'Conversion Tracking & Analytics', href: '/conversion-tracking-analytics/' },
    { label: 'Google Ads', href: '/google-ads/' },
    { label: 'SEO', href: '/seo/' },
    { label: 'AI Training', href: '/ai-training/' },
  ],
  industries: FOOTER_INDUSTRIES,
  company: [
    { label: 'The AI Department Method', href: '/ai-department-method/' },
    { label: 'Resources', href: '/resources/' },
    { label: 'Enterprise', href: '/enterprise/' },
    { label: 'Assessment Options', href: '/ai-assessment/' },
    { label: 'About', href: '/about/' },
    { label: 'Contact', href: '/contact/' },
  ],
  legal: [
    { label: 'Privacy Policy', href: '/privacy/' },
    { label: 'Terms of Use', href: '/terms/' },
  ],
};
