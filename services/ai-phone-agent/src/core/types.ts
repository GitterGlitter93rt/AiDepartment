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
  /** Turns on which the caller probed the system rather than
   * describing a need. Past a threshold the model is not called at
   * all — see core/guardrails.ts. */
  probeCount: number;
  /** Scenario switches during this call. Expected on a demo line; a
   * prospect wants to hear the plumbing agent after the divorce one. */
  scenarioSwitches: number;
  /**
   * Set when the agent has asked to hand the call to a person.
   *
   * The tool cannot move the call itself: ConversationRelay owns the
   * media, so a transfer means ending the relay session and letting
   * Twilio follow the <Connect action=...> URL to a <Dial>. The tool
   * records the intent here; the socket carries it out after the
   * agent's last sentence has been spoken.
   */
  pendingTransfer?: { reason: string; summary: string; target: string };
  /**
   * Rolling narrative summary for long calls.
   *
   * History is trimmed to a recent window to keep latency and cost
   * bounded, which means a caller who mentions something in minute two
   * and books in minute fifteen would otherwise have lost it. Contact
   * details and qualification answers already survive trimming as
   * structured state; this covers the narrative that never became a
   * field — that the caller is in a hurry, that the neighbour saw it
   * happen, that they already spoke to someone last week.
   *
   * Regenerated in the background AFTER a reply is sent, never before,
   * so it costs the caller no silence.
   */
  summary?: { text: string; throughTurn: number };
  /**
   * Set when the agent has decided the call is finished.
   *
   * The transport reads this AFTER sending the farewell text, so the
   * goodbye is spoken in full before the line closes. Deciding this
   * by searching replies for the word "goodbye" would end calls in the
   * middle of "goodbye for now, but first...".
   */
  pendingEnd?: { reason: string; at: string };
  /** Guards against a second finalisation. See server.ts endCall(). */
  finalised?: boolean;

  /**
   * Which conversation is happening on the demo line.
   *
   * 'role_play' is the caller pretending to be a customer.
   * 'yad_sales' is the caller talking to us about their own business.
   * Never set in client mode.
   */
  demoPhase?: 'role_play' | 'yad_sales';
  /** The industry they exercised, for the sales team's notes. */
  scenarioTested?: string | null;
  /** The single soft CTA has been made. Never make it twice. */
  ctaOffered?: boolean;
  ctaDeclined?: boolean;

  /**
   * The REAL business owner on the line.
   *
   * Kept completely apart from `contact` and `qualification`, which
   * during a demo hold whatever the caller invented — a fake name, a
   * fake address, a fake insurance carrier. Booking a discovery call
   * for "John Smith of ABC Collision" because John Smith was the
   * character they played would put fiction in our CRM.
   *
   * Only the number they are calling from carries over, because that
   * one is genuinely theirs.
   */
  prospect?: ProspectRecord;
}

/** A real Your AI Department sales lead, never role-play data. */
export interface ProspectRecord {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  website?: string;
  industry?: string;
  companySize?: string;
  /** What they actually want AI to fix. */
  problemToSolve?: string;
  /** Which part of the demo landed. */
  featuresLiked?: string;
  currentCrm?: string;
  missesCalls?: boolean;
  runsPaidAds?: boolean;
  preferredTime?: string;
  /** Set only when a booking tool actually succeeded. */
  discoveryCallBooked?: boolean;
  discoveryCallAt?: string;
  discoveryCallMode?: string;
}
