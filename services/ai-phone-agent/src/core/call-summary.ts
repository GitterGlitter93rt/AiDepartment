// End-of-call summary and demo analytics.
//
// Two consumers with different needs, so two shapes:
//
//   buildCallSummary()  — what a human wants: who called, what they
//                         needed, what was captured, what happened.
//                         Deterministic, built from session state. No
//                         model call, so it is always produced even
//                         when the API is down, which is exactly when
//                         you most want to know what happened.
//
//   buildDemoAnalytics() — what the business wants to count across
//                          many demo calls: which industries get
//                          exercised, how often routing was confident,
//                          how often callers switched scenarios, how
//                          often the guardrails fired.
//
// Neither contains the transcript. A demo line is still a phone call
// with a real person on it, and the analytics record exists to be
// aggregated, not to be read.

import type { Session } from './types.ts';

export interface CallSummary {
  callSid: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  industry: string | null;
  specialty: string | null;
  intent: string | null;
  urgency: string;
  routingConfidence: number;
  routingSource: string;
  /** Contact details gathered, as captured. */
  contact: Record<string, string>;
  /** Specialist qualification answers. */
  qualification: Record<string, unknown>;
  /** Which fields the specialist asked for and did NOT get. */
  missingFields: string[];
  toolCalls: { name: string; ok: boolean }[];
  appointmentBooked: boolean;
  transferred: boolean;
  turnCount: number;
  scenarioSwitches: number;
  guardrailHits: number;
  /** One-line plain-language description. */
  headline: string;
}

function seconds(from: string, to: string): number {
  const d = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return Number.isFinite(d) && d > 0 ? Math.round(d) : 0;
}

export function buildCallSummary(
  session: Session,
  expectedFields: string[] = [],
  now: Date = new Date(),
): CallSummary {
  const endedAt = session.endedAt ?? now.toISOString();

  const contact: Record<string, string> = {};
  for (const [k, v] of Object.entries(session.contact)) {
    if (typeof v === 'string' && v.trim() !== '') contact[k] = v;
  }

  const captured = new Set([...Object.keys(contact), ...Object.keys(session.qualification)]);
  const missingFields = expectedFields.filter((f) => !captured.has(f));

  const appointmentBooked = session.toolCalls.some((t) => t.name === 'book_appointment' && t.ok);
  const transferred = session.toolCalls.some((t) => t.name === 'transfer_to_human' && t.ok);

  return {
    callSid: session.callSid,
    startedAt: session.startedAt,
    endedAt,
    durationSeconds: seconds(session.startedAt, endedAt),
    industry: session.route.industry,
    specialty: session.route.specialty,
    intent: session.route.intent,
    urgency: session.route.urgency,
    routingConfidence: Number(session.route.confidence.toFixed(2)),
    routingSource: session.route.source,
    contact,
    qualification: { ...session.qualification },
    missingFields,
    toolCalls: session.toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
    appointmentBooked,
    transferred,
    turnCount: session.turns.length,
    scenarioSwitches: session.scenarioSwitches,
    guardrailHits: session.probeCount,
    headline: headlineFor(session, appointmentBooked, transferred, contact),
  };
}

function headlineFor(
  session: Session,
  booked: boolean,
  transferred: boolean,
  contact: Record<string, string>,
): string {
  const who = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unidentified caller';
  const what = session.route.intent ?? session.route.industry ?? 'purpose not established';
  const outcome = booked
    ? 'appointment booked'
    : transferred
      ? 'transferred to a human'
      : contact.phone || contact.email
        ? 'details captured for follow-up'
        : 'no contact details captured';
  const urgent = session.route.urgency === 'emergency' ? ' [EMERGENCY]' : '';
  return `${who} — ${what.replace(/_/g, ' ')} — ${outcome}.${urgent}`;
}

// ---------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------

/**
 * The aggregate record. Deliberately contains no name, phone number,
 * email, address, or free text the caller spoke — this is a counting
 * record, and a counting record that carries personal data is a
 * liability with no upside.
 */
export interface DemoAnalyticsEvent {
  event: 'demo_call_completed';
  callSid: string;
  at: string;
  durationSeconds: number;
  industry: string | null;
  specialty: string | null;
  intent: string | null;
  urgency: string;
  routingSource: string;
  routingConfidence: number;
  /** True when the deterministic classifier settled it with no model call. */
  routedOnFastPath: boolean;
  clarifyingQuestionsAsked: number;
  scenarioSwitches: number;
  turnCount: number;
  toolCallCount: number;
  appointmentBooked: boolean;
  transferred: boolean;
  guardrailHits: number;
  /** Whether ANY contact detail was captured — not which, or what. */
  contactCaptured: boolean;
}

export function buildDemoAnalytics(session: Session, now: Date = new Date()): DemoAnalyticsEvent {
  const endedAt = session.endedAt ?? now.toISOString();
  const contactCaptured = Object.values(session.contact).some(
    (v) => typeof v === 'string' && v.trim() !== '',
  );

  return {
    event: 'demo_call_completed',
    callSid: session.callSid,
    at: endedAt,
    durationSeconds: seconds(session.startedAt, endedAt),
    industry: session.route.industry,
    specialty: session.route.specialty,
    intent: session.route.intent,
    urgency: session.route.urgency,
    routingSource: session.route.source,
    routingConfidence: Number(session.route.confidence.toFixed(2)),
    routedOnFastPath: session.route.source === 'heuristic',
    clarifyingQuestionsAsked: session.clarifyAttempts,
    scenarioSwitches: session.scenarioSwitches,
    turnCount: session.turns.length,
    toolCallCount: session.toolCalls.length,
    appointmentBooked: session.toolCalls.some((t) => t.name === 'book_appointment' && t.ok),
    transferred: session.toolCalls.some((t) => t.name === 'transfer_to_human' && t.ok),
    guardrailHits: session.probeCount,
    contactCaptured,
  };
}

/** Keys that must never appear in an analytics payload. */
export const ANALYTICS_FORBIDDEN_KEYS = [
  'firstName', 'lastName', 'name', 'phone', 'email', 'address',
  'city', 'state', 'zip', 'company', 'from', 'to', 'transcript', 'turns',
];
