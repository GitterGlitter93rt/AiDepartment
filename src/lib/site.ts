// Central site configuration.
// Canonical domain + nav structure per docs/02-website/sitemap.md (v2.0, canonical)
// and docs/02-website/technical-seo-spec.md.

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
];

export const PRIMARY_CTA = {
  label: 'Get Your AI Department Score',
  href: '/ai-assessment/',
};

// Centralized "Schedule a Strategy Call" destination. No scheduling provider
// (Calendly, Cal.com, HubSpot Meetings, etc.) has been selected yet — this
// intentionally routes to the Contact page so a real scheduling widget can
// be dropped in later by changing this ONE value, rather than hunting down
// every CTA that currently says "Schedule a Strategy Call" across the site.
export const SECONDARY_CTA = {
  label: 'Schedule a Strategy Call',
  href: '/contact/',
};

// AI Implementation's hero flips CTA priority per docs/03-products/ai-implementation.md
// ("Discuss an AI Implementation" is primary there, assessment is secondary).
export const IMPLEMENTATION_CTA = {
  label: 'Discuss an AI Implementation',
  href: '/contact/',
};

// Enterprise uses its own approved CTA per docs/02-website/enterprise.md —
// enterprise prospects are not forced through the SMB free-assessment funnel.
export const ENTERPRISE_CTA = {
  label: 'Discuss an Enterprise Engagement',
  href: '/contact/',
};

export const FOOTER_LINKS = {
  solutions: [
    { label: 'AI Consulting', href: '/ai-consulting/' },
    { label: 'AI Implementation', href: '/ai-implementation/' },
    { label: 'AI Growth Systems', href: '/ai-growth-systems/' },
    { label: 'Managed AI Department', href: '/managed-ai-department/' },
    { label: 'Enterprise AI Transformation', href: '/enterprise/' },
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
  ],
  company: [
    { label: 'The AI Department Method', href: '/ai-department-method/' },
    { label: 'Enterprise', href: '/enterprise/' },
    { label: 'About', href: '/about/' },
    { label: 'Contact', href: '/contact/' },
  ],
  legal: [
    { label: 'Privacy Policy', href: '/privacy-policy/' },
    { label: 'Terms of Use', href: '/terms-of-use/' },
  ],
};
