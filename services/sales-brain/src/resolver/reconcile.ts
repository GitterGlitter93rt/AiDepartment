import {
  CURRENT_EMPLOYMENT_SOURCES, EVIDENCE_ONLY_RELATIONSHIPS, NON_DECISION_RELATIONSHIPS,
  SOURCE_PRIORITY,
  type ContactPath, type DecisionMakerIdentity, type EmployerMatch, type EndpointObservation,
  type EndpointRelationship, type Freshness, type PersonObservation, type RelationshipClass,
  type ResolutionResult, type ResolutionStatus, type RoleMatch, type SourceClass,
} from './types.js';
import { roleCategoryFor, roleRouteLabel, targetRoleLadder } from './roles.js';
import { classifyEmail, normalizeEmail, normalizePhone } from '../domain/normalize.js';

/**
 * Reconciles raw observations into one decision-maker identity and a set of legitimate
 * contact paths.
 * Authority: outbound-sales-brain-public-decision-maker-resolution-spec.md §3-§7, §13-§14,
 * and the source registry's hard_rules.
 *
 * Deliberately pure: no network, no database. Every fixture in
 * outbound-sales-brain-public-contact-resolution-fixtures.v1.yaml runs against this
 * function directly, which is what makes the honesty rules testable.
 */

export interface ReconcileInput {
  companyName: string;
  verticalProfileId: string | null;
  hypothesisCategory: string | null;
  people: PersonObservation[];
  endpoints: EndpointObservation[];
  /** Set when the account is one branch of a larger group. */
  targetLocation?: string | null;
  /** Whether a paid provider may be suggested. Never required. */
  paidEnrichmentAvailable?: boolean;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Freshness ordering for "which of these is more current". */
const FRESHNESS_RANK: Record<Freshness, number> = { FRESH: 0, AGING: 1, UNKNOWN: 2, STALE: 3 };

interface PersonCandidate {
  personName: string;
  observations: PersonObservation[];
  bestRelationship: RelationshipClass;
  rawTitle: string | null;
  scope: PersonObservation['scope'];
  locationHint: string | null;
  departed: boolean;
}

function groupByPerson(people: PersonObservation[]): PersonCandidate[] {
  const groups = new Map<string, PersonObservation[]>();
  for (const observation of people) {
    if (!observation.personName) continue;
    const key = normalizeName(observation.personName);
    const bucket = groups.get(key);
    if (bucket) bucket.push(observation);
    else groups.set(key, [observation]);
  }

  return [...groups.values()].map((observations) => {
    // The strongest source that carries an operational (non-evidence-only) role
    // decides the relationship we act on.
    const ranked = [...observations].sort((a, b) => {
      const evidenceOnlyA = EVIDENCE_ONLY_RELATIONSHIPS.has(a.relationship) ? 1 : 0;
      const evidenceOnlyB = EVIDENCE_ONLY_RELATIONSHIPS.has(b.relationship) ? 1 : 0;
      if (evidenceOnlyA !== evidenceOnlyB) return evidenceOnlyA - evidenceOnlyB;
      const priority = SOURCE_PRIORITY[a.sourceClass] - SOURCE_PRIORITY[b.sourceClass];
      if (priority !== 0) return priority;
      return FRESHNESS_RANK[a.freshness] - FRESHNESS_RANK[b.freshness];
    });
    const best = ranked[0]!;
    return {
      personName: observations.find((o) => o.personName)!.personName!,
      observations,
      bestRelationship: best.relationship,
      rawTitle: ranked.find((o) => o.rawTitle)?.rawTitle ?? null,
      scope: best.scope,
      locationHint: ranked.find((o) => o.locationHint)?.locationHint ?? null,
      departed: observations.some((o) => o.departed),
    };
  });
}

/**
 * How sure are we that this person is currently at this company?
 * Distinct from whether their role is the right one to call.
 */
function employerMatchFor(candidate: PersonCandidate): EmployerMatch {
  if (candidate.departed) return 'HISTORICAL';

  const currentSources = candidate.observations.filter(
    (o) => CURRENT_EMPLOYMENT_SOURCES.has(o.sourceClass) && o.freshness !== 'STALE',
  );
  const distinctSources = new Set(candidate.observations.map((o) => o.sourceClass));

  // Two independent sources that each support current employment, or one first-party
  // source corroborated by a public record.
  if (currentSources.length >= 2 && new Set(currentSources.map((o) => o.sourceClass)).size >= 1
      && distinctSources.size >= 2) {
    return 'CONFIRMED';
  }
  if (currentSources.length >= 1 && distinctSources.size >= 2) return 'CONFIRMED';
  if (currentSources.length >= 1) return 'LIKELY';

  const allStale = candidate.observations.every((o) => o.freshness === 'STALE');
  if (allStale) return 'HISTORICAL';
  return 'UNCERTAIN';
}

function currentnessFor(candidate: PersonCandidate): Freshness {
  if (candidate.departed) return 'STALE';
  const best = candidate.observations
    .map((o) => o.freshness)
    .sort((a, b) => FRESHNESS_RANK[a] - FRESHNESS_RANK[b])[0];
  return best ?? 'UNKNOWN';
}

/** Where this person's role sits on the ladder for the hypothesis in play. */
function roleMatchFor(
  relationship: RelationshipClass, ladder: RelationshipClass[],
): { match: RoleMatch; rank: number } {
  const index = ladder.indexOf(relationship);
  if (index === 0) return { match: 'PRIMARY_PROCESS_OWNER', rank: 0 };
  if (index === 1 || index === 2) return { match: 'STRONG_STAKEHOLDER', rank: index };
  if (index > 2) return { match: 'VALID_FALLBACK', rank: index };
  // Off the ladder entirely: a qualifier or officer connects a person to the company
  // but does not make them the right person to call about this problem.
  return { match: 'WEAK', rank: ladder.length + 1 };
}

export function reconcile(input: ReconcileInput): ResolutionResult {
  const ladder = targetRoleLadder(input.verticalProfileId, input.hypothesisCategory);
  const notes: string[] = [];
  const excluded: ResolutionResult['excluded'] = [];
  const stale: ResolutionResult['stale'] = [];

  const candidates = groupByPerson(input.people);
  const eligible: { candidate: PersonCandidate; identity: DecisionMakerIdentity; score: number }[] = [];

  for (const candidate of candidates) {
    // Rule `no_registered_agent_promotion`: a filing naming a registered agent is
    // identity metadata. It never makes that party a sales target.
    if (NON_DECISION_RELATIONSHIPS.has(candidate.bestRelationship)) {
      excluded.push({
        personName: candidate.personName,
        relationship: candidate.bestRelationship,
        reason: 'Registered agent is a filing relationship, not a decision maker.',
      });
      continue;
    }

    if (candidate.departed) {
      stale.push({
        personName: candidate.personName,
        reason: 'Reported as no longer at the company.',
      });
      continue;
    }

    const employerMatch = employerMatchFor(candidate);
    const currentness = currentnessFor(candidate);

    // A person known only from a stale source is not personalized as current.
    if (employerMatch === 'HISTORICAL') {
      stale.push({
        personName: candidate.personName,
        reason: 'Only stale evidence supports this person; refresh before using the name.',
      });
      continue;
    }

    // Scope: a corporate executive is not the target for a single branch's workflow
    // unless something says they control it.
    let scopePenalty = 0;
    if (input.targetLocation) {
      const matchesLocation = candidate.locationHint
        && candidate.locationHint.toLowerCase().includes(input.targetLocation.toLowerCase());
      if (matchesLocation) scopePenalty = -5;
      else if (candidate.scope === 'ACCOUNT' || candidate.scope === 'MARKET') scopePenalty = 5;
    }

    const { match: roleMatch, rank } = roleMatchFor(candidate.bestRelationship, ladder);
    const evidenceOnly = EVIDENCE_ONLY_RELATIONSHIPS.has(candidate.bestRelationship);

    const score =
      rank * 10
      + scopePenalty
      + (employerMatch === 'CONFIRMED' ? 0 : employerMatch === 'LIKELY' ? 2 : 5)
      + (currentness === 'FRESH' ? 0 : currentness === 'AGING' ? 2 : 4)
      // A qualifier or officer supports identity but never wins the routing on its own.
      + (evidenceOnly ? 40 : 0);

    const reasonParts: string[] = [];
    reasonParts.push(
      rank === 0
        ? `${candidate.bestRelationship} is the primary owner of this problem`
        : rank <= 2
          ? `${candidate.bestRelationship} is a strong stakeholder for this problem`
          : `${candidate.bestRelationship} is a reasonable fallback for this problem`,
    );
    if (evidenceOnly) {
      reasonParts.push('public-record relationship supports identity but not workflow ownership');
    }
    reasonParts.push(
      `${employerMatch.toLowerCase()} current employment from ` +
      `${[...new Set(candidate.observations.map((o) => o.sourceClass))].join(' + ')}`,
    );
    if (scopePenalty < 0) reasonParts.push(`attached to the ${input.targetLocation} location`);
    if (scopePenalty > 0) reasonParts.push('company-wide scope, not this location');

    eligible.push({
      candidate,
      score,
      identity: {
        personName: candidate.personName,
        rawTitle: candidate.rawTitle,
        relationship: candidate.bestRelationship,
        roleCategory: roleCategoryFor(candidate.bestRelationship),
        scope: candidate.scope,
        employerMatch,
        roleMatch,
        currentness,
        isRolePlaceholder: false,
        supportingObservations: candidate.observations,
        reason: reasonParts.join('; ') + '.',
      },
    });
  }

  eligible.sort((a, b) => a.score - b.score || a.candidate.personName.localeCompare(b.candidate.personName));

  const primary = eligible[0]?.identity ?? null;
  const alternates = eligible.slice(1).map((entry) => entry.identity);

  const contactPaths = buildContactPaths(input, primary, notes);

  // No named person is a valid, sales-ready outcome — not a failure
  // (resolution spec §18, fixture `no_name_role_route_is_valid`).
  const rolePlaceholder: DecisionMakerIdentity | null = primary ? null : {
    personName: null,
    rawTitle: null,
    relationship: ladder[0] ?? 'OPERATIONS',
    roleCategory: roleCategoryFor(ladder[0] ?? 'OPERATIONS'),
    scope: 'ACCOUNT',
    employerMatch: 'UNCERTAIN',
    roleMatch: 'VALID_FALLBACK',
    currentness: 'UNKNOWN',
    isRolePlaceholder: true,
    supportingObservations: [],
    reason: `No named person is publicly supportable. Ask for ${roleRouteLabel(ladder)}.`,
  };

  const status = statusFor(primary ?? rolePlaceholder, contactPaths, excluded, notes);

  const hasDirectEndpoint = contactPaths.some(
    (path) => path.relationshipToPerson === 'DIRECT_CONFIRMED'
      || path.relationshipToPerson === 'DIRECT_PROVIDER_ASSERTED',
  );

  return {
    status,
    primary: primary ?? rolePlaceholder,
    alternates,
    excluded,
    stale,
    contactPaths,
    targetRoles: ladder.slice(0, 4),
    // Paid enrichment is only ever an optimization on top of a working route.
    paidEnrichmentWouldHelp: Boolean(input.paidEnrichmentAvailable) && !hasDirectEndpoint && Boolean(primary),
    notes,
  };
}

function buildContactPaths(
  input: ReconcileInput, primary: DecisionMakerIdentity | null, notes: string[],
): ContactPath[] {
  const paths: ContactPath[] = [];
  const seen = new Set<string>();
  const primaryName = primary?.personName ? normalizeName(primary.personName) : null;

  for (const observation of input.endpoints) {
    // A number surfaced by a people-search style page is not a business endpoint
    // (fixture `unrelated_personal_number_rejected`).
    if (observation.dubiousSource) {
      notes.push(
        `Ignored a ${observation.kind.toLowerCase()} from an unverified people-search style source.`,
      );
      continue;
    }

    const normalized = observation.kind === 'PHONE'
      ? normalizePhone(observation.value)
      : normalizeEmail(observation.value);
    if (!normalized) continue;

    const key = `${observation.kind}:${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const attributed = observation.attributedToPersonName
      ? normalizeName(observation.attributedToPersonName) : null;
    const belongsToPrimary = Boolean(attributed && primaryName && attributed === primaryName);

    if (observation.kind === 'PHONE') {
      paths.push(buildPhonePath(observation, normalized, belongsToPrimary, primary));
    } else {
      paths.push(buildEmailPath(observation, normalized, belongsToPrimary, primary));
    }
  }

  // Strongest route first, so the rep sees the best available path at the top.
  const rank: Record<EndpointRelationship, number> = {
    DIRECT_CONFIRMED: 0, DIRECT_PROVIDER_ASSERTED: 1, LOCATION_ROUTE: 2,
    COMPANY_ROUTE: 3, ROLE_INBOX: 4, UNVERIFIED: 5,
  };
  paths.sort((a, b) => rank[a.relationshipToPerson] - rank[b.relationshipToPerson]);
  return paths;
}

function buildPhonePath(
  observation: EndpointObservation, normalized: string,
  belongsToPrimary: boolean, primary: DecisionMakerIdentity | null,
): ContactPath {
  // Rule `no_mainline_as_direct`: a number is only a person's direct line when the
  // source explicitly presents it that way. Attribution alone is not enough, and a
  // main line is never promoted no matter who it sits next to on the page.
  const isDirect = belongsToPrimary && observation.explicitlyPersonal === true && !observation.isMainLine;
  const fromProvider = observation.sourceClass === 'LICENSED_CONTACT_PROVIDER';

  const relationshipToPerson: EndpointRelationship = isDirect
    ? (fromProvider ? 'DIRECT_PROVIDER_ASSERTED' : 'DIRECT_CONFIRMED')
    : 'COMPANY_ROUTE';

  const endpointRole = isDirect
    ? 'DIRECT_BUSINESS_LINE'
    : observation.extension ? 'EXTENSION' : 'MAIN_BUSINESS_LINE';

  const qualityState = isDirect
    ? (fromProvider ? 'PROVIDER_ASSERTED_CURRENT' : 'DIRECT_BUSINESS_CONFIRMED')
    : observation.sourceClass === 'COMPANY_FIRST_PARTY' && observation.freshness === 'FRESH'
      ? 'CURRENT_BUSINESS_CONFIRMED'
      : 'PUBLIC_OBSERVED_UNVERIFIED';

  return {
    kind: 'PHONE',
    value: normalized,
    extension: observation.extension ?? null,
    relationshipToPerson,
    endpointRole,
    qualityState,
    sourceClass: observation.sourceClass,
    sourceReference: observation.sourceReference,
    freshness: observation.freshness,
    // When the route is the front desk, the rep is told who to ask for.
    askFor: !isDirect && primary?.personName ? primary.personName : null,
  };
}

function buildEmailPath(
  observation: EndpointObservation, normalized: string,
  belongsToPrimary: boolean, primary: DecisionMakerIdentity | null,
): ContactPath {
  const emailClass = classifyEmail(normalized);
  const guessed = observation.sourceClass === 'DERIVED_PATTERN';

  const relationshipToPerson: EndpointRelationship = guessed
    ? 'UNVERIFIED'
    : belongsToPrimary && emailClass === 'DIRECT_PERSON_EMAIL'
      ? 'DIRECT_CONFIRMED'
      : emailClass === 'DIRECT_PERSON_EMAIL' ? 'UNVERIFIED' : 'ROLE_INBOX';

  // Rule `no_guessed_email_as_verified`: a pattern guess stays GUESSED_UNVERIFIED
  // and is never outreach ready.
  const qualityState = guessed
    ? 'GUESSED_UNVERIFIED'
    : observation.sourceClass === 'LICENSED_CONTACT_PROVIDER'
      ? 'PROVIDER_VERIFIED'
      : observation.sourceClass === 'COMPANY_FIRST_PARTY'
        ? 'PUBLIC_OBSERVED_CURRENT'
        : 'DOMAIN_VALID_UNVERIFIED';

  return {
    kind: 'EMAIL',
    value: normalized,
    extension: null,
    relationshipToPerson,
    endpointRole: emailClass,
    qualityState,
    sourceClass: observation.sourceClass,
    sourceReference: observation.sourceReference,
    freshness: observation.freshness,
    askFor: null,
  };
}

function statusFor(
  primary: DecisionMakerIdentity | null, paths: ContactPath[],
  excluded: ResolutionResult['excluded'], notes: string[],
): ResolutionStatus {
  const usable = paths.filter((path) => path.qualityState !== 'GUESSED_UNVERIFIED');
  const directPhone = usable.find(
    (path) => path.kind === 'PHONE'
      && (path.relationshipToPerson === 'DIRECT_CONFIRMED'
        || path.relationshipToPerson === 'DIRECT_PROVIDER_ASSERTED'),
  );
  const namedEmail = usable.find(
    (path) => path.kind === 'EMAIL' && path.relationshipToPerson === 'DIRECT_CONFIRMED',
  );
  const anyPhone = usable.find((path) => path.kind === 'PHONE');

  if (!primary) {
    return usable.length > 0 ? 'ROLE_ROUTE_READY' : 'PUBLIC_RESEARCH_PARTIAL';
  }
  if (primary.isRolePlaceholder) {
    return anyPhone ? 'ROLE_ROUTE_READY' : 'PUBLIC_RESEARCH_PARTIAL';
  }
  if (directPhone) return 'NAMED_DIRECT_READY';
  if (namedEmail) return 'NAMED_EMAIL_READY';
  if (anyPhone) return 'NAMED_MAINLINE_ROUTE_READY';

  if (excluded.length > 0 && usable.length === 0) {
    notes.push('The only public names found were filing relationships, and no business endpoint was found.');
  }
  return 'PUBLIC_RESEARCH_PARTIAL';
}

export { targetRoleLadder, roleRouteLabel };
export type { SourceClass };
