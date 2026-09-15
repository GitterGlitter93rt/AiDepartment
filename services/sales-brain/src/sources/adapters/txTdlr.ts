import { tableRows } from '../html.js';
import type { PersonObservation } from '../../resolver/types.js';
import type { MatchCandidate } from '../match.js';
import type { OfficialFact } from '../types.js';

/**
 * Texas Department of Licensing and Regulation — licence verification.
 * Authority: source governance entry `tx_tdlr`.
 *
 * Two programmes, chosen because they cover the Texas trades this product sells
 * into hardest: air conditioning/refrigeration and electrical. TDLR regulates dozens
 * of professions and ingesting all of them would be collecting data with no buyer.
 *
 * tdlr.texas.gov/robots.txt disallows `/*.csv`. TDLR publishes licence data as CSV
 * and it would be the efficient way to do this, and we do not take it: the site says
 * not to. Search pages only.
 */

export type TdlrProgram = 'AIR_CONDITIONING' | 'ELECTRICAL';

export const TDLR_PROGRAMS: Record<TdlrProgram, {
  label: string;
  /** Which vertical profiles this programme answers for. */
  verticals: string[];
  /** Licence types within the programme, most senior first. */
  licenseTypes: string[];
}> = {
  AIR_CONDITIONING: {
    label: 'Air Conditioning and Refrigeration',
    verticals: ['hvac'],
    licenseTypes: [
      'Air Conditioning and Refrigeration Contractor',
      'Air Conditioning and Refrigeration Technician',
    ],
  },
  ELECTRICAL: {
    label: 'Electricians',
    verticals: ['electrical'],
    licenseTypes: [
      'Electrical Contractor', 'Master Electrician', 'Journeyman Electrician',
      'Residential Wireman', 'Electrical Sign Contractor',
    ],
  },
};

export function tdlrProgramFor(verticalProfileId: string | null): TdlrProgram | null {
  const vertical = (verticalProfileId ?? '').toLowerCase();
  for (const [program, definition] of Object.entries(TDLR_PROGRAMS)) {
    if (definition.verticals.includes(vertical)) return program as TdlrProgram;
  }
  return null;
}

export interface TdlrLicence {
  licenseNumber: string;
  /** The name the licence is held in -- a person for most types, a business for some. */
  licenseeName: string;
  /** Present when the licence is held by, or tied to, a business. */
  businessName: string | null;
  licenseType: string;
  status: string;
  expirationDate: string | null;
  city: string | null;
  county: string | null;
  stateRegion: string;
  program: TdlrProgram;
}

/**
 * Parses a TDLR licence search result table.
 *
 * Tolerant of column order because the two programmes present slightly different
 * tables, and strict about what it will accept as a licence number so a header row
 * or a "no records found" banner can never become a licence.
 */
export function parseTdlrResults(html: string, program: TdlrProgram): TdlrLicence[] {
  const rows = tableRows(html);
  if (rows.length === 0) return [];

  /**
   * Column names taken from the live result table, not from what seemed likely.
   *
   * The licence column is headed "License Data Search Result" -- not "License #" --
   * and the browse view carries no status column at all: it prints licence, expiry,
   * name, city, ZIP, county and phone. A parser that required a status found nothing,
   * every time, and every fixture-based test passed while it did.
   */
  const header = rows.find((cells) =>
    cells.some((cell) => /licen[cs]e\s*(data|#|number)/i.test(cell))
      && cells.some((cell) => /^name$/i.test(cell)))
    ?? rows[0]!;
  const columnFor = (...patterns: RegExp[]): number =>
    header.findIndex((cell) => patterns.some((pattern) => pattern.test(cell)));

  const columns = {
    number: columnFor(/licen[cs]e\s*data\s*search\s*result/i, /licen[cs]e\s*#/i,
      /licen[cs]e number/i, /^licen[cs]e$/i),
    name: columnFor(/^name$/i, /licensee/i, /individual/i),
    business: columnFor(/business/i, /company/i, /dba/i, /owner/i),
    city: columnFor(/^city$/i),
    county: columnFor(/^county$/i),
    status: columnFor(/^status$/i),
    expires: columnFor(/exp\.?\s*date/i, /expir/i),
    type: columnFor(/licen[cs]e type/i, /^type$/i),
  };
  if (columns.number === -1 || columns.name === -1) return [];

  /**
   * TDLR licence numbers are a programme prefix and a serial, printed with spaces
   * around the separator: "AAU - 9849", "TACLA00123456", "ACR-1234". The previous
   * pattern accepted only an unbroken prefix-and-digits and rejected the spaced form
   * the site actually prints.
   */
  const LICENCE_NUMBER = /^[A-Z]{2,8}\s*-?\s*\d{3,9}$/i;

  const licences: TdlrLicence[] = [];
  for (const cells of rows) {
    if (cells === header) continue;
    const raw = cells[columns.number]?.trim();
    if (!raw || !LICENCE_NUMBER.test(raw)) continue;

    const licenseeName = cells[columns.name]?.trim();
    if (!licenseeName || /^name$/i.test(licenseeName)) continue;

    const at = (index: number): string | null =>
      index === -1 ? null : (cells[index]?.trim() || null);

    licences.push({
      // Normalised so "AAU - 9849" and "AAU-9849" are one licence, while the printed
      // form stays recoverable from the source reference.
      licenseNumber: raw.replace(/\s*-\s*/, '-').replace(/\s+/g, ' '),
      licenseeName,
      businessName: at(columns.business),
      licenseType: at(columns.type) ?? TDLR_PROGRAMS[program].licenseTypes[0]!,
      /**
       * The browse view does not print a status.
       *
       * UNKNOWN rather than an assumed "Active": a licence whose status nobody has
       * read is not a verified licence, and `tdlrFacts` refuses to call it active.
       */
      status: at(columns.status) ?? 'UNKNOWN',
      expirationDate: at(columns.expires),
      city: at(columns.city),
      county: at(columns.county),
      stateRegion: 'TX',
      program,
    });
  }
  return licences;
}

/**
 * Whether the licence found is the licence the trade needs.
 *
 * TDLR runs both programmes this adapter covers, and a company can hold a licence in
 * one while the account is about the other. Reporting "licensed" without checking
 * would be true of the wrong thing -- an HVAC account verified against an electrical
 * licence has not had its air-conditioning credentials checked at all, and a rep
 * would read the green tick as though it had.
 *
 * Mirrors `licenceCoversVertical` in the Florida adapter, which had this check from
 * the start; Texas was the side that was missing it.
 */
const TDLR_TRADE_PATTERNS: Record<TdlrProgram, RegExp> = {
  AIR_CONDITIONING: /(air ?cond|refrigerat|hvac|\bacr?\b|tacl)/i,
  ELECTRICAL: /(electric|wireman|\bec\b)/i,
};

export function tdlrLicenceCoversVertical(
  licence: TdlrLicence, verticalProfileId: string | null,
): boolean {
  const program = tdlrProgramFor(verticalProfileId);
  // No programme covers this trade, so there is nothing this licence could satisfy.
  if (!program) return false;
  const pattern = TDLR_TRADE_PATTERNS[program];
  return pattern.test(`${licence.licenseType} ${licence.licenseNumber}`);
}

export function tdlrCandidate(licence: TdlrLicence): MatchCandidate {
  return {
    name: licence.businessName ?? licence.licenseeName,
    reference: licence.licenseNumber,
    city: licence.city,
    stateRegion: licence.stateRegion,
    alternateNames: licence.businessName ? [licence.licenseeName] : [],
  };
}

const ACTIVE_STATUSES = new Set(['active', 'current']);

export function tdlrFacts(licence: TdlrLicence, reference: string): OfficialFact[] {
  const active = ACTIVE_STATUSES.has(licence.status.toLowerCase());
  return [
    {
      claimKey: 'professional_license_number',
      claimText: `${TDLR_PROGRAMS[licence.program].label} licence ${licence.licenseNumber} `
        + `(${licence.licenseType}) issued by the Texas Department of Licensing and Regulation.`,
      normalizedValue: licence.licenseNumber,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
    },
    {
      claimKey: 'professional_license_status',
      claimText: licence.status.toUpperCase() === 'UNKNOWN'
        // The browse view lists licences without a status column. Saying so is more
        // useful than a blank, and safer than an assumed "Active": an unread status
        // is not a verified licence.
        ? 'The TDLR result listing does not publish a licence status'
          + `${licence.expirationDate ? `; the licence expires ${licence.expirationDate}` : ''}. `
          + 'Status has not been verified.'
        : `TDLR licence status: ${licence.status}`
          + `${licence.expirationDate ? `, expiring ${licence.expirationDate}` : ''}.`,
      normalizedValue: active ? 'ACTIVE' : licence.status.toUpperCase(),
      // Status and expiry are the two fields that change without notice, so this is
      // the shortest-lived fact the adapter produces.
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
    },
    {
      claimKey: 'official_license_source',
      claimText: `Verified against the Texas Department of Licensing and Regulation `
        + `record ${reference}.`,
      normalizedValue: reference,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
    },
  ];
}

/**
 * The licence holder, as a licence holder.
 *
 * A named individual on a contractor licence is genuinely useful -- they are real,
 * verifiable and usually senior. They are not thereby the owner, and the resolver's
 * EVIDENCE_ONLY_RELATIONSHIPS already refuses to let LICENSE_HOLDER stand in for
 * one. A business-held licence produces no person at all rather than a person whose
 * name is a company.
 */
export function tdlrPeople(licence: TdlrLicence, reference: string): PersonObservation[] {
  const looksLikeCompany = /(l\.?l\.?c|inc\b|corp|company|services|ltd|\bco\b)/i
    .test(licence.licenseeName);
  if (looksLikeCompany) return [];

  return [{
    personName: licence.licenseeName,
    rawTitle: licence.licenseType,
    relationship: 'LICENSE_HOLDER',
    sourceClass: 'PUBLIC_LICENSE_REGISTRY',
    sourceReference: reference,
    observedAt: new Date(),
    freshness: 'FRESH',
    scope: 'ACCOUNT',
    notes: `Holds TDLR ${licence.licenseType} licence ${licence.licenseNumber}`
      + `${licence.businessName ? `, tied to ${licence.businessName}` : ''}. `
      + 'Holding a licence is not evidence of ownership.',
  }];
}
