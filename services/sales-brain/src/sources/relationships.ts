import type { Queryable } from '../db/pool.js';
import { normalizeCompanyName, normalizePhone } from '../domain/normalize.js';

/**
 * Companies that share something, and what that does and does not mean.
 *
 * The case this is built around is real and is the shape of the whole problem:
 *
 *   SUNBRIGHT HVAC LLC holds a Florida certified air-conditioning licence. The public
 *   record names the person who qualifies it. A public contractor profile lists that
 *   same person, at that same street address, for MR AC OF ORLANDO INC, together with
 *   a phone number.
 *
 * Four wrong conclusions are available from those facts, and a system that draws any
 * of them puts a rep in front of a company saying something untrue:
 *
 *   * that the two companies are one company. They are two entities with two filings.
 *   * that the qualifier owns either of them. Qualifying a licence is a regulatory
 *     role; it says the state accepted him as technically responsible, and nothing
 *     about who holds the equity.
 *   * that the other company's published phone reaches this company. It is a phone
 *     number belonging to a related business, and that is all it is.
 *   * that a shared address alone links them. An address alone is a business park.
 *
 * So what is recorded is the link and its basis, and every promotion is refused here
 * rather than left to the caller's judgement.
 */

/** Signals that can contribute to a link, weakest first. */
export type LinkageSignal =
  | 'same_exact_person'
  | 'same_street_address'
  | 'same_license_number'
  | 'same_phone'
  | 'same_email'
  | 'same_legal_entity'
  | 'same_dba'
  | 'same_domain';

/**
 * Signals that establish nothing on their own.
 *
 * An address is shared by every tenant of a building. A common person's name is shared
 * by strangers. Both are useful only in combination -- which is the rule the database
 * also enforces, because a caller that forgets it writes a wrong link silently.
 */
const WEAK_ALONE: ReadonlySet<LinkageSignal> = new Set<LinkageSignal>([
  'same_street_address', 'same_exact_person',
]);

/** Signals precise enough to identify one entity by themselves. */
const STRONG_ALONE: ReadonlySet<LinkageSignal> = new Set<LinkageSignal>([
  'same_license_number', 'same_legal_entity',
]);

export type RelationshipType =
  | 'RELATED_BUSINESS'
  | 'HISTORICAL_BUSINESS_ASSOCIATION'
  | 'SHARED_LICENSE_QUALIFIER'
  | 'SHARED_OFFICER'
  | 'SHARED_REGISTERED_AGENT'
  | 'PREDECESSOR_ENTITY'
  | 'SUCCESSOR_ENTITY'
  | 'PARENT_ENTITY'
  | 'SUBSIDIARY_ENTITY';

export interface LinkageDecision {
  linked: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  basis: string;
  reason: string;
}

/**
 * Whether what agreed is enough to say two companies are related.
 *
 * Not whether they are the same company. Nothing in this file can conclude that.
 */
export function decideLinkage(signals: LinkageSignal[]): LinkageDecision {
  const unique = [...new Set(signals)];
  const basis = unique.join('+');

  if (unique.length === 0) {
    return { linked: false, confidence: 'LOW', basis: '', reason: 'Nothing agreed.' };
  }

  if (unique.length === 1) {
    const only = unique[0]!;
    if (STRONG_ALONE.has(only)) {
      return {
        linked: true, confidence: 'MEDIUM', basis: `${only}+sole_identifier`,
        reason: `${only.replace(/_/g, ' ')} identifies one entity, so the link stands on it alone.`,
      };
    }
    return {
      linked: false, confidence: 'LOW', basis,
      reason: WEAK_ALONE.has(only)
        ? `${only.replace(/_/g, ' ')} alone is not a link: a building has many tenants and a `
          + 'name has many bearers.'
        : `${only.replace(/_/g, ' ')} alone is not enough to link two companies.`,
    };
  }

  // Two independent things agreeing is the working definition of a link here. A person
  // and an address together is the Sunbright case; a person and a licence number is
  // stronger still.
  const strong = unique.some((signal) => STRONG_ALONE.has(signal));
  return {
    linked: true,
    confidence: strong || unique.length >= 3 ? 'HIGH' : 'MEDIUM',
    basis,
    reason: `${unique.length} independent signals agree: ${unique.join(', ')}.`,
  };
}

export interface RelationshipInput {
  accountId: string;
  relatedAccountId?: string | null;
  relatedName: string;
  relationshipType: RelationshipType;
  signals: LinkageSignal[];
  evidenceId?: string | null;
  sourceReference?: string | null;
  notes?: string | null;
  observedAt?: Date;
}

export interface RelationshipWriteResult {
  written: boolean;
  reason: string;
  confidence: LinkageDecision['confidence'];
}

/**
 * Records a relationship, or refuses to and says why.
 *
 * Refusal is the normal outcome for a single shared signal, and it is reported rather
 * than swallowed: "we looked and what we found was not enough" is a different state
 * from "we did not look", and an operator reading the account needs the difference.
 */
export async function recordAccountRelationship(
  client: Queryable, input: RelationshipInput,
): Promise<RelationshipWriteResult> {
  const decision = decideLinkage(input.signals);
  if (!decision.linked) {
    return { written: false, reason: decision.reason, confidence: decision.confidence };
  }
  if (input.relatedAccountId && input.relatedAccountId === input.accountId) {
    return {
      written: false, confidence: 'LOW',
      reason: 'A company is not related to itself; this is a merge question, not a link.',
    };
  }

  const observedAt = input.observedAt ?? new Date();
  await client.query(
    `insert into account_relationships
       (account_id, related_account_id, related_name, relationship_type, basis,
        confidence, evidence_id, source_reference, first_observed_at, last_verified_at, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)
     on conflict (account_id, related_name, relationship_type) do update
        set last_verified_at = excluded.last_verified_at,
            -- A later look that found more is an upgrade; one that found less is not a
            -- downgrade, because the earlier evidence did not stop being true.
            basis = case when length(excluded.basis) > length(account_relationships.basis)
                         then excluded.basis else account_relationships.basis end,
            confidence = case when excluded.confidence = 'HIGH' then 'HIGH'
                              else account_relationships.confidence end,
            related_account_id = coalesce(account_relationships.related_account_id,
                                          excluded.related_account_id),
            evidence_id = coalesce(account_relationships.evidence_id, excluded.evidence_id)`,
    [input.accountId, input.relatedAccountId ?? null, input.relatedName.trim(),
     input.relationshipType, decision.basis, decision.confidence,
     input.evidenceId ?? null, input.sourceReference ?? null, observedAt,
     input.notes ?? null],
  );
  return { written: true, reason: decision.reason, confidence: decision.confidence };
}

/**
 * What a phone number found on a related business is, and is not.
 *
 * It is a public number associated with a company linked to this one. It is not this
 * company's main line, it is not the linked person's direct line, and it is not
 * current until somebody has dialled it. The endpoint role says so in its own name so
 * that no screen has to remember the caveat.
 */
export const RELATED_BUSINESS_PHONE_ROLE = 'RELATED_BUSINESS_PHONE';

export interface RelatedPhoneEvidence {
  e164: string;
  relatedName: string;
  sourceReference: string | null;
}

/** The sentence a rep reads next to such a number. Never an implied permission. */
export function relatedPhoneCaption(evidence: RelatedPhoneEvidence): string {
  return `Public phone associated with ${evidence.relatedName} — a related business. `
    + 'Verify it is current and reaches this company before relying on it.';
}

/** Normalizes a phone for comparison, so a formatting difference is not a new number. */
export function samePhone(left: string | null, right: string | null): boolean {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  return !!a && !!b && a === b;
}

/** Two companies are the same legal entity only when their legal names agree exactly. */
export function sameLegalEntity(left: string, right: string): boolean {
  const a = normalizeCompanyName(left);
  const b = normalizeCompanyName(right);
  return a.length > 0 && a === b;
}

/**
 * Roles that are never read as ownership, whatever else is true.
 *
 * Each of these establishes that a person is connected to a company and stops there.
 * The list is here rather than at the call sites because the call sites are where it
 * gets forgotten: a qualifier appears on a licence, an agent on a filing, and both
 * read like "the person in charge" to anybody who has not been told otherwise.
 */
export const NEVER_OWNERSHIP: ReadonlySet<string> = new Set([
  'QUALIFIER', 'LICENSE_HOLDER', 'REGISTERED_AGENT', 'OFFICER', 'MEMBER',
]);

/** True when the evidence supports calling somebody an owner. Filings rarely do. */
export function ownershipEstablished(input: {
  relationship: string;
  /** The exact words the source used, e.g. "Managing Member", "Owner". */
  rawTitle: string | null;
}): boolean {
  if (NEVER_OWNERSHIP.has(input.relationship)) return false;
  if (input.relationship === 'OWNER' || input.relationship === 'FOUNDER') return true;
  // "Owner" written on the company's own About page is the company saying it. A title
  // inferred from a filing's role code is not, which is why the raw words are kept.
  return /\bowner\b|\bproprietor\b/i.test(input.rawTitle ?? '');
}
