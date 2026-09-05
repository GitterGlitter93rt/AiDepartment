/**
 * What a rep typed into a geography box, turned into something a provider can use.
 *
 * The miner was passing the raw value straight through in three places: into the
 * idempotency key, into the SQL filter, and into the provider's location field. So
 * "Jacksonville" and "jacksonville " were two different paid searches, " 32095 " did
 * not match the ZIP filter, and "FL" and "Florida" were different markets.
 *
 * Normalization happens once, here, and everything downstream uses the result.
 */

export type GeographyType = 'zip_zcta' | 'city' | 'state';

export interface NormalizedGeography {
  type: GeographyType;
  /** What goes into the database filter and the idempotency key. */
  value: string;
  /** What a person should see. */
  display: string;
  /** The two-letter state, when the input gave one. */
  state: string | null;
}

export interface GeographyError {
  ok: false;
  /** A sentence for the operator. Never "invalid input". */
  message: string;
}

export type GeographyResult = ({ ok: true } & NormalizedGeography) | GeographyError;

const STATE_BY_NAME: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
};

const STATE_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_BY_NAME).map(([name, code]) => [
    code, name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
  ]),
);

const STATE_CODES = new Set(Object.values(STATE_BY_NAME));

/** 'fl' / 'Florida' / ' FL ' -> 'FL'. Null when it is not a state at all. */
export function stateCode(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  return STATE_BY_NAME[trimmed.toLowerCase()] ?? null;
}

/** Collapses whitespace and drops the punctuation a city name never needs. */
function tidy(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim();
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s\-'])([a-z])/g,
    (_match, prefix: string, letter: string) => prefix + letter.toUpperCase());
}

/**
 * Reads a geography the way an operator writes one.
 *
 * A city on its own is ambiguous -- there is a Springfield in most states -- so a
 * city is accepted with a state and refused without one, saying so, rather than
 * quietly searching the wrong Jacksonville.
 */
export function normalizeGeography(
  type: string | null | undefined, raw: string | null | undefined,
): GeographyResult {
  const input = tidy(String(raw ?? ''));
  if (!input) {
    return { ok: false, message: 'Enter a ZIP code, a city and state, or a state.' };
  }

  if (type === 'zip_zcta') {
    const digits = input.replace(/[^0-9-]/g, '');
    const match = /^(\d{5})(?:-?\d{4})?$/.exec(digits);
    if (!match) {
      return {
        ok: false,
        message: `"${input}" is not a ZIP code. A ZIP is five digits, optionally with a `
          + 'four-digit extension.',
      };
    }
    // ZIP+4 identifies a delivery route, not a market. The five-digit ZIP is the
    // unit inventory and coverage are counted in, so it is what we search.
    const zip = match[1]!;
    return {
      ok: true, type: 'zip_zcta', value: zip, display: zip, state: null,
    };
  }

  if (type === 'state') {
    const code = stateCode(input);
    if (!code) {
      return {
        ok: false,
        message: `"${input}" is not a US state. Use a two-letter abbreviation or the full name.`,
      };
    }
    return {
      ok: true, type: 'state', value: code, display: STATE_NAME_BY_CODE[code] ?? code,
      state: code,
    };
  }

  if (type === 'city') {
    // "Jacksonville, FL" and "Jacksonville FL" are both how people write it.
    const parts = input.split(',').map(tidy).filter(Boolean);
    let cityPart = parts[0] ?? '';
    let statePart = parts[1] ?? '';

    if (!statePart) {
      const trailing = /^(.*?)[\s]+([A-Za-z]{2}|[A-Za-z ]{4,})$/.exec(cityPart);
      if (trailing && stateCode(trailing[2]!)) {
        cityPart = tidy(trailing[1]!);
        statePart = trailing[2]!;
      }
    }

    const code = statePart ? stateCode(statePart) : null;
    if (statePart && !code) {
      return {
        ok: false,
        message: `"${statePart}" is not a US state, so "${input}" cannot be located.`,
      };
    }
    if (!cityPart) {
      return { ok: false, message: 'Enter a city name, and the state it is in.' };
    }
    if (!code) {
      return {
        ok: false,
        message: `Which ${titleCase(cityPart)}? Add the state -- "${titleCase(cityPart)}, FL" -- `
          + 'because most city names exist in more than one.',
      };
    }

    const city = titleCase(cityPart);
    return {
      ok: true,
      type: 'city',
      // The database stores city and state separately and compares case-insensitively;
      // the value is the city alone so the existing filter keeps working.
      value: city,
      display: `${city}, ${code}`,
      state: code,
    };
  }

  return {
    ok: false,
    message: `"${type ?? 'that'}" is not a geography this system searches. Use a ZIP code, `
      + 'a city and state, or a state.',
  };
}


/**
 * Reads a single "where" box, the way a rep uses it.
 *
 * Find Prospects classified the text with three regular expressions: five digits is
 * a ZIP, two letters is a state, anything else is a city. So "Jacksonville, FL"
 * became a city literally called "Jacksonville, FL" and matched nothing, "Florida"
 * became a city called Florida and matched nothing, and "32095-1234" became a city
 * too. All three are things an operator types, and all three silently returned an
 * empty market.
 */
export function classifyGeography(where: string): GeographyResult {
  const input = tidy(where);
  if (!input) {
    return { ok: false, message: 'Enter a ZIP code, a city and state, or a state.' };
  }

  if (/^\d{5}(?:[- ]?\d{4})?$/.test(input.replace(/\s+/g, ''))) {
    return normalizeGeography('zip_zcta', input);
  }
  // A state on its own, by code or by name. Checked before city so "Florida" is the
  // state rather than a city nobody has.
  if (!input.includes(',') && stateCode(input)) {
    return normalizeGeography('state', input);
  }
  return normalizeGeography('city', input);
}

/**
 * The same reading, but tolerant of a city with no state.
 *
 * The database can search a bare city perfectly well -- it is only a provider that
 * needs to be told which Jacksonville. So the portal's inventory search accepts one,
 * and the discovery request is where the state becomes required.
 */
export function classifyGeographyForInventory(where: string): GeographyResult {
  const strict = classifyGeography(where);
  if (strict.ok) return strict;

  const input = tidy(where);
  if (!input || input.includes(',')) return strict;
  if (/^[0-9]/.test(input)) return strict;

  return {
    ok: true, type: 'city', value: titleCase(input), display: titleCase(input),
    state: null,
  };
}
