import { startCall, respond, AGENT_PROFILE, type AgentState, type AgentTurn,
         type BookingBridge, type OfferedSlot as SpokenSlot } from '../callbrain/agent.js';
import { buildCallPack, type CallPack } from '../callbrain/callPack.js';
import { bookStrategyCall, getAvailability, type OfferedSlot } from '../booking/service.js';
import { query } from '../db/pool.js';

/**
 * The Production Outbound Sales turn producer.
 *
 * This is the seam described in the voice-runtime reuse audit: the proven transport
 * does not care what produces the next line of speech, and this does not care how
 * that line reaches a caller. Everything here runs on text, so a whole call can be
 * exercised without Twilio — which is how the roleplay suite already tests it.
 *
 * It adds the two things a live call needs beyond the simulator:
 *
 *  - real availability and real booking, through the Cal.com-backed booking service,
 *    so a time is never spoken before the provider offered it and never confirmed
 *    before the provider confirmed it;
 *  - persistence, so the transcript, state and outcome survive the call for review.
 */

export interface LiveCallSession {
  voiceCallId: string;
  state: AgentState;
  turnIndex: number;
}

/** Booking bridge backed by the real service, with the same honest contract. */
export function liveBookingBridge(input: {
  accountId: string; contactId?: string | null; attendeeName?: string | null;
  attendeePhone?: string | null; now?: () => Date;
}): BookingBridge & { lastSlots: OfferedSlot[] } {
  const bridge = {
    lastSlots: [] as OfferedSlot[],

    async getSlots(): Promise<SpokenSlot[]> {
      const offer = await getAvailability({ now: input.now?.() });
      // An empty list stays empty. The agent has words for that; inventing a time
      // it could not verify is the failure this contract exists to prevent.
      bridge.lastSlots = offer.ok ? offer.slots : [];
      return bridge.lastSlots.map((slot) => ({
        token: slot.token, spoken: slot.spoken, startIso: slot.start.toISOString(),
      }));
    },

    async book({ slot, email }: { slot: SpokenSlot; email: string | null }) {
      const chosen = bridge.lastSlots.find((candidate) => candidate.token === slot.token);
      if (!chosen) {
        return { ok: false, error: 'That time was not one the calendar offered.' };
      }
      const result = await bookStrategyCall({
        accountId: input.accountId,
        contactId: input.contactId ?? null,
        start: chosen.start,
        end: chosen.end,
        slotToken: chosen.token,
        attendeeName: input.attendeeName ?? null,
        attendeeEmail: email,
        attendeePhone: input.attendeePhone ?? null,
        prospectAgreed: true,
        sourceChannel: 'ai_call',
      });
      return result.ok ? { ok: true } : { ok: false, error: result.error ?? result.reason };
    },
  };
  return bridge;
}

export async function beginSalesCall(input: {
  voiceCallId: string; accountId: string; contactId?: string | null;
  pack?: CallPack; now?: () => Date;
}): Promise<{ session: LiveCallSession; opening: AgentTurn }> {
  const pack = input.pack ?? await buildCallPack(input.accountId);
  if (!pack) {
    // No Call Pack means no researched basis for the call. The agent would have
    // nothing truthful to open with, so the call does not start.
    throw new Error('No Call Pack could be built for this account; the call was not started.');
  }

  const { state, opening } = startCall({
    pack,
    tools: { booking: true, suppression: true, followUp: true, transfer: false, sms: false, email: true },
    booking: liveBookingBridge({
      accountId: input.accountId, contactId: input.contactId ?? null,
      attendeeName: pack.contactName, now: input.now,
    }),
  });

  const session: LiveCallSession = { voiceCallId: input.voiceCallId, state, turnIndex: 0 };
  await persistTurn(session, 'AGENT', opening);
  await recordEvent(input.voiceCallId, 'STATE', `Opener: ${opening.componentId}`);
  return { session, opening };
}

/**
 * One prospect utterance in, one agent turn out, both persisted.
 *
 * The turn is written before it is returned, so a call that drops mid-turn still
 * leaves a reviewable record of what the prospect said and what was said back.
 */
export async function nextSalesTurn(
  session: LiveCallSession, utterance: string, offsetMs?: number,
): Promise<AgentTurn> {
  await persistTurn(session, 'PROSPECT', { say: utterance } as AgentTurn, offsetMs);
  const turn = await respond(session.state, utterance);
  await persistTurn(session, 'AGENT', turn, offsetMs);

  if (turn.terminal) {
    await recordEvent(session.voiceCallId, 'STATE', `Call ended: ${turn.componentId}`);
  }
  for (const code of turn.reasonCodes) {
    if (code === 'availability_checked' || code === 'provider_confirmed' || code === 'provider_failed') {
      await recordEvent(session.voiceCallId, 'TOOL_RESULT', code.replace(/_/g, ' '));
    }
  }
  return turn;
}

/**
 * Closes the call record with what actually happened.
 *
 * The outcome is derived from the agent's own state rather than assumed: a booking
 * counts only when the provider confirmed it, which is the same rule the agent uses
 * when deciding what it is allowed to say out loud.
 */
export async function finishSalesCall(session: LiveCallSession): Promise<string> {
  const { memory } = session.state;
  const outcome =
    memory.priorityActions.dncDetected ? 'DNC'
    : memory.priorityActions.wrongNumberDetected ? 'WRONG_NUMBER'
    : memory.booking.providerStatus === 'confirmed' ? 'BOOKED'
    : memory.nextStep.callbackTimeText ? 'CALLBACK'
    : memory.stakeholder.relevance === 'routing_only' ? 'GATEKEEPER'
    : memory.pain.status === 'no_problem' || memory.pain.status === 'solved_strong_process' ? 'NO_SALE'
    : 'CONNECTED';

  await query(
    `update voice_calls
        set ended_at = now(),
            duration_seconds = greatest(0, extract(epoch from (now() - started_at))::int),
            outcome = $2, readiness_decision = $3, disposition = $4
      where voice_call_id = $1`,
    [session.voiceCallId, outcome, memory.nextStep.readiness, dispositionFor(outcome)],
  );
  return outcome;
}

/** The CRM disposition each outcome maps to. Kept explicit rather than inferred. */
function dispositionFor(outcome: string): string | null {
  switch (outcome) {
    case 'BOOKED': return 'MEETING_SCHEDULED';
    case 'CALLBACK': return 'CALLBACK_REQUESTED';
    case 'GATEKEEPER': return 'GATEKEEPER';
    case 'DNC': return 'DO_NOT_CONTACT';
    case 'WRONG_NUMBER': return 'WRONG_NUMBER';
    case 'NO_SALE': return 'NOT_A_FIT';
    case 'CONNECTED': return 'DECISION_MAKER_REACHED';
    default: return null;
  }
}

async function persistTurn(
  session: LiveCallSession, speaker: 'AGENT' | 'PROSPECT', turn: AgentTurn, offsetMs?: number,
): Promise<void> {
  await query(
    `insert into voice_call_turns
       (voice_call_id, turn_index, speaker, text, offset_ms, component_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (voice_call_id, turn_index) do nothing`,
    [session.voiceCallId, session.turnIndex, speaker, turn.say, offsetMs ?? null,
     speaker === 'AGENT' ? turn.componentId ?? null : null],
  );
  session.turnIndex += 1;
}

async function recordEvent(voiceCallId: string, kind: string, label: string): Promise<void> {
  await query(
    `insert into voice_call_events (voice_call_id, kind, label) values ($1, $2, $3)`,
    [voiceCallId, kind, label],
  );
}

export { AGENT_PROFILE };
