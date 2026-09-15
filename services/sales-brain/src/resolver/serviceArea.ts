import { normalizePostalCode, normalizeState } from '../domain/normalize.js';

/**
 * Where a company will travel, which is not where it is.
 *
 * Three things this product must never conflate, and this module exists at the seam
 * between two of them:
 *
 *   PHYSICAL ADDRESS  - where the business is. One place. From its own contact page
 *                       or a state filing.
 *   SERVICE AREA      - where it will go. Often forty ZIPs. From marketing copy.
 *   SEARCH GEOGRAPHY  - where a rep was looking. A question, not a fact about anyone.
 *
 * Collapsing service area into address is the error that makes a read model claim a
 * plumber has an office in every town it drives to. Collapsing search geography into
 * either is the one the discovery read model already had to be rescued from.
 *
 * So parsing here is deliberately narrow: it reads only from sentences that announce
 * a service area in so many words, and it refuses anything that looks like a postal
 * address. A missed service area costs a filter; an invented one costs a rep a
 * wasted drive.
 */

export interface ServiceAreaParse {
  /** Five-digit ZIPs the copy lists explicitly. */
  zips: string[];
  /** City names, with a state when the copy qualifies them. */
  cities: { name: string; stateRegion: string | null }[];
  counties: string[];
  states: string[];
  /** Named but unbounded: "the Greater Austin area", "surrounding areas". */
  regions: string[];
  /**
   * True when the copy gestures at an area without naming anywhere specific.
   *
   * "and surrounding areas" is the commonest service-area phrase in the trades and it
   * means nothing a filter can use. Recorded so the UI can say "stated, but not
   * specific" instead of showing an empty list that looks like a parse failure.
   */
  vague: boolean;
  /** The sentence this came from, for a rep to read and check. */
  statement: string;
}

/** Phrases that introduce a service area. Nothing else is read. */
const INTRODUCERS = [
  /\b(?:proudly\s+)?serving\s+([^.!?\n]{3,240})/i,
  /\bwe\s+(?:proudly\s+)?serve\s+([^.!?\n]{3,240})/i,
  /\bservice\s+areas?\s*[:\-–]\s*([^.!?\n]{3,240})/i,
  /\bareas?\s+(?:we\s+)?serve\s*[:\-–]?\s*([^.!?\n]{3,240})/i,
  /\bavailable\s+(?:in|throughout|across)\s+([^.!?\n]{3,240})/i,
];

/**
 * Markers of a postal address rather than a service area.
 *
 * "Serving you from 120 Anastasia Blvd" is an address sentence wearing a service-area
 * verb, and reading it as coverage would put the company's own street into a list of
 * places it travels to.
 */
/**
 * Deliberately case-sensitive.
 *
 * With an `i` flag, `[A-Z]` matches anything, and "serving 32095, 32084 and St
 * Augustine" parses as a street address -- digits, a word, a street suffix -- so a
 * perfectly ordinary ZIP-and-city list was refused outright. A real address line
 * capitalises its street name, and that capital is the only thing separating
 * "120 Anastasia Blvd" from "32084 and St Augustine".
 */
const ADDRESS_MARKERS =
  /\b\d{1,6}\s+[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Hwy|Highway|Pkwy|Parkway|Ct|Court|Suite|Ste|Unit)\b/;

const VAGUE_MARKERS = [
  /\bsurrounding\s+(?:areas?|communities|counties|cities|towns)\b/i,
  /\bnearby\s+(?:areas?|communities)\b/i,
  /\bthe\s+surrounding\s+region\b/i,
  /\band\s+beyond\b/i,
];

/** "Greater Austin", "the Gulf Coast", "North Texas" and similar. */
const REGION_PATTERNS = [
  // Case-insensitive: sites write "Greater Austin" far more often than "greater".
  /\b(greater\s+[a-z]+(?:\s+[a-z]+)?(?:\s+area)?)\b/gi,
  /\b((?:north|south|east|west|central)\s+(?:texas|florida))\b/gi,
  /\b(the\s+(?:gulf|space|treasure|emerald|first)\s+coast)\b/gi,
  /\b((?:tampa\s+bay|dfw|metroplex)(?:\s+area)?)\b/gi,
];

const STATE_WORDS = /\b(texas|florida|tx|fl)\b/gi;

/** Words that are never a city, however capitalised. */
const NOT_A_PLACE = new Set([
  'and', 'the', 'all', 'of', 'in', 'to', 'we', 'our', 'your', 'plus', 'more',
  'areas', 'area', 'county', 'counties', 'city', 'cities', 'surrounding', 'nearby',
  'residential', 'commercial', 'emergency', 'service', 'services', 'free', 'call',
  'monday', 'friday', 'saturday', 'sunday', 'llc', 'inc',
]);

function cleanupPlace(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[,;]+$/, '').trim();
}

/**
 * Reads a service area out of copy, or declines to.
 *
 * Returns null when nothing announces a service area. That is the common case and it
 * is not a failure: most pages simply do not say.
 */
export function parseServiceArea(text: string): ServiceAreaParse | null {
  /**
   * Every statement on the page, merged.
   *
   * A site commonly says coverage twice: a warm line in the hero ("proudly serving
   * Austin") and a precise list further down ("Service Areas: 78701, 78702"). Reading
   * only the first match meant the vaguest sentence won and the ZIP list -- the one
   * thing a filter can actually use -- was thrown away.
   */
  const merged: ServiceAreaParse = {
    zips: [], cities: [], counties: [], states: [], regions: [], vague: false,
    statement: '',
  };
  let found = false;

  for (const introducer of INTRODUCERS) {
    const pattern = new RegExp(introducer.source, introducer.flags.includes('g')
      ? introducer.flags : `${introducer.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
    if (!match?.[1]) continue;

    const statement = cleanupPlace(match[0]);
    const body = match[1];

    // An address sentence with a service-area verb in front of it. Refused outright:
    // a wrong service area is worse than none, because a rep acts on it.
    if (ADDRESS_MARKERS.test(body)) continue;

    const zips = [...new Set(
      (body.match(/\b\d{5}(?:-\d{4})?\b/g) ?? [])
        .map((zip) => normalizePostalCode(zip))
        .filter((zip): zip is string => Boolean(zip)))];

    const counties = [...new Set(
      (body.match(/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)\s+Count(?:y|ies)\b/g) ?? [])
        .map((county) => cleanupPlace(county)))];

    const regions: string[] = [];
    for (const pattern of REGION_PATTERNS) {
      pattern.lastIndex = 0;
      let regionMatch: RegExpExecArray | null;
      while ((regionMatch = pattern.exec(body)) !== null) {
        const region = cleanupPlace(regionMatch[1]!);
        if (region && !regions.some((existing) =>
          existing.toLowerCase() === region.toLowerCase())) regions.push(region);
      }
    }

    const states = [...new Set(
      (body.match(STATE_WORDS) ?? [])
        .map((state) => normalizeState(state))
        .filter((state): state is string => Boolean(state)))];

    // Cities: capitalised runs in a list, minus anything already claimed as a county
    // or region, minus words that are never places.
    const claimed = [...counties, ...regions].join(' ').toLowerCase();
    const cities: ServiceAreaParse['cities'] = [];
    const cityPattern = /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})(?:\s*,\s*([A-Z]{2})\b)?/g;
    let cityMatch: RegExpExecArray | null;
    while ((cityMatch = cityPattern.exec(body)) !== null) {
      const name = cleanupPlace(cityMatch[1]!);
      const lower = name.toLowerCase();
      if (!name || NOT_A_PLACE.has(lower)) continue;
      if (/\bcount(y|ies)\b/i.test(name)) continue;
      if (claimed.includes(lower)) continue;
      if (normalizeState(name)) continue;
      if (cities.some((city) => city.name.toLowerCase() === lower)) continue;
      cities.push({ name, stateRegion: cityMatch[2] ? normalizeState(cityMatch[2]) : null });
    }

    const vague = VAGUE_MARKERS.some((pattern) => pattern.test(body));
    const foundSomething = zips.length > 0 || cities.length > 0
      || counties.length > 0 || regions.length > 0 || states.length > 0 || vague;
    if (!foundSomething) continue;

    found = true;
    for (const zip of zips) if (!merged.zips.includes(zip)) merged.zips.push(zip);
    for (const county of counties) {
      if (!merged.counties.includes(county)) merged.counties.push(county);
    }
    for (const state of states) if (!merged.states.includes(state)) merged.states.push(state);
    for (const region of regions) {
      if (!merged.regions.some((existing) =>
        existing.toLowerCase() === region.toLowerCase())) merged.regions.push(region);
    }
    for (const city of cities) {
      if (!merged.cities.some((existing) =>
        existing.name.toLowerCase() === city.name.toLowerCase())) merged.cities.push(city);
    }
    merged.vague = merged.vague || vague;
    // The statement a rep reads is the most specific one, since that is the one worth
    // checking against.
    if (zips.length > 0 || statement.length > merged.statement.length) {
      if (merged.statement === '' || zips.length > 0) merged.statement = statement;
    }
    }
  }

  return found ? merged : null;
}

/**
 * Whether a company's copy claims it serves a given ZIP.
 *
 * Only an explicit ZIP counts. A city or county match would need a ZIP-to-place table
 * this product does not have, and guessing which ZIPs sit in "Travis County" would
 * manufacture coverage the company never claimed.
 */
export function serviceAreaCoversZip(area: ServiceAreaParse, postalCode: string): boolean {
  const normalized = normalizePostalCode(postalCode);
  return normalized !== null && area.zips.includes(normalized);
}
