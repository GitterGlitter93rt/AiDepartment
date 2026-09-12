import { query } from '../db/pool.js';
import { classifyObservation, mayPromote, registrableDomain } from './sourceClass.js';

/**
 * May facts read from this domain be recorded as facts about this business?
 *
 * The live contamination: `Precision Roofing of North Florida Inc` was discovered
 * through `freeroofquote.com`, a lead-generation directory, and research then crawled
 * the directory as the contractor's own site. It attributed the directory's phone
 * number, its financing copy, storm-service text belonging to a different roofer and
 * the directory's quote form to the contractor. Every stage worked. It was researching
 * the wrong entity.
 *
 * Entity resolution now stops a directory becoming an Account at all, which closes
 * that path at the source. This is the second lock: even if a directory domain is
 * attached to an Account by an import, a merge, a manual edit or a future provider,
 * research refuses to read it rather than guessing.
 */

export interface AttributionDecision {
  allowed: boolean;
  /** Operator-readable, bounded, safe to store and render. */
  reason: string;
}

/** Entity states whose Accounts are not established enough to research as a prospect. */
const UNRESEARCHABLE: ReadonlySet<string> = new Set([
  'rejected', 'quarantined', 'needs_review',
]);

/**
 * What discovery already worked out about this domain.
 *
 * The structural rule that catches an unknown directory -- one domain carrying several
 * different businesses -- needs a whole result set, and research has one bare domain.
 * So the verdict is looked up rather than recomputed: a domain discovery has already
 * refused stays refused, and the system only has to learn each directory once.
 *
 * This is what makes `freeroofquote.com` safe without it ever being named in code.
 */
export async function priorRejection(domain: string | null): Promise<string | null> {
  const identity = registrableDomain(domain);
  if (!identity) return null;
  const { rows } = await query<{ source_class: string; reasons: string[] }>(
    `select source_class, reasons from discovery_candidates
      where identity = $1 and entity_status = 'REJECTED'
      order by created_at desc limit 1`,
    [identity],
  ).catch(() => ({ rows: [] as { source_class: string; reasons: string[] }[] }));
  const found = rows[0];
  if (!found) return null;
  return found.reasons[0] ?? `previously classified as ${found.source_class}`;
}

export async function mayResearchDomainWithHistory(input: {
  domain: string | null; entityStatus: string | null;
}): Promise<AttributionDecision> {
  const immediate = mayResearchDomain(input);
  if (!immediate.allowed) return immediate;
  const prior = await priorRejection(input.domain);
  if (prior) {
    return {
      allowed: false,
      reason: `${registrableDomain(input.domain)} was refused as a business when it was `
        + `discovered -- ${prior} -- so what it says describes somebody else.`,
    };
  }
  return immediate;
}

export function mayResearchDomain(input: {
  domain: string | null;
  entityStatus: string | null;
}): AttributionDecision {
  const entityStatus = (input.entityStatus ?? 'legacy_unverified').toLowerCase();
  if (UNRESEARCHABLE.has(entityStatus)) {
    return {
      allowed: false,
      reason: `this company's identity is ${entityStatus.replace(/_/g, ' ')}, so anything `
        + 'read from a website could not be attributed to it with confidence',
    };
  }

  const domain = (input.domain ?? '').trim();
  if (!domain) return { allowed: false, reason: 'no website on record' };

  // The same reading the discovery classifier makes, asked of a bare domain. A
  // directory is a directory whether it arrived from a SERP row or from an import.
  const classified = classifyObservation({
    resultType: 'ORGANIC', observedName: null, observedDomain: domain,
    observedPhone: null, observedLocation: null,
    landingUrl: `https://${domain.replace(/^https?:\/\//, '')}/`,
  });

  if (!mayPromote(classified.sourceClass)) {
    return {
      allowed: false,
      reason: `${domain} is ${classified.reasons[0] ?? 'not this company’s own site'}, so `
        + 'what it says describes somebody else. Reading it here would put another '
        + 'organisation’s phone number, staff and claims on this company’s record.',
    };
  }

  return { allowed: true, reason: 'the company’s own site' };
}
