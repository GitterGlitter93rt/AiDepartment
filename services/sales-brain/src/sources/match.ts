import { normalizeCompanyName, normalizeCity, normalizeState, normalizePhone,
  normalizePostalCode, normalizeHostname, registrableDomain } from '../domain/normalize.js';
import type { MatchStatus, SourceLookupContext } from './types.js';

/**
 * Deciding whether an official record is *this* company.
 * Authority: registry hard rule "no identity on name alone".
 *
 * The failure this exists to prevent is quiet and expensive: attaching ACME
 * Plumbing LLC of Miami to ACME Plumbing of Jacksonville, and then showing a rep
 * another company's officers, another company's licence and another company's
 * registered agent as established fact about the prospect in front of them. A wrong
 * officer name is worse than no officer name, because the rep will use it.
 *
 * So a name match is treated as a *candidate*, never as an identification. Something
 * other than the name has to agree before a record is accepted.
 */

/** One official record as the adapter parsed it, before we decide if it is ours. */
export interface MatchCandidate {
  /** The name exactly as the source prints it. */
  name: string;
  reference: string | null;
  city?: string | null;
  stateRegion?: string | null;
  postalCode?: string | null;
  streetAddress?: string | null;
  phones?: string[];
  domain?: string | null;
  /** Any other name the record carries -- DBA, former name, trade name. */
  alternateNames?: string[];
}

/**
 * Collapses records that describe the same entity into one candidate.
 *
 * A licence register returns one row per licence, and a company that holds a
 * Responsible Master Plumber licence and a journeyman licence is one company with two
 * licences -- not two companies competing to be matched. Passing both to `decideMatch`
 * makes it see two equally-corroborated candidates of the same name and correctly
 * refuse to choose, which is the right answer to the wrong question.
 *
 * Same normalized name in the same city and state is one entity. Same name in a
 * *different* city stays two candidates, which is exactly the ambiguity that must
 * survive: two companies of one name in two cities is the case this whole module
 * exists for.
 */
export function distinctByEntity(candidates: MatchCandidate[]): MatchCandidate[] {
  const seen = new Map<string, MatchCandidate>();
  for (const candidate of candidates) {
    const key = [
      normalizeCompanyName(candidate.name),
      normalizeCity(candidate.city)?.toLowerCase() ?? '',
      normalizeState(candidate.stateRegion) ?? '',
    ].join('|');
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, candidate);
      continue;
    }
    // Keep the richer record: more corroborating fields means a better decision.
    const weight = (entry: MatchCandidate): number =>
      [entry.streetAddress, entry.postalCode, entry.domain,
        entry.phones?.length ? 'p' : null].filter(Boolean).length;
    if (weight(candidate) > weight(existing)) seen.set(key, candidate);
  }
  return [...seen.values()];
}

export interface MatchDecision {
  status: Extract<MatchStatus, 'MATCHED' | 'AMBIGUOUS' | 'NO_MATCH'>;
  selected: MatchCandidate | null;
  /** Every candidate whose name matched, with why it was or was not chosen. */
  considered: { name: string; reference: string | null; why: string }[];
  /** What agreed besides the name. Recorded so an acceptance is auditable. */
  matchMethod: string | null;
  reason: string;
}

/**
 * Trade words that do not distinguish one company from another.
 *
 * "Plumbing Services" is not an identity; thousands of entities share it. A name
 * made only of these is never distinctive enough to accept without corroboration,
 * however exactly it matches.
 */
const GENERIC_TOKENS = new Set([
  'plumbing', 'plumbers', 'plumber', 'roofing', 'roofer', 'roofers', 'hvac',
  'heating', 'cooling', 'air', 'conditioning', 'ac', 'electric', 'electrical',
  'services', 'service', 'contractors', 'contracting', 'construction', 'company',
  'group', 'enterprises', 'solutions', 'systems', 'associates', 'brothers',
  'and', 'sons', 'the', 'of', 'repair', 'restoration', 'mechanical', 'law',
  'firm', 'attorneys', 'attorney', 'legal', 'dental', 'dentistry', 'auto', 'body',
  'collision', 'paint', 'garage', 'door', 'doors', 'realty', 'real', 'estate',
  'inc', 'llc', 'corp', 'co',
]);

/**
 * Whether a name carries enough of its own identity to stand with weak support.
 *
 * Distinctive means: at least one token that is not a trade word. "Kowalczyk
 * Plumbing" has one; "Plumbing Services Company" has none.
 */
export function isDistinctiveName(name: string): boolean {
  const tokens = normalizeCompanyName(name).split(' ').filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some((token) => !GENERIC_TOKENS.has(token) && token.length > 2);
}

function namesAgree(a: string, b: string): boolean {
  const left = normalizeCompanyName(a);
  const right = normalizeCompanyName(b);
  return left.length > 0 && left === right;
}

/** Every name a candidate answers to. */
function candidateNames(candidate: MatchCandidate): string[] {
  return [candidate.name, ...(candidate.alternateNames ?? [])].filter(Boolean);
}

export interface Corroboration {
  signals: string[];
  /** A conflicting state or city is disqualifying, not merely unsupportive. */
  conflicts: string[];
}

/**
 * What agrees, and what actively disagrees.
 *
 * Absence is not disagreement: an official record with no phone does not conflict
 * with a company that has one. Only two present-and-different values conflict.
 */
export function corroborate(
  candidate: MatchCandidate, context: SourceLookupContext,
): Corroboration {
  const signals: string[] = [];
  const conflicts: string[] = [];

  const candidateState = normalizeState(candidate.stateRegion);
  const contextState = normalizeState(context.stateRegion);
  if (candidateState && contextState) {
    if (candidateState === contextState) signals.push('state');
    else conflicts.push(`state ${candidateState} != ${contextState}`);
  }

  const candidateCity = normalizeCity(candidate.city);
  const contextCity = normalizeCity(context.city);
  if (candidateCity && contextCity) {
    if (candidateCity.toLowerCase() === contextCity.toLowerCase()) signals.push('city');
    else conflicts.push(`city ${candidateCity} != ${contextCity}`);
  }

  const candidateZip = normalizePostalCode(candidate.postalCode);
  const contextZip = normalizePostalCode(context.postalCode);
  if (candidateZip && contextZip && candidateZip === contextZip) signals.push('postal_code');

  if (candidate.streetAddress && context.streetAddress) {
    const left = candidate.streetAddress.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const right = context.streetAddress.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // Street number plus first word of the street name is enough agreement; full
    // string equality fails on "Ste 4" versus "Suite 4".
    const leftKey = left.split(' ').slice(0, 2).join(' ');
    const rightKey = right.split(' ').slice(0, 2).join(' ');
    if (leftKey && leftKey === rightKey) signals.push('street_address');
  }

  const candidatePhones = new Set(
    (candidate.phones ?? []).map((phone) => normalizePhone(phone)).filter(Boolean) as string[]);
  if (candidatePhones.size > 0) {
    for (const phone of context.knownPhones) {
      const normalized = normalizePhone(phone);
      if (normalized && candidatePhones.has(normalized)) { signals.push('phone'); break; }
    }
  }

  const candidateDomain = normalizeHostname(candidate.domain);
  const contextDomain = normalizeHostname(context.domain);
  if (candidateDomain && contextDomain
    && registrableDomain(candidateDomain) === registrableDomain(contextDomain)) {
    signals.push('domain');
  }

  return { signals, conflicts };
}

/**
 * Picks the one record that is this company, or declines to.
 *
 * The rule, in order:
 *   - a candidate whose state or city actively disagrees is out, however well the
 *     name matches: two companies of the same name in two cities is the normal case,
 *     not the exotic one;
 *   - a name match needs one corroborating signal, unless the name is distinctive
 *     and it is the only candidate in the whole result set;
 *   - two survivors means AMBIGUOUS, and AMBIGUOUS never writes anything.
 */
export function decideMatch(
  candidates: MatchCandidate[], context: SourceLookupContext,
): MatchDecision {
  const considered: MatchDecision['considered'] = [];

  const named = candidates.filter((candidate) =>
    candidateNames(candidate).some((name) => namesAgree(name, context.companyName)));

  if (named.length === 0) {
    return {
      status: 'NO_MATCH', selected: null, matchMethod: null,
      considered: candidates.map((candidate) => ({
        name: candidate.name, reference: candidate.reference,
        why: 'name does not match',
      })),
      reason: candidates.length === 0
        ? 'The source returned no records for this name.'
        : `The source returned ${candidates.length} record(s), none whose name matches.`,
    };
  }

  const accepted: { candidate: MatchCandidate; signals: string[] }[] = [];
  for (const candidate of named) {
    const { signals, conflicts } = corroborate(candidate, context);
    if (conflicts.length > 0) {
      considered.push({
        name: candidate.name, reference: candidate.reference,
        why: `name matches but ${conflicts.join('; ')}`,
      });
      continue;
    }
    if (signals.length > 0) {
      accepted.push({ candidate, signals });
      considered.push({
        name: candidate.name, reference: candidate.reference,
        why: `name matches, corroborated by ${signals.join(', ')}`,
      });
      continue;
    }
    // Name only. Acceptable solely when nothing else in the result set competes and
    // the name carries its own identity.
    if (named.length === 1 && isDistinctiveName(context.companyName)) {
      accepted.push({ candidate, signals: ['distinctive_name_sole_result'] });
      considered.push({
        name: candidate.name, reference: candidate.reference,
        why: 'only record with this name, and the name is distinctive',
      });
      continue;
    }
    considered.push({
      name: candidate.name, reference: candidate.reference,
      why: 'name matches but nothing else corroborates it',
    });
  }

  if (accepted.length === 1) {
    const [only] = accepted;
    return {
      status: 'MATCHED', selected: only!.candidate, considered,
      matchMethod: only!.signals.join('+'),
      reason: `One record matched on name and ${only!.signals.join(', ')}.`,
    };
  }
  if (accepted.length > 1) {
    return {
      status: 'AMBIGUOUS', selected: null, considered, matchMethod: null,
      reason: `${accepted.length} records match this name and cannot be told apart. `
        + 'Nothing was recorded, because attaching the wrong company is worse than '
        + 'attaching none.',
    };
  }
  return {
    status: 'AMBIGUOUS', selected: null, considered, matchMethod: null,
    reason: named.length === 1
      ? 'One record carries this name, but nothing besides the name supports that it '
        + 'is this company.'
      : `${named.length} records carry this name and none is corroborated.`,
  };
}
