// What we actually send Claude on one ordinary turn, block by block.
//
// Reads the prompt out of the orchestrator's own assembly rather than
// rebuilding it, so the report cannot drift away from what production
// sends. Token figures are an estimate at ~3.6 chars/token — close
// enough to rank the blocks, which is what this is for; the exact
// count comes back from the API in llm.usage.
//
//   node --experimental-strip-types tools/token-budget.mts
//   node --experimental-strip-types tools/token-budget.mts real_estate

import { Orchestrator } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { selectSpecialist } from '../src/industries/index.ts';
import { toolsFor } from '../src/core/tool-protocol.ts';
import { createLogger } from '../src/logger.ts';
import { demoProfile } from '../src/business/profile.ts';
import { createMockToolbox } from '../src/tools/index.ts';
import type { Industry } from '../src/core/taxonomy.ts';

const CHARS_PER_TOKEN = 3.6;
const tok = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

const industry = (process.argv[2] ?? 'collision_repair') as Industry;

const SCRIPTS: Record<string, { said: string[]; intent: string }> = {
  collision_repair: {
    intent: 'estimate_request',
    said: ['I wrecked my BMW and I need to get it fixed', "No, it won't drive"],
  },
  attorneys: {
    intent: 'personal_injury',
    said: ['I was rear-ended this morning and my neck hurts. I have not seen a doctor yet.'],
  },
  real_estate: {
    intent: 'showing_request',
    said: ['I want to see one of your listings', 'The listing at 123 Main Street'],
  },
};
const script = SCRIPTS[industry] ?? SCRIPTS.collision_repair;

const sessions = new SessionStore();
const log = createLogger({}, () => {});
const orchestrator = new Orchestrator({
  sessions, claude: null, log,
  tools: createMockToolbox(),
  resolveProfile: (i) => demoProfile((i ?? 'professional_services') as never, { mode: 'demo' }),
});

const callSid = 'CAbudget';
const session = sessions.ensure(callSid, '+19045551234', '+19046829345');
session.route = {
  industry, specialty: industry, intent: script.intent,
  urgency: 'normal', confidence: 0.95, source: 'heuristic',
} as typeof session.route;
for (const [i, said] of script.said.entries()) {
  sessions.addTurn(callSid, 'caller', said);
  if (i < script.said.length - 1) sessions.addTurn(callSid, 'agent', 'Understood. Where is the vehicle now?');
}

const spec = selectSpecialist(session);
const { system, blocks, cachedSystemPrefix } = orchestrator.buildSystemPrompt(session, spec);

const toolSchemas = toolsFor(session.route.industry, session.demoPhase, session);
const toolChars = JSON.stringify(toolSchemas).length;
const historyChars = session.turns.reduce((n, t) => n + t.text.length, 0);

console.log(`\nTOKEN BUDGET — ${industry} / ${script.intent}, turn ${script.said.length}\n`);
console.log('BLOCK                            CHARS     ~TOK    SHARE');
console.log('-'.repeat(58));

const rows = [
  ...blocks.map(([name, text]) => [name, text.length] as [string, number]),
  [`tool schemas (${(toolSchemas as unknown[]).length})`, toolChars] as [string, number],
  ['message history', historyChars] as [string, number],
];
const total = rows.reduce((n, [, c]) => n + c, 0);
for (const [name, chars] of rows.sort((a, b) => b[1] - a[1])) {
  const share = ((chars / total) * 100).toFixed(1);
  const bar = '#'.repeat(Math.round((chars / total) * 30));
  console.log(`${name.padEnd(30)}${String(chars).padStart(7)}${String(tok(chars)).padStart(9)}${share.padStart(7)}%  ${bar}`);
}
console.log('-'.repeat(58));
console.log(`${'TOTAL'.padEnd(30)}${String(total).padStart(7)}${String(tok(total)).padStart(9)}`);
console.log(`\nsystem prompt alone: ${system.length} chars (~${tok(system.length)} tok)`);
console.log(`tool schemas:        ${toolChars} chars (~${tok(toolChars)} tok)`);

// What the cache actually covers. Tool definitions sit ahead of the
// system prompt in the cached prefix, so both count.
const cachedChars = cachedSystemPrefix.length + toolChars;
const freshChars = total - cachedChars;
console.log('');
console.log(`cached prefix:       ${cachedChars} chars (~${tok(cachedChars)} tok)  ${((cachedChars / total) * 100).toFixed(0)}% of payload`);
console.log(`fresh each turn:     ${freshChars} chars (~${tok(freshChars)} tok)`);
console.log(`\nAfter turn 1, ~${tok(freshChars)} tokens are processed fresh; the rest is a cache read.`);
