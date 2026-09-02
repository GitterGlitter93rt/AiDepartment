// Turning stored values into something that sounds right spoken aloud.
//
// The stored value and the spoken value are different things, and
// conflating them causes both of the failures seen on the first real
// production call: "123 Main St" read as "Main Sanit", and a ZIP read
// as the number thirty-two thousand and eighty-four.
//
// The canonical value in the session NEVER changes. These functions
// produce a separate spoken form, used only in what the agent says.
//
// The bar for rewriting is deliberately high. Expanding "St" to
// "Street" is safe because the abbreviation is unambiguous in that
// position. Touching a proper name is not: "Ponce de Leon" and
// "Matanzas" are real street names here, and a normaliser that thinks
// it knows better than the caller produces something worse than the
// raw text.

/** Street-type abbreviations, expanded only in a trailing position. */
const STREET_TYPES: Record<string, string> = {
  st: 'Street', str: 'Street',
  rd: 'Road', ave: 'Avenue', av: 'Avenue',
  blvd: 'Boulevard', dr: 'Drive', ct: 'Court', ln: 'Lane',
  pkwy: 'Parkway', pky: 'Parkway', hwy: 'Highway',
  cir: 'Circle', pl: 'Place', ter: 'Terrace', trl: 'Trail',
  way: 'Way', sq: 'Square', pt: 'Point', plz: 'Plaza',
  loop: 'Loop', run: 'Run', xing: 'Crossing',
};

/** Directionals, which are ambiguous alone and clear in context. */
const DIRECTIONALS: Record<string, string> = {
  n: 'North', s: 'South', e: 'East', w: 'West',
  ne: 'Northeast', nw: 'Northwest', se: 'Southeast', sw: 'Southwest',
};

/** Unit designators. */
const UNITS: Record<string, string> = {
  apt: 'apartment', ste: 'suite', bldg: 'building', fl: 'floor',
  rm: 'room', unit: 'unit', lot: 'lot', trlr: 'trailer',
};

/**
 * Reads digits one at a time: "32084" → "3 2 0 8 4".
 *
 * Spaces rather than hyphens because ConversationRelay's TTS reads
 * spaced digits individually and can run hyphenated ones together.
 */
export function spellDigits(value: string): string {
  return value.replace(/\D/g, '').split('').join(' ');
}

/** A US ZIP, including ZIP+4 read as two groups. */
export function speakZip(zip: string): string {
  const digits = zip.replace(/\D/g, '');
  if (digits.length === 9) return `${spellDigits(digits.slice(0, 5))}, ${spellDigits(digits.slice(5))}`;
  return spellDigits(digits);
}

/**
 * A phone number, written the way it is printed.
 *
 * The stored value is E.164 — "+19045551234" — which is correct for a
 * record and wrong for a person. Handing that to text-to-speech
 * produces "plus one nine zero four...", which is how nobody says a
 * phone number. The national format reads naturally instead, and the
 * TTS voice already handles the grouping.
 *
 * Non-US numbers are left in their stored form rather than forced into
 * a shape they do not have.
 */
export function speakPhone(phone: string): string {
  const parts = splitNanp(phone);
  if (!parts) return phone.trim();
  // Commas are what produce the pause. Word forms are what stop the
  // engine reading "904" as "nine hundred and four" or running the
  // whole string together.
  return [
    parts.area.map(digitWord).join(' '),
    parts.exchange.map(digitWord).join(' '),
    parts.subscriber.map(digitWord).join(' '),
  ].join(', ');
}

/** Area code, exchange, last four — or null if it is not a NANP number. */
export function splitNanp(phone: string): { area: string[]; exchange: string[]; subscriber: string[] } | null {
  let d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  return {
    area: d.slice(0, 3).split(''),
    exchange: d.slice(3, 6).split(''),
    subscriber: d.slice(6).split(''),
  };
}

/** How a person says a single digit. Zero is "oh" inside a number. */
function digitWord(d: string): string {
  const WORDS: Record<string, string> = {
    '0': 'oh', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  };
  return WORDS[d] ?? d;
}

/** The printed form, for anywhere it is written rather than spoken. */
export function formatPhone(phone: string): string {
  const p = splitNanp(phone);
  if (!p) return phone.trim();
  return `(${p.area.join('')}) ${p.exchange.join('')}-${p.subscriber.join('')}`;
}

/**
 * The same number, digit by digit.
 *
 * For the rare case where a number is being dictated for someone to
 * write down rather than confirmed back. Confirmation should use
 * speakPhone: "is (904) 555-1234 right?" is easier to say yes to than
 * ten separate digits.
 */
export function spellPhoneDigits(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return spellDigits(d);
  return `${spellDigits(d.slice(0, 3))}, ${spellDigits(d.slice(3, 6))}, ${spellDigits(d.slice(6))}`;
}

/**
 * An address, expanded for speech.
 *
 * Only tokens that are unambiguous abbreviations are touched. Anything
 * that could be a proper name is left exactly as the caller gave it —
 * a street really can be called "Saint George", and turning it into
 * "Street George" is worse than reading "St" as written.
 */
export function speakAddress(address: string): string {
  const tokens = address.split(/(\s+|,)/);
  const words = tokens.map((t, i) => ({ t, i })).filter((x) => /\S/.test(x.t) && x.t !== ',');
  const lastWordIndex = words.length > 0 ? words[words.length - 1].i : -1;

  return tokens
    .map((token, i) => {
      if (!/\S/.test(token) || token === ',') return token;
      const bare = token.replace(/\./g, '');
      const key = bare.toLowerCase();
      const isCapitalised = /^[A-Z]/.test(bare);

      // A street type only counts as one when something precedes it —
      // "St Augustine" opens the token list and is a place, not a
      // street type.
      const prior = words.findIndex((w) => w.i === i);
      if (STREET_TYPES[key] && prior > 0) {
        // "St" before another capitalised word is "Saint", not
        // "Street": 123 St James Place.
        const next = words[prior + 1];
        const nextIsName = next !== undefined && /^[A-Z][a-z]/.test(tokens[next.i]?.replace(/\./g, '') ?? '');
        if (key === 'st' && nextIsName) return 'Saint';
        return STREET_TYPES[key];
      }

      if (DIRECTIONALS[key] && isCapitalised && prior > 0 && i !== lastWordIndex) {
        return DIRECTIONALS[key];
      }

      if (UNITS[key]) return UNITS[key];

      // A bare unit designator followed by an alphanumeric, e.g. "#4B".
      if (/^#\w+$/.test(bare)) return `unit ${spaceOutAlnum(bare.slice(1))}`;

      return token;
    })
    .join('');
}

/** "4B" → "4 B", so TTS does not say "forby". */
function spaceOutAlnum(s: string): string {
  return s.replace(/(\d)([A-Za-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
}

/**
 * The whole service address as a dispatcher would read it back.
 *
 * Kept short on purpose. Reading a full postal address aloud, including
 * the state, sounds like a form being processed rather than a person
 * confirming a detail.
 */
export function speakServiceAddress(parts: {
  address?: string; city?: string; state?: string; zip?: string;
}): string {
  const out: string[] = [];
  if (parts.address) out.push(speakAddress(parts.address));
  if (parts.city) out.push(`in ${parts.city}`);
  if (parts.zip) out.push(`ZIP ${speakZip(parts.zip)}`);
  return out.join(', ');
}

/**
 * The section of the prompt telling the agent how to pronounce what it
 * has stored.
 *
 * Given as guidance rather than applied to the model's output, because
 * rewriting generated text after the fact breaks sentences in ways
 * that are worse than the pronunciation problem being solved.
 */
export function renderSpeechGuidance(parts: {
  address?: string; city?: string; state?: string; zip?: string; phone?: string;
}): string | null {
  const lines: string[] = [];

  if (parts.address) {
    const spoken = speakAddress(parts.address);
    if (spoken !== parts.address) lines.push(`  address: say "${spoken}"`);
  }
  if (parts.zip) lines.push(`  ZIP: say the digits separately — "${speakZip(parts.zip)}"`);
  if (parts.phone) lines.push(`  phone: say "${speakPhone(parts.phone)}" — never the stored +1 form`);

  if (lines.length === 0) return null;

  return [
    'READING DETAILS BACK (spoken form only — the stored record is unchanged):',
    ...lines,
    'Only read something back to confirm it once. Do not spell out details the caller did not ask about.',
  ].join('\n');
}
