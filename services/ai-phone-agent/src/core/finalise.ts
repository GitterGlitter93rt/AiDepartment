// Finalising a call exactly once.
//
// Three things can end a call — the ConversationRelay socket closing,
// Twilio's completed status webhook, and the agent's own end_call — and
// on the first real production call two of them arrived for one
// conversation. The CRM was pushed twice and two call.ended events were
// logged.
//
// The guard lives on the session rather than in a set of seen CallSids,
// so it lasts exactly as long as the session does and cannot leak.
// Late callbacks are accepted and logged, but perform no business
// action a second time.

import type { Logger } from '../logger.ts';
import type { Session } from './types.ts';
import type { SessionStore } from './session.ts';
import type { CrmTool } from '../tools/crm.ts';
import { buildCallSummary, buildDemoAnalytics } from './call-summary.ts';

export interface FinaliseDeps {
  sessions: SessionStore;
  crm: CrmTool;
  log: Logger;
  /** Field keys the active specialist wanted, for the missing-field report. */
  expectedFields?: (session: Session) => string[];
  callSummaryEnabled?: boolean;
}

export interface FinaliseOutcome {
  /** False when this call had already been finalised. */
  ran: boolean;
  reason: string;
}

export async function finaliseCall(
  callSid: string,
  reason: string,
  deps: FinaliseDeps,
): Promise<FinaliseOutcome> {
  const { sessions, crm, log } = deps;
  const session = sessions.get(callSid);
  if (!session) return { ran: false, reason: 'no-session' };

  if (session.finalised) {
    log.log('call.ended', { callSid, reason, duplicate: true });
    return { ran: false, reason: 'already-finalised' };
  }
  // Claimed before any await, so two callbacks arriving together cannot
  // both pass the check.
  session.finalised = true;

  // A failed CRM push must not take the summary down with it. A broken
  // integration is fixable later; losing the record of what happened on
  // the call is not.
  try {
    await crm.pushLead(session);
  } catch (err) {
    log.log('tool.failed', { callSid, tool: 'crm', error: String(err).slice(0, 200) });
  }

  const ended = sessions.end(callSid) ?? session;
  const summary = buildCallSummary(ended, deps.expectedFields?.(ended) ?? []);

  log.log('call.ended', { callSid, reason, headline: summary.headline });

  // Two records on purpose. The summary is for a human reading one
  // call; the analytics event is for counting many, and carries no
  // personal data at all.
  if (deps.callSummaryEnabled !== false) {
    log.log('call.summary', summary as unknown as Record<string, unknown>);
  }
  log.log('call.summary', buildDemoAnalytics(ended) as unknown as Record<string, unknown>);

  return { ran: true, reason };
}
