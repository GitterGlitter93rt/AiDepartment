/**
 * Turning what a rep typed into an instant.
 *
 * `<input type="datetime-local">` submits a wall clock with no timezone: `2026-03-08T14:00`.
 * `new Date()` reads that in the *process's* timezone, so the meaning of a callback
 * depended on the TZ of the box the API happened to be running on. On a UTC host --
 * which is what a VPS is by default -- "call them back at 2pm" became 9am Eastern:
 * the prospect gets a call five hours before they asked for one, and the rep has no
 * way to see it happened.
 *
 * A wall clock is therefore read in the business timezone, which is configured once
 * and is the same zone the rest of the product formats times in. A value that already
 * carries an offset or a Z is an instant already and is left alone.
 */

/** How far the named zone is ahead of UTC at a given instant, in milliseconds. */
export function zoneOffsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);

  const field = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // Intl renders midnight as hour 24 in some ICU versions.
  const asIfUtc = Date.UTC(
    field('year'), field('month') - 1, field('day'),
    field('hour') % 24, field('minute'), field('second'),
  );
  return asIfUtc - instant.getTime();
}

/** True when the string already says which instant it means. */
function carriesZone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

/**
 * Reads an operator-entered date and time.
 *
 * Returns null for anything unreadable, so a caller can say "pick a time" rather than
 * storing an Invalid Date.
 *
 * The two awkward days of the year resolve deliberately:
 *   - spring forward: 2:30am does not exist, and becomes 3:30am rather than being
 *     refused, because a rep typing it means "early that morning";
 *   - fall back: 1:30am happens twice, and the first one wins, because that is the
 *     earlier of two times a prospect could have meant and calling early is the
 *     failure that matters.
 */
export function parseOperatorDateTime(
  value: string | null | undefined, timeZone: string,
): Date | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;

  if (carriesZone(raw)) {
    const instant = new Date(raw);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!match) {
    // Not a shape we recognise. Refuse rather than guess: a guess here is a call at
    // the wrong hour.
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');

  // Digits in the right places are not a date. Date.UTC rolls a bad one over
  // silently -- month 13 becomes January of the next year, day 45 becomes the middle
  // of the month after -- and a callback booked for a date nobody chose is worse
  // than one refused.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const rolled = new Date(wallAsUtc);
  if (rolled.getUTCFullYear() !== year || rolled.getUTCMonth() !== month - 1
      || rolled.getUTCDate() !== day) {
    return null;  // the 30th of February, and friends
  }

  // The offset depends on the instant and the instant depends on the offset, so
  // each candidate is checked by reading it back: an answer that does not show the
  // clock the rep typed is not the answer.
  const first = new Date(wallAsUtc - zoneOffsetAt(rolled, timeZone));
  if (showsWallClock(first, timeZone, wallAsUtc)) return first;

  const second_ = new Date(wallAsUtc - zoneOffsetAt(first, timeZone));
  if (showsWallClock(second_, timeZone, wallAsUtc)) return second_;

  // Neither reads back, so the wall clock does not exist: this is the hour the
  // spring-forward jump removes. `first` uses the offset from before the jump, which
  // puts the answer just after it -- an hour later than typed, never an hour early.
  return first;
}

/** True when this instant, read in the zone, shows exactly the clock that was typed. */
function showsWallClock(instant: Date, timeZone: string, wallAsUtc: number): boolean {
  return zoneOffsetAt(instant, timeZone) + instant.getTime() === wallAsUtc;
}
