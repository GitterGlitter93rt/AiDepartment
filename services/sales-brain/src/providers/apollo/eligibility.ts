import { judgeDomain } from '../../domain/domainValidity.js';
import { isRoleMailbox } from '../../resolver/attribution.js';
import { numeric } from '../../config.js';

/**
 * Whether an Account is worth an Apollo credit yet.
 *
 * Apollo runs last. The waterfall is company discovery, entity resolution, first-party
 * research, public-web enrichment, reconciliation — and only then, for whatever is still
 * missing, a paid provider. That ordering is not politeness: the 2026-09-17 audit found a
 * named owner's own email published on the company's own contact page, which Apollo would
 * have been paid to tell us.
 *
 * So this answers two questions and keeps them apart. Is this a real business we could
 * sell to, and is there anything left that Apollo could add? A no to either is a credit
 * not spent.
 */

export type ApolloEligibility =
  | 'NOT_ELIGIBLE_BAD_ENTITY'
  | 'NOT_ELIGIBLE_SUPPRESSED'
  | 'NOT_ELIGIBLE_ALREADY_COMPLETE'
  | 'NOT_ELIGIBLE_RECENTLY_CHECKED'
  | 'NOT_ELIGIBLE_IDENTITY_WEAK'
  | 'ELIGIBLE_MISSING_DECISION_MAKER'
  | 'ELIGIBLE_MISSING_PERSON_ROUTE'
  | 'ELIGIBLE_STALE_CONTACT'
  | 'ELIGIBLE_IDENTITY_CHANGED'
  | 'ELIGIBLE_MANUAL_REFRESH';

const ELIGIBLE: ReadonlySet<ApolloEligibility> = new Set<ApolloEligibility>([
  'ELIGIBLE_MISSING_DECISION_MAKER', 'ELIGIBLE_MISSING_PERSON_ROUTE',
  'ELIGIBLE_STALE_CONTACT', 'ELIGIBLE_IDENTITY_CHANGED', 'ELIGIBLE_MANUAL_REFRESH',
]);

export function isEligible(verdict: ApolloEligibility): boolean { return ELIGIBLE.has(verdict); }

/** Source roles that are never a business we can sell to, whatever else is true. */
const NOT_A_TARGET_BUSINESS = new Set([
  'DIRECTORY', 'LEAD_GEN_DIRECTORY', 'NEWS_OR_PUBLISHER', 'GOVERNMENT',
  'LICENSING_DATABASE', 'MARKETPLACE', 'AGGREGATOR', 'PRODUCT_PAGE',
  'MANUFACTURER_LOCATOR', 'VIDEO', 'FORUM',
]);

export interface ApolloEligibilityInput {
  accountId: string;
  companyName: string;
  canonicalDomain: string | null;
  entityStatus: string;
  isSuppressed: boolean;
  /** The evidence-based role, where discovery recorded one. */
  sourceRole?: string | null;
  /** Independently verified company phone or address, for the no-domain path. */
  verifiedPhone?: string | null;
  verifiedAddress?: string | null;
  /** A provider business listing corroborates identity without a website. */
  hasBusinessListing?: boolean;
  /** Whether a real person is already known, having passed person-identity validity. */
  hasValidDecisionMaker: boolean;
  /** Whether any endpoint is attributed to that person. Role mailboxes do not count. */
  personRouteEmails?: readonly string[];
  hasAttributedPersonPhone?: boolean;
  /** Open duplicate-candidate review, which makes identity provisional. */
  hasUnresolvedDuplicate?: boolean;
  /** Whether the Account is waiting on a person to confirm basic identity. */
  needsIdentityReview?: boolean;
  /** Apollo's own history for this Account. */
  lastCheckedAt?: Date | null;
  nextCheckAt?: Date | null;
  lastResult?: string | null;
  previousFingerprint?: string | null;
  currentFingerprint?: string;
  manualRefreshRequested?: boolean;
  now?: Date;
}

export interface ApolloEligibilityVerdict {
  verdict: ApolloEligibility;
  eligible: boolean;
  reason: string;
}

/** How long each outcome rests before Apollo is worth asking again. */
export function cadenceDays(env: NodeJS.ProcessEnv = process.env): {
  missing: number; noMatch: number; complete: number;
} {
  return {
    missing: numeric('APOLLO_RETRY_MISSING_DAYS', 30, { min: 1, env }),
    noMatch: numeric('APOLLO_RETRY_NO_MATCH_DAYS', 60, { min: 1, env }),
    complete: numeric('APOLLO_REFRESH_COMPLETE_DAYS', 90, { min: 1, env }),
  };
}

/**
 * Whether the company is resolved enough to look up at all.
 *
 * A verified domain is the strongest key and the one Apollo searches best. Without one,
 * identity has to come from somewhere independent — a corroborated phone or address, or a
 * provider listing — because the alternative is asking Apollo who a name belongs to and
 * then treating its answer as proof the name was right. That is circular, and it is how
 * an estate fills with confident nonsense.
 */
export function organizationIdentityIsStrong(input: ApolloEligibilityInput): boolean {
  if (input.canonicalDomain && judgeDomain(input.canonicalDomain).usableAsWebsite) {
    return true;
  }
  const corroborated = Boolean(input.verifiedPhone) || Boolean(input.verifiedAddress);
  return Boolean(input.hasBusinessListing) && corroborated;
}

export function judgeApolloEligibility(input: ApolloEligibilityInput): ApolloEligibilityVerdict {
  const now = input.now ?? new Date();
  const say = (verdict: ApolloEligibility, reason: string): ApolloEligibilityVerdict =>
    ({ verdict, eligible: ELIGIBLE.has(verdict), reason });

  if (input.isSuppressed || input.entityStatus === 'rejected') {
    return say('NOT_ELIGIBLE_SUPPRESSED',
      'the Account is suppressed or rejected, so there is nobody to enrich');
  }
  if (input.sourceRole && NOT_A_TARGET_BUSINESS.has(input.sourceRole)) {
    return say('NOT_ELIGIBLE_BAD_ENTITY',
      `the record is a ${input.sourceRole.toLowerCase().replace(/_/g, ' ')}, not a business `
      + 'we could sell to');
  }
  if (input.hasUnresolvedDuplicate) {
    return say('NOT_ELIGIBLE_BAD_ENTITY',
      'an unresolved duplicate candidate means we would be enriching two records as one');
  }
  if (input.needsIdentityReview || input.entityStatus === 'legacy_unverified') {
    return say('NOT_ELIGIBLE_IDENTITY_WEAK',
      'the Account still needs basic identity review, and Apollo cannot supply that');
  }
  if (!organizationIdentityIsStrong(input)) {
    return say('NOT_ELIGIBLE_IDENTITY_WEAK',
      'there is no verified domain and no independently corroborated phone or address to '
      + 'look the company up by');
  }

  /**
   * The company changed under us.
   *
   * A different canonical domain is a different organisation as far as a people graph is
   * concerned, so a prior answer is about a company we are no longer asking about. This
   * outranks the cadence: waiting thirty days to notice would be waiting on a fact we
   * already have.
   */
  if (input.previousFingerprint && input.currentFingerprint
      && input.previousFingerprint !== input.currentFingerprint) {
    return say('ELIGIBLE_IDENTITY_CHANGED',
      'the organisation identity has materially changed since the last Apollo answer');
  }
  if (input.manualRefreshRequested) {
    return say('ELIGIBLE_MANUAL_REFRESH', 'a person asked for this Account to be re-checked');
  }

  // Nothing is asked again before it is due. This is what stops a daily sweep becoming a
  // daily bill.
  if (input.nextCheckAt && input.nextCheckAt > now) {
    const days = Math.ceil((input.nextCheckAt.getTime() - now.getTime()) / 86_400_000);
    return say('NOT_ELIGIBLE_RECENTLY_CHECKED',
      `already checked; next due in ${days} day(s)`);
  }

  /**
   * A route that belongs to a person, which is the thing the estate has none of.
   *
   * Role mailboxes are excluded here for the same reason they are excluded from
   * attribution: `info@` is not a way to reach the owner, and counting it as one would
   * mark the Account complete and stop us ever looking.
   */
  const personalEmails = (input.personRouteEmails ?? []).filter((e) => !isRoleMailbox(e));
  const hasPersonRoute = personalEmails.length > 0 || Boolean(input.hasAttributedPersonPhone);

  if (!input.hasValidDecisionMaker) {
    return say('ELIGIBLE_MISSING_DECISION_MAKER',
      'a real business with nobody named at it; this is what a people graph is for');
  }
  if (!hasPersonRoute) {
    return say('ELIGIBLE_MISSING_PERSON_ROUTE',
      'a named decision maker with no way to reach them directly');
  }
  if (input.lastResult === 'STALE') {
    return say('ELIGIBLE_STALE_CONTACT', 'the known contact has gone stale and needs re-checking');
  }
  return say('NOT_ELIGIBLE_ALREADY_COMPLETE',
    'a named decision maker with an attributable route; Apollo would be paid to repeat '
    + 'what we already know');
}

/**
 * When to ask again, given what happened.
 *
 * Nothing here schedules a call; it schedules a *question*, which the sweep then answers
 * against eligibility. An Account that becomes complete in the meantime is simply not
 * eligible when its day arrives.
 */
export function nextCheckAfter(input: {
  result: 'ENRICHED' | 'MATCHED' | 'NO_MATCH' | 'AMBIGUOUS' | 'ERROR' | 'COMPLETE';
  consecutiveNoMatch?: number;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Date {
  const now = input.now ?? new Date();
  const cadence = cadenceDays(input.env);
  const day = 86_400_000;

  switch (input.result) {
    case 'COMPLETE':
      return new Date(now.getTime() + cadence.complete * day);
    case 'NO_MATCH': {
      /**
       * Backed off, gently.
       *
       * A company Apollo has never heard of is unlikely to appear next month, and the
       * third identical no-match costs the same as the first. Doubling is bounded at four
       * times the base so an Account never falls off the schedule entirely.
       */
      const streak = Math.min(input.consecutiveNoMatch ?? 1, 3);
      return new Date(now.getTime() + cadence.noMatch * Math.min(2 ** (streak - 1), 4) * day);
    }
    case 'ERROR':
      // Our problem, not the company's. Tried again soon and never treated as an answer.
      return new Date(now.getTime() + day);
    default:
      return new Date(now.getTime() + cadence.missing * day);
  }
}
