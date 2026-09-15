import { stripTags } from '../../resolver/adapters/firstParty.js';
import type { PersonObservation } from '../../resolver/types.js';
import type { MatchCandidate } from '../match.js';
import type { OfficialFact } from '../types.js';

/**
 * Florida DBPR — contractor and professional licence verification.
 * Authority: source governance entry `fl_dbpr`.
 *
 * Florida licenses the trades this product sells into most: plumbing, HVAC,
 * electrical, roofing and general contracting. A licence is the cheapest possible
 * proof that a discovered company is a real operating business rather than a lead
 * page with a phone number.
 *
 * DBPR distinguishes a licence held by an individual from one held by a business
 * with a *qualifying agent* -- the licensed person who takes professional
 * responsibility for the company's work. The qualifier is a genuinely useful named
 * contact and is very often an owner. "Very often" is not evidence, so the qualifier
 * is recorded as a qualifier.
 */

export interface DbprLicence {
  licenseNumber: string;
  licenseType: string;
  rank: string | null;
  licenseeName: string;
  dbaName: string | null;
  /** Set when the licence is held by a business rather than a person. */
  businessName: string | null;
  /** The individual who qualifies the business, when the record names one. */
  qualifyingAgent: string | null;
  primaryStatus: string;
  secondaryStatus: string | null;
  licensureDate: string | null;
  expiresDate: string | null;
  city: string | null;
  county: string | null;
  stateRegion: string;
}

function field(lines: string[], label: RegExp): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!label.test(line)) continue;
    const inline = line.replace(label, '').replace(/^[:\s]+/, '').trim();
    if (inline) return inline;
    const next = lines[index + 1]?.trim();
    if (next && !/:$/.test(next)) return next;
    return null;
  }
  return null;
}

/**
 * Parses a DBPR licensee detail page.
 *
 * Returns null unless a licence number is present. The search, the "no results"
 * page and the detail page all return 200, and a record whose licence number is a
 * table header is worse than no record.
 */
export function parseDbprDetail(html: string): DbprLicence | null {
  const lines = stripTags(html).split('\n').map((line) => line.trim()).filter(Boolean);

  const licenseNumber = field(lines, /^(?:License|Licence) Number\s*:?/i)
    ?? field(lines, /^Lic(?:ense)?\.? ?#\s*:?/i);
  if (!licenseNumber || !/\d/.test(licenseNumber)) return null;

  const licenseeName = field(lines, /^(?:Licensee )?Name\s*:?/i)
    ?? field(lines, /^Licensee\s*:?/i);
  if (!licenseeName) return null;

  const primaryStatus = field(lines, /^Primary Status\s*:?/i)
    ?? field(lines, /^Status\s*:?/i) ?? 'UNKNOWN';

  const locality = field(lines, /^(?:City|Main Address City)\s*:?/i);
  const qualifyingAgent = field(lines, /^Qualif(?:ying Agent|ier)\s*:?/i);
  const businessName = field(lines, /^(?:Qualifying for|Business Name|Doing Business As Name)\s*:?/i);

  return {
    licenseNumber,
    licenseType: field(lines, /^License Type\s*:?/i) ?? 'Unknown',
    rank: field(lines, /^Rank\s*:?/i),
    licenseeName,
    dbaName: field(lines, /^(?:DBA|D\/B\/A) Name\s*:?/i),
    businessName,
    qualifyingAgent,
    primaryStatus,
    secondaryStatus: field(lines, /^Secondary Status\s*:?/i),
    licensureDate: field(lines, /^(?:Original )?Licensure Date\s*:?/i),
    expiresDate: field(lines, /^Expires?(?: Date)?\s*:?/i),
    city: locality,
    county: field(lines, /^County\s*:?/i),
    stateRegion: 'FL',
  };
}

export function dbprCandidate(licence: DbprLicence): MatchCandidate {
  return {
    name: licence.businessName ?? licence.dbaName ?? licence.licenseeName,
    reference: licence.licenseNumber,
    city: licence.city,
    stateRegion: licence.stateRegion,
    alternateNames: [licence.licenseeName, licence.dbaName, licence.businessName]
      .filter((name): name is string => Boolean(name)),
  };
}

/**
 * Which DBPR licence answers for which trade.
 *
 * Used to check that the licence found is the licence the trade needs: a roofing
 * company holding only an electrical licence has not had its roofing credentials
 * verified, and reporting it as "licensed" would be true of the wrong thing.
 */
const LICENCE_KEYWORDS: Record<string, RegExp> = {
  plumbing: /plumb/i,
  hvac: /(air ?cond|hvac|mechanic|refrigerat)/i,
  electrical: /electric/i,
  roofing: /roof/i,
  'general-contractors-remodeling': /(general|building) contractor/i,
};

export function licenceCoversVertical(
  licence: DbprLicence, verticalProfileId: string | null,
): boolean {
  const pattern = LICENCE_KEYWORDS[(verticalProfileId ?? '').toLowerCase()];
  if (!pattern) return true;
  return pattern.test(`${licence.licenseType} ${licence.rank ?? ''}`);
}

const ACTIVE_STATUSES = new Set(['current', 'active', 'current,active']);

export function dbprFacts(licence: DbprLicence, reference: string): OfficialFact[] {
  const status = [licence.primaryStatus, licence.secondaryStatus]
    .filter(Boolean).join(', ');
  const active = ACTIVE_STATUSES.has(status.toLowerCase().replace(/\s/g, ''));

  const facts: OfficialFact[] = [
    {
      claimKey: 'professional_license_number',
      claimText: `Florida DBPR licence ${licence.licenseNumber}`
        + `${licence.licenseType !== 'Unknown' ? ` (${licence.licenseType})` : ''}`
        + `${licence.rank ? `, rank ${licence.rank}` : ''}.`,
      normalizedValue: licence.licenseNumber,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
    },
    {
      claimKey: 'professional_license_status',
      claimText: `Florida DBPR licence status: ${status || 'unknown'}`
        + `${licence.expiresDate ? `, expiring ${licence.expiresDate}` : ''}.`,
      normalizedValue: active ? 'ACTIVE' : status.toUpperCase() || 'UNKNOWN',
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
    },
  ];

  if (licence.licensureDate) {
    facts.push({
      claimKey: 'license_first_issued',
      claimText: `Licensed in Florida since ${licence.licensureDate}.`,
      normalizedValue: licence.licensureDate,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 3650,
    });
  }

  if (licence.qualifyingAgent) {
    facts.push({
      claimKey: 'license_qualifying_agent',
      claimText: `${licence.qualifyingAgent} is the qualifying agent on the Florida `
        + 'licence. The qualifier takes professional responsibility for the '
        + 'company’s licensed work; the role is not by itself evidence of ownership.',
      normalizedValue: licence.qualifyingAgent,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 90,
    });
  }

  facts.push({
    claimKey: 'official_license_source',
    claimText: `Verified against the Florida DBPR record ${reference}.`,
    normalizedValue: reference, canStateAsFact: true, confidence: 'confirmed', ttlDays: 30,
  });
  return facts;
}

export function dbprPeople(licence: DbprLicence, reference: string): PersonObservation[] {
  const people: PersonObservation[] = [];
  const observedAt = new Date();

  if (licence.qualifyingAgent) {
    people.push({
      personName: licence.qualifyingAgent,
      rawTitle: 'Qualifying Agent',
      relationship: 'QUALIFIER',
      sourceClass: 'PUBLIC_LICENSE_REGISTRY',
      sourceReference: reference,
      observedAt,
      freshness: 'FRESH',
      scope: 'ACCOUNT',
      notes: `Qualifying agent on Florida licence ${licence.licenseNumber}. `
        + 'A regulatory role, not evidence of ownership.',
    });
  }

  // An individually held licence names a real person. A business-held one names a
  // company, and a company is not a person however much the column is called "name".
  const looksLikeCompany = /(l\.?l\.?c|inc\b|corp|company|services|ltd|\bco\b)/i
    .test(licence.licenseeName);
  if (!looksLikeCompany && licence.licenseeName !== licence.qualifyingAgent) {
    people.push({
      personName: licence.licenseeName,
      rawTitle: licence.licenseType,
      relationship: 'LICENSE_HOLDER',
      sourceClass: 'PUBLIC_LICENSE_REGISTRY',
      sourceReference: reference,
      observedAt,
      freshness: 'FRESH',
      scope: 'ACCOUNT',
      notes: `Holds Florida licence ${licence.licenseNumber}. `
        + 'Holding a licence is not evidence of ownership.',
    });
  }
  return people;
}

/**
 * The real search contract, recorded from the live form (2026-09-15).
 *
 * `wl11.asp` is a legacy ASP application. The licensee search is a POST to
 * `wl11.asp?mode=1&SID=&brd=&typ=` carrying a `SearchType` radio (Name | LicNbr |
 * City | LicTyp) and around thirty hidden fields -- `hOrgName`, `hLastName`,
 * `hSearchType`, `hLicNbr`, `hCity`, `hDivision`, `hBoard`, `hSearchOpt`,
 * `hRecsPerPage` and the rest -- with a session identifier threaded through `SID`.
 *
 * The adapter previously constructed a GET with invented query parameters, which
 * would never have returned a record. Rather than drive a stateful form once per
 * account -- fragile, and rude to a state system -- DBPR is treated the way the Texas
 * plumbing board is: a published licensee file, loaded once and indexed locally.
 *
 * Recorded here because it is the thing a future engineer will otherwise rediscover.
 */
export const DBPR_SEARCH_CONTRACT = {
  url: 'https://www.myfloridalicense.com/wl11.asp?mode=1&SID=&brd=&typ=',
  method: 'POST' as const,
  searchTypes: ['Name', 'LicNbr', 'City', 'LicTyp'] as const,
  organizationNameField: 'hOrgName',
  licenceNumberField: 'hLicNbr',
  sessionField: 'hSID',
};

/**
 * A DBPR licensee export, parsed by column meaning rather than position.
 *
 * DBPR publishes licensee data files; their exact column headings vary between
 * boards and between releases, so headers are matched on what they mean. A row
 * without a licence number and a name is skipped rather than guessed at -- the same
 * rule the plumbing-board importer follows, for the same reason.
 */
export function parseDbprDataset(content: string): DbprLicence[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = (lines[0]!.match(/\t/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0)
    ? '\t' : ',';
  const splitRow = (line: string): string[] => {
    if (delimiter === '\t') return line.split('\t').map((cell) => cell.trim());
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
    licenseNumber: indexOf('licensenumber', 'licenseno', 'licnbr', 'license'),
    licenseType: indexOf('licensetype', 'lictyp', 'type'),
    rank: indexOf('rank'),
    licenseeName: indexOf('licenseename', 'name'),
    dbaName: indexOf('dbaname', 'dba'),
    businessName: indexOf('businessname', 'orgname', 'organization'),
    qualifyingAgent: indexOf('qualifyingagent', 'qualifier'),
    primaryStatus: indexOf('primarystatus', 'status'),
    secondaryStatus: indexOf('secondarystatus'),
    licensureDate: indexOf('licensuredate', 'originallicensure', 'issued'),
    expires: indexOf('expires', 'expiration'),
    city: indexOf('city'),
    county: indexOf('county'),
  };
  if (columns.licenseNumber === -1 || columns.licenseeName === -1) return [];

  const licences: DbprLicence[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitRow(line);
    const at = (index: number): string | null =>
      index === -1 ? null : (cells[index]?.trim() || null);

    const licenseNumber = at(columns.licenseNumber);
    const licenseeName = at(columns.licenseeName);
    if (!licenseNumber || !licenseeName || !/\d/.test(licenseNumber)) continue;

    licences.push({
      licenseNumber,
      licenseType: at(columns.licenseType) ?? 'Unknown',
      rank: at(columns.rank),
      licenseeName,
      dbaName: at(columns.dbaName),
      businessName: at(columns.businessName),
      qualifyingAgent: at(columns.qualifyingAgent),
      primaryStatus: at(columns.primaryStatus) ?? 'UNKNOWN',
      secondaryStatus: at(columns.secondaryStatus),
      licensureDate: at(columns.licensureDate),
      expiresDate: at(columns.expires),
      city: at(columns.city),
      county: at(columns.county),
      stateRegion: 'FL',
    });
  }
  return licences;
}
