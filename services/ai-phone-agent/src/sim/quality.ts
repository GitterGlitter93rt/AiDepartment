#!/usr/bin/env node
// Industry quality audit.
//
//   npm run voice:quality            # print the matrix
//   npm run voice:quality -- --write # regenerate docs/voice-agent-industry-quality.md
//
// Computed from the code, not hand-written, so it cannot quietly go
// stale the way a maintained table does. The point is to be CRITICAL:
// the thresholds are set so that "the file exists" is nowhere near
// enough to score STRONG.

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDUSTRY_IDS, INDUSTRY_LABELS, type Industry } from '../core/taxonomy.ts';
import { REGISTRY, allSpecialists } from '../industries/index.ts';
import { RULES } from '../core/router-rules.ts';
import { knowledgeFor } from '../knowledge/index.ts';
import { SCENARIOS } from './scenarios.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

export type Status = 'STRONG' | 'GOOD' | 'NEEDS_REFINEMENT';

export interface IndustryQuality {
  id: Industry;
  label: string;
  specialists: number;
  intents: number;
  routerRules: number;
  /** Industry-specific knowledge entries, excluding the universal bank. */
  knowledgeEntries: number;
  /** Entries that hold a hard line: refuse or business_config. */
  refusalEntries: number;
  qualificationFields: number;
  urgencyRules: number;
  escalationRules: number;
  sampleUtterances: number;
  scenarios: number;
  /** Scenarios carrying explicit prohibitions. */
  scenariosWithProhibitions: number;
  hasExistingCustomerPath: boolean;
  hasSafetyRule: boolean;
  hasBooking: boolean;
  status: Status;
  weaknesses: string[];
}

/** The five immediate demo and sales targets. */
const PRIORITY: string[] = ['attorneys', 'plumbing', 'roofing', 'real_estate', 'pressure_washing'];

const UNIVERSAL_SIZE = knowledgeFor(null, '__none__')?.entries.length ?? 0;

export function auditIndustry(id: Industry): IndustryQuality {
  const specs = REGISTRY[id] ?? [];
  const intents = new Set(specs.flatMap((s) => s.supportedIntents));
  const rules = RULES.filter((r) => r.industry === id);

  // Sum the specialist-specific banks where they exist, otherwise the
  // industry bank — minus the universal entries every industry shares,
  // which would otherwise flatter a bank with nothing of its own.
  const banks = specs.length
    ? specs.map((s) => knowledgeFor(s.id, id))
    : [knowledgeFor(null, id)];
  const seen = new Set<string>();
  let knowledgeEntries = 0;
  let refusalEntries = 0;
  for (const bank of banks) {
    for (const e of bank?.entries ?? []) {
      if (e.id.startsWith('universal.') || seen.has(e.id)) continue;
      seen.add(e.id);
      knowledgeEntries += 1;
      if (e.source === 'refuse' || e.source === 'business_config') refusalEntries += 1;
    }
  }

  const scenarios = SCENARIOS.filter((s) => s.industry === id);
  const qualificationFields = specs.reduce((n, s) => n + s.qualificationSchema.length, 0);
  const urgencyRules = specs.reduce((n, s) => n + s.urgencyRules.length, 0);
  // COMMON_ESCALATIONS is inherited by every specialist, so only rules
  // beyond that baseline count as real industry work.
  const escalationRules = specs.reduce((n, s) => n + Math.max(0, s.escalationRules.length - 3), 0);
  const sampleUtterances = specs.reduce((n, s) => n + s.sampleUtterances.length, 0);

  const prompts = specs.map((s) => s.systemPrompt).join('\n');
  const hasSafetyRule = /\b(911|emergency|safety|danger|do not touch|leave the building|hazard)\b/i.test(prompts)
    || specs.some((s) => s.urgencyRules.some((u) => u.level === 'emergency'));
  // Every industry inherits universal.existing_customer, so the
  // handling always exists. What this measures is whether a SCENARIO
  // exercises it — an untested path is one nobody has watched work.
  const hasExistingCustomerPath = scenarios.some(
    (s) => /EXISTING|COMPLAINT|STATUS|BILLING/.test(s.id) || /existing/i.test(s.note ?? ''),
  );
  const hasBooking = specs.some((s) => s.bookingRules?.booksOnCall !== undefined);

  const weaknesses: string[] = [];
  if (knowledgeEntries < 6) weaknesses.push(`only ${knowledgeEntries} industry knowledge entries`);
  if (rules.length < 3) weaknesses.push(`only ${rules.length} routing rules`);
  if (scenarios.length < 2) weaknesses.push(`only ${scenarios.length} demo scenario(s)`);
  if (scenarios.length > 0 && scenariosWithProhibitions(scenarios) === 0) {
    weaknesses.push('no scenario asserts anything the agent must NOT say');
  }
  if (qualificationFields < 5) weaknesses.push(`thin intake (${qualificationFields} fields)`);
  if (urgencyRules === 0) weaknesses.push('no urgency rules');
  if (!hasExistingCustomerPath) weaknesses.push('no scenario exercises an existing customer or complaint');
  if (refusalEntries < 2) weaknesses.push(`only ${refusalEntries} industry-specific hard limit(s)`);
  if (PRIORITY.includes(id)) {
    if (knowledgeEntries < 9) weaknesses.push('priority industry: knowledge below the deeper bar');
    if (scenarios.length < 4) weaknesses.push('priority industry: fewer than 4 scenarios');
  }

  return {
    id,
    label: INDUSTRY_LABELS[id],
    specialists: specs.length,
    intents: intents.size,
    routerRules: rules.length,
    knowledgeEntries,
    refusalEntries,
    qualificationFields,
    urgencyRules,
    escalationRules,
    sampleUtterances,
    scenarios: scenarios.length,
    scenariosWithProhibitions: scenariosWithProhibitions(scenarios),
    hasExistingCustomerPath,
    hasSafetyRule,
    hasBooking,
    status: weaknesses.length === 0 ? 'STRONG' : weaknesses.length <= 2 ? 'GOOD' : 'NEEDS_REFINEMENT',
    weaknesses,
  };
}

function scenariosWithProhibitions(list: typeof SCENARIOS): number {
  return list.filter((s) => (s.prohibited?.length ?? 0) > 0).length;
}

export function auditAll(): IndustryQuality[] {
  return INDUSTRY_IDS.map(auditIndustry);
}

function markdown(rows: IndustryQuality[]): string {
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const line = (r: IndustryQuality) =>
    `| ${r.label} | ${r.specialists} | ${r.intents} | ${r.routerRules} | ${r.knowledgeEntries} | ${r.qualificationFields} | ${r.urgencyRules} | ${r.scenarios} | ${r.hasExistingCustomerPath ? 'yes' : 'no'} | ${r.hasSafetyRule ? 'yes' : 'no'} | **${r.status}** |`;

  const priority = rows.filter((r) => PRIORITY.includes(r.id));
  const rest = rows.filter((r) => !PRIORITY.includes(r.id));
  const needs = rows.filter((r) => r.status === 'NEEDS_REFINEMENT');

  return `# Voice Agent — Industry Quality Matrix

**Generated by \`npm run voice:quality -- --write\`. Do not hand-edit.**

Computed from the code so it cannot quietly go stale. The thresholds
are deliberately unkind: a specialist that merely exists scores
NEEDS_REFINEMENT, because "the file is there" is not a claim about
whether the agent could actually hold that call.

Universal knowledge (the 15 entries every industry inherits — are-you-AI,
human request, existing customer, complaints, price pressure) is
**excluded** from the knowledge count. Only work done for that trade
counts. The same applies to escalations: the three common ones every
specialist inherits are subtracted.

**"Existing cust."** means a *scenario* exercises that path. The
handling itself is universal — every industry inherits it — so a "no"
marks an untested path, not a missing one.

**"Hard limits"** counts entries specific to that trade whose source is
\`refuse\` or \`business_config\`. The universal hard limits every
industry inherits are excluded, for the same reason as the knowledge
count.

| Status | Meaning | Count |
|---|---|---|
| STRONG | Clears every threshold, including the deeper bar for demo targets | ${count('STRONG')} |
| GOOD | One or two gaps, none critical | ${count('GOOD')} |
| NEEDS_REFINEMENT | Three or more gaps | ${count('NEEDS_REFINEMENT')} |

## Priority industries

The immediate demo and sales targets. These are held to a higher bar:
at least 9 industry knowledge entries and 4 scenarios.

| Industry | Specialists | Intents | Rules | Knowledge | Intake | Urgency | Scenarios | Existing cust. | Safety | Status |
|---|---|---|---|---|---|---|---|---|---|---|
${priority.map(line).join('\n')}

## All other industries

| Industry | Specialists | Intents | Rules | Knowledge | Intake | Urgency | Scenarios | Existing cust. | Safety | Status |
|---|---|---|---|---|---|---|---|---|---|---|
${rest.map(line).join('\n')}

## Where the work is

${needs.length === 0
  ? 'No industry currently scores NEEDS_REFINEMENT.'
  : needs
      .map((r) => `### ${r.label}\n\n${r.weaknesses.map((w) => `- ${w}`).join('\n')}`)
      .join('\n\n')}

## Everything with any gap at all

${rows.filter((r) => r.weaknesses.length > 0).length === 0
  ? 'None.'
  : rows
      .filter((r) => r.weaknesses.length > 0)
      .map((r) => `- **${r.label}** (${r.status}): ${r.weaknesses.join('; ')}`)
      .join('\n')}

## What this does not measure

The matrix counts structure, and structure is necessary rather than
sufficient. It cannot tell you whether a prompt is well written, whether
the guidance in a knowledge entry is good advice, or whether the agent
actually sounds like a receptionist. That needs
\`npm run voice:simulate\` with a real API key, and ultimately a real
call.

Treat a STRONG score as "no obvious structural gap", not as "this is
finished".
`;
}

function main(): void {
  const rows = auditAll();
  const write = process.argv.includes('--write');

  if (write) {
    const path = resolve(REPO, 'docs/voice-agent-industry-quality.md');
    writeFileSync(path, markdown(rows));
    console.log(`Wrote ${path}`);
  }

  const width = Math.max(...rows.map((r) => r.label.length));
  console.log('\nINDUSTRY QUALITY\n' + '='.repeat(width + 46));
  for (const r of rows.slice().sort((a, b) => a.status.localeCompare(b.status) || a.label.localeCompare(b.label))) {
    const mark = r.status === 'STRONG' ? '  ' : r.status === 'GOOD' ? ' ~' : ' !';
    console.log(`${mark} ${r.label.padEnd(width)}  k=${String(r.knowledgeEntries).padStart(2)} r=${String(r.routerRules).padStart(2)} s=${String(r.scenarios).padStart(2)} q=${String(r.qualificationFields).padStart(2)}  ${r.status}`);
    for (const w of r.weaknesses) console.log(`${' '.repeat(width + 5)}- ${w}`);
  }
  const counts = { STRONG: 0, GOOD: 0, NEEDS_REFINEMENT: 0 };
  for (const r of rows) counts[r.status] += 1;
  console.log('='.repeat(width + 46));
  console.log(`STRONG ${counts.STRONG}   GOOD ${counts.GOOD}   NEEDS_REFINEMENT ${counts.NEEDS_REFINEMENT}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('quality.ts')) main();
