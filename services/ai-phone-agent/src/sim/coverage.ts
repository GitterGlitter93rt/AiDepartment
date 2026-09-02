#!/usr/bin/env node
// Industry coverage check.
//
//   npm run voice:coverage
//
// Compares three lists that live in three different places and drift
// apart silently:
//
//   1. the WEBSITE registry   (../../src/lib/industries.ts)
//   2. the AGENT taxonomy     (src/core/taxonomy.ts + specialists)
//   3. the INVENTORY document (docs/voice-agent-industry-inventory.md)
//
// A website industry with no specialist means a prospect in that trade
// hears the wrong business. A specialist missing from the inventory
// means the documentation is lying. Both are silent failures no unit
// test catches, because the website and the service are separate build
// graphs.
//
// Exits non-zero on a real gap so it can gate CI.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDUSTRY_IDS, INDUSTRY_LABELS } from '../core/taxonomy.ts';
import { REGISTRY, allSpecialists } from '../industries/index.ts';
import { ALL_BANKS } from '../knowledge/index.ts';
import { SCENARIOS } from './scenarios.ts';
import { RULES } from '../core/router-rules.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

/**
 * Industries implemented on purpose despite having no website page.
 *
 * Pressure Washing is an active sales and demo target. It is listed
 * here rather than silently tolerated so that removing the page-gap
 * exemption is a deliberate act, and so a fresh session cannot mistake
 * it for an accident and delete the specialist.
 */
const INTENTIONAL_EXTRAS: Record<string, string> = {
  pressure_washing:
    'Active sales/demo target. Absent from the website registry — this is a WEBSITE CONTENT GAP, not an agent gap. Do not remove.',
};

interface WebsiteIndustry {
  name: string;
  href: string;
  category: string;
}

function readWebsiteRegistry(): WebsiteIndustry[] {
  const path = resolve(REPO, 'src/lib/industries.ts');
  const src = readFileSync(path, 'utf8');
  const re = /\{ name: '([^']+)', href: '([^']+)', category: '([^']+)'/g;
  const out: WebsiteIndustry[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ name: m[1], href: m[2], category: m[3] });
  return out;
}

/** Website slug → agent industry id. Naming differs on purpose. */
const SLUG_TO_INDUSTRY: Record<string, string> = {
  'automotive-dealers': 'automotive_dealer',
  'collision-repair': 'collision_repair',
  'home-services': '__umbrella__', // a category page, not a trade
  roofing: 'roofing',
  hvac: 'hvac',
  plumbing: 'plumbing',
  'electrical-contractors': 'electrical',
  'pest-control': 'pest_control',
  'garage-door-companies': 'garage_door',
  'pool-companies': 'pool',
  'screen-enclosure-companies': 'screen_enclosure',
  'landscaping-outdoor-living': 'landscaping',
  'restoration-emergency-services': 'restoration',
  construction: 'construction',
  'real-estate': 'real_estate',
  'property-management': 'property_management',
  'professional-services': 'professional_services',
  'law-firms': 'attorneys',
  healthcare: 'healthcare',
  insurance: 'insurance',
  manufacturing: 'manufacturing',
  solar: 'solar',
  'fiber-broadband': 'fiber_broadband',
  ecommerce: 'ecommerce',
  'financial-services': 'financial_services',
  'logistics-transportation': 'logistics',
  energy: 'energy',
  'defense-aerospace': 'defense_aerospace',
};

function slugOf(href: string): string {
  return href.replace(/^\/industries\//, '').replace(/\/$/, '');
}

function readInventoryDoc(): string {
  try {
    return readFileSync(resolve(REPO, 'docs/voice-agent-industry-inventory.md'), 'utf8');
  } catch {
    return '';
  }
}

export interface CoverageReport {
  websiteCount: number;
  taxonomyCount: number;
  specialistCount: number;
  /** On the website, no specialist in the agent. The serious one. */
  missingSpecialist: { name: string; href: string }[];
  /** In the agent, not on the website, and not a declared exception. */
  undeclaredExtra: string[];
  /** Declared deliberate extras, with the reason. */
  intentionalExtras: { id: string; reason: string }[];
  /** Website slugs with no mapping entry — usually a NEW website industry. */
  unmappedSlugs: string[];
  /** In the agent but absent from the inventory document. */
  missingFromInventory: string[];
  /** Structural gaps inside the agent itself. */
  noRoutingRule: string[];
  noKnowledgeBank: string[];
  noScenario: string[];
}

export function buildCoverage(): CoverageReport {
  const website = readWebsiteRegistry();
  const doc = readInventoryDoc();
  const taxonomy = new Set<string>(INDUSTRY_IDS);

  const missingSpecialist: { name: string; href: string }[] = [];
  const unmappedSlugs: string[] = [];
  const mapped = new Set<string>();

  for (const w of website) {
    const slug = slugOf(w.href);
    const id = SLUG_TO_INDUSTRY[slug];
    if (!id) {
      unmappedSlugs.push(slug);
      continue;
    }
    if (id === '__umbrella__') continue;
    mapped.add(id);
    if (!taxonomy.has(id) || !REGISTRY[id as keyof typeof REGISTRY]?.length) {
      missingSpecialist.push({ name: w.name, href: w.href });
    }
  }

  const extras = INDUSTRY_IDS.filter((id) => !mapped.has(id));
  const undeclaredExtra = extras.filter((id) => !INTENTIONAL_EXTRAS[id]);
  const intentionalExtras = extras
    .filter((id) => INTENTIONAL_EXTRAS[id])
    .map((id) => ({ id, reason: INTENTIONAL_EXTRAS[id] }));

  const ruleIndustries = new Set(RULES.map((r) => r.industry));
  const bankKeys = new Set(Object.keys(ALL_BANKS));
  const scenarioIndustries = new Set(SCENARIOS.map((s) => s.industry));

  return {
    websiteCount: website.length,
    taxonomyCount: INDUSTRY_IDS.length,
    specialistCount: allSpecialists().length,
    missingSpecialist,
    undeclaredExtra,
    intentionalExtras,
    unmappedSlugs,
    missingFromInventory: INDUSTRY_IDS.filter((id) => doc !== '' && !doc.includes(id)),
    noRoutingRule: INDUSTRY_IDS.filter((id) => !ruleIndustries.has(id)),
    // attorneys is keyed by specialist, so check either form.
    noKnowledgeBank: INDUSTRY_IDS.filter(
      (id) => !bankKeys.has(id) && !allSpecialists().some((s) => s.industry === id && bankKeys.has(s.id)),
    ),
    noScenario: INDUSTRY_IDS.filter((id) => !scenarioIndustries.has(id)),
  };
}

function main(): void {
  const r = buildCoverage();
  const problems: string[] = [];

  console.log('\nINDUSTRY COVERAGE\n' + '='.repeat(60));
  console.log(`Website registry:   ${r.websiteCount} industries`);
  console.log(`Agent taxonomy:     ${r.taxonomyCount} industries`);
  console.log(`Specialists:        ${r.specialistCount} modules`);
  console.log();

  const section = (title: string, items: string[], fatal: boolean) => {
    if (items.length === 0) {
      console.log(`  ok    ${title}`);
      return;
    }
    console.log(`  ${fatal ? 'FAIL' : 'warn'}  ${title}`);
    for (const i of items) console.log(`          - ${i}`);
    if (fatal) problems.push(title);
  };

  section('every website industry has a specialist',
    r.missingSpecialist.map((m) => `${m.name} (${m.href})`), true);
  section('every website industry is mapped',
    r.unmappedSlugs.map((s) => `/industries/${s}/ — new on the website? add it to SLUG_TO_INDUSTRY`), true);
  section('every agent industry has a routing rule', r.noRoutingRule, true);
  section('every agent industry has a knowledge bank', r.noKnowledgeBank, true);
  section('every agent industry has a demo scenario', r.noScenario, true);
  section('every agent industry appears in the inventory doc', r.missingFromInventory, true);
  section('no undeclared extra industries', r.undeclaredExtra, true);

  if (r.intentionalExtras.length) {
    console.log('\n  DELIBERATE EXTRAS (implemented without a website page)');
    for (const e of r.intentionalExtras) {
      console.log(`    ${INDUSTRY_LABELS[e.id as keyof typeof INDUSTRY_LABELS] ?? e.id}`);
      console.log(`      ${e.reason}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  if (problems.length) {
    console.log(`${problems.length} coverage problem(s). Fix before shipping.\n`);
    process.exitCode = 1;
  } else {
    console.log('Coverage is complete.\n');
  }
}

if (process.argv[1] && process.argv[1].endsWith('coverage.ts')) main();
