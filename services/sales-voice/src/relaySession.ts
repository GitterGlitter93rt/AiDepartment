import {
  SessionStore, createTimeline, parseRelayMessage, textResponse, chunkForSpeech,
  type Timeline, type TimelineSink,
} from '../../voice-core/src/index.ts';

/**
 * The outbound sales relay session.
 *
 * voice-core carries the words; this decides nothing about them. The turn producer
 * is injected, so the whole session can be exercised without Twilio, without a
 * socket, and without the sales brain — which is what the tests do.
 *
 * The turn ordering below is the receptionist's, ported deliberately: an interim
 * transcript opens the turn, only the final transcript acts, and an interrupt aborts
 * the generation in flight *and* truncates what we believe the caller heard.
 */

export interface TurnProducer {
  /** The opening line, spoken as the ConversationRelay welcome greeting. */
  opening(): Promise<string> | string;
  /** One prospect utterance in, one agent turn out. */
  respond(utterance: string, signal: AbortSignal): Promise<{ say: string; terminal: boolean }>;
  /** Called once when the call ends, however it ended. */
  finish(reason: 'completed' | 'caller_hung_up' | 'error'): Promise<void> | void;
  /**
   * A truthful status phrase for a genuinely slow tool.
   *
   * Spoken only when a turn overruns the latency budget, and only if the producer
   * supplies one — the words are the producer's, because the transport must not
   * write anything a caller hears. It states no outcome: "let me check the calendar"
   * is permitted, "you're booked" is not (realtime-voice-policy §10).
   */
  holdingLine?(utterance: string): string | null;
}

export interface SalesRelayState {
  utteranceOpen: boolean;
  lastPartialText: string;
  turns: number;
  /** Set once the call has ended, so a late frame cannot end it again. */
  ended: boolean;
  /** Set once setup has been handled, so a duplicate frame is a no-op. */
  setUp: boolean;
}

export interface Socket {
  send(data: string): void;
  close(): void;
}

/**
 * Sends, and treats a dead socket as the end of the call.
 *
 * A closed socket throws from `send`. Letting that propagate takes down the turn
 * handler mid-call and leaves the session in the store with no way to finish it, so
 * the failure is caught here and the call is ended once, cleanly.
 */
function trySend(socket: Socket, data: string): boolean {
  try {
    socket.send(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * How long a turn may run before a holding phrase is spoken.
 *
 * Chosen from the policy's turn-response target: p95 under 1.5s. Speaking at 1.2s
 * leaves room to be useful before the caller experiences the gap as dead air, and
 * filler is deliberately not used on ordinary turns — if it fires often, the
 * architecture is failing the target rather than covering for it.
 */
export const HOLDING_LINE_AFTER_MS = 1_200;

export function createSalesRelaySession(input: {
  producer: TurnProducer;
  sink: TimelineSink;
  now?: () => number;
  holdingLineAfterMs?: number;
}) {
  const sessions = new SessionStore<SalesRelayState>(
    () => ({ utteranceOpen: false, lastPartialText: '', turns: 0, ended: false, setUp: false }));

  /**
   * Ends the call once.
   *
   * Twilio can deliver a status callback, an error frame and a hang-up after the
   * conversation has already finished. Letting any of those run the producer's
   * `finish` again overwrites how the call actually ended — a call that reached DNC
   * would be recorded as a hang-up.
   */
  async function endOnce(
    callSid: string, reason: 'completed' | 'caller_hung_up' | 'error',
    socket?: Socket,
  ): Promise<boolean> {
    const session = sessions.get(callSid);
    if (!session || session.state.ended) return false;
    sessions.patchState(callSid, { ended: true });
    inFlight.get(callSid)?.abort();
    inFlight.delete(callSid);
    try {
      await input.producer.finish(reason);
    } catch {
      // A producer that fails while closing must not prevent the call being closed.
    }
    timelines.get(callSid)?.mark('CALL_ENDED');
    timelines.delete(callSid);
    sessions.end(callSid);
    if (socket) { try { socket.close(); } catch { /* already gone */ } }
    return true;
  }
  const timelines = new Map<string, Timeline>();
  const inFlight = new Map<string, AbortController>();

  async function handle(socket: Socket, raw: string, callSidRef: { current: string }): Promise<void> {
    const message = parseRelayMessage(raw);
    if (!message) return;

    if (message.type === 'setup') {
      const callSid = String((message as { callSid?: string }).callSid ?? '');
      const from = String((message as { from?: string }).from ?? 'unknown');
      const to = String((message as { to?: string }).to ?? 'unknown');
      callSidRef.current = callSid;
      const existing = sessions.get(callSid);
      if (existing?.state.setUp) {
        // Twilio can repeat setup on a reconnect. Running it again would record the
        // opener a second time, and a second recorded opener breaks the barge-in
        // truncation that looks for the last agent turn.
        return;
      }
      sessions.ensure(callSid, from, to);
      sessions.patchState(callSid, { setUp: true });

      const timeline = createTimeline({
        callSid, sink: input.sink, ...(input.now ? { now: input.now } : {}) });
      timelines.set(callSid, timeline);
      timeline.mark('WEBSOCKET_CONNECTED');
      timeline.mark('RELAY_SETUP_RECEIVED');
      // Not when the caller heard anything: Twilio owns synthesis and reports
      // neither. The socket opening is the earliest thing this process can see.
      timeline.mark('FIRST_AGENT_AUDIO_PROXY', { observable: false, proxy: 'relay socket open' });

      // The opener is already being spoken as the welcome greeting, so it is recorded
      // rather than sent again. Sending it twice is how a caller hears it twice.
      sessions.addTurn(callSid, 'agent', await input.producer.opening());
      return;
    }

    const callSid = callSidRef.current;
    const session = sessions.get(callSid);
    const timeline = timelines.get(callSid);
    if (!session || !timeline) return;

    if (message.type === 'prompt') {
      const utterance = String((message as { voicePrompt?: string }).voicePrompt ?? '').trim();
      if (!utterance) return;
      // A transcript arriving after the call ended is not a turn.
      if (session.state.ended) return;

      // An interim transcript. Twilio is still listening, so this is not a turn —
      // acting on it would answer half a sentence.
      if ((message as { last?: boolean }).last === false) {
        if (!session.state.utteranceOpen) {
          timeline.beginTurn();
          sessions.patchState(callSid, { utteranceOpen: true, lastPartialText: '' });
        }
        timeline.mark('FIRST_CALLER_SPEECH');
        // Only a frame that CHANGES the text tells us anything. Counting repeats is
        // what turns a long sentence into a fictitious endpointing delay.
        if (utterance !== sessions.get(callSid)!.state.lastPartialText) {
          sessions.patchState(callSid, { lastPartialText: utterance });
          timeline.mark('LAST_PARTIAL_TEXT_CHANGE', { chars: utterance.length });
        }
        return;
      }

      timeline.mark('CALLER_END_OF_TURN');
      sessions.patchState(callSid, { utteranceOpen: false });
      sessions.addTurn(callSid, 'caller', utterance);

      // A new utterance abandons whatever was still being generated. Without this the
      // abandoned turn still arrives and gets spoken, which is the agent talking over
      // the caller.
      inFlight.get(callSid)?.abort();
      const controller = new AbortController();
      inFlight.set(callSid, controller);

      timeline.mark('TURN_HANDLER_START');

      // A genuinely slow tool gets a truthful status phrase rather than dead air.
      // It is preemptible and does not close the turn, so the real answer can follow
      // and the caller can talk over it.
      const holding = input.producer.holdingLine?.(utterance) ?? null;
      let holdingTimer: ReturnType<typeof setTimeout> | undefined;
      if (holding) {
        holdingTimer = setTimeout(() => {
          if (controller.signal.aborted || sessions.get(callSid)?.state.ended) return;
          if (trySend(socket, textResponse(holding, false, { preemptible: true }))) {
            timeline.mark('PRE_TOOL_ACK_SENT', { chars: holding.length });
          }
        }, input.holdingLineAfterMs ?? HOLDING_LINE_AFTER_MS);
        holdingTimer.unref?.();
      }

      let produced: { say: string; terminal: boolean };
      try {
        produced = await input.producer.respond(utterance, controller.signal);
      } catch {
        clearTimeout(holdingTimer);
        timeline.mark('CLAUDE_ABORTED');
        return;
      } finally {
        clearTimeout(holdingTimer);
      }
      if (controller.signal.aborted) {
        timeline.mark('CLAUDE_ABORTED');
        return;
      }

      sessions.addTurn(callSid, 'agent', produced.say);
      const chunks = chunkForSpeech(produced.say);
      let delivered = true;
      for (const [index, chunk] of chunks.entries()) {
        const last = index === chunks.length - 1;
        if (!trySend(socket, textResponse(chunk, last))) { delivered = false; break; }
        if (index === 0) timeline.mark('FIRST_TEXT_SENT_TO_CONVERSATION_RELAY');
      }
      if (!delivered) {
        // Nobody is listening any more. End the call rather than carry on producing
        // turns into a closed socket.
        await endOnce(callSid, 'error');
        return;
      }
      timeline.mark('TURN_COMPLETE');
      sessions.patchState(callSid, { turns: session.state.turns + 1 });

      if (produced.terminal) await endOnce(callSid, 'completed', socket);
      return;
    }

    if (message.type === 'interrupt') {
      // The caller talked over us. ConversationRelay stops its own playback; the
      // generation on our side would otherwise keep going and send more text.
      const heard = String((message as { utteranceUntilInterrupt?: string })
        .utteranceUntilInterrupt ?? '');
      timeline.mark('INTERRUPT_RECEIVED');
      inFlight.get(callSid)?.abort();
      timeline.mark('CLAUDE_ABORTED');
      // The transcript is trimmed to what was actually delivered, because a next turn
      // built on words nobody heard is the agent referring back to nothing.
      sessions.truncateLastAgentTurn(callSid, heard);
      return;
    }

    if (message.type === 'error') {
      await endOnce(callSid, 'error');
    }
  }

  return {
    handle,
    sessions,
    timelineFor: (callSid: string) => timelines.get(callSid),
    /** Idempotent: a hang-up after the call ended changes nothing. */
    async hangUp(callSid: string): Promise<boolean> {
      return endOnce(callSid, 'caller_hung_up');
    },
  };
}
