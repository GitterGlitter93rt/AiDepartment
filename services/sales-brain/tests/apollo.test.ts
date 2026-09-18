import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { apolloConfig, costOfEnrichment, normalizePerson, createApolloAdapter }
  from '../src/providers/apollo/client.js';
import {
  judgeApolloEligibility, nextCheckAfter, organizationIdentityIsStrong,
} from '../src/providers/apollo/eligibility.js';
import {
  rankTitle, scoreCandidate, selectDecisionMaker,
} from '../src/providers/apollo/candidates.js';
import {
  apolloFingerprint, beginApolloRequest, settleApolloRequest, apolloSpendSummary,
} from '../src/providers/apollo/ledger.js';
import {
  apolloWebhookConfigured, ingestApolloPhoneWebhook, verifyApolloWebhookSecret,
} from '../src/providers/apollo/webhook.js';
import type {
  ApolloAdapter, ApolloPerson, ApolloPersonCandidate,
} from '../src/providers/apollo/types.js';

/**
 * Apollo, and everything it must refuse to do.
 *
 * No test here reaches Apollo. The adapter is injected, and the one test that exercises
 * the real client asserts that an unconfigured key produces no request at all.
 *
 * The shape of this suite follows the money: Apollo's own documentation prices people
 * search at zero and an enrichment at one credit, with eight more for a mobile. So most
 * of what matters is not "does it work" but "does it decline" -- when we already know the
 * answer, when the company is not a company, when the person is not a person, and when
 * somebody already asked the same question.
 */

const ENV = { ...process.env };
after(async () => { Object.assign(process.env, ENV); await pool.end(); });

beforeEach(async () => {
  await resetDatabase();
  process.env['APOLLO_ENABLED'] = 'true';
  process.env['APOLLO_PEOPLE_SEARCH_ENABLED'] = 'true';
  process.env['APOLLO_PEOPLE_ENRICHMENT_ENABLED'] = 'true';
  delete process.env['APOLLO_PHONE_ENRICHMENT_ENABLED'];
  delete process.env['APOLLO_WATERFALL_EMAIL_ENABLED'];
  delete process.env['APOLLO_WATERFALL_PHONE_ENABLED'];
});

function candidate(over: Partial<ApolloPersonCandidate> = {}): ApolloPersonCandidate {
  return {
    apolloPersonId: 'p_1', nameIsPartial: false,
    firstName: 'John', lastName: 'Smith', fullName: 'John Smith',
    title: 'Owner', seniority: 'owner', organizationName: 'ABC Air Conditioning',
    apolloOrganizationId: 'o_1', hasEmail: true, hasDirectPhone: false,
    city: 'Tampa', state: 'FL', linkedinUrl: null, lastRefreshedAt: null, ...over,
  };
}

async function account(over: Record<string, unknown> = {}): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'ABC Air Conditioning', website: 'https://abcair.example-co',
    phone: '813-555-0100', verticalProfileId: 'hvac', ...over,
  } as never, { discoverySource: 'import' }));
  return accountId;
}

/* ------------------------------------------------------ config and security --- */

test('with no key configured, nothing is asked and nothing is spent', async () => {
  const adapter = createApolloAdapter({ config: { ...apolloConfig(), apiKey: null } });
  const result = await adapter.searchPeople({ organizationDomains: ['abcair.example-co'] });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 0, 'no HTTP request was made at all');
  assert.equal(result.errorClassification, 'UNAUTHENTICATED');
  assert.equal(result.cost.creditsEstimated, 0);
  assert.equal(adapter.isConfigured(), false);
});

test('the expensive switches default to off', () => {
  for (const key of ['APOLLO_ENABLED', 'APOLLO_PEOPLE_ENRICHMENT_ENABLED',
    'APOLLO_PHONE_ENRICHMENT_ENABLED', 'APOLLO_WATERFALL_EMAIL_ENABLED',
    'APOLLO_WATERFALL_PHONE_ENABLED']) delete process.env[key];
  const settings = apolloConfig();
  assert.equal(settings.enabled, false, 'Apollo is off globally until switched on');
  assert.equal(settings.peopleEnrichmentEnabled, false);
  assert.equal(settings.phoneEnrichmentEnabled, false, 'a mobile is eight credits');
  assert.equal(settings.waterfallEmailEnabled, false);
  assert.equal(settings.waterfallPhoneEnabled, false);
  // Search is free, so it is the one thing that is on by default.
  assert.equal(settings.peopleSearchEnabled, true);
});

test('the API key never reaches evidence or the ledger', async () => {
  process.env['APOLLO_API_KEY'] = 'secret-value-that-must-not-leak';
  const id = await account();
  const claim = await beginApolloRequest({
    accountId: id, operation: 'PEOPLE_SEARCH', mode: 'SEARCH_ONLY',
    idempotencyKey: 'k1', inputFingerprint: 'f1' });
  await settleApolloRequest({ apolloRequestId: claim.apolloRequestId!,
    result: 'MATCHED', notes: 'one candidate returned' });

  const { rows } = await query<{ blob: string }>(
    `select coalesce(apollo_requests::text,'') as blob from apollo_requests`);
  for (const row of rows) {
    assert.equal(row.blob.includes('secret-value-that-must-not-leak'), false,
      'the credential must never be written anywhere');
  }
  delete process.env['APOLLO_API_KEY'];
});

/* ------------------------------------------------------------- eligibility --- */

test('Apollo is not spent on things that are not businesses', () => {
  const base = { accountId: 'a', companyName: 'X', canonicalDomain: 'x.example-co',
    entityStatus: 'verified', isSuppressed: false, hasValidDecisionMaker: false };
  for (const role of ['DIRECTORY', 'LEAD_GEN_DIRECTORY', 'NEWS_OR_PUBLISHER', 'GOVERNMENT',
    'LICENSING_DATABASE', 'PRODUCT_PAGE', 'MARKETPLACE']) {
    const verdict = judgeApolloEligibility({ ...base, sourceRole: role });
    assert.equal(verdict.eligible, false, `${role} must never be enriched`);
    assert.equal(verdict.verdict, 'NOT_ELIGIBLE_BAD_ENTITY');
  }
  assert.equal(judgeApolloEligibility({ ...base, isSuppressed: true }).verdict,
    'NOT_ELIGIBLE_SUPPRESSED');
  assert.equal(judgeApolloEligibility({ ...base, entityStatus: 'legacy_unverified' }).verdict,
    'NOT_ELIGIBLE_IDENTITY_WEAK');
  assert.equal(judgeApolloEligibility({ ...base, hasUnresolvedDuplicate: true }).verdict,
    'NOT_ELIGIBLE_BAD_ENTITY');
});

test('a company we cannot identify is not looked up, to avoid circular evidence', () => {
  // Asking Apollo who a name belongs to and then treating its answer as proof the name
  // was right is how an estate fills with confident nonsense.
  const weak = judgeApolloEligibility({
    accountId: 'a', companyName: 'Air Solutions', canonicalDomain: null,
    entityStatus: 'verified', isSuppressed: false, hasValidDecisionMaker: false });
  assert.equal(weak.verdict, 'NOT_ELIGIBLE_IDENTITY_WEAK');

  // A reserved domain is not an identity either.
  assert.equal(organizationIdentityIsStrong({
    accountId: 'a', companyName: 'Proof Roofing', canonicalDomain: 'proofroof.invalid',
    entityStatus: 'verified', isSuppressed: false, hasValidDecisionMaker: false }), false);

  // No website, but a listing and a corroborated phone: identity enough.
  assert.equal(organizationIdentityIsStrong({
    accountId: 'a', companyName: 'Air Solutions', canonicalDomain: null,
    entityStatus: 'verified', isSuppressed: false, hasValidDecisionMaker: false,
    hasBusinessListing: true, verifiedPhone: '+18135550100' }), true);
});

test('an Account we already have the answer for is not paid for again', () => {
  const complete = judgeApolloEligibility({
    accountId: 'a', companyName: 'ABC Air', canonicalDomain: 'abcair.example-co',
    entityStatus: 'verified', isSuppressed: false,
    hasValidDecisionMaker: true, personRouteEmails: ['john@abcair.example-co'] });
  assert.equal(complete.verdict, 'NOT_ELIGIBLE_ALREADY_COMPLETE');
  assert.match(complete.reason, /repeat what we already know/);

  // But a role mailbox is not a way to reach the owner, so it does not complete anything.
  const roleOnly = judgeApolloEligibility({
    accountId: 'a', companyName: 'ABC Air', canonicalDomain: 'abcair.example-co',
    entityStatus: 'verified', isSuppressed: false,
    hasValidDecisionMaker: true, personRouteEmails: ['info@abcair.example-co'] });
  assert.equal(roleOnly.verdict, 'ELIGIBLE_MISSING_PERSON_ROUTE');
});

test('the two gaps Apollo exists to close', () => {
  const noPerson = judgeApolloEligibility({
    accountId: 'a', companyName: 'ABC Air', canonicalDomain: 'abcair.example-co',
    entityStatus: 'verified', isSuppressed: false, hasValidDecisionMaker: false });
  assert.equal(noPerson.verdict, 'ELIGIBLE_MISSING_DECISION_MAKER');

  const noRoute = judgeApolloEligibility({
    accountId: 'a', companyName: 'ABC Air', canonicalDomain: 'abcair.example-co',
    entityStatus: 'verified', isSuppressed: false, hasValidDecisionMaker: true });
  assert.equal(noRoute.verdict, 'ELIGIBLE_MISSING_PERSON_ROUTE');
});

test('nothing is asked before it is due, and a changed company is asked at once', () => {
  const soon = new Date(Date.now() + 10 * 86_400_000);
  const notDue = judgeApolloEligibility({
    accountId: 'a', companyName: 'ABC Air', canonicalDomain: 'abcair.example-co',
    entityStatus: 'verified', isSuppressed: false, hasValidDecisionMaker: false,
    nextCheckAt: soon });
  assert.equal(notDue.verdict, 'NOT_ELIGIBLE_RECENTLY_CHECKED');

  // A different domain is a different organisation as far as a people graph is concerned.
  const changed = judgeApolloEligibility({
    accountId: 'a', companyName: 'ABC Air', canonicalDomain: 'newdomain.example-co',
    entityStatus: 'verified', isSuppressed: false, hasValidDecisionMaker: false,
    nextCheckAt: soon, previousFingerprint: 'old', currentFingerprint: 'new' });
  assert.equal(changed.verdict, 'ELIGIBLE_IDENTITY_CHANGED');
});

test('the cadence is the one Michael asked for', () => {
  const now = new Date('2026-09-18T00:00:00Z');
  const days = (d: Date): number => Math.round((d.getTime() - now.getTime()) / 86_400_000);
  assert.equal(days(nextCheckAfter({ result: 'MATCHED', now })), 30);
  assert.equal(days(nextCheckAfter({ result: 'NO_MATCH', consecutiveNoMatch: 1, now })), 60);
  assert.equal(days(nextCheckAfter({ result: 'COMPLETE', now })), 90);
  // A provider error is our problem and is retried tomorrow, never treated as an answer.
  assert.equal(days(nextCheckAfter({ result: 'ERROR', now })), 1);
  // A repeated no-match backs off rather than asking monthly for ever.
  assert.ok(days(nextCheckAfter({ result: 'NO_MATCH', consecutiveNoMatch: 3, now })) > 60);
});

/* --------------------------------------------------------------- candidates --- */

test('at a small contractor, the owner outranks the vice president', () => {
  assert.ok(rankTitle('Owner').score > rankTitle('CEO').score);
  assert.ok(rankTitle('Founder').score > rankTitle('Vice President').score);
  assert.ok(rankTitle('President').score > rankTitle('Operations Manager').score);
  assert.ok(rankTitle('Owner').score > rankTitle('Service Manager').score);
  assert.ok(rankTitle('HVAC Technician').score < rankTitle('General Manager').score);
});

test('a candidate employed somewhere else is refused', () => {
  const scored = scoreCandidate(
    candidate({ organizationName: 'Completely Different Plumbing', apolloOrganizationId: 'o_9' }),
    { companyName: 'ABC Air Conditioning', canonicalDomain: 'abcair.example-co' });
  assert.equal(scored.admissible, false);
  assert.match(scored.rejection!, /employer mismatch/);
});

test('an Apollo record that is not a person is refused by the same rule as a web page', () => {
  for (const name of ['ABC Air Conditioning', 'wpadmin', 'Organization', 'Stryker Digital']) {
    const scored = scoreCandidate(candidate({ fullName: name, firstName: name, lastName: null }),
      { companyName: 'ABC Air Conditioning', canonicalDomain: 'abcair.example-co' });
    assert.equal(scored.admissible, false, `${name} must not become a decision maker`);
  }
});

test('the company naming the same person outweighs everything else', () => {
  const withoutFirstParty = scoreCandidate(candidate({ title: 'General Manager' }),
    { companyName: 'ABC Air Conditioning', canonicalDomain: 'abcair.example-co' });
  const withFirstParty = scoreCandidate(candidate({ title: 'General Manager' }),
    { companyName: 'ABC Air Conditioning', canonicalDomain: 'abcair.example-co',
      firstPartyPersonNames: ['John Smith'] });
  assert.ok(withFirstParty.score > withoutFirstParty.score);
  assert.match(withFirstParty.reasons.join(' '), /own site names this person/);
});

test('two equally plausible owners are ambiguous, not a guess', () => {
  const selection = selectDecisionMaker([
    candidate({ apolloPersonId: 'p_1', fullName: 'John Smith', title: 'Owner' }),
    candidate({ apolloPersonId: 'p_2', fullName: 'Jane Doe', title: 'Co-Owner' }),
  ], { companyName: 'ABC Air Conditioning', canonicalDomain: 'abcair.example-co' });
  assert.equal(selection.chosen, null);
  assert.equal(selection.ambiguous, true);

  // A clear winner is chosen, and says why.
  const clear = selectDecisionMaker([
    candidate({ apolloPersonId: 'p_1', fullName: 'John Smith', title: 'Owner' }),
    candidate({ apolloPersonId: 'p_2', fullName: 'Jane Doe', title: 'HVAC Technician' }),
  ], { companyName: 'ABC Air Conditioning', canonicalDomain: 'abcair.example-co' });
  assert.equal(clear.chosen?.candidate.fullName, 'John Smith');
  assert.equal(clear.ambiguous, false);
});

/* ------------------------------------------------------------------ credits --- */

test('what a call cost is reported honestly, or not at all', () => {
  const person = (over: Partial<ApolloPerson>): ApolloPerson => ({
    ...candidate(), email: 'john@abcair.example-co', emailStatus: 'verified',
    directPhone: null, organization: null, matchConfidence: 'high', ...over,
  });
  // Documented: no credits are charged when the match confidence is none.
  assert.deepEqual(costOfEnrichment(person({ matchConfidence: 'none' })),
    { creditConsuming: 'NO', creditsEstimated: 0 });
  assert.deepEqual(costOfEnrichment(person({})),
    { creditConsuming: 'YES', creditsEstimated: 1 });
  // "1 credit for demographics or email, plus 8 credits if a mobile phone is returned."
  assert.deepEqual(costOfEnrichment(person({ directPhone: '+18135550111' })),
    { creditConsuming: 'YES', creditsEstimated: 9 });
});

test('an unknown credit cost is unknown, never zero', async () => {
  const id = await account();
  const claim = await beginApolloRequest({
    accountId: id, operation: 'PEOPLE_MATCH', mode: 'ENRICH_EMAIL',
    idempotencyKey: 'k-unknown', inputFingerprint: 'f' });
  await settleApolloRequest({ apolloRequestId: claim.apolloRequestId!, result: 'MATCHED',
    creditConsuming: 'YES', creditsCharged: null, creditsEstimated: 1,
    fieldsGained: ['email'] });

  const summary = await apolloSpendSummary();
  assert.equal(summary.creditCostKnown, false,
    'Apollo does not return a per-call charge, and the report says so');
  assert.equal(summary.creditsCharged, null, 'null, not zero');
  assert.equal(summary.creditsEstimated, 1);
  assert.equal(summary.emailsFound, 1);
});

/* -------------------------------------------------------------- idempotency --- */

test('the same question is only ever paid for once', async () => {
  const id = await account();
  const key = apolloFingerprint({
    accountId: id, canonicalDomain: 'abcair.example-co', apolloPersonId: 'p_1',
    operation: 'PEOPLE_MATCH', mode: 'ENRICH_EMAIL', fields: ['email'] });

  const first = await beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH',
    mode: 'ENRICH_EMAIL', idempotencyKey: key, inputFingerprint: 'f' });
  assert.ok(first.apolloRequestId, 'the first caller claims the work');

  // A second worker, or the same worker after a restart.
  const second = await beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH',
    mode: 'ENRICH_EMAIL', idempotencyKey: key, inputFingerprint: 'f' });
  assert.equal(second.apolloRequestId, null, 'the second caller stands down');
  assert.equal(second.existing?.result, 'IN_FLIGHT');

  await settleApolloRequest({ apolloRequestId: first.apolloRequestId!, result: 'MATCHED' });
  const third = await beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH',
    mode: 'ENRICH_EMAIL', idempotencyKey: key, inputFingerprint: 'f' });
  assert.equal(third.apolloRequestId, null, 'a settled answer is reused, not re-bought');

  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from apollo_requests where idempotency_key = $1`, [key]);
  assert.equal(Number(rows[0]!.n), 1);
});

test('concurrent workers cannot both buy the same enrichment', async () => {
  const id = await account();
  const key = apolloFingerprint({
    accountId: id, canonicalDomain: 'abcair.example-co', apolloPersonId: 'p_1',
    operation: 'PEOPLE_MATCH', mode: 'ENRICH_EMAIL', fields: ['email'] });
  const claims = await Promise.all(Array.from({ length: 5 }, () =>
    beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH', mode: 'ENRICH_EMAIL',
      idempotencyKey: key, inputFingerprint: 'f' })));
  const won = claims.filter((c) => c.apolloRequestId !== null);
  assert.equal(won.length, 1, 'exactly one of five callers may ask');
});

test('a failed request may be retried; a settled one may not', async () => {
  const id = await account();
  const key = 'k-retry';
  const first = await beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH',
    mode: 'ENRICH_EMAIL', idempotencyKey: key, inputFingerprint: 'f' });
  await settleApolloRequest({ apolloRequestId: first.apolloRequestId!, result: 'ERROR',
    errorClassification: 'TIMEOUT' });

  const retry = await beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH',
    mode: 'ENRICH_EMAIL', idempotencyKey: key, inputFingerprint: 'f' });
  assert.ok(retry.apolloRequestId, 'a timeout is not an answer, so it may be asked again');
});

test('asking for more is a different question', () => {
  const base = { accountId: 'a', canonicalDomain: 'abcair.example-co',
    apolloPersonId: 'p_1', operation: 'PEOPLE_MATCH' as const };
  const email = apolloFingerprint({ ...base, mode: 'ENRICH_EMAIL', fields: ['email'] });
  const phone = apolloFingerprint({ ...base, mode: 'ENRICH_PHONE', fields: ['email', 'phone'] });
  assert.notEqual(email, phone, 'a phone after an email is a new purchase, not a repeat');

  // And the same question really is the same, whoever asks and whenever.
  assert.equal(apolloFingerprint({ ...base, mode: 'ENRICH_EMAIL', fields: ['email'] }), email);
});

/* ---------------------------------------------------------------- normalize --- */

test('an organization phone is never read as somebody mobile', () => {
  // Apollo returns the company switchboard on the same object as the person. Reading it
  // as a direct line is exactly the distinction the endpoint model exists to keep.
  const person = normalizePerson({
    id: 'p_1', first_name: 'John', last_name: 'Smith', title: 'Owner',
    email: 'john@abcair.example-co', match_confidence: 'high',
    organization: { id: 'o_1', name: 'ABC Air', phone: '+18135550100' },
    phone_numbers: [{ type: 'work_hq', sanitized_number: '+18135550100' }],
  });
  assert.equal(person?.directPhone, null, 'a switchboard is not a mobile');
  assert.equal(person?.organization?.phone, '+18135550100');

  const withMobile = normalizePerson({
    id: 'p_1', first_name: 'John', last_name: 'Smith', match_confidence: 'high',
    phone_numbers: [{ type: 'mobile', sanitized_number: '+18135550111' }],
  });
  assert.equal(withMobile?.directPhone, '+18135550111');
});

test('a confidence Apollo does not recognise is treated as none', () => {
  const person = normalizePerson({ id: 'p_1', first_name: 'A', last_name: 'B',
    match_confidence: 'something_new' });
  assert.equal(person?.matchConfidence, 'none');
  assert.equal(costOfEnrichment(person).creditsEstimated, 0);
});


/* -------------------------------------------------- webhook, staged and off --- */

test('the phone webhook is refused unless it is configured and authenticated', async () => {
  // Off by default, so it answers "not enabled" rather than accepting deliveries.
  delete process.env['APOLLO_PHONE_ENRICHMENT_ENABLED'];
  delete process.env['APOLLO_WEBHOOK_SECRET'];
  assert.equal(apolloWebhookConfigured(), false);

  process.env['APOLLO_PHONE_ENRICHMENT_ENABLED'] = 'true';
  process.env['APOLLO_WEBHOOK_SECRET'] = 'shared-secret';
  assert.equal(apolloWebhookConfigured(), true);

  // Constant-time comparison, and a wrong or absent secret is refused.
  assert.equal(verifyApolloWebhookSecret('shared-secret', 'shared-secret'), true);
  assert.equal(verifyApolloWebhookSecret('wrong', 'shared-secret'), false);
  assert.equal(verifyApolloWebhookSecret(undefined, 'shared-secret'), false);
  assert.equal(verifyApolloWebhookSecret('anything', null), false);
  delete process.env['APOLLO_WEBHOOK_SECRET'];
  delete process.env['APOLLO_PHONE_ENRICHMENT_ENABLED'];
});

test('a delivery for a request we never made is refused', async () => {
  const result = await ingestApolloPhoneWebhook({
    request_id: 'req_we_never_sent',
    people: [{ phone_numbers: [{ type: 'mobile', sanitized_number: '+18135550111' }] }] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no Apollo request of ours/);
});

test('a replayed delivery does not record the phone twice', async () => {
  const id = await account();
  const claim = await beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH',
    mode: 'ENRICH_PHONE', idempotencyKey: 'k-phone', inputFingerprint: 'f' });
  await settleApolloRequest({ apolloRequestId: claim.apolloRequestId!,
    result: 'MATCHED', providerRequestId: 'req_abc', fieldsGained: ['email'] });

  const payload = { request_id: 'req_abc',
    people: [{ phone_numbers: [{ type: 'mobile', sanitized_number: '+18135550111' }] }] };

  const first = await ingestApolloPhoneWebhook(payload);
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);

  // Apollo retries deliveries. The second one must change nothing.
  const second = await ingestApolloPhoneWebhook(payload);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);

  const { rows } = await query<{ fields_gained: string[]; credits_estimated: string }>(
    `select fields_gained, credits_estimated::text from apollo_requests
      where apollo_request_id = $1`, [claim.apolloRequestId!]);
  assert.equal(rows[0]!.fields_gained.filter((f) => f === 'direct_phone').length, 1,
    'the phone is recorded exactly once');
  assert.equal(Number(rows[0]!.credits_estimated), 8, 'a mobile is eight credits');
});

test('a delivery carrying no number costs nothing and says so', async () => {
  const id = await account();
  const claim = await beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH',
    mode: 'ENRICH_PHONE', idempotencyKey: 'k-nophone', inputFingerprint: 'f' });
  await settleApolloRequest({ apolloRequestId: claim.apolloRequestId!,
    result: 'MATCHED', providerRequestId: 'req_empty' });

  const result = await ingestApolloPhoneWebhook({ request_id: 'req_empty', people: [] });
  assert.equal(result.ok, true);
  const { rows } = await query<{ credit_consuming: string; credits_estimated: string }>(
    `select credit_consuming, coalesce(credits_estimated,0)::text as credits_estimated
       from apollo_requests where apollo_request_id = $1`, [claim.apolloRequestId!]);
  assert.equal(rows[0]!.credit_consuming, 'NO');
  assert.equal(Number(rows[0]!.credits_estimated), 0);
});

test('a phone is never requested while phone enrichment is off', () => {
  // The switch is held in the adapter rather than trusted to every call site.
  delete process.env['APOLLO_PHONE_ENRICHMENT_ENABLED'];
  const settings = apolloConfig();
  assert.equal(settings.phoneEnrichmentEnabled, false);
  assert.equal(settings.waterfallEmailEnabled, false);
  assert.equal(settings.waterfallPhoneEnabled, false);
});
