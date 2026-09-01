// The industry taxonomy, derived from the website's own registry
// (src/lib/industries.ts) — see docs/voice-agent-industry-inventory.md.
//
// One id per vertical the site markets to. Specialties live inside an
// industry (attorneys → family_law, personal_injury, …) so the router
// can be coarse first and precise second.

export const INDUSTRY_IDS = [
  // --- Home & field services -------------------------------------
  'plumbing',
  'roofing',
  'hvac',
  'electrical',
  'pest_control',
  'garage_door',
  'pool',
  'screen_enclosure',
  'landscaping',
  'restoration',
  'construction',
  'pressure_washing',
  // --- Automotive ------------------------------------------------
  'collision_repair',
  'automotive_dealer',
  // --- Property --------------------------------------------------
  'real_estate',
  'property_management',
  // --- Professional & regulated ----------------------------------
  'attorneys',
  'healthcare',
  'insurance',
  'financial_services',
  'professional_services',
  // --- Industrial & enterprise -----------------------------------
  'manufacturing',
  'logistics',
  'energy',
  'defense_aerospace',
  // --- Growth ----------------------------------------------------
  'solar',
  'fiber_broadband',
  'ecommerce',
] as const;

export type Industry = (typeof INDUSTRY_IDS)[number];

export function isIndustry(value: unknown): value is Industry {
  return typeof value === 'string' && (INDUSTRY_IDS as readonly string[]).includes(value);
}

export type Urgency = 'emergency' | 'high' | 'normal' | 'low';

/** Human-facing labels, used only in internal logs and docs — never
 * spoken to a caller. */
export const INDUSTRY_LABELS: Record<Industry, string> = {
  plumbing: 'Plumbing',
  roofing: 'Roofing',
  hvac: 'HVAC',
  electrical: 'Electrical Contractors',
  pest_control: 'Pest Control',
  garage_door: 'Garage Door',
  pool: 'Pool Companies',
  screen_enclosure: 'Screen Enclosures',
  landscaping: 'Landscaping & Outdoor Living',
  restoration: 'Restoration & Emergency Services',
  construction: 'Construction',
  pressure_washing: 'Pressure Washing',
  collision_repair: 'Collision Repair',
  automotive_dealer: 'Automotive Dealer Groups',
  real_estate: 'Real Estate',
  property_management: 'Property Management',
  attorneys: 'Law Firms',
  healthcare: 'Healthcare',
  insurance: 'Insurance',
  financial_services: 'Financial Services',
  professional_services: 'Professional Services',
  manufacturing: 'Manufacturing',
  logistics: 'Logistics & Transportation',
  energy: 'Energy',
  defense_aerospace: 'Defense & Aerospace',
  solar: 'Solar',
  fiber_broadband: 'Fiber & Broadband',
  ecommerce: 'E-commerce',
};
