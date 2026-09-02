import type { Industry, Urgency } from '../core/taxonomy.ts';
import type { Session } from '../core/types.ts';

/** One thing the agent is trying to learn, in plain language. */
export interface QualificationField {
  key: string;
  /** What to find out. Phrased as a goal, not a script line. */
  goal: string;
  /** Marks fields the specialist should not close without. */
  required?: boolean;
  /** Only pursue once these are known — keeps intake in a sane order. */
  after?: string[];
}

export interface UrgencyRule {
  /** Caller signals that trigger this level. */
  when: string;
  level: Urgency;
  /** What the agent must do first at this level, before normal intake. */
  action: string;
}

export interface EscalationRule {
  when: string;
  action: string;
}

export interface BookingRules {
  /** What the appointment is called to the caller. */
  appointmentName: string;
  durationMinutes: number;
  /** Whether this industry books on the call at all. Some (enterprise
   * RFQ, dealer trade-ins) route to a person instead. */
  booksOnCall: boolean;
  /** Anything that must be captured before offering times. */
  prerequisites?: string[];
}

/**
 * A specialist brain. One consistent interface, so the orchestrator
 * needs zero industry-specific branching.
 */
export interface IndustrySpecialist {
  id: string;
  industry: Industry;
  /** Sub-vertical within the industry, e.g. 'family_law'. */
  specialty: string;
  displayName: string;
  /** Intents this specialist claims from the router. */
  supportedIntents: string[];
  /** Claimed when the router's specialty/intent matches. */
  matches: (specialty: string | null, intent: string | null) => boolean;
  /** First thing said after routing. This IS the handoff — the caller
   * must never hear that anything switched. */
  openingLine: (session: Session) => string;
  /** Domain knowledge + intake plan, appended to the core voice rules.
   * Only the SELECTED specialist's prompt is ever sent to Claude. */
  systemPrompt: string;
  qualificationSchema: QualificationField[];
  /**
   * The fields worth pursuing on THIS call, most relevant first.
   *
   * Defaults to the whole schema. A specialist overrides it when its
   * calls are not all the same shape: a body shop's accident intake
   * and its restoration intake share a schema and almost no fields,
   * and showing a restoration caller "whether anyone is hurt" is how
   * an agent ends up asking it.
   */
  qualificationGoalsFor?: (session: Session) => string[];
  urgencyRules: UrgencyRule[];
  escalationRules: EscalationRule[];
  bookingRules: BookingRules;
  /** Realistic openers a caller might use. Doubles as router fixtures. */
  sampleUtterances: string[];
}

/** Shared escalation every specialist inherits — a caller asking for a
 * human is never an industry-specific concern. */
export const COMMON_ESCALATIONS: EscalationRule[] = [
  { when: 'the caller asks to speak to a person', action: 'acknowledge, offer to connect them, and use the transfer tool' },
  { when: 'the caller is angry or distressed and intake is not helping', action: 'stop asking questions and offer a callback from the team' },
  { when: 'the caller describes a medical emergency or immediate danger', action: 'tell them to call 911 and stop intake' },
];
