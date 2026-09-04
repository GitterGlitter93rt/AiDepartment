import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPriorityIntent } from '../src/callbrain/intent.js';
import { simulateCall, type SimulatedTurn } from '../src/callbrain/simulate.js';
import { composeSystemPrompt, composeOpener, composeGatekeeperLine, composeVoicemail } from '../src/callbrain/prompt.js';
import { createCallContext, type AvailableTools } from '../src/callbrain/stateMachine.js';
import type { CallPack } from '../src/callbrain/callPack.js';

/**
 * Cold-call brain.
 * Authority: module-04a-cold-calling-and-prospecting.md,
 * conversation-state-machine.md (its §31–§35 transition tests are implemented below),
 * priority-intent-detector-spec.md.
 */

const FULL_TOOLS: AvailableTools = {
  booking: true, suppression: true, followUp: true, transfer: false, sms: false, email: true,
};

function pack(overrides: Partial<CallPack> = {}): CallPack {
  return {
    callPackId: null,
    accountId: 'acct-1',
    companyName: 'Northgate Air & Heating',
    geography: 'Jacksonville, FL',
    vertical: 'hvac',
    contactName: 'Dana Fielder',
    contactTitle: 'Director of Operations',
    contactIsRoleOnly: false,
    askForRoute: null,
    confirmedFacts: [
      { claim: 'Site advertises 24/7 emergency service', source: 'company_website', observedAt: new Date(), canStateAsFact: true },
    ],
    importantUnknowns: ['crm provider — suspected, not confirmed; ask rather than assert'],
    primaryHypothesis: 'Paid emergency demand may arrive outside staffed hours.',
    primaryHypothesisCategory: 'after_hours',
    backupHypothesis: 'Unsold replacement estimates may not be followed up consistently.',
    firstQuestion: 'When an emergency call comes in after hours and everyone is already on a job, what happens to it?',
    backupQuestion: 'What happens to a replacement quote that does not close the first time?',
    likelyObjections: [],
    knownSystems: [],
    prohibitedClaims: [
      'Do not state or estimate their advertising spend.',
      'Do not position this as replacing or reducing their staff.',
    ],
    allowedNextSteps: ['Book a short strategy call with Michael'],
    commercialTruth: 'No pricing or packaged solution on a cold call.',
    ...overrides,
  };
}

const say = (text: string): SimulatedTurn => ({ prospectSays: text });

// --- priority intents --------------------------------------------------------

test('explicit stop-contacting language is detected as DNC', () => {
  for (const utterance of [
    "Don't call me again.",
    'Take me off your list.',
    'Stop calling this number.',
    'Remove me from your call list.',
    'Do not contact us anymore.',
    'Put me on your do not call list.',
  ]) {
    const intent = detectPriorityIntent(utterance);
    assert.equal(intent?.type, 'DNC', `"${utterance}" must be DNC`);
    assert.equal(intent?.requiresImmediateAudioStop, true);
    assert.equal(intent?.deterministicAction, 'suppress_and_end');
  }
});

test('a timing objection is not treated as a do-not-contact request', () => {
  for (const utterance of [
    "Don't call me right now, call Friday.",
    "I'm busy — call next week.",
    'Not today.',
    'Try me again tomorrow.',
    "I'm with a customer.",
  ]) {
    const intent = detectPriorityIntent(utterance);
    assert.notEqual(intent?.type, 'DNC', `"${utterance}" must not suppress the account`);
    if (intent) assert.equal(intent.type, 'CALLBACK_TIMING');
  }
});

test('a stop request wins even when wrapped in timing language', () => {
  const intent = detectPriorityIntent("Don't call me right now — actually, don't call me again, ever.");
  assert.equal(intent?.type, 'DNC');
});

test('wrong number, hostility and hang-up are each detected', () => {
  assert.equal(detectPriorityIntent('You have the wrong number.')?.type, 'WRONG_NUMBER');
  assert.equal(detectPriorityIntent("There's nobody here by that name.")?.type, 'WRONG_NUMBER');
  assert.equal(detectPriorityIntent('This is harassment.')?.type, 'HOSTILE');
  assert.equal(detectPriorityIntent("I'm hanging up.")?.type, 'END_CALL');
  assert.equal(detectPriorityIntent('Can I speak to a real person?')?.type, 'HUMAN_REQUESTED');
});

test('ordinary conversation triggers no priority intent', () => {
  for (const utterance of [
    'Yeah, they usually go to voicemail.',
    'We get about 40 calls a week.',
    'What is this regarding?',
    'We already have a CRM.',
  ]) {
    assert.equal(detectPriorityIntent(utterance), null, `"${utterance}" is normal conversation`);
  }
});

// --- state machine transition tests, from the spec ---------------------------

test('§31 a strong process disqualifies after ONE backup, with no third product hunt', () => {
  const result = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [
      say('Speaking.'),
      say('We have an answering service that picks up after hours, so nothing gets missed.'),
      say('And our estimates are all followed up — someone is always on that.'),
      say('Anything else?'),
    ],
  });

  assert.equal(result.finalState, 'terminal');
  assert.equal(result.terminalReason, 'disqualified');
  assert.equal(result.disposition, 'NOT_A_FIT');
  assert.equal(result.contradicted.length >= 1, true, 'the primary hypothesis is marked contradicted');
  // The point of the test: it stopped rather than hunting for a third problem.
  assert.equal(
    result.steps.filter((s) => s.state === 'hook').length <= 2, true,
    'at most one backup hypothesis is attempted',
  );
});

test('§32 a busy owner gets one question, then a callback — not prolonged discovery', () => {
  const result = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [
      say("I'm busy right now, call me next week."),
    ],
  });
  assert.ok(result.actionsTaken.includes('create_follow_up'), 'a callback is arranged');
  assert.equal(
    result.steps.filter((s) => ['discovery', 'probe', 'quantify'].includes(s.state)).length, 0,
    'no discovery is forced on someone who said they are busy',
  );
});

test('§33 a DNC during positioning stops everything and never returns to selling', () => {
  const result = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [
      say('Speaking.'),
      say('Honestly, they mostly go to voicemail after six.'),
      say('We get maybe 40 calls a week.'),
      say('Yeah that sounds about right.'),
      say('Actually, take me off your list.'),
      say('So how does that work then?'),   // must be ignored — the call is over
    ],
  });

  assert.equal(result.terminalReason, 'dnc');
  assert.equal(result.disposition, 'DO_NOT_CONTACT');
  assert.ok(result.actionsTaken.includes('suppress'));
  assert.ok(result.actionsTaken.includes('stop_audio'));

  const dncIndex = result.steps.findIndex((s) => s.state === 'terminal');
  const after = result.steps.slice(dncIndex + 1);
  assert.equal(after.length, 0, 'nothing happens after the call goes terminal');

  const dncStep = result.steps[dncIndex]!;
  assert.match(dncStep.agentMustSay ?? '', /take this number off our list/i);
  assert.doesNotMatch(dncStep.agentMustSay ?? '', /before I go|one more|quick question/i,
    'no last pitch on the way out');
});

test('§34 a booking failure is recorded as a callback, never as a scheduled meeting', () => {
  const result = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [
      say('Speaking.'),
      say('Honestly, after hours they just go to voicemail.'),
      say('We do about 60 calls a week.'),
      say('Yeah, that is a fair point.'),
      say('Sure, that sounds good.'),
      { event: { type: 'tool_result', toolName: 'book_strategy_call', toolOk: false } },
    ],
  });

  assert.equal(result.disposition, 'CALLBACK_REQUESTED',
    'a failed booking must not be dispositioned as a scheduled meeting');
  assert.notEqual(result.disposition, 'MEETING_SCHEDULED');
  assert.ok(result.actionsTaken.includes('create_follow_up'));
  const failureStep = result.steps.find((s) => s.agentMustSay?.includes('tentative'));
  assert.ok(failureStep, 'the agent is given tentative wording to say');
  assert.doesNotMatch(failureStep!.agentMustSay!, /you'?re (?:all )?(?:set|booked|confirmed)/i);
  assert.ok(result.overrides.some((o) => /booking failed/i.test(o)));
});

test('§35 the wrong person at the right company is a productive routing outcome', () => {
  const result = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [
      say('This is the front desk, can I ask what this is regarding?'),
      say('You want to talk to Sarah Mills, she handles all of that.'),
    ],
  });
  assert.ok(result.actionsTaken.includes('capture_correction'));
  assert.notEqual(result.terminalReason, 'disqualified');
});

// --- doctrine ----------------------------------------------------------------

test('a booking is never offered when the calendar is unavailable', () => {
  const noBooking: AvailableTools = { ...FULL_TOOLS, booking: false };
  const result = simulateCall({
    pack: pack(), tools: noBooking,
    turns: [
      say('Speaking.'),
      say('They go to voicemail, honestly.'),
      say('Maybe 50 calls a week.'),
      say('That is fair.'),
      say('Yeah, sure, set something up.'),
    ],
  });

  assert.equal(result.actionsTaken.includes('offer_booking'), false,
    'no booking is offered without a booking tool');
  assert.ok(result.actionsTaken.includes('create_follow_up'));
  assert.equal(result.disposition, 'CALLBACK_REQUESTED');
  assert.ok(result.overrides.some((o) => /no booking tool/i.test(o)));
});

test('a transfer is never promised without a transfer destination', () => {
  const result = simulateCall({
    pack: pack(), tools: { ...FULL_TOOLS, transfer: false },
    turns: [say('Can I speak to a real person?')],
  });
  assert.equal(result.actionsTaken.includes('route_to_human'), false);
  assert.ok(result.actionsTaken.includes('create_follow_up'));
  assert.ok(result.overrides.some((o) => /no transfer destination/i.test(o)));
});

test('discovery stops at the ceiling instead of interrogating', () => {
  const result = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [
      say('Speaking.'),
      say('It depends really.'),
      say('Sometimes one of the guys picks it up.'),
      say('Hard to say.'),
      say('I suppose so.'),
      say('Maybe.'),
    ],
  });
  const discoverySteps = result.steps.filter((s) => ['probe', 'discovery', 'listen'].includes(s.state));
  assert.ok(discoverySteps.length <= 4, 'the call does not become an interrogation');
});

test("numbers are captured only when the prospect volunteers them", () => {
  const result = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [
      say('Speaking.'),
      say('They go to voicemail after six, honestly.'),
      say('We get about 40 calls a week and the average job is around $450.'),
    ],
  });
  const labels = result.economicInputs.map((input) => input.label);
  assert.ok(labels.includes('call_volume'));
  assert.ok(labels.includes('job_value'));
  assert.ok(result.economicInputs.every((input) => /\d/.test(input.value)),
    'every captured number is one they actually said');
});

test('a named system is captured only when the prospect names it', () => {
  const withSystem = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [say('Speaking.'), say('Everything sits in ServiceTitan but nobody really works the follow-ups.')],
  });
  assert.deepEqual(withSystem.systemsNamed, ['servicetitan']);

  const withoutSystem = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [say('Speaking.'), say('We have software for it.')],
  });
  assert.deepEqual(withoutSystem.systemsNamed, [], 'no CRM is inferred from a vague mention');

  // Regression: substring matching read "sage" out of "message".
  const messageOnly = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [say('Can I take a message?'), say('She is out today.')],
  });
  assert.deepEqual(messageOnly.systemsNamed, [], '"message" is not the Sage accounting system');
});

test('a gatekeeper who will not route is left professionally, not worn down', () => {
  const result = simulateCall({
    pack: pack(), tools: FULL_TOOLS,
    turns: [
      say('What is this regarding?'),
      say("He's not available."),
      say("I'll take a message."),
      say("He's still not available."),
    ],
  });
  assert.equal(result.terminalReason, 'completed');
  assert.equal(result.disposition, 'GATEKEEPER');
  assert.ok(result.actionsTaken.includes('create_follow_up'));
});

// --- prompt composition ------------------------------------------------------

test('the prompt carries doctrine, the hypothesis and the prohibitions', () => {
  const context = createCallContext(FULL_TOOLS, 'after_hours');
  context.state = 'hook';
  const prompt = composeSystemPrompt({ pack: pack(), context, agentName: 'Alex', tools: FULL_TOOLS });

  assert.match(prompt, /Do not lead with AI/);
  assert.match(prompt, /honesty is the pattern interrupt/i);
  assert.match(prompt, /never claim a referral/i);
  assert.match(prompt, /Paid emergency demand may arrive outside staffed hours/);
  assert.match(prompt, /This is a hypothesis, not a fact/);
  assert.match(prompt, /When an emergency call comes in after hours/);
  assert.match(prompt, /Do not state or estimate their advertising spend/);
  assert.match(prompt, /not trying to replace your staff/i);
  // It must admit to being an AI when asked.
  assert.match(prompt, /Never claim to be human/);
  // And it must not contain the whole manual.
  assert.ok(prompt.length < 6000, `prompt is ${prompt.length} chars; it should be this call, not the manual`);
});

test('the prompt forbids offering times when there is no booking tool', () => {
  const context = createCallContext({ ...FULL_TOOLS, booking: false }, 'after_hours');
  context.state = 'next_step';
  const prompt = composeSystemPrompt({
    pack: pack(), context, agentName: 'Alex', tools: { ...FULL_TOOLS, booking: false },
  });
  assert.match(prompt, /You CANNOT book anything on this call/);
  assert.match(prompt, /Do not offer a specific time/);
});

test('the prompt tells the agent to ask for a role when no name is verified', () => {
  const context = createCallContext(FULL_TOOLS, 'after_hours');
  const rolePack = pack({ contactName: null, contactIsRoleOnly: true, askForRoute: 'operations' });
  const prompt = composeSystemPrompt({ pack: rolePack, context, agentName: 'Alex', tools: FULL_TOOLS });
  assert.match(prompt, /You do not have a verified name/);
  assert.match(prompt, /Do not guess at a name/);
});

test('the opener is honest and specific, never familiar', () => {
  const opener = composeOpener(pack(), 'Alex');
  assert.match(opener, /^Hey Dana, this is Alex with Your AI Department\./);
  assert.match(opener, /This is a cold call, so I'll be brief/);
  assert.match(opener, /emergency call comes in after hours/);
  assert.doesNotMatch(opener, /following up|as discussed|referred|returning your call/i);
});

test('the opener does not invent a name when none is verified', () => {
  const opener = composeOpener(pack({ contactName: null }), 'Alex');
  assert.match(opener, /^Hi there,/);
  assert.doesNotMatch(opener, /Dana/);
});

test('the gatekeeper line does not pitch', () => {
  const line = composeGatekeeperLine(pack());
  assert.match(line, /not trying to pitch anything at the front desk/i);
  assert.match(line, /who owns after hours/i);
  assert.doesNotMatch(line, /\bAI\b|\bautomation\b|\bsoftware\b|\bplatform\b/i);
});

test('voicemail is short and carries no pitch', () => {
  const message = composeVoicemail(pack(), 'Alex', '904-555-0199');
  assert.ok(message.length < 320, 'voicemail stays short');
  assert.match(message, /Alex with Your AI Department/);
  assert.doesNotMatch(message, /AI agents|automation platform|we help companies save/i);
});
