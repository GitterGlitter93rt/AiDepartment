/**
 * Structured working memory for one live conversation.
 * Authority: outbound-sales-brain-sales-ai-working-memory-contract.v1.yaml.
 *
 * The model should not have to reread the transcript to remember who it is talking
 * to, which hypothesis has been tested, what numbers the prospect gave, or what it
 * has already said. Two rules from the contract shape the shape:
 *
 *   - a prospect statement is source-labelled by turn, and model inference is never
 *     stored as something the prospect said;
 *   - repetition memory records what has already been stated, so the agent does not
 *     re-explain itself.
 */

export type PainStatus =
  | 'confirmed_meaningful' | 'confirmed_minor' | 'possible_worth_measuring'
  | 'solved_strong_process' | 'no_problem' | 'unknown';

export type StakeholderRelevance =
  | 'decision_owner' | 'strong_influencer' | 'routing_only' | 'wrong_person' | 'unknown';

export type Willingness =
  | 'explicit_yes' | 'interested' | 'neutral' | 'busy_but_open' | 'not_interested' | 'explicit_no';

export type HypothesisStatus =
  | 'untested' | 'supported' | 'contradicted' | 'inconclusive' | 'solved_strong_process';

export type ProspectIntent =
  | 'engaged' | 'neutral' | 'busy' | 'not_interested' | 'wants_email' | 'wants_callback'
  | 'wants_strategy_call' | 'wants_to_end' | 'dnc' | 'wrong_number' | 'unknown';

export type Readiness =
  | 'BOOK_NOW' | 'CONTINUE_BRIEFLY' | 'CALLBACK' | 'SEND_TARGETED_INFO'
  | 'ROUTE_VIA_GATEKEEPER'
  | 'END_NO_NEED' | 'DISQUALIFY_OR_REVIEW';

/** Things the agent may say once. Repeating them is what makes a call feel robotic. */
export type SemanticUnit =
  | 'company_identity' | 'cold_call_context' | 'yad_explanation' | 'primary_reason_for_call'
  | 'ai_identity_disclosure' | 'strategy_call_offer' | 'assessment_offer' | 'booking_confirmation'
  | 'email_topic_asked';

export interface ProspectNumber {
  label: string;
  valueText: string;
  sourceTurn: number;
  certainty: 'prospect_exact' | 'prospect_approximate' | 'unknown';
}

export interface ObjectionState {
  type: string;
  firstTurn: number;
  status: 'open' | 'answered' | 'resolved' | 'terminal';
  cardId: string | null;
  cycleCount: number;
}

export interface WorkingMemory {
  turnIndex: number;

  stakeholder: {
    personName: string | null;
    roleCategory: string | null;
    isTargetStakeholder: 'yes' | 'no_confirmed' | 'unknown';
    relevance: StakeholderRelevance;
  };

  routing: {
    gatekeeperDetected: boolean;
    correctedPersonName: string | null;
    correctedRole: string | null;
    extension: string | null;
    bestCallbackTimeText: string | null;
    businessSuppliedEmail: string | null;
  };

  hypothesis: {
    primaryId: string | null;
    primaryStatus: HypothesisStatus;
    backupId: string | null;
    backupStatus: HypothesisStatus | 'unavailable';
    backupUsed: boolean;
  };

  workflow: {
    summary: string | null;
    currentSystems: { value: string; sourceTurn: number }[];
    failureMode: string | null;
  };

  pain: {
    status: PainStatus;
    /** Their words, verbatim, with the turn they said them on. */
    prospectWording: { text: string; sourceTurn: number }[];
  };

  numbers: ProspectNumber[];
  objections: ObjectionState[];

  prospectIntent: { current: ProspectIntent; confidence: 'high' | 'medium' | 'low' };

  nextStep: {
    readiness: Readiness | null;
    reasonCodes: string[];
    callbackTimeText: string | null;
    emailRequested: boolean;
  };

  booking: {
    intentConfirmed: boolean;
    prospectTimezone: string | null;
    candidateSlots: string[];
    selectedSlot: string | null;
    attendeeEmail: string | null;
    providerStatus: 'not_started' | 'checking' | 'slots_ready' | 'booking' | 'confirmed' | 'failed';
    bookingId: string | null;
  };

  probesAsked: string[];
  statedUnits: SemanticUnit[];

  priorityActions: {
    dncDetected: boolean;
    wrongNumberDetected: boolean;
    prospectEndDetected: boolean;
  };
}

export function createWorkingMemory(primaryHypothesisId: string | null, backupId: string | null): WorkingMemory {
  return {
    turnIndex: 0,
    stakeholder: {
      personName: null, roleCategory: null, isTargetStakeholder: 'unknown', relevance: 'unknown',
    },
    routing: {
      gatekeeperDetected: false, correctedPersonName: null, correctedRole: null,
      extension: null, bestCallbackTimeText: null, businessSuppliedEmail: null,
    },
    hypothesis: {
      primaryId: primaryHypothesisId, primaryStatus: 'untested',
      backupId, backupStatus: backupId ? 'untested' : 'unavailable', backupUsed: false,
    },
    workflow: { summary: null, currentSystems: [], failureMode: null },
    pain: { status: 'unknown', prospectWording: [] },
    numbers: [],
    objections: [],
    prospectIntent: { current: 'unknown', confidence: 'low' },
    nextStep: { readiness: null, reasonCodes: [], callbackTimeText: null, emailRequested: false },
    booking: {
      intentConfirmed: false, prospectTimezone: null, candidateSlots: [], selectedSlot: null,
      attendeeEmail: null, providerStatus: 'not_started', bookingId: null,
    },
    probesAsked: [],
    statedUnits: [],
    priorityActions: { dncDetected: false, wrongNumberDetected: false, prospectEndDetected: false },
  };
}

/** True when the agent has already said this. Prevents re-explaining itself. */
export function hasStated(memory: WorkingMemory, unit: SemanticUnit): boolean {
  return memory.statedUnits.includes(unit);
}

export function markStated(memory: WorkingMemory, unit: SemanticUnit): void {
  if (!memory.statedUnits.includes(unit)) memory.statedUnits.push(unit);
}

/**
 * Records an objection and returns whether it may be answered again.
 * `max_cycles` in the card set exists to stop rebuttal loops: pushing back twice on
 * the same objection is arguing.
 */
export function recordObjection(
  memory: WorkingMemory, type: string, cardId: string | null, maxCycles = 1,
): { mayRespond: boolean; state: ObjectionState } {
  let state = memory.objections.find((objection) => objection.type === type);
  if (!state) {
    state = { type, firstTurn: memory.turnIndex, status: 'open', cardId, cycleCount: 0 };
    memory.objections.push(state);
  }
  state.cycleCount += 1;
  state.cardId = cardId ?? state.cardId;
  const mayRespond = state.cycleCount <= maxCycles;
  if (!mayRespond) state.status = 'terminal';
  return { mayRespond, state };
}

/** Only the prospect's own words go here, tagged with the turn they said them on. */
export function recordProspectWording(memory: WorkingMemory, text: string): void {
  memory.pain.prospectWording.push({ text, sourceTurn: memory.turnIndex });
}

export function recordNumber(
  memory: WorkingMemory, label: string, valueText: string,
  certainty: ProspectNumber['certainty'] = 'prospect_approximate',
): void {
  if (memory.numbers.some((number) => number.valueText === valueText)) return;
  memory.numbers.push({ label, valueText, sourceTurn: memory.turnIndex, certainty });
}

export function recordSystem(memory: WorkingMemory, value: string): void {
  if (memory.workflow.currentSystems.some((system) => system.value === value)) return;
  memory.workflow.currentSystems.push({ value, sourceTurn: memory.turnIndex });
}
