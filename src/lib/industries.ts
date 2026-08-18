// Central industry registry — single source of truth for every industry
// the site supports. Consumed by the Industries mega-menu, footer,
// /industries/ hub page, and the AI Assessment's industry selector.
//
// Adding a new industry should mean adding ONE entry here, not editing
// four separate hard-coded lists across the codebase.

export interface Industry {
  name: string;
  href: string;
  /** Mega-menu / hub category grouping. */
  category: 'Home & Field Services' | 'Professional & Property' | 'Sales & Growth' | 'Enterprise & Regulated';
  /** Short description used in nav dropdowns and the /industries/ hub. */
  description: string;
  /** Value used by the AI Assessment's industry selector. Stable once
   * shipped — do not repurpose an existing value for a different
   * industry, since assessment drafts may persist it in localStorage. */
  assessmentValue: string;
  /** Whether this industry appears in the primary nav dropdown (footer
   * and /industries/ hub always show every industry regardless). Kept
   * false for individual home-service trades that are reachable through
   * the Home Services umbrella page, to avoid an unusably long dropdown. */
  showInPrimaryNav: boolean;
  /** Whether this industry appears in the footer's condensed industry
   * list (a strategically curated subset, not all 28). */
  showInFooter: boolean;
}

export const INDUSTRIES: Industry[] = [
  // ---------------- Home & Field Services ----------------
  { name: 'Automotive Dealer Groups', href: '/industries/automotive-dealers/', category: 'Home & Field Services', description: 'Multi-rooftop sales, BDC, service, and marketing coordination.', assessmentValue: 'automotive-dealers', showInPrimaryNav: true, showInFooter: true },
  { name: 'Collision Repair', href: '/industries/collision-repair/', category: 'Home & Field Services', description: 'Lead response, estimate follow-up, and customer communication.', assessmentValue: 'collision-repair', showInPrimaryNav: false, showInFooter: true },
  { name: 'Home Services (Overview)', href: '/industries/home-services/', category: 'Home & Field Services', description: 'Lead response, dispatch, and attribution across every home-service trade.', assessmentValue: 'home-services', showInPrimaryNav: true, showInFooter: false },
  { name: 'Roofing', href: '/industries/roofing/', category: 'Home & Field Services', description: 'Speed-to-lead, storm response, and estimate follow-up.', assessmentValue: 'roofing', showInPrimaryNav: false, showInFooter: true },
  { name: 'HVAC', href: '/industries/hvac/', category: 'Home & Field Services', description: 'Phone handling, scheduling, dispatch, and customer communication.', assessmentValue: 'hvac', showInPrimaryNav: false, showInFooter: true },
  { name: 'Plumbing', href: '/industries/plumbing/', category: 'Home & Field Services', description: 'Inbound call handling, missed-call recovery, and dispatch coordination.', assessmentValue: 'plumbing', showInPrimaryNav: false, showInFooter: false },
  { name: 'Electrical Contractors', href: '/industries/electrical-contractors/', category: 'Home & Field Services', description: 'Service-vs-project classification, scheduling, and estimate follow-up.', assessmentValue: 'electrical-contractors', showInPrimaryNav: false, showInFooter: false },
  { name: 'Pest Control', href: '/industries/pest-control/', category: 'Home & Field Services', description: 'Call handling, booking, and recurring-customer retention.', assessmentValue: 'pest-control', showInPrimaryNav: false, showInFooter: false },
  { name: 'Garage Door Companies', href: '/industries/garage-door-companies/', category: 'Home & Field Services', description: 'Same-day scheduling, missed-call recovery, and estimate follow-up.', assessmentValue: 'garage-door-companies', showInPrimaryNav: false, showInFooter: false },
  { name: 'Pool Companies', href: '/industries/pool-companies/', category: 'Home & Field Services', description: 'Lead response, estimate follow-up, and service retention.', assessmentValue: 'pool-companies', showInPrimaryNav: false, showInFooter: false },
  { name: 'Screen Enclosure Companies', href: '/industries/screen-enclosure-companies/', category: 'Home & Field Services', description: 'Site-visit scheduling, estimate follow-up, and project communication.', assessmentValue: 'screen-enclosure-companies', showInPrimaryNav: false, showInFooter: false },
  { name: 'Landscaping & Outdoor Living', href: '/industries/landscaping-outdoor-living/', category: 'Home & Field Services', description: 'Design-build consultations, long sales cycles, and estimate follow-up.', assessmentValue: 'landscaping-outdoor-living', showInPrimaryNav: false, showInFooter: false },
  { name: 'Restoration & Emergency Services', href: '/industries/restoration-emergency-services/', category: 'Home & Field Services', description: '24/7 intake, catastrophe routing, and dispatch coordination.', assessmentValue: 'restoration-emergency-services', showInPrimaryNav: false, showInFooter: false },
  { name: 'Construction', href: '/industries/construction/', category: 'Home & Field Services', description: 'Project communication, documentation, and admin workload.', assessmentValue: 'construction', showInPrimaryNav: false, showInFooter: true },

  // ---------------- Professional & Property ----------------
  { name: 'Real Estate', href: '/industries/real-estate/', category: 'Professional & Property', description: 'Lead response, database reactivation, and marketing attribution.', assessmentValue: 'real-estate', showInPrimaryNav: true, showInFooter: true },
  { name: 'Property Management', href: '/industries/property-management/', category: 'Professional & Property', description: 'Leasing response, maintenance intake, and vendor coordination.', assessmentValue: 'property-management', showInPrimaryNav: true, showInFooter: false },
  { name: 'Professional Services', href: '/industries/professional-services/', category: 'Professional & Property', description: 'Employee capacity, knowledge access, and client communication.', assessmentValue: 'professional-services', showInPrimaryNav: false, showInFooter: true },
  { name: 'Law Firms', href: '/industries/law-firms/', category: 'Professional & Property', description: 'Intake speed, follow-up, and document workflows.', assessmentValue: 'law-firms', showInPrimaryNav: false, showInFooter: true },
  { name: 'Healthcare', href: '/industries/healthcare/', category: 'Professional & Property', description: 'Administrative workflows, scheduling, and employee productivity.', assessmentValue: 'healthcare', showInPrimaryNav: false, showInFooter: true },
  { name: 'Insurance', href: '/industries/insurance/', category: 'Professional & Property', description: 'Claims-adjacent workflows, policyholder service, and contact center operations.', assessmentValue: 'insurance', showInPrimaryNav: false, showInFooter: false },
  { name: 'Manufacturing', href: '/industries/manufacturing/', category: 'Professional & Property', description: 'RFQ workflows, documentation, and operational administration.', assessmentValue: 'manufacturing', showInPrimaryNav: false, showInFooter: false },

  // ---------------- Sales & Growth ----------------
  { name: 'Solar', href: '/industries/solar/', category: 'Sales & Growth', description: 'Field sales, appointment setting, and consent-aware follow-up.', assessmentValue: 'solar', showInPrimaryNav: true, showInFooter: true },
  { name: 'Fiber & Broadband', href: '/industries/fiber-broadband/', category: 'Sales & Growth', description: 'Territory launches, door-to-door sales, and installation scheduling.', assessmentValue: 'fiber-broadband', showInPrimaryNav: true, showInFooter: false },
  { name: 'E-commerce', href: '/industries/ecommerce/', category: 'Sales & Growth', description: 'Customer service, lifecycle marketing, and merchandising.', assessmentValue: 'ecommerce', showInPrimaryNav: true, showInFooter: true },

  // ---------------- Enterprise & Regulated ----------------
  { name: 'Financial Services', href: '/industries/financial-services/', category: 'Enterprise & Regulated', description: 'Governance, data controls, and controlled AI adoption.', assessmentValue: 'financial-services', showInPrimaryNav: true, showInFooter: true },
  { name: 'Logistics & Transportation', href: '/industries/logistics-transportation/', category: 'Enterprise & Regulated', description: 'Dispatch communication, document processing, and reporting.', assessmentValue: 'logistics-transportation', showInPrimaryNav: true, showInFooter: false },
  { name: 'Energy', href: '/industries/energy/', category: 'Enterprise & Regulated', description: 'Field operations knowledge, documentation, and enterprise productivity.', assessmentValue: 'energy', showInPrimaryNav: true, showInFooter: false },
  { name: 'Defense & Aerospace', href: '/industries/defense-aerospace/', category: 'Enterprise & Regulated', description: 'Governed enterprise AI for legitimate business operations.', assessmentValue: 'defense-aerospace', showInPrimaryNav: true, showInFooter: false },
];

export const INDUSTRY_CATEGORIES = ['Home & Field Services', 'Professional & Property', 'Sales & Growth', 'Enterprise & Regulated'] as const;

export function industriesByCategory(): { category: string; items: Industry[] }[] {
  return INDUSTRY_CATEGORIES.map((category) => ({
    category,
    items: INDUSTRIES.filter((i) => i.category === category),
  }));
}
