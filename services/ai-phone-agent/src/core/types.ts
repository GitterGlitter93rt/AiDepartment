// The industry taxonomy lives in taxonomy.ts, derived from the
// website's own registry. Re-exported here so existing imports keep
// working and there is still one place to look for session types.
export type { Industry, Urgency } from './taxonomy.ts';
import type { Industry, Urgency } from './taxonomy.ts';

export interface RouteDecision {
  industry: Industry | null;
  specialty: string | null;
  intent: string | null;
  urgency: Urgency;
  confidence: number;
  /** How the decision was reached — useful in logs, never spoken. */
  source: 'heuristic' | 'llm' | 'llm-fallback' | 'none';
  /** Populated when confidence is below threshold. */
  clarifyingQuestion?: string;
}

/** Everything captured about the caller during the call. Structured so
 * it can be handed to a CRM later without re-parsing a transcript. */
export interface ContactRecord {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface Turn {
  role: 'caller' | 'agent';
  text: string;
  at: string;
}

export interface Session {
  callSid: string;
  from: string;
  to: string;
  startedAt: string;
  endedAt?: string;
  route: RouteDecision;
  /** Specialist-specific qualification answers, e.g. hasChildren: true. */
  qualification: Record<string, unknown>;
  contact: ContactRecord;
  turns: Turn[];
  /** Router runs only until it commits; after that the specialist owns
   * the conversation and we never re-classify mid-call. */
  routed: boolean;
  clarifyAttempts: number;
  toolCalls: { name: string; ok: boolean; at: string }[];
}
