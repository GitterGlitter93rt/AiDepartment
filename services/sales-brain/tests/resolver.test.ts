import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, type ReconcileInput } from '../src/resolver/reconcile.js';
import { relationshipFromTitle, targetRoleLadder } from '../src/resolver/roles.js';
import type { EndpointObservation, PersonObservation } from '../src/resolver/types.js';

/**
 * Regression suite for public-first decision-maker resolution.
 * Every case below is one fixture from
 * docs/09-software/outbound-sales-brain-public-contact-resolution-fixtures.v1.yaml,
 * including its `hard_fail_if` conditions asserted as explicit negatives.
 */

const NOW = new Date();

function person(
  personName: string | null, rawTitle: string | null, sourceClass: PersonObservation['sourceClass'],
  overrides: Partial<PersonObservation> = {},
): PersonObservation {
  return {
    personName,
    rawTitle,
    relationship: overrides.relationship ?? relationshipFromTitle(rawTitle),
    sourceClass,
    sourceReference: overrides.sourceReference ?? 'https://example.com/team',
    observedAt: NOW,
    freshness: overrides.freshness ?? 'FRESH',
    scope: overrides.scope ?? 'ACCOUNT',
    locationHint: overrides.locationHint ?? null,
    departed: overrides.departed ?? false,
    notes: null,
  };
}

function phone(
  value: string, sourceClass: EndpointObservation['sourceClass'],
  overrides: Partial<EndpointObservation> = {},
): EndpointObservation {
  return {
    kind: 'PHONE', value, sourceClass,
    sourceReference: 'https://example.com/contact',
    observedAt: NOW, freshness: overrides.freshness ?? 'FRESH',
    isMainLine: overrides.isMainLine ?? true,
    attributedToPersonName: overrides.attributedToPersonName ?? null,
    explicitlyPersonal: overrides.explicitlyPersonal ?? false,
    extension: overrides.extension ?? null,
    dubiousSource: overrides.dubiousSource ?? false,
  };
}

function email(
  value: string, sourceClass: EndpointObservation['sourceClass'],
  overrides: Partial<EndpointObservation> = {},
): EndpointObservation {
  return {
    kind: 'EMAIL', value, sourceClass,
    sourceReference: 'https://example.com/team',
    observedAt: NOW, freshness: 'FRESH',
    attributedToPersonName: overrides.attributedToPersonName ?? null,
    explicitlyPersonal: overrides.explicitlyPersonal ?? false,
    isMainLine: false, extension: null,
    dubiousSource: false,
  };
}

function run(input: Partial<ReconcileInput> & Pick<ReconcileInput, 'people' | 'endpoints'>) {
  return reconcile({
    companyName: input.companyName ?? 'Test Co',
    verticalProfileId: input.verticalProfileId ?? 'hvac',
    hypothesisCategory: input.hypothesisCategory ?? null,
    people: input.people,
    endpoints: input.endpoints,
    targetLocation: input.targetLocation ?? null,
    paidEnrichmentAvailable: input.paidEnrichmentAvailable ?? false,
  });
}

// --- fixture: owner_confirmed_no_direct_phone --------------------------------
test('owner confirmed, no direct phone: main line route, never labelled direct', () => {
  const result = run({
    companyName: 'ABC Air LLC',
    hypothesisCategory: 'after_hours',
    people: [
      person('John Smith', 'Founder and Owner', 'COMPANY_FIRST_PARTY'),
      person('John Smith', 'Manager', 'PUBLIC_COMPANY_REGISTRY', { relationship: 'MANAGER' }),
    ],
    endpoints: [phone('9045550100', 'COMPANY_FIRST_PARTY', { isMainLine: true })],
  });

  assert.equal(result.primary?.personName, 'John Smith');
  assert.equal(result.primary?.employerMatch, 'CONFIRMED');
  assert.equal(result.status, 'NAMED_MAINLINE_ROUTE_READY');

  const path = result.contactPaths[0]!;
  assert.equal(path.relationshipToPerson, 'COMPANY_ROUTE');
  // hard_fail_if: main line labeled as John Smith direct number
  assert.notEqual(path.relationshipToPerson, 'DIRECT_CONFIRMED');
  assert.notEqual(path.endpointRole, 'DIRECT_BUSINESS_LINE');
  assert.equal(path.askFor, 'John Smith', 'the rep is told who to ask for');
});

// --- fixture: registered_agent_is_not_owner ----------------------------------
test('a registered agent is never promoted to owner or targeted', () => {
  const result = run({
    companyName: 'Sunshine Roofing LLC',
    verticalProfileId: 'roofing',
    hypothesisCategory: 'unsold_estimate',
    people: [
      person('Legal Services Inc', 'Registered Agent', 'PUBLIC_COMPANY_REGISTRY'),
      person('Maria Lopez', 'President', 'COMPANY_FIRST_PARTY'),
    ],
    endpoints: [phone('9045550700', 'COMPANY_FIRST_PARTY')],
  });

  assert.equal(result.primary?.personName, 'Maria Lopez');
  assert.equal(result.primary?.relationship, 'PRESIDENT');
  // hard_fail_if: registered agent promoted to owner / used as a cold sales target
  assert.equal(result.alternates.some((a) => a.personName === 'Legal Services Inc'), false);
  const exclusion = result.excluded.find((e) => e.personName === 'Legal Services Inc');
  assert.ok(exclusion, 'the exclusion is recorded, not silent');
  assert.match(exclusion!.reason, /filing relationship/i);
});

// --- fixture: qualifier_plus_founder_reinforces_identity ---------------------
test('a licence qualifier reinforces identity without proving workflow ownership', () => {
  const result = run({
    companyName: 'Cool Breeze Mechanical',
    hypothesisCategory: 'after_hours',
    people: [
      person('David Green', 'Qualifying Contractor', 'PUBLIC_LICENSE_REGISTRY'),
      person('David Green', 'Founder', 'COMPANY_FIRST_PARTY'),
    ],
    endpoints: [phone('9045550200', 'COMPANY_FIRST_PARTY')],
  });

  assert.equal(result.primary?.personName, 'David Green');
  assert.equal(result.primary?.employerMatch, 'CONFIRMED');
  assert.equal(result.status, 'NAMED_MAINLINE_ROUTE_READY');
  // The founder relationship carries the routing; the qualifier record does not.
  assert.equal(result.primary?.relationship, 'FOUNDER');
});

test('a qualifier with no other evidence never becomes the operational target', () => {
  const result = run({
    hypothesisCategory: 'after_hours',
    people: [
      person('Pat Holder', 'Qualifying Contractor', 'PUBLIC_LICENSE_REGISTRY'),
      person('Sam Ops', 'Operations Manager', 'COMPANY_FIRST_PARTY'),
    ],
    endpoints: [phone('9045550201', 'COMPANY_FIRST_PARTY')],
  });
  assert.equal(result.primary?.personName, 'Sam Ops');
  assert.equal(result.alternates[0]?.personName, 'Pat Holder');
  assert.equal(result.alternates[0]?.roleMatch, 'WEAK');
});

// --- fixture: operations_beats_owner_for_hypothesis --------------------------
test('operations outranks the owner when operations owns the problem', () => {
  const result = run({
    companyName: 'Metro Plumbing',
    verticalProfileId: 'plumbing',
    hypothesisCategory: 'crm_workflow',
    people: [
      person('Chris White', 'Owner', 'COMPANY_FIRST_PARTY'),
      person('Ashley Brown', 'Director of Operations', 'COMPANY_FIRST_PARTY'),
    ],
    endpoints: [
      email('ashley@metroplumbing.example.com', 'COMPANY_FIRST_PARTY', {
        attributedToPersonName: 'Ashley Brown',
      }),
      phone('9045550801', 'COMPANY_FIRST_PARTY'),
    ],
  });

  // hard_fail_if: owner always outranks operations regardless of hypothesis
  assert.equal(result.primary?.personName, 'Ashley Brown');
  assert.equal(result.primary?.relationship, 'OPERATIONS');
  assert.equal(result.primary?.roleMatch, 'PRIMARY_PROCESS_OWNER');
  assert.equal(result.alternates[0]?.personName, 'Chris White');
  assert.equal(result.status, 'NAMED_EMAIL_READY');
});

test('the same two people flip when the hypothesis changes', () => {
  const people = [
    person('Chris White', 'Owner', 'COMPANY_FIRST_PARTY'),
    person('Ashley Brown', 'Director of Operations', 'COMPANY_FIRST_PARTY'),
  ];
  const marketing = run({ verticalProfileId: 'plumbing', hypothesisCategory: 'paid_acquisition', people, endpoints: [] });
  const dispatch = run({ verticalProfileId: 'plumbing', hypothesisCategory: 'missed_call', people, endpoints: [] });

  assert.equal(dispatch.primary?.personName, 'Ashley Brown', 'operations owns missed calls');
  // With no marketing person present, operations is still the better route than the
  // owner for a paid-acquisition conversation, but the ladder differs.
  assert.equal(marketing.targetRoles[0], 'MARKETING');
  assert.equal(dispatch.targetRoles[0], 'OPERATIONS');
});

// --- fixture: stale_owner_conflicts_with_current_website ---------------------
test('a stale directory name never overrides the current first-party page', () => {
  const result = run({
    companyName: 'Coastal HVAC',
    hypothesisCategory: 'speed_to_lead',
    people: [
      person('Robert King', 'Owner', 'PUBLIC_BUSINESS_DIRECTORY', { freshness: 'STALE' }),
      person('Dana King', 'President', 'COMPANY_FIRST_PARTY', { freshness: 'FRESH' }),
    ],
    endpoints: [phone('9045550900', 'COMPANY_FIRST_PARTY')],
  });

  assert.equal(result.primary?.personName, 'Dana King');
  assert.equal(result.status, 'NAMED_MAINLINE_ROUTE_READY');
  // hard_fail_if: Robert personalized as current owner without refresh
  assert.equal(result.alternates.some((a) => a.personName === 'Robert King'), false);
  assert.ok(result.stale.some((s) => s.personName === 'Robert King'), 'kept as stale, not deleted');
});

// --- fixture: no_name_role_route_is_valid ------------------------------------
test('no named person is a valid role route, not a failure', () => {
  const result = run({
    companyName: 'Quick Fix AC',
    hypothesisCategory: 'after_hours',
    people: [],
    endpoints: [phone('9045550300', 'COMPANY_FIRST_PARTY')],
  });

  assert.equal(result.status, 'ROLE_ROUTE_READY');
  // hard_fail_if: invented decision maker name
  assert.equal(result.primary?.personName, null);
  assert.equal(result.primary?.isRolePlaceholder, true);
  assert.equal(result.primary?.relationship, 'OPERATIONS');
  assert.equal(result.contactPaths[0]?.relationshipToPerson, 'COMPANY_ROUTE');
  // hard_fail_if: account removed from human assist solely because no person found
  assert.ok(result.contactPaths.length > 0, 'the account remains contactable');
});

// --- fixture: published_business_mobile_can_be_direct ------------------------
test('a number the company explicitly publishes as personal is a direct line', () => {
  const result = run({
    companyName: 'Smith Roofing',
    verticalProfileId: 'roofing',
    hypothesisCategory: 'speed_to_lead',
    people: [person('Jane Smith', 'Owner', 'COMPANY_FIRST_PARTY')],
    endpoints: [
      phone('9045550400', 'COMPANY_FIRST_PARTY', {
        attributedToPersonName: 'Jane Smith', explicitlyPersonal: true, isMainLine: false,
      }),
    ],
  });

  assert.equal(result.primary?.personName, 'Jane Smith');
  assert.equal(result.status, 'NAMED_DIRECT_READY');
  assert.equal(result.contactPaths[0]?.relationshipToPerson, 'DIRECT_CONFIRMED');
  assert.equal(result.contactPaths[0]?.endpointRole, 'DIRECT_BUSINESS_LINE');
  assert.equal(result.contactPaths[0]?.askFor, null, 'no front-desk routing needed');
});

test('a number merely sitting next to a name is not promoted to a direct line', () => {
  const result = run({
    people: [person('Jane Smith', 'Owner', 'COMPANY_FIRST_PARTY')],
    endpoints: [
      // Attributed by proximity on the page, but not explicitly presented as hers.
      phone('9045550401', 'COMPANY_FIRST_PARTY', {
        attributedToPersonName: 'Jane Smith', explicitlyPersonal: false, isMainLine: true,
      }),
    ],
  });
  assert.equal(result.contactPaths[0]?.relationshipToPerson, 'COMPANY_ROUTE');
  assert.equal(result.status, 'NAMED_MAINLINE_ROUTE_READY');
});

// --- fixture: unrelated_personal_number_rejected -----------------------------
test('a people-search personal number is rejected outright', () => {
  const result = run({
    companyName: 'Atlas Restoration',
    verticalProfileId: 'restoration',
    hypothesisCategory: 'speed_to_lead',
    people: [person('Mark Hall', 'General Manager', 'COMPANY_FIRST_PARTY')],
    endpoints: [
      phone('9045550100', 'COMPANY_FIRST_PARTY'),
      phone('9045550500', 'SEARCH_RESULT_DISCOVERY', {
        attributedToPersonName: 'Mark Hall', explicitlyPersonal: true, dubiousSource: true,
      }),
    ],
  });

  assert.equal(result.primary?.personName, 'Mark Hall');
  assert.equal(result.status, 'NAMED_MAINLINE_ROUTE_READY');
  // hard_fail_if: dubious personal number stored as business direct line
  assert.equal(result.contactPaths.some((p) => p.value === '+19045550500'), false);
  assert.equal(result.contactPaths.length, 1);
  assert.ok(result.notes.some((note) => /people-search/i.test(note)));
});

// --- fixture: guessed_email_not_smartlead_ready ------------------------------
test('a guessed email stays unverified and does not make the account email ready', () => {
  const result = run({
    companyName: 'Northside Electric',
    verticalProfileId: 'electrical',
    hypothesisCategory: 'follow_up',
    people: [person('Erin Lee', 'Operations Manager', 'COMPANY_FIRST_PARTY')],
    endpoints: [
      phone('9045551000', 'COMPANY_FIRST_PARTY'),
      email('erin.lee@northside.example.com', 'DERIVED_PATTERN', {
        attributedToPersonName: 'Erin Lee',
      }),
    ],
  });

  const guessed = result.contactPaths.find((p) => p.kind === 'EMAIL')!;
  // hard_fail_if: guessed email labeled verified
  assert.equal(guessed.qualityState, 'GUESSED_UNVERIFIED');
  assert.equal(guessed.relationshipToPerson, 'UNVERIFIED');
  // hard_fail_if: guessed email auto-exported under verified-email policy
  assert.equal(result.status, 'NAMED_MAINLINE_ROUTE_READY', 'a guess never yields NAMED_EMAIL_READY');
});

// --- fixture: gatekeeper_correction_becomes_current --------------------------
test('a gatekeeper correction outranks a stale directory listing', () => {
  const result = run({
    companyName: 'River City HVAC',
    hypothesisCategory: 'follow_up',
    people: [
      person('Tom Reed', 'Sales Manager', 'PUBLIC_BUSINESS_DIRECTORY', { freshness: 'AGING' }),
      person('Tom Reed', null, 'PROSPECT_OR_GATEKEEPER_SUPPLIED', {
        relationship: 'SALES_LEADERSHIP', departed: true,
      }),
      person('Lisa Chen', 'Sales Manager', 'PROSPECT_OR_GATEKEEPER_SUPPLIED'),
    ],
    endpoints: [
      phone('9045551100', 'PROSPECT_OR_GATEKEEPER_SUPPLIED', { extension: '204' }),
    ],
  });

  assert.equal(result.primary?.personName, 'Lisa Chen');
  assert.equal(result.primary?.relationship, 'SALES_LEADERSHIP');
  assert.equal(result.contactPaths[0]?.extension, '204');
  // hard_fail_if: stale directory overwrites gatekeeper correction
  assert.ok(result.stale.some((s) => s.personName === 'Tom Reed'));
  assert.notEqual(result.primary?.personName, 'Tom Reed');
});

// --- fixture: franchise_corporate_executive_not_local_target -----------------
test('a corporate executive is not the target for a single location workflow', () => {
  const result = run({
    companyName: 'Franchise HVAC Jacksonville LLC',
    hypothesisCategory: 'after_hours',
    targetLocation: 'Jacksonville',
    people: [
      person('Alex Global', 'CEO', 'PUBLIC_BUSINESS_NEWS', { scope: 'MARKET' }),
      person('Taylor Jones', 'Location Manager', 'COMPANY_FIRST_PARTY', {
        scope: 'LOCATION', locationHint: 'Jacksonville',
      }),
    ],
    endpoints: [phone('9045551200', 'COMPANY_FIRST_PARTY')],
  });

  assert.equal(result.primary?.personName, 'Taylor Jones');
  assert.equal(result.primary?.relationship, 'LOCATION_MANAGER');
  // hard_fail_if: corporate executive targeted for local workflow without control evidence
  assert.notEqual(result.primary?.personName, 'Alex Global');
});

// --- fixture: multi_location_scope_match -------------------------------------
test('a location GM beats corporate marketing for a front-office problem', () => {
  const result = run({
    companyName: 'Statewide Collision Group',
    verticalProfileId: 'collision-repair',
    hypothesisCategory: 'customer_communication',
    targetLocation: 'Jacksonville',
    people: [
      person('Paul West', 'Corporate Marketing Director', 'COMPANY_FIRST_PARTY', { scope: 'ACCOUNT' }),
      person('Renee Davis', 'Jacksonville General Manager', 'COMPANY_FIRST_PARTY', {
        scope: 'LOCATION', locationHint: 'Jacksonville',
      }),
    ],
    endpoints: [phone('9045551300', 'COMPANY_FIRST_PARTY')],
  });

  // hard_fail_if: corporate marketing selected for a location front-office issue
  assert.equal(result.primary?.personName, 'Renee Davis');
  assert.equal(result.primary?.relationship, 'GENERAL_MANAGER');
  assert.ok(result.alternates.some((a) => a.personName === 'Paul West'));
});

// --- fixture: paid_enrichment_optional_not_required --------------------------
test('a Tier A account is never blocked because a paid provider is unavailable', () => {
  const input = {
    companyName: 'Premium Air Services',
    hypothesisCategory: 'speed_to_lead',
    people: [person('Samantha Reed', 'Director of Operations', 'COMPANY_FIRST_PARTY')],
    endpoints: [phone('9045550600', 'COMPANY_FIRST_PARTY')],
  };

  const publicOnly = run({ ...input, paidEnrichmentAvailable: false });
  // hard_fail_if: account blocked solely because Apollo is unavailable
  assert.equal(publicOnly.status, 'NAMED_MAINLINE_ROUTE_READY');
  assert.equal(publicOnly.primary?.personName, 'Samantha Reed');
  assert.equal(publicOnly.paidEnrichmentWouldHelp, false, 'not offered when not enabled');

  const paidAllowed = run({ ...input, paidEnrichmentAvailable: true });
  assert.equal(paidAllowed.status, 'NAMED_MAINLINE_ROUTE_READY', 'the public result is unchanged');
  assert.equal(paidAllowed.paidEnrichmentWouldHelp, true, 'offered as an optional improvement');
});

// --- supporting: title normalization -----------------------------------------
test('title normalization keeps evidence relationships out of operational roles', () => {
  assert.equal(relationshipFromTitle('Registered Agent'), 'REGISTERED_AGENT');
  assert.equal(relationshipFromTitle('Qualifying Contractor'), 'QUALIFIER');
  assert.equal(relationshipFromTitle('Director of Operations'), 'OPERATIONS');
  assert.equal(relationshipFromTitle('COO'), 'OPERATIONS');
  assert.equal(relationshipFromTitle('General Manager'), 'GENERAL_MANAGER');
  assert.equal(relationshipFromTitle('Managing Partner'), 'MANAGING_PARTNER');
  assert.equal(relationshipFromTitle('Intake Director'), 'INTAKE');
  assert.equal(relationshipFromTitle('Owner'), 'OWNER');
  assert.equal(relationshipFromTitle('Chief Marketing Officer'), 'MARKETING');
  assert.equal(relationshipFromTitle('Chief Operating Officer'), 'OPERATIONS');
  assert.equal(relationshipFromTitle('Chief Revenue Officer'), 'SALES_LEADERSHIP');
  // A plain officer stays an evidence relationship, not an operational role.
  assert.equal(relationshipFromTitle('Corporate Officer'), 'OFFICER');
  assert.equal(relationshipFromTitle('Treasurer'), 'OFFICER');
  assert.equal(relationshipFromTitle(null), 'OTHER_BUSINESS_ROLE');
  assert.equal(relationshipFromTitle('Widget Polisher'), 'OTHER_BUSINESS_ROLE');
});

test('routing ladders put problem ownership ahead of prestige', () => {
  assert.equal(targetRoleLadder('hvac', 'missed_call')[0], 'OPERATIONS');
  assert.equal(targetRoleLadder('roofing', 'unsold_estimate')[0], 'SALES_LEADERSHIP');
  assert.equal(targetRoleLadder('law-firms', 'intake')[0], 'INTAKE');
  assert.equal(targetRoleLadder('hvac', 'paid_acquisition')[0], 'MARKETING');
  // With no hypothesis, the vertical default applies.
  assert.equal(targetRoleLadder('hvac', null)[0], 'OWNER');
});
