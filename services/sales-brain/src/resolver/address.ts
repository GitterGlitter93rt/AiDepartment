/**
 * Where a company is, taken only from what the company published.
 *
 * Three things are kept apart here and none of them may be derived from another:
 *
 *   PHYSICAL LOCATION    a street address the company puts on its own site
 *   SERVICE AREA         where it says it will travel
 *   DISCOVERY GEOGRAPHY  the ZIP or city we typed into a search provider
 *
 * The third is the one that has already gone wrong. Production still holds 66
 * `locations` rows, one for each legacy Roofing Account, every one of them carrying
 * ZIP 32095 -- the ZIP the canary searched -- and not one of them anything a company
 * ever said about itself. They are typed `service_area`, which reads as a claim the
 * business made and is not: nobody read a page, and no company declared a service
 * area. V1 stopped writing them. Nothing here may reintroduce the shape in a new
 * costume, which is why a schema.org address of a city and a region with no street is
 * refused: "Orlando, FL" is a place name, and the ZIP rows were place names too.
 *
 * Deliberately conservative throughout. A missed address costs a research run that
 * says "no address published", which is true and recoverable. An invented one puts a
 * rep in front of a company at an address it has never occupied.
 */

export type AddressBasis =
  /** schema.org PostalAddress on an Organization or LocalBusiness node. */
  | 'SCHEMA_ORG_POSTAL_ADDRESS'
  /** A street address in the visible text of a page the company publishes. */
  | 'PAGE_TEXT';

export type AddressKind =
  /** A street address the company publishes as where it is. */
  | 'PHYSICAL'
  /** A PO box or mail drop. An address, and not a place of business. */
  | 'MAILING';

export interface AddressObservation {
  kind: AddressKind;
  basis: AddressBasis;
  streetAddress: string;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  /** Exactly what was read, so a reviewer sees the claim and not our parse of it. */
  rawText: string;
  sourceReference: string;
  observedAt: Date;
}

export interface ServiceAreaObservation {
  /** The area as the company names it. Never normalized into a location. */
  areaText: string;
  basis: 'SCHEMA_ORG_AREA_SERVED' | 'PAGE_TEXT';
  sourceReference: string;
  observedAt: Date;
}

export interface AddressExtraction {
  addresses: AddressObservation[];
  serviceAreas: ServiceAreaObservation[];
}

const EMPTY: AddressExtraction = { addresses: [], serviceAreas: [] };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const ORGANIZATION_TYPE = /(organization|localbusiness|business|contractor|store|service|company|corporation|dealer|shop|agency|firm)/;

/** A mail drop is an address and not a place. The distinction is the whole point. */
function isMailDrop(street: string): boolean {
  return /\b(p\.?\s*o\.?\s*box|post\s+office\s+box|pmb\b|private\s+mail\s+box)\b/i.test(street);
}

const US_STATE = '(?:A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]'
  + '|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY])';

const STREET_SUFFIX = '(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|'
  + 'Way|Ct|Court|Cir|Circle|Pl|Place|Pkwy|Parkway|Hwy|Highway|Ter|Terrace|Trl|Trail|'
  + 'Loop|Sq|Square|Row|Run|Pike|Path|Plaza|Expy|Expressway|Byp|Bypass|Aly|Alley)';

/**
 * Wording that means "we will come to you", which is never an address.
 *
 * Checked against the text immediately before a candidate, because the sentence a place
 * name sits in is what says whether the company is *in* it. "Proudly serving Winter
 * Park, FL 32789" is a service area with a ZIP in it, and it is exactly what a looser
 * matcher turns into a head office.
 */
const SERVICE_AREA_LEAD = new RegExp(
  String.raw`\b(serv(?:ing|ice|es)|we\s+come\s+to\s+you|areas?\s+we\s+serve|coverage\s+area`
  + String.raw`|surrounding|throughout|proudly\s+serve|mobile\s+service|travel\s+to)\b`, 'i');

/** How much text before a candidate counts as "the sentence it is in". */
const LEAD_WINDOW = 90;

/**
 * Structured addresses from JSON-LD, and the service areas beside them.
 *
 * `areaServed` is read on purpose rather than ignored: the two claims live next to each
 * other in the same node, and the way they get confused is one of them being invisible.
 * Reading both is how a service area stays a service area.
 */
export function addressesFromJsonLd(
  blocks: unknown[], sourceReference: string, now: Date = new Date(),
): AddressExtraction {
  const addresses: AddressObservation[] = [];
  const serviceAreas: ServiceAreaObservation[] = [];

  const readAddress = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    const street = typeof node.streetAddress === 'string' ? node.streetAddress.trim() : '';
    const locality = typeof node.addressLocality === 'string' ? node.addressLocality.trim() : null;
    const region = typeof node.addressRegion === 'string' ? node.addressRegion.trim() : null;
    const postal = typeof node.postalCode === 'string' ? node.postalCode.trim()
      : typeof node.postalCode === 'number' ? String(node.postalCode) : null;
    const country = typeof node.addressCountry === 'string' ? node.addressCountry.trim()
      : typeof node.addressCountry?.name === 'string' ? node.addressCountry.name.trim() : 'US';

    // No street is no address. A locality and a region are a place name, and a place
    // name is what the searched ZIP was.
    if (!street) return;
    if (!locality && !postal) return;

    addresses.push({
      kind: isMailDrop(street) ? 'MAILING' : 'PHYSICAL',
      basis: 'SCHEMA_ORG_POSTAL_ADDRESS',
      streetAddress: street,
      locality, region, postalCode: postal,
      countryCode: country.length <= 3 ? country.toUpperCase() : 'US',
      rawText: [street, locality, region, postal].filter(Boolean).join(', '),
      sourceReference, observedAt: now,
    });
  };

  const readArea = (value: any): void => {
    if (typeof value === 'string' && value.trim()) {
      serviceAreas.push({
        areaText: value.trim(), basis: 'SCHEMA_ORG_AREA_SERVED', sourceReference, observedAt: now,
      });
      return;
    }
    if (value && typeof value === 'object' && typeof value.name === 'string' && value.name.trim()) {
      serviceAreas.push({
        areaText: value.name.trim(), basis: 'SCHEMA_ORG_AREA_SERVED', sourceReference, observedAt: now,
      });
    }
  };

  const visit = (node: any, depth = 0): void => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    const types = asArray(node['@type']).map((t) => String(t).toLowerCase());
    const isOrganization = types.some((t) => ORGANIZATION_TYPE.test(t));

    if (isOrganization) {
      for (const address of asArray(node.address)) {
        if (typeof address === 'string') continue; // A string is prose, not a structure.
        readAddress(address);
      }
      for (const area of asArray(node.areaServed)) readArea(area);
      for (const location of asArray(node.location)) visit(location, depth + 1);
      for (const branch of asArray(node.branchOf)) visit(branch, depth + 1);
      for (const sub of asArray(node.subOrganization)) visit(sub, depth + 1);
      for (const department of asArray(node.department)) visit(department, depth + 1);
    }

    for (const key of ['@graph', 'itemListElement', 'mainEntity', 'about', 'publisher']) {
      for (const child of asArray(node[key])) visit(child, depth + 1);
    }
  };

  for (const block of blocks) visit(block);
  return { addresses, serviceAreas };
}

/**
 * A street address in running text, found from its end.
 *
 * Anchored on ", ST 12345" and read backwards, because reading forwards from the house
 * number is what produced these against real company sites already in inventory:
 *
 *   "3100 39th Ave N St. Petersburg, FL 33714"
 *      → street "3100 39th Ave N St.", city "Petersburg"
 *   "1700 4th St S, Unit C, St. Petersburg, FL 33701"
 *      → nothing at all
 *
 * A greedy scan to the last street suffix eats the "St." that begins a city name, and a
 * pattern with no room for a unit segment between the street and the city drops the
 * address entirely. Every part of the address is still required: the number, a street
 * word, a city, a state and a ZIP.
 */
const STATE_ZIP_TAIL = new RegExp(String.raw`,\s*(${US_STATE})\s+(\d{5})(?:-\d{4})?\b`, 'g');

/** How far back from the state and ZIP an address may begin. */
const TAIL_WINDOW = 140;

const DIRECTIONAL = /^(?:N|S|E|W|NE|NW|SE|SW)$/i;
const SUFFIX_WORD = new RegExp(`^${STREET_SUFFIX}\\.?$`, 'i');
/**
 * Words that mean "inside the building".
 *
 * `fl` for floor is deliberately absent. Every Florida address ends "FL 32801", and a
 * segment reading "FL 32801. Our second yard: 100 Main St S" was being skipped as a
 * floor number, which lost the second of two branches published in one sentence. A
 * collision between a state and an abbreviation is settled in favour of the state.
 */
const UNIT_WORD = /^(?:#|suite|ste|unit|apt|apartment|bldg|building|floor|room)\b/i;

/** A segment saying where inside a building, which is not a separate place. */
function isUnitSegment(segment: string): boolean {
  return UNIT_WORD.test(segment.trim());
}

/**
 * Whether what is left over reads like the name of a town.
 *
 * One to four words, no digits, starting with a capital, and never a bare street word
 * or a direction: the "St" left over from "100 Court St" is the end of the street, not
 * a city called St.
 */
function looksLikeCity(value: string): boolean {
  const trimmed = value.trim().replace(/^[-–—]\s*/, '');
  if (!trimmed || /\d/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 4) return false;
  if (!/^[A-Z]/.test(trimmed)) return false;
  if (words.length === 1 && (SUFFIX_WORD.test(words[0]!) || DIRECTIONAL.test(words[0]!))) {
    return false;
  }
  return /^[A-Za-z.'\- ]+$/.test(trimmed);
}

/**
 * Splits "3100 39th Ave N St. Petersburg" into its street and its city.
 *
 * Walks the street words from the first, and takes the earliest split whose leftover
 * reads like a town. "100 Court St" has no such leftover at "Court", so it keeps going
 * and ends with the whole segment as the street and the city still to come.
 */
function splitStreetAndCity(segment: string): { street: string; city: string | null } | null {
  const words = segment.trim().split(/\s+/);

  // The house number is rarely the first word of the segment: "Visit us at 100 Main
  // St", "North shop: 100 Main St N". Each number is tried, latest first, because the
  // one nearest the city is the one the address starts at.
  const starts: number[] = [];
  for (let i = 0; i < words.length; i += 1) {
    if (/^\d{1,6}(?:-\d{1,6})?$/.test(words[i]!)) starts.push(i);
  }

  for (const start of starts.reverse()) {
    for (let i = start + 1; i < words.length; i += 1) {
      if (!SUFFIX_WORD.test(words[i]!)) continue;
      // A direction immediately after the street word belongs to the street: "4th St S".
      const end = i + 1 < words.length && DIRECTIONAL.test(words[i + 1]!) ? i + 2 : i + 1;
      const street = words.slice(start, end).join(' ');
      const rest = words.slice(end).join(' ').trim();
      if (!rest) return { street, city: null };
      // "4820 Distribution Ct Unit 6": the unit is part of this segment and the city
      // is still to come. It is kept on the street line because a rep parking outside
      // needs it, and the dedupe key ignores it because it is the same building.
      if (isUnitSegment(rest)) return { street: `${street} ${rest}`, city: null };
      if (looksLikeCity(rest)) return { street, city: rest };
    }
  }
  return null;
}

/** Street addresses in the readable text of a page the company publishes. */
export function addressesFromText(
  text: string, sourceReference: string, now: Date = new Date(),
): AddressObservation[] {
  if (!text) return [];
  const found: AddressObservation[] = [];
  STATE_ZIP_TAIL.lastIndex = 0;

  let tail: RegExpExecArray | null;
  while ((tail = STATE_ZIP_TAIL.exec(text)) !== null) {
    const region = tail[1]!.toUpperCase();
    const postalCode = tail[2]!;
    const windowStart = Math.max(0, tail.index - TAIL_WINDOW);
    const before = text.slice(windowStart, tail.index);
    // Commas and line breaks only. Splitting on sentence ends as well is the obvious
    // next step and it is wrong: "St. Petersburg" is a city with a full stop in the
    // middle of it, and cutting there turns the city into the end of the street.
    const segments = before.split(/[,\n]/).map((part) => part.trim()).filter(Boolean);
    if (segments.length === 0) continue;

    let street: string | null = null;
    let city: string | null = null;
    let kind: AddressKind = 'PHYSICAL';

    const last = segments[segments.length - 1]!;
    const parsedLast = splitStreetAndCity(last);
    if (parsedLast?.city) {
      street = parsedLast.street;
      city = parsedLast.city;
    } else if (looksLikeCity(last)) {
      city = last;
      // Walk back past unit segments to the segment that holds the street.
      for (let i = segments.length - 2; i >= 0; i -= 1) {
        const segment = segments[i]!;
        if (isUnitSegment(segment)) continue;
        if (isMailDrop(segment)) { street = segment.trim(); kind = 'MAILING'; break; }
        const parsed = splitStreetAndCity(segment);
        if (parsed) {
          street = parsed.street;
          if (parsed.city) city = parsed.city;
        }
        break;
      }
    }

    if (!street || !city) continue;
    if (kind === 'PHYSICAL' && isMailDrop(street)) kind = 'MAILING';

    // The sentence a place name sits in is what says whether the company is in it, so
    // the check stops at the previous full stop: "Serving all of Florida. Visit us at
    // 100 Main St, Orlando, FL 32801" is an address, and the first sentence is not
    // about it.
    const streetIndex = text.lastIndexOf(street, tail.index);
    const leadFrom = Math.max(0, streetIndex - LEAD_WINDOW);
    const rawLead = text.slice(leadFrom, streetIndex);
    const sentenceBreak = rawLead.lastIndexOf('. ');
    const lead = sentenceBreak >= 0 ? rawLead.slice(sentenceBreak + 1) : rawLead;
    if (SERVICE_AREA_LEAD.test(lead)) continue;

    found.push({
      kind, basis: 'PAGE_TEXT',
      streetAddress: street.replace(/\s+/g, ' ').trim(),
      locality: city, region, postalCode, countryCode: 'US',
      rawText: text.slice(streetIndex >= 0 ? streetIndex : windowStart,
        tail.index + tail[0].length).replace(/\s+/g, ' ').trim(),
      sourceReference, observedAt: now,
    });
  }

  // A PO box reads "PO Box 1182, Sanford, FL 32772": the box is its own segment with
  // the city after it, so it is matched in its own right rather than bent into the
  // shape of a street.
  const poBox = new RegExp(
    String.raw`\b(P\.?\s*O\.?\s*Box\s+\d{1,7})\s*,\s*([A-Z][A-Za-z.'\- ]{1,28}?)\s*,\s*(${US_STATE})\s+(\d{5})(?:-\d{4})?\b`,
    'gi');
  let box: RegExpExecArray | null;
  while ((box = poBox.exec(text)) !== null) {
    found.push({
      kind: 'MAILING', basis: 'PAGE_TEXT',
      streetAddress: box[1]!.replace(/\s+/g, ' ').trim(),
      locality: box[2]!.trim(), region: box[3]!.toUpperCase(), postalCode: box[4]!,
      countryCode: 'US',
      rawText: box[0]!.replace(/\s+/g, ' ').trim(),
      sourceReference, observedAt: now,
    });
  }

  // A PO box reached by both passes is one mail drop, not two.
  const unique = new Map<string, AddressObservation>();
  for (const address of found) {
    const key = addressKey(address);
    if (!unique.has(key)) unique.set(key, address);
  }
  return [...unique.values()];
}
/**
 * The words a street can be written in two ways, mapped to one.
 *
 * Found against real sites rather than reasoned about: a St Petersburg company
 * publishes "1700 4th Street South, St. Petersburg, FL, 33701-5811" in its schema.org
 * block and "1700 4th St S, Unit C" three lines further down. Both are its office, and
 * keying on the raw text made one office two locations on the rep's page.
 */
const STREET_WORD_FORMS: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', road: 'rd', drive: 'dr',
  lane: 'ln', court: 'ct', circle: 'cir', place: 'pl', parkway: 'pkwy',
  highway: 'hwy', terrace: 'ter', trail: 'trl', square: 'sq', expressway: 'expy',
  bypass: 'byp', alley: 'aly', building: 'bldg', floor: 'fl',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

/** Segments that say where inside a building, which does not make it another place. */
const UNIT_SEGMENT = /\b(?:#|suite|ste|unit|apt|apartment|bldg|building|floor|fl|room|rm)\b.*$/;

function normalizeStreet(value: string): string {
  const withoutUnit = value.toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(UNIT_SEGMENT, ' ');
  return withoutUnit
    .split(/\s+/)
    .map((word) => STREET_WORD_FORMS[word] ?? word)
    .filter(Boolean)
    .join(' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .trim();
}

/**
 * One key per address, so the same office on four pages is one location.
 *
 * A directional is normalized and never dropped: "100 Main St N" and "100 Main St S"
 * are two different places, and a key that ignored the letter would merge them. A unit
 * is dropped, because a company at Unit C of a building is at that building, and a ZIP
 * is cut to five, because +4 is the same place at more precision.
 */
export function addressKey(address: AddressObservation): string {
  return [
    normalizeStreet(address.streetAddress),
    (address.locality ?? '').toLowerCase().replace(/[^a-z ]+/g, '').trim(),
    (address.region ?? '').toLowerCase().trim(),
    (address.postalCode ?? '').trim().slice(0, 5),
  ].join('|');
}

/**
 * Everything one crawl saw, deduplicated.
 *
 * A structured address outranks the same address read out of prose: both are the
 * company's own claim, and one of them was written to be read by a machine.
 */
export function extractAddresses(
  pages: { url: string; html?: string | null; text?: string | null; jsonLd?: unknown[] }[],
  now: Date = new Date(),
): AddressExtraction {
  if (pages.length === 0) return EMPTY;

  const byKey = new Map<string, AddressObservation>();
  const serviceAreas: ServiceAreaObservation[] = [];
  const seenAreas = new Set<string>();

  for (const page of pages) {
    if (page.jsonLd && page.jsonLd.length > 0) {
      const structured = addressesFromJsonLd(page.jsonLd, page.url, now);
      for (const address of structured.addresses) {
        const key = addressKey(address);
        const existing = byKey.get(key);
        // Two spellings of one office: keep the one that says more. A line naming the
        // unit is the same place described more precisely, not a second place.
        if (!existing || address.streetAddress.length > existing.streetAddress.length) {
          byKey.set(key, address);
        }
      }
      for (const area of structured.serviceAreas) {
        const key = area.areaText.toLowerCase();
        if (seenAreas.has(key)) continue;
        seenAreas.add(key);
        serviceAreas.push(area);
      }
    }
    if (page.text) {
      for (const address of addressesFromText(page.text, page.url, now)) {
        const key = addressKey(address);
        const existing = byKey.get(key);
        // A structured claim already read is not replaced by the prose version.
        if (!existing) byKey.set(key, address);
      }
    }
  }

  return { addresses: [...byKey.values()], serviceAreas };
}
