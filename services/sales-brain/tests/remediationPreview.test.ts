import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityState, classifyAccount, summarize, verticalSupport,
  type AccountBundle, type HumanActivityEvidence,
} from '../src/remediation/classify.js';

const HVAC_TERMS = ['hvac contractor', 'air conditioning repair', 'heating and cooling'];
const HVAC_ALIASES = ['air conditioning', 'AC', 'heating', 'cooling', 'heat pump', 'furnace'];

const NO_ACTIVITY: HumanActivityEvidence = {
  claimed: false, ownershipEvents: 0, activitiesWithActor: 0,
  activitiesWithNotesOrDisposition: 0, followUps: 0, opportunities: 0,
  contactAttempts: 0, meetings: 0, emailsLogged: 0, systemActivities: 2,
};

function bundle(overrides: Partial<AccountBundle> = {}): AccountBundle {
  return {
    accountId: '00000000-0000-0000-0000-000000000001',
    canonicalName: 'Southern Air',
    canonicalDomain: 'southernair.com',
    verticalProfileId: 'hvac',
    entityStatus: 'verified',
    entityStatusBasis: 'resolved from dataforseo discovery',
    researchCompleteness: 'GOOD',
    discoveredForGeographyType: 'zip_zcta',
    discoveredForGeography: '32810',
    candidateSourceClasses: ['BUSINESS_LISTING'],
    candidateResolvedNames: [{ name: 'Southern Air', basis: 'provider_listing' }],
    observations: [{
      resultType: 'local_result', category: null, position: 3,
      query: 'HVAC contractor 32810', observedName: 'Southern Air',
      observedDomain: 'southernair.com', observedPhone: '+14075550150',
      observedLocation: null,
    }],
    verticalTerms: HVAC_TERMS,
    serviceAliases: HVAC_ALIASES,
    emails: [],
    phoneCount: 2,
    locationCount: 0,
    locationClaims: { total: 0, withStreet: 0, withBasis: 0 },
    latestResearch: { status: 'completed', pagesFetched: 6, pagesBlocked: 0, completedAt: null },
    humanActivity: NO_ACTIVITY,
    ...overrides,
  };
}

/* ------------------------------------------------------------------- activity --- */

test('a score written by the scoring pipeline is not a person having worked the Account', () => {
  // manual_score/manual_tier are set on every Account by src/scoring/score.ts. They are
  // deliberately absent from HumanActivityEvidence: reading them as human input would
  // mark the whole inventory untouchable and stop remediation before it started.
  assert.equal(activityState(NO_ACTIVITY), 'system_activity_only');
  assert.equal(activityState({ ...NO_ACTIVITY, systemActivities: 0 }), 'no_activity');
});

test('every kind of human sales action counts, and research events do not', () => {
  const human: (keyof HumanActivityEvidence)[] = [
    'ownershipEvents', 'activitiesWithActor', 'activitiesWithNotesOrDisposition',
    'followUps', 'opportunities', 'contactAttempts', 'meetings', 'emailsLogged',
  ];
  for (const field of human) {
    assert.equal(activityState({ ...NO_ACTIVITY, [field]: 1 }), 'human_sales_activity',
      `${field} should count as human sales activity`);
  }
  assert.equal(activityState({ ...NO_ACTIVITY, claimed: true }), 'human_sales_activity');
  assert.equal(activityState({ ...NO_ACTIVITY, systemActivities: 500 }), 'system_activity_only');
});

test('a worked Account is never proposed for a mechanical rewrite', () => {
  const worked = classifyAccount(bundle({
    observations: [{
      resultType: 'organic', category: null, position: 51, query: 'HVAC contractor 33127',
      observedName: 'U-Move Rentals', observedDomain: 'umove.com', observedPhone: null,
      observedLocation: null,
    }],
    candidateSourceClasses: ['OFFICIAL_SITE'],
    humanActivity: { ...NO_ACTIVITY, contactAttempts: 1 },
  }));
  assert.equal(worked.activityState, 'human_sales_activity');
  assert.ok(worked.findings.every((f) => f.reviewRequired),
    'every finding on a worked Account must require review');
  assert.ok(worked.findings.some((f) => f.proposedAction.includes('a person has worked this Account')));
});

/* ------------------------------------------------------------------- verticals --- */

test('an organic ranking alone does not support the trade it ranked for', () => {
  const verdict = classifyAccount(bundle({
    canonicalName: 'U-Move Rentals',
    observations: [{
      resultType: 'organic', category: null, position: 51, query: 'HVAC contractor 33127',
      observedName: 'U-Move Rentals', observedDomain: 'umove.com', observedPhone: null,
      observedLocation: null,
    }],
    candidateSourceClasses: ['OFFICIAL_SITE'],
  }));
  const finding = verdict.findings.find((f) => f.code === 'VERTICAL_FROM_QUERY_ONLY');
  assert.ok(finding, 'expected a wrong-vertical finding');
  assert.equal(finding.remediationClass, 'B');
  assert.match(finding.proposedAction, /clear primary_vertical_profile_id/);
});

test('a provider listing supports the trade, so a good Account is left alone', () => {
  const verdict = classifyAccount(bundle());
  assert.equal(verdict.primaryClass, 'A');
  assert.equal(verdict.findings.length, 1);
  assert.equal(verdict.findings[0]?.proposedAction, 'no action');
});

test('the listing has to be the observation that supports it, not any observation', () => {
  // The Account has a BUSINESS_LISTING candidate but the only observation is organic.
  // Reading providerListing off the Account rather than off the row would let the
  // listing vouch for a page it has nothing to do with.
  const support = verticalSupport(bundle({
    candidateSourceClasses: ['BUSINESS_LISTING'],
    observations: [{
      resultType: 'organic', category: null, position: 40, query: 'HVAC contractor 33127',
      observedName: 'Unrelated Co', observedDomain: 'unrelated.com', observedPhone: null,
      observedLocation: null,
    }],
  }));
  assert.equal(support.supported, false);
});

/* ----------------------------------------------------------------------- names --- */

test('a SERP title is recognised as page copy and never rewritten unreviewed', () => {
  const verdict = classifyAccount(bundle({
    canonicalName: 'Southern Air | AC Repair & Installation in Orlando FL | Call Now',
    candidateResolvedNames: [{ name: 'Southern Air', basis: 'provider_listing' }],
  }));
  const finding = verdict.findings.find((f) => f.code === 'CANONICAL_NAME_IS_PAGE_COPY');
  assert.ok(finding);
  assert.equal(finding.reviewRequired, true, 'a rep reads the name aloud; a person signs it off');
  assert.match(finding.proposedAction, /Southern Air/);
});

test('a worse alternative is not offered as the fix', () => {
  // Production holds candidates whose resolved_name is itself a page title, sometimes
  // from another company entirely. Proposing one of those would replace a bad name
  // with a wrong one.
  const verdict = classifyAccount(bundle({
    canonicalName: 'Comfort Pro LLC | HVAC',
    candidateResolvedNames: [{ name: 'Comfort Pro: HVAC Contractor in Tampa', basis: 'own_site_title' }],
  }));
  const finding = verdict.findings.find((f) => f.code === 'CANONICAL_NAME_IS_PAGE_COPY');
  assert.ok(finding);
  assert.match(finding.proposedAction, /no defensible alternative/);
});

test('an ordinary company name is not mistaken for page copy', () => {
  for (const name of ['Del-Air Heating & Air Conditioning', 'Chavez & Sons', '4 Seasons Air Conditioning and Heating']) {
    const verdict = classifyAccount(bundle({ canonicalName: name, candidateResolvedNames: [] }));
    assert.ok(!verdict.findings.some((f) => f.code === 'CANONICAL_NAME_IS_PAGE_COPY'),
      `"${name}" should not be flagged as page copy`);
  }
});

/* ------------------------------------------------------------------ non-company --- */

test('a listicle, an article and a category page are not companies', () => {
  for (const [name, domain] of [
    ['10 Best Roofers in St. Augustine, FL', 'todayshomeowner.com'],
    ['An 82-year-old Vietnam veteran in St. Augustine says he\'s owed', null],
    ['Apartments for Rent in 33133 - Miami, FL', 'rent.com'],
  ] as [string, string | null][]) {
    const verdict = classifyAccount(bundle({
      canonicalName: name, canonicalDomain: domain, candidateSourceClasses: [],
      candidateResolvedNames: [],
    }));
    assert.ok(verdict.findings.some((f) => f.code === 'NON_COMPANY_ENTITY'),
      `"${name}" should be flagged as a non-company`);
  }
});

test('a non-company is suppressed and quarantined, never deleted', () => {
  const verdict = classifyAccount(bundle({
    canonicalName: '10 Best Roofers in St. Augustine, FL',
    canonicalDomain: 'todayshomeowner.com', candidateSourceClasses: [], candidateResolvedNames: [],
  }));
  const finding = verdict.findings.find((f) => f.code === 'NON_COMPANY_ENTITY');
  assert.ok(finding);
  assert.match(finding.proposedAction, /do not delete/);
});

test('an unpromotable source class alone makes it a non-company', () => {
  const verdict = classifyAccount(bundle({ candidateSourceClasses: ['DIRECTORY'] }));
  assert.ok(verdict.findings.some((f) => f.code === 'NON_COMPANY_ENTITY'));
});

/* ------------------------------------------------------------------- endpoints --- */

test('a company mailbox recorded as a person is a stale classification', () => {
  const verdict = classifyAccount(bundle({
    emails: [{
      endpointId: 'e1', normalizedValue: 'donations@example.com',
      persistedRole: 'DIRECT_PERSON_EMAIL', attributedToPersonName: null,
    }],
  }));
  const finding = verdict.findings.find((f) => f.code === 'ENDPOINT_ROLE_PREDATES_RULE');
  assert.ok(finding);
  assert.equal(finding.remediationClass, 'F');
  assert.match(finding.reason, /no person attributed/);
});

test('an endpoint that still classifies the same way is not flagged', () => {
  const verdict = classifyAccount(bundle({
    emails: [{
      endpointId: 'e1', normalizedValue: 'info@example.com',
      persistedRole: 'GENERAL_BUSINESS_EMAIL', attributedToPersonName: null,
    }],
  }));
  assert.ok(!verdict.findings.some((f) => f.code === 'ENDPOINT_ROLE_PREDATES_RULE'));
});

test('a person attribution keeps DIRECT_PERSON_EMAIL standing', () => {
  const verdict = classifyAccount(bundle({
    emails: [{
      endpointId: 'e1', normalizedValue: 'h.guerrero@example.com',
      persistedRole: 'DIRECT_PERSON_EMAIL', attributedToPersonName: 'Hector Guerrero',
    }],
  }));
  assert.ok(!verdict.findings.some((f) => f.code === 'ENDPOINT_ROLE_PREDATES_RULE'));
});

/* -------------------------------------------------------------------- research --- */

test('research that read nothing cannot be reported as GOOD', () => {
  const verdict = classifyAccount(bundle({
    latestResearch: { status: 'partial', pagesFetched: 0, pagesBlocked: 4, completedAt: null },
  }));
  const finding = verdict.findings.find((f) => f.code === 'RESEARCH_STATE_OVERSTATED');
  assert.ok(finding);
  assert.equal(finding.remediationClass, 'G');
});

test('a completeness label with no run behind it is flagged', () => {
  const verdict = classifyAccount(bundle({ latestResearch: null }));
  assert.ok(verdict.findings.some((f) => f.code === 'RESEARCH_STATE_WITHOUT_RUN'));
});

/* --------------------------------------------------------------------- verdict --- */

test('the worst finding decides the primary class', () => {
  const verdict = classifyAccount(bundle({
    canonicalName: '10 Best Roofers in St. Augustine, FL',
    canonicalDomain: 'todayshomeowner.com',
    entityStatus: 'legacy_unverified',
    candidateSourceClasses: [], candidateResolvedNames: [],
    observations: [{
      resultType: 'organic', category: null, position: 62, query: 'roofing contractor 32095',
      observedName: null, observedDomain: null, observedPhone: null, observedLocation: null,
    }],
  }));
  assert.equal(verdict.primaryClass, 'D', 'whether it is a company is asked before anything else');
  const classes = new Set(verdict.findings.map((f) => f.remediationClass));
  assert.ok(classes.has('B') && classes.has('E'), 'the other findings survive alongside it');
});

test('a low-confidence finding always raises a human-review finding', () => {
  const verdict = classifyAccount(bundle({
    canonicalName: 'Roofing Near Me',  // one signal only
    candidateSourceClasses: ['OFFICIAL_SITE'], candidateResolvedNames: [],
  }));
  assert.ok(verdict.findings.some((f) => f.remediationClass === 'H'));
});

test('the summary counts each Account once per class it is in', () => {
  const verdicts = [
    classifyAccount(bundle()),
    classifyAccount(bundle({
      accountId: '00000000-0000-0000-0000-000000000002',
      emails: [
        { endpointId: 'a', normalizedValue: 'donations@x.com', persistedRole: 'DIRECT_PERSON_EMAIL', attributedToPersonName: null },
        { endpointId: 'b', normalizedValue: 'billing@x.com', persistedRole: 'DIRECT_PERSON_EMAIL', attributedToPersonName: null },
      ],
    })),
  ];
  const summary = summarize(verdicts);
  assert.equal(summary.total, 2);
  assert.equal(summary.byFindingClass['F'], 1, 'two stale endpoints on one Account is one affected Account');
  assert.equal(summary.byCode['ENDPOINT_ROLE_PREDATES_RULE'], 1, 'and one finding');
  assert.equal(summary.activity.human_sales_activity, 0);
});

test('a location with no street and no source is a claim nobody can account for', () => {
  // Production holds 66 of these: one per legacy Roofing Account, all carrying ZIP
  // 32095, which is the ZIP the canary searched and not something any company said.
  const verdict = classifyAccount(bundle({
    locationCount: 0,
    locationClaims: { total: 1, withStreet: 0, withBasis: 0 },
  }));
  const finding = verdict.findings.find((f) => f.code === 'LOCATION_WITHOUT_PROVENANCE');
  assert.ok(finding, 'an unsupported place claim was not reported');
  assert.equal(finding!.reviewRequired, true);

  // A published address with its basis recorded is not a finding.
  const clean = classifyAccount(bundle({
    locationCount: 1,
    locationClaims: { total: 1, withStreet: 1, withBasis: 1 },
  }));
  assert.equal(clean.findings.some((f) => f.code === 'LOCATION_WITHOUT_PROVENANCE'), false);
});
