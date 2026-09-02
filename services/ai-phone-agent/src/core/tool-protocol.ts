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

import { recommendTowType, type TowFacts } from '../business/tow-equipment.ts';
import type { Session } from './types.ts';
import type { Toolbox } from '../tools/index.ts';
import type { Logger } from '../logger.ts';
import { resolveWhen, speakSlot } from './when.ts';
import {
  policiesFor, packetById, purposeById, partnerById,
} from '../business/policies.ts';
import { speechFor } from '../tools/actions.ts';
import { speakZip } from './speech.ts';
import { resolveSmsRecipient, resolveCallbackRecipient, isUsableNumber } from './contact-routing.ts';
import { YAD_DISCOVERY_CALL } from '../business/policies.ts';

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
        spokenWhen: {
          type: 'string',
          description:
            "What the caller actually said about timing, in their own words — \"Thursday morning\", \"tomorrow\", \"as soon as possible\". Pass this whenever they gave one; it is more reliable than a window you calculate, and it overrides from/to.",
        },
      },
      required: ['durationMinutes'],
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
    name: 'capture_details',
    description:
      'Record details the caller has given you, as soon as they give them — do not wait until the end of the call. Call this whenever they volunteer a name, a way to reach them, an address, or an answer to something you needed. Send only what they actually said; never guess at a spelling or fill in a field they did not mention.',
    input_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        company: { type: 'string' },
        address: { type: 'string', description: 'Street address as they said it.' },
        city: { type: 'string' },
        state: { type: 'string' },
        zip: { type: 'string' },
        phoneConfirmed: { type: 'boolean', description: 'True once they have agreed the number you have is the right one. Set it as soon as they say yes, so nobody asks twice.' },
        smsPhone: { type: 'string', description: 'A different number they want texts sent to, if they nominated one.' },
        smsAllowed: { type: 'boolean', description: 'False if they said not to text them.' },
        notes: {
          type: 'object',
          description: 'Anything else worth keeping that does not fit the fields above — answers to your qualifying questions, constraints they mentioned. Keys should be short and descriptive.',
        },
      },
      required: [],
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
    name: 'request_advisor_callback',
    description:
      'Hand a project to a repair advisor to price and call back on. This is how a custom job, a restoration or a "how much would it cost" ends — those cannot be quoted on a call, so the outcome is a briefed human ringing them. It records the request; it does not contact anyone itself, so never tell the caller an advisor is calling until this comes back successful.',
    input_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        phone: { type: 'string', description: 'Best number for the advisor to call.' },
        email: { type: 'string', description: 'Where the advisor sends the written estimate.' },
        vehicleYear: { type: 'string' },
        vehicleMake: { type: 'string' },
        vehicleModel: { type: 'string' },
        projectDescription: { type: 'string', description: "What they want done, in the caller's own words." },
        projectType: { type: 'string', enum: ['custom_work', 'restoration', 'paint_or_color', 'estimate', 'other'] },
      },
      required: ['projectDescription', 'projectType'],
    },
  },
  {
    name: 'change_appointment',
    description:
      'Reschedule or cancel an appointment the caller says they already have. You cannot look up bookings, so this records the request for a person to action — it does NOT change anything by itself. Never tell the caller their appointment has been moved or cancelled; tell them someone will confirm.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['reschedule', 'cancel'] },
        callerName: { type: 'string' },
        phone: { type: 'string' },
        currentAppointment: { type: 'string', description: 'What the caller says their existing appointment is. Their words, not a lookup.' },
        preferredNewTime: { type: 'string', description: 'For a reschedule: what they said about the new time, in their words.' },
        reason: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'dispatch_tow',
    description:
      'Send a tow truck to the caller. Only after you know where they are precisely enough for a driver to find them, and only when the vehicle cannot be driven. The destination is set by the business — you do not choose it and must never name a towing company, a driver, or a price.',
    input_schema: {
      type: 'object',
      properties: {
        callerName: { type: 'string' },
        callbackPhone: { type: 'string', description: 'E.164. Use the number they called from unless they gave another.' },
        pickupLocation: { type: 'string', description: "Where the vehicle is, in the caller's own words — road, direction, nearest exit or landmark." },
        directionOfTravel: { type: 'string', description: 'Northbound, southbound and so on, when it is a highway or bridge.' },
        vehicleYear: { type: 'string' },
        vehicleMake: { type: 'string' },
        vehicleModel: { type: 'string' },
        vehicleColor: { type: 'string' },
        vehicleCondition: { type: 'string', description: 'Drivable, undrivable, airbags deployed, blocking a lane.' },
        rolls: { type: 'boolean', description: 'Do the wheels turn freely — can it be pushed?' },
        steers: { type: 'boolean', description: 'Will the front wheels turn?' },
        wheelLocked: { type: 'boolean', description: 'Is any wheel jammed or seized?' },
        suspensionDamage: { type: 'boolean', description: 'Wheel sitting at an angle, or anything folded underneath.' },
        drivetrain: { type: 'string', enum: ['FWD', 'RWD', 'AWD', '4WD'], description: 'Only if the caller actually says. Never infer it — an all-wheel-drive car towed on its wheels needs a new drivetrain.' },
        accessType: { type: 'string', enum: ['road', 'parking_garage', 'ditch', 'median', 'tight_access', 'other'] },
        accessNotes: { type: 'string', description: 'Anything a driver needs to know to reach it.' },
        recoveryRequired: { type: 'boolean', description: 'Off the road — needs winching before it can be loaded.' },
        unattended: { type: 'boolean', description: 'True if the caller will not be there when the truck arrives.' },
        keyHandoffMethod: { type: 'string', enum: ['hand_to_driver', 'hidden_at_vehicle', 'inside_vehicle', 'third_party_handoff', 'other'] },
        keyInstructions: { type: 'string', description: "Where the key will be, in the caller's own words." },
        vehicleUnlockedForTow: { type: 'boolean' },
        insuranceCarrier: { type: 'string' },
        claimNumber: { type: 'string' },
        policyNumber: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['callerName', 'callbackPhone', 'pickupLocation'],
    },
  },
  {
    name: 'create_location_link',
    description:
      "Text the caller a secure link so they can share exactly where the vehicle is — either their current location, or a pin they drop on a map. Use this when they cannot describe the spot well enough for a driver to find it, which on a bridge or a highway is most of the time. You supply no address, no coordinates and no phone number: the system texts the number they called from.",
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why it is needed — "on a bridge, no exit known". Recorded, not spoken.' },
      },
      required: [],
    },
  },
  {
    name: 'create_upload_link',
    description:
      'Create a secure link the caller can use to send photos or documents, and text it to them. Choose the purpose from the list the business allows — you cannot supply a web address, and one you invented would be rejected. Never ask anyone to take photos while they are somewhere unsafe.',
    input_schema: {
      type: 'object',
      properties: {
        purposeId: { type: 'string', description: 'One of the purpose ids listed in your business configuration.' },
        callerIsSafe: { type: 'boolean', description: 'True only if the caller is out of danger and away from traffic. Required before any photo request.' },
      },
      required: ['purposeId', 'callerIsSafe'],
    },
  },
  {
    name: 'send_esign_packet',
    description:
      'Send the business\'s electronic signature packet. Choose only a packet id from your configuration — you do not write, name, describe or select forms, and you must never characterise what the paperwork says.',
    input_schema: {
      type: 'object',
      properties: {
        packetId: { type: 'string', description: 'One of the packet ids in your business configuration.' },
        deliveryChannel: { type: 'string', enum: ['sms', 'email'] },
        recipientEmail: { type: 'string', description: 'Required when delivering by email.' },
        consentConfirmed: { type: 'boolean', description: 'True only if you asked and they said yes on this call. Handing you an email address is not consent to sign anything.' },
      },
      required: ['packetId', 'deliveryChannel', 'consentConfirmed'],
    },
  },
  {
    name: 'create_partner_referral',
    description:
      "Pass the caller's contact details to a partner the business works with. ONLY after they have clearly said yes to being referred — never because they mentioned being hurt. If they decline, that is the end of it and the rest of the call carries on exactly as before.",
    input_schema: {
      type: 'object',
      properties: {
        partnerId: { type: 'string', description: 'One of the partner ids in your business configuration.' },
        consentConfirmed: { type: 'boolean', description: 'True only if the caller explicitly agreed on this call.' },
      },
      required: ['partnerId', 'consentConfirmed'],
    },
  },
  {
    name: 'capture_prospect',
    description:
      "Record the REAL business owner's details on the Your AI Department demo line. Completely separate from capture_details, which holds whatever character they played during the simulation. Never copy a name, company or address out of the role-play into here — ask them fresh.",
    input_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' }, lastName: { type: 'string' },
        companyName: { type: 'string' }, email: { type: 'string' },
        phone: { type: 'string', description: 'Only if different from the number they are calling from.' },
        phoneConfirmed: { type: 'boolean', description: 'True once they confirm the number is right for our team to use.' },
        website: { type: 'string' }, industry: { type: 'string' },
        companySize: { type: 'string' },
        problemToSolve: { type: 'string', description: 'What they actually want AI to fix.' },
        featuresLiked: { type: 'string', description: 'Which part of the demo landed.' },
        currentCrm: { type: 'string' },
        missesCalls: { type: 'boolean' }, runsPaidAds: { type: 'boolean' },
        preferredTime: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'book_discovery_call',
    description:
      'Book the Your AI Department discovery call. Only after check_availability returned that exact slot and the prospect chose it, and only once you have their real name, company, email and a number. This is OUR appointment, not the appointment type of whatever industry they were testing.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'ISO 8601 start, one returned by check_availability.' },
        notes: { type: 'string', description: 'What they tested and what they want solved. Internal — never read aloud.' },
      },
      required: ['start'],
    },
  },
  {
    name: 'end_call',
    description:
      "Finish the call. Use this ONLY after you have said goodbye and the caller has confirmed there is nothing else — they said no, that's it, thanks that's all, or goodbye. Your farewell is spoken first and in full; this ends the line afterwards. Do NOT use it because the caller thanked you mid-conversation, and never use it while anything is still outstanding.",
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why the call is complete, in a few words. Recorded, not spoken.' },
      },
      required: ['reason'],
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
  /** Field names the request still needs. See ValidationResult. */
  missing?: string[];
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
  /**
   * What is actually missing, as field names.
   *
   * A prose reason tells the model it failed; it does not reliably
   * tell it what to DO, which is how the tow flow ended up asking for
   * a truck four times in a row. Naming the gap turns a rejection into
   * the next question.
   */
  missing?: string[];
}

export function validateToolRequest(
  req: ToolRequest,
  session: Session,
  now: Date = new Date(),
): ValidationResult {
  const input = req.input ?? {};

  switch (req.name) {
    case 'check_availability': {
      const duration = Number(input.durationMinutes);
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) {
        return { ok: false, reason: `durationMinutes must be between 1 and ${MAX_DURATION}.` };
      }

      // The caller's own words beat any window the model computed.
      // "Thursday morning" is unambiguous to a person and routinely
      // becomes the wrong Thursday, or the wrong year, once a model
      // turns it into a timestamp.
      const spoken = str(input, 'spokenWhen');
      const resolved = spoken ? resolveWhen(spoken, now) : null;

      let from = resolved?.from ?? iso(input, 'from');
      let to = resolved?.to ?? iso(input, 'to');

      // Neither a phrase nor a usable window: search the next fortnight
      // rather than making the caller repeat themselves.
      if (!from || !to || to <= from) {
        from = now;
        to = new Date(now.getTime() + 14 * 86_400_000);
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
          interpreted: resolved?.interpreted ?? 'unspecified',
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

    case 'capture_details': {
      const value: Record<string, unknown> = {};
      for (const key of ['firstName', 'lastName', 'phone', 'email', 'company', 'address', 'city', 'state', 'zip', 'smsPhone'] as const) {
        const v = str(input, key);
        if (v) value[key] = v;
      }
      for (const key of ['phoneConfirmed', 'smsAllowed'] as const) {
        if (typeof input[key] === 'boolean') value[key] = input[key];
      }
      const alt = value.smsPhone as string | undefined;
      if (alt && !isUsableNumber(alt)) {
        return { ok: false, reason: 'That texting number does not look right. Confirm it with them.' };
      }
      // A number they spoke is theirs, so it arrives confirmed.
      if (value.phone && value.phoneConfirmed === undefined) value.phoneConfirmed = true;
      if (value.phone) value.phoneSource = 'caller_provided';
      const email = value.email as string | undefined;
      if (email && !EMAIL.test(email)) {
        return { ok: false, reason: 'That email address does not look right. Read it back to the caller and confirm it.' };
      }
      const phone = value.phone as string | undefined;
      if (phone && !E164.test(phone.replace(/[\s()-]/g, ''))) {
        return { ok: false, reason: 'That phone number does not look right. Confirm it with the caller.' };
      }
      const notes = input.notes;
      if (notes !== undefined && (typeof notes !== 'object' || notes === null || Array.isArray(notes))) {
        return { ok: false, reason: 'notes must be an object of short key/value pairs.' };
      }
      if (Object.keys(value).length === 0 && !notes) {
        return { ok: false, reason: 'Nothing to record — send at least one field the caller actually gave you.' };
      }
      if (notes) value.notes = notes;
      return { ok: true, value };
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

    case 'change_appointment': {
      const action = str(input, 'action');
      if (action !== 'reschedule' && action !== 'cancel') {
        return { ok: false, reason: "action must be 'reschedule' or 'cancel'." };
      }
      // A reschedule with no idea when is not a reschedule request, it
      // is an unfinished conversation.
      if (action === 'reschedule' && !str(input, 'preferredNewTime')) {
        return { ok: false, reason: 'Ask the caller when they would like to move it to before recording the change.' };
      }
      const phone = str(input, 'phone');
      if (phone && !E164.test(phone.replace(/[\s()-]/g, ''))) {
        return { ok: false, reason: 'That phone number does not look right. Confirm it with the caller.' };
      }
      return {
        ok: true,
        value: {
          action,
          callerName: str(input, 'callerName') ?? undefined,
          phone: phone ?? session.from,
          currentAppointment: str(input, 'currentAppointment') ?? undefined,
          preferredNewTime: str(input, 'preferredNewTime') ?? undefined,
          reason: str(input, 'reason') ?? undefined,
        },
      };
    }

    case 'dispatch_tow': {
      const callerName = str(input, 'callerName');
      const phone = str(input, 'callbackPhone');
      const pickup = str(input, 'pickupLocation');

      const policy = policiesFor(session.route.industry).tow;
      if (!policy?.available) {
        return { ok: false, reason: 'This business does not arrange towing. Take their details instead.' };
      }
      if (!callerName) return { ok: false, reason: 'Get their name before dispatching a truck.', missing: ['caller_name'] };
      if (!phone || !E164.test(phone.replace(/[\s()-]/g, ''))) {
        return { ok: false, reason: 'A valid callback number is required — the driver needs to reach them.', missing: ['callback_phone'] };
      }
      // Confirmed, not merely present. A driver ringing a number the
      // caller never agreed to is a driver who cannot find them.
      const callback = resolveCallbackRecipient(session);
      if (!callback.confirmed) {
        return {
          ok: false,
          reason: callback.reason ?? "Confirm the callback number before dispatching — don't make them recite it, just check the one you have.",
          missing: ['callback_phone_confirmed'],
        };
      }
      // Which truck. Worked out here, from facts, so the answer does
      // not depend on the model reasoning about axles mid-call.
      const q0 = session.qualification as Record<string, unknown>;
      const facts: TowFacts = {
        rolls: boolOf(input, 'rolls') ?? (q0.towRolls as boolean | undefined),
        steers: boolOf(input, 'steers') ?? (q0.towSteers as boolean | undefined),
        wheelLocked: boolOf(input, 'wheelLocked') ?? (q0.towWheelLocked as boolean | undefined),
        suspensionDamage: boolOf(input, 'suspensionDamage') ?? (q0.towSuspensionDamage as boolean | undefined),
        drivetrain: (str(input, 'drivetrain') ?? q0.drivetrain) as TowFacts['drivetrain'],
        accessType: (str(input, 'accessType') ?? q0.towAccessType) as TowFacts['accessType'],
        recoveryRequired: boolOf(input, 'recoveryRequired') ?? (q0.towRecoveryRequired as boolean | undefined),
      };
      const equipment = recommendTowType(facts);

      // A caller who is leaving must have said where the keys will be.
      // A driver arriving to a locked car and nobody there is a wasted
      // truck and a second tow.
      const leaving = boolOf(input, 'unattended') ?? (q0.callerLeaving as boolean | undefined);
      if (leaving === true) {
        const method = str(input, 'keyHandoffMethod') ?? (q0.keyHandoffMethod as string | undefined);
        const instructions = str(input, 'keyInstructions') ?? (q0.towDriverKeyInstructions as string | undefined);
        if (!method || (!instructions && method !== 'hand_to_driver')) {
          return {
            ok: false,
            reason: 'They are leaving the vehicle. Ask where they will put the key — on a tyre, in the wheel well, inside if they are leaving it unlocked. Their choice, at the vehicle.',
            missing: ['key_handoff_plan'],
          };
        }
      }

      // Somebody has to actually want a tow. The word appearing in a
      // sentence is not a request — "do you do towing?" is a question.
      const q = session.qualification as Record<string, unknown>;
      const condition = str(input, 'vehicleCondition') ?? '';
      const undrivable = q.towNeeded === true
        || q.vehicleDrivable === false
        || /\b(undrivable|not drivable|won'?t (drive|start|move)|totaled|totalled|airbag|blocking|leaking|smoking|crushed|no wheels)\b/i.test(condition);
      if (!undrivable) {
        return { ok: false, reason: 'Confirm the vehicle actually cannot be driven, or that they want it towed, before sending a truck.' };
      }

      // A driver has to find the right car on a dark shoulder.
      const make = str(input, 'vehicleMake');
      const model = str(input, 'vehicleModel');
      if (!make || !model) {
        return { ok: false, reason: 'Ask what they are driving — the make and model at least, and the colour if it is roadside.' };
      }

      // A submitted secure location already gives dispatch precise
      // coordinates. Continuing to ask for a mile marker would be
      // interrogating somebody who has already answered.
      const hasSecureLocation = session.roadsideLocation?.confirmed === true
        && session.roadsideLocation.latitude !== undefined;

      const direction = str(input, 'directionOfTravel');
      if (!hasSecureLocation) {
        if (pickup === null || pickup.length < 8) {
          return { ok: false, reason: 'That location is not specific enough for a driver to find them. Ask the direction of travel, the nearest exit, or a landmark — or offer the secure location link.' };
        }
        if (/\b(bridge|highway|interstate|i-\d+|freeway|turnpike|expressway|\bhwy\b)\b/i.test(pickup) && !direction) {
          return { ok: false, reason: 'On a bridge or highway a driver needs the direction of travel. Ask which way they were heading, or send the secure location link.' };
        }
      }

      // The destination is the business's, never the model's.
      const destination = policy.destinations.find((d) => d.id === policy.defaultDestinationId) ?? policy.destinations[0];
      if (!destination) return { ok: false, reason: 'No tow destination is configured. Take their details instead.' };

      return {
        ok: true,
        value: {
          callerName, callbackPhone: phone, pickupLocation: pickup,
          directionOfTravel: direction ?? undefined,
          // Equipment, and the reason for it, so a dispatcher can see
          // the decision rather than re-derive it.
          towType: equipment.towType,
          towTypeReason: equipment.reason,
          rolls: facts.rolls, steers: facts.steers,
          wheelLocked: facts.wheelLocked, suspensionDamage: facts.suspensionDamage,
          drivetrain: facts.drivetrain, accessType: facts.accessType,
          accessNotes: str(input, 'accessNotes') ?? undefined,
          recoveryRequired: facts.recoveryRequired,
          unattended: leaving,
          keyHandoffMethod: str(input, 'keyHandoffMethod') ?? (q0.keyHandoffMethod as string | undefined),
          keyInstructions: str(input, 'keyInstructions') ?? (q0.towDriverKeyInstructions as string | undefined),
          vehicleUnlockedForTow: boolOf(input, 'vehicleUnlockedForTow') ?? (q0.vehicleUnlockedForTow as boolean | undefined),
          policyNumber: str(input, 'policyNumber') ?? undefined,
          vehicleYear: str(input, 'vehicleYear') ?? undefined,
          vehicleMake: str(input, 'vehicleMake') ?? undefined,
          vehicleModel: str(input, 'vehicleModel') ?? undefined,
          vehicleColor: str(input, 'vehicleColor') ?? undefined,
          vehicleCondition: str(input, 'vehicleCondition') ?? undefined,
          insuranceCarrier: str(input, 'insuranceCarrier') ?? undefined,
          claimNumber: str(input, 'claimNumber') ?? undefined,
          notes: str(input, 'notes') ?? undefined,
          destinationId: destination.id,
          destinationName: destination.name,
        },
      };
    }

    case 'create_location_link': {
      // The model supplies no recipient — the backend resolves it, and
      // the caller has to have agreed to the destination before the
      // first text goes out.
      const loc = resolveSmsRecipient(session);
      if (!loc.phone) return { ok: false, reason: loc.reason ?? 'No usable mobile number.' };
      if (!loc.confirmed) return { ok: false, reason: loc.reason ?? 'Confirm the number is okay to text first.' };
      return { ok: true, value: { phone: loc.phone, reason: str(input, 'reason') ?? undefined } };
    }

    case 'request_advisor_callback': {
      const description = str(input, 'projectDescription');
      const projectType = str(input, 'projectType');

      // Named gaps rather than one prose complaint, so a rejection
      // turns into the next question instead of another attempt.
      const missing: string[] = [];
      if (!str(input, 'firstName') && !session.contact.firstName) missing.push('caller_first_name');
      if (!str(input, 'lastName') && !session.contact.lastName) missing.push('caller_last_name');

      // The advisor has to be able to ring them, and a number nobody
      // agreed to is a number that wastes the advisor's morning.
      const callback = resolveCallbackRecipient(session);
      if (!callback.confirmed) missing.push('callback_phone_confirmed');

      if (!str(input, 'email') && !session.contact.email) missing.push('caller_email');
      if (!description) missing.push('project_description');

      // The vehicle, as one gap. Asking for a year, then a make, then
      // a model is three questions for something people say in one
      // breath.
      const q = session.qualification as Record<string, unknown>;
      const hasVehicle = (str(input, 'vehicleMake') || q.vehicleMake) && (str(input, 'vehicleModel') || q.vehicleModel);
      if (!hasVehicle) missing.push('vehicle_year_make_model');

      if (missing.length > 0) {
        return {
          ok: false,
          reason: 'Not yet — an advisor cannot do anything useful without this.',
          missing,
        };
      }
      if (!projectType) return { ok: false, reason: 'projectType is required.', missing: ['project_type'] };

      return {
        ok: true,
        value: {
          firstName: str(input, 'firstName') ?? session.contact.firstName,
          lastName: str(input, 'lastName') ?? session.contact.lastName,
          phone: callback.phone,
          email: str(input, 'email') ?? session.contact.email,
          vehicleYear: str(input, 'vehicleYear') ?? q.vehicleYear,
          vehicleMake: str(input, 'vehicleMake') ?? q.vehicleMake,
          vehicleModel: str(input, 'vehicleModel') ?? q.vehicleModel,
          projectDescription: description,
          projectType,
        },
      };
    }
    case 'create_upload_link': {
      const purposeId = str(input, 'purposeId');
      if (!purposeId) return { ok: false, reason: 'purposeId is required.' };

      const policy = policiesFor(session.route.industry).upload;
      if (!policy?.enabled) return { ok: false, reason: 'This business does not accept uploads.' };

      // The link is useless if it cannot be delivered, so the
      // destination is settled before the link is made.
      const uploadTo = resolveSmsRecipient(session);
      if (!uploadTo.phone) return { ok: false, reason: uploadTo.reason ?? 'No usable mobile number.' };
      if (!uploadTo.confirmed) return { ok: false, reason: uploadTo.reason ?? 'Confirm the number is okay to text first.' };
      // The allowed list is the whole security boundary. A purpose the
      // model invented, or one belonging to another trade, stops here.
      if (!policy.allowedPurposes.includes(purposeId)) {
        return { ok: false, reason: `"${purposeId}" is not an upload type this business accepts. Allowed: ${policy.allowedPurposes.join(', ')}.` };
      }
      const purpose = purposeById(purposeId);
      if (!purpose) return { ok: false, reason: `Unknown upload purpose "${purposeId}".` };

      // Photos are never worth a risk. If the caller is not clear of
      // danger the answer is no, whatever the purpose allows.
      if (input.callerIsSafe !== true && purpose.safetyPrecondition) {
        return { ok: false, reason: `Not yet — ${purpose.safetyPrecondition} Make sure they are safe first, then offer the link.` };
      }

      return { ok: true, value: { purposeId, purposeLabel: purpose.label, guidance: purpose.guidance, expiryHours: policy.expiryHours } };
    }

    case 'send_esign_packet': {
      const packetId = str(input, 'packetId');
      const channel = str(input, 'deliveryChannel');
      if (!packetId) return { ok: false, reason: 'packetId is required.' };
      if (channel !== 'sms' && channel !== 'email') {
        return { ok: false, reason: "deliveryChannel must be 'sms' or 'email'." };
      }

      const allowed = policiesFor(session.route.industry).esignPacketIds;
      if (!allowed.includes(packetId)) {
        return { ok: false, reason: `"${packetId}" is not a packet this business sends. Allowed: ${allowed.join(', ') || 'none'}.` };
      }
      const packet = packetById(packetId);
      if (!packet) return { ok: false, reason: `Unknown packet "${packetId}".` };

      // Handing over an email address is not agreeing to sign anything.
      if (input.consentConfirmed !== true) {
        return { ok: false, reason: 'Ask them first, and only send it if they say yes. An email address is not consent to sign something.' };
      }

      // Undefined is not false. "We never asked whether they have a
      // lawyer" and "they told us they do not" are different states,
      // and conflating them sends an engagement packet to somebody who
      // is already represented.
      const state = { ...session.contact, ...session.qualification } as Record<string, unknown>;
      // Alternative fields: the incident location may be recorded under
      // either key depending on which brain took the call, and requiring
      // both would mean storing the same fact twice.
      for (const group of packet.requiresOneOf ?? []) {
        const present = group.some((f) => {
          const v = state[f];
          return v !== undefined && v !== null && v !== '';
        });
        if (!present) {
          return { ok: false, reason: `Ask where the incident happened — you have none of ${group.join(' or ')}.` };
        }
      }

      for (const field of packet.requiresFalse ?? []) {
        if (state[field] === undefined) {
          return { ok: false, reason: `You have not established ${field}. Ask before sending anything.` };
        }
        if (state[field] !== false) {
          return { ok: false, reason: `${field} is true. This packet cannot be sent.` };
        }
      }

      // A signature request is not something to send at someone who has
      // not finished telling you who they are.
      const record = { ...session.contact, ...session.qualification } as Record<string, unknown>;
      const missing = packet.requires.filter((f) => {
        const v = record[f];
        return v === undefined || v === null || v === '';
      });
      if (missing.length > 0) {
        return { ok: false, reason: `Not yet — still missing ${missing.join(', ')}. Ask for those first.` };
      }

      const email = str(input, 'recipientEmail') ?? session.contact.email ?? null;
      if (channel === 'email') {
        if (!email || !EMAIL.test(email)) return { ok: false, reason: 'An email address is needed to send it by email. Ask for it, or offer to text it instead.' };
      }
      const esignTo = resolveSmsRecipient(session);
      if (channel === 'sms') {
        if (!esignTo.phone) return { ok: false, reason: esignTo.reason ?? 'No usable mobile number. Offer to email it instead.' };
        if (!esignTo.confirmed) return { ok: false, reason: esignTo.reason ?? 'Confirm the number is okay to text first.' };
      }
      const phone = esignTo.phone ?? session.from;

      return {
        ok: true,
        value: {
          packetId, templateId: packet.templateId, label: packet.label,
          deliveryChannel: channel,
          recipientEmail: email ?? undefined,
          recipientPhone: channel === 'sms' ? phone : undefined,
          recipientName: session.contact.firstName ?? 'the caller',
          components: packet.components?.map((c) => `${c.label}: ${c.plainExplanation}`),
          afterSendLanguage: packet.afterSendLanguage,
          createsRelationshipOnSignature: packet.createsRelationshipOnSignature,
        },
      };
    }

    case 'create_partner_referral': {
      const partnerId = str(input, 'partnerId');
      if (!partnerId) return { ok: false, reason: 'partnerId is required.' };

      // Consent is the entire point of this tool. Somebody mentioning
      // that their neck hurts has not agreed to have their details sent
      // to a law firm, and treating it as though they had would be a
      // serious breach of their expectations.
      if (input.consentConfirmed !== true) {
        return { ok: false, reason: 'You have not recorded the caller agreeing to this. Ask them clearly, and only send it if they say yes.' };
      }

      const policy = policiesFor(session.route.industry).referral;
      if (!policy?.enabled) return { ok: false, reason: 'This business does not make referrals.' };
      if (!policy.allowedPartnerIds.includes(partnerId)) {
        return { ok: false, reason: `"${partnerId}" is not a partner this business refers to.` };
      }
      const partner = partnerById(partnerId);
      if (!partner) return { ok: false, reason: `Unknown partner "${partnerId}".` };

      if (!session.contact.firstName || !session.contact.phone) {
        return { ok: false, reason: 'A name and a contact number are needed before a referral is any use.' };
      }

      return { ok: true, value: { partnerId, partnerLabel: partner.label, payloadFields: partner.payloadFields } };
    }

    case 'capture_prospect': {
      const value: Record<string, unknown> = {};
      for (const k of ['firstName', 'lastName', 'companyName', 'email', 'phone', 'website', 'industry', 'companySize', 'problemToSolve', 'featuresLiked', 'currentCrm', 'preferredTime'] as const) {
        const v = str(input, k);
        if (v) value[k] = v;
      }
      for (const k of ['missesCalls', 'runsPaidAds', 'phoneConfirmed'] as const) {
        if (typeof input[k] === 'boolean') value[k] = input[k];
      }
      const email = value.email as string | undefined;
      if (email && !EMAIL.test(email)) {
        return { ok: false, reason: 'That email does not look right. Read it back and confirm it — the calendar invite goes there.' };
      }
      const phone = value.phone as string | undefined;
      if (phone && !E164.test(phone.replace(/[\s()-]/g, ''))) {
        return { ok: false, reason: 'That phone number does not look right. Confirm it.' };
      }
      if (Object.keys(value).length === 0) {
        return { ok: false, reason: 'Nothing to record — send at least one detail they actually gave you.' };
      }
      return { ok: true, value };
    }

    case 'book_discovery_call': {
      const start = iso(input, 'start');
      if (!start) return { ok: false, reason: 'start must be a valid ISO 8601 timestamp from check_availability.' };
      if (start < now) return { ok: false, reason: 'That time has passed. Check availability again and offer a real slot.' };
      if (start > new Date(now.getTime() + YAD_DISCOVERY_CALL.maximumLeadDays * 86_400_000)) {
        return { ok: false, reason: `Discovery calls are booked within ${YAD_DISCOVERY_CALL.maximumLeadDays} days.` };
      }

      // Checked against the PROSPECT record, never against the
      // role-play contact. A demo caller has a name on file — it is
      // just not their name.
      const prospect = (session.prospect ?? {}) as Record<string, unknown>;
      const missing = YAD_DISCOVERY_CALL.requires.filter((f) => {
        const v = f === 'phone' ? (prospect.phone ?? session.from) : prospect[f];
        return v === undefined || v === null || v === '';
      });
      if (missing.length > 0) {
        return { ok: false, reason: `Not yet — still need their real ${missing.join(', ')}. Ask for those before booking.` };
      }

      return {
        ok: true,
        value: {
          start: start.toISOString(),
          end: new Date(start.getTime() + YAD_DISCOVERY_CALL.durationMinutes * 60_000).toISOString(),
          title: YAD_DISCOVERY_CALL.title,
          notes: str(input, 'notes') ?? undefined,
        },
      };
    }

    case 'end_call': {
      const reason = str(input, 'reason');
      if (!reason) return { ok: false, reason: 'reason is required.' };
      // A call with no exchange at all is not a call that can be
      // finished; ending on turn one is a model mistake, not a wrap-up.
      if (session.turns.length < 3) {
        return { ok: false, reason: 'The call has barely started. Help the caller before ending it.' };
      }
      return { ok: true, value: { reason } };
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

/**
 * Internal notes for whoever takes the discovery call.
 *
 * Written so the salesperson does not start cold: what the prospect
 * tested, what they reacted to, what they want fixed. Internal only —
 * it goes on the calendar event, never into the conversation.
 */
function buildSalesNotes(session: Session, extra?: string): string {
  const p = session.prospect ?? {};
  const lines = [
    p.companyName ? `Company: ${p.companyName}` : null,
    p.industry ? `Industry: ${p.industry}` : null,
    p.firstName ? `Caller: ${[p.firstName, p.lastName].filter(Boolean).join(' ')}` : null,
    p.phone ? `Phone: ${p.phone}` : null,
    p.email ? `Email: ${p.email}` : null,
    p.website ? `Website: ${p.website}` : null,
    p.companySize ? `Size: ${p.companySize}` : null,
    session.scenarioTested ? `Scenario tested: ${session.scenarioTested.replace(/_/g, ' ')}` : null,
    p.featuresLiked ? `Reacted to: ${p.featuresLiked}` : null,
    p.problemToSolve ? `Wants solved: ${p.problemToSolve}` : null,
    p.currentCrm ? `CRM: ${p.currentCrm}` : null,
    p.missesCalls !== undefined ? `Misses calls: ${p.missesCalls ? 'yes' : 'no'}` : null,
    p.runsPaidAds !== undefined ? `Paid ads: ${p.runsPaidAds ? 'yes' : 'no'}` : null,
    extra ? `Notes: ${extra}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

/** One-line description of the call, for whoever picks up a transfer. */
function summarise(session: Session): string {
  const who = [session.contact.firstName, session.contact.lastName].filter(Boolean).join(' ') || 'Caller';
  const what = session.route.intent ?? session.route.industry ?? 'unclassified';
  return `${who} (${session.from}) — ${what}, urgency ${session.route.urgency}. ${session.turns.length} turns so far.`;
}

/** A boolean argument, or undefined when the model omitted it. */
function boolOf(input: Record<string, unknown>, key: string): boolean | undefined {
  return typeof input[key] === 'boolean' ? input[key] as boolean : undefined;
}

function digits(s: string): string {
  return s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

// ---------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------

/** How many rejected attempts before a tool is declared closed. */
export const MAX_TOOL_RETRIES = 2;

/**
 * Actions the caller will wait through, and what to say first.
 *
 * A prompt rule asking the model to speak before acting works right up
 * until it does not, and the cost of it not working is measured: a
 * four-second dispatch with no acknowledgement is four seconds of a
 * caller listening to nothing, wondering if the line dropped. This
 * makes the acknowledgement the transport's job instead of a
 * behaviour we hope for.
 *
 * Every line is deliberately in the present continuous. "I'm setting
 * that up now" is true the instant it is said; "the tow is confirmed"
 * would be a claim about something that has not happened yet, and the
 * tool may still fail.
 */
const SLOW_TOOL_ACKS: Record<string, string> = {
  dispatch_tow: "Perfect, I'm setting that up now and getting the details over to the driver.",
  create_location_link: "One moment, I'm getting that link ready for you.",
  send_esign_packet: "Right, I'm getting that paperwork ready to send.",
  create_upload_link: "Sure, I'm getting that link ready.",
  book_appointment: "Let me get that booked for you.",
  request_advisor_callback: "Let me get that over to one of our repair advisors.",
};

/** What to say before this tool runs, if nothing has been said yet. */
export function preToolAcknowledgement(toolName: string): string | null {
  return SLOW_TOOL_ACKS[toolName] ?? null;
}

/**
 * The result of a tool, said immediately, without a second model call.
 *
 * A dispatch that has come back knows the ETA. Going round the model
 * again to have it read that number back adds a whole generation of
 * silence to the moment the caller most wants an answer.
 *
 * Returns null whenever the outcome needs judgement rather than
 * reporting — a failure, or anything the caller might reasonably ask a
 * follow-up about — and the normal model turn handles it.
 */
export function immediateResultSpeech(toolName: string, outcome: ToolOutcome): string | null {
  if (!outcome.ok || toolName !== 'dispatch_tow') return null;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(outcome.content) as Record<string, unknown>; } catch { return null; }

  // Only for a real dispatch. A mocked one has its own careful
  // wording about not claiming something was actually done.
  if (parsed.mode !== 'dispatched' && parsed.mode !== 'live') return null;

  const eta = typeof parsed.etaSpeech === 'string' ? parsed.etaSpeech : null;
  const confirmed = "That's confirmed — the tow is arranged.";
  return eta ? `${confirmed} ${eta}` : `${confirmed} I'll have an arrival time for you as soon as a driver is assigned.`;
}


/** Remembers that a tool was refused, and what for. */
function recordToolBlock(session: Session, tool: string, missing: string[]): void {
  session.toolBlocks ??= [];
  const existing = session.toolBlocks.find((b) => b.tool === tool);
  if (existing) {
    // Only a repeat with NO progress counts against the retry budget.
    // A six-field handover is refused several times on the way to being
    // complete, and closing the tool for gathering information would
    // strand the caller one field short of the thing they rang for.
    // Looping is asking for the same missing set twice; this is not.
    if (sameSet(missing, existing.missing)) existing.attempts += 1;
    existing.missing = missing;
    return;
  }
  session.toolBlocks.push({ tool, missing, attempts: 1 });
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** A tool that succeeded is no longer blocked. */
function clearToolBlock(session: Session, tool: string): void {
  if (!session.toolBlocks) return;
  session.toolBlocks = session.toolBlocks.filter((b) => b.tool !== tool);
}

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
    log.log('tool.failed', { callSid: session.callSid, tool: req.name, rejected: check.reason, missing: check.missing });
    recordToolBlock(session, req.name, check.missing ?? []);
    const block = session.toolBlocks?.find((b) => b.tool === req.name);
    // After enough goes, stop restating the prerequisite and say
    // plainly that the tool is closed. Repeating the same rejection is
    // what produced four tow attempts in one call.
    const exhausted = (block?.attempts ?? 0) >= MAX_TOOL_RETRIES;
    const content = exhausted
      ? `${check.reason ?? 'Invalid request.'} You have tried ${req.name} ${block?.attempts} times without this. Do NOT call it again — ask the caller for what is missing, or carry on without it.`
      : check.reason ?? 'Invalid request.';
    return { id: req.id, name: req.name, ok: false, content, rejected: check.reason, missing: check.missing };
  }

  const args = check.value ?? {};
  log.log('tool.requested', { callSid: session.callSid, tool: req.name });

  try {
    const content = await run(req.name, args, deps);
    session.toolCalls.push({ name: req.name, ok: true, at: now.toISOString() });
    log.log('tool.completed', { callSid: session.callSid, tool: req.name });
    clearToolBlock(session, req.name);
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
  const now = deps.now?.() ?? new Date();

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
      const offer = slots.slice(0, 3).map((s) => ({ ...s, say: speakSlot(s.start, now) }));
      return JSON.stringify({
        available: offer,
        interpreted: args.interpreted,
        note: 'Offer these using the "say" wording. Do not read ISO timestamps aloud and do not invent other times.',
      });
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

    case 'capture_details': {
      // A later value replaces an earlier one. That is the rule callers
      // expect: the last number they gave is the one they want used,
      // and a system that keeps the first is broken in a way nobody
      // reports — they simply never get the call back.
      const captured: string[] = [];
      for (const key of ['firstName', 'lastName', 'phone', 'email', 'company', 'address', 'city', 'state', 'zip', 'smsPhone', 'phoneSource'] as const) {
        const v = args[key];
        if (typeof v === 'string' && v.trim()) {
          (session.contact as Record<string, unknown>)[key] = v.trim();
          captured.push(key);
        }
      }
      // Confirmation flags are booleans, not strings, and false is a
      // meaningful value — "do not text me" has to survive.
      for (const key of ['phoneConfirmed', 'smsAllowed'] as const) {
        if (typeof args[key] === 'boolean') {
          session.contact[key] = args[key] as boolean;
          captured.push(key);
        }
      }
      if (args.notes && typeof args.notes === 'object') {
        for (const [k, v] of Object.entries(args.notes as Record<string, unknown>)) {
          if (v === undefined || v === null || v === '') continue;
          session.qualification[k] = v;
          captured.push(k);
        }
      }
      // Field names only — the values are personal data.
      deps.log.log('field.captured', { callSid: session.callSid, fields: captured });
      return JSON.stringify({
        recorded: captured.length,
        note: 'Got it. Do not read these back unless you need to confirm a phone number or an email, and do not ask for any of them again.',
      });
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

    case 'change_appointment': {
      // Recorded as a lead, not executed. Without CRM or calendar
      // lookup there is no booking to change, and the one thing worse
      // than not changing it is telling the caller it was changed —
      // they stop expecting the visit, or they sit at home waiting for
      // one that was never cancelled.
      const action = String(args.action);
      Object.assign(session.qualification, {
        appointmentChangeRequested: action,
        currentAppointment: args.currentAppointment,
        preferredNewTime: args.preferredNewTime,
      });
      if (args.callerName && typeof args.callerName === 'string') {
        session.contact.firstName ??= args.callerName;
      }
      if (args.phone && typeof args.phone === 'string') session.contact.phone = args.phone;

      const res = await tools.crm.pushLead(session);
      return JSON.stringify({
        recorded: res.ok,
        changed: false,
        note:
          `The ${action} request is logged for a person to action. Tell the caller someone will confirm it shortly. ` +
          `Do NOT say the appointment has been ${action === 'cancel' ? 'cancelled' : 'moved'} — nothing has changed yet.`,
      });
    }

    case 'dispatch_tow': {
      const res = await tools.tow.dispatch({
        callerName: String(args.callerName),
        callbackPhone: String(args.callbackPhone),
        pickupLocation: String(args.pickupLocation),
        directionOfTravel: args.directionOfTravel as string | undefined,
        vehicleYear: args.vehicleYear as string | undefined,
        vehicleMake: args.vehicleMake as string | undefined,
        vehicleModel: args.vehicleModel as string | undefined,
        vehicleColor: args.vehicleColor as string | undefined,
        vehicleCondition: args.vehicleCondition as string | undefined,
        // Equipment, decided here rather than by the model. A driver
        // arriving with the wrong truck is the caller's whole
        // afternoon.
        towType: args.towType as string | undefined,
        towTypeReason: args.towTypeReason as string | undefined,
        drivetrain: args.drivetrain as string | undefined,
        rolls: args.rolls as boolean | undefined,
        steers: args.steers as boolean | undefined,
        wheelLocked: args.wheelLocked as boolean | undefined,
        suspensionDamage: args.suspensionDamage as boolean | undefined,
        accessType: args.accessType as string | undefined,
        accessNotes: args.accessNotes as string | undefined,
        recoveryRequired: args.recoveryRequired as boolean | undefined,
        // So the driver does not arrive to a locked car and no keys.
        unattended: args.unattended as boolean | undefined,
        keyHandoffMethod: args.keyHandoffMethod as string | undefined,
        keyInstructions: args.keyInstructions as string | undefined,
        vehicleUnlockedForTow: args.vehicleUnlockedForTow as boolean | undefined,
        insuranceCarrier: args.insuranceCarrier as string | undefined,
        claimNumber: args.claimNumber as string | undefined,
        policyNumber: args.policyNumber as string | undefined,
        notes: args.notes as string | undefined,
        destinationId: String(args.destinationId),
        destinationName: String(args.destinationName),
        callSid: session.callSid,
      });

      Object.assign(session.qualification, {
        towRequested: true,
        towStatus: res.mode,
        towDestination: res.destinationName,
        pickupLocation: args.pickupLocation,
        towType: args.towType,
        towTypeReason: args.towTypeReason,
        ...(args.drivetrain ? { drivetrain: args.drivetrain } : {}),
        ...(args.rolls !== undefined ? { towRolls: args.rolls } : {}),
        ...(args.steers !== undefined ? { towSteers: args.steers } : {}),
        ...(args.wheelLocked !== undefined ? { towWheelLocked: args.wheelLocked } : {}),
        ...(args.suspensionDamage !== undefined ? { towSuspensionDamage: args.suspensionDamage } : {}),
        ...(args.accessType ? { towAccessType: args.accessType } : {}),
        ...(args.recoveryRequired !== undefined ? { towRecoveryRequired: args.recoveryRequired } : {}),
        ...(args.unattended !== undefined ? { unattendedVehicle: args.unattended, callerLeaving: args.unattended } : {}),
        ...(args.keyHandoffMethod ? { keyHandoffMethod: args.keyHandoffMethod } : {}),
        ...(args.keyInstructions ? { towDriverKeyInstructions: args.keyInstructions, keyInstructionsConfirmed: true } : {}),
        ...(args.vehicleUnlockedForTow !== undefined ? { vehicleUnlockedForTow: args.vehicleUnlockedForTow } : {}),
        // Both outcomes are fine; which one is true depends only on
        // whether we are open when it lands.
        shopKeyDeliveryMethod: 'secure_key_drop',
      });

      const policy = policiesFor(session.route.industry).tow;
      // An ETA is spoken only when a provider returned one, or when the
      // business configured a demo range. Never otherwise.
      const eta = res.driverEtaMinutes
        ? `The driver is about ${res.driverEtaMinutes} minutes out.`
        : policy
          ? `Typical right now is roughly ${policy.etaMinMinutes} to ${policy.etaMaxMinutes} minutes — say it as an approximation, never a promise.`
          : 'You do not have an ETA. Do not invent one.';

      // The same figure, ready to speak, so a confirmed dispatch can
      // be reported without a second trip to the model. Only ever a
      // number a provider actually returned — a range from the range,
      // nothing invented, and nothing at all until a driver is on it.
      const etaSpeech = res.driverEtaMinutes
        ? `They're estimating about ${res.driverEtaMinutes} minutes.`
        : res.driverEtaRangeMinutes
          ? `They're estimating about ${res.driverEtaRangeMinutes[0]} to ${res.driverEtaRangeMinutes[1]} minutes.`
          : null;

      return JSON.stringify({
        mode: res.mode,
        destination: res.destinationName,
        towType: args.towType,
        dispatchStatus: res.dispatchStatus,
        driverAssigned: res.driverAssigned,
        etaSpeech,
        keyInstructions: args.keyInstructions,
        speech: speechFor(
          res.mode,
          `the tow is arranged and the vehicle is going to ${res.destinationName}.`,
          `this demo can dispatch a tow to ${res.destinationName} — say the shop can arrange it, not that you just did.`,
        ),
        eta,
        billing: policy?.billingLanguage,
      });
    }

    case 'create_location_link': {
      const res = await tools.locationLink.create({
        callSid: session.callSid,
        purpose: 'roadside_dispatch',
        expiryMinutes: 120,
      });

      let smsMode: string = 'not_attempted';
      if (res.url) {
        try {
          await tools.sms.send({
            to: String(args.phone),
            body: `Tap to share where your vehicle is so we can send the driver straight to you: ${res.url}`,
          });
          smsMode = tools.modes.sms === 'mock' ? 'mocked' : 'sent';
        } catch {
          smsMode = 'failed';
        }
      }

      session.qualification.locationLinkStatus = res.mode;
      // Field names only. The token, the URL and any coordinates stay
      // out of the log entirely — a token in a log is a token in a
      // backup.
      deps.log.log('tool.completed', {
        callSid: session.callSid, tool: 'create_location_link',
        mode: res.mode, smsMode, purpose: 'roadside_dispatch',
      });

      return JSON.stringify({
        mode: res.mode,
        smsMode,
        speech: speechFor(
          smsMode === 'sent' ? 'sent' : res.mode,
          'the link is on its way — they can share their current location or drop a pin right where the vehicle is.',
          'this demo can text them a secure link to share their location or drop a pin — say the system does that, not that you just sent it.',
        ),
        note: 'Never read a link, a token or any coordinates aloud. Once a location comes back, "I have the vehicle location" is all they need to hear.',
      });
    }

    case 'request_advisor_callback': {
      // No adapter to call: this is a record, not an integration. The
      // advisor's queue is whatever the CRM write and the call summary
      // land in, which is exactly how a shop actually works.
      const merge: Record<string, unknown> = {
        advisorCallbackStatus: 'requested',
        projectType: args.projectType,
        projectDescription: args.projectDescription,
      };
      if (args.vehicleYear) merge.vehicleYear = args.vehicleYear;
      if (args.vehicleMake) merge.vehicleMake = args.vehicleMake;
      if (args.vehicleModel) merge.vehicleModel = args.vehicleModel;
      Object.assign(session.qualification as Record<string, unknown>, merge);
      if (args.firstName || args.lastName || args.email) {
        Object.assign(session.contact, {
          ...(args.firstName ? { firstName: String(args.firstName) } : {}),
          ...(args.lastName ? { lastName: String(args.lastName) } : {}),
          ...(args.email ? { email: String(args.email) } : {}),
        });
      }
      deps.log.log('tool.completed', {
        callSid: session.callSid, tool: 'request_advisor_callback',
        projectType: String(args.projectType),
      });

      return JSON.stringify({
        status: 'requested',
        speech: `A repair advisor has the project and will call them back about it.`,
        note: "Tell them an advisor will call and roughly what they will go through. Do NOT quote a price, a range or a timeline — that is the advisor's job and the whole reason this exists. Do not offer the callback again; it is booked.",
      });
    }

    case 'create_upload_link': {
      const res = await tools.uploadLink.create({
        purposeId: String(args.purposeId),
        callSid: session.callSid,
        expiryHours: Number(args.expiryHours),
      });

      // The URL is texted but never returned to the model and never
      // logged: it carries a token, and a token in a log is a token in
      // a backup.
      let smsMode: string = 'not_attempted';
      const uploadTo = resolveSmsRecipient(session);
      if (res.url && uploadTo.phone && uploadTo.confirmed) {
        try {
          await tools.sms.send({
            to: uploadTo.phone,
            body: `Here is a secure link to send ${String(args.purposeLabel)}: ${res.url}`,
          });
          smsMode = tools.modes.sms === 'mock' ? 'mocked' : 'sent';
        } catch {
          smsMode = 'failed';
        }
      }

      Object.assign(session.qualification, {
        uploadLinkPurpose: args.purposeId,
        uploadLinkStatus: res.mode,
      });

      return JSON.stringify({
        mode: res.mode,
        smsMode,
        speech: speechFor(
          smsMode === 'sent' ? 'sent' : res.mode,
          `the link is on its way by text — they can send ${String(args.guidance)} whenever they are somewhere safe.`,
          `this demo can text them a secure link for ${String(args.guidance)} — describe it as something the system does, not something you just did.`,
        ),
      });
    }

    case 'send_esign_packet': {
      const res = await tools.esign.send({
        templateId: String(args.templateId),
        packetId: String(args.packetId),
        recipientName: String(args.recipientName),
        recipientEmail: args.recipientEmail as string | undefined,
        recipientPhone: args.recipientPhone as string | undefined,
        deliveryChannel: args.deliveryChannel as 'sms' | 'email',
        callSid: session.callSid,
        claimNumber: session.qualification.claimNumber as string | undefined,
      });

      Object.assign(session.qualification, {
        esignPacketId: args.packetId,
        esignStatus: res.mode,
        esignChannel: args.deliveryChannel,
      });

      return JSON.stringify({
        mode: res.mode,
        speech: speechFor(
          res.mode,
          `the ${String(args.label)} is on its way.`,
          `this demo can send the ${String(args.label)} electronically — say the system does that, not that you just sent it.`,
        ),
        contains: args.components,
        afterSend: args.afterSendLanguage,
        // The single most important line in this result. Signing is not
        // the same as a business accepting the matter.
        relationship: args.createsRelationshipOnSignature
          ? 'Signing this packet does complete the agreement.'
          : 'Signing does NOT by itself mean the business has accepted the matter. If they ask, say it will be reviewed and confirmed.',
      });
    }

    case 'create_partner_referral': {
      // Only the fields the partner's configuration lists. Nothing
      // else leaves, and medical detail is not on any list.
      const source = { ...session.contact, ...session.qualification } as Record<string, unknown>;
      const payload: Record<string, string> = {};
      for (const field of args.payloadFields as string[]) {
        const v = source[field];
        if (typeof v === 'string' && v.trim() !== '') payload[field] = v.trim();
        else if (typeof v === 'boolean' || typeof v === 'number') payload[field] = String(v);
      }

      const consentAt = new Date().toISOString();
      const res = await tools.referral.refer({
        partnerId: String(args.partnerId),
        partnerLabel: String(args.partnerLabel),
        payload,
        consentAt,
        callSid: session.callSid,
      });

      Object.assign(session.qualification, {
        referralOffered: true,
        referralConsent: true,
        referralConsentAt: consentAt,
        referralPartner: args.partnerId,
        referralStatus: res.mode,
        referralFields: Object.keys(payload).join(','),
      });

      return JSON.stringify({
        mode: res.mode,
        speech: speechFor(
          res.mode,
          `their details have gone over for a free case review.`,
          `this demo can pass their details across for a free case review — describe it as what the system does, not as done.`,
        ),
        limits: 'Do not say they have a case, that the partner will take it, that they will recover anything, or that the partner is "ours".',
      });
    }

    case 'capture_prospect': {
      // Written to the prospect record, which is a different object
      // from session.contact on purpose — that one holds the character
      // they played.
      session.prospect ??= {};
      const captured: string[] = [];
      for (const [k, v] of Object.entries(args)) {
        if (v === undefined || v === null || v === '') continue;
        (session.prospect as Record<string, unknown>)[k] = v;
        captured.push(k);
      }
      // Caller ID is real infrastructure data even when the caller is
      // playing a character, so it is the ONE thing that may carry over
      // — provisionally, until they confirm it for our team's use.
      if (!session.prospect.phone && isUsableNumber(session.from)) {
        session.prospect.phone = session.from;
        session.prospect.phoneSource = 'caller_id';
        session.prospect.phoneConfirmed ??= false;
      }

      deps.log.log('field.captured', { callSid: session.callSid, scope: 'prospect', fields: captured });
      return JSON.stringify({
        recorded: captured.length,
        note: 'Got it. Do not ask again for any of these, and do not read them back unless confirming an email or a number.',
      });
    }

    case 'book_discovery_call': {
      const booked = await tools.calendar.bookAppointment({
        title: String(args.title),
        start: String(args.start),
        end: String(args.end),
        attendeeName: [session.prospect?.firstName, session.prospect?.lastName].filter(Boolean).join(' ') || undefined,
        attendeeEmail: session.prospect?.email,
        attendeePhone: session.prospect?.phone ?? session.from,
        notes: buildSalesNotes(session, args.notes as string | undefined),
        timezone: 'America/New_York',
      });

      const mode = booked.mocked ? 'mocked' : 'sent';
      session.prospect ??= {};
      session.prospect.discoveryCallBooked = !booked.mocked;
      session.prospect.discoveryCallAt = booked.start;
      session.prospect.discoveryCallMode = mode;

      return JSON.stringify({
        mode,
        start: booked.start,
        // A mocked booking is not a booking. Saying "you're all set"
        // when no event exists sends someone to a meeting nobody has.
        speech: booked.mocked
          ? 'NOT ACTUALLY BOOKED — the calendar is not connected. Say the system books this automatically and that the team will confirm. Do NOT say they are booked or name the time as confirmed.'
          : 'DONE — you may confirm the day and time, and say the invite is on its way to their email.',
      });
    }

    case 'end_call': {
      // Recorded on the session; the transport reads it after the
      // farewell has been sent, so the goodbye is never clipped.
      session.pendingEnd = { reason: String(args.reason), at: now.toISOString() };
      return JSON.stringify({
        ending: true,
        note: 'Say your farewell now, in one short sentence. The line closes after you speak.',
      });
    }

    case 'transfer_to_human': {
      const res = await tools.transfer.transferCall({
        targetNumber: '',
        reason: String(args.reason),
        summary: summarise(session),
        callSid: session.callSid,
      });
      if (res.accepted) {
        // Record it rather than acting on it. The caller is mid-sentence
        // and cutting the media now would clip the agent's last words.
        session.pendingTransfer = {
          reason: String(args.reason),
          summary: summarise(session),
          target: res.targetNumber,
        };
      }
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

// ---------------------------------------------------------------------
// Choosing which tools to send
// ---------------------------------------------------------------------

/** Tools every call needs, whatever the trade. */
const UNIVERSAL_TOOLS = [
  'capture_details', 'check_availability', 'book_appointment',
  'save_lead', 'transfer_to_human', 'end_call', 'send_sms', 'change_appointment',
];

/** Tools that only make sense for particular industries. */
const INDUSTRY_TOOLS: Record<string, string[]> = {
  collision_repair: ['dispatch_tow', 'create_location_link', 'create_upload_link', 'send_esign_packet', 'create_partner_referral', 'request_advisor_callback'],
  attorneys: ['send_esign_packet', 'create_upload_link'],
  construction: ['create_upload_link'],
  roofing: ['create_upload_link'],
  restoration: ['create_upload_link'],
  plumbing: ['create_upload_link'],
  hvac: ['create_upload_link'],
  electrical: ['create_upload_link'],
  pressure_washing: ['create_upload_link'],
  landscaping: ['create_upload_link'],
  garage_door: ['create_upload_link'],
  pool: ['create_upload_link'],
  real_estate: ['create_upload_link'],
};

/** Tools used only once the caller is talking to us about buying. */
const SALES_TOOLS = ['capture_prospect', 'book_discovery_call'];

/**
 * The schemas to send this turn.
 *
 * Sending all fifteen every turn cost roughly 2,750 input tokens on
 * every request — most of them describing actions the call in progress
 * could never take. A roofing caller has no use for a tow schema, and
 * paying to describe one on every turn is latency the caller hears as
 * silence.
 */
export function toolsFor(industry: string | null, demoPhase?: string, session?: Session): ToolSchema[] {
  const allowed = new Set([
    ...UNIVERSAL_TOOLS,
    ...(INDUSTRY_TOOLS[industry ?? ''] ?? []),
    ...(demoPhase === 'yad_sales' ? SALES_TOOLS : []),
  ]);
  const schemas = TOOL_SCHEMAS.filter((t) => allowed.has(t.name));
  return session ? schemas.filter((t) => isUnlocked(t.name, session)) : schemas;
}

/**
 * Tools that stay hidden until the call could actually use them.
 *
 * Each gate is a fact, not a guess: you cannot move an appointment
 * that was never booked, and a truck is not dispatched to a car that
 * drove itself in. Anything without a precondition that certain is
 * left permanently visible — a tool the model cannot see is a thing
 * the business cannot do, which is a far worse failure than the tokens
 * it saves.
 */
const GATED_TOOLS: Record<string, (session: Session, said: string) => boolean> = {
  // You cannot change an appointment that does not exist.
  change_appointment: (s) => Boolean((s.qualification as Record<string, unknown>).appointmentId),
  // A tow becomes relevant when the vehicle cannot move, or when
  // somebody raises it.
  dispatch_tow: (s, said) => {
    // A crash in progress has it from the first turn. Gating it behind
    // the word "tow" meant an emergency on a bridge could not dispatch
    // one until somebody said it out loud, while a routine "I wrecked
    // my BMW" could — exactly backwards.
    if (s.route.urgency === 'emergency') return true;
    if (s.route.intent === 'accident_repair' || s.route.intent === 'towing_needed') return true;
    const q = s.qualification as Record<string, unknown>;
    return q.vehicleDrivable === false || Boolean(q.towStatus) || /\btow(ing|ed)?\b|\bwreck|\bflat ?bed\b|\btotal(l)?ed\b|won'?t (drive|start|move)|can'?t be driven\b/i.test(said);
  },
  // Paperwork follows a decision to proceed, never precedes it.
  send_esign_packet: (s, said) => {
    const q = s.qualification as Record<string, unknown>;
    return Boolean(q.esignStatus) || Boolean(q.dropOffScheduled) || /\b(paperwork|authoriz|authoris|sign|direction to pay|estimate approval)\b/i.test(said);
  },
  create_partner_referral: (_s, said) => /\b(rental|rent a car|attorney|lawyer|glass|windshield|referral|recommend)\b/i.test(said),
  // Only on calls that end in an advisor ringing back. A crash call
  // ends with a tow and a booking, not with a project quote.
  request_advisor_callback: (s) => SHOP_BUSINESS_INTENTS.has(s.route.intent ?? ''),
};

/** Collision intents that are ordinary shop business, not a crash. */
const SHOP_BUSINESS_INTENTS = new Set([
  'labor_rate_question', 'custom_work', 'restoration', 'paint_color_match',
  'general_estimate', 'service_question', 'insurance_repair', 'mechanical_repair',
]);

/** Whether a gated tool has become relevant to this call. */
function isUnlocked(name: string, session: Session): boolean {
  const gate = GATED_TOOLS[name];
  if (!gate) return true;
  // Unlocking is one-way. A tool that flickers out of the schema list
  // between turns can be withdrawn from under a model that was about
  // to use it, and it re-breaks the prompt cache every time it moves.
  session.unlockedTools ??= [];
  if (session.unlockedTools.includes(name)) return true;

  // Only the caller's own words. What the agent said is not evidence
  // that the caller wants the thing.
  const said = session.turns.filter((t) => t.role === 'caller').map((t) => t.text).join(' ');
  if (!gate(session, said)) return false;
  session.unlockedTools.push(name);
  return true;
}
