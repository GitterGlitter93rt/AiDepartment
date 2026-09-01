// Tool-call protocol.
//
// The division of responsibility is deliberate and absolute:
//
//   Claude REQUESTS a tool with arguments.
//   This module VALIDATES those arguments.
//   The application EXECUTES the tool.
//
// The model never touches a calendar, a phone line, or a CRM. It emits
// a structured request, and everything after that is ordinary
// application code with ordinary error handling. That matters because
// the model's arguments are untrusted input: it can hallucinate an
// email address, invent a date in the past, or ask to transfer a call
// to a number nobody configured. Every one of those is caught here and
// returned to the model as a normal tool result it can talk its way
// out of, rather than reaching the outside world.
//
// Validation failures are not errors in the call. They are information
// the agent gets to act on: "that time has already passed, offer
// another one".

import type { Session } from './types.ts';
import type { Toolbox } from '../tools/index.ts';
import type { Logger } from '../logger.ts';

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * The tools an agent may request, in Anthropic tool-use schema form.
 * Kept small on purpose: every tool is one more thing that can be
 * called at the wrong moment on a live call.
 */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'check_availability',
    description:
      'Find open appointment times. Call this before offering times to the caller — never invent availability. Returns up to a few concrete slots.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO 8601 start of the window to search.' },
        to: { type: 'string', description: 'ISO 8601 end of the window to search.' },
        durationMinutes: { type: 'number', description: 'Appointment length. Use the specialist default if unsure.' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. America/New_York.' },
      },
      required: ['from', 'to', 'durationMinutes'],
    },
  },
  {
    name: 'book_appointment',
    description:
      'Book a specific time the caller has agreed to. Only call this after check_availability returned that exact slot and the caller confirmed it.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'ISO 8601 start, must be one returned by check_availability.' },
        durationMinutes: { type: 'number' },
        title: { type: 'string' },
        attendeeName: { type: 'string' },
        attendeeEmail: { type: 'string' },
        attendeePhone: { type: 'string' },
        notes: { type: 'string', description: 'What the caller needs, in one or two sentences.' },
        timezone: { type: 'string' },
      },
      required: ['start', 'durationMinutes', 'title'],
    },
  },
  {
    name: 'send_sms',
    description:
      'Text the caller a confirmation or a link. Only to the number they are calling from or one they gave you.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'E.164 phone number.' },
        body: { type: 'string', description: 'Message text. Keep it under 300 characters.' },
      },
      required: ['to', 'body'],
    },
  },
  {
    name: 'save_lead',
    description:
      'Record what you have gathered so a human can follow up. Call this once you have a name and a way to reach them, even if no appointment was booked.',
    input_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        summary: { type: 'string', description: 'What the caller needs, in plain language.' },
        urgency: { type: 'string', enum: ['emergency', 'high', 'normal', 'low'] },
      },
      required: ['summary'],
    },
  },
  {
    name: 'transfer_to_human',
    description:
      'Hand the call to a person. Use when the caller asks for one, is in distress, or the situation is outside what you can handle.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why, in a few words. Recorded, not spoken.' },
      },
      required: ['reason'],
    },
  },
];

export interface ToolRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolOutcome {
  id: string;
  name: string;
  ok: boolean;
  /** Returned to the model as the tool result. */
  content: string;
  /** Set when validation rejected the request before execution. */
  rejected?: string;
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const E164 = /^\+?[1-9]\d{7,14}$/;

/** Longest appointment we will let the model book, in minutes. */
const MAX_DURATION = 240;
/** How far ahead a booking may be placed. */
const MAX_LEAD_DAYS = 120;

function str(input: Record<string, unknown>, key: string): string | null {
  const v = input[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function iso(input: Record<string, unknown>, key: string): Date | null {
  const raw = str(input, key);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ValidationResult {
  ok: boolean;
  /** Message handed back to the model when validation fails. */
  reason?: string;
  /** Normalised arguments, safe to execute with. */
  value?: Record<string, unknown>;
}

export function validateToolRequest(
  req: ToolRequest,
  session: Session,
  now: Date = new Date(),
): ValidationResult {
  const input = req.input ?? {};

  switch (req.name) {
    case 'check_availability': {
      const from = iso(input, 'from');
      const to = iso(input, 'to');
      const duration = Number(input.durationMinutes);
      if (!from || !to) return { ok: false, reason: 'from and to must both be valid ISO 8601 timestamps.' };
      if (to <= from) return { ok: false, reason: 'to must be after from.' };
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) {
        return { ok: false, reason: `durationMinutes must be between 1 and ${MAX_DURATION}.` };
      }
      // A window in the past is a model mistake, usually a wrong year.
      // Clamp rather than reject: the caller asked a reasonable
      // question and should not hear about it.
      const start = from < now ? now : from;
      const horizon = new Date(now.getTime() + MAX_LEAD_DAYS * 86_400_000);
      return {
        ok: true,
        value: {
          from: start.toISOString(),
          to: (to > horizon ? horizon : to).toISOString(),
          durationMinutes: duration,
          timezone: str(input, 'timezone') ?? 'America/New_York',
        },
      };
    }

    case 'book_appointment': {
      const start = iso(input, 'start');
      const duration = Number(input.durationMinutes);
      const title = str(input, 'title');
      if (!start) return { ok: false, reason: 'start must be a valid ISO 8601 timestamp.' };
      if (start < now) {
        return { ok: false, reason: 'That time is in the past. Check availability again and offer a time in the future.' };
      }
      if (start > new Date(now.getTime() + MAX_LEAD_DAYS * 86_400_000)) {
        return { ok: false, reason: `Bookings cannot be more than ${MAX_LEAD_DAYS} days out.` };
      }
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) {
        return { ok: false, reason: `durationMinutes must be between 1 and ${MAX_DURATION}.` };
      }
      if (!title) return { ok: false, reason: 'title is required.' };

      const email = str(input, 'attendeeEmail');
      if (email && !EMAIL.test(email)) {
        return { ok: false, reason: 'That email address does not look right. Read it back to the caller and confirm it.' };
      }
      const phone = str(input, 'attendeePhone');
      if (phone && !E164.test(phone.replace(/[\s()-]/g, ''))) {
        return { ok: false, reason: 'That phone number does not look right. Confirm it with the caller.' };
      }

      return {
        ok: true,
        value: {
          start: start.toISOString(),
          end: new Date(start.getTime() + duration * 60_000).toISOString(),
          title,
          attendeeName: str(input, 'attendeeName') ?? undefined,
          attendeeEmail: email ?? undefined,
          attendeePhone: phone ?? undefined,
          notes: str(input, 'notes') ?? undefined,
          timezone: str(input, 'timezone') ?? 'America/New_York',
        },
      };
    }

    case 'send_sms': {
      const to = str(input, 'to');
      const body = str(input, 'body');
      if (!to || !E164.test(to.replace(/[\s()-]/g, ''))) {
        return { ok: false, reason: 'to must be a valid phone number in E.164 form.' };
      }
      if (!body) return { ok: false, reason: 'body is required.' };
      if (body.length > 320) return { ok: false, reason: 'body must be 320 characters or fewer.' };
      // The model may only text the caller or a number the caller gave.
      // Without this it could be talked into texting an arbitrary
      // number, which turns the demo line into a free SMS relay.
      const allowed = [session.from, session.contact.phone].filter(Boolean).map((n) => digits(String(n)));
      if (allowed.length > 0 && !allowed.includes(digits(to))) {
        return { ok: false, reason: 'You can only text the number the caller is calling from or one they gave you.' };
      }
      return { ok: true, value: { to, body } };
    }

    case 'save_lead': {
      const summary = str(input, 'summary');
      if (!summary) return { ok: false, reason: 'summary is required.' };
      const email = str(input, 'email');
      if (email && !EMAIL.test(email)) {
        return { ok: false, reason: 'That email address does not look right. Confirm it with the caller.' };
      }
      const urgency = str(input, 'urgency');
      const validUrgency = ['emergency', 'high', 'normal', 'low'];
      return {
        ok: true,
        value: {
          firstName: str(input, 'firstName') ?? undefined,
          lastName: str(input, 'lastName') ?? undefined,
          phone: str(input, 'phone') ?? session.from,
          email: email ?? undefined,
          summary,
          urgency: urgency && validUrgency.includes(urgency) ? urgency : session.route.urgency,
        },
      };
    }

    case 'transfer_to_human': {
      const reason = str(input, 'reason');
      if (!reason) return { ok: false, reason: 'reason is required.' };
      return { ok: true, value: { reason } };
    }

    default:
      return { ok: false, reason: `Unknown tool "${req.name}".` };
  }
}

/** One-line description of the call, for whoever picks up a transfer. */
function summarise(session: Session): string {
  const who = [session.contact.firstName, session.contact.lastName].filter(Boolean).join(' ') || 'Caller';
  const what = session.route.intent ?? session.route.industry ?? 'unclassified';
  return `${who} (${session.from}) — ${what}, urgency ${session.route.urgency}. ${session.turns.length} turns so far.`;
}

function digits(s: string): string {
  return s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

// ---------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------

export interface ExecuteDeps {
  tools: Toolbox;
  log: Logger;
  session: Session;
  now?: () => Date;
}

/**
 * Runs one validated tool request.
 *
 * Every failure path — validation, a thrown adapter, a missing
 * credential — comes back as a ToolOutcome the model can read. Nothing
 * here throws into the turn loop, because an exception mid-call is
 * dead air and dead air is a hung-up caller.
 */
export async function executeToolRequest(req: ToolRequest, deps: ExecuteDeps): Promise<ToolOutcome> {
  const { tools, log, session } = deps;
  const now = deps.now?.() ?? new Date();

  const check = validateToolRequest(req, session, now);
  if (!check.ok) {
    log.log('tool.failed', { callSid: session.callSid, tool: req.name, rejected: check.reason });
    return { id: req.id, name: req.name, ok: false, content: check.reason ?? 'Invalid request.', rejected: check.reason };
  }

  const args = check.value ?? {};
  log.log('tool.requested', { callSid: session.callSid, tool: req.name });

  try {
    const content = await run(req.name, args, deps);
    session.toolCalls.push({ name: req.name, ok: true, at: now.toISOString() });
    log.log('tool.completed', { callSid: session.callSid, tool: req.name });
    return { id: req.id, name: req.name, ok: true, content };
  } catch (err) {
    session.toolCalls.push({ name: req.name, ok: false, at: now.toISOString() });
    log.log('tool.failed', { callSid: session.callSid, tool: req.name, error: String(err).slice(0, 200) });
    // Phrased as something the agent can say its way around. The caller
    // must never hear that a system failed.
    return {
      id: req.id,
      name: req.name,
      ok: false,
      content: 'That did not go through. Take the caller\'s details and tell them someone will confirm shortly. Do not mention a system problem.',
    };
  }
}

async function run(name: string, args: Record<string, unknown>, deps: ExecuteDeps): Promise<string> {
  const { tools, session } = deps;

  switch (name) {
    case 'check_availability': {
      const slots = await tools.calendar.checkAvailability({
        dateRange: { from: String(args.from), to: String(args.to) },
        durationMinutes: Number(args.durationMinutes),
        timezone: String(args.timezone),
      });
      if (slots.length === 0) {
        return 'No open times in that window. Widen the window or offer to have someone call back.';
      }
      // Three is the most a caller can hold in their head on a phone
      // call. Offering ten is how you lose a booking.
      const offer = slots.slice(0, 3);
      return JSON.stringify({ available: offer, note: 'Offer these as specific times. Do not invent others.' });
    }

    case 'book_appointment': {
      const booked = await tools.calendar.bookAppointment({
        title: String(args.title),
        start: String(args.start),
        end: String(args.end),
        attendeeName: args.attendeeName as string | undefined,
        attendeeEmail: args.attendeeEmail as string | undefined,
        attendeePhone: args.attendeePhone as string | undefined,
        notes: args.notes as string | undefined,
        timezone: args.timezone as string | undefined,
      });
      return JSON.stringify({
        booked: true, id: booked.id, start: booked.start, end: booked.end,
        note: 'Confirm the time back to the caller once, then move on.',
      });
    }

    case 'send_sms': {
      const res = await tools.sms.send({ to: String(args.to), body: String(args.body) });
      return JSON.stringify({ sent: true, id: res.sid });
    }

    case 'save_lead': {
      // Anything the model gathered is merged into the session first,
      // so the lead the CRM receives is the session's own record rather
      // than a second, divergent copy of the same call.
      const contact: Record<string, string> = {};
      for (const k of ['firstName', 'lastName', 'phone', 'email'] as const) {
        const v = args[k];
        if (typeof v === 'string' && v.trim() !== '') contact[k] = v.trim();
      }
      Object.assign(session.contact, contact);
      session.qualification.summary = String(args.summary);
      if (args.urgency) session.route.urgency = args.urgency as typeof session.route.urgency;

      const res = await tools.crm.pushLead(session);
      return JSON.stringify({ saved: res.ok, id: res.id });
    }

    case 'transfer_to_human': {
      const res = await tools.transfer.transferCall({
        targetNumber: '',
        reason: String(args.reason),
        summary: summarise(session),
        callSid: session.callSid,
      });
      if (!res.accepted) {
        // No transfer number configured is a deployment gap, not
        // something the caller should hear about.
        return JSON.stringify({
          transferred: false,
          note: 'A transfer is not available. Take their details and promise a call back within the hour.',
        });
      }
      return JSON.stringify({ transferred: true, note: 'The call is being handed over. Say one short reassuring line and stop.' });
    }

    default:
      throw new Error(`unhandled tool ${name}`);
  }
}
