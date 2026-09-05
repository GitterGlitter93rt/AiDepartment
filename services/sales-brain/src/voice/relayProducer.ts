import {
  beginSalesCall, finishSalesCall, nextSalesTurn, type LiveCallSession,
} from './salesTurnProducer.js';

/**
 * Adapts the sales brain to the shape a voice relay session expects.
 *
 * The interface is described structurally rather than imported, so this module has
 * no dependency on the transport package and the transport has none on the brain.
 * That is what lets each be tested in its own runtime, and what stops a change to
 * one from quietly reshaping the other.
 *
 * Everything that decides what to say lives behind `nextSalesTurn`. Nothing here
 * writes copy, and nothing here dials — a call reaches this module only after the
 * dial controller has already permitted it.
 */

export interface RelayTurnProducer {
  opening(): Promise<string>;
  respond(utterance: string, signal: AbortSignal): Promise<{ say: string; terminal: boolean }>;
  finish(reason: 'completed' | 'caller_hung_up' | 'error'): Promise<void>;
}

export async function createSalesRelayProducer(input: {
  voiceCallId: string; accountId: string; contactId?: string | null;
}): Promise<RelayTurnProducer & { session: LiveCallSession }> {
  const { session, opening } = await beginSalesCall({
    voiceCallId: input.voiceCallId,
    accountId: input.accountId,
    contactId: input.contactId ?? null,
  });

  let closed = false;

  return {
    session,

    async opening() { return opening.say; },

    async respond(utterance: string, signal: AbortSignal) {
      const turn = await nextSalesTurn(session, utterance);
      // The caller talked over us, or moved on, while this was being produced.
      // Returning it anyway is the agent speaking over the person it called.
      if (signal.aborted) throw new Error('turn aborted');
      return { say: turn.say, terminal: turn.terminal };
    },

    async finish(reason) {
      // A call ends once. A hang-up during a terminal turn must not close it twice
      // and overwrite the outcome the conversation actually reached.
      if (closed) return;
      closed = true;
      await finishSalesCall(session);
      if (reason !== 'completed') {
        // The call did not end on a turn, so what happened is recorded as it was.
        const { query } = await import('../db/pool.js');
        await query(
          `insert into voice_call_events (voice_call_id, kind, label)
           values ($1, 'STATE', $2)`,
          [input.voiceCallId, reason === 'error' ? 'Relay error ended the call'
            : 'Caller hung up'],
        );
      }
    },
  };
}
