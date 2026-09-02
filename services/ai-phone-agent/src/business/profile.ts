// The business the agent is answering for.
//
// This is the line between two very different kinds of knowledge, and
// keeping them apart is the most important structural decision in the
// system:
//
//   INDUSTRY KNOWLEDGE (src/knowledge/) is what any competent person in
//   that trade knows. What a plumber asks about a leak. What a
//   family-law intake needs before a consultation. It is true of every
//   plumbing company, so it can be baked in.
//
//   BUSINESS CONFIGURATION (this file) is true of exactly one company.
//   The service-call fee. The service area. Whether they take State
//   Farm. How long they have been in business.
//
// The agent may reason freely from the first and may state the second
// ONLY when it has been configured. A generic demo has almost none of
// it configured, and that is the point: an agent that invents "our
// service call is $89" is worse than useless to a prospect, because
// the first thing they will do is call back and hear a different
// number.
//
// Every field is optional. `undefined` means "not configured", which
// the prompt turns into an honest deflection rather than a guess.

import type { Industry } from '../core/taxonomy.ts';

/** Where the business works. */
export interface ServiceArea {
  /** Plain-language description: "St Johns and Duval counties". */
  description?: string;
  /** Named places, for checking a caller's town against. */
  places?: string[];
  /** Radius in miles from a base location, when that is how they think. */
  radiusMiles?: number;
}

export interface OpeningHours {
  /** Plain-language: "Monday to Friday, 8 to 5". */
  description?: string;
  /** Do they answer outside those hours for emergencies? */
  emergencyAfterHours?: boolean;
  emergencyDescription?: string;
}

export interface PricingPolicy {
  /** What it costs to come out, if the business publishes it. */
  serviceCallFee?: string;
  /** Is the visit free, credited, or charged? */
  estimatesFree?: boolean;
  /** Anything the agent may say about how pricing works. */
  description?: string;
  /** Explicitly true when the business does NOT want prices quoted by
   * phone. Distinct from undefined, which only means "not configured". */
  neverQuoteByPhone?: boolean;
}

export interface AppointmentRules {
  /** Default visit length in minutes. */
  defaultDurationMinutes?: number;
  /** Minimum notice before the first bookable slot. */
  minimumLeadHours?: number;
  /** How far ahead the calendar is open. */
  maximumLeadDays?: number;
  /** Fields that must be captured before booking is allowed. */
  requiredBeforeBooking?: string[];
  /** Does the agent book directly, or take details for a callback? */
  booksDirectly?: boolean;
}

export interface EscalationPolicy {
  /** Number to transfer to. Absent means transfers are unavailable. */
  transferNumber?: string;
  /** When a human should be brought in beyond the common cases. */
  transferWhen?: string[];
  /** What to say instead when no transfer is possible. */
  callbackPromise?: string;
}

/** A question this specific business has an answer to. */
export interface BusinessFaq {
  question: string;
  answer: string;
}

export interface BusinessProfile {
  /** Stable identifier. */
  id: string;
  /** What the agent calls the company. Absent in a generic demo, where
   * the agent simply never names it. */
  businessName?: string;
  industry: Industry;
  /** Which specialist(s) this business uses. */
  specialties?: string[];

  phone?: string;
  websiteUrl?: string;
  serviceArea?: ServiceArea;
  hours?: OpeningHours;

  /** Services offered, in the caller's language. */
  services?: string[];
  /** Things explicitly NOT offered — as useful as the positive list,
   * because "do you do X" is a very common opening question. */
  doesNotOffer?: string[];

  pricing?: PricingPolicy;
  /** Financing options, if any are offered. */
  financing?: string;
  /** Warranty terms, if published. */
  warranty?: string;
  /** Licence or certification statements the business is entitled to
   * make. Never inferred. */
  licensing?: string;
  /** Insurers worked with, or how insurance is handled. */
  insurance?: string;

  appointments?: AppointmentRules;
  escalation?: EscalationPolicy;

  /** Business-specific answers that override or extend industry knowledge. */
  customFaqs?: BusinessFaq[];

  /**
   * DEMO lets the caller switch industries mid-call and uses a generic
   * unnamed business. CLIENT locks to one business and never switches.
   * See docs/voice-agent-client-onboarding.md.
   */
  mode: 'demo' | 'client';
}

/**
 * A generic profile for the demo line.
 *
 * Almost everything is deliberately absent. The agent answering as
 * "a plumbing company" has no service-call fee, no service area and no
 * warranty, because inventing them is exactly the failure this whole
 * structure exists to prevent. What it does have is appointment
 * behaviour, which is what the demo needs to show.
 */
export function demoProfile(industry: Industry, overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: `demo.${industry}`,
    industry,
    mode: 'demo',
    appointments: {
      defaultDurationMinutes: 60,
      minimumLeadHours: 2,
      maximumLeadDays: 60,
      booksDirectly: true,
    },
    pricing: {
      // Not "free" and not a number — genuinely unknown, which is what
      // a generic demo business is.
      neverQuoteByPhone: true,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Rendering the profile into a prompt
// ---------------------------------------------------------------------

/** Human-readable label for a profile field, for the prompt. */
const FIELD_LABELS: Record<string, string> = {
  businessName: 'business name',
  serviceArea: 'service area',
  hours: 'opening hours',
  pricing: 'pricing',
  financing: 'financing options',
  warranty: 'warranty terms',
  licensing: 'licence details',
  insurance: 'insurance arrangements',
  services: 'the exact list of services offered',
  phone: 'the business phone number',
};

function has(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v as object).some(has);
  return true;
}

/**
 * Turns a profile into the section of the system prompt that says what
 * the agent DOES and DOES NOT know about this business.
 *
 * The unknown list matters more than the known list. Without it the
 * model fills gaps from the average of every business it has ever read
 * about, which is precisely how "our service call is $89" gets said on
 * a call where nobody ever set a price.
 */
export function renderBusinessProfile(profile: BusinessProfile): string {
  const known: string[] = [];
  const unknown: string[] = [];

  if (has(profile.businessName)) known.push(`Business name: ${profile.businessName}`);
  else unknown.push(FIELD_LABELS.businessName);

  if (has(profile.serviceArea)) {
    const a = profile.serviceArea!;
    const parts = [a.description, a.places?.join(', '), a.radiusMiles ? `${a.radiusMiles} miles` : null].filter(Boolean);
    known.push(`Service area: ${parts.join(' — ')}`);
  } else unknown.push(FIELD_LABELS.serviceArea);

  if (has(profile.hours)) {
    const h = profile.hours!;
    known.push(`Hours: ${h.description ?? 'see below'}${h.emergencyAfterHours ? ` (after-hours emergencies: ${h.emergencyDescription ?? 'yes'})` : ''}`);
  } else unknown.push(FIELD_LABELS.hours);

  if (has(profile.services)) known.push(`Services offered: ${profile.services!.join(', ')}`);
  else unknown.push(FIELD_LABELS.services);

  if (has(profile.doesNotOffer)) known.push(`Explicitly NOT offered: ${profile.doesNotOffer!.join(', ')}`);

  const p = profile.pricing;
  if (p?.serviceCallFee) known.push(`Service call fee: ${p.serviceCallFee}`);
  if (p?.estimatesFree === true) known.push('Estimates are free.');
  if (p?.estimatesFree === false) known.push('Estimates are not free.');
  if (p?.description) known.push(`Pricing: ${p.description}`);
  // neverQuoteByPhone is a policy, not an answer — a profile carrying
  // only that still does not know what anything costs.
  if (!p?.serviceCallFee && p?.estimatesFree === undefined && !p?.description) unknown.push(FIELD_LABELS.pricing);
  if (p?.neverQuoteByPhone) known.push('This business does not quote prices over the phone.');

  if (has(profile.financing)) known.push(`Financing: ${profile.financing}`);
  else unknown.push(FIELD_LABELS.financing);

  if (has(profile.warranty)) known.push(`Warranty: ${profile.warranty}`);
  else unknown.push(FIELD_LABELS.warranty);

  if (has(profile.licensing)) known.push(`Licensing: ${profile.licensing}`);
  else unknown.push(FIELD_LABELS.licensing);

  if (has(profile.insurance)) known.push(`Insurance: ${profile.insurance}`);
  else unknown.push(FIELD_LABELS.insurance);

  if (has(profile.customFaqs)) {
    known.push(
      'Answers this business has given you:\n' +
        profile.customFaqs!.map((f) => `  Q: ${f.question}\n  A: ${f.answer}`).join('\n'),
    );
  }

  const transfer = profile.escalation?.transferNumber
    ? 'A human can be reached — offer to connect them when they ask.'
    : 'No transfer is available. If they want a person, take their details and say someone will call them back.';

  return [
    'ABOUT THE BUSINESS YOU ARE ANSWERING FOR',
    known.length ? known.join('\n') : 'Nothing specific has been configured.',
    '',
    'WHAT YOU DO NOT KNOW — THIS IS BINDING',
    unknown.length
      ? `You have NOT been told: ${unknown.join(', ')}.\n` +
        'If a caller asks about any of these, say plainly that you do not have that in front of you, ' +
        'and offer the next useful step — taking their details, or getting someone to confirm. ' +
        'Do NOT estimate, guess, give a typical figure, or say what is "usually" the case. ' +
        'A number you invent will be contradicted the moment they speak to a person.'
      : 'Everything relevant has been configured.',
    '',
    transfer,
  ].join('\n');
}

/** True when the profile can answer a question needing these fields. */
export function profileCanAnswer(profile: BusinessProfile, fields: string[]): boolean {
  return fields.every((f) => has((profile as unknown as Record<string, unknown>)[f]));
}
