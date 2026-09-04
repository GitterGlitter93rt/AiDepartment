// Per-call session state.
//
// Ported from services/ai-phone-agent at 2ad6449. The lifecycle and the barge-in
// truncation came across as they are; the receptionist's own fields — industry
// routing, qualification answers, contact capture — did not, because they belong to
// the service having the conversation rather than to the transport carrying it.
//
// In their place each session holds one `state` slot that the consuming service owns
// and types. That is the whole seam: voice-core knows a call has state, and nothing
// about what the state means.
//
// Keyed by Twilio CallSid, so concurrent calls are fully isolated — there is no
// module-level "current conversation" anywhere in this package. Sessions are held in
// memory and swept after the call ends; a multi-instance deployment would swap this
// for Redis behind the same interface.

export interface Turn {
  role: 'agent' | 'caller' | 'system';
  text: string;
  at: string;
  interrupted?: boolean;
}

export interface ToolCallRecord {
  name: string;
  ok: boolean;
  at: string;
}

export interface VoiceSession<TState> {
  callSid: string;
  from: string;
  to: string;
  startedAt: string;
  endedAt?: string;
  turns: Turn[];
  toolCalls: ToolCallRecord[];
  /** Owned entirely by the consuming service. */
  state: TState;
}

export class SessionStore<TState> {
  private sessions = new Map<string, VoiceSession<TState>>();
  private readonly ttlMs: number;
  private readonly initialState: () => TState;

  // Written as explicit fields rather than parameter properties: Node's
  // --experimental-strip-types runs TypeScript by erasing types only, and parameter
  // properties emit real code, so they are not supported. Keeping to strip-safe
  // syntax is what lets this package run and test with no build step.
  constructor(initialState: () => TState, ttlMs = 10 * 60 * 1000) {
    this.initialState = initialState;
    this.ttlMs = ttlMs;
  }

  create(callSid: string, from: string, to: string): VoiceSession<TState> {
    const session: VoiceSession<TState> = {
      callSid, from, to,
      startedAt: new Date().toISOString(),
      turns: [],
      toolCalls: [],
      state: this.initialState(),
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): VoiceSession<TState> | undefined {
    return this.sessions.get(callSid);
  }

  /** Get an existing session or start one — webhooks can arrive in an order we do
   * not control. */
  ensure(callSid: string, from = 'unknown', to = 'unknown'): VoiceSession<TState> {
    return this.sessions.get(callSid) ?? this.create(callSid, from, to);
  }

  addTurn(callSid: string, role: Turn['role'], text: string): void {
    const session = this.sessions.get(callSid);
    if (!session) return;
    session.turns.push({ role, text, at: new Date().toISOString() });
  }

  /**
   * Cuts the last agent turn down to what the caller actually heard.
   *
   * ConversationRelay reports `utteranceUntilInterrupt` — the words it had played
   * before the caller talked over it. Without this the transcript claims the agent
   * said a whole paragraph the caller never heard, and the next turn is built on a
   * shared understanding that does not exist: it stops re-offering something it
   * "already mentioned", or answers a question nobody heard it ask.
   *
   * Returns what was dropped, for logging.
   */
  truncateLastAgentTurn(callSid: string, heard: string): string | null {
    const session = this.sessions.get(callSid);
    if (!session) return null;
    const spoken = heard.trim();
    if (!spoken) return null;
    for (let i = session.turns.length - 1; i >= 0; i -= 1) {
      const turn = session.turns[i]!;
      if (turn.role !== 'agent') continue;
      // Only ever shortens. A longer or unrelated value means the interrupt refers to
      // something else — leave the record alone rather than corrupting it on a guess.
      if (!turn.text.startsWith(spoken) || spoken.length >= turn.text.length) return null;
      const dropped = turn.text.slice(spoken.length).trim();
      turn.text = spoken;
      turn.interrupted = true;
      return dropped;
    }
    return null;
  }

  /** Applies a patch to the consumer's own state. */
  patchState(callSid: string, patch: Partial<TState>): void {
    const session = this.sessions.get(callSid);
    if (!session) return;
    session.state = { ...session.state, ...patch };
  }

  recordToolCall(callSid: string, name: string, ok: boolean): void {
    const session = this.sessions.get(callSid);
    if (!session) return;
    session.toolCalls.push({ name, ok, at: new Date().toISOString() });
  }

  end(callSid: string): VoiceSession<TState> | undefined {
    const session = this.sessions.get(callSid);
    if (!session) return undefined;
    session.endedAt = new Date().toISOString();
    setTimeout(() => this.sessions.delete(callSid), this.ttlMs).unref?.();
    return session;
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Test helper — never used by a server. */
  _clear(): void {
    this.sessions.clear();
  }
}
