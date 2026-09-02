// Knowledge registry: industry (and where it matters, specialty) to bank.
//
// Keyed by specialist id where a specialty needs its own bank — the
// four legal specialties ask and refuse very different things — and by
// industry id otherwise.

import type { IndustryKnowledge, KnowledgeEntry } from './types.ts';
import { UNIVERSAL_KNOWLEDGE } from './universal.ts';
import { PLUMBING_KNOWLEDGE } from './plumbing.ts';
import { ROOFING_KNOWLEDGE } from './roofing.ts';
import { REAL_ESTATE_KNOWLEDGE } from './real-estate.ts';
import { PRESSURE_WASHING_KNOWLEDGE } from './pressure-washing.ts';
import { FAMILY_LAW_KNOWLEDGE } from './attorneys-family-law.ts';
import {
  PERSONAL_INJURY_KNOWLEDGE, CRIMINAL_DEFENSE_KNOWLEDGE, PROBATE_KNOWLEDGE,
} from './attorneys-other.ts';
import {
  HVAC_KNOWLEDGE, ELECTRICAL_KNOWLEDGE, PEST_KNOWLEDGE, GARAGE_DOOR_KNOWLEDGE,
  POOL_KNOWLEDGE, SCREEN_KNOWLEDGE, LANDSCAPING_KNOWLEDGE, RESTORATION_KNOWLEDGE,
  CONSTRUCTION_KNOWLEDGE, COLLISION_KNOWLEDGE, AUTO_DEALER_KNOWLEDGE,
} from './trades.ts';
import {
  PROPERTY_MGMT_KNOWLEDGE, HEALTHCARE_KNOWLEDGE, INSURANCE_KNOWLEDGE,
  FINANCIAL_KNOWLEDGE, PROFESSIONAL_SERVICES_KNOWLEDGE, MANUFACTURING_KNOWLEDGE,
  LOGISTICS_KNOWLEDGE, ENERGY_KNOWLEDGE, DEFENSE_KNOWLEDGE, SOLAR_KNOWLEDGE,
  FIBER_KNOWLEDGE, ECOMMERCE_KNOWLEDGE,
} from './professional.ts';

/**
 * Specialist-id keyed banks. Checked before the industry bank, so a
 * legal specialty gets its own refusals rather than a generic set.
 */
const BY_SPECIALIST: Record<string, KnowledgeEntry[]> = {
  'attorneys.family_law': FAMILY_LAW_KNOWLEDGE,
  'attorneys.personal_injury': PERSONAL_INJURY_KNOWLEDGE,
  'attorneys.criminal_defense': CRIMINAL_DEFENSE_KNOWLEDGE,
  'attorneys.probate_estate': PROBATE_KNOWLEDGE,
};

const BY_INDUSTRY: Record<string, KnowledgeEntry[]> = {
  plumbing: PLUMBING_KNOWLEDGE,
  roofing: ROOFING_KNOWLEDGE,
  real_estate: REAL_ESTATE_KNOWLEDGE,
  pressure_washing: PRESSURE_WASHING_KNOWLEDGE,
  hvac: HVAC_KNOWLEDGE,
  electrical: ELECTRICAL_KNOWLEDGE,
  pest_control: PEST_KNOWLEDGE,
  garage_door: GARAGE_DOOR_KNOWLEDGE,
  pool: POOL_KNOWLEDGE,
  screen_enclosure: SCREEN_KNOWLEDGE,
  landscaping: LANDSCAPING_KNOWLEDGE,
  restoration: RESTORATION_KNOWLEDGE,
  construction: CONSTRUCTION_KNOWLEDGE,
  collision_repair: COLLISION_KNOWLEDGE,
  automotive_dealer: AUTO_DEALER_KNOWLEDGE,
  property_management: PROPERTY_MGMT_KNOWLEDGE,
  healthcare: HEALTHCARE_KNOWLEDGE,
  insurance: INSURANCE_KNOWLEDGE,
  financial_services: FINANCIAL_KNOWLEDGE,
  professional_services: PROFESSIONAL_SERVICES_KNOWLEDGE,
  manufacturing: MANUFACTURING_KNOWLEDGE,
  logistics: LOGISTICS_KNOWLEDGE,
  energy: ENERGY_KNOWLEDGE,
  defense_aerospace: DEFENSE_KNOWLEDGE,
  solar: SOLAR_KNOWLEDGE,
  fiber_broadband: FIBER_KNOWLEDGE,
  ecommerce: ECOMMERCE_KNOWLEDGE,
  // attorneys has no industry-level bank: every legal call belongs to
  // one of the four specialties above.
};

/**
 * Builds the bank for a specialist.
 *
 * Universal entries come LAST so an industry-specific entry wins the
 * match. "How much does a consultation cost" should hit the family-law
 * entry, which knows not to guess at a retainer, rather than the
 * generic pricing entry.
 */
export function knowledgeFor(specialistId: string | null, industry: string | null): IndustryKnowledge | null {
  const specific = specialistId ? BY_SPECIALIST[specialistId] : undefined;
  const byIndustry = industry ? BY_INDUSTRY[industry] : undefined;
  const entries = [...(specific ?? []), ...(byIndustry ?? []), ...UNIVERSAL_KNOWLEDGE];
  if (entries.length === 0) return null;
  return { industry: industry ?? 'unknown', entries };
}

/** Every bank, for coverage tests. */
export const ALL_BANKS = { ...BY_SPECIALIST, ...BY_INDUSTRY };
export { UNIVERSAL_KNOWLEDGE };
