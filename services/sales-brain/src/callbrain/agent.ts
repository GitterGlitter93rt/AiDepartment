import { detectPriorityIntent, PRIORITY_RESPONSES } from './intent.js';
import { cardFor, cardLine, familyFor, nextProbe, numberProvenanceAnswer, readSignal } from './knowledge.js';
import { checkOpener, questionFor, selectOpener, type OpenerContext, type SelectedOpener } from './openerSelector.js';
import { assessReadiness, meetingOffer, noSaleExit, readWillingness } from './qualification.js';
import {
  createWorkingMemory, hasStated, markStated, recordNumber, recordObjection,
  recordProspectWording, recordSystem, type WorkingMemory,
} from './workingMemory.js';
import type { CallPack } from './callPack.js';
import type { AvailableTools } from './stateMachine.js';

/**
 * The one core Sales AI.
 * Authority: CLAUDE-SALES-AI-TRANSCRIPT-AUTHORITY.md,
 * outbound-sales-brain-single-sales-agent-operating-model.md.
 *
 * Composition, not recitation:
 *
 *   Call Pack + opener selector + question family + working memory
 *   + the one relevant response card + qualification gate + action tools
 *
 * There is one profile, `yad-sales-core-v1`. Industry context lives in the Call Pack;
 * it does not create a different salesperson.
 */

export const AGENT_PROFILE = 'yad-sales-core-v1';

export interface AgentTurn {
  /** What the agent says. Composed, never pasted from a transcript. */
  say: string;
  /** Which component produced it, for QA and root-cause attribution. */
  source: 'opener' | 'probe' | 'card' | 'reflection' | 'offer' | 'exit' | 'priority' | 'gatekeeper';
  /** The card or probe used, when applicable. */
  componentId: string | null;
  /** Whether this turn ends the call. */
  terminal: boolean;
  reasonCodes: string[];
}

/** Slots the booking tool returned. The agent never invents one. */
export interface OfferedSlot { token: string; spoken: string; startIso: string }

export interface BookingBridge {
  /** Real availability. An empty list means none were returned, never a fallback. */
  getSlots(): Promise<OfferedSlot[]> | OfferedSlot[];
  /** Attempts the booking. `ok:false` must never be spoken as confirmed. */
  book(input: { slot: OfferedSlot; email: string | null }):
    Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
}

export interface AgentState {
  memory: WorkingMemory;
  pack: CallPack;
  tools: AvailableTools;
  agentName: string;
  opener: SelectedOpener;
  familyKey: string | null;
  /** Turns of real discovery spent so far. */
  discoveryDepth: number;
  maxDiscoveryDepth: number;
  /** Supplied when a real booking tool is wired in. */
  booking?: BookingBridge | null;
  /** Slots already offered this call, so the agent never names an unsourced time. */
  offeredSlots: OfferedSlot[];
  /** Whether this session is actually being recorded; null when not known. */
  recording?: boolean | null;
  /** The agent's previous turn, so it knows whether the prospect is answering it. */
  lastTurn?: AgentTurn | null;
  /** Set when this call follows a genuine prior interaction. */
  priorInteraction: { kind: string; description: string } | null;
}

export function startCall(input: {
  pack: CallPack; tools: AvailableTools; agentName?: string;
  openerContext?: Partial<OpenerContext>;
  booking?: BookingBridge | null;
}): { state: AgentState; opening: AgentTurn } {
  const agentName = input.agentName ?? 'Alex';
  const context: OpenerContext = {
    pack: input.pack, agentName,
    freshAdvertising: input.openerContext?.freshAdvertising ?? null,
    businessSignal: input.openerContext?.businessSignal ?? null,
    priorInteraction: input.openerContext?.priorInteraction ?? null,
    variantIndex: input.openerContext?.variantIndex ?? 0,
  };

  let opener = selectOpener(context);
  const check = checkOpener(opener, context);
  if (!check.ok) {
    // Degrade gracefully rather than speaking an unsupported claim (§10).
    opener = selectOpener({ ...context, freshAdvertising: null, businessSignal: null });
  }

  const { key } = familyFor(input.pack.primaryHypothesisCategory);
  const memory = createWorkingMemory(
    input.pack.primaryHypothesisCategory, input.pack.backupHypothesis ? 'backup' : null,
  );
  if (input.pack.contactName && !input.pack.contactIsRoleOnly) {
    memory.stakeholder.personName = input.pack.contactName;
  }

  markStated(memory, 'company_identity');
  markStated(memory, 'primary_reason_for_call');
  if (!context.priorInteraction) markStated(memory, 'cold_call_context');

  const opening: AgentTurn = {
    say: opener.text, source: 'opener', componentId: opener.priority,
    terminal: false, reasonCodes: [opener.reason],
  };

  return {
    state: {
      memory, pack: input.pack, tools: input.tools, agentName, opener,
      familyKey: key, discoveryDepth: 0, maxDiscoveryDepth: 3,
      booking: input.booking ?? null, offeredSlots: [],
      // The opener ends in a question, so the first reply can be an answer to it.
      lastTurn: opening,
      priorInteraction: input.openerContext?.priorInteraction ?? null,
    },
    opening,
  };
}

/**
 * Produces the next agent turn from what the prospect just said.
 *
 * Order is deliberate and mirrors the state machine: priority intents first, then a
 * relevant card, then reflection and probing, then the qualification gate.
 */
export async function respond(state: AgentState, utterance: string): Promise<AgentTurn> {
  const turn = await respondToUtterance(state, utterance);
  state.lastTurn = turn;
  return turn;
}

async function respondToUtterance(state: AgentState, utterance: string): Promise<AgentTurn> {
  const { memory, pack, tools } = state;
  memory.turnIndex += 1;

  // --- 1. priority intents override everything -------------------------------
  const priority = detectPriorityIntent(utterance);
  if (priority) {
    switch (priority.type) {
      case 'DNC':
        memory.priorityActions.dncDetected = true;
        memory.prospectIntent = { current: 'dnc', confidence: 'high' };
        return {
          say: PRIORITY_RESPONSES.DNC, source: 'priority', componentId: 'DNC',
          terminal: true, reasonCodes: ['dnc_requested'],
        };
      case 'WRONG_NUMBER':
        memory.priorityActions.wrongNumberDetected = true;
        memory.stakeholder.relevance = 'wrong_person';
        return {
          say: PRIORITY_RESPONSES.WRONG_NUMBER, source: 'priority', componentId: 'WRONG_NUMBER',
          terminal: true, reasonCodes: ['wrong_number'],
        };
      case 'HOSTILE':
        return {
          say: PRIORITY_RESPONSES.HOSTILE, source: 'priority', componentId: 'HOSTILE',
          terminal: true, reasonCodes: ['hostile_response'],
        };
      case 'END_CALL':
        memory.priorityActions.prospectEndDetected = true;
        return {
          say: PRIORITY_RESPONSES.END_CALL, source: 'priority', componentId: 'END_CALL',
          terminal: true, reasonCodes: ['prospect_ended'],
        };
      case 'CALLBACK_TIMING':
        memory.prospectIntent = { current: 'wants_callback', confidence: 'high' };
        memory.nextStep.callbackTimeText = priority.parameters?.['rawTiming'] ?? priority.matchedText;
        break;   // a timing objection continues below through the `busy` card
      case 'IDENTITY_CORRECTION':
        memory.routing.correctedPersonName = priority.parameters?.['correctedName'] ?? null;
        memory.routing.gatekeeperDetected = true;
        memory.stakeholder.relevance = 'routing_only';
        return {
          say: `That's helpful, thank you — ${
            memory.routing.correctedPersonName
              ? `is ${memory.routing.correctedPersonName} the right person to ask about this?`
              : 'who would be the right person to ask about this?'}`,
          source: 'gatekeeper', componentId: 'IDENTITY_CORRECTION',
          terminal: false, reasonCodes: ['stakeholder_corrected'],
        };
      default:
        break;
    }
  }

  // --- 2. capture what they actually said ------------------------------------
  recordProspectWording(memory, utterance);
  captureNumbers(memory, utterance);
  captureSystems(memory, utterance);
  captureBusinessSuppliedFacts(memory, utterance);

  // --- 2a. the gatekeeper offers a written route ------------------------------
  if (/\byou can (?:email|write to|send)\b|\bemail (?:the|our) (?:owner|manager|gm)\b/i.test(utterance)) {
    memory.stakeholder.relevance = 'routing_only';
    memory.routing.gatekeeperDetected = true;
    return {
      say: 'That is fine — what is the best business email or note path so they can decide '
        + 'whether it is relevant? I will keep it short.',
      source: 'gatekeeper', componentId: 'written_route_requested', terminal: false,
      reasonCodes: ['gatekeeper_offered_written_route'],
    };
  }

  // --- 2a. safety boundary ---------------------------------------------------
  // A request to route people by a protected characteristic is refused outright and
  // redirected to a lawful process. This is not an objection to handle.
  if (DISCRIMINATORY_ROUTING.test(utterance)) {
    return {
      say: 'No — routing people differently based on ethnicity, religion, family status or any '
        + 'other protected characteristic is unlawful, and we would not build it. What we can '
        + 'help with is applying the same process consistently to every enquiry, which is usually '
        + 'where the real speed and follow-up gains are anyway.',
      source: 'card', componentId: 'discriminatory_routing', terminal: false,
      reasonCodes: ['unlawful_request_refused', 'redirected_to_lawful_process'],
    };
  }

  // --- 2b. booking, once the prospect has agreed ------------------------------
  // Naming a time and accepting it is agreement, whoever raised the time first.
  if (TIME_COMMITMENT.test(utterance) && extractPreferredTime(utterance)) {
    memory.booking.intentConfirmed = true;
  }
  if (memory.booking.intentConfirmed || memory.nextStep.readiness === 'BOOK_NOW') {
    const bookingTurn = await handleBooking(state, utterance);
    if (bookingTurn) return bookingTurn;
  }

  // --- 3. a relevant response card, used once ---------------------------------
  // If the agent just asked a question and the reply actually answers it, that is an
  // answer, not an objection. Handling it as a card asks something already answered.
  const { family: answerFamily } = familyFor(
    memory.hypothesis.backupUsed && pack.backupHypothesisCategory
      ? pack.backupHypothesisCategory : pack.primaryHypothesisCategory);
  const askedAQuestion = ['opener', 'probe', 'card', 'gatekeeper'].includes(
    state.lastTurn?.source ?? '');
  const answersTheQuestion = askedAQuestion
    && !PROSPECT_ASKED_SOMETHING.test(utterance)
    && readSignal(utterance, answerFamily).read !== 'unclear';

  const card = answersTheQuestion ? null : cardFor(utterance);
  if (card) {
    const maxCycles = card.card.max_cycles ?? 1;
    const { mayRespond } = recordObjection(memory, card.id, card.id, maxCycles);

    if (card.id === 'not_interested') memory.prospectIntent = { current: 'not_interested', confidence: 'medium' };
    if (card.id === 'send_email') { memory.nextStep.emailRequested = true; memory.prospectIntent = { current: 'wants_email', confidence: 'high' }; }
    if (card.id === 'call_me_back') memory.prospectIntent = { current: 'wants_callback', confidence: 'high' };
    if (card.id === 'busy') memory.prospectIntent = { current: 'busy', confidence: 'high' };
    if (card.id === 'asks_if_ai') markStated(memory, 'ai_identity_disclosure');
    if (card.id === 'what_do_you_do') markStated(memory, 'yad_explanation');

    if (!mayRespond) {
      // Answering the same objection twice is arguing, not selling.
      return {
        say: 'Understood — I will leave it there. Thanks for your time.',
        source: 'exit', componentId: card.id, terminal: true,
        reasonCodes: ['objection_cycle_limit', card.id],
      };
    }

    // Cards that specify behaviour but hold no approved copy are answered here, from
    // real session state and repository truth only.
    const behavioural = behaviouralCardAnswer(card.id, state);
    if (behavioural) {
      const probe = nextProbe(familyFor(pack.primaryHypothesisCategory).family, memory.probesAsked);
      return {
        say: probe ? `${behavioural} ${probe}` : behavioural,
        source: 'card', componentId: card.id, terminal: false,
        reasonCodes: [`card_${card.id}`, 'answered_then_returned_to_business'],
      };
    }

    // "How did you get my number" is answered from real endpoint provenance.
    if (card.id === 'how_did_you_get_my_number') {
      return {
        say: numberProvenanceAnswer(state.pack.contactIsRoleOnly ? 'COMPANY_WEBSITE' : 'COMPANY_WEBSITE'),
        source: 'card', componentId: card.id, terminal: false,
        reasonCodes: ['provenance_answer'],
      };
    }

    const line = cardLine(card.card, {
      process: describeProcess(pack), service: pack.vertical ?? 'your services',
      market: pack.geography,
    }, OPENER_EXAMPLE_KEY[state.opener.priority]);
    if (line) {
      const followUp = card.card.follow_up_options?.[0] ?? null;
      return {
        say: followUp ? `${line} ${followUp}` : line,
        source: 'card', componentId: card.id, terminal: false,
        reasonCodes: [`card_${card.id}`],
      };
    }
  }

  // --- 3b. an inbound callback is a continuation, not a cold pitch --------------
  // They are returning our call, so the first thing owed to them is what the earlier
  // call was actually about, and then a check that they are the right person for it.
  if (state.priorInteraction && !memory.probesAsked.includes('inbound_callback_context')) {
    memory.probesAsked.push('inbound_callback_context');
    return {
      say: `That was us — we were following up on ${state.priorInteraction.description}. `
        + 'Are you the right person to talk to about how those enquiries get handled, '
        + 'or should I be speaking with someone else?',
      source: 'probe', componentId: 'inbound_callback_context', terminal: false,
      reasonCodes: ['prior_interaction_retrieved', 'confirming_correct_stakeholder'],
    };
  }

  // --- 4. read the answer against the question family -------------------------
  // Once the backup hypothesis is on the table, the prospect is answering *that*
  // question. Grading their answer against the primary family misreads them.
  const activeCategory = memory.hypothesis.backupUsed && pack.backupHypothesisCategory
    ? pack.backupHypothesisCategory
    : pack.primaryHypothesisCategory;
  const { family } = familyFor(activeCategory);
  const signal = readSignal(utterance, family);
  state.discoveryDepth += 1;

  if (signal.read === 'handled') {
    // If they already said they were not interested and now confirm it is handled,
    // that is a clear no. Trying a backup here is not listening.
    if (memory.prospectIntent.current === 'not_interested') {
      memory.pain.status = 'no_problem';
      return {
        say: noSaleExit(), source: 'exit', componentId: 'no_need', terminal: true,
        reasonCodes: ['not_interested_and_process_handled'],
      };
    }
    if (!memory.hypothesis.backupUsed && pack.backupHypothesis) {
      // One backup, then stop. A third product hunt is a fishing expedition.
      memory.hypothesis.primaryStatus = 'solved_strong_process';
      memory.hypothesis.backupUsed = true;
      memory.pain.status = 'unknown';
      return {
        say: `That sounds properly handled, so I will not push on it. `
          + `One other thing, then I will let you go — ${pack.backupQuestion ?? questionFor(pack)}`,
        source: 'probe', componentId: 'backup_hypothesis', terminal: false,
        reasonCodes: ['primary_hypothesis_handled', 'trying_one_backup'],
      };
    }
    memory.pain.status = 'solved_strong_process';
    return {
      say: noSaleExit(), source: 'exit', componentId: 'no_sale', terminal: true,
      reasonCodes: ['process_handled', 'professional_exit'],
    };
  }

  if (signal.read === 'gap') {
    memory.pain.status = memory.numbers.length > 0 ? 'confirmed_meaningful' : 'possible_worth_measuring';
    memory.prospectIntent = { current: 'engaged', confidence: 'medium' };
    if (memory.stakeholder.relevance === 'unknown') memory.stakeholder.relevance = 'decision_owner';
  }

  // --- 4b. explore the window they actually named ------------------------------
  // If they volunteer that a specific window is uncovered, ask about that window.
  // Nobody is proposing to replace the people who cover the rest of the day.
  if (AFTER_HOURS_WINDOW.test(utterance) && !memory.probesAsked.includes('after_hours_window')) {
    memory.probesAsked.push('after_hours_window');
    memory.pain.status = memory.pain.status === 'unknown'
      ? 'possible_worth_measuring' : memory.pain.status;
    return {
      say: `${reflect(utterance)} What happens after hours when one of those comes in — `
        + 'does it wait until the morning, or does somebody pick it up that night?',
      source: 'probe', componentId: 'after_hours_window', terminal: false,
      reasonCodes: ['prospect_named_uncovered_window'],
    };
  }

  // --- 5. the qualification gate ----------------------------------------------
  const willingness = readWillingness(utterance, hasStated(memory, 'strategy_call_offer'));
  if (willingness === 'explicit_yes') {
    memory.prospectIntent = { current: 'wants_strategy_call', confidence: 'high' };
  }

  const readiness = assessReadiness({
    memory,
    prospectRequestedNextStep: willingness === 'explicit_yes',
    bookingAvailable: tools.booking,
    discoveryDepth: state.discoveryDepth,
    maxDiscoveryDepth: state.maxDiscoveryDepth,
  });
  memory.nextStep.readiness = readiness.recommendation;
  memory.nextStep.reasonCodes = readiness.reasonCodes;

  switch (readiness.recommendation) {
    case 'BOOK_NOW': {
      if (hasStated(memory, 'strategy_call_offer')) {
        return {
          say: 'Let me get some times and come straight back to you.',
          source: 'offer', componentId: 'booking', terminal: false,
          reasonCodes: readiness.reasonCodes,
        };
      }
      markStated(memory, 'strategy_call_offer');
      return {
        say: reflect(utterance) + ' ' + meetingOffer(family?.meeting_frame ?? null),
        source: 'offer', componentId: readiness.path ?? 'book_now', terminal: false,
        reasonCodes: readiness.reasonCodes,
      };
    }
    case 'ROUTE_VIA_GATEKEEPER': {
      // A gatekeeper is routing the call, not receiving the pitch. Ask for the route,
      // take what they give, and stop selling.
      const who = memory.routing.correctedPersonName ?? 'them';
      if (!memory.routing.correctedPersonName) {
        return {
          say: 'Understood, and thank you — who would actually own that side of things '
            + 'so I am not taking up your time with it?',
          source: 'gatekeeper', componentId: 'ask_correct_owner', terminal: false,
          reasonCodes: readiness.reasonCodes,
        };
      }
      if (!memory.routing.extension && !memory.routing.businessSuppliedEmail
          && !memory.routing.bestCallbackTimeText) {
        return {
          say: `That is helpful, thank you. What is the best way to reach ${who} — `
            + 'an extension, a business email, or a better time to try?',
          source: 'gatekeeper', componentId: 'ask_route_to_owner', terminal: false,
          reasonCodes: readiness.reasonCodes,
        };
      }
      return {
        say: `Got it — I will try ${who} that way. Thanks for pointing me in the right `
          + 'direction, and I will leave you to it.',
        source: 'gatekeeper', componentId: 'route_captured', terminal: true,
        reasonCodes: [...readiness.reasonCodes, 'route_captured'],
      };
    }
    case 'END_NO_NEED':
      return {
        say: noSaleExit(), source: 'exit', componentId: 'no_need', terminal: true,
        reasonCodes: readiness.reasonCodes,
      };
    case 'SEND_TARGETED_INFO':
      return {
        say: cardLine(cardFor('send me an email')?.card ?? {}, {})
          ?? 'Sure — what should I make it about so it is actually useful?',
        source: 'card', componentId: 'send_email', terminal: false,
        reasonCodes: readiness.reasonCodes,
      };
    case 'CALLBACK':
      return {
        say: memory.nextStep.callbackTimeText
          ? 'That works — I will call you back then. Thanks for your time.'
          : 'Sure. What time works better for you?',
        source: 'card', componentId: 'call_me_back',
        terminal: Boolean(memory.nextStep.callbackTimeText),
        reasonCodes: readiness.reasonCodes,
      };
    case 'DISQUALIFY_OR_REVIEW':
      return {
        say: 'It sounds like this may not be a priority right now, and I would rather say that '
          + 'than push. Thanks for your time.',
        source: 'exit', componentId: 'disqualify', terminal: true,
        reasonCodes: readiness.reasonCodes,
      };
    default: {
      // CONTINUE_BRIEFLY: reflect what they said, then ask the next single probe.
      const probe = nextProbe(family, memory.probesAsked);
      if (!probe && memory.pain.status === 'unknown') {
        // Nothing has been established yet, so there is nothing to offer a meeting
        // about. Ask the plain process question rather than pitching into a vacuum.
        memory.probesAsked.push('fallback_process');
        return {
          say: `${reflect(utterance)} ${pack.firstQuestion
            ?? 'What normally happens to an enquiry that comes in when nobody can pick it up?'}`,
          source: 'probe', componentId: 'fallback_process', terminal: false,
          reasonCodes: ['no_family_question_available', 'nothing_established_yet'],
        };
      }
      if (!probe) {
        return {
          say: reflect(utterance) + ' ' + meetingOffer(family?.meeting_frame ?? null),
          source: 'offer', componentId: 'probes_exhausted', terminal: false,
          reasonCodes: [...readiness.reasonCodes, 'no_probes_left'],
        };
      }
      memory.probesAsked.push(probe.key);
      return {
        say: `${reflect(utterance)} ${probe.question}`,
        source: 'probe', componentId: probe.key, terminal: false,
        reasonCodes: readiness.reasonCodes,
      };
    }
  }
}

/**
 * Booking is synchronous here because the simulator drives it; a real runtime awaits
 * the same bridge. The rules are the ones that matter: never name a slot the tool did
 * not return, and never say booked until the provider confirms.
 */
async function handleBooking(state: AgentState, utterance: string): Promise<AgentTurn | null> {
  const { memory, tools } = state;

  if (!tools.booking || !state.booking) {
    // No booking tool means no promise of a time (state machine §28).
    memory.booking.providerStatus = 'failed';
    memory.nextStep.readiness = 'CALLBACK';
    const preferred = extractPreferredTime(utterance);
    if (preferred) memory.nextStep.callbackTimeText = preferred;
    return {
      say: 'I cannot put it in the calendar from here, so let me capture the time you prefer and '
        + 'have it confirmed and sent across. Please treat it as tentative until you see the invite.',
      source: 'offer', componentId: 'booking_unavailable', terminal: false,
      reasonCodes: ['booking_tool_unavailable', 'human_follow_up_created'],
    };
  }

  const email = extractEmail(utterance);
  if (email) memory.booking.attendeeEmail = email;
  const timezone = extractTimezone(utterance);
  if (timezone) memory.booking.prospectTimezone = timezone;

  // Step 1 — real availability, before any time is spoken.
  if (memory.booking.providerStatus === 'not_started') {
    memory.booking.providerStatus = 'checking';
    const slots = await state.booking.getSlots();
    state.offeredSlots = Array.isArray(slots) ? slots.slice(0, 2) : [];
    memory.booking.candidateSlots = state.offeredSlots.map((slot) => slot.spoken);

    if (state.offeredSlots.length === 0) {
      // Nothing returned means nothing offered. Capture their preference instead.
      memory.booking.providerStatus = 'failed';
      memory.nextStep.callbackTimeText = extractPreferredTime(utterance);
      return {
        say: 'I am not seeing anything suitable on the calendar in that window, so rather than '
          + 'guess at a time, tell me roughly when suits and I will get it confirmed and sent over.',
        source: 'offer', componentId: 'no_slots_available', terminal: false,
        reasonCodes: ['no_provider_slots', 'captured_preference'],
      };
    }

    memory.booking.providerStatus = 'slots_ready';

    // If they already named a time and the calendar actually has it, take it rather
    // than reading the list back at them.
    const alreadyChosen = matchSlot(state.offeredSlots, utterance);
    if (alreadyChosen) {
      memory.booking.selectedSlot = alreadyChosen.token;
      if (!memory.booking.attendeeEmail) {
        return {
          say: `${alreadyChosen.spoken} works on my side too. What is the best email for the invite?`,
          source: 'offer', componentId: 'collect_email', terminal: false,
          reasonCodes: ['availability_checked', 'slot_selected', 'collecting_attendee_email'],
        };
      }
      return await commitBooking(state, alreadyChosen);
    }

    return {
      say: `I have ${state.offeredSlots.map((slot) => slot.spoken).join(' or ')}. `
        + 'Would either of those work?',
      source: 'offer', componentId: 'slots_offered', terminal: false,
      reasonCodes: ['availability_checked', `offered_${state.offeredSlots.length}_slots`],
    };
  }

  // Step 2 — the email arrived after a slot was already chosen.
  if (memory.booking.selectedSlot && memory.booking.attendeeEmail
      && memory.booking.providerStatus !== 'confirmed') {
    const already = state.offeredSlots.find((slot) => slot.token === memory.booking.selectedSlot);
    if (already) return await commitBooking(state, already);
  }

  // Step 3 — they picked one of the offered slots.
  if (memory.booking.providerStatus === 'slots_ready') {
    const chosen = matchSlot(state.offeredSlots, utterance);
    if (!chosen) {
      const preferred = extractPreferredTime(utterance);
      if (preferred) {
        memory.nextStep.callbackTimeText = preferred;
        return {
          say: 'That is not one I have open, so let me check properly and come back to you with '
            + 'a time that actually holds rather than guessing.',
          source: 'offer', componentId: 'slot_not_offered', terminal: false,
          reasonCodes: ['requested_time_not_available', 'captured_preference'],
        };
      }
      return {
        say: 'Would either of those work, or would another day suit better?',
        source: 'offer', componentId: 'slots_offered', terminal: false,
        reasonCodes: ['awaiting_slot_choice'],
      };
    }

    memory.booking.selectedSlot = chosen.token;
    if (!memory.booking.attendeeEmail) {
      return {
        say: `${chosen.spoken} it is. What is the best email for the invite?`,
        source: 'offer', componentId: 'collect_email', terminal: false,
        reasonCodes: ['slot_selected', 'collecting_attendee_email'],
      };
    }
    return await commitBooking(state, chosen);
  }

  return null;
}

async function commitBooking(state: AgentState, slot: OfferedSlot): Promise<AgentTurn> {
  const { memory } = state;
  memory.booking.providerStatus = 'booking';
  const result = await state.booking!.book({ slot, email: memory.booking.attendeeEmail });

  if (!result.ok) {
    // A failed booking is never spoken as confirmed (state machine §34).
    memory.booking.providerStatus = 'failed';
    memory.nextStep.readiness = 'CALLBACK';
    memory.nextStep.callbackTimeText = slot.spoken;
    return {
      say: 'I was not able to lock that in on the calendar just now, so I will have it confirmed '
        + 'and sent across. Please treat it as tentative until you see the invite.',
      source: 'offer', componentId: 'booking_failed', terminal: false,
      reasonCodes: ['provider_failed', 'human_follow_up_created', 'confirmation_pending'],
    };
  }

  memory.booking.providerStatus = 'confirmed';
  markStated(memory, 'booking_confirmation');
  return {
    say: `You are confirmed for ${slot.spoken}${
      memory.booking.attendeeEmail ? `, and the invite is going to ${memory.booking.attendeeEmail}` : ''
    }. Thanks for your time.`,
    source: 'offer', componentId: 'booking_confirmed', terminal: true,
    reasonCodes: ['provider_confirmed'],
  };
}


/** Which approved example a keyed card should use, given the opener actually spoken. */
const OPENER_EXAMPLE_KEY: Record<string, string> = {
  PAID_DEMAND: 'paid_demand',
  BUSINESS_SIGNAL: 'category',
  MARKET_CATEGORY: 'category',
  ROLE_PROCESS: 'category',
  PRIOR_RELATIONSHIP: 'prior_relationship',
};

/**
 * Answers for cards that state required behaviour but carry no approved wording.
 * Every answer here is drawn from session state or from what the repository actually
 * records; where neither can answer, the agent says so rather than guessing.
 */
function behaviouralCardAnswer(cardId: string, state: AgentState): string | null {
  switch (cardId) {
    case 'asks_if_ai':
      // This profile only ever speaks on the AI voice channel, so the truthful answer
      // is yes. It is not an opening to pitch the product (card: do_not_turn_answer_
      // into_ai_demo_pitch).
      markStated(state.memory, 'ai_identity_disclosure');
      return `Yes — I am an AI voice assistant calling for ${'Your AI Department'}, and `
        + 'I would rather say so than pretend otherwise.';
    case 'are_you_recording':
      // Answered from actual session state; never claimed either way when unknown.
      if (state.recording === true) {
        return 'Yes — this call is recorded for quality and training, and I can stop if '
          + 'you would rather I did not.';
      }
      if (state.recording === false) return 'No, this call is not being recorded.';
      return 'I would have to confirm that rather than tell you either way.';
    case 'who_have_you_worked_with':
      // The repository holds no approved customer example to cite, so none is implied
      // (card prohibited: invented_client, implied_client_relationship, invented_results).
      return 'I am not going to drop names on a cold call, and I do not have an approved '
        + 'example I can point you at for your trade specifically.';
    default:
      return null;
  }
}

/** The prospect asking us something, which a card may need to answer. */
const PROSPECT_ASKED_SOMETHING =
  /\?\s*$|^\s*(?:who|what|why|how|when|where|are you|is this|can you|could you|do you|would you|will you|am i|does it)\b/i;

/** A time plus an acceptance is a commitment; a time alone is just information. */
const TIME_COMMITMENT =
  /\b(?:works|work for me|is good|sounds good|that'?s fine|let'?s do|i can do|book me|put me down|pencil me)\b|\b(?:i'?m|i am|we'?re|we are) open\b/i;

/** A window the prospect says is uncovered. */
const AFTER_HOURS_WINDOW =
  /\bafter.?hours?\b|\bnights?\b|\bevenings?\b|\bovernight\b|\bweekends?\b|\bgoes to voicemail\b|\bare voicemail\b|\bis voicemail\b/i;

const DISCRIMINATORY_ROUTING =
  /\b(?:route|routing|filter|screen|sort|target|steer)\b.{0,60}\b(?:ethnicit\w*|races?|racial|religion|national origin|nationality|immigrant\w*|disabilit\w*|family status|children|colou?r of their)/i;

const EMAIL_PATTERN = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/;
function extractEmail(utterance: string): string | null {
  return EMAIL_PATTERN.exec(utterance)?.[1]?.toLowerCase() ?? null;
}

function extractTimezone(utterance: string): string | null {
  if (/\beastern\b|\bet\b|\best\b/i.test(utterance)) return 'America/New_York';
  if (/\bcentral\b|\bct\b|\bcst\b/i.test(utterance)) return 'America/Chicago';
  if (/\bmountain\b|\bmt\b|\bmst\b/i.test(utterance)) return 'America/Denver';
  if (/\bpacific\b|\bpt\b|\bpst\b/i.test(utterance)) return 'America/Los_Angeles';
  return null;
}

/** Their stated preference, kept verbatim rather than turned into a slot. */
function extractPreferredTime(utterance: string): string | null {
  const match = /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|this week)\b[^.!?]*/i
    .exec(utterance);
  return match ? match[0].trim() : null;
}

/** Matches a spoken choice against the slots the tool returned. Nothing else counts. */
function matchSlot(slots: OfferedSlot[], utterance: string): OfferedSlot | null {
  const lower = utterance.toLowerCase();
  for (const slot of slots) {
    const spoken = slot.spoken.toLowerCase();
    if (lower.includes(spoken)) return slot;
    // "4:15 works" against "today at 4:15 PM".
    const time = /(\d{1,2}:\d{2})/.exec(spoken)?.[1];
    if (time && lower.includes(time)) return slot;
    const day = /(today|tomorrow|monday|tuesday|wednesday|thursday|friday)/.exec(spoken)?.[1];
    if (day && lower.includes(day) && /\b(?:works|good|fine|yes|that one|ok)\b/.test(lower)) return slot;
  }
  if (/\b(?:first|the first one|earlier)\b/.test(lower) && slots[0]) return slots[0];
  if (/\b(?:second|the second one|later)\b/.test(lower) && slots[1]) return slots[1];
  return null;
}

/**
 * Facts a gatekeeper or prospect supplies about how to reach the right person.
 * These are business-supplied, which is the strongest contact provenance there is.
 */
function captureBusinessSuppliedFacts(memory: WorkingMemory, utterance: string): void {
  const extension = /\b(?:ext(?:ension)?\.?|x)\s*(\d{1,6})\b/i.exec(utterance)?.[1];
  if (extension) memory.routing.extension = extension;

  const email = extractEmail(utterance);
  if (email) {
    memory.routing.businessSuppliedEmail = email;
    memory.booking.attendeeEmail ??= email;
  }

  // "You'd want Dave, our GM."
  // Case-insensitive on the lead-in, case-sensitive on the name. "You'd want Dave"
  // starts a sentence, so a lowercase-only pattern never matched it.
  const named = /(?:[Yy]ou'?d want|[Yy]ou want|[Tt]alk to|[Aa]sk for|[Tt]hat would be|[Ss]peak to)\s+([A-Z][a-z]+)\b/
    .exec(utterance);
  if (named) {
    memory.routing.correctedPersonName = named[1]!;
    memory.routing.gatekeeperDetected = true;
    if (memory.stakeholder.relevance === 'unknown') memory.stakeholder.relevance = 'routing_only';
  }
  const role = /\b(?:our|the)\s+(GM|general manager|owner|operations manager|office manager|service manager)\b/i
    .exec(utterance);
  if (role) memory.routing.correctedRole = role[1]!;

  const callback = /\bcall (?:me|him|her|them) (?:back )?(?:on )?(\w+day|tomorrow|next week)\b/i
    .exec(utterance);
  if (callback) {
    memory.routing.bestCallbackTimeText = callback[0];
    memory.nextStep.callbackTimeText = callback[0];
  }
}

/**
 * A short reflection of what they said, so the prospect hears they were listened to.
 * Deliberately literal: it echoes their own words rather than reinterpreting them.
 */
function reflect(utterance: string): string {
  const trimmed = utterance.trim().replace(/\s+/g, ' ');
  if (/voicemail/i.test(trimmed)) return 'Got it — so it lands in voicemail.';
  if (/answering service/i.test(trimmed)) return 'Okay, so an answering service picks it up.';
  if (/next (?:morning|day)/i.test(trimmed)) return 'So it waits until the next day.';
  if (/message/i.test(trimmed)) return 'So a message gets taken.';
  if (/(?:don'?t|do not|can'?t|cannot)\s+(?:really\s+)?(?:know|track|tell|see)/i.test(trimmed)) {
    return 'Okay, so there is not much visibility on that.';
  }
  if (/supposed to/i.test(trimmed)) return 'So it depends on people remembering.';
  return 'Understood.';
}

function describeProcess(pack: CallPack): string {
  return (pack.primaryHypothesisCategory ?? 'lead handling').replace(/_/g, ' ');
}

const NUMBER_PATTERNS: [RegExp, string][] = [
  [/\b(?:about|around|maybe|roughly|probably)?\s*(\d{1,4})\s*(?:calls?|leads?)\s*(?:a|per)\s*(?:day|week|month)\b/i, 'call_volume'],
  [/\baverage\s+(?:job|ticket|sale)\s+(?:is\s+)?(?:about|around|roughly|maybe)?\s*\$?\s*([\d,]{2,9})\b/i, 'job_value'],
  [/\$\s*([\d,]{2,9})\b/, 'currency_amount'],
  [/\b(\d{1,3})\s*(?:%|percent)\b/i, 'percentage'],
  [/\b(?:we\s+)?(?:have|employ|run)\s+(\d{1,4})\s+(?:people|employees|techs|technicians|staff|crews)\b/i, 'headcount'],
];

function captureNumbers(memory: WorkingMemory, utterance: string): void {
  for (const [pattern, label] of NUMBER_PATTERNS) {
    const match = pattern.exec(utterance);
    if (!match) continue;
    const approximate = /\b(?:about|around|maybe|roughly|probably)\b/i.test(match[0]);
    recordNumber(memory, label, match[0].trim(),
      approximate ? 'prospect_approximate' : 'prospect_exact');
  }
}

const SYSTEM_NAMES = [
  'servicetitan', 'housecall pro', 'jobber', 'salesforce', 'hubspot', 'zoho', 'pipedrive',
  'callrail', 'podium', 'quickbooks', 'acculynx', 'jobnimbus', 'ccc one', 'mitchell',
  'clio', 'mycase', 'dentrix', 'follow up boss', 'kvcore',
];

function captureSystems(memory: WorkingMemory, utterance: string): void {
  const lower = utterance.toLowerCase();
  for (const name of SYSTEM_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(lower)) {
      recordSystem(memory, name);
    }
  }
}

export { assessReadiness, meetingOffer, noSaleExit, selectOpener, questionFor };
