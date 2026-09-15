import type { PersonObservation } from '../../resolver/types.js';
import type { MatchCandidate } from '../match.js';
import type { OfficialFact } from '../types.js';

/**
 * Texas State Board of Plumbing Examiners — licensee data.
 * Authority: source governance entry `tx_tsbpe`.
 *
 * The Responsible Master Plumber is the most valuable single person this product can
 * put in front of a rep working Texas plumbing. Texas requires a plumbing company to
 * designate one, the state publishes who it is, and they are almost always the owner
 * or a principal -- which is exactly why the code below refuses to call them the
 * owner. "Almost always" is a sales heuristic, not a fact, and the difference is the
 * whole point of this system.
 *
 * Snapshot-shaped rather than request-shaped. Licence verification lives in a
 * session-based form application, and hitting it once per account would be both
 * fragile and rude. One dataset is loaded, indexed and matched against every account,
 * which is also the only way the freshness can be stated honestly: a snapshot is as
 * fresh as its download, never "verified today".
 */

export type TsbpeLicenseType =
  | 'RESPONSIBLE_MASTER_PLUMBER' | 'MASTER_PLUMBER' | 'JOURNEYMAN_PLUMBER'
  | 'TRADESMAN_PLUMBER_LIMITED' | 'PLUMBING_INSPECTOR' | 'APPRENTICE';

export const TSBPE_LICENSE_LABELS: Record<TsbpeLicenseType, string> = {
  RESPONSIBLE_MASTER_PLUMBER: 'Responsible Master Plumber',
  MASTER_PLUMBER: 'Master Plumber',
  JOURNEYMAN_PLUMBER: 'Journeyman Plumber',
  TRADESMAN_PLUMBER_LIMITED: 'Tradesman Plumber-Limited',
  PLUMBING_INSPECTOR: 'Plumbing Inspector',
  APPRENTICE: 'Apprentice',
};

/** Seniority, used only to choose which licence to show first. */
const LICENSE_RANK: Record<TsbpeLicenseType, number> = {
  RESPONSIBLE_MASTER_PLUMBER: 0, MASTER_PLUMBER: 1, JOURNEYMAN_PLUMBER: 2,
  TRADESMAN_PLUMBER_LIMITED: 3, PLUMBING_INSPECTOR: 4, APPRENTICE: 5,
};

export function classifyTsbpeLicenseType(raw: string): TsbpeLicenseType | null {
  const value = raw.trim().toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ');
  if (/responsible master/.test(value)) return 'RESPONSIBLE_MASTER_PLUMBER';
  if (/^rmp$/.test(value)) return 'RESPONSIBLE_MASTER_PLUMBER';
  if (/master plumber/.test(value)) return 'MASTER_PLUMBER';
  if (/journeyman/.test(value)) return 'JOURNEYMAN_PLUMBER';
  if (/tradesman/.test(value)) return 'TRADESMAN_PLUMBER_LIMITED';
  if (/inspector/.test(value)) return 'PLUMBING_INSPECTOR';
  if (/apprentice/.test(value)) return 'APPRENTICE';
  return null;
}

export interface TsbpeRecord {
  licenseNumber: string;
  licenseType: TsbpeLicenseType;
  licenseeName: string;
  /** The company the board ties this licensee to, when the dataset says. */
  companyName: string | null;
  status: string;
  expirationDate: string | null;
  /**
   * Some TSBPE datasets carry the RMP's insurance expiry. Genuinely useful and
   * genuinely official, so it is kept when present and never inferred when absent.
   */
  insuranceExpirationDate: string | null;
  city: string | null;
  county: string | null;
  endorsements: string[];
}

/**
 * Parses a delimited TSBPE licensee export.
 *
 * Column names vary between the board's published files, so headers are matched by
 * meaning rather than by exact string, and a row without a licence number or a
 * recognisable licence type is skipped rather than guessed at.
 */
export function parseTsbpeDataset(content: string): TsbpeRecord[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = (lines[0]!.match(/\t/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0)
    ? '\t' : ',';
  const splitRow = (line: string): string[] => {
    if (delimiter === '\t') return line.split('\t').map((cell) => cell.trim());
    // Minimal CSV handling: quoted cells may contain commas.
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (character === '"') {
        if (quoted && line[index + 1] === '"') { current += '"'; index += 1; continue; }
        quoted = !quoted;
        continue;
      }
      if (character === ',' && !quoted) { cells.push(current.trim()); current = ''; continue; }
      current += character;
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = splitRow(lines[0]!).map((header) => header.toLowerCase().replace(/[^a-z]/g, ''));
  const indexOf = (...candidates: string[]): number =>
    headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));

  const columns = {
    licenseNumber: indexOf('licensenumber', 'licenseno', 'licensenum', 'license'),
    licenseType: indexOf('licensetype', 'type'),
    name: indexOf('licenseename', 'name'),
    company: indexOf('companyname', 'businessname', 'employer', 'company', 'dba'),
    status: indexOf('status'),
    expiration: indexOf('expirationdate', 'expiration', 'expires'),
    insurance: indexOf('insuranceexpiration', 'insurance'),
    city: indexOf('city'),
    county: indexOf('county'),
    endorsements: indexOf('endorsement'),
  };
  if (columns.licenseNumber === -1 || columns.name === -1) return [];

  const records: TsbpeRecord[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitRow(line);
    const licenseNumber = cells[columns.licenseNumber]?.trim();
    const licenseeName = cells[columns.name]?.trim();
    if (!licenseNumber || !licenseeName) continue;

    const licenseType = columns.licenseType === -1 ? null
      : classifyTsbpeLicenseType(cells[columns.licenseType] ?? '');
    if (!licenseType) continue;

    const company = columns.company === -1 ? null : (cells[columns.company]?.trim() || null);
    records.push({
      licenseNumber,
      licenseType,
      licenseeName,
      companyName: company,
      status: (columns.status === -1 ? '' : cells[columns.status] ?? '').trim() || 'UNKNOWN',
      expirationDate: (columns.expiration === -1 ? null : cells[columns.expiration]?.trim()) || null,
      insuranceExpirationDate:
        (columns.insurance === -1 ? null : cells[columns.insurance]?.trim()) || null,
      city: (columns.city === -1 ? null : cells[columns.city]?.trim()) || null,
      county: (columns.county === -1 ? null : cells[columns.county]?.trim()) || null,
      endorsements: columns.endorsements === -1 ? []
        : (cells[columns.endorsements] ?? '').split(/[;,|]/).map((value) => value.trim())
          .filter(Boolean),
    });
  }
  return records;
}

/** The record as a match candidate. Matching is on the company, not the person. */
export function tsbpeCandidate(record: TsbpeRecord): MatchCandidate {
  return {
    name: record.companyName ?? record.licenseeName,
    reference: record.licenseNumber,
    city: record.city,
    stateRegion: 'TX',
  };
}

/** Most senior licence first, so the RMP is what a rep sees. */
export function rankTsbpe(records: TsbpeRecord[]): TsbpeRecord[] {
  return [...records].sort((left, right) =>
    LICENSE_RANK[left.licenseType] - LICENSE_RANK[right.licenseType]);
}

const ACTIVE_STATUSES = new Set(['active', 'current', 'valid']);

export function tsbpeFacts(record: TsbpeRecord, reference: string): OfficialFact[] {
  const label = TSBPE_LICENSE_LABELS[record.licenseType];
  const active = ACTIVE_STATUSES.has(record.status.toLowerCase());
  const facts: OfficialFact[] = [
    {
      claimKey: 'professional_license_number',
      claimText: `${label} licence ${record.licenseNumber} held by ${record.licenseeName}, `
        + 'issued by the Texas State Board of Plumbing Examiners.',
      normalizedValue: record.licenseNumber,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
    },
    {
      claimKey: 'professional_license_status',
      claimText: `TSBPE licence status: ${record.status}`
        + `${record.expirationDate ? `, expiring ${record.expirationDate}` : ''}.`,
      normalizedValue: active ? 'ACTIVE' : record.status.toUpperCase(),
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
    },
  ];

  if (record.licenseType === 'RESPONSIBLE_MASTER_PLUMBER') {
    facts.push({
      claimKey: 'responsible_master_plumber',
      claimText: `${record.licenseeName} is the Responsible Master Plumber on record`
        + `${record.companyName ? ` for ${record.companyName}` : ''}. Texas requires a `
        + 'plumbing company to designate one; the designation is a regulatory role and '
        + 'is not by itself evidence of ownership.',
      normalizedValue: record.licenseeName,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
    });
  }

  if (record.insuranceExpirationDate) {
    facts.push({
      claimKey: 'license_insurance_expiration',
      claimText: `Insurance on file with the plumbing board expires `
        + `${record.insuranceExpirationDate}.`,
      normalizedValue: record.insuranceExpirationDate,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
    });
  }

  if (record.endorsements.length > 0) {
    facts.push({
      claimKey: 'license_endorsements',
      claimText: `Endorsements on file: ${record.endorsements.join(', ')}.`,
      normalizedValue: record.endorsements.join(','),
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 90,
    });
  }

  facts.push({
    claimKey: 'official_license_source',
    claimText: `Verified against the Texas State Board of Plumbing Examiners record ${reference}.`,
    normalizedValue: reference, canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
  });
  return facts;
}

/**
 * The licensee, at the role the board gives them.
 *
 * A Responsible Master Plumber is a QUALIFIER: the person whose licence lets the
 * company operate. That is an evidence relationship in the resolver, which means it
 * establishes the person↔company link without ever standing in for an owner. It is
 * shown prominently and labelled precisely -- both of which matter, and neither of
 * which is the same as promoting them.
 */
export function tsbpePeople(record: TsbpeRecord, reference: string): PersonObservation[] {
  const label = TSBPE_LICENSE_LABELS[record.licenseType];
  return [{
    personName: record.licenseeName,
    rawTitle: label,
    relationship: record.licenseType === 'RESPONSIBLE_MASTER_PLUMBER'
      ? 'QUALIFIER' : 'LICENSE_HOLDER',
    sourceClass: 'PUBLIC_LICENSE_REGISTRY',
    sourceReference: reference,
    observedAt: new Date(),
    freshness: 'FRESH',
    scope: 'ACCOUNT',
    notes: `${label} on the Texas plumbing board record`
      + `${record.companyName ? `, associated with ${record.companyName}` : ''}. `
      + 'A regulatory designation, not evidence of ownership.',
  }];
}
