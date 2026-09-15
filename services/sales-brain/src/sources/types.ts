import type { PersonObservation, EndpointObservation } from '../resolver/types.js';

/**
 * Official public-source enrichment.
 * Authority: outbound-sales-brain-public-contact-source-registry.v1.yaml,
 * public-decision-maker-resolution-spec.md §5 Stages B and C.
 *
 * These adapters answer two questions the company's own website cannot: is this a
 * real registered entity, and is it licensed where the state requires one. Both are
 * questions about *identity*, which is why the contract below is mostly about
 * saying "I am not sure" precisely rather than about returning data.
 */

/**
 * What a lookup concluded.
 *
 * Six outcomes rather than a record-or-null, because collapsing them is how a read
 * model starts lying. "The state does not license this trade" and "we searched and
 * found nothing" both produce no licence, and they mean opposite things to a rep:
 * the first is a non-question, the second is a finding worth acting on.
 */
export type MatchStatus =
  /** One record, corroborated by more than the name. */
  | 'MATCHED'
  /** Plausible candidates, none decisively this company. Never overwrites truth. */
  | 'AMBIGUOUS'
  /** The source answered and has no such record. This is a finding. */
  | 'NO_MATCH'
  /** The source could not be reached or refused us. Says nothing about the company. */
  | 'SOURCE_UNAVAILABLE'
  /** This state does not issue a statewide licence for this trade. Not a gap. */
  | 'NOT_APPLICABLE_STATEWIDE'
  /** Public automation is not authorised for this source (paid, CAPTCHA, login). */
  | 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS';

/** Statuses that must never be shown to a rep as a negative finding. */
export const NON_FINDING_STATUSES: ReadonlySet<MatchStatus> = new Set<MatchStatus>([
  'SOURCE_UNAVAILABLE',
  'NOT_APPLICABLE_STATEWIDE',
  'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS',
]);

export type SourceAvailability =
  /** Wired, governed, and permitted to run automatically. */
  | 'LIVE'
  /** Implemented and tested, live calls behind an explicit flag. */
  | 'FEATURE_FLAGGED'
  /** The source blocks automation (403, CAPTCHA, login). Fixtures only. */
  | 'BLOCKED'
  /** Costs money per query. Never called. */
  | 'DISABLED_PAID_SOURCE';

/**
 * One official fact, with everything needed to show and age it.
 *
 * `claimKey` lands in `evidence_records.claim_key`, so the fact model and the
 * Account page read official records through the same path as everything else.
 */
export interface OfficialFact {
  claimKey: string;
  claimText: string;
  normalizedValue?: string | null;
  /**
   * Whether a rep may state this as fact.
   *
   * True only for what the official record itself asserts. A derivation from it is
   * an observation, and a guess is neither.
   */
  canStateAsFact: boolean;
  confidence: 'confirmed' | 'likely' | 'unknown';
  /** How long before this needs re-verifying. Registry status changes silently. */
  ttlDays: number;
}

/** What an adapter returns. Observations, never conclusions. */
export interface SourceLookupResult {
  sourceId: string;
  status: MatchStatus;
  /** Why the adapter concluded what it did, in words a reviewer can check. */
  reason: string;
  /** The official page/record this came from. */
  sourceReference: string | null;
  capturedAt: Date;
  /** How identity was established. Recorded so an ambiguous match is auditable. */
  matchMethod?: string | null;
  facts: OfficialFact[];
  people: PersonObservation[];
  endpoints: EndpointObservation[];
  /** Candidates considered but not selected, kept for operator review. */
  candidates?: { name: string; reference: string | null; why: string }[];
  /** Set when the adapter read a cached dataset rather than the live source. */
  fromSnapshot?: { snapshotId: string; downloadedAt: Date; sourceGeneratedAt: Date | null } | null;
}

/** What the adapter is told about the company it is looking up. */
export interface SourceLookupContext {
  accountId: string;
  companyName: string;
  /** Normalized state code, when known. Adapters are state-scoped. */
  stateRegion: string | null;
  city: string | null;
  postalCode: string | null;
  /** The verified first-party domain, when one is attributed. */
  domain: string | null;
  verticalProfileId: string | null;
  /** Phones already believed to belong to this company, for corroboration. */
  knownPhones: string[];
  /** Street address already believed, for corroboration. */
  streetAddress: string | null;
}

export interface SourceAdapter {
  /** Stable id used in evidence, governance config and operator reporting. */
  id: string;
  /** Human name for the rep-facing UI. */
  displayName: string;
  /** Which resolver source class this maps to. */
  sourceClass: 'PUBLIC_COMPANY_REGISTRY' | 'PUBLIC_LICENSE_REGISTRY';
  /** Which research stage this belongs to. */
  stage: 'B_public_company_registry' | 'C_public_license_registry';
  /** The state this source covers, or null for multi-state. */
  stateRegion: string | null;
  availability(): SourceAvailability;
  /** Whether this adapter has anything to say about this company at all. */
  supports(context: SourceLookupContext): boolean;
  lookup(context: SourceLookupContext): Promise<SourceLookupResult>;
  /** Hard ceiling per lookup, so one slow source cannot hold a research run open. */
  timeoutMs: number;
}

/** A result that says nothing, for the many paths that legitimately say nothing. */
export function emptyResult(
  sourceId: string, status: MatchStatus, reason: string,
): SourceLookupResult {
  return {
    sourceId, status, reason, sourceReference: null, capturedAt: new Date(),
    facts: [], people: [], endpoints: [],
  };
}
