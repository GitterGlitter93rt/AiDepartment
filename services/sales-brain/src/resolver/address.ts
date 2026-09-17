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
 * A street address in running text.
 *
 * Requires a number, a street name with a recognised suffix, a city, a state and a
 * ZIP. Every one of those is load-bearing: dropping the ZIP matches "Serving Winter
 * Park, FL", dropping the suffix matches a phone number and a date, and dropping the
 * number matches the name of a road in a sentence about driving to one.
 */
const TEXT_ADDRESS = new RegExp(
  String.raw`\b(\d{1,6}(?:-\d{1,6})?\s+(?:[A-Z0-9][A-Za-z0-9'.\-]*\s+){0,5}${STREET_SUFFIX}\b\.?`
  + String.raw`(?:\s*(?:#|Suite|Ste\.?|Unit|Apt\.?|Bldg\.?|Building|Floor|Fl\.?)\s*[A-Za-z0-9\-]+)?)`
  + String.raw`\s*,?\s*([A-Z][A-Za-z.'\- ]{1,28}?)\s*,\s*(${US_STATE})\s+(\d{5})(?:-\d{4})?\b`,
  'g');

const PO_BOX_ADDRESS = new RegExp(
  String.raw`\b(P\.?\s*O\.?\s*Box\s+\d{1,7})\s*,?\s*([A-Z][A-Za-z.'\- ]{1,28}?)\s*,\s*(${US_STATE})\s+(\d{5})(?:-\d{4})?\b`,
  'gi');

/**
 * Wording that means "we will come to you", which is never an address.
 *
 * Checked against the text immediately before a candidate, because the sentence that
 * contains a place name is what says whether the company is *in* it. "Proudly serving
 * Winter Park, FL 32789" is a service area with a ZIP in it, and it is exactly what a
 * looser matcher turns into a head office.
 */
const SERVICE_AREA_LEAD = new RegExp(
  String.raw`\b(serv(?:ing|ice|es)|we\s+come\s+to\s+you|areas?\s+we\s+serve|coverage\s+area`
  + String.raw`|surrounding|throughout|proudly\s+serve|mobile\s+service|travel\s+to)\b`, 'i');

/** How much text before a candidate counts as "the sentence it is in". */
const LEAD_WINDOW = 90;

/**
 * Structured addresses from JSON-LD, and the service areas beside them.
 *
 * `areaServed` is read on purpose rather than ignored: the two claims live next to
 * each other in the same node, and the way they get confused is one of them being
 * invisible. Reading both is how a service area stays a service area.
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

/** Street addresses in the readable text of a page the company publishes. */
export function addressesFromText(
  text: string, sourceReference: string, now: Date = new Date(),
): AddressObservation[] {
  if (!text) return [];
  const found: AddressObservation[] = [];

  const collect = (
    pattern: RegExp, kind: (street: string) => AddressKind,
  ): void => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const [whole, street, locality, region, postal] = match;
      const lead = text.slice(Math.max(0, match.index - LEAD_WINDOW), match.index);
      // "Proudly serving Winter Park, FL 32789" is a service area with a ZIP in it.
      if (SERVICE_AREA_LEAD.test(lead)) continue;
      found.push({
        kind: kind(street!),
        basis: 'PAGE_TEXT',
        streetAddress: street!.trim().replace(/\s+/g, ' '),
        locality: locality!.trim(),
        region: region!.toUpperCase(),
        postalCode: postal!,
        countryCode: 'US',
        rawText: whole.trim().replace(/\s+/g, ' '),
        sourceReference, observedAt: now,
      });
    }
  };

  collect(TEXT_ADDRESS, (street) => (isMailDrop(street) ? 'MAILING' : 'PHYSICAL'));
  collect(PO_BOX_ADDRESS, () => 'MAILING');
  return found;
}

/** One key per address, so the same office on four pages is one location. */
export function addressKey(address: AddressObservation): string {
  return [
    address.streetAddress.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    (address.locality ?? '').toLowerCase().trim(),
    (address.region ?? '').toLowerCase().trim(),
    (address.postalCode ?? '').trim(),
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
        if (!byKey.has(key)) byKey.set(key, address);
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
