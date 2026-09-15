import { stripTags } from '../../resolver/adapters/firstParty.js';
import { tableRows, preBlocks, labelledValue } from '../html.js';
import { relationshipFromTitle } from '../../resolver/roles.js';
import type { PersonObservation } from '../../resolver/types.js';
import type { MatchCandidate } from '../match.js';
import type { OfficialFact } from '../types.js';

/**
 * Texas Comptroller — Franchise Tax Account Status / Taxable Entity Search.
 * Authority: source governance entry `tx_comptroller`.
 *
 * This is the Texas answer to the question Sunbiz answers for Florida -- is this a
 * real entity, may it legally transact -- and it is the answer that costs nothing.
 * The Secretary of State's SOSDirect charges about a dollar a search; the Comptroller
 * publishes the same identity facts free. Nothing in this product may reach for the
 * paid one.
 *
 * "Right to transact business in Texas" is the field a rep actually cares about, and
 * it is not a synonym for "exists": an entity can be on file and have forfeited its
 * right to transact for an unfiled report. That distinction is preserved rather than
 * flattened into active/inactive.
 */

export interface ComptrollerRecord {
  legalName: string;
  taxpayerNumber: string | null;
  sosFileNumber: string | null;
  rightToTransact: string | null;
  entityStatus: string | null;
  stateOfFormation: string | null;
  registrationDate: string | null;
  mailingAddress: ComptrollerAddress | null;
  registeredAgent: string | null;
  registeredOffice: ComptrollerAddress | null;
  /** Officers and directors as a Public Information Report lists them. */
  officers: { name: string; title: string }[];
  reportYear: string | null;
}

export interface ComptrollerAddress {
  street: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
}

function parseAddress(raw: string | null): ComptrollerAddress | null {
  if (!raw) return null;
  const parts = raw.split(/\n|,(?=\s*[A-Z])/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const locality = parts[parts.length - 1]!;
  const match = /^([A-Za-z .'-]+?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(locality);
  if (!match) return { street: parts.join(', '), city: null, stateRegion: null, postalCode: null };
  return {
    street: parts.slice(0, -1).join(', ') || null,
    city: match[1]!.trim(), stateRegion: match[2]!, postalCode: match[3]!,
  };
}

/**
 * Reads a label/value pair out of the status page.
 *
 * The page is a table of label cells and value cells, so the value is whatever
 * follows the label -- on the same line when the markup puts it there, on the next
 * when it does not.
 */
function field(lines: string[], label: RegExp): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!label.test(line)) continue;
    const inline = line.replace(label, '').replace(/^[:\s]+/, '').trim();
    if (inline) return inline;
    const next = lines[index + 1]?.trim();
    // A label immediately followed by another label means this field is empty.
    if (next && !/:$/.test(next)) return next;
    return null;
  }
  return null;
}

export function parseComptrollerStatus(html: string): ComptrollerRecord | null {
  const lines = stripTags(html).split('\n').map((line) => line.trim()).filter(Boolean);
  const rows = tableRows(html);
  // The page is a two-column table; read it as one, and fall back to the flattened
  // text for layouts that are not tabular.
  const read = (label: RegExp): string | null =>
    labelledValue(rows, label) ?? field(lines, label);

  const legalName = read(/^Taxpayer Name\s*:?/i) ?? read(/^Entity Name\s*:?/i);
  if (!legalName) return null;

  return {
    legalName,
    taxpayerNumber: read(/^Taxpayer Number\s*:?/i),
    sosFileNumber: read(/^(?:Texas )?SOS (?:File )?Number\s*:?/i),
    rightToTransact: read(/^Right to Transact Business in Texas\s*:?/i),
    entityStatus: read(/^(?:Taxpayer|Entity) Status\s*:?/i),
    stateOfFormation: read(/^State of Formation\s*:?/i),
    registrationDate: read(/^(?:Effective )?SOS Registration Date\s*:?/i),
    mailingAddress: parseAddress(read(/^Mailing Address\s*:?/i)),
    registeredAgent: read(/^Registered Agent Name\s*:?/i),
    registeredOffice: parseAddress(read(/^Registered Office Street Address\s*:?/i)),
    officers: parseOfficers(html, rows),
    reportYear: read(/^Report Year\s*:?/i),
  };
}

/**
 * Officers and directors, from whichever shape the page uses.
 *
 * A public information report is sometimes a table and sometimes a fixed-width block
 * inside `<pre>`, where column alignment is the only separator -- which is why the
 * `<pre>` text is read with its spacing intact rather than through `stripTags`, which
 * collapses runs of spaces and would merge a name into a title.
 */
function parseOfficers(html: string, rows: string[][]): { name: string; title: string }[] {
  const officers: { name: string; title: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string, title: string): void => {
    const key = `${name}|${title}`.toLowerCase();
    if (!name || !title || seen.has(key)) return;
    if (/^(name|officer|director|title)$/i.test(name)) return;
    seen.add(key);
    officers.push({ name, title });
  };

  for (const block of preBlocks(html)) {
    for (const line of block.split('\n')) {
      const match = /^\s*(\S.*?)\s{2,}(\S.*?)(?:\s{2,}(?:YES|NO)\s*)?$/.exec(line);
      if (match) add(match[1]!.trim(), match[2]!.trim());
    }
  }

  // A table whose header names an officer column.
  for (let index = 0; index < rows.length; index += 1) {
    const header = rows[index]!;
    if (!header.some((cell) => /^name$/i.test(cell))
      || !header.some((cell) => /^title$/i.test(cell))) continue;
    const nameColumn = header.findIndex((cell) => /^name$/i.test(cell));
    const titleColumn = header.findIndex((cell) => /^title$/i.test(cell));
    for (const cells of rows.slice(index + 1)) {
      if (cells.length <= Math.max(nameColumn, titleColumn)) break;
      add(cells[nameColumn]!.trim(), cells[titleColumn]!.trim());
    }
  }
  return officers;
}

/**
 * The Texas taxpayer number is deliberately not persisted as a fact.
 *
 * Same test as the Florida FEI/EIN: public, but a tax identifier no rep will ever
 * use in a conversation, and "public" is not the same test as "necessary". The SOS
 * file number is kept instead -- it identifies the entity, it is what a person would
 * look the company up by, and it is not a tax credential.
 */
export const COMPTROLLER_OMITS_TAXPAYER_NUMBER = true;

export function comptrollerCandidate(record: ComptrollerRecord): MatchCandidate {
  const address = record.registeredOffice ?? record.mailingAddress;
  return {
    name: record.legalName,
    reference: record.sosFileNumber,
    city: address?.city ?? null,
    stateRegion: address?.stateRegion ?? 'TX',
    postalCode: address?.postalCode ?? null,
    streetAddress: address?.street ?? null,
  };
}

export function comptrollerFacts(
  record: ComptrollerRecord, reference: string,
): OfficialFact[] {
  const facts: OfficialFact[] = [];
  const push = (
    claimKey: string, claimText: string, normalizedValue: string | null, ttlDays: number,
  ): void => {
    facts.push({ claimKey, claimText, normalizedValue, canStateAsFact: true,
      confidence: 'confirmed', ttlDays });
  };

  push('legal_entity_name', `Registered in Texas as ${record.legalName}.`,
    record.legalName, 365);
  if (record.sosFileNumber) {
    push('state_entity_number', `Texas SOS file number ${record.sosFileNumber}.`,
      record.sosFileNumber, 3650);
  }
  if (record.rightToTransact) {
    // The field that matters, kept in the state's own words.
    //
    // "ACTIVE" and "FRANCHISE TAX ENDED" are both things the Comptroller says about
    // entities that exist. Collapsing them into a boolean would hide the second,
    // which is the one a rep would want to know about.
    push('entity_right_to_transact',
      `Right to transact business in Texas: ${record.rightToTransact}.`,
      record.rightToTransact.toUpperCase(), 90);
  }
  if (record.entityStatus) {
    push('entity_status', `Texas entity status: ${record.entityStatus}.`,
      record.entityStatus.toUpperCase(), 90);
  }
  if (record.stateOfFormation) {
    push('entity_state_of_formation', `Formed in ${record.stateOfFormation}.`,
      record.stateOfFormation, 3650);
  }
  if (record.registrationDate) {
    push('entity_filed_date',
      `Registered with the Texas Secretary of State on ${record.registrationDate}.`,
      record.registrationDate, 3650);
  }
  if (record.registeredOffice?.street) {
    const address = [record.registeredOffice.street, record.registeredOffice.city,
      record.registeredOffice.stateRegion, record.registeredOffice.postalCode]
      .filter(Boolean).join(', ');
    push('registered_principal_address',
      `Registered office address on file with the state: ${address}.`, address, 365);
  }
  if (record.reportYear) {
    push('last_public_information_report',
      `Most recent Texas public information report: ${record.reportYear}.`,
      record.reportYear, 180);
  }
  if (record.registeredAgent) {
    facts.push({
      claimKey: 'registered_agent_name',
      claimText: `${record.registeredAgent} is the registered agent on the Texas record. `
        + 'A registered agent receives legal service of process and is often a lawyer '
        + 'or an agent service rather than anyone who works at the company.',
      normalizedValue: record.registeredAgent,
      canStateAsFact: true, confidence: 'confirmed', ttlDays: 365,
    });
  }
  facts.push({
    claimKey: 'official_registry_source',
    claimText: `Verified against the Texas Comptroller record ${reference}.`,
    normalizedValue: reference, canStateAsFact: true, confidence: 'confirmed', ttlDays: 90,
  });
  return facts;
}

/**
 * Officers and directors from a public information report, at their real roles.
 *
 * A Texas PIR lists officers and directors. It does not list owners, and it does not
 * say which of them runs anything. Each person keeps the title the report gives, and
 * the relationship mapper is not allowed to invent seniority the filing never stated.
 */
export function comptrollerPeople(
  record: ComptrollerRecord, reference: string,
): PersonObservation[] {
  const observedAt = new Date();
  const people: PersonObservation[] = record.officers.map((officer) => ({
    personName: officer.name,
    rawTitle: officer.title,
    relationship: relationshipFromTitle(officer.title) ?? 'OFFICER',
    sourceClass: 'PUBLIC_COMPANY_REGISTRY' as const,
    sourceReference: reference,
    observedAt,
    freshness: 'FRESH' as const,
    scope: 'ACCOUNT' as const,
    notes: `Listed on the Texas public information report as ${officer.title}`
      + `${record.reportYear ? ` (report year ${record.reportYear})` : ''}.`,
  }));

  if (record.registeredAgent) {
    people.push({
      personName: record.registeredAgent,
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
