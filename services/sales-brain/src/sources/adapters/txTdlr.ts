import { stripTags } from '../../resolver/adapters/firstParty.js';
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
  const text = stripTags(html);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const licences: TdlrLicence[] = [];

  for (const line of lines) {
    // Rows arrive as pipe- or multi-space-separated cells.
    const cells = (line.includes('|') ? line.split('|') : line.split(/\s{2,}/))
      .map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 4) continue;

    const numberIndex = cells.findIndex((cell) => /^[A-Z]{0,4}\d{4,9}$/.test(cell));
    if (numberIndex === -1) continue;

    const statusIndex = cells.findIndex((cell) =>
      /^(Active|Expired|Inactive|Suspended|Revoked|Surrendered|Delinquent)$/i.test(cell));
    if (statusIndex === -1) continue;

    const expiration = cells.find((cell) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cell)) ?? null;
    const typeCell = cells.find((cell) =>
      TDLR_PROGRAMS[program].licenseTypes.some((type) =>
        cell.toLowerCase().includes(type.toLowerCase().split(' ')[0]!)))
      ?? TDLR_PROGRAMS[program].licenseTypes[0]!;

    // The name is the longest remaining cell that is not a number, status, date or
    // a two-letter state.
    const nameCandidates = cells.filter((cell, index) =>
      index !== numberIndex && index !== statusIndex
      && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cell) && !/^[A-Z]{2}$/.test(cell)
      && cell !== typeCell && cell.length > 2);
    if (nameCandidates.length === 0) continue;

    const licenseeName = nameCandidates[0]!;
    // A second long name-ish cell is the business the licence is tied to.
    const businessName = nameCandidates.length > 1
      && /(l\.?l\.?c|inc|co\b|company|services|corp|ltd)/i.test(nameCandidates[1]!)
      ? nameCandidates[1]! : null;
    const city = nameCandidates.find((cell, index) =>
      index > 0 && /^[A-Za-z .'-]{3,}$/.test(cell) && cell !== businessName) ?? null;

    licences.push({
      licenseNumber: cells[numberIndex]!,
      licenseeName,
      businessName,
      licenseType: typeCell,
      status: cells[statusIndex]!,
      expirationDate: expiration,
      city,
      county: null,
      stateRegion: 'TX',
      program,
    });
  }
  return licences;
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
