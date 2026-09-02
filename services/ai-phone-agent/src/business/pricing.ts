// What the business charges to come out, and when.
//
// Two rules govern everything here:
//
//   1. A price the agent states must come from configuration. It may
//      never be produced by the model. That is why the numbers live in
//      a typed structure and are RENDERED into the prompt, rather than
//      written into prompt prose where nobody can audit them.
//
//   2. The rate band depends on the SERVICE AREA's local time, not the
//      server's. An 11:27 PM emergency in Florida is 03:27 UTC, and a
//      server-clock decision would quote the daytime rate for a
//      late-night call.
//
// Repair pricing is deliberately absent and must stay that way. Nobody
// can price a repair before seeing the fault, and a number invented on
// the phone becomes an argument in a kitchen.

import { serviceLocalTime, spokenRange, type LocalTime, type ServiceArea } from './service-area.ts';

export type RateBand = 'standard' | 'after_hours' | 'late_night' | 'weekend' | 'holiday';

export interface RateHours {
  /** Standard rates apply from this hour (local, 0-23). */
  openHour: number;
  /** After-hours rates apply from this hour. */
  afterHoursStart: number;
  /** Late-night emergency rates apply from this hour until openHour. */
  lateNightStart: number;
}

export interface Rate {
  band: RateBand;
  /** What it is called to the caller. */
  label: string;
  /** Formatted for speech: "$89". */
  fee: string;
  /** Numeric, for tests and future arithmetic. */
  amount: number;
}

export interface ServicePricing {
  hours: RateHours;
  rates: Record<RateBand, Rate>;
  /** Is the visit fee credited against an approved repair? */
  creditedTowardRepair: boolean;
  /** Dates (YYYY-MM-DD) that bill at the holiday rate. */
  holidays?: string[];
  /** What the agent may say about repair pricing. Never a number. */
  repairPolicy: string;
}

const money = (n: number): string => `$${n}`;

/**
 * The plumbing demo company's published rates.
 *
 * Real numbers a real business would publish, so the demo can answer
 * the single most common question on a service call — "how much is it
 * to come out?" — instead of deflecting it, which is what the first
 * production call did.
 */
export const PLUMBING_DEMO_PRICING: ServicePricing = {
  hours: { openHour: 7, afterHoursStart: 18, lateNightStart: 22 },
  rates: {
    standard: { band: 'standard', label: 'standard service call', fee: money(89), amount: 89 },
    after_hours: { band: 'after_hours', label: 'after-hours service call', fee: money(149), amount: 149 },
    late_night: { band: 'late_night', label: 'late-night emergency call', fee: money(249), amount: 249 },
    weekend: { band: 'weekend', label: 'weekend emergency call', fee: money(249), amount: 249 },
    holiday: { band: 'holiday', label: 'holiday emergency call', fee: money(249), amount: 249 },
  },
  creditedTowardRepair: true,
  repairPolicy:
    'The technician diagnoses the problem on site and gives the repair price before doing any work.',
};

/**
 * Which rate applies right now, in the service area.
 *
 * Late night wins over weekend: a 2 AM Sunday call is one emergency,
 * not two, and both bands price the same anyway.
 */
export function rateBandFor(pricing: ServicePricing, local: LocalTime): RateBand {
  const { openHour, afterHoursStart, lateNightStart } = pricing.hours;

  if (local.hour >= lateNightStart || local.hour < openHour) return 'late_night';
  if (pricing.holidays?.includes(local.date)) return 'holiday';
  if (local.isWeekend) return 'weekend';
  if (local.hour >= afterHoursStart) return 'after_hours';
  return 'standard';
}

export function currentRate(pricing: ServicePricing, area: ServiceArea, at: Date = new Date()): {
  rate: Rate; local: LocalTime; band: RateBand;
} {
  const local = serviceLocalTime(area, at);
  const band = rateBandFor(pricing, local);
  return { rate: pricing.rates[band], local, band };
}

// ---------------------------------------------------------------------
// ETA
// ---------------------------------------------------------------------

export type UrgencyLevel = 'emergency' | 'high' | 'normal' | 'low';

export interface EtaWindow {
  minMinutes: number;
  maxMinutes: number;
}

export interface EtaPolicy {
  /** Window by urgency during standard and after-hours bands. */
  byUrgency: Record<UrgencyLevel, EtaWindow>;
  /** Overrides once the late-night band applies — fewer trucks are out. */
  lateNight?: Partial<Record<UrgencyLevel, EtaWindow>>;
}

/** The plumbing demo company's dispatch expectations. */
export const PLUMBING_DEMO_ETA: EtaPolicy = {
  byUrgency: {
    emergency: { minMinutes: 60, maxMinutes: 90 },
    high: { minMinutes: 90, maxMinutes: 120 },
    normal: { minMinutes: 120, maxMinutes: 240 },
    low: { minMinutes: 120, maxMinutes: 240 },
  },
  lateNight: {
    emergency: { minMinutes: 90, maxMinutes: 120 },
    high: { minMinutes: 90, maxMinutes: 120 },
  },
};

export function etaWindow(policy: EtaPolicy, urgency: UrgencyLevel, band: RateBand): EtaWindow {
  if (band === 'late_night') {
    const override = policy.lateNight?.[urgency];
    if (override) return override;
  }
  return policy.byUrgency[urgency];
}

// ---------------------------------------------------------------------
// Rendering into the prompt
// ---------------------------------------------------------------------

/**
 * The pricing and timing section of the system prompt.
 *
 * Every number the agent is allowed to say appears here, resolved for
 * the current moment, so the model is quoting rather than calculating.
 * Asking a language model to work out which rate band 11:27 PM falls
 * into is asking for an arithmetic mistake on a live call.
 */
export function renderPricing(
  pricing: ServicePricing,
  eta: EtaPolicy,
  area: ServiceArea,
  urgency: UrgencyLevel,
  at: Date = new Date(),
): string {
  const { rate, local, band } = currentRate(pricing, area, at);
  const window = etaWindow(eta, urgency, band);

  const lines = [
    'PRICING AND TIMING — USE THESE EXACT FIGURES, NEVER YOUR OWN',
    `It is currently ${local.spoken} on ${local.dayName} where the business operates. Use this time, not any other, whenever the caller asks what time it is or when someone can arrive.`,
    `Right now falls in the ${rate.label} band. The fee to come out is ${rate.fee}.`,
  ];

  if (pricing.creditedTowardRepair) {
    lines.push(`That fee is credited toward the repair if they approve the work.`);
  }
  lines.push(`REPAIR PRICING: ${pricing.repairPolicy} You do NOT know repair prices and must never estimate one, not even a range.`);

  lines.push(
    '',
    `DISPATCH: for this call, roughly ${window.minMinutes} to ${window.maxMinutes} minutes — that is approximately ${spokenArrival(area, window, at)} local time.`,
    'Say "roughly" or "approximately". Never promise an exact arrival time and never say a technician is already on the way.',
    '',
    'Other bands, if they ask about a different time:',
    ...(['standard', 'after_hours', 'late_night'] as const).map(
      (b) => `  ${pricing.rates[b].label}: ${pricing.rates[b].fee}`,
    ),
    `  Business hours are ${hourLabel(pricing.hours.openHour)} to ${hourLabel(pricing.hours.afterHoursStart)}; after-hours until ${hourLabel(pricing.hours.lateNightStart)}; late-night emergency after that.`,
    'Weekends and holidays bill at the emergency rate.',
    '',
    'Do not recite this like a rate card. Answer what they asked, in a sentence, the way a dispatcher would.',
  );

  return lines.join('\n');
}

function spokenArrival(area: ServiceArea, w: EtaWindow, at: Date): string {
  return spokenRange(area, w.minMinutes, w.maxMinutes, at);
}

function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? ' AM' : ' PM'}`;
}
