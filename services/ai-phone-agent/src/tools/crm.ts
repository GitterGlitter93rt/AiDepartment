// CRM placeholder.
//
// Intentionally a no-op that logs the shape of the lead. When a real
// CRM is chosen, implement this interface and swap it in — the
// orchestrator already calls it at end of call, so nothing else moves.

import type { Session } from '../core/types.ts';

export interface CrmLead {
  callSid: string;
  from: string;
  industry: string | null;
  specialty: string | null;
  intent: string | null;
  urgency: string;
  contact: Record<string, string | undefined>;
  qualification: Record<string, unknown>;
  turnCount: number;
}

export interface CrmTool {
  pushLead(session: Session): Promise<{ ok: boolean; id?: string; mocked: boolean }>;
}

export function toLead(session: Session): CrmLead {
  return {
    callSid: session.callSid,
    from: session.from,
    industry: session.route.industry,
    specialty: session.route.specialty,
    intent: session.route.intent,
    urgency: session.route.urgency,
    contact: { ...session.contact },
    qualification: { ...session.qualification },
    turnCount: session.turns.length,
  };
}

export function createPlaceholderCrm(sink: (lead: CrmLead) => void = () => {}): CrmTool {
  return {
    async pushLead(session) {
      sink(toLead(session));
      return { ok: true, id: `placeholder-${session.callSid}`, mocked: true };
    },
  };
}
