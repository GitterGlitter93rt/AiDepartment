/**
 * Text roleplay against a real Account's Call Pack.
 *   npm run roleplay -- --account <uuid> [--scenario busy|dnc|strong|opportunity|gatekeeper]
 *
 * No number is dialled and no tool with a real-world effect is executed. This is the
 * rehearsal the state machine spec requires before any live call.
 */
import { closePool } from '../db/pool.js';
import { buildCallPack } from '../callbrain/callPack.js';
import { composeSystemPrompt, composeOpener } from '../callbrain/prompt.js';
import { createCallContext, type AvailableTools } from '../callbrain/stateMachine.js';
import { simulateCall, renderSimulation, type SimulatedTurn } from '../callbrain/simulate.js';
import { config } from '../config.js';

function arg(name: string, fallback = ''): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const SCENARIOS: Record<string, SimulatedTurn[]> = {
  opportunity: [
    { prospectSays: 'This is Dana.' },
    { prospectSays: "Honestly? After six they just go to voicemail and we pick them up in the morning." },
    { prospectSays: 'We probably get 60 calls a week, and an average job is around $450.' },
    { prospectSays: "Yeah, I've never really thought about it that way." },
    { prospectSays: 'Sure, that sounds worth a look.' },
  ],
  busy: [
    { prospectSays: "I'm with a customer right now, call me next week." },
  ],
  dnc: [
    { prospectSays: 'This is Dana.' },
    { prospectSays: 'They go to voicemail, honestly.' },
    { prospectSays: 'Take me off your list, please.' },
    { prospectSays: 'So what does it cost?' },
  ],
  strong: [
    { prospectSays: 'Speaking.' },
    { prospectSays: 'We have an answering service that picks up after hours, nothing gets missed.' },
    { prospectSays: 'And our estimates are all followed up, someone is always on that.' },
  ],
  gatekeeper: [
    { prospectSays: 'Good morning, what is this regarding?' },
    { prospectSays: 'You want to talk to Sarah Mills, she handles operations.' },
    { prospectSays: 'She is in a meeting, can I take a message?' },
  ],
  chatgpt: [
    { prospectSays: 'This is Dana.' },
    { prospectSays: 'We already use ChatGPT for that kind of thing.' },
    { prospectSays: 'Honestly nobody has really set anything up properly.' },
    { prospectSays: 'We get maybe 40 calls a week.' },
    { prospectSays: 'Okay, that would be worth talking about.' },
  ],
};

const accountId = arg('account');
if (!accountId) {
  console.error('Usage: npm run roleplay -- --account <uuid> [--scenario opportunity|busy|dnc|strong|gatekeeper|chatgpt]');
  process.exit(1);
}

const pack = await buildCallPack(accountId);
if (!pack) {
  console.error('No Call Pack could be built. The account may not exist, or it may be suppressed.');
  await closePool();
  process.exit(1);
}

// Tool availability reflects reality: no calendar credentials means no booking tool,
// and the agent is told so rather than allowed to improvise.
const tools: AvailableTools = {
  booking: config.booking.isConfigured,
  suppression: true,
  followUp: true,
  transfer: false,
  sms: false,
  email: config.outbound.emailEnabled,
};

const agentName = arg('agent', 'Alex');
const scenarioName = arg('scenario', 'opportunity');
const turns = SCENARIOS[scenarioName];
if (!turns) {
  console.error(`Unknown scenario. Available: ${Object.keys(SCENARIOS).join(', ')}`);
  await closePool();
  process.exit(1);
}

console.log('='.repeat(78));
console.log('RUNTIME PROMPT (opening state)');
console.log('='.repeat(78));
const context = createCallContext(tools, pack.primaryHypothesis);
context.state = 'hook';
console.log(composeSystemPrompt({ pack, context, agentName, tools }));

console.log();
console.log('='.repeat(78));
console.log(`ROLEPLAY — scenario: ${scenarioName}`);
console.log('='.repeat(78));
console.log(`  AGENT     ${composeOpener(pack, agentName)}`);
const result = simulateCall({ pack, tools, turns, agentName });
console.log(renderSimulation(result, pack));
console.log();
console.log('No number was dialled and no real-world action was taken.');
await closePool();
