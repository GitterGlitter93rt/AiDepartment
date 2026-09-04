/**
 * Public decision-maker resolution types.
 * Authority: outbound-sales-brain-public-decision-maker-resolution-spec.md,
 * outbound-sales-brain-public-contact-source-registry.v1.yaml.
 *
 * The whole design rests on one separation: WHO owns the problem is a different
 * question from HOW we can legitimately reach them. They get separate objects,
 * separate confidence dimensions, and are never collapsed into one number.
 */

/** Source classes from the registry, with their fixed priorities. */
export type SourceClass =
  | 'PROSPECT_OR_GATEKEEPER_SUPPLIED'   // 5  — a person told us
  | 'COMPANY_FIRST_PARTY'               // 10 — the company's own site
  | 'PUBLIC_COMPANY_REGISTRY'           // 20 — state entity records
  | 'PUBLIC_LICENSE_REGISTRY'           // 30 — contractor/professional licences
  | 'PUBLIC_BUSINESS_DIRECTORY'         // 40 — chamber/trade directories
  | 'PUBLIC_BUSINESS_NEWS'              // 50 — press, bios
  | 'SEARCH_RESULT_DISCOVERY'           // 60 — indexed results
  | 'LICENSED_CONTACT_PROVIDER'         // 70 — Apollo and equivalents, off by default
  | 'DERIVED_PATTERN';                  // 90 — inferred, never authority

export const SOURCE_PRIORITY: Record<SourceClass, number> = {
  PROSPECT_OR_GATEKEEPER_SUPPLIED: 5,
  COMPANY_FIRST_PARTY: 10,
  PUBLIC_COMPANY_REGISTRY: 20,
  PUBLIC_LICENSE_REGISTRY: 30,
  PUBLIC_BUSINESS_DIRECTORY: 40,
  PUBLIC_BUSINESS_NEWS: 50,
  SEARCH_RESULT_DISCOVERY: 60,
  LICENSED_CONTACT_PROVIDER: 70,
  DERIVED_PATTERN: 90,
};

/** Sources that can, on their own, establish that someone currently works there. */
export const CURRENT_EMPLOYMENT_SOURCES: ReadonlySet<SourceClass> = new Set<SourceClass>([
  'PROSPECT_OR_GATEKEEPER_SUPPLIED',
  'COMPANY_FIRST_PARTY',
]);

export type Freshness = 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';

/**
 * Relationship classes. Registered agent, license holder and qualifier are
 * EVIDENCE relationships: they connect a person to a company but say nothing about
 * who runs a workflow, and must never normalize into an operational sales role
 * (registry hard rule `no_registered_agent_promotion`).
 */
export type RelationshipClass =
  | 'OWNER' | 'FOUNDER' | 'MEMBER' | 'MANAGER' | 'OFFICER' | 'PRESIDENT' | 'CEO'
  | 'GENERAL_MANAGER' | 'OPERATIONS' | 'OFFICE_MANAGER' | 'SERVICE_MANAGER'
  | 'SALES_LEADERSHIP' | 'MARKETING' | 'INTAKE' | 'PRACTICE_ADMINISTRATOR'
  | 'MANAGING_PARTNER' | 'BROKER_OWNER' | 'TEAM_LEADER' | 'ISA_LEADERSHIP'
  | 'LOCATION_MANAGER' | 'LICENSE_HOLDER' | 'QUALIFIER' | 'REGISTERED_AGENT'
  | 'OTHER_BUSINESS_ROLE';

/** Never a cold-outreach target on the strength of a public filing alone. */
export const NON_DECISION_RELATIONSHIPS: ReadonlySet<RelationshipClass> = new Set<RelationshipClass>([
  'REGISTERED_AGENT',
]);

/** Establishes a person↔company link but not operational ownership. */
export const EVIDENCE_ONLY_RELATIONSHIPS: ReadonlySet<RelationshipClass> = new Set<RelationshipClass>([
  'REGISTERED_AGENT', 'LICENSE_HOLDER', 'QUALIFIER', 'MEMBER', 'OFFICER',
]);

export type Scope = 'ACCOUNT' | 'REGION' | 'LOCATION' | 'MARKET';

/** One thing one source said about one person, at one time. */
export interface PersonObservation {
  personName: string | null;
  rawTitle: string | null;
  relationship: RelationshipClass;
  sourceClass: SourceClass;
  sourceReference: string | null;
  observedAt: Date;
  freshness: Freshness;
  scope: Scope;
  /** Which location this person is attached to, if the source says. */
  locationHint?: string | null;
  /** True when the source says the person has left. */
  departed?: boolean;
  notes?: string | null;
}

export type EndpointKind = 'PHONE' | 'EMAIL';

export interface EndpointObservation {
  kind: EndpointKind;
  value: string;
  extension?: string | null;
  /** Who the source attaches this endpoint to, if anyone. */
  attributedToPersonName?: string | null;
  /** True only when the source explicitly presents it as that person's own line. */
  explicitlyPersonal?: boolean;
  isMainLine?: boolean;
  sourceClass: SourceClass;
  sourceReference: string | null;
  observedAt: Date;
  freshness: Freshness;
  /** Set by an adapter that considers the source itself untrustworthy for endpoints. */
  dubiousSource?: boolean;
  notes?: string | null;
}

export type EmployerMatch = 'CONFIRMED' | 'LIKELY' | 'UNCERTAIN' | 'HISTORICAL' | 'CONFLICTED';
export type RoleMatch = 'PRIMARY_PROCESS_OWNER' | 'STRONG_STAKEHOLDER' | 'VALID_FALLBACK' | 'WEAK';
export type EndpointRelationship =
  | 'DIRECT_CONFIRMED' | 'DIRECT_PROVIDER_ASSERTED' | 'COMPANY_ROUTE'
  | 'LOCATION_ROUTE' | 'ROLE_INBOX' | 'UNVERIFIED';

export type ResolutionStatus =
  | 'NAMED_DIRECT_READY'
  | 'NAMED_EMAIL_READY'
  | 'NAMED_MAINLINE_ROUTE_READY'
  | 'ROLE_ROUTE_READY'
  | 'PUBLIC_RESEARCH_PARTIAL'
  | 'PAID_ENRICHMENT_OPTIONAL'
  | 'REVIEW_REQUIRED'
  | 'STALE_REFRESH_REQUIRED';

/** Who we believe is relevant. Separate from how we reach them. */
export interface DecisionMakerIdentity {
  personName: string | null;
  rawTitle: string | null;
  relationship: RelationshipClass;
  roleCategory: string;
  scope: Scope;
  employerMatch: EmployerMatch;
  roleMatch: RoleMatch;
  currentness: Freshness;
  /** True when this is a role target rather than a named person. */
  isRolePlaceholder: boolean;
  supportingObservations: PersonObservation[];
  /** Why this person was chosen, in words a reviewer can check. */
  reason: string;
}

/** How we may legitimately try to reach that person or role. */
export interface ContactPath {
  kind: EndpointKind;
  value: string;
  extension: string | null;
  relationshipToPerson: EndpointRelationship;
  endpointRole: string;
  qualityState: string;
  sourceClass: SourceClass;
  sourceReference: string | null;
  freshness: Freshness;
  /** Set when the route goes through a main line to a named person. */
  askFor: string | null;
}

export interface ResolutionResult {
  status: ResolutionStatus;
  primary: DecisionMakerIdentity | null;
  alternates: DecisionMakerIdentity[];
  /** People deliberately excluded, with the reason — this is auditable, not silent. */
  excluded: { personName: string; relationship: RelationshipClass; reason: string }[];
  /** People believed to have moved on; kept so a stale name is never re-personalized. */
  stale: { personName: string; reason: string }[];
  contactPaths: ContactPath[];
  targetRoles: string[];
  /** True when a paid provider could plausibly add a direct endpoint we lack. */
  paidEnrichmentWouldHelp: boolean;
  notes: string[];
}
