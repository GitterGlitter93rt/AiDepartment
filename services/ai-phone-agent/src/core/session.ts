// Per-call session state.
//
// Keyed by Twilio CallSid, so concurrent calls are fully isolated —
// there is no module-level "current conversation" anywhere in this
// service. Sessions are held in memory and swept after the call ends;
// a multi-instance deployment would swap this for Redis behind the
// same interface.

import type { ContactRecord, RouteDecision, Session, Turn } from './types.ts';

const EMPTY_ROUTE: RouteDecision = {
  industry: null, specialty: null, intent: null,
  urgency: 'normal', confidence: 0, source: 'none',
};

export class SessionStore {
  private sessions = new Map<string, Session>();
  /** How long a finished session lingers so late webhooks can still
   * find it. Ten minutes is generous for a phone call. */
  private readonly ttlMs: number;

  // Written as an explicit field rather than a parameter property:
  // Node's --experimental-strip-types runs TypeScript by erasing types
  // only, and parameter properties emit real code, so they are not
  // supported. Keeping to strip-safe syntax is what lets this service
  // run and test with no build step.
  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  create(callSid: string, from: string, to: string): Session {
    const session: Session = {
      callSid, from, to,
      startedAt: new Date().toISOString(),
      route: { ...EMPTY_ROUTE },
      qualification: {},
      contact: {},
      turns: [],
      routed: false,
      clarifyAttempts: 0,
      toolCalls: [],
      probeCount: 0,
      scenarioSwitches: 0,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): Session | undefined {
    return this.sessions.get(callSid);
  }

  /** Get an existing session or start one — inbound webhooks can arrive
   * in an order we do not control. */
  ensure(callSid: string, from = 'unknown', to = 'unknown'): Session {
    return this.sessions.get(callSid) ?? this.create(callSid, from, to);
  }

  addTurn(callSid: string, role: Turn['role'], text: string): void {
    const s = this.sessions.get(callSid);
    if (!s) return;
    s.turns.push({ role, text, at: new Date().toISOString() });
  }

  /**
   * Cuts the last agent turn down to what the caller actually heard.
   *
   * ConversationRelay reports `utteranceUntilInterrupt` — the words it
   * had played before the caller talked over it. Without this the
   * transcript claims the agent said a whole paragraph the caller
   * never heard, and the next turn is built on a shared understanding
   * that does not exist: it stops re-offering a link it "already
   * mentioned", or answers a question nobody heard it ask.
   *
   * Returns what was dropped, for logging.
   */
  truncateLastAgentTurn(callSid: string, heard: string): string | null {
    const s = this.sessions.get(callSid);
    if (!s) return null;
    const spoken = heard.trim();
    if (!spoken) return null;
    for (let i = s.turns.length - 1; i >= 0; i -= 1) {
      const turn = s.turns[i];
      if (turn.role !== 'agent') continue;
      // Only ever shortens. A longer or unrelated value means the
      // interrupt refers to something else — leave the record alone
      // rather than corrupting it on a guess.
      if (!turn.text.startsWith(spoken) || spoken.length >= turn.text.length) return null;
      const dropped = turn.text.slice(spoken.length).trim();
      turn.text = spoken;
      turn.interrupted = true;
      return dropped;
    }
    return null;
  }

  setRoute(callSid: string, route: RouteDecision): void {
    const s = this.sessions.get(callSid);
    if (!s) return;
    s.route = route;
    // Committing to a specialist is one-way: re-classifying mid-call
    // would make the agent lurch between personas.
    if (route.industry && route.confidence > 0) s.routed = true;
  }

  mergeContact(callSid: string, patch: ContactRecord): void {
    const s = this.sessions.get(callSid);
    if (!s) return;
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === 'string' && v.trim().length > 0) {
        (s.contact as Record<string, string>)[k] = v.trim();
      }
    }
  }

  mergeQualification(callSid: string, patch: Record<string, unknown>): void {
    const s = this.sessions.get(callSid);
    if (!s) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && v !== null && v !== '') s.qualification[k] = v;
    }
  }

  recordToolCall(callSid: string, name: string, ok: boolean): void {
    const s = this.sessions.get(callSid);
    if (!s) return;
    s.toolCalls.push({ name, ok, at: new Date().toISOString() });
  }

  end(callSid: string): Session | undefined {
    const s = this.sessions.get(callSid);
    if (!s) return undefined;
    s.endedAt = new Date().toISOString();
    setTimeout(() => this.sessions.delete(callSid), this.ttlMs).unref?.();
    return s;
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Test helper — never used by the server. */
  _clear(): void {
    this.sessions.clear();
  }
}
