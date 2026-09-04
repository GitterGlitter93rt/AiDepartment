import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startCall, respond, type AgentTurn } from '../src/callbrain/agent.js';
import { PREDICATES, UNIVERSAL_EXPECTATIONS, grade, type GradedRun } from '../src/callbrain/grader.js';
import { HYPOTHESIS_QUESTIONS } from '../src/callbrain/openerSelector.js';
import type { CallPack } from '../src/callbrain/callPack.js';
import type { AvailableTools } from '../src/callbrain/stateMachine.js';

/**
 * Messy variations, and a regression for every behavioural defect fixed so far.
 * Authority: CLAUDE-SALES-AI-TRANSCRIPT-AUTHORITY.md.
 *
 * The gold fixtures in docs/ are the approved library and are not edited here. These
 * are the awkward calls the library does not cover: a prospect who is rude, vague,
 * burned by a previous vendor, or asking a question the agent must not answer with a
 * number it does not have.
 *
 * One core salesperson, not a vertical agent per trade: every case below runs the
 * same profile, the same opener selector, question families, working memory,
 * response cards and qualification gate.
 */

const TOOLS: AvailableTools = {
  booking: true, suppression: true, followUp: true, transfer: false, sms: false, email: true,
};

function pack(overrides: Partial<CallPack> = {}): CallPack {
  return {
    callPackId: null, accountId: 'acct-1',
    companyName: 'Northgate Air & Heating', geography: 'Jacksonville, FL', vertical: 'hvac',
    contactName: 'Dana Fielder', contactTitle: 'Owner', contactIsRoleOnly: false, askForRoute: null,
    confirmedFacts: [], importantUnknowns: [],
    primaryHypothesis: 'Paid emergency demand may arrive outside staffed hours.',
    primaryHypothesisCategory: 'after_hours',
    backupHypothesis: 'Unsold replacement estimates may not be followed up consistently.',
    backupHypothesisCategory: 'unsold_estimate_proposal_followup',
    firstQuestion: HYPOTHESIS_QUESTIONS['after_hours']!,
    backupQuestion: HYPOTHESIS_QUESTIONS['unsold_estimate']!,
    likelyObjections: [], knownSystems: [],
    prohibitedClaims: ['Do not state or estimate their advertising spend.'],
    allowedNextSteps: [], commercialTruth: '',
    ...overrides,
  };
}

function fakeBooking() {
  return {
    getSlots: () => [
      { token: 's1', spoken: 'today at 4:15 PM', startIso: '2026-09-08T20:15:00Z' },
      { token: 's2', spoken: 'tomorrow at 10:30 AM', startIso: '2026-09-09T14:30:00Z' },
    ],
    book: () => ({ ok: true }),
  };
}

async function run(turns: string[], overrides: Partial<CallPack> = {}): Promise<GradedRun> {
  const { state, opening } = startCall({
    pack: pack(overrides), tools: TOOLS, agentName: 'Alex', booking: fakeBooking(),
  });
  const collected: { prospect: string | null; agent: AgentTurn }[] =
    [{ prospect: null, agent: opening }];
  for (const utterance of turns) {
    collected.push({ prospect: utterance, agent: await respond(state, utterance) });
  }
  return { turns: collected, state } as GradedRun;
}

const said = (result: GradedRun) =>
  result.turns.map((turn) => turn.agent.say).join(' ');
const components = (result: GradedRun) =>
  result.turns.map((turn) => turn.agent.componentId);

/** Every messy call still has to clear the rules that apply to every call. */
function assertUniversals(result: GradedRun, label: string) {
  for (const expectation of UNIVERSAL_EXPECTATIONS) {
    const predicate = PREDICATES[expectation];
    assert.ok(predicate, `${expectation} has a predicate`);
    assert.equal(predicate!(result), true, `${label}: ${expectation}`);
  }
}

// --- messy gatekeepers -------------------------------------------------------

test('a gatekeeper who stonewalls is not worn down', async () => {
  const result = await run([
    'He is not available.',
    'I said he is not available.',
    'I am not putting you through.',
  ]);
  assertUniversals(result, 'stonewalling gatekeeper');
  assert.equal(/put me through|i need to speak|he'?s expecting me|transfer me/i.test(said(result)),
    false, 'asking three times is pressure, not persistence');
  const last = result.turns[result.turns.length - 1]!.agent;
  assert.ok(last.terminal || last.source === 'gatekeeper' || last.source === 'exit',
    'the call ends or stays on routing rather than pitching the gatekeeper');
});

test('a gatekeeper who says corporate handles it is believed', async () => {
  const result = await run(['Corporate handles that, not us.']);
  assertUniversals(result, 'corporate handles it');
  assert.equal(/would you be open to|worth a proper look/i.test(said(result)), false,
    'a site that does not own the process cannot agree to look at it');
  assert.match(said(result), /who|which|where|how/i, 'the agent asks who does own it');
});

test('a gatekeeper offering only a web form is taken at their word', async () => {
  const result = await run([
    'You can email the owner through our website form.',
  ]);
  assertUniversals(result, 'web form only');
  assert.match(said(result), /email|note|short/i);
  assert.equal(/put me through|is he there|can you transfer/i.test(said(result)), false);
});

// --- busy owners -------------------------------------------------------------

test('a busy owner gets one question, not a pitch', async () => {
  const result = await run(['I am slammed right now.', 'Twenty seconds.']);
  assertUniversals(result, 'busy owner');
  const reply = result.turns[2]!.agent.say;
  const questions = (reply.match(/\?/g) ?? []).length;
  assert.ok(questions <= 1, `asked ${questions} questions of someone who gave twenty seconds`);
});

test('a hard time boundary is accepted the first time', async () => {
  const result = await run(['I have thirty seconds and then I am gone.']);
  assertUniversals(result, 'hard boundary');
  assert.ok(result.turns[1]!.agent.say.length < 320,
    'a long reply to a thirty-second window is not listening');
});

// --- objections the library does not script ---------------------------------

test('"we already have AI" is met with curiosity, not a contradiction', async () => {
  const result = await run(['We already have AI, we use ChatGPT for emails.']);
  assertUniversals(result, 'already have AI');
  assert.equal(components(result).includes('uses_chatgpt'), true);
  assert.equal(/that'?s not real ai|that'?s different from|you need/i.test(said(result)), false,
    'telling a prospect their tool is not AI is an argument, not a conversation');
});

test('"we already have a CRM" does not become an attack on the CRM', async () => {
  const result = await run(['We run everything through ServiceTitan already.']);
  assertUniversals(result, 'already have a CRM');
  assert.equal(components(result).includes('has_crm'), true);
  assert.equal(/replace|rip (?:it )?out|better than|instead of servicetitan/i.test(said(result)),
    false, 'the CRM may already be the right platform');
});

test('a prospect burned by automation is not sold harder', async () => {
  const result = await run(['We tried automation two years ago and hated it.']);
  assertUniversals(result, 'burned by automation');
  assert.equal(components(result).includes('ai_not_ready'), true,
    'a bad experience is an objection with approved words, not an unknown');
  assert.equal(/this is different|we'?re not like|that was probably/i.test(said(result)), false,
    'dismissing what happened to them is how the second vendor loses too');
});

// --- price and skepticism ----------------------------------------------------

test('a price question early gets no number invented for it', async () => {
  const result = await run(['How much does this cost?']);
  assertUniversals(result, 'price early');
  assert.equal(components(result).includes('price_early'), true);
  assert.equal(/\$\s?\d|\d+\s?(?:k|thousand|dollars|per month|a month)/i.test(said(result)), false,
    'no price exists until the workflow is understood, so none may be spoken');
});

test('"that sounds expensive" is explored rather than discounted', async () => {
  const result = await run([
    'We miss calls after hours.',
    'That sounds expensive.',
  ]);
  assertUniversals(result, 'sounds expensive');
  assert.equal(/discount|cheaper|we can work (?:with|on) (?:the )?price/i.test(said(result)), false,
    'discounting something with no price yet is inventing one');
});

test('open skepticism is answered without a claim we cannot support', async () => {
  const result = await run(['Honestly this sounds like nonsense.']);
  assertUniversals(result, 'skepticism');
  assert.equal(/proven|guaranteed|hundreds of (?:clients|businesses)|everyone (?:is|does)/i
    .test(said(result)), false, 'social proof we do not have is the easy lie here');
});

test('"let me think about it" is not pushed past', async () => {
  const result = await run([
    'We do miss some after hours.',
    'Let me think about it.',
  ]);
  assertUniversals(result, 'think about it');
  assert.equal(/just|only takes|why not|what have you got to lose/i.test(said(result)), false,
    'those are closing pressure, not a question');
});

// --- interruptions and repetition -------------------------------------------

test('a prospect who interrupts twice is not told the same thing twice', async () => {
  const result = await run([
    'Sorry, what is this about?',
    'No, what is this actually about?',
  ]);
  assertUniversals(result, 'repeated interruption');
  const replies = result.turns.slice(1).map((turn) => turn.agent.say);
  assert.notEqual(replies[0], replies[1],
    'repeating a line the prospect just rejected is not answering them');
});

test('a prospect who talks over the opener is answered, not restarted', async () => {
  const result = await run(['Who is this?', 'Right, and what do you want?']);
  assertUniversals(result, 'talked over');
  const openerText = result.turns[0]!.agent.say;
  for (const turn of result.turns.slice(1)) {
    assert.notEqual(turn.agent.say, openerText, 'the opener is never replayed');
  }
});

// --- send email --------------------------------------------------------------

test('"send me an email" is accepted and made useful', async () => {
  const result = await run(['Just send me an email.']);
  assertUniversals(result, 'send email');
  assert.equal(components(result).includes('send_email'), true);
  assert.equal(/i'?ll send it to \S+@/i.test(said(result)), false,
    'no address is claimed that the prospect did not give');
});

test('an email request repeated is not argued with', async () => {
  const result = await run(['Send me an email.', 'Just email it.']);
  assertUniversals(result, 'repeated email request');
  assert.ok(PREDICATES['does_not_force_topic_qualification']!(result),
    'asking twice what it should be about is not listening');
});

// --- do not contact ----------------------------------------------------------

test('a DNC stops the call immediately, however it is phrased', async () => {
  for (const phrasing of [
    'Take me off your list.',
    'Do not call here again.',
    'Put us on your do not call list.',
  ]) {
    const result = await run([phrasing]);
    const reply = result.turns[1]!.agent;
    assert.equal(reply.terminal, true, `"${phrasing}" must end the call`);
    assert.equal(result.state.memory.priorityActions.dncDetected, true);
    assert.equal(/but|before you go|just one|can i ask/i.test(reply.say), false,
      'nothing follows a do-not-contact request');
  }
});

test('a DNC in the middle of a good conversation still ends it', async () => {
  const result = await run([
    'We do miss calls after hours.',
    'It goes to voicemail overnight.',
    'Actually, take us off your list.',
  ]);
  const last = result.turns[result.turns.length - 1]!.agent;
  assert.equal(last.terminal, true);
  assert.equal(result.state.memory.priorityActions.dncDetected, true,
    'a promising call is not a reason to keep going');
});

// --- regressions for every behavioural defect fixed in this workstream -------

test('regression: a bare "yeah" answering the phone is not agreement to a meeting', async () => {
  const result = await run(['Yeah, this is Mike. What is up?']);
  assert.equal(result.turns[1]!.agent.source, 'probe',
    'answering the phone is not agreeing to anything');
  assert.equal(/would you be open to that/i.test(result.turns[1]!.agent.say), false);
});

test('regression: engagement alone does not trigger the meeting offer', async () => {
  const result = await run([
    'After hours it goes to an answering service.',
    'They just take a message.',
  ]);
  const offers = result.turns.filter((turn) => turn.agent.source === 'offer');
  assert.equal(offers.length, 0,
    'the prospect has not agreed anything is worth measuring yet');
});

test('regression: the discovery ceiling makes the ask instead of fishing for a callback', async () => {
  const result = await run([
    'Calls come in all day.',
    'Whoever is free picks them up.',
    'Sometimes nobody does.',
    'I could not tell you how often.',
  ]);
  assert.equal(/what time works better for you/i.test(said(result)), false,
    'nobody offered a callback; asking for a time is fishing');
});

test('regression: a routing-only gatekeeper is never offered the meeting', async () => {
  const result = await run(['You would want Dave, our GM.', 'Extension 204.']);
  assert.equal(result.turns.slice(1).some((turn) => turn.agent.source === 'offer'), false);
  assert.equal(result.state.memory.routing.correctedPersonName, 'Dave');
  assert.equal(result.state.memory.routing.extension, '204');
});

test('regression: an answer to the agent question is not handled as an objection', async () => {
  const result = await run([
    'We have an answering service that books jobs directly and texts our on-call tech.',
  ]);
  assert.notEqual(result.turns[1]!.agent.componentId, 'has_answering_service',
    'they already answered the question that card would ask');
  assert.match(result.turns[1]!.agent.say, /properly handled|that'?s good|sounds/i);
});

test('regression: after the backup, answers are read against the backup family', async () => {
  const result = await run([
    'Calls are answered 24/7 and booked automatically.',
    'Our estimates also have a six-touch sequence and managers review it weekly.',
  ]);
  const last = result.turns[result.turns.length - 1]!.agent;
  assert.equal(last.terminal, true, 'both hypotheses are handled, so the call ends');
  assert.equal(last.source, 'exit');
});

test('regression: the fair-housing refusal fires on the word people actually use', async () => {
  const result = await run([
    'Could the AI route certain buyers to different agents based on ethnicity?',
  ]);
  const reply = result.turns[1]!.agent;
  assert.equal(reply.componentId, 'discriminatory_routing');
  assert.match(reply.say, /unlawful/);
  assert.ok(reply.reasonCodes.includes('unlawful_request_refused'));
});

test('regression: an AI identity question is answered, not stepped over', async () => {
  const result = await run(['Wait, is this a robot?']);
  assert.equal(result.turns[1]!.agent.componentId, 'asks_if_ai');
  assert.match(result.turns[1]!.agent.say, /AI voice assistant/i);
  assert.equal(/i'?m (?:a )?(?:human|real person)/i.test(said(result)), false);
  assert.ok(result.state.memory.statedUnits.includes('ai_identity_disclosure'));
});

test('regression: a hypothesis category with no family still asks a real question', async () => {
  const result = await run(['We get a fair few enquiries.'],
    { primaryHypothesisCategory: 'something_never_mapped', firstQuestion: null });
  const reply = result.turns[1]!.agent;
  assert.equal(reply.source, 'probe', 'a missing family is not a reason to pitch');
  assert.match(reply.say, /\?/);
});

test('regression: no time is spoken that the calendar did not return', async () => {
  const result = await run([
    'We miss calls when the crews are out.',
    'Nobody picks them up until the morning.',
    'Yeah, that is probably worth looking at.',
    'Sure, that works.',
  ]);
  const offered = result.state.offeredSlots.map((slot) => slot.spoken);
  const spoken = said(result).match(/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi) ?? [];
  for (const time of spoken) {
    assert.ok(offered.some((slot) => slot.includes(time)),
      `${time} was spoken but never offered by the calendar`);
  }
});

// --- the grader itself -------------------------------------------------------

test('every messy call above is graded, not merely run', async () => {
  const result = await run(['How much does this cost?']);
  const graded = grade(result, [...UNIVERSAL_EXPECTATIONS]);
  assert.ok(graded.length > 0);
  assert.equal(graded.some((row) => row.unmapped), false,
    'a universal expectation with no predicate would pass silently');
});
