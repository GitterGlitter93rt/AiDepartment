#!/usr/bin/env node
// Simulated caller harness.
//
//   npm run voice:simulate                    # every scenario
//   npm run voice:simulate -- --scenario DIVORCE_01
//   npm run voice:simulate -- --industry plumbing
//   npm run voice:simulate -- --check         # assertions only, terse
//
// Runs scenarios against the real orchestrator with no Twilio and no
// phone. With ANTHROPIC_API_KEY set it uses the real model, which is
// the point — this is how you find out whether the brain is any good
// before a prospect does. Without a key it still exercises routing,
// knowledge matching, guardrails and state, so it is useful in CI.

import { Orchestrator } from '../core/orchestrator.ts';
import { SessionStore } from '../core/session.ts';
import { createClaudeClient } from '../claude/client.ts';
import { createLogger } from '../logger.ts';
import { createMockCalendar } from '../tools/calendar.ts';
import { createMockSms } from '../tools/sms.ts';
import { createTransferTool } from '../tools/transfer.ts';
import { createPlaceholderCrm } from '../tools/crm.ts';
import { buildCallSummary } from '../core/call-summary.ts';
import { selectSpecialist } from '../industries/index.ts';
import { SCENARIOS, NEVER_SAY, type Scenario } from './scenarios.ts';
import type { Toolbox } from '../tools/index.ts';

export interface TurnRecord {
  caller: string;
  agent: string;
  ms: number;
}

export interface SimResult {
  scenario: Scenario;
  turns: TurnRecord[];
  industry: string | null;
  specialty: string | null;
  intent: string | null;
  confidence: number;
  routingSource: string;
  toolCalls: string[];
  /** Assertion failures. Empty means the scenario passed. */
  violations: string[];
  totalMs: number;
}

function tools(): Toolbox {
  return {
    calendar: createMockCalendar(),
    sms: createMockSms(),
    transfer: createTransferTool('+19045550100'),
    crm: createPlaceholderCrm(),
    modes: { calendar: 'mock', sms: 'mock' },
  };
}

export async function runScenario(scenario: Scenario, opts: { verbose?: boolean } = {}): Promise<SimResult> {
  const sessions = new SessionStore();
  const key = process.env.ANTHROPIC_API_KEY;
  const claude = key ? createClaudeClient(key, process.env.CLAUDE_MODEL || 'claude-sonnet-5') : null;
  const log = createLogger({}, () => {});
  const orch = new Orchestrator({ sessions, claude, log, tools: tools() });

  const callSid = `SIM_${scenario.id}`;
  const turns: TurnRecord[] = [];
  const started = Date.now();

  // The establishing turn runs but is not scored: it exists so the
  // question under test is asked where a caller would really ask it.
  if (scenario.context) {
    const agent = await orch.handleCallerUtterance(callSid, scenario.context);
    if (opts.verbose) {
      console.log(`\nCALLER: ${scenario.context}   [context]`);
      console.log(`AGENT:  ${agent}`);
    }
  }

  for (const caller of [scenario.opening, ...(scenario.followUps ?? [])]) {
    const t0 = Date.now();
    const agent = await orch.handleCallerUtterance(callSid, caller);
    turns.push({ caller, agent, ms: Date.now() - t0 });
    if (opts.verbose) {
      console.log(`\nCALLER: ${caller}`);
      console.log(`AGENT:  ${agent}`);
    }
  }

  const session = sessions.get(callSid)!;
  const spec = selectSpecialist(session);
  const summary = buildCallSummary(session, spec?.qualificationSchema.map((f) => f.key) ?? []);

  return {
    scenario,
    turns,
    industry: session.route.industry,
    specialty: session.route.specialty,
    intent: session.route.intent,
    confidence: session.route.confidence,
    routingSource: session.route.source,
    toolCalls: session.toolCalls.map((t) => t.name),
    violations: check(scenario, turns, session.route.industry, !!claude),
    totalMs: Date.now() - started,
  };
}

function check(
  scenario: Scenario,
  turns: TurnRecord[],
  industry: string | null,
  live: boolean,
): string[] {
  const problems: string[] = [];
  const all = turns.map((t) => t.agent).join('\n');

  if (industry !== scenario.industry) {
    problems.push(`routed to ${industry ?? 'nothing'}, expected ${scenario.industry}`);
  }

  // Content assertions only mean something when a real model spoke.
  // Without a key the replies are fixed fallback copy, which would
  // trivially "pass" the prohibitions and fail the expectations.
  if (!live) return problems;

  for (const re of NEVER_SAY) {
    const m = all.match(re);
    if (m) problems.push(`said something no agent should ever say: "${m[0]}" (${re})`);
  }
  for (const re of scenario.prohibited ?? []) {
    const m = all.match(re);
    if (m) problems.push(`prohibited for this scenario: "${m[0]}" (${re})`);
  }
  for (const re of scenario.expectMentions ?? []) {
    if (!re.test(all)) problems.push(`never mentioned ${re}`);
  }

  // Phone-length discipline: a reply that runs long gets talked over.
  turns.forEach((t, i) => {
    const words = t.agent.split(/\s+/).length;
    if (words > 90) problems.push(`turn ${i + 1} ran to ${words} words — too long to say on a phone`);
  });

  return problems;
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const only = arg('scenario');
  const industry = arg('industry');
  const checkOnly = process.argv.includes('--check');

  let selected = SCENARIOS;
  if (only) selected = selected.filter((s) => s.id === only.toUpperCase());
  if (industry) selected = selected.filter((s) => s.industry === industry);

  if (selected.length === 0) {
    console.error(`No scenarios matched. Try one of:\n  ${SCENARIOS.map((s) => s.id).join('\n  ')}`);
    process.exit(1);
  }

  const live = !!process.env.ANTHROPIC_API_KEY;
  console.log(`\n${selected.length} scenario(s) — ${live ? 'LIVE model' : 'NO API KEY (routing and guardrails only)'}\n`);

  const results: SimResult[] = [];
  for (const scenario of selected) {
    if (!checkOnly) {
      console.log('='.repeat(72));
      console.log(`${scenario.id}  →  expecting ${scenario.industry}${scenario.specialty ? '/' + scenario.specialty : ''}`);
      if (scenario.note) console.log(`  (${scenario.note})`);
      console.log('='.repeat(72));
    }
    const r = await runScenario(scenario, { verbose: !checkOnly });
    results.push(r);

    if (!checkOnly) {
      console.log(`\n  ROUTING: ${r.industry}/${r.specialty}/${r.intent} @ ${r.confidence.toFixed(2)} (${r.routingSource})`);
      console.log(`  TOOLS:   ${r.toolCalls.length ? r.toolCalls.join(', ') : 'none'}`);
      console.log(`  TIMING:  ${r.totalMs}ms total, ${Math.round(r.totalMs / r.turns.length)}ms/turn`);
      console.log(r.violations.length ? `  ISSUES:\n${r.violations.map((v) => `    ✗ ${v}`).join('\n')}` : '  ISSUES:  none');
      console.log();
    } else {
      const mark = r.violations.length === 0 ? 'ok  ' : 'FAIL';
      console.log(`${mark} ${r.scenario.id.padEnd(28)} ${r.industry ?? 'null'}`);
      for (const v of r.violations) console.log(`       ✗ ${v}`);
    }
  }

  const failed = results.filter((r) => r.violations.length > 0);
  console.log('-'.repeat(72));
  console.log(`${results.length - failed.length}/${results.length} clean` + (failed.length ? `; ${failed.length} with issues` : ''));
  if (failed.length) process.exitCode = 1;
}

// Only run the CLI when invoked directly, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('run.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
