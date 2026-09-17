import { discoveryVerticalRelevance } from '../discovery/verticalRelevance.js';
import { classifyEmail } from '../domain/normalize.js';

/**
 * What an Account created under older semantics looks like now, judged by today's rules.
 *
 * The inventory was built by code that has since been corrected. An Account created
 * before V1 could take its trade from the question the search asked, its name from a
 * page title, and its email roles from the shape of a mailbox. None of those rows moved
 * when the rules did: V1 stops new contamination and deliberately leaves the old rows
 * alone, so what is on disk is a mixture of records built under several generations of
 * rules with nothing on the row saying which.
 *
 * This module answers one question per Account -- what, if anything, is wrong with it --
 * and it answers by re-running the *current* rules over the *original* evidence. It
 * never guesses from the value that was stored, because the stored value is the thing
 * under suspicion. It writes nothing. Deciding is a separate, authorized act.
 */

export type RemediationClass =
  /** Valid company, trade supported by evidence about the business. */
  | 'A'
  /** Valid company, trade not supported by any evidence we hold. */
  | 'B'
  /** Valid company, display name is page copy rather than a company name. */
  | 'C'
  /** Not a company: a directory, a listicle, an article, a category page. */
  | 'D'
  /** Carried over from before entity resolution; never verified. */
  | 'E'
  /** Endpoint classification predates the rule that now governs it. */
  | 'F'
  /** Research state claims more than the run behind it supports. */
  | 'G'
  /** Evidence conflicts, or the fix is not obvious. A person decides. */
  | 'H'
  /** Nothing found wrong. */
  | 'I';

export const CLASS_LABELS: Record<RemediationClass, string> = {
  A: 'valid company, vertical supported',
  B: 'valid company, vertical unsupported by evidence',
  C: 'valid company, canonical name likely page copy',
  D: 'junk / non-company',
  E: 'legacy unverified',
  F: 'stale endpoint classification',
  G: 'stale research state',
  H: 'needs human review',
  I: 'no evidence problem found',
};

/**
 * Worst first. A junk row's name and trade do not matter until it is known to be a
 * company at all, so the order is about which question has to be answered first, not
 * about which finding is most numerous.
 */
const SEVERITY: RemediationClass[] = ['D', 'E', 'B', 'C', 'G', 'F', 'H', 'A', 'I'];

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Finding {
  remediationClass: RemediationClass;
  code: string;
  reason: string;
  proposedAction: string;
  confidence: Confidence;
  reviewRequired: boolean;
  /** How many underlying rows this finding is about, where that differs from one. */
  affectedRows?: number;
}

export interface ObservationEvidence {
  resultType: string | null;
  /** The provider's own category for the business. Null on every historical row. */
  category: string | null;
  position: number | null;
  query: string | null;
  observedName: string | null;
  observedDomain: string | null;
  observedPhone: string | null;
  observedLocation: string | null;
}

export interface EmailEndpointEvidence {
  endpointId: string;
  normalizedValue: string;
  persistedRole: string | null;
  /** A person this endpoint is actually attributed to, if one was ever recorded. */
  attributedToPersonName: string | null;
}

export interface ResearchEvidence {
  status: string | null;
  pagesFetched: number | null;
  pagesBlocked: number | null;
  completedAt: string | null;
}

/**
 * Every human action that means a person has worked this Account.
 *
 * Counted from the tables a person writes to, never inferred from a column whose name
 * sounds manual. `accounts.manual_score` and `manual_tier` are the trap: they are
 * written by the automated scoring pipeline and are set on every Account in the
 * inventory, so reading them as human input marks the entire estate untouchable.
 */
export interface HumanActivityEvidence {
  claimed: boolean;
  ownershipEvents: number;
  activitiesWithActor: number;
  activitiesWithNotesOrDisposition: number;
  followUps: number;
  opportunities: number;
  contactAttempts: number;
  meetings: number;
  emailsLogged: number;
  systemActivities: number;
}

export type ActivityState = 'human_sales_activity' | 'system_activity_only' | 'no_activity';

export function activityState(h: HumanActivityEvidence): ActivityState {
  const human = h.claimed || h.ownershipEvents > 0 || h.activitiesWithActor > 0
    || h.activitiesWithNotesOrDisposition > 0 || h.followUps > 0 || h.opportunities > 0
    || h.contactAttempts > 0 || h.meetings > 0 || h.emailsLogged > 0;
  if (human) return 'human_sales_activity';
  return h.systemActivities > 0 ? 'system_activity_only' : 'no_activity';
}

export interface AccountBundle {
  accountId: string;
  canonicalName: string;
  canonicalDomain: string | null;
  verticalProfileId: string | null;
  entityStatus: string | null;
  entityStatusBasis: string | null;
  researchCompleteness: string | null;
  discoveredForGeographyType: string | null;
  discoveredForGeography: string | null;
  /** Source classes the discovery classifier gave this identity, if it ran at all. */
  candidateSourceClasses: string[];
  candidateResolvedNames: { name: string; basis: string | null }[];
  observations: ObservationEvidence[];
  /** ENTITY_DISCOVERY terms of the Account's current vertical profile. */
  verticalTerms: string[];
  emails: EmailEndpointEvidence[];
  phoneCount: number;
  locationCount: number;
  latestResearch: ResearchEvidence | null;
  humanActivity: HumanActivityEvidence;
}

export interface AccountVerdict {
  accountId: string;
  canonicalName: string;
  canonicalDomain: string | null;
  verticalProfileId: string | null;
  entityStatus: string | null;
  entityStatusBasis: string | null;
  primaryClass: RemediationClass;
  findings: Finding[];
  activityState: ActivityState;
  /** Everything the reviewer needs on one line, without going back to the database. */
  evidence: {
    discoveryQuery: string | null;
    resultTypes: string[];
    bestPosition: number | null;
    providerCategories: string[];
    strongestSourceClass: string | null;
    firstPartyName: string | null;
    physicalLocations: number;
    endpointSummary: string;
    researchSummary: string;
  };
}

/* ------------------------------------------------------------------ name shape --- */

/**
 * Separators a title uses and a company name does not.
 *
 * The colon needs only a trailing space, not a leading one: "Comfort Pro: HVAC
 * Contractor in Tampa" is a page title written exactly the way a company name is not,
 * and requiring a space on both sides let it through as a proposed replacement.
 */
const TITLE_SEPARATORS = /[|•·»—–]|\s-\s|:\s/;

/** Copy that only ever appears in a page title or an advert. */
const MARKETING_PHRASES = [
  'call now', 'call today', '24/7', '24 hour', 'same-day', 'same day', 'free estimate',
  'free quote', 'near me', 'best ', 'top ', 'affordable', 'trusted', 'no.1', 'no. 1',
  '#1', 'book online', 'get a quote', 'financing available', 'licensed & insured',
  'licensed and insured', 'reviews', 'updated ', 'in 2024', 'in 2025', 'in 2026',
];

/** A listicle or an article announces itself in its first words. */
const LISTICLE_PREFIX = /^(the\s+)?(top|best|\d+\s+(best|top|great|cheap))\b/i;
const ARTICLE_SHAPE = /\b(says|said|announces|announced|report|reports|guide to|how to|what is|why you|vs\.?)\b/i;
/** "Apartments for Rent in 33133 - Miami, FL" is a category page, not a company. */
const CATEGORY_PAGE_SHAPE = /\b(for rent|for sale|jobs in|near|listings? in|directory|coupons?|deals?)\b/i;

function normalizeForCompare(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function looksLikePageCopy(name: string): { yes: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const lower = name.toLowerCase();
  if (TITLE_SEPARATORS.test(name)) reasons.push('carries a title separator');
  for (const phrase of MARKETING_PHRASES) {
    if (lower.includes(phrase)) { reasons.push(`contains marketing copy "${phrase.trim()}"`); break; }
  }
  // A truncated title is a title by construction: nothing names a company "...".
  if (/\.\.\.$|…$/.test(name.trim())) reasons.push('ends in an ellipsis, so it was truncated');
  // "Southern Air | AC Repair & Installation in Orlando FL" -- the city and state are
  // where the page ranks, not part of the company's name.
  if (/\b(in|near)\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)*,?\s+(FL|TX|GA|AL|NC|SC|TN|CA|NY)\b/.test(name)) {
    reasons.push('names a city and state, which is where it ranked rather than who it is');
  }
  if (name.split(/\s+/).length > 8) reasons.push('is longer than a company name');
  return { yes: reasons.length > 0, reasons };
}

function looksLikeNonCompany(name: string, domain: string | null): { yes: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (LISTICLE_PREFIX.test(name.trim())) reasons.push('is shaped like a listicle');
  if (ARTICLE_SHAPE.test(name)) reasons.push('is shaped like an article headline');
  if (CATEGORY_PAGE_SHAPE.test(name)) reasons.push('is shaped like a category or directory page');
  if (!domain) reasons.push('has no domain of its own');
  return { yes: reasons.length > 0, reasons };
}

/* -------------------------------------------------------------------- verticals --- */

/** Result types the provider gives for an entity rather than a page. */
const LISTING_RESULT_TYPES = new Set([
  'local_result', 'local_pack', 'maps_local', 'maps_search', 'google_business_profile',
  'local_services_ad',
]);

/**
 * Whether anything we hold supports this Account being in the trade it is filed under.
 *
 * Asked once per observation and answered by the same function the miner now uses, so
 * a historical row is judged by exactly the rule a new row would face. The Account is
 * supported if any single observation supports it; one good listing is enough, and a
 * hundred organic hits are still not.
 */
export function verticalSupport(bundle: AccountBundle): {
  supported: boolean; basis: string | null;
} {
  const providerListing = bundle.candidateSourceClasses.includes('BUSINESS_LISTING');
  for (const observation of bundle.observations) {
    const resultType = (observation.resultType ?? '').toLowerCase();
    const relevance = discoveryVerticalRelevance({
      resultType,
      providerCategory: observation.category,
      verticalTerms: bundle.verticalTerms,
      providerListing: providerListing && LISTING_RESULT_TYPES.has(resultType),
    });
    if (relevance === 'SUPPORTED') {
      return {
        supported: true,
        basis: observation.category
          ? `provider category "${observation.category}"`
          : `provider ${resultType} listing`,
      };
    }
  }
  return { supported: false, basis: null };
}

/* ------------------------------------------------------------------- the verdict --- */

export function classifyAccount(bundle: AccountBundle): AccountVerdict {
  const findings: Finding[] = [];
  const state = activityState(bundle.humanActivity);
  // A person having worked the Account does not change what is true about it, but it
  // changes who may act: nothing touched by a human is ever proposed for an automatic
  // rewrite, whatever the evidence says.
  const touched = state === 'human_sales_activity';
  const gate = (f: Finding): Finding =>
    touched ? { ...f, reviewRequired: true, proposedAction: `${f.proposedAction} (a person has worked this Account, so review first)` } : f;

  /* D -- is it a company at all? */
  const nonCompany = looksLikeNonCompany(bundle.canonicalName, bundle.canonicalDomain);
  const unpromotable = bundle.candidateSourceClasses.length > 0
    && !bundle.candidateSourceClasses.some((c) => c === 'BUSINESS_LISTING' || c === 'OFFICIAL_SITE');
  if (nonCompany.yes || unpromotable) {
    const reasons = [...nonCompany.reasons];
    if (unpromotable) reasons.push(`classified as ${bundle.candidateSourceClasses.join('/')}`);
    findings.push(gate({
      remediationClass: 'D',
      code: 'NON_COMPANY_ENTITY',
      reason: `The name ${reasons.join(', ')}.`,
      proposedAction: 'suppress from rep inventory and quarantine for review; do not delete',
      // Two independent signals is a finding; one name-shape signal alone is a question.
      confidence: reasons.length >= 2 ? 'HIGH' : 'LOW',
      reviewRequired: reasons.length < 2,
    }));
  }

  /* E -- did entity resolution ever see it? */
  if (bundle.entityStatus === 'legacy_unverified') {
    findings.push(gate({
      remediationClass: 'E',
      code: 'LEGACY_UNVERIFIED',
      reason: 'Created before entity resolution ran, so no identity evidence was ever recorded '
        + `(entity_status_basis is ${bundle.entityStatusBasis ?? 'null'}).`,
      proposedAction: 're-resolve identity from first-party evidence before a rep works it',
      confidence: 'HIGH',
      reviewRequired: false,
    }));
  }

  /* B -- is the trade supported by evidence about the business? */
  if (bundle.verticalProfileId) {
    const support = verticalSupport(bundle);
    if (!support.supported) {
      const types = [...new Set(bundle.observations.map((o) => o.resultType ?? 'unknown'))];
      findings.push(gate({
        remediationClass: 'B',
        code: 'VERTICAL_FROM_QUERY_ONLY',
        reason: `Filed under "${bundle.verticalProfileId}" but every observation we hold is `
          + `${types.join('/') || 'absent'}, which says a page was returned for that question `
          + 'and not that this business works in the trade.',
        proposedAction: 'clear primary_vertical_profile_id and let first-party research settle it',
        confidence: bundle.observations.length > 0 ? 'HIGH' : 'MEDIUM',
        reviewRequired: false,
      }));
    }
  }

  /* C -- is the display name the company's name or the page's headline? */
  const pageCopy = looksLikePageCopy(bundle.canonicalName);
  if (pageCopy.yes) {
    /**
     * A proposed name may only ever trim the one on the row, never introduce a new one.
     *
     * The resolver's stored names are not reliably better. Production holds candidates
     * whose `resolved_name` is another page's title, and in at least one case another
     * *city's*: an Account displayed as "Orlando HVAC Services" carries the candidate
     * name "HVAC Service Areas Near Orlando, FL", and an Account in Winter Park carries
     * one naming Tampa. Proposing those would replace a bad name with a wrong one, which
     * is worse -- a rep can see that a name reads like a page title, and cannot see that
     * it belongs to a different company.
     *
     * So the alternative has to already be contained in what is displayed, punctuation
     * ignored. "Southern Air" is inside "Southern Air | AC Repair ... | Call Now", and
     * "Chavez & Sons" is inside "Chavez & Sons Heating & Cooling Services". Anything
     * else is a new claim about who this company is and needs evidence, not a preview.
     */
    const current = normalizeForCompare(bundle.canonicalName);
    const alternative = bundle.candidateResolvedNames
      .filter((c) => !looksLikePageCopy(c.name).yes)
      .filter((c) => {
        const candidate = normalizeForCompare(c.name);
        return candidate.length > 0 && candidate !== current && current.includes(candidate);
      })
      .sort((a, b) => a.name.length - b.name.length)[0] ?? null;
    findings.push(gate({
      remediationClass: 'C',
      code: 'CANONICAL_NAME_IS_PAGE_COPY',
      reason: `The display name ${pageCopy.reasons.join(', ')}.`,
      proposedAction: alternative
        ? `replace with the resolver's name "${alternative.name}" (${alternative.basis ?? 'no basis'})`
        : 'no defensible alternative is held; re-resolve the name from first-party evidence',
      confidence: alternative ? 'MEDIUM' : 'LOW',
      // A name is what a rep reads out loud. Never rewritten without a person agreeing.
      reviewRequired: true,
    }));
  }

  /* F -- does each endpoint's role still follow from its evidence? */
  const stale = bundle.emails
    .map((email) => ({
      email,
      now: classifyEmail(email.normalizedValue,
        email.attributedToPersonName ? { attributedToPersonName: email.attributedToPersonName } : {}),
    }))
    .filter(({ email, now }) => email.persistedRole !== null && email.persistedRole !== now);
  if (stale.length > 0) {
    const personClaims = stale.filter(({ email }) => email.persistedRole === 'DIRECT_PERSON_EMAIL');
    findings.push(gate({
      remediationClass: 'F',
      code: 'ENDPOINT_ROLE_PREDATES_RULE',
      reason: `${stale.length} email endpoint(s) carry a role today's rule would not give them`
        + (personClaims.length > 0
          ? `, including ${personClaims.length} recorded as DIRECT_PERSON_EMAIL with no person attributed`
          : '')
        + `: ${stale.slice(0, 3).map(({ email, now }) => `${email.normalizedValue} ${email.persistedRole}->${now}`).join(', ')}.`,
      proposedAction: 'reclassify from the current rule, keeping the original observation',
      confidence: 'HIGH',
      reviewRequired: false,
      affectedRows: stale.length,
    }));
  }

  /* G -- does the research state claim more than the run behind it supports? */
  const research = bundle.latestResearch;
  if (research) {
    const fetched = research.pagesFetched ?? 0;
    const blocked = research.pagesBlocked ?? 0;
    const claimsGood = (bundle.researchCompleteness ?? '').toUpperCase() === 'GOOD';
    if (claimsGood && fetched === 0) {
      findings.push(gate({
        remediationClass: 'G',
        code: 'RESEARCH_STATE_OVERSTATED',
        reason: `Research completeness is GOOD, but the latest run fetched ${fetched} page(s) `
          + `and was blocked on ${blocked} (status ${research.status ?? 'unknown'}). Nothing was read, `
          + 'so nothing was learned.',
        proposedAction: 'recompute completeness from the run, which caps it at THIN, and re-queue research',
        confidence: 'HIGH',
        reviewRequired: false,
      }));
    }
  } else {
    findings.push(gate({
      remediationClass: 'G',
      code: 'RESEARCH_STATE_WITHOUT_RUN',
      reason: `Research completeness is ${bundle.researchCompleteness ?? 'null'} with no research run behind it.`,
      proposedAction: 'clear the completeness label and queue a first research run',
      confidence: 'HIGH',
      reviewRequired: false,
    }));
  }

  /* H -- anything whose fix is not obvious. */
  if (findings.some((f) => f.confidence === 'LOW')) {
    findings.push({
      remediationClass: 'H',
      code: 'LOW_CONFIDENCE_FINDING',
      reason: 'At least one finding rests on a single signal, which is a question rather than an answer.',
      proposedAction: 'route to a human queue; take no automatic action',
      confidence: 'LOW',
      reviewRequired: true,
    });
  }

  /* A / I -- nothing wrong. */
  if (findings.length === 0) {
    const supported = bundle.verticalProfileId ? verticalSupport(bundle) : { supported: false, basis: null };
    findings.push({
      remediationClass: bundle.verticalProfileId && supported.supported ? 'A' : 'I',
      code: bundle.verticalProfileId && supported.supported ? 'VERTICAL_SUPPORTED' : 'NO_PROBLEM_FOUND',
      reason: supported.basis
        ? `Trade supported by ${supported.basis}.`
        : 'No evidence problem found under the current rules.',
      proposedAction: 'no action',
      confidence: 'HIGH',
      reviewRequired: false,
    });
  }

  const primaryClass = SEVERITY.find((c) => findings.some((f) => f.remediationClass === c)) ?? 'I';
  const positions = bundle.observations.map((o) => o.position).filter((p): p is number => p != null);

  return {
    accountId: bundle.accountId,
    canonicalName: bundle.canonicalName,
    canonicalDomain: bundle.canonicalDomain,
    verticalProfileId: bundle.verticalProfileId,
    entityStatus: bundle.entityStatus,
    entityStatusBasis: bundle.entityStatusBasis,
    primaryClass,
    findings,
    activityState: state,
    evidence: {
      discoveryQuery: bundle.observations.find((o) => o.query)?.query ?? null,
      resultTypes: [...new Set(bundle.observations.map((o) => o.resultType ?? 'unknown'))],
      bestPosition: positions.length > 0 ? Math.min(...positions) : null,
      providerCategories: [...new Set(bundle.observations.map((o) => o.category).filter((c): c is string => !!c))],
      strongestSourceClass: bundle.candidateSourceClasses.includes('BUSINESS_LISTING')
        ? 'BUSINESS_LISTING'
        : bundle.candidateSourceClasses[0] ?? null,
      firstPartyName: bundle.candidateResolvedNames[0]?.name ?? null,
      physicalLocations: bundle.locationCount,
      endpointSummary: `${bundle.emails.length} email, ${bundle.phoneCount} phone`,
      researchSummary: research
        ? `${research.status ?? 'unknown'}, ${research.pagesFetched ?? 0} fetched, ${research.pagesBlocked ?? 0} blocked`
        : 'no run',
    },
  };
}

export interface PreviewSummary {
  total: number;
  byPrimaryClass: Record<string, number>;
  byFindingClass: Record<string, number>;
  byCode: Record<string, number>;
  activity: Record<ActivityState, number>;
  reviewRequired: number;
  autoProposable: number;
  /** Underlying rows per finding code, which is not the same as Accounts. */
  rowsByCode: Record<string, number>;
}

export function summarize(verdicts: AccountVerdict[]): PreviewSummary {
  const summary: PreviewSummary = {
    total: verdicts.length,
    byPrimaryClass: {}, byFindingClass: {}, byCode: {},
    activity: { human_sales_activity: 0, system_activity_only: 0, no_activity: 0 },
    reviewRequired: 0, autoProposable: 0, rowsByCode: {},
  };
  for (const verdict of verdicts) {
    summary.byPrimaryClass[verdict.primaryClass] = (summary.byPrimaryClass[verdict.primaryClass] ?? 0) + 1;
    summary.activity[verdict.activityState] += 1;
    const seen = new Set<RemediationClass>();
    for (const finding of verdict.findings) {
      summary.byCode[finding.code] = (summary.byCode[finding.code] ?? 0) + 1;
      summary.rowsByCode[finding.code] =
        (summary.rowsByCode[finding.code] ?? 0) + (finding.affectedRows ?? 1);
      if (!seen.has(finding.remediationClass)) {
        seen.add(finding.remediationClass);
        summary.byFindingClass[finding.remediationClass] =
          (summary.byFindingClass[finding.remediationClass] ?? 0) + 1;
      }
    }
    if (verdict.findings.some((f) => f.reviewRequired)) summary.reviewRequired += 1;
    else if (verdict.primaryClass !== 'A' && verdict.primaryClass !== 'I') summary.autoProposable += 1;
  }
  return summary;
}
