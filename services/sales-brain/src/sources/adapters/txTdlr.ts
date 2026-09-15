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

  // The header names the columns; the two programmes label them slightly
  // differently, so columns are found by meaning rather than by position.
  const header = rows.find((cells) =>
    cells.some((cell) => /licen[cs]e\s*#|licen[cs]e number/i.test(cell)))
    ?? rows[0]!;
  const columnFor = (...patterns: RegExp[]): number =>
    header.findIndex((cell) => patterns.some((pattern) => pattern.test(cell)));

  const columns = {
    number: columnFor(/licen[cs]e\s*#/i, /licen[cs]e number/i),
    name: columnFor(/^name$/i, /licensee/i, /individual/i),
    business: columnFor(/business/i, /company/i, /dba/i),
    city: columnFor(/^city$/i),
    county: columnFor(/^county$/i),
    status: columnFor(/^status$/i),
    expires: columnFor(/expir/i),
    type: columnFor(/licen[cs]e type/i, /^type$/i),
  };

  const licences: TdlrLicence[] = [];
  for (const cells of rows) {
    if (cells === header) continue;
    const licenseNumber = columns.number === -1 ? null : cells[columns.number]?.trim();
    // A licence number is the one field a row must have to be a licence. Without it
    // a header, a footer or a "no records found" banner would become a credential.
    if (!licenseNumber || !/^[A-Z]{0,6}\d{4,9}$/i.test(licenseNumber)) continue;

    const status = (columns.status === -1 ? '' : cells[columns.status] ?? '').trim();
    if (!status) continue;

    const licenseeName = (columns.name === -1 ? '' : cells[columns.name] ?? '').trim();
    if (!licenseeName) continue;

    const businessName = columns.business === -1
      ? null : (cells[columns.business]?.trim() || null);

    licences.push({
      licenseNumber,
      licenseeName,
      businessName,
      licenseType: (columns.type === -1 ? '' : cells[columns.type] ?? '').trim()
        || TDLR_PROGRAMS[program].licenseTypes[0]!,
      status,
      expirationDate: (columns.expires === -1 ? null : cells[columns.expires]?.trim()) || null,
      city: (columns.city === -1 ? null : cells[columns.city]?.trim()) || null,
      county: (columns.county === -1 ? null : cells[columns.county]?.trim()) || null,
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
      claimText: `TDLR licence status: ${licence.status}`
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
