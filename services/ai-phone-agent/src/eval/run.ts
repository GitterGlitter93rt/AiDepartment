#!/usr/bin/env node
// Live-model evaluation.
//
//   npm run voice:eval -- --priority        # the 35 priority cases
//   npm run voice:eval -- --case HALLUC_PRICE
//   npm run voice:eval -- --industry plumbing
//   npm run voice:eval -- --all
//   npm run voice:eval -- --priority --judge
//   npm run voice:eval -- --all --estimate  # cost only, no requests
//
// Requires ANTHROPIC_API_KEY. Nothing in `npm test` runs this, and
// nothing here runs by accident: without an explicit selection flag it
// prints usage and exits.
//
// Results land in eval-results/, which is gitignored. Fixture callers
// only — no real caller data ever reaches this directory.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Orchestrator } from '../core/orchestrator.ts';
import { SessionStore } from '../core/session.ts';
import { createClaudeClient } from '../claude/client.ts';
import { createLogger, type LogEvent } from '../logger.ts';
import { resolveModels } from '../claude/models.ts';
import { createMockCalendar } from '../tools/calendar.ts';
import { createMockSms } from '../tools/sms.ts';
import { createTransferTool } from '../tools/transfer.ts';
import { createPlaceholderCrm } from '../tools/crm.ts';
import { buildCallSummary } from '../core/call-summary.ts';
import { selectSpecialist } from '../industries/index.ts';
import { scoreConversation, type Finding, type TurnPair } from './rubric.ts';
import { judgeConversation, type JudgeScore } from './judge.ts';
import { EVAL_CASES, estimateRequests, type EvalCase } from './cases.ts';
import type { Toolbox } from '../tools/index.ts';
import { createMockTow, createMockEsign, createMockUploadLink, createMockReferral } from '../tools/actions.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(HERE, '../../eval-results');

export interface EvalResult {
  id: string;
  purpose: string;
  industry: string;
  routed: { industry: string | null; specialty: string | null; intent: string | null; confidence: number; source: string };
  turns: (TurnPair & { ms: number; words: number })[];
  toolsRequested: string[];
  toolsSucceeded: string[];
  finalState: { contact: Record<string, unknown>; qualification: Record<string, unknown>; summary: string };
  findings: Finding[];
  judge: JudgeScore | null;
  passed: boolean;
  totalMs: number;
  usage: { requests: number; inputTokens: number; outputTokens: number };
}

/**
 * Toolbox with one adapter forced to fail.
 *
 * Tool truthfulness cannot be evaluated on a happy path — the
 * interesting question is what the agent says when the calendar is
 * down, and the only way to find out is to break it.
 */
function toolbox(fail?: EvalCase['toolFailure']): Toolbox {
  const boom = (what: string) => async (): Promise<never> => { throw new Error(`${what} unavailable (forced by eval)`); };
  return {
    calendar: fail === 'calendar'
      ? { checkAvailability: boom('calendar'), bookAppointment: boom('calendar') }
      : createMockCalendar(),
    sms: fail === 'sms' ? { send: boom('sms') } : createMockSms(),
    // An empty transfer number is the realistic failure: a deployment
    // that never configured one.
    transfer: createTransferTool(fail === 'transfer' ? '' : '+19045550100'),
    crm: fail === 'crm' ? { pushLead: boom('crm') } : createPlaceholderCrm(),
    tow: createMockTow(), esign: createMockEsign(),
    uploadLink: createMockUploadLink(), referral: createMockReferral(),
    modes: { calendar: 'mock', sms: 'mock', tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock' },
  };
}

export async function runCase(
  evalCase: EvalCase,
  opts: { apiKey: string; judge: boolean; verbose: boolean },
): Promise<EvalResult> {
  const sessions = new SessionStore();
  const models = resolveModels();
  const claude = createClaudeClient(opts.apiKey, models.specialist.model);
  const events: { event: LogEvent; data: Record<string, unknown> }[] = [];
  const log = createLogger({}, (line) => {
    const p = JSON.parse(line) as { event: LogEvent } & Record<string, unknown>;
    events.push({ event: p.event, data: p });
  });

  const orch = new Orchestrator({ sessions, claude, log, tools: toolbox(evalCase.toolFailure) });
  const callSid = `EVAL_${evalCase.id}`;
  const turns: (TurnPair & { ms: number; words: number })[] = [];
  const started = Date.now();

  if (evalCase.context) {
    await orch.handleCallerUtterance(callSid, evalCase.context);
  }

  for (const caller of [evalCase.opening, ...(evalCase.followUps ?? [])]) {
    const t0 = Date.now();
    const agent = await orch.handleCallerUtterance(callSid, caller);
    turns.push({ caller, agent, ms: Date.now() - t0, words: agent.trim().split(/\s+/).filter(Boolean).length });
    if (opts.verbose) {
      console.log(`\n  CALLER: ${caller}`);
      console.log(`  AGENT:  ${agent}`);
    }
  }

  const session = sessions.get(callSid)!;
  const spec = selectSpecialist(session);
  const rubric = scoreConversation({ scenario: evalCase, turns, session });

  let judge: JudgeScore | null = null;
  if (opts.judge) {
    const r = await judgeConversation(claude, evalCase, turns, models.summary.model);
    judge = r.score;
  }

  return {
    id: evalCase.id,
    purpose: evalCase.purpose,
    industry: evalCase.industry,
    routed: {
      industry: session.route.industry, specialty: session.route.specialty,
      intent: session.route.intent, confidence: Number(session.route.confidence.toFixed(2)),
      source: session.route.source,
    },
    turns,
    toolsRequested: events.filter((e) => e.event === 'tool.requested').map((e) => String(e.data.tool)),
    toolsSucceeded: session.toolCalls.filter((t) => t.ok).map((t) => t.name),
    finalState: {
      contact: { ...session.contact },
      qualification: { ...session.qualification },
      summary: buildCallSummary(session, spec?.qualificationSchema.map((f) => f.key) ?? []).headline,
    },
    findings: rubric.findings,
    judge,
    passed: rubric.passed && (judge === null || (!judge.hallucination && judge.toolTruthfulness && judge.safety >= 4)),
    totalMs: Date.now() - started,
    usage: { requests: orch.usage.requests, inputTokens: orch.usage.inputTokens, outputTokens: orch.usage.outputTokens },
  };
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

function select(): EvalCase[] {
  const one = arg('case');
  if (one) return EVAL_CASES.filter((c) => c.id === one.toUpperCase());
  const industry = arg('industry');
  if (industry) return EVAL_CASES.filter((c) => c.industry === industry);
  if (has('priority')) return EVAL_CASES.filter((c) => c.tier === 'priority');
  if (has('all')) return EVAL_CASES;
  return [];
}

const USAGE = `
Live-model evaluation. Costs real API requests.

  npm run voice:eval -- --priority          the ${EVAL_CASES.filter((c) => c.tier === 'priority').length} priority cases
  npm run voice:eval -- --all               all ${EVAL_CASES.length} cases
  npm run voice:eval -- --industry plumbing one industry
  npm run voice:eval -- --case HALLUC_PRICE one case

  --judge      also score naturalness with a second model (more requests)
  --estimate   print the request estimate and exit, sending nothing
  --quiet      suppress transcripts

Requires ANTHROPIC_API_KEY. Nothing here runs during npm test.
`;

async function main(): Promise<void> {
  const cases = select();
  if (cases.length === 0) {
    console.log(USAGE);
    process.exit(arg('case') || arg('industry') ? 1 : 0);
  }

  const judge = has('judge');
  const estimate = estimateRequests(cases, judge);

  console.log(`\n${cases.length} case(s), roughly ${estimate} model requests${judge ? ' (including the judge)' : ''}.`);
  if (has('estimate')) {
    console.log('Estimate only — nothing sent.\n');
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('\nANTHROPIC_API_KEY is not set. Live evaluation needs it; everything else in this repo does not.\n');
    process.exit(1);
  }

  // A guard against a mistyped flag turning into a large bill.
  if (estimate > 250 && !has('yes')) {
    console.error(`\nThat is over 250 requests. Re-run with --yes if you meant it.\n`);
    process.exit(1);
  }

  const verbose = !has('quiet');
  const results: EvalResult[] = [];

  for (const [i, c] of cases.entries()) {
    console.log('\n' + '='.repeat(72));
    console.log(`[${i + 1}/${cases.length}] ${c.id}  —  ${c.purpose}`);
    console.log('='.repeat(72));
    try {
      const r = await runCase(c, { apiKey, judge, verbose });
      results.push(r);
      report(r);
    } catch (err) {
      console.error(`  ERROR: ${String(err).slice(0, 200)}`);
    }
  }

  writeResults(results);
  summarise(results);
}

function report(r: EvalResult): void {
  console.log(`\n  ROUTING: ${r.routed.industry}/${r.routed.specialty}/${r.routed.intent} @ ${r.routed.confidence} (${r.routed.source})`);
  console.log(`  TOOLS:   requested [${r.toolsRequested.join(', ') || 'none'}]  succeeded [${r.toolsSucceeded.join(', ') || 'none'}]`);
  console.log(`  CAPTURED: ${Object.keys(r.finalState.contact).join(', ') || 'nothing'}`);
  console.log(`  TIMING:  ${r.totalMs}ms, ${Math.round(r.totalMs / Math.max(1, r.turns.length))}ms/turn`);
  console.log(`  TOKENS:  ${r.usage.inputTokens} in / ${r.usage.outputTokens} out over ${r.usage.requests} requests`);
  const longest = Math.max(...r.turns.map((t) => t.words));
  console.log(`  LENGTH:  longest reply ${longest} words`);

  if (r.judge) {
    console.log(`  JUDGE:   naturalness ${r.judge.naturalness}/5  relevance ${r.judge.relevance}/5  safety ${r.judge.safety}/5`);
    if (r.judge.notes) console.log(`           "${r.judge.notes}"`);
  }

  if (r.findings.length === 0) {
    console.log('  RESULT:  clean');
    return;
  }
  console.log('  FINDINGS:');
  for (const f of r.findings) {
    const mark = f.severity === 'critical' ? '!!' : f.severity === 'major' ? ' !' : '  ';
    console.log(`   ${mark} [${f.dimension}]${f.turn ? ` turn ${f.turn}` : ''} ${f.detail}`);
    if (f.quote) console.log(`        "${f.quote}"`);
  }
}

function writeResults(results: EvalResult[]): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = resolve(RESULTS_DIR, `eval-${stamp}.json`);
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));

  // A readable transcript alongside the JSON, because reading
  // conversations is how you actually find what is wrong.
  const md = results.map((r) => [
    `## ${r.id} — ${r.passed ? 'PASS' : 'FAIL'}`,
    `*${r.purpose}*`,
    '',
    `Routed: \`${r.routed.industry}/${r.routed.specialty}/${r.routed.intent}\` @ ${r.routed.confidence} (${r.routed.source})`,
    `Tools succeeded: ${r.toolsSucceeded.join(', ') || 'none'}`,
    `Captured: ${Object.keys(r.finalState.contact).join(', ') || 'nothing'}`,
    '',
    ...r.turns.flatMap((t) => [`**Caller:** ${t.caller}`, '', `**Agent** (${t.words}w): ${t.agent}`, '']),
    r.findings.length ? '### Findings\n' + r.findings.map((f) => `- **${f.severity}** \`${f.dimension}\` ${f.detail}${f.quote ? ` — "${f.quote}"` : ''}`).join('\n') : '_No findings._',
    r.judge ? `\n### Judge\nnaturalness ${r.judge.naturalness}/5, relevance ${r.judge.relevance}/5, safety ${r.judge.safety}/5 — ${r.judge.notes}` : '',
    '',
  ].join('\n')).join('\n---\n\n');
  writeFileSync(resolve(RESULTS_DIR, `eval-${stamp}.md`), `# Live evaluation — ${new Date().toISOString()}\n\n${md}`);

  console.log(`\nWrote ${path}`);
  console.log(`Wrote ${path.replace(/\.json$/, '.md')}  (read this one)`);
}

function summarise(results: EvalResult[]): void {
  const failed = results.filter((r) => !r.passed);
  const criticals = results.flatMap((r) => r.findings.filter((f) => f.severity === 'critical'));

  console.log('\n' + '='.repeat(72));
  console.log(`${results.length - failed.length}/${results.length} passed`);

  if (criticals.length) {
    console.log(`\n${criticals.length} CRITICAL finding(s) — these are what a prospect would notice:`);
    const byDim = new Map<string, number>();
    for (const f of criticals) byDim.set(f.dimension, (byDim.get(f.dimension) ?? 0) + 1);
    for (const [dim, n] of [...byDim].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${dim}`);
    }
  }

  const totalIn = results.reduce((n, r) => n + r.usage.inputTokens, 0);
  const totalOut = results.reduce((n, r) => n + r.usage.outputTokens, 0);
  console.log(`\nTokens: ${totalIn} in / ${totalOut} out`);
  console.log('='.repeat(72) + '\n');

  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('run.ts') && process.argv[1].includes('eval')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
