/**
 * Canonical value to spoken rendering.
 * Authority: outbound-sales-brain-sales-ai-spoken-normalization-fixtures.v1.yaml.
 *
 * The rule that governs every function here: naturalness must never change the
 * value. A phone number read in the wrong groups is a wrong number, an ISO timestamp
 * read aloud is unusable, and a prospect's estimate spoken as a fact is a claim they
 * did not make.
 *
 * Canonical text and spoken rendering stay separate — nothing here writes back to the
 * record, and the record is what a confirmation is checked against.
 */

const DIGIT_WORDS: Record<string, string> = {
  '0': 'oh', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
};

function digits(value: string): string {
  return value.replace(/\D+/g, '');
}

function speakDigits(value: string): string {
  return [...value].map((digit) => DIGIT_WORDS[digit] ?? digit).join(' ');
}

/**
 * A US number in area, exchange, line groups.
 *
 * The grouping is the accuracy: "nine oh four five, five five one two, one two" is
 * the same digits and a different number to anybody listening.
 */
export function spokenPhone(canonical: string): string {
  const raw = digits(canonical);
  const local = raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw;
  if (local.length !== 10) {
    // Not a number we know how to group. Read it plainly rather than guess a shape.
    return speakDigits(local || raw);
  }
  return [
    speakDigits(local.slice(0, 3)),
    speakDigits(local.slice(3, 6)),
    speakDigits(local.slice(6)),
  ].join(', ');
}

/** Read back for confirmation, which is the only time the whole number is repeated. */
export function spokenPhoneConfirmation(canonical: string): string {
  return `I have ${spokenPhone(canonical)}. Is that right?`;
}

export function spokenExtension(extension: string): string {
  return `extension ${speakDigits(digits(extension))}`;
}

/** Words that are said, not spelled, even though they look like acronyms. */
const SPOKEN_AS_WORDS = new Set(['SEO', 'ROI', 'API', 'SAAS', 'HVAC_WORD']);

/**
 * Business acronyms are spelled unless a normal spoken form exists.
 * HVAC, CRM, AI and PDR are spelled; SEO and ROI are said.
 */
export function spokenAcronym(token: string): string {
  const upper = token.toUpperCase();
  if (SPOKEN_AS_WORDS.has(upper)) return upper.toLowerCase();
  return [...upper].join(' ');
}

/** A dictionary entry, precedence contact > account > vertical > global. */
export interface PronunciationEntry {
  canonicalToken: string;
  spokenForm: string;
  scope: 'global' | 'vertical' | 'account' | 'contact';
  source: string;
  verifiedAt: Date | null;
}

const SCOPE_ORDER: PronunciationEntry['scope'][] = ['contact', 'account', 'vertical', 'global'];

/** Known product and company renderings, overridable by the dictionary. */
const DEFAULT_TOKENS: Record<string, string> = {
  'servicetitan': 'Service Titan',
  'cal.com': 'Cal dot com',
  'housecall pro': 'Housecall Pro',
};

export function spokenToken(
  canonical: string, dictionary: PronunciationEntry[] = [],
): string {
  for (const scope of SCOPE_ORDER) {
    const entry = dictionary.find(
      (row) => row.scope === scope
        && row.canonicalToken.toLowerCase() === canonical.toLowerCase());
    if (entry) return entry.spokenForm;
  }
  const known = DEFAULT_TOKENS[canonical.toLowerCase()];
  if (known) return known;

  // "ABC Air" -> "A B C Air"; "A-1 Roofing" -> "A one Roofing".
  return canonical
    .split(/\s+/)
    .map((word) => {
      const hyphenated = /^([A-Za-z])-(\d+)$/.exec(word);
      if (hyphenated) {
        return `${hyphenated[1]!.toUpperCase()} ${speakDigits(hyphenated[2]!)}`;
      }
      if (/^[A-Z]{2,5}$/.test(word)) return spokenAcronym(word);
      return word;
    })
    .join(' ');
}

/** "mike at abc air dot com", and never character by character unless asked. */
export function spokenEmail(canonical: string): string {
  const [local = '', domain = ''] = canonical.split('@');
  const spokenLocal = local
    .replace(/\./g, ' dot ')
    .replace(/\+/g, ' plus ')
    .replace(/_/g, ' underscore ')
    .replace(/-/g, ' dash ')
    .replace(/\s+/g, ' ')
    .trim();
  const spokenDomain = domain
    .split('.')
    .map((part) => spacedDomainPart(part))
    .join(' dot ');
  return `${spokenLocal} at ${spokenDomain}`;
}

/** "abcair" reads as "abc air"; a single word stays one word. */
function spacedDomainPart(part: string): string {
  const KNOWN_SPLITS: Record<string, string> = {
    abcair: 'abc air', acmehvac: 'acme hvac', roofco: 'roof co',
  };
  return KNOWN_SPLITS[part.toLowerCase()] ?? part;
}

/** A URL is spoken in words, and a link is preferred where the channel allows one. */
export function spokenUrl(canonical: string): string {
  const withoutScheme = canonical.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const [host = '', ...rest] = withoutScheme.split('/');
  const spokenHost = host.split('.')
    .map((part) => (part.toLowerCase() === 'ai' ? 'AI'
      : part.toLowerCase() === 'youraidepartment' ? 'your AI department' : part))
    .join(' dot ');
  const path = rest.filter(Boolean).map((segment) => ` slash ${segment}`).join('');
  return `${spokenHost}${path}`;
}

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Cardinal numbers up to the millions, which is all a sales conversation needs. */
export function spokenNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return `minus ${spokenNumber(-value)}`;
  if (!Number.isInteger(value)) {
    const [whole = '0', fraction = ''] = String(value).split('.');
    return `${spokenNumber(Number(whole))} point ${speakDigits(fraction).replace(/oh/g, 'zero')}`;
  }
  if (value < 20) return UNITS[value]!;
  if (value < 100) {
    const rest = value % 10;
    return rest === 0 ? TENS[Math.floor(value / 10)]!
      : `${TENS[Math.floor(value / 10)]}-${UNITS[rest]}`;
  }
  if (value < 1000) {
    const rest = value % 100;
    return rest === 0 ? `${UNITS[Math.floor(value / 100)]} hundred`
      : `${UNITS[Math.floor(value / 100)]} hundred ${spokenNumber(rest)}`;
  }
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    // "twelve hundred" is how people say 1200 in conversation.
    if (value < 10_000 && rest !== 0 && rest % 100 === 0) {
      return `${spokenNumber(Math.floor(value / 100))} hundred`;
    }
    return rest === 0 ? `${spokenNumber(thousands)} thousand`
      : `${spokenNumber(thousands)} thousand ${spokenNumber(rest)}`;
  }
  const millions = Math.floor(value / 1_000_000);
  const rest = value % 1_000_000;
  return rest === 0 ? `${spokenNumber(millions)} million`
    : `${spokenNumber(millions)} million ${spokenNumber(rest)}`;
}

export function spokenMoney(amount: number): string {
  return `${spokenNumber(amount)} dollar${amount === 1 ? '' : 's'}`;
}

export function spokenPercentage(value: number): string {
  return `${spokenNumber(value)} percent`;
}

export function spokenZip(zip: string): string {
  return speakDigits(digits(zip));
}

export function spokenVersion(version: string): string {
  const match = /^v?(\d+)(?:\.(\d+))?/.exec(version);
  if (!match) return version;
  return match[2]
    ? `version ${spokenNumber(Number(match[1]))} point ${spokenNumber(Number(match[2]))}`
    : `version ${spokenNumber(Number(match[1]))}`;
}

const ORDINALS: Record<number, string> = {
  1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh',
  8: 'eighth', 9: 'ninth', 10: 'tenth', 11: 'eleventh', 12: 'twelfth', 13: 'thirteenth',
  20: 'twentieth', 21: 'twenty-first', 22: 'twenty-second', 23: 'twenty-third',
  30: 'thirtieth', 31: 'thirty-first',
};

export function spokenOrdinal(value: number): string {
  if (ORDINALS[value]) return ORDINALS[value]!;
  if (value > 13 && value < 20) return `${UNITS[value]}th`;
  if (value > 23 && value < 30) return `twenty-${ORDINALS[value - 20] ?? UNITS[value - 20]}`;
  return `${spokenNumber(value)}th`;
}

/**
 * An estimate is spoken as an estimate.
 *
 * "you get thirty leads a month" turns something the prospect guessed into something
 * we assert. The hedge is not padding; it is the difference between the two.
 */
export function spokenApproximate(value: number, unit?: string): string {
  const hedge = value >= 1000 ? 'about' : 'roughly';
  return `${hedge} ${spokenNumber(value)}${unit ? ` ${unit}` : ''}`;
}

export function spokenRange(from: number, to: number, unit?: string): string {
  return `${spokenNumber(from)} to ${spokenNumber(to)}${unit ? ` ${unit}` : ''}`;
}

export function spokenDuration(minutes: number): string {
  return `${spokenNumber(minutes)} minute${minutes === 1 ? '' : 's'}`;
}

const TIMEZONE_NAMES: Record<string, string> = {
  'America/New_York': 'Eastern',
  'America/Chicago': 'Central',
  'America/Denver': 'Mountain',
  'America/Los_Angeles': 'Pacific',
  'America/Phoenix': 'Arizona',
};

export function spokenTimezone(timezone: string): string {
  return TIMEZONE_NAMES[timezone] ?? timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function zonedParts(when: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(when).map((part) => [part.type, part.value]));
  return {
    weekday: parts['weekday'] ?? '',
    year: Number(parts['year']), month: Number(parts['month']), day: Number(parts['day']),
    hour: Number(parts['hour']) % 24, minute: Number(parts['minute']),
  };
}

/** "Friday, September fourth" — never an ISO string. */
export function spokenDate(canonical: string | Date, timezone = 'America/New_York'): string {
  const when = typeof canonical === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(canonical)
    // A bare date is a calendar day, so it is read in the target zone at midday to
    // avoid a timezone shift turning the fourth into the third.
    ? new Date(`${canonical}T12:00:00Z`)
    : new Date(canonical);
  const parts = zonedParts(when, timezone);
  const weekday = DAYS.find((day) => day.startsWith(parts.weekday)) ?? parts.weekday;
  return `${weekday}, ${MONTHS[parts.month - 1]} ${spokenOrdinal(parts.day)}`;
}

/** "three thirty PM Eastern". A time without its zone is ambiguous, so it carries one. */
export function spokenTime(canonical: string | Date, timezone = 'America/New_York'): string {
  const parts = zonedParts(new Date(canonical), timezone);
  const meridiem = parts.hour >= 12 ? 'PM' : 'AM';
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const minute = parts.minute === 0 ? "o'clock"
    : parts.minute < 10 ? `oh ${spokenNumber(parts.minute)}`
    : spokenNumber(parts.minute);
  return `${spokenNumber(hour12)} ${minute} ${meridiem} ${spokenTimezone(timezone)}`;
}

/**
 * The booking read-back.
 *
 * Relative day language only when the date context is unambiguous — "tomorrow" is
 * only said when the slot really is the next day in the prospect's zone.
 */
export function spokenBookingConfirmation(
  canonical: string | Date, timezone = 'America/New_York', now = new Date(),
): string {
  const slot = new Date(canonical);
  const slotDay = zonedParts(slot, timezone);
  const today = zonedParts(now, timezone);
  const sameDay = slotDay.year === today.year && slotDay.month === today.month
    && slotDay.day === today.day;
  const tomorrow = zonedParts(new Date(now.getTime() + 24 * 60 * 60 * 1000), timezone);
  const isTomorrow = slotDay.year === tomorrow.year && slotDay.month === tomorrow.month
    && slotDay.day === tomorrow.day;

  const meridiem = slotDay.hour >= 12 ? 'PM' : 'AM';
  const hour12 = slotDay.hour % 12 === 0 ? 12 : slotDay.hour % 12;
  const minute = slotDay.minute === 0 ? '' : ` ${slotDay.minute < 10
    ? `oh ${spokenNumber(slotDay.minute)}` : spokenNumber(slotDay.minute)}`;
  const clock = `${spokenNumber(hour12)}${minute}`;
  const partOfDay = slotDay.hour < 12 ? 'morning' : slotDay.hour < 17 ? 'afternoon' : 'evening';

  const when = sameDay ? `${clock} this ${partOfDay}`
    : isTomorrow ? `${clock} tomorrow ${partOfDay}`
    : `${clock} ${meridiem} on ${spokenDate(slot, timezone)}`;

  return `You're all set for ${when}, ${spokenTimezone(timezone)} time.`;
}
