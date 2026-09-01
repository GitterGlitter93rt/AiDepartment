// Turning what a caller says about time into a search window.
//
// Callers do not say "2026-09-03T14:00:00Z". They say "Thursday
// morning", "tomorrow", "this week", "first thing", "after four". The
// model is perfectly capable of producing an ISO timestamp from that,
// but it is also capable of producing the wrong year, the wrong week,
// or a Thursday that has already happened — and it does so silently.
//
// So the model's window is treated as a hint and reconciled here
// against a real clock. That keeps the failure mode boring: a caller
// who says "Thursday" gets Thursday, not a slot in 2019.

export interface Window {
  from: Date;
  to: Date;
  /** What the phrase was understood to mean, for logs. */
  interpreted: string;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Business hours, local. Mornings end at noon; afternoons start there. */
const DAY_START = 8;
const DAY_END = 18;

function atHour(d: Date, hour: number): Date {
  const out = new Date(d);
  out.setHours(hour, 0, 0, 0);
  return out;
}

function startOfDay(d: Date): Date {
  return atHour(d, DAY_START);
}

function endOfDay(d: Date): Date {
  return atHour(d, DAY_END);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Resolves a spoken time phrase to a concrete window.
 *
 * Returns null when the phrase carries no time information at all, so
 * the caller gets asked rather than guessed at.
 */
export function resolveWhen(phrase: string, now: Date = new Date()): Window | null {
  const t = phrase.toLowerCase();

  // Part of day narrows whatever day we land on.
  const morning = /\b(morning|first thing|early|before noon|am)\b/.test(t);
  const afternoon = /\b(afternoon|after lunch|midday|pm)\b/.test(t);
  const evening = /\b(evening|after work|after (four|five|4|5))\b/.test(t);

  function shape(day: Date, label: string): Window {
    let from = startOfDay(day);
    let to = endOfDay(day);
    if (morning) { to = atHour(day, 12); }
    else if (afternoon) { from = atHour(day, 12); }
    else if (evening) { from = atHour(day, 16); }

    // Never offer a time that has already passed today.
    if (from < now) from = new Date(now);
    return { from, to, interpreted: label };
  }

  if (/\b(right now|as soon as possible|asap|today|this morning|this afternoon|emergency)\b/.test(t)) {
    const to = endOfDay(now);
    return { from: new Date(now), to: to > now ? to : addDays(endOfDay(now), 1), interpreted: 'today' };
  }

  if (/\btomorrow\b/.test(t)) return shape(addDays(now, 1), 'tomorrow');

  // A named weekday means the NEXT one. "Thursday" said on a Thursday
  // means next Thursday, not four minutes ago.
  for (let i = 0; i < DAYS.length; i += 1) {
    if (!new RegExp(`\\b${DAYS[i]}\\b`).test(t)) continue;
    const wantNextWeek = /\bnext\b/.test(t);
    let delta = (i - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    if (wantNextWeek && delta < 7) delta += 7;
    return shape(addDays(now, delta), DAYS[i]);
  }

  if (/\b(this week|sometime this week|before the weekend)\b/.test(t)) {
    // Through Friday, or a full week if it is already the weekend.
    const daysToFriday = (5 - now.getDay() + 7) % 7 || 5;
    return { from: new Date(now), to: endOfDay(addDays(now, daysToFriday)), interpreted: 'this week' };
  }

  if (/\bnext week\b/.test(t)) {
    const monday = addDays(now, ((1 - now.getDay() + 7) % 7) || 7);
    return { from: startOfDay(monday), to: endOfDay(addDays(monday, 4)), interpreted: 'next week' };
  }

  if (/\b(whenever|any time|anytime|no rush|flexible|soon)\b/.test(t)) {
    return { from: new Date(now), to: endOfDay(addDays(now, 14)), interpreted: 'open' };
  }

  // A part of day with no day attached means the next occurrence.
  if (morning || afternoon || evening) {
    const base = now.getHours() >= DAY_END ? addDays(now, 1) : now;
    return shape(base, 'next available');
  }

  return null;
}

/** How a slot should be read back on a phone call. */
export function speakSlot(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const hour = d.getHours();
  const minute = d.getMinutes();
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const time = minute === 0 ? `${h12}` : `${h12}:${String(minute).padStart(2, '0')}`;
  const meridiem = hour < 12 ? 'in the morning' : hour < 17 ? 'in the afternoon' : 'in the evening';

  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = d.toDateString() === new Date(now.getTime() + 86_400_000).toDateString();
  const withinWeek = d.getTime() - now.getTime() < 6 * 86_400_000;

  const day = sameDay
    ? 'today'
    : tomorrow
      ? 'tomorrow'
      : withinWeek
        ? DAYS[d.getDay()].replace(/^./, (c) => c.toUpperCase())
        : `${DAYS[d.getDay()].replace(/^./, (c) => c.toUpperCase())} the ${d.getDate()}`;

  return `${day} at ${time} ${meridiem}`;
}
