import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, pool } from './helpers.js';
import { analyzeForm } from '../src/probe/forms.js';
import { fixtureForm, parseFormHtml } from '../src/probe/fixtures.js';
import { planProbe, snapshotAccount, allocateForProbe, transitionProbe } from '../src/probe/ledger.js';
import { dryRunSubmit, probesAwaitingManualResolution } from '../src/probe/submitter.js';
import { ingestProbeInboundEvent, closeWindow } from '../src/probe/inbound.js';
import { probeSignalsFor, measuredProbesFor, renderProbeEvidence } from '../src/probe/evidence.js';
import { publishProbeEvidence, probeHookFor } from '../src/probe/publish.js';
import { resolveInboundMode } from '../src/inbound/resolver.js';
import { buildInboundContext } from '../src/inbound/context.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';

/**
 * The probe subsystem against a real database.
 *
 * The invariants under test are the ones whose failure produces a claim about a
 * company that we cannot defend: a duplicate inquiry, a forced number allocation, a
 * simulated measurement escaping as evidence, or an automated acknowledgement
 * counted as somebody picking up the phone.
 */


/**
 * A clean database with the vertical profiles present.
 *
 * `accounts.primary_vertical_profile_id` is a foreign key, so a probe fixture cannot
 * exist without them. Seeded here rather than assumed, so this file passes against a
 * database created from nothing.
 */
async function prepare(): Promise<void> {
  await resetDatabase();
  await syncVerticalProfiles();
}

const NOW = new Date('2026-09-08T22:03:00Z');
const ORDINARY = fixtureForm('ordinary');

function eligibleFor(vertical = 'hvac') {
  return analyzeForm({
    form: parseFormHtml(ORDINARY.html, 'https://fixture.example/contact'),
    verticalProfileId: vertical,
  });
}

async function makeAccount(input: {
  name: string; phone: string; tollFree?: string; vertical?: string; domain?: string;
}): Promise<string> {
  const { rows } = await pool.query<{ account_id: string }>(
    `insert into accounts (canonical_name, normalized_name, canonical_domain,
                           primary_vertical_profile_id, account_type)
     values ($1,$2,$3,$4,'independent_business') returning account_id`,
    [input.name, input.name.toLowerCase(),
     input.domain ?? `${input.name.toLowerCase().replace(/\W+/g, '')}.example`,
     input.vertical ?? 'hvac']);
  const accountId = rows[0]!.account_id;
  await pool.query(
    `insert into contact_endpoints (account_id, endpoint_type, normalized_value,
       display_value, endpoint_role, quality_state, endpoint_source, freshness)
     values ($1,'PHONE',$2,$2,'MAIN_BUSINESS_LINE','PUBLIC_OBSERVED_UNVERIFIED',
             'COMPANY_WEBSITE','fresh')`, [accountId, input.phone]);
  if (input.tollFree) {
    await pool.query(
      `insert into contact_endpoints (account_id, endpoint_type, normalized_value,
         display_value, endpoint_role, quality_state, endpoint_source, freshness)
       values ($1,'PHONE',$2,$2,'TOLL_FREE_BUSINESS','PUBLIC_OBSERVED_UNVERIFIED',
               'COMPANY_WEBSITE','fresh')`, [accountId, input.tollFree]);
  }
  return accountId;
}

async function makePoolNumber(e164: string): Promise<string> {
  const { rows } = await pool.query<{ pool_number_id: string }>(
    `insert into probe_pool_numbers (e164, market_affinity) values ($1,'jacksonville')
     returning pool_number_id`, [e164]);
  return rows[0]!.pool_number_id;
}

async function identity(): Promise<string> {
  const { rows } = await pool.query<{ probe_identity_id: string }>(
    `insert into probe_identities (full_name) values ('A. Fixture')
     returning probe_identity_id`);
  return rows[0]!.probe_identity_id;
}

// --- the duplicate and repetition guards ---------------------------------------

test('one open probe per Account, enforced by the database and not by hope', async () => {
  await prepare();
  const accountId = await makeAccount({ name: 'Marsh Point Air', phone: '+19045550177' });
  const identityId = await identity();

  const first = await planProbe({
    accountId, eligibility: eligibleFor(), targetFormUrl: 'https://x.example',
    identityId, now: NOW });
  assert.equal(first.planned, true);

  const second = await planProbe({
    accountId, eligibility: eligibleFor(), targetFormUrl: 'https://x.example',
    identityId, now: NOW });
  assert.equal(second.planned, false);
  assert.equal(second.refusal, 'ALREADY_OPEN');
});

test('a re-probe inside cooldown is refused, not queued', async () => {
  await prepare();
  const accountId = await makeAccount({ name: 'Cooled Co', phone: '+19045550188' });
  const identityId = await identity();

  const first = await planProbe({
    accountId, eligibility: eligibleFor(), targetFormUrl: 'https://x.example',
    identityId, now: NOW });
  await transitionProbe({ probeId: first.probeId!, to: 'CANCELLED',
    reason: 'test', actor: 'test' });

  const again = await planProbe({
    accountId, eligibility: eligibleFor(), targetFormUrl: 'https://x.example',
    identityId, now: new Date(NOW.getTime() + 24 * 3_600_000) });
  assert.equal(again.planned, false);
  assert.equal(again.refusal, 'IN_COOLDOWN');
});

test('"do not audit us" stops probing without stopping ordinary outreach', async () => {
  await prepare();
  const accountId = await makeAccount({ name: 'No Audits Ltd', phone: '+19045550199' });
  const identityId = await identity();
  await pool.query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT',$1,'PROBE_AUDIT','PROSPECT_REQUEST','Asked not to be audited.')`,
    [accountId]);

  const plan = await planProbe({
    accountId, eligibility: eligibleFor(), targetFormUrl: 'https://x.example',
    identityId, now: NOW });
  assert.equal(plan.refusal, 'PROBE_SUPPRESSED');

  // A probe-audit suppression is narrower than DNC, so the inbound resolver must not
  // report this Account as suppressed for contact.
  const resolution = await resolveInboundMode({
    fromNumber: '+19045550199', toNumber: '+19046829345', now: NOW });
  assert.equal(resolution.suppression, 'NONE',
    'asking not to be audited is not asking not to be contacted');
});

test('a company suppressed for contact is never probed', async () => {
  await prepare();
  const accountId = await makeAccount({ name: 'Dnc Co', phone: '+19045550200' });
  const identityId = await identity();
  await pool.query(
    `insert into suppressions (scope, account_id, suppression_type, source)
     values ('ACCOUNT',$1,'DNC','PROSPECT_REQUEST')`, [accountId]);

  const plan = await planProbe({
    accountId, eligibility: eligibleFor(), targetFormUrl: 'https://x.example',
    identityId, now: NOW });
  assert.equal(plan.refusal, 'ACCOUNT_SUPPRESSED');
});

// --- allocation ----------------------------------------------------------------

test('two franchise locations sharing a toll-free line cannot share a pool number', async () => {
  await prepare();
  const identityId = await identity();
  await makePoolNumber('+19045559000');

  const a = await makeAccount({ name: 'Franchise Jax', phone: '+19045550301',
    tollFree: '+18005551000' });
  const b = await makeAccount({ name: 'Franchise StAug', phone: '+19045550302',
    tollFree: '+18005551000' });

  const first = await planProbe({ accountId: a, eligibility: eligibleFor(),
    targetFormUrl: 'https://x.example', identityId, now: NOW });
  const firstSubmit = await dryRunSubmit({
    probeId: first.probeId!, form: parseFormHtml(ORDINARY.html, 'https://x.example'),
    identityName: 'A. Fixture', emailAlias: 'probe+a@probes.example',
    verticalProfileId: 'hvac', now: NOW });
  assert.equal(firstSubmit.poolNumberE164, '+19045559000');

  const second = await planProbe({ accountId: b, eligibility: eligibleFor(),
    targetFormUrl: 'https://x.example', identityId, now: NOW });
  const allocation = await allocateForProbe({ probeId: second.probeId!, now: NOW });
  assert.equal(allocation.allocated, false);
  assert.equal(allocation.allocated === false && allocation.reason, 'DEFERRED_COLLISION');

  // Deferred, not failed: it is still PLANNED and can try again later.
  const { rows } = await pool.query<{ status: string }>(
    `select status from lead_response_probes where probe_id = $1`, [second.probeId]);
  assert.equal(rows[0]!.status, 'PLANNED');
});

// --- the dry-run submitter -----------------------------------------------------

test('a dry run prepares everything and sends nothing', async () => {
  await prepare();
  const identityId = await identity();
  await makePoolNumber('+19045559000');
  const accountId = await makeAccount({ name: 'Marsh Point Air', phone: '+19045550177' });

  const plan = await planProbe({ accountId, eligibility: eligibleFor(),
    targetFormUrl: 'https://fixture.example/contact', identityId, now: NOW });
  const result = await dryRunSubmit({
    probeId: plan.probeId!, form: parseFormHtml(ORDINARY.html, 'https://fixture.example/contact'),
    identityName: 'A. Fixture', emailAlias: 'probe+abcdef0123456789@probes.example',
    verticalProfileId: 'hvac', zipOrCity: '32256', now: NOW });

  assert.equal(result.submitted, false);
  assert.equal(result.status, 'SUBMITTED');
  assert.ok(result.payloadDigest, 'the payload is built even though it is not sent');
  assert.ok(result.liveBlockedBy.length >= 2);
  assert.ok(result.liveBlockedBy.some((reason) => /PROBE_SUBMISSION_ENABLED/.test(reason)));
  assert.ok(result.liveBlockedBy.some((reason) => /no live submission transport/.test(reason)));
});

test('a crash between preparing and confirming is left for a person, never retried', async () => {
  await prepare();
  const identityId = await identity();
  await makePoolNumber('+19045559000');
  const accountId = await makeAccount({ name: 'Crashy Co', phone: '+19045550444' });

  const plan = await planProbe({ accountId, eligibility: eligibleFor(),
    targetFormUrl: 'https://x.example', identityId, now: NOW });
  const result = await dryRunSubmit({
    probeId: plan.probeId!, form: parseFormHtml(ORDINARY.html, 'https://x.example'),
    identityName: 'A. Fixture', emailAlias: 'probe+a@probes.example',
    verticalProfileId: 'hvac', now: NOW,
    simulate: { kind: 'CRASH_BEFORE_CONFIRMATION' } });

  assert.equal(result.status, 'SUBMITTING');
  const awaiting = await probesAwaitingManualResolution();
  assert.equal(awaiting.length, 1);
  assert.equal(awaiting[0]!.probeId, plan.probeId);
});

test('a 500 from the form is a fact about the form, and is not retried', async () => {
  await prepare();
  const identityId = await identity();
  await makePoolNumber('+19045559000');
  const accountId = await makeAccount({ name: 'Broken Form Co', phone: '+19045550555' });

  const plan = await planProbe({ accountId, eligibility: eligibleFor(),
    targetFormUrl: 'https://x.example', identityId, now: NOW });
  const result = await dryRunSubmit({
    probeId: plan.probeId!, form: parseFormHtml(ORDINARY.html, 'https://x.example'),
    identityName: 'A. Fixture', emailAlias: 'probe+a@probes.example',
    verticalProfileId: 'hvac', now: NOW,
    simulate: { kind: 'SERVER_ERROR', statusCode: 500 } });

  assert.equal(result.status, 'FAILED');
  // And it produces no signal whatsoever.
  const signals = await probeSignalsFor(accountId, { includeSimulated: true });
  assert.ok(signals.every((signal) => signal.state === 'NOT_CHECKED'),
    'a failed probe must say nothing at all about the company');
});

// --- inbound events ------------------------------------------------------------

async function submittedProbe(name: string, phone: string): Promise<{
  probeId: string; accountId: string; poolE164: string;
}> {
  const identityId = await identity();
  const poolE164 = '+19045559000';
  await makePoolNumber(poolE164);
  const accountId = await makeAccount({ name, phone });
  const plan = await planProbe({ accountId, eligibility: eligibleFor(),
    targetFormUrl: 'https://x.example', identityId, now: NOW });
  await dryRunSubmit({
    probeId: plan.probeId!, form: parseFormHtml(ORDINARY.html, 'https://x.example'),
    identityName: 'A. Fixture', emailAlias: 'probe+a@probes.example',
    verticalProfileId: 'hvac', now: NOW });
  return { probeId: plan.probeId!, accountId, poolE164 };
}

test('a redelivered webhook is the same event, not a second response', async () => {
  await prepare();
  const { probeId, poolE164 } = await submittedProbe('Marsh Point Air', '+19045550177');
  const input = {
    providerSid: 'SM-duplicate-1', channel: 'SMS' as const,
    fromNumber: '+19045550177', toNumber: poolE164,
    body: 'Thanks for contacting us! Someone will be in touch.',
    occurredAt: new Date(NOW.getTime() + 4_000),
  };
  const first = await ingestProbeInboundEvent(input);
  const second = await ingestProbeInboundEvent(input);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.eventId, second.eventId);

  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from probe_inbound_events where attributed_probe_id = $1`,
    [probeId]);
  assert.equal(rows[0]!.n, '1');
});

test('an automated acknowledgement is never counted as human follow-up', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Marsh Point Air', '+19045550177');
  await ingestProbeInboundEvent({
    providerSid: 'SM-ack-1', channel: 'SMS', fromNumber: '+19045550177',
    toNumber: poolE164,
    body: 'Thanks for contacting us! A representative will be in touch shortly.',
    occurredAt: new Date(NOW.getTime() + 4_000) });

  const { rows } = await pool.query<{
    status: string; first_automated_sms_at: Date | null;
    first_human_sms_at: Date | null; first_meaningful_contact_at: Date | null;
  }>(`select status, first_automated_sms_at, first_human_sms_at,
             first_meaningful_contact_at
        from lead_response_probes where probe_id = $1`, [probeId]);
  const probe = rows[0]!;
  assert.equal(probe.status, 'AUTO_ACKNOWLEDGED');
  assert.ok(probe.first_automated_sms_at);
  assert.equal(probe.first_human_sms_at, null);
  assert.equal(probe.first_meaningful_contact_at, null);

  const closed = await closeWindow({
    probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });
  assert.equal(closed, 'ATTRIBUTED',
    'the acknowledgement was measured, so the probe is not "no response"');

  const signals = await probeSignalsFor(accountId, { includeSimulated: true });
  const noHuman = signals.find((s) => s.signalId === 'no_human_followup_observed')!;
  assert.equal(noHuman.state, 'YES');
  const humanLatency = signals.find((s) => s.signalId === 'human_response_latency')!;
  assert.equal(humanLatency.state, 'NOT_OBSERVED');
  assert.equal(humanLatency.canStateAsFact, false);
});

test('a human callback the next afternoon is measured end to end', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Marsh Point Air', '+19045550177');
  await ingestProbeInboundEvent({
    providerSid: 'SM-ack-2', channel: 'SMS', fromNumber: '+19045550177',
    toNumber: poolE164, body: 'Thanks for contacting us! We will be in touch.',
    occurredAt: new Date(NOW.getTime() + 60_000) });
  await ingestProbeInboundEvent({
    providerSid: 'CA-human-2', channel: 'CALL', fromNumber: '+19045550177',
    toNumber: poolE164, callDisposition: 'ANSWERED',
    identificationAnswer: 'Marsh Point Air', twoWay: true,
    occurredAt: new Date(NOW.getTime() + 16 * 3_600_000 + 4 * 60_000) });

  const status = await closeWindow({
    probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });
  assert.equal(status, 'ATTRIBUTED');

  const probes = await measuredProbesFor(accountId, { includeSimulated: true });
  const probe = probes[0]!;
  assert.equal(probe.meaningfulElapsedSeconds, 16 * 3600 + 4 * 60);
  assert.equal(probe.attributionConfidence, 'HIGH');

  const rendered = renderProbeEvidence(probe);
  assert.equal(rendered.renderable, true);
  assert.ok(rendered.lines.some((line) => /16h 04m/.test(line)));
  // Business hours are unknown here, and the renderer must say so rather than imply
  // an adjusted figure of zero.
  assert.ok(rendered.lines.some((line) => /not available/.test(line)));
  assert.ok(rendered.disclaimer?.includes('One inquiry'));
  assert.equal(rendered.simulated, true);
});

test('ambiguous attribution produces no measurement at all', async () => {
  await prepare();
  const identityId = await identity();
  const poolE164 = '+19045559000';
  await makePoolNumber(poolE164);
  // Two similarly named companies with nothing in common but their name, so the
  // allocator legitimately puts both on one number.
  const a = await makeAccount({ name: 'Coastal Air Services', phone: '+19045550601',
    domain: 'coastalairservices.example' });
  const b = await makeAccount({ name: 'Coastal Air and Heating', phone: '+19045550602',
    domain: 'coastalairheating.example' });
  for (const accountId of [a, b]) {
    const plan = await planProbe({ accountId, eligibility: eligibleFor(),
      targetFormUrl: 'https://x.example', identityId, now: NOW });
    await dryRunSubmit({
      probeId: plan.probeId!, form: parseFormHtml(ORDINARY.html, 'https://x.example'),
      identityName: 'A. Fixture', emailAlias: 'probe+a@probes.example',
      verticalProfileId: 'hvac', now: NOW });
  }

  const result = await ingestProbeInboundEvent({
    providerSid: 'CA-ambiguous', channel: 'CALL', fromNumber: null,
    toNumber: poolE164, callDisposition: 'ANSWERED',
    identificationAnswer: 'Coastal Air',
    occurredAt: new Date(NOW.getTime() + 5 * 3_600_000) });

  assert.equal(result.attribution.state, 'AMBIGUOUS');
  assert.equal(result.attribution.probeId, null);
  assert.equal(result.attribution.candidateProbeIds.length, 2);

  for (const accountId of [a, b]) {
    const signals = await probeSignalsFor(accountId, { includeSimulated: true });
    const latency = signals.find((s) => s.signalId === 'lead_response_latency')!;
    assert.notEqual(latency.state, 'YES',
      'an ambiguous callback must never become a latency for either company');
  }
});

test('a late human callback after window 1 still promotes the probe', async () => {
  await prepare();
  const { probeId, poolE164 } = await submittedProbe('Late Co', '+19045550777');
  const afterWindow1 = await closeWindow({
    probeId, window: 1, now: new Date(NOW.getTime() + 4 * 3_600_000) });
  assert.equal(afterWindow1, 'NO_RESPONSE_WINDOW_1');

  await ingestProbeInboundEvent({
    providerSid: 'CA-late', channel: 'CALL', fromNumber: '+19045550777',
    toNumber: poolE164, callDisposition: 'ANSWERED',
    identificationAnswer: 'Late Co', twoWay: true,
    occurredAt: new Date(NOW.getTime() + 20 * 3_600_000) });

  const final = await closeWindow({
    probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });
  assert.equal(final, 'ATTRIBUTED',
    'a verdict written at window 1 must not be defended by discarding a real callback');
});

// --- the safety property that matters most -------------------------------------

test('a simulated probe publishes no evidence a rep could read', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Simulated Co', '+19045550888');
  await ingestProbeInboundEvent({
    providerSid: 'CA-sim', channel: 'CALL', fromNumber: '+19045550888',
    toNumber: poolE164, callDisposition: 'ANSWERED',
    identificationAnswer: 'Simulated Co', twoWay: true,
    occurredAt: new Date(NOW.getTime() + 2 * 3_600_000) });
  await closeWindow({ probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });

  const attempt = await publishProbeEvidence({ probeId, now: NOW });
  assert.equal(attempt.published, false);
  assert.equal(attempt.refusal, 'SIMULATED_PROBE');

  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from evidence_records where account_id = $1`, [accountId]);
  assert.equal(rows[0]!.n, '0', 'nothing a rep reads may come from a dry run');

  // And the default reader shows nothing either, without being asked to filter.
  assert.deepEqual(await measuredProbesFor(accountId), []);
  const signals = await probeSignalsFor(accountId);
  assert.ok(signals.every((signal) => signal.state === 'NOT_CHECKED'));
});

test('a live measured probe does publish, and the hook language is a question', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Live Co', '+19045550999');
  await pool.query(
    `update lead_response_probes set execution_mode = 'LIVE' where probe_id = $1`,
    [probeId]);
  await pool.query(
    `update probe_pool_numbers set execution_mode = 'LIVE' where e164 = $1`, [poolE164]);

  await ingestProbeInboundEvent({
    providerSid: 'CA-live', channel: 'CALL', fromNumber: '+19045550999',
    toNumber: poolE164, callDisposition: 'ANSWERED',
    identificationAnswer: 'Live Co', twoWay: true,
    executionMode: 'LIVE',
    occurredAt: new Date(NOW.getTime() + 16 * 3_600_000 + 4 * 60_000) });
  await closeWindow({ probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });

  const attempt = await publishProbeEvidence({ probeId, now: NOW });
  assert.equal(attempt.published, true);
  assert.ok(attempt.claimKeys.includes('human_response_latency'));

  // Published as evidence the existing hypothesis engine already reads.
  const { rows } = await pool.query<{ claim_key: string; can_state_as_fact: boolean }>(
    `select claim_key, can_state_as_fact from evidence_records where account_id = $1`,
    [accountId]);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.can_state_as_fact));

  // Never republished.
  const again = await publishProbeEvidence({ probeId, now: NOW });
  assert.equal(again.refusal, 'ALREADY_PUBLISHED');

  const hook = await probeHookFor(accountId);
  assert.equal(hook.available, true);
  assert.ok(hook.hookLine?.endsWith('?'), 'the hook is a question, not an accusation');
  assert.ok(hook.mustNotClaim.some((claim) => /current_response_time_without_measurement/.test(claim)));
  assert.equal(hook.simulated, false);
});

test('a low-confidence measurement is refused a sentence', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Low Co', '+19045551111');
  // A real event attributed at LOW confidence, rather than only the column set: a
  // probe cannot carry a confidence without something to be confident about, and the
  // earlier fixture -- LOW on an otherwise silent probe -- was asserting a state the
  // system cannot produce.
  await pool.query(
    `insert into probe_inbound_events (provider_sid, channel, from_number, to_number,
       occurred_at, actor_type, attributed_probe_id, attribution_tier,
       attribution_confidence)
     values ('CA-low-conf','CALL','+19045551111',$2,$3,'UNKNOWN',$1,
             'T5_UNRESOLVED','LOW')`, [probeId, poolE164, NOW]);
  await pool.query(
    `update lead_response_probes
        set execution_mode = 'LIVE', status = 'ATTRIBUTED',
            attribution_confidence = 'LOW', submitted_at = $2
      where probe_id = $1`, [probeId, NOW]);

  const probes = await measuredProbesFor(accountId);
  const rendered = renderProbeEvidence(probes[0] ?? null);
  assert.equal(rendered.renderable, false);
  assert.match(rendered.refusal!, /without being attributable to this company/);
  assert.match(rendered.refusal!, /Neither a response time nor an absence/);

  const attempt = await publishProbeEvidence({ probeId, now: NOW });
  assert.equal(attempt.refusal, 'NOT_ATTRIBUTABLE');
});

// --- the inbound voice path ----------------------------------------------------

test('a call to a pool number resolves as a probe response, not a returning call', async () => {
  await prepare();
  const poolE164 = '+19045559000';
  await makePoolNumber(poolE164);
  // A company whose number we happen to hold, ringing a probe number.
  await makeAccount({ name: 'Marsh Point Air', phone: '+19045550177' });

  const resolution = await resolveInboundMode({
    fromNumber: '+19045550177', toNumber: poolE164, now: NOW });
  assert.equal(resolution.mode, 'INBOUND_PROBE_RESPONSE');
  assert.equal(resolution.accountId, null,
    'the caller works for the company being audited; naming it back is a disclosure');
  assert.deepEqual(resolution.facts, []);

  const context = buildInboundContext(resolution);
  assert.ok(!/calling us back/i.test(context.openingLine),
    'they are not returning our call; they are answering our enquiry');
  assert.match(context.contextBlock, /Which company are you calling from\?/);
  assert.ok(context.prohibitions.some((rule) => /invent a service situation/i.test(rule)));
  assert.ok(context.prohibitions.some((rule) => /not name the company/i.test(rule)));
  assert.ok(!context.contextBlock.includes('Marsh Point Air'));
});

test('an ordinary inbound call is untouched by the probe path', async () => {
  await prepare();
  await makePoolNumber('+19045559000');
  await makeAccount({ name: 'Ordinary Co', phone: '+19045552222' });

  const resolution = await resolveInboundMode({
    fromNumber: '+19045552222', toNumber: '+19046829345', now: NOW });
  assert.notEqual(resolution.mode, 'INBOUND_PROBE_RESPONSE');
});

// --- the snapshot --------------------------------------------------------------

test('alternate-number exclusivity is derived, not asserted', async () => {
  await prepare();
  const a = await makeAccount({ name: 'Shared A', phone: '+19045550301',
    tollFree: '+18005551000' });
  await makeAccount({ name: 'Shared B', phone: '+19045550302', tollFree: '+18005551000' });
  const solo = await makeAccount({ name: 'Solo', phone: '+19045550303',
    tollFree: '+18005559999' });

  const shared = await snapshotAccount(a);
  assert.equal(shared!.alternatesAreExclusive, false,
    'a toll-free number two companies publish is not exclusive to either');
  const exclusive = await snapshotAccount(solo);
  assert.equal(exclusive!.alternatesAreExclusive, true);
});
