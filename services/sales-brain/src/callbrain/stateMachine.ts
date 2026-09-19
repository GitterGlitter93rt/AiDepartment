import { detectPriorityIntent, PRIORITY_RESPONSES, type PriorityIntent } from './intent.js';

/**
 * Cold-call conversation state machine.
 * Authority: outbound-sales-brain-conversation-state-machine.md.
 *
 * The division of labour, from §36 of that spec: the realtime model proposes
 * language and reads intent; **orchestration owns terminal, action and safety
 * transitions**. A model that decides to keep pitching after someone says "take me
 * off your list" must be unable to.
 *
 * Testable without Twilio by design — the whole thing runs on text events.
 */

export type CallState =
  | 'connecting' | 'answer_classification' | 'opening' | 'role_check' | 'gatekeeper'
  | 'hook' | 'listen' | 'discovery' | 'probe' | 'quantify' | 'position'
  | 'objection' | 'next_step' | 'action_in_progress' | 'confirmation' | 'close' | 'terminal';

export type TerminalReason =
  | 'completed' | 'voicemail_left' | 'no_answer' | 'wrong_number' | 'dnc'
  | 'prospect_ended' | 'disqualified' | 'transferred' | 'technical_failure'
  | 'policy_terminated' | 'carrier_failure';

export type AnswerType = 'human' | 'voicemail' | 'no_answer' | 'ivr' | 'busy';

export interface AvailableTools {
  /** True only when a calendar provider is configured AND reachable. */
  booking: boolean;
  suppression: boolean;
  followUp: boolean;
  /** True only when a real transfer destination exists. */
  transfer: boolean;
  sms: boolean;
  email: boolean;
}

export interface CallEvent {
  type:
    | 'answered' | 'prospect_said' | 'agent_said' | 'tool_result'
    | 'timeout' | 'carrier_failure' | 'operator_stop';
  text?: string;
  answerType?: AnswerType;
  toolName?: string;
  toolOk?: boolean;
  toolDetail?: Record<string, unknown>;
}

export interface DiscoveryFindings {
  /** Which hypothesis is being tested right now. */
  activeHypothesis: string | null;
  hypothesesTested: string[];
  /** Set when the prospect demonstrates the process is already handled. */
  contradicted: string[];
  problemConfirmed: boolean;
  /** Numbers the prospect volunteered. Never inferred. */
  economicInputs: { label: string; value: string }[];
  systemsNamed: string[];
  objectionsRaised: string[];
  decisionMakerCorrection: string | null;
  verbatim: string[];
}

export interface CallContext {
  state: CallState;
  terminalReason: TerminalReason | null;
  turnCount: number;
  discoveryDepth: number;
  gatekeeperTurns: number;
  findings: DiscoveryFindings;
  tools: AvailableTools;
  priorityIntent: PriorityIntent | null;
  /** Everything orchestration decided, in order, for the QA record. */
  transcript: { speaker: 'agent' | 'prospect' | 'system'; text: string; state: CallState }[];
  /** Set when orchestration overrode what the model wanted to do. */
  overrides: string[];
  disposition: string | null;
  nextStep: string | null;
}

/**
 * Discovery has a ceiling. Without one, a model that has not found a problem keeps
 * hunting for a different one, which is the "third and fourth product hunt" the
 * state machine spec explicitly rules out (§31).
 */
export const MAX_DISCOVERY_DEPTH = 3;
export const MAX_HYPOTHESES = 2;
export const MAX_GATEKEEPER_TURNS = 3;
/** A cold call that runs long has stopped being a cold call. */
export const MAX_TURNS = 40;

export function createCallContext(tools: AvailableTools, primaryHypothesis: string | null): CallContext {
  return {
    state: 'connecting',
    terminalReason: null,
    turnCount: 0,
    discoveryDepth: 0,
    gatekeeperTurns: 0,
    findings: {
      activeHypothesis: primaryHypothesis,
      hypothesesTested: [],
      contradicted: [],
      problemConfirmed: false,
      economicInputs: [],
      systemsNamed: [],
      objectionsRaised: [],
      decisionMakerCorrection: null,
      verbatim: [],
    },
    tools,
    priorityIntent: null,
    transcript: [],
    overrides: [],
    disposition: null,
    nextStep: null,
  };
}

export interface Transition {
  from: CallState;
  to: CallState;
  reason: string;
  /** What the agent must say, when orchestration dictates it rather than the model. */
  requiredUtterance?: string;
  /** Actions orchestration is committing to, independent of the model. */
  actions: OrchestrationAction[];
  terminalReason?: TerminalReason;
}

export type OrchestrationAction =
  | { kind: 'suppress'; scope: 'account'; reason: string }
  | { kind: 'mark_wrong_number' }
  | { kind: 'create_follow_up'; followUpType: string; reason: string; rawTiming?: string }
  | { kind: 'capture_correction'; name?: string }
  | { kind: 'route_to_human'; reason: string }
  | { kind: 'record_disposition'; disposition: string }
  | { kind: 'offer_booking' }
  | { kind: 'stop_audio' };

/** Brush-offs that are objections to work through, not reasons to stop. */
const OBJECTION_MARKERS: RegExp[] = [
  /\bsend\s+(?:me\s+)?(?:an?\s+)?(?:email|info|information|something)\b/i,
  /\bwe\s+(?:already\s+)?(?:use|have)\s+(?:chat\s?gpt|ai|a crm|a receptionist|an? it (?:company|guy)|a marketing agency)\b/i,
  /\bnot\s+interested\b/i,
  /\bhow\s+did\s+you\s+get\s+(?:my|this)\s+number\b/i,
  /\bis\s+this\s+(?:a\s+)?(?:robot|bot|ai|recording|automated)\b/i,
  /\bwhat\s+(?:exactly\s+)?do\s+you\s+(?:guys\s+)?do\b/i,
];

/** Language showing the process is already handled — a reason to stop, honestly. */
const STRONG_PROCESS_MARKERS: RegExp[] = [
  /\b(?:we|it)\s+(?:have|has|got)\s+(?:an?\s+)?(?:answering service|after[- ]hours (?:service|team|crew)|24[/ ]?7 (?:team|staff|coverage))\b/i,
  /\bnever\s+(?:miss|missed)\s+(?:a\s+)?calls?\b/i,
  /\b(?:someone|somebody)\s+(?:is\s+)?always\s+(?:answers?|answering|on call|available)\b/i,
  /\bthat'?s?\s+(?:all\s+)?(?:already\s+)?(?:handled|covered|taken care of|sorted)\b/i,
  /\bwe\s+(?:have|use)\s+a\s+(?:full[- ]time\s+)?(?:dispatcher|call cent(?:er|re))\b/i,
  /\b(?:they|those|estimates?|quotes?|proposals?|leads?|calls?)\s+(?:are|get)\s+(?:all\s+)?(?:followed up|worked|chased|handled)\b/i,
  /\bwe\s+(?:always\s+)?follow\s+up\s+on\s+(?:everything|every ?one|them all|all of them)\b/i,
  /\b(?:someone|somebody)\s+(?:is\s+)?always\s+on\s+(?:it|that|those|them)\b/i,
  /\bwe'?ve\s+got\s+(?:that|it|this)\s+covered\b/i,
];

const GATEKEEPER_MARKERS: RegExp[] = [
  /\b(?:he|she|they)'?s?\s+(?:not\s+)?(?:available|in|here|around)\b/i,
  /\bcan\s+i\s+(?:ask|tell (?:him|her|them))\s+(?:who'?s?|what)\s+(?:calling|this is about)\b/i,
  /\bwhat\s+(?:is\s+)?this\s+(?:is\s+)?(?:regarding|about|in reference to)\b/i,
  /\bwho'?s?\s+calling\b/i,
  /\b(?:i'?ll|can i|shall i|let me)\s+(?:take|pass on|leave)\s+a\s+message\b/i,
  /\bfront\s+desk\b/i,
];

/** A number the prospect actually said. Never inferred from anything else. */
function extractEconomics(text: string): { label: string; value: string }[] {
  const found: { label: string; value: string }[] = [];
  const patterns: [RegExp, string][] = [
    [/\b(?:about|around|maybe|roughly|probably)?\s*(\d{1,4})\s*(?:calls?|leads?)\s*(?:a|per)\s*(day|week|month)\b/i, 'call_volume'],
    [/\b(?:about|around|maybe|roughly)?\s*\$?\s*([\d,]{2,9})\s*(?:dollars?)?\s*(?:a|per)\s*(?:job|ticket|customer|sale)\b/i, 'job_value'],
    [/\baverage\s+(?:job|ticket|sale)\s+(?:is\s+)?(?:about|around|roughly|maybe)?\s*\$?\s*([\d,]{2,9})\b/i, 'job_value'],
    [/\b(\d{1,3})\s*(?:%|percent)\b/i, 'percentage'],
    [/\b(?:we\s+)?(?:have|employ)\s+(\d{1,4})\s+(?:people|employees|techs|technicians|staff)\b/i, 'headcount'],
  ];
  for (const [pattern, label] of patterns) {
    const match = pattern.exec(text);
    if (match) found.push({ label, value: match[0].trim() });
  }
  return found;
}

const SYSTEM_NAMES = [
  'servicetitan', 'housecall pro', 'jobber', 'salesforce', 'hubspot', 'zoho', 'pipedrive',
  'callrail', 'podium', 'quickbooks', 'sage', 'acculynx', 'jobnimbus', 'ccc one', 'mitchell',
  'clio', 'mycase', 'dentrix', 'eaglesoft', 'open dental', 'follow up boss', 'kvcore',
];

function extractSystems(text: string): string[] {
  const lower = text.toLowerCase();
  // Word-boundary matching, not substring. A plain `includes` reads "sage" out of
  // "message" and records a CRM the prospect never named — precisely the kind of
  // invented fact the doctrine forbids.
  return SYSTEM_NAMES.filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(lower);
  });
}

/**
 * Advances the conversation.
 *
 * Priority intents are evaluated before anything else and can transition from any
 * live state. Nothing the model proposes can override them.
 */
export function step(context: CallContext, event: CallEvent): Transition {
  if (context.state === 'terminal') {
    return { from: 'terminal', to: 'terminal', reason: 'already terminal', actions: [] };
  }

  // --- forced stops --------------------------------------------------------
  if (event.type === 'carrier_failure') {
    return terminal(context, 'carrier_failure', 'carrier failure', []);
  }
  if (event.type === 'operator_stop') {
    return terminal(context, 'policy_terminated', 'operator kill switch', [{ kind: 'stop_audio' }]);
  }

  // --- answer classification ----------------------------------------------
  if (event.type === 'answered') {
    switch (event.answerType) {
      case 'voicemail':
        return {
          from: context.state, to: 'terminal', reason: 'voicemail detected',
          terminalReason: 'voicemail_left', actions: [{ kind: 'record_disposition', disposition: 'VOICEMAIL' }],
        };
      case 'no_answer':
      case 'busy':
        return terminal(context, 'no_answer', 'no answer',
          [{ kind: 'record_disposition', disposition: 'NO_ANSWER' }]);
      case 'ivr':
        return { from: context.state, to: 'connecting', reason: 'IVR detected; awaiting a human', actions: [] };
      default:
        return { from: context.state, to: 'opening', reason: 'human answered', actions: [] };
    }
  }

  if (event.type !== 'prospect_said' || !event.text) {
    return { from: context.state, to: context.state, reason: 'no state change', actions: [] };
  }

  const said = event.text;
  context.turnCount += 1;

  // --- priority interrupts, from any live state ----------------------------
  const priority = detectPriorityIntent(said);
  if (priority) {
    context.priorityIntent = priority;
    switch (priority.deterministicAction) {
      case 'suppress_and_end':
        context.overrides.push(`DNC detected in "${priority.matchedText}" — sales flow terminated`);
        return {
          from: context.state, to: 'terminal', reason: 'do-not-contact requested',
          terminalReason: 'dnc',
          requiredUtterance: PRIORITY_RESPONSES.DNC,
          actions: [
            { kind: 'stop_audio' },
            { kind: 'suppress', scope: 'account', reason: `Prospect said: "${priority.matchedText}"` },
            { kind: 'record_disposition', disposition: 'DO_NOT_CONTACT' },
          ],
        };
      case 'record_and_end':
        return {
          from: context.state, to: 'terminal', reason: 'wrong number',
          terminalReason: 'wrong_number',
          requiredUtterance: PRIORITY_RESPONSES.WRONG_NUMBER,
          actions: [{ kind: 'mark_wrong_number' }, { kind: 'record_disposition', disposition: 'WRONG_NUMBER' }],
        };
      case 'apologize_and_end':
        return {
          from: context.state, to: 'terminal', reason: 'hostile response',
          terminalReason: 'prospect_ended',
          requiredUtterance: PRIORITY_RESPONSES.HOSTILE,
          actions: [{ kind: 'stop_audio' }, { kind: 'record_disposition', disposition: 'NOT_A_FIT' }],
        };
      case 'end_politely':
        return {
          from: context.state, to: 'terminal', reason: 'prospect ended the call',
          terminalReason: 'prospect_ended',
          requiredUtterance: PRIORITY_RESPONSES.END_CALL,
          actions: [{ kind: 'record_disposition', disposition: context.findings.problemConfirmed ? 'POSSIBLE_OPPORTUNITY' : 'NOT_A_FIT' }],
        };
      case 'route_to_human':
        // Never promise a transfer we cannot perform.
        if (!context.tools.transfer) {
          context.overrides.push('transfer requested but no transfer destination is configured');
          return {
            from: context.state, to: 'terminal', reason: 'human requested; no transfer available',
            terminalReason: 'completed',
            requiredUtterance: PRIORITY_RESPONSES.HUMAN_REQUESTED,
            actions: [
              { kind: 'create_follow_up', followUpType: 'CALLBACK', reason: 'prospect asked to speak to a person' },
              { kind: 'record_disposition', disposition: 'CALLBACK_REQUESTED' },
            ],
          };
        }
        return {
          from: context.state, to: 'action_in_progress', reason: 'transferring to a person',
          actions: [{ kind: 'route_to_human', reason: 'prospect asked for a person' }],
        };
      case 'schedule_callback':
        context.findings.objectionsRaised.push('timing');
        return {
          from: context.state, to: 'next_step', reason: 'prospect asked to be called back later',
          actions: [{
            kind: 'create_follow_up', followUpType: 'CALLBACK',
            reason: `Prospect asked to be called back: "${priority.matchedText}"`,
            rawTiming: priority.parameters?.['rawTiming'] ?? priority.matchedText,
          }],
        };
      case 'capture_correction':
        context.findings.decisionMakerCorrection = priority.parameters?.['correctedName'] ?? priority.matchedText;
        return {
          from: context.state, to: 'role_check', reason: 'prospect corrected the decision maker',
          actions: [{ kind: 'capture_correction', ...(priority.parameters?.['correctedName'] ? { name: priority.parameters['correctedName'] } : {}) }],
        };
    }
  }

  // --- capture what they actually said -------------------------------------
  context.findings.verbatim.push(said);
  // Evaluate every utterance, not just the ones during discovery. The answer to the
  // hook question arrives while the state is still `hook`, and it is the single most
  // important thing the prospect says.
  if (looksLikeProblem(said)) context.findings.problemConfirmed = true;
  for (const input of extractEconomics(said)) {
    if (!context.findings.economicInputs.some((existing) => existing.value === input.value)) {
      context.findings.economicInputs.push(input);
    }
  }
  for (const system of extractSystems(said)) {
    if (!context.findings.systemsNamed.includes(system)) context.findings.systemsNamed.push(system);
  }

  if (context.turnCount > MAX_TURNS) {
    return terminal(context, 'completed', 'conversation length ceiling reached',
      [{ kind: 'record_disposition', disposition: context.findings.problemConfirmed ? 'POSSIBLE_OPPORTUNITY' : 'NOT_A_FIT' }]);
  }

  // --- gatekeeper ----------------------------------------------------------
  const isGatekeeper = GATEKEEPER_MARKERS.some((pattern) => pattern.test(said));
  if (isGatekeeper && context.state !== 'gatekeeper') {
    context.gatekeeperTurns += 1;
    return { from: context.state, to: 'gatekeeper', reason: 'gatekeeper reached', actions: [] };
  }
  if (context.state === 'gatekeeper') {
    context.gatekeeperTurns += 1;
    if (context.gatekeeperTurns > MAX_GATEKEEPER_TURNS) {
      // Persisting past this stops being professional.
      return terminal(context, 'completed', 'gatekeeper would not route the call',
        [
          { kind: 'create_follow_up', followUpType: 'GENERAL', reason: 'gatekeeper would not route; try a different route or time' },
          { kind: 'record_disposition', disposition: 'GATEKEEPER' },
        ]);
    }
    if (context.findings.decisionMakerCorrection) {
      return { from: 'gatekeeper', to: 'role_check', reason: 'gatekeeper named the right person', actions: [] };
    }
    return { from: 'gatekeeper', to: 'gatekeeper', reason: 'asking who owns the process', actions: [] };
  }

  // --- objections ----------------------------------------------------------
  const objection = OBJECTION_MARKERS.find((pattern) => pattern.test(said));
  if (objection) {
    const label = said.slice(0, 80);
    if (!context.findings.objectionsRaised.includes(label)) context.findings.objectionsRaised.push(label);
    return { from: context.state, to: 'objection', reason: 'objection or brush-off raised', actions: [] };
  }

  // --- the prospect proves the process is already strong -------------------
  if (STRONG_PROCESS_MARKERS.some((pattern) => pattern.test(said))) {
    // Count the contradiction whether we are on the primary or the backup. Without
    // this the backup is never marked tested and the call hunts indefinitely.
    const current = context.findings.activeHypothesis ?? `backup_${context.findings.hypothesesTested.length}`;
    if (!context.findings.contradicted.includes(current)) {
      context.findings.contradicted.push(current);
      context.findings.hypothesesTested.push(current);
    }
    // One backup hypothesis, then stop. Hunting for a third is how a call becomes
    // a fishing expedition (state machine §17, §31).
    if (context.findings.hypothesesTested.length >= MAX_HYPOTHESES) {
      return terminal(context, 'disqualified', 'the prospect demonstrated the process is already handled',
        [{ kind: 'record_disposition', disposition: 'NOT_A_FIT' }]);
    }
    context.findings.activeHypothesis = null;   // the composer supplies the backup
    return { from: context.state, to: 'hook', reason: 'primary hypothesis contradicted; trying the backup', actions: [] };
  }

  // --- normal sales progression -------------------------------------------
  switch (context.state) {
    case 'opening':
      return { from: 'opening', to: 'hook', reason: 'opener delivered; asking the researched question', actions: [] };

    case 'role_check':
      return { from: 'role_check', to: 'hook', reason: 'reached the right person', actions: [] };

    case 'hook':
      return { from: 'hook', to: 'listen', reason: 'question asked; listening to the answer', actions: [] };

    case 'listen':
    case 'discovery':
    case 'probe': {
      context.discoveryDepth += 1;
      if (context.discoveryDepth >= MAX_DISCOVERY_DEPTH) {
        if (context.findings.problemConfirmed) {
          return { from: context.state, to: 'position', reason: 'enough discovered; positioning briefly', actions: [] };
        }
        return terminal(context, 'disqualified', 'no meaningful problem surfaced within the discovery ceiling',
          [{ kind: 'record_disposition', disposition: 'NOT_A_FIT' }]);
      }
      if (context.findings.economicInputs.length > 0 && context.findings.problemConfirmed) {
        return { from: context.state, to: 'quantify', reason: 'the prospect volunteered a number', actions: [] };
      }
      return { from: context.state, to: 'probe', reason: 'probing frequency, process and impact', actions: [] };
    }

    case 'quantify':
      return { from: 'quantify', to: 'position', reason: 'economics captured; positioning briefly', actions: [] };

    case 'position':
      // If they agree while you are still positioning, take the agreement rather
      // than talking past it and asking again.
      if (agreedToMeeting(said)) {
        if (!context.tools.booking) {
          context.overrides.push('prospect agreed to a meeting but no booking tool is available');
          return {
            from: 'position', to: 'confirmation',
            reason: 'agreed during positioning, but the calendar is unavailable',
            actions: [
              { kind: 'create_follow_up', followUpType: 'MEETING_PREP', reason: 'prospect agreed to a strategy call; calendar unavailable at call time' },
              { kind: 'record_disposition', disposition: 'CALLBACK_REQUESTED' },
            ],
          };
        }
        return {
          from: 'position', to: 'action_in_progress', reason: 'agreed during positioning; offering real times',
          actions: [{ kind: 'offer_booking' }],
        };
      }
      return { from: 'position', to: 'next_step', reason: 'earning the next step', actions: [] };

    case 'objection':
      // One objection answered returns to the thread; it does not restart the pitch.
      if (context.findings.problemConfirmed) {
        return { from: 'objection', to: 'next_step', reason: 'objection answered; problem already established', actions: [] };
      }
      return { from: 'objection', to: 'hook', reason: 'objection answered; back to the question', actions: [] };

    case 'next_step': {
      if (agreedToMeeting(said)) {
        if (!context.tools.booking) {
          // No booking tool means no promise of a booking (state machine §28).
          context.overrides.push('prospect agreed to a meeting but no booking tool is available');
          return {
            from: 'next_step', to: 'confirmation',
            reason: 'agreed, but the calendar is unavailable — human follow-up instead',
            actions: [
              { kind: 'create_follow_up', followUpType: 'MEETING_PREP', reason: 'prospect agreed to a strategy call; calendar unavailable at call time' },
              { kind: 'record_disposition', disposition: 'CALLBACK_REQUESTED' },
            ],
          };
        }
        return {
          from: 'next_step', to: 'action_in_progress', reason: 'prospect agreed; offering real times',
          actions: [{ kind: 'offer_booking' }],
        };
      }
      if (declined(said)) {
        return terminal(context, 'completed', 'prospect declined the next step',
          [{ kind: 'record_disposition', disposition: context.findings.problemConfirmed ? 'POSSIBLE_OPPORTUNITY' : 'NOT_A_FIT' }]);
      }
      return { from: 'next_step', to: 'next_step', reason: 'clarifying the next step', actions: [] };
    }

    case 'action_in_progress':
      return { from: 'action_in_progress', to: 'confirmation', reason: 'action attempted', actions: [] };

    case 'confirmation':
      return { from: 'confirmation', to: 'close', reason: 'confirmed; closing', actions: [] };

    case 'close':
      return terminal(context, 'completed', 'call complete', []);

    default:
      return { from: context.state, to: context.state, reason: 'no transition', actions: [] };
  }
}

/** Tool results, which orchestration turns into truthful confirmations. */
export function applyToolResult(context: CallContext, event: CallEvent): Transition {
  if (event.toolName === 'book_strategy_call') {
    if (event.toolOk) {
      context.nextStep = 'strategy_call_booked';
      context.disposition = 'MEETING_SCHEDULED';
      return {
        from: context.state, to: 'confirmation', reason: 'booking confirmed by the calendar',
        actions: [{ kind: 'record_disposition', disposition: 'MEETING_SCHEDULED' }],
      };
    }
    // A failed booking is never dressed up as a scheduled meeting
    // (state machine §34: "disposition not scheduled").
    context.overrides.push('booking failed — disposition recorded as a callback request, not a meeting');
    context.nextStep = 'booking_failed_human_followup';
    context.disposition = 'CALLBACK_REQUESTED';
    return {
      from: context.state, to: 'confirmation',
      reason: 'booking failed; falling back to a human follow-up',
      requiredUtterance:
        "I wasn't able to lock that in on the calendar just now, so I'll have someone confirm it "
        + 'and send it across. Please treat it as tentative until you see the invite.',
      actions: [
        { kind: 'create_follow_up', followUpType: 'BOOKING_RECOVERY', reason: 'calendar did not confirm the agreed time' },
        { kind: 'record_disposition', disposition: 'CALLBACK_REQUESTED' },
      ],
    };
  }
  return { from: context.state, to: context.state, reason: 'tool result noted', actions: [] };
}

export function applyTransition(context: CallContext, transition: Transition): CallContext {
  context.state = transition.to;
  if (transition.terminalReason) context.terminalReason = transition.terminalReason;
  for (const action of transition.actions) {
    if (action.kind === 'record_disposition') context.disposition = action.disposition;
  }
  if (transition.requiredUtterance) {
    context.transcript.push({ speaker: 'agent', text: transition.requiredUtterance, state: transition.to });
  }
  return context;
}

function terminal(
  context: CallContext, reason: TerminalReason, why: string, actions: OrchestrationAction[],
): Transition {
  return { from: context.state, to: 'terminal', reason: why, terminalReason: reason, actions };
}

/** Language indicating a real problem rather than a polite non-answer. */
const PROBLEM_MARKERS: RegExp[] = [
  /\b(?:goes?|go)\s+to\s+voicemail\b/i,
  /\bwe\s+(?:probably\s+)?(?:miss|lose|drop)\b/i,
  /\b(?:no ?body|no one)\s+(?:really\s+)?(?:picks|answers|follows|gets)\b/i,
  /\b(?:falls?|fell|slip(?:s|ped)?)\s+through\s+the\s+cracks?\b/i,
  /\bwe'?re\s+(?:swamped|slammed|buried|drowning|behind)\b/i,
  /\b(?:manual(?:ly)?|by hand|spreadsheet)\b/i,
  /\bhonestly[,\s]+(?:no|not|we don'?t)\b/i,
  /\bit\s+(?:depends|varies)\b/i,
  /\bwe\s+(?:don'?t|do not)\s+(?:really\s+)?(?:track|know|have)\b/i,
  /\bnot\s+(?:as\s+)?(?:well|good|great)\s+as\b/i,
  /\bthat'?s?\s+(?:a\s+)?(?:good|fair)\s+question\b/i,
];

function looksLikeProblem(text: string): boolean {
  return PROBLEM_MARKERS.some((pattern) => pattern.test(text));
}

const AGREE_MARKERS: RegExp[] = [
  /\b(?:yeah|yes|sure|okay|ok|sounds good|that works|let'?s do it|i'?d be open|why not|absolutely)\b/i,
  /\bset\s+(?:it|something)\s+up\b/i,
  /\bwhat\s+(?:times?|days?)\s+(?:do you have|works?|are you)\b/i,
];
const DECLINE_MARKERS: RegExp[] = [
  /\b(?:no|nah|not|pass)\b.{0,20}\b(?:thanks|thank you|interested|right now|for us)\b/i,
  /\bwe'?re\s+(?:all\s+)?(?:good|set|fine)\b/i,
  /\bi'?ll\s+pass\b/i,
];

function agreedToMeeting(text: string): boolean {
  return AGREE_MARKERS.some((pattern) => pattern.test(text)) && !DECLINE_MARKERS.some((p) => p.test(text));
}
function declined(text: string): boolean {
  return DECLINE_MARKERS.some((pattern) => pattern.test(text));
}

export { detectPriorityIntent };
