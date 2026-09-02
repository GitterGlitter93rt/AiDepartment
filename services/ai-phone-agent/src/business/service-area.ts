// The service area's local time.
//
// The VPS runs in UTC. A caller in Florida at 11:27 PM is at 03:27 UTC
// the following day — a different hour, a different rate band, and a
// different date. Using the server clock for anything the caller hears
// or is charged for is wrong in three ways at once, and the first real
// production call landed exactly there.
//
// So nothing customer-facing may read `new Date()` directly. Everything
// goes through here, against a configured IANA timezone.
//
// The timezone is CONFIGURED, never inferred from an address. Several
// US states span two zones — Florida itself does — so a state code is
// not enough, and guessing produces a wrong answer that looks right.

/** Where the business actually works, and what time it is there. */
export interface ServiceArea {
  /** Two-letter state or region code. Informational; never used for time. */
  state?: string;
  /** IANA zone, e.g. "America/New_York". The single source of truth for time. */
  timezone: string;
  /** Plain-language description for the prompt. */
  description?: string;
}

export const DEFAULT_SERVICE_AREA: ServiceArea = {
  state: 'FL',
  timezone: 'America/New_York',
};

export interface LocalTime {
  /** 0-23 in the service area. */
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
  /** YYYY-MM-DD in the service area. */
  date: string;
  /** "11:27 PM" — how a person says it. */
  spoken: string;
  /** "Saturday" */
  dayName: string;
  isWeekend: boolean;
  /** The instant this describes, for arithmetic. */
  instant: Date;
  timezone: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Reads the wall clock in a timezone.
 *
 * Intl is used rather than a date library because it is built in, it
 * carries the real tz database, and it handles daylight saving without
 * a dependency that needs updating twice a year.
 */
export function serviceLocalTime(area: ServiceArea, at: Date = new Date()): LocalTime {
  const tz = area.timezone;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).formatToParts(at);
  } catch {
    // A misconfigured timezone must not take down a call. Fall back to
    // the default zone rather than to UTC, because UTC would silently
    // produce the wrong rate band — the exact bug this module exists
    // to prevent.
    return serviceLocalTime({ ...area, timezone: DEFAULT_SERVICE_AREA.timezone }, at);
  }

  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  // Intl gives 24 for midnight under hour12:false; normalise it.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const weekday = DAYS.findIndex((d) => d.startsWith(get('weekday')));

  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const meridiem = hour < 12 ? 'AM' : 'PM';

  return {
    hour, minute, weekday,
    date,
    spoken: `${h12}:${String(minute).padStart(2, '0')} ${meridiem}`,
    dayName: DAYS[weekday] ?? '',
    isWeekend: weekday === 0 || weekday === 6,
    instant: at,
    timezone: tz,
  };
}

/**
 * Adds minutes and reports the result in service-area local terms.
 *
 * Used for ETA. Midnight and date rollover fall out of doing the
 * arithmetic on the instant and re-reading the wall clock, rather than
 * adding to an hour number and hoping.
 */
export function addMinutesLocal(area: ServiceArea, minutes: number, from: Date = new Date()): LocalTime {
  return serviceLocalTime(area, new Date(from.getTime() + minutes * 60_000));
}

/** "roughly 12:57 to 1:27 AM" — an ETA a person can act on. */
export function spokenRange(area: ServiceArea, minMinutes: number, maxMinutes: number, from: Date = new Date()): string {
  const a = addMinutesLocal(area, minMinutes, from);
  const b = addMinutesLocal(area, maxMinutes, from);

  const strip = (t: LocalTime): string => t.spoken.replace(/ (AM|PM)$/, '');
  const meridiem = (t: LocalTime): string => (t.hour < 12 ? 'AM' : 'PM');

  // "12:57 to 1:27 AM" when both sides share a meridiem, otherwise
  // both are stated — "11:40 PM to 12:10 AM" has to say both or it
  // reads as an hour that does not exist.
  return meridiem(a) === meridiem(b)
    ? `${strip(a)} to ${strip(b)} ${meridiem(b)}`
    : `${a.spoken} to ${b.spoken}`;
}

/** Morning, afternoon, evening or night — for a natural sign-off. */
export function partOfDay(t: LocalTime): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (t.hour < 12) return 'morning';
  if (t.hour < 17) return 'afternoon';
  if (t.hour < 21) return 'evening';
  return 'night';
}
