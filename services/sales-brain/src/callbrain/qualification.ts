import type {
  PainStatus, Readiness, StakeholderRelevance, Willingness, WorkingMemory,
} from './workingMemory.js';

/**
 * Strategy-call readiness gate.
 * Authority: outbound-sales-brain-strategy-call-qualification-gate-spec.md.
 *
 * Categorical, not a probability. The spec is explicit that politeness is `neutral`,
 * not `interested`, and that a public hypothesis never becomes `confirmed_meaningful`
 * on its own. This is the gate that stops a friendly call becoming a wasted meeting
 * on Michael's calendar.
 */

export interface ReadinessDecision {
  recommendation: Readiness;
  painStatus: PainStatus;
  stakeholderRelevance: StakeholderRelevance;
  willingness: Willingness;
  reasonCodes: string[];
  /** Which documented path produced a BOOK_NOW, for the decision trace. */
  path: 'A_confirmed_problem' | 'B_worth_measuring' | 'C_prospect_requested'
    | 'D_multi_stakeholder' | null;
  supportingTurns: number[];
}

/** Language that indicates a genuine ask, not politeness. */
const AGREES_WORTH_EXAMINING =
  /\bworth (?:a )?(?:proper )?(?:look|looking at|checking|a check|exploring|reviewing)\b|\bprobably worth\b|\bwould be (?:useful|helpful|worth it)\b/i;
const EXPLICIT_YES = /\b(?:yes|yeah|sure|okay|ok|sounds good|that works|let'?s do it|i'?d be open|book it|set it up|why not)\b/i;
const EXPLICIT_REQUEST = new RegExp(
  '\\b(?:can we|could we|i\'?d like to|let\'?s|send me a time|what times?|put something)\\b.{0,30}'
  + '\\b(?:talk|meet|call|chat|calendar|time)\\b'
  // "Have Michael take a look" is as explicit a request as "let's talk".
  + '|\\bhave\\s+\\w+\\s+(?:take a look|look at|have a look)'
  + '|\\b(?:set|put)\\s+(?:something|a time|it)\\s+up\\b',
  'i');
const EXPLICIT_NO = /\b(?:no thanks|not interested|we'?re (?:all )?(?:good|set|fine)|i'?ll pass|don'?t (?:need|want))\b/i;
const BUSY_BUT_OPEN = /\b(?:busy|slammed|swamped|bad time|call me back|later|next week|tomorrow)\b/i;
/** Politeness. Deliberately mapped to neutral, never to interested. */
const POLITE = /\b(?:interesting|makes sense|fair enough|i hear you|good question|sure, ok)\b/i;

export function readWillingness(utterance: string, offerAlreadyMade = true): Willingness {
  if (EXPLICIT_NO.test(utterance)) return 'explicit_no';
  // These stand on their own words, with or without a prior offer.
  if (EXPLICIT_REQUEST.test(utterance)) return 'explicit_yes';
  if (AGREES_WORTH_EXAMINING.test(utterance)) return 'explicit_yes';
  // A bare "yeah" is agreement only if there was something to agree to. Otherwise it
  // is just someone answering their phone.
  if (offerAlreadyMade && EXPLICIT_YES.test(utterance)) return 'explicit_yes';
  if (BUSY_BUT_OPEN.test(utterance)) return 'busy_but_open';
  // "That's interesting" is not interest in a meeting.
  if (POLITE.test(utterance)) return 'neutral';
  return 'neutral';
}

export interface ReadinessInput {
  memory: WorkingMemory;
  /** True when the prospect explicitly asked for a next step. */
  prospectRequestedNextStep?: boolean;
  /** True when a booking tool is actually available right now. */
  bookingAvailable: boolean;
  /** Turns of discovery already spent, to stop the call becoming free consulting. */
  discoveryDepth: number;
  maxDiscoveryDepth: number;
}

export function assessReadiness(input: ReadinessInput): ReadinessDecision {
  const { memory } = input;
  const reasonCodes: string[] = [];
  const supportingTurns = memory.pain.prospectWording.map((entry) => entry.sourceTurn);

  const pain = memory.pain.status;
  const stakeholder = memory.stakeholder.relevance;
  const willingness = deriveWillingness(memory);

  const decide = (
    recommendation: Readiness, path: ReadinessDecision['path'], codes: string[],
  ): ReadinessDecision => ({
    recommendation, painStatus: pain, stakeholderRelevance: stakeholder, willingness,
    reasonCodes: [...reasonCodes, ...codes], path, supportingTurns,
  });

  // --- terminal reads --------------------------------------------------------
  if (memory.priorityActions.dncDetected) {
    return decide('DISQUALIFY_OR_REVIEW', null, ['dnc_requested']);
  }
  if (pain === 'solved_strong_process' && memory.hypothesis.backupUsed) {
    // Both hypotheses tested and handled. This is a professional no-sale, not a
    // failure, and the spec is explicit that it should be accepted.
    return decide('END_NO_NEED', null, ['process_already_handled', 'backup_also_handled']);
  }
  if (pain === 'no_problem' || willingness === 'explicit_no') {
    return decide('END_NO_NEED', null, ['no_need_stated']);
  }

  // --- a gatekeeper does not book Michael ------------------------------------
  if (stakeholder === 'routing_only') {
    return decide('ROUTE_VIA_GATEKEEPER', null,
      ['routing_only_stakeholder', 'needs_correct_stakeholder']);
  }
  if (stakeholder === 'wrong_person') {
    return decide('DISQUALIFY_OR_REVIEW', null, ['wrong_person']);
  }

  // --- explicit requests -----------------------------------------------------
  if (memory.nextStep.emailRequested) {
    return decide('SEND_TARGETED_INFO', null, ['prospect_requested_email']);
  }
  if (memory.nextStep.callbackTimeText) {
    return decide('CALLBACK', null, ['prospect_specified_callback_time']);
  }

  const relevantStakeholder = stakeholder === 'decision_owner' || stakeholder === 'strong_influencer';

  // Path C — the prospect asked for the next step themselves. Somebody who asks to
  // involve Michael is speaking for the business unless we already know they are
  // only routing, which is handled above.
  const requesterIsRelevant = relevantStakeholder || stakeholder === 'unknown';
  if (input.prospectRequestedNextStep && requesterIsRelevant) {
    return input.bookingAvailable
      ? decide('BOOK_NOW', 'C_prospect_requested', ['prospect_requested_next_step'])
      : decide('CALLBACK', null, ['prospect_requested_next_step', 'booking_tool_unavailable']);
  }

  // Path A — a confirmed, meaningful problem with a relevant stakeholder.
  if (relevantStakeholder && pain === 'confirmed_meaningful'
      && ['explicit_yes', 'interested', 'busy_but_open'].includes(willingness)) {
    return input.bookingAvailable
      ? decide('BOOK_NOW', 'A_confirmed_problem', ['confirmed_meaningful_problem'])
      : decide('CALLBACK', null, ['confirmed_meaningful_problem', 'booking_tool_unavailable']);
  }

  // Path B — worth measuring. The spec requires the prospect to *agree* it is worth
  // mapping; being engaged is not the same as agreeing, and offering on engagement
  // alone is what makes a cold call feel pushy.
  if (relevantStakeholder && pain === 'possible_worth_measuring'
      && (input.prospectRequestedNextStep || willingness === 'explicit_yes')) {
    return input.bookingAvailable
      ? decide('BOOK_NOW', 'B_worth_measuring', ['insufficient_data', 'prospect_open_to_measuring'])
      : decide('CALLBACK', null, ['insufficient_data', 'booking_tool_unavailable']);
  }

  // --- keep going, but not forever -------------------------------------------
  if (input.discoveryDepth >= input.maxDiscoveryDepth) {
    // The cold call must not become free consulting (§7).
    const haveSomething = pain === 'confirmed_meaningful' || pain === 'confirmed_minor'
      || pain === 'possible_worth_measuring';
    if (haveSomething && input.bookingAvailable) {
      return decide('BOOK_NOW', 'B_worth_measuring',
        ['discovery_ceiling_reached', 'problem_not_yet_sized', 'stop_consulting_make_the_ask']);
    }
    return haveSomething
      ? decide('CALLBACK', null, ['discovery_ceiling_reached', 'problem_not_yet_sized'])
      : decide('DISQUALIFY_OR_REVIEW', null, ['discovery_ceiling_reached', 'no_clear_problem']);
  }

  if (willingness === 'busy_but_open') {
    return decide('CALLBACK', null, ['stakeholder_busy_but_open']);
  }

  return decide('CONTINUE_BRIEFLY', null, [
    pain === 'unknown' ? 'problem_still_unclear' : `pain_${pain}`,
    relevantStakeholder ? 'stakeholder_relevant' : 'stakeholder_unclear',
  ]);
}

function deriveWillingness(memory: WorkingMemory): Willingness {
  switch (memory.prospectIntent.current) {
    case 'wants_strategy_call': return 'explicit_yes';
    case 'not_interested': return 'not_interested';
    case 'busy': return 'busy_but_open';
    case 'wants_callback': return 'busy_but_open';
    case 'engaged': return 'interested';
    default: return 'neutral';
  }
}

/** The words used to offer the meeting. Never a hard close. */
export function meetingOffer(meetingFrame: string | null): string {
  const frame = meetingFrame
    ?? 'map the workflow, get the real numbers, and see whether there is actually a business case';
  return `Based on what you just told me, I think this is worth a proper look. Rather than guess `
    + `on the phone, the next step would be a short conversation with Michael to ${frame}. `
    + `Would you be open to that?`;
}

/** The words used to exit when the process is genuinely handled. */
export function noSaleExit(): string {
  return 'That sounds like it is already handled properly, so I will not waste your time. '
    + 'Thanks for hearing me out.';
}
