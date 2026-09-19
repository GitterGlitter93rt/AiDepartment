/**
 * The plan an inbound call is answered with.
 * Authority: YAD-VOICE-INBOUND-OUTBOUND-ROUTING-AUTHORITY.md §1, §4.
 *
 * This is the whole contract between the voice service and the sales brain. The
 * service knows the shape and nothing else: it does not know what a callback is, how
 * one is decided, or what a suppression means. It takes a greeting and a mode.
 *
 * That boundary is the point. The model in this process cannot decide whether a call
 * is a callback, because by the time the process has anything to say, the decision
 * has already been made somewhere it can be audited.
 */

export type InboundMode = 'INBOUND_CALLBACK' | 'INBOUND_GENERAL';

export interface InboundCallPlan {
  mode: InboundMode;
  /** The first thing said. Already safe: the planner is what decides that. */
  greeting: string;
  /** Why this plan, for the log. Never spoken. */
  reason: string;
  /**
   * True when the plan is a fallback rather than a resolution -- the resolver was
   * absent, slow or failing. The call is still answered; the log says it was blind.
   */
  degraded?: boolean;
}

/**
 * What anybody hears when we could not, or did not, identify them.
 *
 * The same sentence for a stranger, a suppressed company, a wrong number and a
 * resolver outage, on purpose: a greeting that varies with what we know about the
 * caller tells the caller what we know about them.
 */
export const GENERAL_GREETING =
  'Thanks for calling Your AI Department. What can I help you with?';
