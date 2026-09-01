// Industry registry.
//
// TO ADD AN INDUSTRY: add the id to src/core/taxonomy.ts, write a module
// with defineSpecialist(), register it below, and add router rules in
// src/core/router-rules.ts. Nothing else changes — the orchestrator,
// sessions, tools and transport are all industry-agnostic.
//
// Several specialists may serve one industry (attorneys has four);
// order is most-specific-first and the first matching one wins.

import type { Industry } from '../core/taxonomy.ts';
import type { Session } from '../core/types.ts';
import type { IndustrySpecialist } from './types.ts';

import { familyLaw } from './attorneys/family-law.ts';
import { personalInjury } from './attorneys/personal-injury.ts';
import { criminalDefense } from './attorneys/criminal-defense.ts';
import { probateEstate } from './attorneys/probate-estate.ts';

import { plumbing } from './home-services/plumbing.ts';
import { roofing } from './home-services/roofing.ts';
import { hvac } from './home-services/hvac.ts';
import { electrical } from './home-services/electrical.ts';
import { pestControl } from './home-services/pest-control.ts';
import { restoration } from './home-services/restoration.ts';
import { garageDoor } from './home-services/garage-door.ts';
import { pool } from './home-services/pool.ts';
import { landscaping } from './home-services/landscaping.ts';
import { screenEnclosure } from './home-services/screen-enclosure.ts';
import { construction } from './home-services/construction.ts';
import { pressureWashing } from './home-services/pressure-washing.ts';

import { realEstate } from './property/real-estate.ts';
import { propertyManagement } from './property/property-management.ts';

import { collisionRepair } from './automotive/collision-repair.ts';
import { automotiveDealer } from './automotive/automotive-dealer.ts';

import { healthcare } from './regulated/healthcare.ts';
import { insurance } from './regulated/insurance.ts';
import { financialServices } from './regulated/financial-services.ts';

import { professionalServices } from './enterprise/professional-services.ts';
import { manufacturing } from './enterprise/manufacturing.ts';
import { logistics } from './enterprise/logistics.ts';
import { energy } from './enterprise/energy.ts';
import { defenseAerospace } from './enterprise/defense-aerospace.ts';

import { solar } from './growth/solar.ts';
import { fiberBroadband } from './growth/fiber-broadband.ts';
import { ecommerce } from './growth/ecommerce.ts';

export const REGISTRY: Record<Industry, IndustrySpecialist[]> = {
  // Attorneys carry four specialists — the router's specialty decides.
  attorneys: [familyLaw, personalInjury, criminalDefense, probateEstate],

  plumbing: [plumbing],
  roofing: [roofing],
  hvac: [hvac],
  electrical: [electrical],
  pest_control: [pestControl],
  garage_door: [garageDoor],
  pool: [pool],
  screen_enclosure: [screenEnclosure],
  landscaping: [landscaping],
  restoration: [restoration],
  construction: [construction],
  pressure_washing: [pressureWashing],

  collision_repair: [collisionRepair],
  automotive_dealer: [automotiveDealer],

  real_estate: [realEstate],
  property_management: [propertyManagement],

  healthcare: [healthcare],
  insurance: [insurance],
  financial_services: [financialServices],
  professional_services: [professionalServices],

  manufacturing: [manufacturing],
  logistics: [logistics],
  energy: [energy],
  defense_aerospace: [defenseAerospace],

  solar: [solar],
  fiber_broadband: [fiberBroadband],
  ecommerce: [ecommerce],
};

export function selectSpecialist(session: Session): IndustrySpecialist | null {
  const { industry, specialty, intent } = session.route;
  if (!industry) return null;
  const candidates = REGISTRY[industry];
  if (!candidates || candidates.length === 0) return null;
  return candidates.find((m) => m.matches(specialty, intent)) ?? candidates[0];
}

export function allSpecialists(): IndustrySpecialist[] {
  return Object.values(REGISTRY).flat();
}

export function specialistById(id: string): IndustrySpecialist | undefined {
  return allSpecialists().find((s) => s.id === id);
}

export type { IndustrySpecialist };
