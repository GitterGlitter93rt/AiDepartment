import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startCall, respond, AGENT_PROFILE, type AgentState, type AgentTurn } from '../src/callbrain/agent.js';
import { grade, UNIVERSAL_EXPECTATIONS, PREDICATES, type GradedRun } from '../src/callbrain/grader.js';
import { roleplayFixtures, cardFor, familyFor, readSignal, numberProvenanceAnswer } from '../src/callbrain/knowledge.js';
import { selectOpener, checkOpener, HYPOTHESIS_QUESTIONS } from '../src/callbrain/openerSelector.js';
import { assessReadiness, readWillingness } from '../src/callbrain/qualification.js';
import { createWorkingMemory } from '../src/callbrain/workingMemory.js';
import type { CallPack } from '../src/callbrain/callPack.js';
import type { AvailableTools } from '../src/callbrain/stateMachine.js';

/**
 * The one core Sales AI, graded behaviorally against the gold fixtures.
 * Authority: CLAUDE-SALES-AI-TRANSCRIPT-AUTHORITY.md.
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

/** A calendar that returns two real slots, like Cal.com would. */
function fakeBooking(options: { slots?: number; failBooking?: boolean } = {}) {
  const all = [
    { token: 's1', spoken: 'today at 4:15 PM', startIso: '2026-09-08T20:15:00Z' },
    { token: 's2', spoken: 'tomorrow at 10:30 AM', startIso: '2026-09-09T14:30:00Z' },
  ];
  return {
    getSlots: () => all.slice(0, options.slots ?? 2),
    book: () => ({ ok: !options.failBooking, error: options.failBooking ? 'provider error' : undefined }),
  };
}

/** Runs a scripted conversation and returns everything the grader needs. */
function runConversation(input: {
  pack: CallPack; tools?: AvailableTools; turns: string[];
  openerContext?: Parameters<typeof startCall>[0]['openerContext'];
  booking?: Parameters<typeof startCall>[0]['booking'];
}): GradedRun {
  const { state, opening } = startCall({
    pack: input.pack, tools: input.tools ?? TOOLS, agentName: 'Alex',
    openerContext: input.openerContext,
    booking: input.booking ?? fakeBooking(),
  });
  const turns: { prospect: string | null; agent: AgentTurn }[] = [{ prospect: null, agent: opening }];

  for (const utterance of input.turns) {
    const last = turns[turns.length - 1]!.agent;
    if (last.terminal) break;
    turns.push({ prospect: utterance, agent: respond(state, utterance) });
  }
  return { turns, state };
}

// --- the gold fixture suite ---------------------------------------------------

test('every roleplay fixture is graded, and unmapped expectations are reported', () => {
  const fixtures = roleplayFixtures();
  assert.ok(fixtures.length > 0, 'the fixture set loaded from the repository');

  const failures: string[] = [];
  const unmapped = new Set<string>();

  for (const fixture of fixtures) {
    const hypothesis = (fixture.context.hypothesis as string | undefined) ?? null;
    const run = runConversation({
      pack: pack({
        vertical: (fixture.context.vertical as string | undefined) ?? 'hvac',
        primaryHypothesisCategory: normalizeHypothesis(hypothesis),
        firstQuestion: HYPOTHESIS_QUESTIONS[normalizeHypothesis(hypothesis) ?? ''] ?? null,
        contactIsRoleOnly: fixture.context.target_role === 'gatekeeper',
      }),
      turns: fixture.prospect_turns,
      openerContext: {
        ...((fixture.context.confirmed_public ?? []).includes('current_google_advertiser')
          ? { freshAdvertising: { service: 'emergency AC', market: 'Jacksonville' } }
          : {}),
        // An inbound callback is not a cold call, and the fixture says so.
        ...(fixture.id.includes('inbound_callback')
          ? { priorInteraction: { kind: 'outbound_attempt',
                description: 'the call we made about your lead follow-up' } }
          : {}),
      },
      booking: fixture.id.includes('provider_failure') ? fakeBooking({ failBooking: true })
        : fixture.id.includes('no_calendar_slot') ? fakeBooking({ slots: 0 })
        : fakeBooking(),
      tools: fixture.id.includes('no_calendar_slot') ? TOOLS : TOOLS,
    });

    for (const result of grade(run, [...fixture.expect, ...UNIVERSAL_EXPECTATIONS])) {
      if (result.unmapped) { unmapped.add(result.expectation); continue; }
      if (!result.passed) failures.push(`${fixture.id}: ${result.expectation}`);
    }
  }

  // Unmapped expectations are surfaced rather than silently passing.
  if (unmapped.size > 0) {
    console.log(`  [grader] expectations not yet implemented: ${[...unmapped].join(', ')}`);
  }
  assert.deepEqual(failures, [], 'every graded behavioral expectation holds');
});

function normalizeHypothesis(value: string | null): string | null {
  if (!value) return null;
  const map: Record<string, string> = {
    after_hours_paid_lead_handling: 'after_hours',
    missed_call_recovery: 'missed_call',
    unsold_proposal_followup: 'unsold_estimate',
    proposal_followup: 'unsold_estimate',
    speed_to_lead: 'speed_to_lead',
    intake_response: 'speed_to_lead',
    admin_capacity: 'employee_capacity',
    attribution_visibility: 'attribution',
  };
  return map[value] ?? value;
}

// --- opener selection ---------------------------------------------------------

test('the opener uses the strongest truthful context and degrades when evidence is thin', () => {
  const withAds = selectOpener({
    pack: pack(), agentName: 'Alex',
    freshAdvertising: { service: 'emergency AC', market: 'Jacksonville' },
  });
  assert.equal(withAds.priority, 'PAID_DEMAND');
  assert.match(withAds.text, /advertising emergency AC around Jacksonville/);

  const withSignal = selectOpener({
    pack: pack(), agentName: 'Alex', businessSignal: '24/7 emergency service',
  });
  assert.equal(withSignal.priority, 'BUSINESS_SIGNAL');
  assert.doesNotMatch(withSignal.text, /advertis/i, 'no ad claim without ad evidence');

  const categoryOnly = selectOpener({ pack: pack(), agentName: 'Alex' });
  assert.equal(categoryOnly.priority, 'MARKET_CATEGORY');
  assert.doesNotMatch(categoryOnly.text, /advertis/i);
  assert.match(categoryOnly.text, /HVAC companies around Jacksonville/);
});

test('a genuine prior interaction is never framed as a cold call', () => {
  const opener = selectOpener({
    pack: pack(), agentName: 'Alex',
    priorInteraction: { kind: 'requested_callback', description: 'the callback you asked for last week' },
  });
  assert.equal(opener.priority, 'PRIOR_RELATIONSHIP');
  assert.doesNotMatch(opener.text, /cold call/i);
  assert.match(opener.text, /following up on the callback/);
});

test('the opener never invents a first name', () => {
  const opener = selectOpener({
    pack: pack({ contactName: null, contactIsRoleOnly: true }), agentName: 'Alex',
  });
  assert.match(opener.text, /^Hi there,/);
  assert.doesNotMatch(opener.text, /Dana/);
});

test('the opener asks exactly one question and avoids surveillance detail', () => {
  const opener = selectOpener({
    pack: pack(), agentName: 'Alex',
    freshAdvertising: { service: 'emergency AC', market: 'Jacksonville' },
  });
  assert.equal((opener.text.match(/\?/g) ?? []).length, 1);
  // Exactly two claims: the service, and the market.
  assert.equal(opener.claims.length, 2);
  assert.doesNotMatch(opener.text, /stars|reviews|CallRail|founded in/i);

  const check = checkOpener(opener, {
    pack: pack(), agentName: 'Alex',
    freshAdvertising: { service: 'emergency AC', market: 'Jacksonville' },
  });
  assert.equal(check.ok, true);
});

test('claiming advertising without evidence fails the pre-flight check', () => {
  const opener = selectOpener({
    pack: pack(), agentName: 'Alex',
    freshAdvertising: { service: 'emergency AC', market: 'Jacksonville' },
  });
  const check = checkOpener(opener, { pack: pack(), agentName: 'Alex', freshAdvertising: null });
  assert.equal(check.ok, false);
  assert.ok(check.failures.some((failure) => /without fresh claim-safe evidence/.test(failure)));
  assert.equal(check.degradeTo, 'MARKET_CATEGORY');
});

// --- question bank and signal reading -----------------------------------------

test('the question bank loads and maps a hypothesis to a family', () => {
  const { key, family } = familyFor('after_hours');
  assert.ok(key, 'after_hours maps to a family');
  assert.ok((family?.first_questions ?? []).length > 0);
  assert.ok((family?.probes ?? {}) && Object.keys(family!.probes!).length > 0);
});

test('answers are read as a gap or a handled process, not as sentiment', () => {
  const { family } = familyFor('after_hours');
  assert.equal(readSignal('It just goes to voicemail overnight.', family).read, 'gap');
  assert.equal(readSignal('We have 24/7 live answering and they book directly.', family).read, 'handled');
  assert.equal(readSignal('That is a really good question.', family).read, 'unclear');
  // Politeness is not a gap and not a handled process.
  assert.equal(readSignal('Interesting, makes sense.', family).read, 'unclear');
});

// --- response cards -----------------------------------------------------------

test('cards are selected by what was actually said', () => {
  assert.equal(cardFor('We already use ChatGPT for that.')?.id, 'uses_chatgpt');
  assert.equal(cardFor('We have a receptionist.')?.id, 'has_receptionist');
  assert.equal(cardFor('Just send me an email.')?.id, 'send_email');
  assert.equal(cardFor('How did you get my number?')?.id, 'how_did_you_get_my_number');
  assert.equal(cardFor('Is this a robot?')?.id, 'asks_if_ai');
  assert.equal(cardFor('I am really busy right now.')?.id, 'busy');
  assert.equal(cardFor('Tell me about the weather.'), null);
});

test('the number-provenance answer matches the endpoint source and never invents one', () => {
  assert.match(numberProvenanceAnswer('COMPANY_WEBSITE'), /listed publicly/i);
  assert.match(numberProvenanceAnswer('PAID_PROVIDER'), /contact-data provider/i);
  assert.match(numberProvenanceAnswer('IMPORT'), /prospecting records/i);
  // An unknown source admits it rather than claiming a public listing.
  const unknown = numberProvenanceAnswer(null);
  assert.match(unknown, /don'?t want to guess/i);
  assert.doesNotMatch(unknown, /listed publicly/i);
});

test('the same objection is not argued twice', () => {
  const run = runConversation({
    pack: pack(),
    turns: ['Not interested.', 'I said not interested.', 'Still not interested.'],
  });
  const exit = run.turns[run.turns.length - 1]!.agent;
  assert.equal(exit.terminal, true);
  assert.ok(exit.reasonCodes.includes('objection_cycle_limit')
    || exit.reasonCodes.includes('no_need_stated'));
});

// --- qualification gate -------------------------------------------------------

test('politeness is neutral, not interest', () => {
  assert.equal(readWillingness('That is interesting, makes sense.'), 'neutral');
  assert.equal(readWillingness('Sure, that sounds good.'), 'explicit_yes');
  assert.equal(readWillingness('Not interested, thanks.'), 'explicit_no');
  assert.equal(readWillingness('I am busy, call me next week.'), 'busy_but_open');
});

test('a routing-only gatekeeper never books Michael', () => {
  const memory = createWorkingMemory('after_hours', null);
  memory.stakeholder.relevance = 'routing_only';
  memory.pain.status = 'confirmed_meaningful';
  memory.prospectIntent = { current: 'wants_strategy_call', confidence: 'high' };

  const decision = assessReadiness({
    memory, bookingAvailable: true, discoveryDepth: 1, maxDiscoveryDepth: 3,
  });
  assert.notEqual(decision.recommendation, 'BOOK_NOW');
  // A gatekeeper is routed through, not booked and not chased for a callback time.
  assert.equal(decision.recommendation, 'ROUTE_VIA_GATEKEEPER');
  assert.ok(decision.reasonCodes.includes('routing_only_stakeholder'));
});

test('a public hypothesis alone never becomes a booking', () => {
  const memory = createWorkingMemory('after_hours', null);
  memory.stakeholder.relevance = 'decision_owner';
  // Pain is still unknown: nothing the prospect said has confirmed it.
  const decision = assessReadiness({
    memory, bookingAvailable: true, discoveryDepth: 1, maxDiscoveryDepth: 3,
  });
  assert.equal(decision.recommendation, 'CONTINUE_BRIEFLY');
  assert.equal(decision.path, null);
});

test('no booking is offered when the booking tool is unavailable', () => {
  const memory = createWorkingMemory('after_hours', null);
  memory.stakeholder.relevance = 'decision_owner';
  memory.pain.status = 'confirmed_meaningful';
  memory.prospectIntent = { current: 'wants_strategy_call', confidence: 'high' };

  const decision = assessReadiness({
    memory, bookingAvailable: false, discoveryDepth: 2, maxDiscoveryDepth: 3,
  });
  assert.equal(decision.recommendation, 'CALLBACK');
  assert.ok(decision.reasonCodes.includes('booking_tool_unavailable'));
});

test('discovery stops rather than becoming free consulting', () => {
  const memory = createWorkingMemory('after_hours', null);
  memory.stakeholder.relevance = 'decision_owner';
  const decision = assessReadiness({
    memory, bookingAvailable: true, discoveryDepth: 3, maxDiscoveryDepth: 3,
  });
  assert.ok(['DISQUALIFY_OR_REVIEW', 'CALLBACK'].includes(decision.recommendation));
  assert.ok(decision.reasonCodes.includes('discovery_ceiling_reached'));
});

// --- whole-conversation behavior ---------------------------------------------

test('an engaged owner with a real gap is offered a strategy call, not a pitch', () => {
  const run = runConversation({
    pack: pack(),
    turns: [
      'Yeah this is Dana.',
      'Honestly after six it just goes to voicemail.',
      'We get about 60 calls a week.',
      'Yeah, that is probably worth looking at.',
    ],
  });
  const text = run.turns.map((turn) => turn.agent.say).join(' ');
  assert.match(text, /worth a proper look|short conversation with Michael/);
  assert.ok(run.state.memory.numbers.some((number) => /60/.test(number.valueText)));
  // No time is ever named by the agent itself.
  assert.equal(PREDICATES['checks_real_availability_before_slots']!(run), true);
  assert.equal(PREDICATES['does_not_claim_missed_revenue']!(run), true);
});

test('a strong existing process ends in a professional no-sale', () => {
  const run = runConversation({
    pack: pack(),
    turns: [
      'Speaking.',
      'We use ServiceTitan and our answering team books directly into it 24/7.',
      'Every lead is tracked and our sales manager reviews anything untouched.',
      'Honestly we are good there.',
    ],
  });
  const last = run.turns[run.turns.length - 1]!.agent;
  assert.equal(last.terminal, true);
  assert.match(last.say, /not waste your time|already handled/i);
  assert.ok(run.state.memory.workflow.currentSystems.some((system) => system.value === 'servicetitan'));
  assert.equal(PREDICATES['does_not_attack_existing_stack']!(run), true);
  assert.equal(PREDICATES['may_test_at_most_one_supported_backup_hypothesis']!(run), true);
});

test('the agent identifies itself honestly when asked', () => {
  const run = runConversation({
    pack: pack(),
    turns: ['Wait, is this a robot?'],
  });
  const reply = run.turns[1]!.agent;
  assert.equal(reply.componentId, 'asks_if_ai');
  assert.ok(run.state.memory.statedUnits.includes('ai_identity_disclosure'));
  assert.equal(PREDICATES['truthful_ai_disclosure']!(run), true);
});

test('a DNC ends the call immediately with nothing after it', () => {
  const run = runConversation({
    pack: pack(),
    turns: [
      'Speaking.',
      'It goes to voicemail honestly.',
      'Take me off your list.',
      'So what does it cost though?',
    ],
  });
  assert.equal(PREDICATES['immediate_dnc_handling']!(run), true);
  assert.equal(run.state.memory.priorityActions.dncDetected, true);
});

test('there is one agent profile, not one per industry', () => {
  assert.equal(AGENT_PROFILE, 'yad-sales-core-v1');
  // The same agent handles a different vertical purely through the Call Pack.
  const roofing = runConversation({
    pack: pack({
      vertical: 'roofing', primaryHypothesisCategory: 'unsold_estimate',
      firstQuestion: HYPOTHESIS_QUESTIONS['unsold_estimate']!,
      backupHypothesis: null, backupHypothesisCategory: null, backupQuestion: null,
    }),
    turns: ['Speaking.', 'The sales guys are supposed to follow their own estimates.'],
  });
  assert.match(roofing.turns[0]!.agent.say, /estimate or proposal/);
  assert.match(roofing.turns[0]!.agent.say, /roofing companies/);
});
