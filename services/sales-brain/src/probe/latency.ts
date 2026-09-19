import { zoneOffsetAt } from '../domain/time.js';

/**
 * How long the lead waited, twice, and never once.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §9.
 *
 * Two figures are kept because either one alone can be used to mislead, in opposite
 * directions. A 16-hour overnight wait shown only as raw elapsed invites "they ignore
 * leads for sixteen hours"; shown only as business-hours-adjusted it hides that a
 * customer sat overnight with no answer. The renderer emits both or refuses.
 *
 * The adjusted figure is nullable and that is the load-bearing part of this file.
 * Nothing in this system holds published business hours -- there is no column for
 * them and no extractor that writes one -- so for almost every real Account the
 * honest adjusted figure does not exist. Null is that answer. It is not zero, it is
 * not the raw elapsed time, and it is emphatically not an assumed nine-to-five: each
 * of those three is a number somebody would repeat to a prospect.
 */

export type BusinessHoursSource = 'PUBLISHED_WEBSITE_HOURS' | 'OPERATOR_CONFIRMED' | 'NONE';

/** Minutes from midnight, in the business's own timezone. */
export interface DayWindow {
  /** 0 = Sunday, matching `Date.prototype.getUTCDay`. */
  weekday: number;
  openMinute: number;
  closeMinute: number;
}

export interface BusinessHours {
  timeZone: string;
  windows: DayWindow[];
  source: Exclude<BusinessHoursSource, 'NONE'>;
}

export interface LatencyResult {
  elapsedSeconds: number;
  /** Null whenever hours are unknown. Callers must render the absence, not a zero. */
  businessHoursAdjustedSeconds: number | null;
  businessHoursSource: BusinessHoursSource;
  submittedOutsideBusinessHours: boolean | null;
}

export function elapsedSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

export function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Local wall-clock parts for an instant in a named zone.
 *
 * `zoneOffsetAt` returns **milliseconds** ahead of UTC, not minutes. Reading it as
 * minutes is not a small error -- a four-hour offset becomes fourteen million
 * "minutes" -- and it silently produced a zero for an overnight wait and a full open
 * day for a weekend. Both are numbers a rep would have repeated.
 */
interface LocalDate {
  year: number;
  month: number;
  day: number;
  minuteOfDay: number;
}

function localDate(instant: Date, timeZone: string): LocalDate {
  const shifted = new Date(instant.getTime() + zoneOffsetAt(instant, timeZone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** The weekday of a local calendar date, independent of any instant. */
function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month, date.day)).getUTCDay();
}

/**
 * The UTC instant of a local wall-clock minute on a local calendar date.
 *
 * The offset is sampled at local noon on that date rather than at the minute in
 * question, because noon is never inside a daylight-saving shift. Sampling at 02:30
 * on the spring-forward day asks what the offset is at a time that does not exist.
 */
function utcOfLocalMinute(date: LocalDate, minute: number, timeZone: string): number {
  const noon = Date.UTC(date.year, date.month, date.day, 12, 0, 0);
  const offsetMs = zoneOffsetAt(new Date(noon), timeZone);
  return Date.UTC(date.year, date.month, date.day, 0, 0, 0) - offsetMs + minute * 60_000;
}

/**
 * Open business seconds between two instants.
 *
 * Walks local calendar days rather than doing arithmetic on a weekly total, because
 * the interesting cases are the irregular ones: a Friday-evening submission answered
 * Monday, a Saturday half-day, a business closed on the day it was asked.
 */
export function businessSecondsBetween(
  from: Date, to: Date, hours: BusinessHours,
): number {
  if (to <= from) return 0;
  const byWeekday = new Map<number, DayWindow[]>();
  for (const window of hours.windows) {
    const list = byWeekday.get(window.weekday) ?? [];
    list.push(window);
    byWeekday.set(window.weekday, list);
  }

  const start = localDate(from, hours.timeZone);
  const end = localDate(to, hours.timeZone);
  let cursor = Date.UTC(start.year, start.month, start.day);
  const last = Date.UTC(end.year, end.month, end.day);

  // A hard bound: a probe window is days, not years, and an unbounded loop over a
  // bad timezone would hang a worker.
  const MAX_DAYS = 400;
  let openMs = 0;
  for (let day = 0; cursor <= last && day <= MAX_DAYS; day += 1) {
    const at = new Date(cursor);
    const date: LocalDate = {
      year: at.getUTCFullYear(), month: at.getUTCMonth(), day: at.getUTCDate(),
      minuteOfDay: 0,
    };
    for (const window of byWeekday.get(at.getUTCDay()) ?? []) {
      const openAt = utcOfLocalMinute(date, window.openMinute, hours.timeZone);
      const closeAt = utcOfLocalMinute(date, window.closeMinute, hours.timeZone);
      const overlapStart = Math.max(openAt, from.getTime());
      const overlapEnd = Math.min(closeAt, to.getTime());
      if (overlapEnd > overlapStart) openMs += overlapEnd - overlapStart;
    }
    cursor += 24 * 3_600_000;
  }
  return Math.round(openMs / 1000);
}

export function isWithinBusinessHours(instant: Date, hours: BusinessHours): boolean {
  const date = localDate(instant, hours.timeZone);
  const weekday = weekdayOf(date);
  return hours.windows.some(
    (window) => window.weekday === weekday
      && date.minuteOfDay >= window.openMinute && date.minuteOfDay < window.closeMinute);
}

/**
 * Both figures for one probe.
 *
 * `hours` being null is the normal case and produces a null adjusted figure with
 * source NONE. Note that `submittedOutsideBusinessHours` is also null then: whether
 * 10:03 PM was outside their hours is not knowable without their hours, and guessing
 * that it was is how "after-hours gap" becomes a claim about a company that might
 * run a night shift.
 */
export function measureLatency(input: {
  submittedAt: Date;
  respondedAt: Date;
  hours: BusinessHours | null;
}): LatencyResult {
  const raw = elapsedSeconds(input.submittedAt, input.respondedAt);
  if (!input.hours) {
    return {
      elapsedSeconds: raw,
      businessHoursAdjustedSeconds: null,
      businessHoursSource: 'NONE',
      submittedOutsideBusinessHours: null,
    };
  }
  return {
    elapsedSeconds: raw,
    businessHoursAdjustedSeconds: businessSecondsBetween(
      input.submittedAt, input.respondedAt, input.hours),
    businessHoursSource: input.hours.source,
    submittedOutsideBusinessHours: !isWithinBusinessHours(input.submittedAt, input.hours),
  };
}

/** "16h 04m", the way a rep would read it aloud. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'not available';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0 && minutes === 0) return `${total}s`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** Monday-to-Friday 8-5, for fixtures and operator-confirmed hours. Never a default. */
export function weekdayHours(input: {
  timeZone: string; open: string; close: string;
  source: Exclude<BusinessHoursSource, 'NONE'>;
  weekdays?: readonly number[];
}): BusinessHours {
  const openMinute = parseHhMm(input.open);
  const closeMinute = parseHhMm(input.close);
  if (openMinute === null || closeMinute === null) {
    throw new Error(`Business hours must be HH:MM, got ${input.open}-${input.close}`);
  }
  const days = input.weekdays ?? [1, 2, 3, 4, 5];
  return {
    timeZone: input.timeZone,
    source: input.source,
    windows: days.map((weekday) => ({ weekday, openMinute, closeMinute })),
  };
}
