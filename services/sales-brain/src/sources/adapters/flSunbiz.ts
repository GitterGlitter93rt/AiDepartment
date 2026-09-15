import { stripTags } from '../../resolver/adapters/firstParty.js';
import { relationshipFromTitle } from '../../resolver/roles.js';
import type { PersonObservation } from '../../resolver/types.js';
import type { MatchCandidate } from '../match.js';
import type { OfficialFact } from '../types.js';

/**
 * Florida Division of Corporations (Sunbiz) — parser.
 * Authority: source governance entry `fl_sunbiz`.
 *
 * Live automation is OFF: Sunbiz answered an identified research user-agent with
 * HTTP 403 during development, and that is an access control rather than an
 * obstacle. The parser, the identity rules and the persistence below are complete
 * and exercised against sanitized fixtures, so the day access is arranged the only
 * thing that changes is where the HTML comes from.
 *
 * What this file is careful about is roles. A Sunbiz record names a registered agent
 * and it names authorised persons, and they are different kinds of fact: the agent
 * is a service-of-process address, very often the company's lawyer or a commercial
 * agent firm, and calling that person the owner would put a rep on the phone to
 * someone who has never worked there.
 */

export interface SunbizRecord {
  legalName: string;
  documentNumber: string | null;
  status: string | null;
  filedDate: string | null;
  stateOfFormation: string | null;
  entityType: string | null;
  principalAddress: SunbizAddress | null;
  mailingAddress: SunbizAddress | null;
  registeredAgent: { name: string; address: SunbizAddress | null } | null;
  authorizedPersons: { name: string; title: string; address: SunbizAddress | null }[];
  lastAnnualReportYear: string | null;
  priorNames: string[];
}

export interface SunbizAddress {
  street: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
}

/**
 * Sunbiz title codes.
 *
 * The record prints these as abbreviations, and the abbreviation is the whole
 * meaning: MGR is a manager of an LLC, AMBR is an authorised member, and "RA" is a
 * registered agent who may be nobody at the company at all. Expanded here so the
 * relationship mapper sees a title it can reason about rather than two letters.
 */
const TITLE_CODES: Record<string, string> = {
  MGR: 'Manager', MGRM: 'Managing Member', AMBR: 'Authorized Member',
  MBR: 'Member', P: 'President', VP: 'Vice President', S: 'Secretary',
  T: 'Treasurer', D: 'Director', CEO: 'Chief Executive Officer',
  CFO: 'Chief Financial Officer', COO: 'Chief Operating Officer',
  V: 'Vice President', SD: 'Secretary, Director', PD: 'President, Director',
  TD: 'Treasurer, Director', VD: 'Vice President, Director', RA: 'Registered Agent',
  GP: 'General Partner', LP: 'Limited Partner', TRUST: 'Trustee',
};

export function expandSunbizTitle(raw: string): string {
  const token = raw.trim().toUpperCase().replace(/[.\s]/g, '');
  return TITLE_CODES[token] ?? raw.trim();
}

function parseAddress(lines: string[]): SunbizAddress | null {
  const cleaned = lines.map((line) => line.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  // Last line that looks like "CITY FL 32095" or "CITY, FL 32095".
  const lastIndex = cleaned.findIndex((line) =>
    /^[A-Za-z .'-]+,?\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(line));
  if (lastIndex === -1) {
    return { street: cleaned.join(', '), city: null, stateRegion: null, postalCode: null };
  }
  const locality = cleaned[lastIndex]!;
  const match = /^([A-Za-z .'-]+?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(locality);
  return {
    street: cleaned.slice(0, lastIndex).join(', ') || null,
    city: match?.[1]?.trim() ?? null,
    stateRegion: match?.[2] ?? null,
    postalCode: match?.[3] ?? null,
  };
}

/** Section text between one heading and the next. */
function sectionAfter(lines: string[], heading: RegExp, stopAt: RegExp[]): string[] {
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return [];
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (stopAt.some((stop) => stop.test(line))) break;
    body.push(line);
  }
  return body;
}

const SECTION_HEADINGS = [
  /^Filing Information$/i, /^Principal Address$/i, /^Mailing Address$/i,
  /^Registered Agent Name & Address$/i, /^Authorized Person\(s\) Detail$/i,
  /^Officer\/Director Detail$/i, /^Annual Reports$/i, /^Document Images$/i,
  /^Name Changed:/i, /^Address Changed:/i, /^Previous On File/i, /^Name History$/i,
];

/**
 * Parses a Sunbiz entity detail page.
 *
 * Returns null rather than a half-built record when the page is not a detail page:
 * a search-results page, an error page and a detail page all return 200, and
 * guessing at which one this is produces a company whose name is a table header.
 */
export function parseSunbizDetail(html: string): SunbizRecord | null {
  const text = stripTags(html);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  const filingIndex = lines.findIndex((line) => /^Filing Information$/i.test(line));
  if (filingIndex === -1) return null;

  // The entity name is the line above "Filing Information", after the type heading.
  const entityType = lines.slice(0, filingIndex).reverse()
    .find((line) => /(Limited Liability Company|Corporation|Partnership|Company)/i.test(line)
      && line.length < 80) ?? null;
  const legalName = lines[filingIndex - 1] ?? null;
  if (!legalName) return null;

  const field = (label: RegExp): string | null => {
    const index = lines.findIndex((line) => label.test(line));
    if (index === -1) return null;
    const inline = lines[index]!.replace(label, '').trim();
    if (inline) return inline;
    return lines[index + 1]?.trim() ?? null;
  };

  const principal = parseAddress(sectionAfter(lines, /^Principal Address$/i, SECTION_HEADINGS));
  const mailing = parseAddress(sectionAfter(lines, /^Mailing Address$/i, SECTION_HEADINGS));

  const agentLines = sectionAfter(lines, /^Registered Agent Name & Address$/i, SECTION_HEADINGS);
  const registeredAgent = agentLines.length > 0
    ? { name: agentLines[0]!, address: parseAddress(agentLines.slice(1)) }
    : null;

  const personLines = [
    ...sectionAfter(lines, /^Authorized Person\(s\) Detail$/i, SECTION_HEADINGS),
    ...sectionAfter(lines, /^Officer\/Director Detail$/i, SECTION_HEADINGS),
  ];
  const authorizedPersons: SunbizRecord['authorizedPersons'] = [];
  for (let index = 0; index < personLines.length; index += 1) {
    const line = personLines[index]!;
    // "Title MGR" / "Title MGRM" introduces the person named on the next line.
    const titleMatch = /^Title\s+(.+)$/i.exec(line);
    if (!titleMatch) continue;
    const name = personLines[index + 1];
    if (!name || /^Title\s+/i.test(name)) continue;
    const addressLines: string[] = [];
    for (let after = index + 2; after < personLines.length; after += 1) {
      if (/^Title\s+/i.test(personLines[after]!)) break;
      addressLines.push(personLines[after]!);
    }
    authorizedPersons.push({
      name, title: expandSunbizTitle(titleMatch[1]!), address: parseAddress(addressLines),
    });
  }

  const reportYears = lines
    .filter((line) => /^(19|20)\d{2}$/.test(line))
    .map((line) => Number(line))
    .filter((year) => year >= 1990 && year <= new Date().getFullYear() + 1);

  return {
    legalName,
    documentNumber: field(/^Document Number\s*:?\s*/i),
    status: field(/^Status\s*:?\s*/i),
    filedDate: field(/^Date Filed\s*:?\s*/i),
    stateOfFormation: field(/^State\s*:?\s*/i),
    entityType,
    principalAddress: principal,
    mailingAddress: mailing,
    registeredAgent,
    authorizedPersons,
    lastAnnualReportYear: reportYears.length > 0 ? String(Math.max(...reportYears)) : null,
    priorNames: sectionAfter(lines, /^Previous On File/i, SECTION_HEADINGS).slice(0, 5),
  };
}

/**
 * FEI/EIN is deliberately not returned.
 *
 * Sunbiz prints it, so it is public, but it is a federal tax identifier with no use
 * whatsoever in a sales conversation -- a rep will never open a call with it -- while
 * carrying real consequences if this database is ever mishandled. "Public" is not the
 * same test as "necessary", and it fails the second one. Parsed past rather than
 * stored.
 */
export const SUNBIZ_OMITS_FEI_EIN = true;

/** The record as a match candidate, with every name it answers to. */
export function sunbizCandidate(record: SunbizRecord): MatchCandidate {
  return {
    name: record.legalName,
    reference: record.documentNumber,
    city: record.principalAddress?.city ?? null,
    stateRegion: record.principalAddress?.stateRegion ?? null,
    postalCode: record.principalAddress?.postalCode ?? null,
    streetAddress: record.principalAddress?.street ?? null,
    alternateNames: record.priorNames,
  };
}

export function sunbizFacts(record: SunbizRecord, reference: string): OfficialFact[] {
  const facts: OfficialFact[] = [];
  const push = (
    claimKey: string, claimText: string, normalizedValue: string | null, ttlDays: number,
  ): void => {
    facts.push({ claimKey, claimText, normalizedValue, canStateAsFact: true,
      confidence: 'confirmed', ttlDays });
  };

  push('legal_entity_name', `Registered in Florida as ${record.legalName}.`,
    record.legalName, 365);
  if (record.documentNumber) {
    push('state_entity_number',
      `Florida document number ${record.documentNumber}.`, record.documentNumber, 3650);
  }
  if (record.status) {
    // Status is the one field that changes without anyone being told, so it ages
    // fastest. An "ACTIVE" read two years ago is not evidence of anything today.
    push('entity_status', `Florida entity status: ${record.status}.`,
      record.status.toUpperCase(), 90);
  }
  if (record.filedDate) {
    // A filing date is the one fact here that can never change.
    push('entity_filed_date', `Filed with the Florida Division of Corporations on ${record.filedDate}.`,
      record.filedDate, 3650);
  }
  if (record.entityType) {
    push('entity_type', `Florida entity type: ${record.entityType}.`, record.entityType, 3650);
  }
  if (record.principalAddress?.street) {
    const address = [record.principalAddress.street, record.principalAddress.city,
      record.principalAddress.stateRegion, record.principalAddress.postalCode]
      .filter(Boolean).join(', ');
    push('registered_principal_address', `Principal address on file with the state: ${address}.`,
      address, 365);
  }
  if (record.lastAnnualReportYear) {
    push('last_annual_report_year',
      `Most recent Florida annual report on file: ${record.lastAnnualReportYear}.`,
      record.lastAnnualReportYear, 180);
  }
  if (record.registeredAgent) {
    // Recorded as what it is. The claim text says "registered agent" in words so the
    // sentence cannot be read as ownership even out of context.
    facts.push({
      claimKey: 'registered_agent_name',
      claimText: `${record.registeredAgent.name} is the registered agent on the Florida `
        + 'filing. A registered agent receives legal service of process and is often a '
        + 'lawyer or an agent service rather than anyone who works at the company.',
      normalizedValue: record.registeredAgent.name,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 365,
    });
  }
  facts.push({
    claimKey: 'official_registry_source',
    claimText: `Verified against the Florida Division of Corporations record ${reference}.`,
    normalizedValue: reference, canStateAsFact: true, confidence: 'confirmed', ttlDays: 90,
  });
  return facts;
}

/**
 * The people on the filing, each kept at the role the filing gives them.
 *
 * The registered agent is included because knowing who it is has real value, and
 * excluded from ever being a sales target by its relationship class: the resolver
 * already refuses to promote REGISTERED_AGENT, so the safest thing is to hand it
 * over honestly labelled rather than to drop it.
 */
export function sunbizPeople(record: SunbizRecord, reference: string): PersonObservation[] {
  const observedAt = new Date();
  const people: PersonObservation[] = [];

  for (const person of record.authorizedPersons) {
    people.push({
      personName: person.name,
      rawTitle: person.title,
      // The filing's own word for the role, mapped without promotion. A manager of an
      // LLC is a manager; nothing here decides they own it.
      relationship: relationshipFromTitle(person.title) ?? 'OFFICER',
      sourceClass: 'PUBLIC_COMPANY_REGISTRY',
      sourceReference: reference,
      observedAt,
      freshness: 'FRESH',
      scope: 'ACCOUNT',
      notes: `Listed on the Florida filing as ${person.title}.`,
    });
  }

  if (record.registeredAgent) {
    people.push({
      personName: record.registeredAgent.name,
      rawTitle: 'Registered Agent',
      relationship: 'REGISTERED_AGENT',
      sourceClass: 'PUBLIC_COMPANY_REGISTRY',
      sourceReference: reference,
      observedAt,
      freshness: 'FRESH',
      scope: 'ACCOUNT',
      notes: 'Registered agent for service of process. Not evidence of employment, '
        + 'ownership or any operational role.',
    });
  }
  return people;
}
