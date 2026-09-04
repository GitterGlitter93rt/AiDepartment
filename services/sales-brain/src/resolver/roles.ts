import type { RelationshipClass } from './types.js';

/**
 * Role normalization and hypothesis-driven routing.
 * Authority: outbound-sales-brain-decision-maker-routing-spec.md §1, §3-§5.
 *
 * The governing rule: route by problem ownership, not prestige. The owner is not
 * automatically the right first call.
 */

/**
 * Title → relationship class. Order matters: the public-record relationships are
 * matched first so "Registered Agent" is never swallowed by a later, looser pattern.
 */
const TITLE_PATTERNS: [RegExp, RelationshipClass][] = [
  [/registered\s+agent/i,                         'REGISTERED_AGENT'],
  [/qualifying\s+(agent|contractor)|qualifier/i,  'QUALIFIER'],
  [/licen[sc]e\s+holder|licensee/i,               'LICENSE_HOLDER'],
  [/managing\s+partner/i,                         'MANAGING_PARTNER'],
  [/broker[\s-]?owner|principal\s+broker/i,       'BROKER_OWNER'],
  [/intake/i,                                     'INTAKE'],
  [/practice\s+(administrator|manager)|firm\s+administrator/i, 'PRACTICE_ADMINISTRATOR'],
  [/\bisa\b|inside\s+sales\s+manager/i,           'ISA_LEADERSHIP'],
  [/team\s+lead(er)?/i,                           'TEAM_LEADER'],
  [/(location|branch|store|market)\s+manager/i,   'LOCATION_MANAGER'],
  [/general\s+manager|\bgm\b/i,                   'GENERAL_MANAGER'],
  [/service\s+manager/i,                          'SERVICE_MANAGER'],
  [/office\s+manager/i,                           'OFFICE_MANAGER'],
  // C-level titles are matched by function before the generic `officer` pattern, so
  // "Chief Marketing Officer" routes to MARKETING rather than falling through to
  // OFFICER — an evidence-only class that would wrongly demote a real stakeholder.
  [/chief\s+operat(ing|ions)\s+officer|\bcoo\b/i,  'OPERATIONS'],
  [/chief\s+market(ing)?\s+officer|\bcmo\b/i,      'MARKETING'],
  [/chief\s+revenue\s+officer|\bcro\b/i,           'SALES_LEADERSHIP'],
  [/(director|vp|head|manager|chief).{0,20}operations|operations.{0,20}(director|manager|lead)|^operations$/i,
                                                  'OPERATIONS'],
  [/(sales).{0,20}(director|manager|lead|vp|officer)|(director|vp|head).{0,20}sales/i, 'SALES_LEADERSHIP'],
  [/market(ing)?.{0,20}(director|manager|lead|vp|officer)|^marketing$/i, 'MARKETING'],
  [/\bceo\b|chief\s+executive/i,                  'CEO'],
  [/\bpresident\b/i,                              'PRESIDENT'],
  [/founder|co-?founder/i,                        'FOUNDER'],
  [/\bowner\b|proprietor|principal(?!\s+broker)/i, 'OWNER'],
  [/\bofficer\b|treasurer|secretary(?!\s)/i,      'OFFICER'],
  [/\bmember\b|managing\s+member/i,               'MEMBER'],
  [/\bmanager\b/i,                                'MANAGER'],
];

export function relationshipFromTitle(title: string | null | undefined): RelationshipClass {
  if (!title) return 'OTHER_BUSINESS_ROLE';
  for (const [pattern, relationship] of TITLE_PATTERNS) {
    if (pattern.test(title)) return relationship;
  }
  return 'OTHER_BUSINESS_ROLE';
}

/** Maps a relationship onto the `contacts.role_category` enum in the schema. */
export function roleCategoryFor(relationship: RelationshipClass): string {
  const map: Partial<Record<RelationshipClass, string>> = {
    OWNER: 'owner', FOUNDER: 'founder', PRESIDENT: 'president', CEO: 'ceo',
    GENERAL_MANAGER: 'general_manager', OPERATIONS: 'operations', SERVICE_MANAGER: 'service_manager',
    MARKETING: 'marketing', SALES_LEADERSHIP: 'sales', OFFICE_MANAGER: 'office_manager',
    INTAKE: 'intake', PRACTICE_ADMINISTRATOR: 'administrator', MANAGING_PARTNER: 'president',
    BROKER_OWNER: 'owner', TEAM_LEADER: 'sales', ISA_LEADERSHIP: 'sales',
    LOCATION_MANAGER: 'general_manager', REGISTERED_AGENT: 'registered_agent',
    QUALIFIER: 'license_qualifier', LICENSE_HOLDER: 'license_qualifier',
  };
  return map[relationship] ?? 'unknown';
}

/**
 * Routing ladders by opportunity hypothesis (routing spec §4).
 * First entry is the primary process owner; later entries are progressively weaker.
 */
const HYPOTHESIS_LADDERS: Record<string, RelationshipClass[]> = {
  after_hours:        ['OPERATIONS', 'OFFICE_MANAGER', 'GENERAL_MANAGER', 'SERVICE_MANAGER', 'OWNER', 'PRESIDENT'],
  missed_call:        ['OPERATIONS', 'OFFICE_MANAGER', 'GENERAL_MANAGER', 'SERVICE_MANAGER', 'OWNER', 'PRESIDENT'],
  speed_to_lead:      ['OPERATIONS', 'SALES_LEADERSHIP', 'GENERAL_MANAGER', 'OFFICE_MANAGER', 'OWNER'],
  unsold_estimate:    ['SALES_LEADERSHIP', 'GENERAL_MANAGER', 'OPERATIONS', 'OWNER', 'PRESIDENT'],
  follow_up:          ['SALES_LEADERSHIP', 'OPERATIONS', 'GENERAL_MANAGER', 'OWNER'],
  paid_acquisition:   ['MARKETING', 'OPERATIONS', 'GENERAL_MANAGER', 'OWNER', 'PRESIDENT'],
  attribution:        ['MARKETING', 'OPERATIONS', 'GENERAL_MANAGER', 'OWNER', 'PRESIDENT'],
  crm_workflow:       ['OPERATIONS', 'SALES_LEADERSHIP', 'MARKETING', 'GENERAL_MANAGER', 'OWNER'],
  employee_capacity:  ['OPERATIONS', 'OFFICE_MANAGER', 'PRACTICE_ADMINISTRATOR', 'GENERAL_MANAGER', 'OWNER'],
  reporting:          ['OPERATIONS', 'GENERAL_MANAGER', 'OWNER', 'PRESIDENT'],
  customer_communication: ['OPERATIONS', 'OFFICE_MANAGER', 'GENERAL_MANAGER', 'SERVICE_MANAGER', 'OWNER'],
  appointment_no_show:['OPERATIONS', 'OFFICE_MANAGER', 'PRACTICE_ADMINISTRATOR', 'GENERAL_MANAGER', 'OWNER'],
  reactivation:       ['SALES_LEADERSHIP', 'MARKETING', 'OPERATIONS', 'OWNER'],
  website_conversion: ['MARKETING', 'OPERATIONS', 'OWNER', 'GENERAL_MANAGER'],
  intake:             ['INTAKE', 'PRACTICE_ADMINISTRATOR', 'OPERATIONS', 'MANAGING_PARTNER'],
};

/** Vertical defaults used when a hypothesis ladder does not apply (routing spec §5). */
const VERTICAL_LADDERS: Record<string, RelationshipClass[]> = {
  hvac:      ['OWNER', 'PRESIDENT', 'GENERAL_MANAGER', 'OPERATIONS', 'OFFICE_MANAGER', 'MARKETING'],
  plumbing:  ['OWNER', 'PRESIDENT', 'GENERAL_MANAGER', 'OPERATIONS', 'OFFICE_MANAGER', 'MARKETING'],
  roofing:   ['OWNER', 'PRESIDENT', 'SALES_LEADERSHIP', 'GENERAL_MANAGER', 'OPERATIONS', 'MARKETING'],
  'collision-repair': ['OWNER', 'GENERAL_MANAGER', 'OPERATIONS', 'MARKETING', 'OFFICE_MANAGER'],
  'pdr-hail': ['OWNER', 'LOCATION_MANAGER', 'SALES_LEADERSHIP', 'OPERATIONS', 'MARKETING'],
  'law-firms': ['INTAKE', 'OPERATIONS', 'PRACTICE_ADMINISTRATOR', 'MANAGING_PARTNER', 'MARKETING'],
  'real-estate-brokerages': ['BROKER_OWNER', 'TEAM_LEADER', 'OPERATIONS', 'ISA_LEADERSHIP', 'MARKETING'],
  electrical: ['OWNER', 'GENERAL_MANAGER', 'OPERATIONS', 'SERVICE_MANAGER', 'OFFICE_MANAGER'],
  dental:    ['OWNER', 'PRACTICE_ADMINISTRATOR', 'OFFICE_MANAGER', 'OPERATIONS', 'MARKETING'],
  'med-spas': ['OWNER', 'PRACTICE_ADMINISTRATOR', 'OPERATIONS', 'MARKETING'],
  restoration: ['OWNER', 'GENERAL_MANAGER', 'OPERATIONS', 'SALES_LEADERSHIP'],
  'garage-door': ['OWNER', 'GENERAL_MANAGER', 'OPERATIONS', 'OFFICE_MANAGER'],
  'general-contractors-remodeling': ['OWNER', 'PRESIDENT', 'SALES_LEADERSHIP', 'OPERATIONS', 'GENERAL_MANAGER'],
};

const GENERIC_LADDER: RelationshipClass[] = [
  'OPERATIONS', 'GENERAL_MANAGER', 'OWNER', 'PRESIDENT', 'OFFICE_MANAGER',
];

/**
 * The ranked target roles for this account. A hypothesis ladder wins when present,
 * because who owns the *problem* matters more than the vertical's usual hierarchy.
 * The vertical ladder is appended so a small firm still resolves to its owner.
 */
export function targetRoleLadder(
  verticalProfileId: string | null, hypothesisCategory: string | null,
): RelationshipClass[] {
  const byHypothesis = hypothesisCategory ? HYPOTHESIS_LADDERS[hypothesisCategory] : undefined;
  const byVertical = verticalProfileId ? VERTICAL_LADDERS[verticalProfileId] : undefined;

  const ladder: RelationshipClass[] = [];
  for (const source of [byHypothesis, byVertical, GENERIC_LADDER]) {
    for (const role of source ?? []) {
      if (!ladder.includes(role)) ladder.push(role);
    }
  }
  return ladder;
}

/** Human-facing label for a role route, e.g. "Operations / GM". */
export function roleRouteLabel(ladder: RelationshipClass[]): string {
  const labels: Partial<Record<RelationshipClass, string>> = {
    OPERATIONS: 'Operations', GENERAL_MANAGER: 'GM', OWNER: 'Owner', PRESIDENT: 'President',
    OFFICE_MANAGER: 'Office Manager', SALES_LEADERSHIP: 'Sales Manager', MARKETING: 'Marketing',
    INTAKE: 'Intake', SERVICE_MANAGER: 'Service Manager', PRACTICE_ADMINISTRATOR: 'Practice Administrator',
    MANAGING_PARTNER: 'Managing Partner', BROKER_OWNER: 'Broker-Owner', LOCATION_MANAGER: 'Location Manager',
    TEAM_LEADER: 'Team Leader', ISA_LEADERSHIP: 'ISA Manager',
  };
  return ladder.slice(0, 2).map((role) => labels[role] ?? role.toLowerCase()).join(' / ');
}
