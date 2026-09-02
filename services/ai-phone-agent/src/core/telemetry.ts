// Call timeline telemetry.
//
// One line per moment that matters, with elapsed milliseconds measured
// from the instant the call arrived. This exists so a latency claim can
// be checked against a real phone call instead of argued about: every
// number in the QA table comes from a mark emitted here.
//
// What we can and cannot see is worth stating plainly, because the
// difference decides whether a slow call is our fault or Twilio's.
// ConversationRelay owns the audio. We never touch a media stream, so
// there is no point in this process that corresponds to "the caller
// heard the first syllable" — see FIRST_AGENT_AUDIO_PROXY below.

/**
 * The moments we can actually observe.
 *
 * Ordered as they occur on a call so the log reads top to bottom.
 */
export type TimelineMark =
  /** Twilio POSTed /twilio/incoming. The clock starts here. */
  | 'CALL_CONNECTED'
  /** TwiML written to the response — the greeting is now Twilio's job. */
  | 'WELCOME_GREETING_SENT'
  /** ConversationRelay opened the WebSocket. */
  | 'WEBSOCKET_CONNECTED'
  /** The relay's setup frame, carrying the CallSid. */
  | 'RELAY_SETUP_RECEIVED'
  /**
   * NOT the moment the caller hears anything.
   *
   * Twilio synthesises and plays the greeting entirely on its side and
   * reports neither. The best proxy available to this process is the
   * relay socket opening, which cannot happen before Twilio has
   * processed the TwiML. True audio latency is greeting synthesis plus
   * playback start, and it is measurable only with a stopwatch on a
   * real handset.
   */
  | 'FIRST_AGENT_AUDIO_PROXY'
  /** First interim transcript — the caller has started talking. */
  | 'FIRST_CALLER_SPEECH'
  /** Final transcript. Twilio has decided the caller stopped. */
  | 'CALLER_END_OF_TURN'
  | 'TURN_HANDLER_START'
  | 'CLAUDE_REQUEST_START'
  /** First SSE byte carrying content — time to first token. */
  | 'CLAUDE_FIRST_STREAM_EVENT'
  /** A clause cleared the speakable threshold. */
  | 'FIRST_SPEAKABLE_CLAUSE'
  | 'FIRST_TEXT_SENT_TO_CONVERSATION_RELAY'
  | 'TURN_COMPLETE'
  /** The relay told us the caller talked over us. */
  | 'INTERRUPT_RECEIVED'
  /** Generation actually stopped. The gap from INTERRUPT_RECEIVED is
   * our share of barge-in latency; the rest is the relay's. */
  | 'CLAUDE_ABORTED'
  | 'CALL_ENDED';

export interface MarkRecord {
  mark: TimelineMark;
  /** Milliseconds since CALL_CONNECTED. */
  atMs: number;
  turn: number;
}

export interface Timeline {
  /** Records a mark and logs it. Repeated "first" marks are ignored. */
  mark(mark: TimelineMark, extra?: Record<string, unknown>): void;
  /** Starts a new turn; per-turn "first" marks become available again. */
  beginTurn(): number;
  /** Elapsed ms since the call connected. */
  elapsed(): number;
  /** Ms since the given mark was recorded in this turn, or undefined. */
  since(mark: TimelineMark): number | undefined;
  readonly marks: MarkRecord[];
  readonly turn: number;
}

/** Marks that mean "the first time this happened" and must not repeat
 * within a turn — emitting them twice would make the table lie. */
const ONCE_PER_TURN: ReadonlySet<TimelineMark> = new Set<TimelineMark>([
  'FIRST_CALLER_SPEECH',
  'CALLER_END_OF_TURN',
  'TURN_HANDLER_START',
  'CLAUDE_REQUEST_START',
  'CLAUDE_FIRST_STREAM_EVENT',
  'FIRST_SPEAKABLE_CLAUSE',
  'FIRST_TEXT_SENT_TO_CONVERSATION_RELAY',
  // Both the transport and the orchestrator notice the abort. The
  // first one to see it is the one that timed it; a second line would
  // just be noise in the table.
  'CLAUDE_ABORTED',
]);

/** Marks that happen once for the whole call. */
const ONCE_PER_CALL: ReadonlySet<TimelineMark> = new Set<TimelineMark>([
  'CALL_CONNECTED',
  'WELCOME_GREETING_SENT',
  'WEBSOCKET_CONNECTED',
  'RELAY_SETUP_RECEIVED',
  'FIRST_AGENT_AUDIO_PROXY',
]);

export interface TimelineSink {
  log(event: 'timeline', data: Record<string, unknown>): void;
}

export interface TimelineOptions {
  callSid: string;
  sink: TimelineSink;
  /** Injectable for deterministic tests. */
  now?: () => number;
  /** Overrides the call-start instant when the timeline is created
   * later than the call (the WebSocket knows the CallSid only at
   * setup, by which point the webhook has already run). */
  startedAt?: number;
}

export function createTimeline(opts: TimelineOptions): Timeline {
  const now = opts.now ?? Date.now;
  const t0 = opts.startedAt ?? now();
  const marks: MarkRecord[] = [];
  const seenInTurn = new Set<TimelineMark>();
  const seenInCall = new Set<TimelineMark>();
  let turn = 0;
  let lastAt = 0;

  return {
    marks,
    get turn() { return turn; },
    elapsed() { return now() - t0; },
    since(mark) {
      // Search backwards: the most recent occurrence is the relevant one.
      for (let i = marks.length - 1; i >= 0; i -= 1) {
        if (marks[i].mark === mark) return (now() - t0) - marks[i].atMs;
      }
      return undefined;
    },
    beginTurn() {
      turn += 1;
      seenInTurn.clear();
      return turn;
    },
    mark(mark, extra = {}) {
      if (ONCE_PER_CALL.has(mark)) {
        if (seenInCall.has(mark)) return;
        seenInCall.add(mark);
      }
      if (ONCE_PER_TURN.has(mark)) {
        if (seenInTurn.has(mark)) return;
        seenInTurn.add(mark);
      }
      const atMs = now() - t0;
      marks.push({ mark, atMs, turn });
      opts.sink.log('timeline', {
        callSid: opts.callSid,
        mark,
        turn,
        atMs,
        // Gap from the previous mark. Reading a column of these is how
        // you find the step that is actually slow.
        deltaMs: marks.length > 1 ? atMs - lastAt : 0,
        ...extra,
      });
      lastAt = atMs;
    },
  };
}

/** A timeline that records nothing. Keeps call sites free of `?.`. */
export function nullTimeline(): Timeline {
  return {
    marks: [],
    turn: 0,
    mark() { /* discarded */ },
    beginTurn() { return 0; },
    elapsed() { return 0; },
    since() { return undefined; },
  };
}

/**
 * Timelines by CallSid.
 *
 * The webhook creates one; the WebSocket, which arrives later and on a
 * different connection, looks it up so both halves of the call share a
 * single clock. Without that, WEBSOCKET_CONNECTED would be measured
 * from itself and always read zero.
 */
export class TimelineStore {
  private readonly map = new Map<string, Timeline>();
  private readonly sink: TimelineSink;
  private readonly now: () => number;

  constructor(sink: TimelineSink, now: () => number = Date.now) {
    this.sink = sink;
    this.now = now;
  }

  start(callSid: string): Timeline {
    const timeline = createTimeline({ callSid, sink: this.sink, now: this.now });
    this.map.set(callSid, timeline);
    return timeline;
  }

  /** The call's timeline, creating one if the webhook never ran (local
   * testing hits the socket directly). */
  ensure(callSid: string): Timeline {
    const existing = this.map.get(callSid);
    if (existing) return existing;
    return this.start(callSid);
  }

  get(callSid: string): Timeline | undefined {
    return this.map.get(callSid);
  }

  end(callSid: string): void {
    this.map.delete(callSid);
  }

  get size(): number { return this.map.size; }
}
