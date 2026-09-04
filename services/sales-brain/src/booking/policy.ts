import type { TimeSlot } from './types.js';

/**
 * Which slots YAD is willing to offer.
 * Authority: CLAUDE-CURRENT-TASK.md §T7 and §14 — prefer same-day when a suitable
 * slot genuinely exists, otherwise next business day.
 *
 * This is pure and timezone-aware so it can be tested without a calendar.
 */

export interface BookingPolicy {
  timezone: string;
  /** Local working hours, 24h. */
  workdayStartHour: number;
  workdayEndHour: number;
  /** Days of week that count as business days (0 = Sunday). */
  businessDays: number[];
  durationMinutes: number;
  /** Slots start on this boundary, in minutes. */
  slotGranularityMinutes: number;
  /** A same-day slot must be at least this far out to be reasonable to offer. */
  minimumLeadMinutes: number;
  /** Never offer beyond this horizon. */
  horizonDays: number;
  /** Leave this much space around existing meetings. */
  bufferMinutes: number;
}

export const DEFAULT_POLICY: BookingPolicy = {
  timezone: 'America/New_York',
  workdayStartHour: 9,
  workdayEndHour: 17,
  businessDays: [1, 2, 3, 4, 5],
  durationMinutes: 20,
  slotGranularityMinutes: 30,
  // Ninety minutes: enough that "later today" is genuinely actionable for both
  // sides, rather than an offer the prospect cannot realistically take.
  minimumLeadMinutes: 90,
  horizonDays: 7,
  bufferMinutes: 10,
};

/** Local wall-clock parts of an instant in a given IANA timezone. */
export function zonedParts(date: Date, timezone: string): {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    // Intl renders midnight as "24" in some locales/engines.
    hour: Number(parts['hour']) % 24,
    minute: Number(parts['minute']),
    weekday: weekdays[parts['weekday'] ?? 'Sun'] ?? 0,
  };
}

/** The UTC instant for a local wall-clock time in a timezone, DST included. */
export function zonedTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, timezone: string,
): Date {
  // Start from the naive UTC reading, then correct by the offset that timezone was
  // actually at for that instant. Two passes settle DST boundaries.
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 2; i += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    guess += target - rendered;
  }
  return new Date(guess);
}

function overlaps(a: TimeSlot, b: TimeSlot, bufferMs: number): boolean {
  return a.start.getTime() < b.end.getTime() + bufferMs
    && b.start.getTime() < a.end.getTime() + bufferMs;
}

/**
 * Generates every candidate slot inside working hours across the horizon, then
 * removes anything that collides with a busy period.
 *
 * Slots are only ever produced from real busy data supplied by the caller. There is
 * no fallback that invents availability when the calendar cannot be read — that
 * decision belongs to the caller, which must refuse to offer times instead.
 */
export function computeFreeSlots(
  now: Date, busy: TimeSlot[], policy: BookingPolicy,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const bufferMs = policy.bufferMinutes * 60_000;
  const durationMs = policy.durationMinutes * 60_000;
  const earliest = new Date(now.getTime() + policy.minimumLeadMinutes * 60_000);

  for (let dayOffset = 0; dayOffset <= policy.horizonDays; dayOffset += 1) {
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const { year, month, day } = zonedParts(probe, policy.timezone);
    const dayStart = zonedTimeToUtc(year, month, day, policy.workdayStartHour, 0, policy.timezone);
    const weekday = zonedParts(dayStart, policy.timezone).weekday;
    if (!policy.businessDays.includes(weekday)) continue;

    const dayEnd = zonedTimeToUtc(year, month, day, policy.workdayEndHour, 0, policy.timezone);

    for (
      let cursor = dayStart.getTime();
      cursor + durationMs <= dayEnd.getTime();
      cursor += policy.slotGranularityMinutes * 60_000
    ) {
      const slot: TimeSlot = { start: new Date(cursor), end: new Date(cursor + durationMs) };
      if (slot.start < earliest) continue;
      if (busy.some((period) => overlaps(slot, period, bufferMs))) continue;
      slots.push(slot);
    }
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Picks the slots to actually offer.
 * Same-day first when one genuinely exists, then the next business day, and never
 * two adjacent times that sound like the same option.
 */
export function selectOfferedSlots(
  now: Date, freeSlots: TimeSlot[], policy: BookingPolicy, count = 2,
): { slots: TimeSlot[]; sameDay: boolean } {
  const today = zonedParts(now, policy.timezone);
  const isSameDay = (slot: TimeSlot): boolean => {
    const parts = zonedParts(slot.start, policy.timezone);
    return parts.year === today.year && parts.month === today.month && parts.day === today.day;
  };

  const sameDaySlots = freeSlots.filter(isSameDay);
  const laterSlots = freeSlots.filter((slot) => !isSameDay(slot));

  const chosen: TimeSlot[] = [];
  const spreadPick = (candidates: TimeSlot[], take: number): void => {
    let lastTaken: number | null = null;
    for (const slot of candidates) {
      if (chosen.length >= take) break;
      // At least 90 minutes apart, so two offers feel like a real choice.
      if (lastTaken !== null && slot.start.getTime() - lastTaken < 90 * 60_000) continue;
      chosen.push(slot);
      lastTaken = slot.start.getTime();
    }
  };

  if (sameDaySlots.length > 0) {
    spreadPick(sameDaySlots, count);
    if (chosen.length < count) spreadPick(laterSlots, count);
    return { slots: chosen, sameDay: true };
  }

  // Next business day that has anything, rather than scattering across the week.
  const firstLater = laterSlots[0];
  if (!firstLater) return { slots: [], sameDay: false };
  const firstDay = zonedParts(firstLater.start, policy.timezone);
  const sameDayAsFirst = laterSlots.filter((slot) => {
    const parts = zonedParts(slot.start, policy.timezone);
    return parts.year === firstDay.year && parts.month === firstDay.month && parts.day === firstDay.day;
  });
  spreadPick(sameDayAsFirst, count);
  if (chosen.length < count) spreadPick(laterSlots, count);
  return { slots: chosen, sameDay: false };
}

/** "today at 2:30 PM" / "Thursday at 10:00 AM" — how a slot is spoken aloud. */
export function describeSlot(slot: TimeSlot, now: Date, timezone: string): string {
  const today = zonedParts(now, timezone);
  const parts = zonedParts(slot.start, timezone);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(slot.start);

  if (parts.year === today.year && parts.month === today.month && parts.day === today.day) {
    return `today at ${time}`;
  }
  const tomorrow = zonedParts(new Date(now.getTime() + 86_400_000), timezone);
  if (parts.year === tomorrow.year && parts.month === tomorrow.month && parts.day === tomorrow.day) {
    return `tomorrow at ${time}`;
  }
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(slot.start);
  return `${weekday} at ${time}`;
}
