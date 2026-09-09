import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, pool } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { analyzeForm, classifyCheckbox } from '../src/probe/forms.js';
import { fixtureForm, parseFormHtml } from '../src/probe/fixtures.js';
import { planProbe } from '../src/probe/ledger.js';
import { dryRunSubmit } from '../src/probe/submitter.js';
import { ingestProbeInboundEvent, closeWindow } from '../src/probe/inbound.js';
import { measuredProbesFor, probeSignalsFor, renderProbeEvidence } from '../src/probe/evidence.js';
import { probeHookFor } from '../src/probe/publish.js';
import { measureLatency, weekdayHours, businessSecondsBetween } from '../src/probe/latency.js';
import { resolveInboundMode } from '../src/inbound/resolver.js';
import { AWAITING_RESPONSE_STATUSES } from '../src/probe/states.js';

/**
 * Permanent pins for every defect this subsystem has actually had.
 *
 * Each of the five below shipped, passed a typecheck, and produced a plausible
 * looking wrong answer. Four of them were caught by a test written for another
 * purpose and one by reading the code; none announced itself. The point of this file
 * is that none of them can come back quietly, so each test names the failure it
 * prevents rather than only the behaviour it asserts.
 */

const NOW = new Date('2026-09-08T22:03:00Z');
const ORDINARY = fixtureForm('ordinary');

async function prepare(): Promise<void> {
  await resetDatabase();
  await syncVerticalProfiles();
}

function eligible(vertical = 'hvac') {
  return analyzeForm({
    form: parseFormHtml(ORDINARY.html, 'https://fixture.example/contact'),
    verticalProfileId: vertical,
  });
}

async function makeAccount(name: string, phone: string): Promise<string> {
  const { rows } = await pool.query<{ account_id: string }>(
    `insert into accounts (canonical_name, normalized_name, canonical_domain,
                           primary_vertical_profile_id, account_type)
     values ($1,$2,$3,'hvac','independent_business') returning account_id`,
    [name, name.toLowerCase(), `${name.toLowerCase().replace(/\W+/g, '')}.example`]);
  const accountId = rows[0]!.account_id;
  await pool.query(
    `insert into contact_endpoints (account_id, endpoint_type, normalized_value,
       display_value, endpoint_role, quality_state, endpoint_source, freshness)
     values ($1,'PHONE',$2,$2,'MAIN_BUSINESS_LINE','PUBLIC_OBSERVED_UNVERIFIED',
             'COMPANY_WEBSITE','fresh')`, [accountId, phone]);
  return accountId;
}

async function submittedProbe(name: string, phone: string): Promise<{
  probeId: string; accountId: string; poolE164: string;
}> {
  const ident = await pool.query<{ probe_identity_id: string }>(
    `insert into probe_identities (full_name) values ('A. Fixture')
     on conflict (full_name, version) do update set is_active = true
     returning probe_identity_id`);
  const poolE164 = '+19045559000';
  await pool.query(
    `insert into probe_pool_numbers (e164, market_affinity) values ($1,'jacksonville')
     on conflict (e164) do nothing`, [poolE164]);
  const accountId = await makeAccount(name, phone);
  const plan = await planProbe({
    accountId, eligibility: eligible(), targetFormUrl: 'https://x.example',
    identityId: ident.rows[0]!.probe_identity_id, now: NOW });
  await dryRunSubmit({
    probeId: plan.probeId!, form: parseFormHtml(ORDINARY.html, 'https://x.example'),
    identityName: 'A. Fixture', emailAlias: 'probe+a@probes.example',
    verticalProfileId: 'hvac', now: NOW });
  return { probeId: plan.probeId!, accountId, poolE164 };
}

// =============================================================================
// REGRESSION: an UNKNOWN actor is not "no response"
// =============================================================================
//
// The defect: `closeWindow` decided ATTRIBUTED vs NO_RESPONSE_FINAL from the six
// milestone columns. An UNKNOWN-actor event deliberately populates none of them --
// filing it under "human" or "automated" would assert the thing we could not tell --
// so a probe that received a real, attributed reply closed as "no response", while
// the same row carried an elapsed response time.

test('an attributed response with an UNKNOWN actor does not close as no-response', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Murky Co', '+19045550177');

  // A reply from the company's own published number, so attribution is HIGH, but
  // nothing identifies whether a person or a system sent it.
  const event = await ingestProbeInboundEvent({
    providerSid: 'SM-unknown-actor', channel: 'SMS',
    fromNumber: '+19045550177', toNumber: poolE164,
    body: 'ok', occurredAt: new Date(NOW.getTime() + 3 * 3_600_000),
  });
  assert.equal(event.attribution.state, 'ATTRIBUTED');
  assert.equal(event.attribution.confidence, 'HIGH');
  assert.equal(event.actorType, 'UNKNOWN');
  assert.equal(event.milestone, null,
    'an unclassifiable response sets no channel milestone, by design');

  const status = await closeWindow({
    probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });
  assert.equal(status, 'ATTRIBUTED',
    'a response we could not classify is still a response, and closing it as '
    + 'NO_RESPONSE_FINAL contradicts the elapsed time on the same row');

  const probe = (await measuredProbesFor(accountId, { includeSimulated: true }))[0]!;
  assert.equal(probe.attributedResponses, 1);
  assert.equal(probe.unknownActorResponses, 1);
  assert.equal(probe.humanResponses, 0);
  assert.equal(probe.responseActorType, 'UNKNOWN');

  // Elapsed time to the first response is legitimate and present.
  assert.equal(probe.elapsedSeconds, 3 * 3600);
  // Human timing is not, and stays unavailable.
  assert.equal(probe.meaningfulElapsedSeconds, null);
});

test('actor uncertainty never becomes an observed absence of human follow-up', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Murky Co', '+19045550177');
  await ingestProbeInboundEvent({
    providerSid: 'SM-unknown-2', channel: 'SMS', fromNumber: '+19045550177',
    toNumber: poolE164, body: 'ok', occurredAt: new Date(NOW.getTime() + 3 * 3_600_000) });
  await closeWindow({ probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });

  const signals = await probeSignalsFor(accountId, { includeSimulated: true });
  const noHuman = signals.find((s) => s.signalId === 'no_human_followup_observed')!;
  assert.equal(noHuman.state, 'UNKNOWN',
    'YES here would turn our own classification failure into a finding about them');
  assert.equal(noHuman.canStateAsFact, false);

  const humanLatency = signals.find((s) => s.signalId === 'human_response_latency')!;
  assert.equal(humanLatency.state, 'UNKNOWN',
    'not NOT_OBSERVED: we did not look and fail to see a human, we saw something and '
    + 'could not tell what it was');
  assert.equal(humanLatency.canStateAsFact, false);

  // The response itself is stateable.
  const completed = signals.find((s) => s.signalId === 'lead_response_probe_completed')!;
  assert.equal(completed.state, 'YES');
  const latency = signals.find((s) => s.signalId === 'lead_response_latency')!;
  assert.equal(latency.state, 'YES');
  assert.equal(latency.value, 3 * 3600);
});

test('the renderer never claims no response arrived when one did', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Murky Co', '+19045550177');
  await ingestProbeInboundEvent({
    providerSid: 'SM-unknown-3', channel: 'SMS', fromNumber: '+19045550177',
    toNumber: poolE164, body: 'ok', occurredAt: new Date(NOW.getTime() + 3 * 3_600_000) });
  await closeWindow({ probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });

  const probe = (await measuredProbesFor(accountId, { includeSimulated: true }))[0]!;
  const rendered = renderProbeEvidence(probe);
  const text = rendered.lines.join(' ');

  assert.equal(rendered.renderable, true);
  assert.ok(!/No further response attributable to this inquiry arrived/.test(text),
    'saying nothing arrived would be false');
  assert.match(text, /could not be identified as coming from a person or from a system/);
  assert.ok(!/Elapsed human response time/.test(text),
    'no human response time may be stated without human evidence');

  const hook = await probeHookFor(accountId, { includeSimulated: true });
  assert.ok(!/nobody picks it up/.test(hook.hookLine ?? ''),
    '"nobody picks it up" is unsupported when something answered');
});

test('the five outcomes stay distinct', async () => {
  await prepare();
  const poolE164 = '+19045559000';

  // 1. nothing at all
  const silent = await submittedProbe('Silent Co', '+19045550001');
  await closeWindow({ probeId: silent.probeId, window: 'FINAL',
    now: new Date(NOW.getTime() + 72 * 3_600_000) });
  assert.equal((await pool.query<{ status: string }>(
    `select status from lead_response_probes where probe_id = $1`,
    [silent.probeId])).rows[0]!.status, 'NO_RESPONSE_FINAL');
  const silentSignals = await probeSignalsFor(silent.accountId, { includeSimulated: true });
  assert.equal(silentSignals.find((s) => s.signalId === 'no_human_followup_observed')!.state,
    'YES', 'nothing arrived, so the absence really was observed');

  // 2. automated only
  const auto = await submittedProbe('Auto Co', '+19045550002');
  await ingestProbeInboundEvent({
    providerSid: 'SM-auto-only', channel: 'SMS', fromNumber: '+19045550002',
    toNumber: poolE164, body: 'Thanks for contacting us! We will be in touch.',
    occurredAt: new Date(NOW.getTime() + 4_000) });
  await closeWindow({ probeId: auto.probeId, window: 'FINAL',
    now: new Date(NOW.getTime() + 72 * 3_600_000) });
  const autoProbe = (await measuredProbesFor(auto.accountId, { includeSimulated: true }))[0]!;
  assert.equal(autoProbe.automatedResponses, 1);
  assert.equal(autoProbe.responseActorType, 'AUTOMATED');
  assert.equal((await probeSignalsFor(auto.accountId, { includeSimulated: true }))
    .find((s) => s.signalId === 'no_human_followup_observed')!.state, 'YES');

  // 3. human
  const human = await submittedProbe('Human Co', '+19045550003');
  await ingestProbeInboundEvent({
    providerSid: 'CA-human-only', channel: 'CALL', fromNumber: '+19045550003',
    toNumber: poolE164, callDisposition: 'ANSWERED',
    identificationAnswer: 'Human Co', twoWay: true,
    occurredAt: new Date(NOW.getTime() + 2 * 3_600_000) });
  await closeWindow({ probeId: human.probeId, window: 'FINAL',
    now: new Date(NOW.getTime() + 72 * 3_600_000) });
  const humanProbe = (await measuredProbesFor(human.accountId, { includeSimulated: true }))[0]!;
  assert.equal(humanProbe.humanResponses, 1);
  assert.equal((await probeSignalsFor(human.accountId, { includeSimulated: true }))
    .find((s) => s.signalId === 'no_human_followup_observed')!.state, 'NOT_OBSERVED');

  // 4. unknown actor — covered above, asserted here for the contrast
  const murky = await submittedProbe('Murky Two', '+19045550004');
  await ingestProbeInboundEvent({
    providerSid: 'SM-murky-2', channel: 'SMS', fromNumber: '+19045550004',
    toNumber: poolE164, body: 'ok', occurredAt: new Date(NOW.getTime() + 3 * 3_600_000) });
  await closeWindow({ probeId: murky.probeId, window: 'FINAL',
    now: new Date(NOW.getTime() + 72 * 3_600_000) });
  assert.equal((await probeSignalsFor(murky.accountId, { includeSimulated: true }))
    .find((s) => s.signalId === 'no_human_followup_observed')!.state, 'UNKNOWN');

  // 5. an unattributable event changes nothing about anybody
  const bystander = await submittedProbe('Bystander Co', '+19045550005');
  const stray = await ingestProbeInboundEvent({
    providerSid: 'CA-stray', channel: 'CALL', fromNumber: '+15550009999',
    toNumber: poolE164, callDisposition: 'ANSWERED',
    occurredAt: new Date(NOW.getTime() + 3_600_000) });
  assert.equal(stray.attribution.probeId, null);
  await closeWindow({ probeId: bystander.probeId, window: 'FINAL',
    now: new Date(NOW.getTime() + 72 * 3_600_000) });
  const bystanderProbe = (await measuredProbesFor(
    bystander.accountId, { includeSimulated: true }))[0]!;
  assert.equal(bystanderProbe.attributedResponses, 0,
    'an unattributable event must not be counted against a probe on the same number');
});

// =============================================================================
// REGRESSION A: zoneOffsetAt returns milliseconds, not minutes
// =============================================================================

test('business-hours latency cannot collapse to zero for an overnight wait', async () => {
  const hours = weekdayHours({
    timeZone: 'America/New_York', open: '08:00', close: '17:00',
    source: 'OPERATOR_CONFIRMED' });
  // 18:03 Tuesday local to 10:07 Wednesday local.
  const result = measureLatency({
    submittedAt: new Date('2026-09-08T22:03:00Z'),
    respondedAt: new Date('2026-09-09T14:07:00Z'), hours });

  assert.equal(result.elapsedSeconds, 16 * 3600 + 4 * 60);
  assert.notEqual(result.businessHoursAdjustedSeconds, 0,
    'reading the offset as minutes made this zero: an overnight wait answered '
    + 'instantly, which is the most flattering possible lie about a prospect');
  assert.equal(result.businessHoursAdjustedSeconds, 2 * 3600 + 7 * 60);
  assert.equal(result.submittedOutsideBusinessHours, true);
});

test('a same-day interval inside business hours is counted in full', async () => {
  const hours = weekdayHours({
    timeZone: 'America/New_York', open: '08:00', close: '17:00',
    source: 'OPERATOR_CONFIRMED' });
  // 09:00 to 11:30 Wednesday local, entirely open.
  const result = measureLatency({
    submittedAt: new Date('2026-09-09T13:00:00Z'),
    respondedAt: new Date('2026-09-09T15:30:00Z'), hours });
  assert.equal(result.elapsedSeconds, 2 * 3600 + 30 * 60);
  assert.equal(result.businessHoursAdjustedSeconds, 2 * 3600 + 30 * 60);
  assert.equal(result.submittedOutsideBusinessHours, false);
});

test('a weekend counts no open minutes, and a closed day is never counted as open', async () => {
  const hours = weekdayHours({
    timeZone: 'America/New_York', open: '08:00', close: '17:00',
    source: 'OPERATOR_CONFIRMED' });
  // Saturday 10:00 to Sunday 10:00 local.
  const weekend = businessSecondsBetween(
    new Date('2026-09-12T14:00:00Z'), new Date('2026-09-13T14:00:00Z'), hours);
  assert.equal(weekend, 0,
    'the day-walk previously mis-derived the weekday and counted a full closed day');

  // Friday 18:00 local to Monday 09:00 local: only Monday morning is open.
  const overWeekend = businessSecondsBetween(
    new Date('2026-09-11T22:00:00Z'), new Date('2026-09-14T13:00:00Z'), hours);
  assert.equal(overWeekend, 3600, 'Monday 08:00-09:00 only');
});

test('a non-UTC zone is read in its own wall clock', async () => {
  const denver = weekdayHours({
    timeZone: 'America/Denver', open: '08:00', close: '17:00',
    source: 'OPERATOR_CONFIRMED' });
  // 16:00 UTC on a Wednesday is 10:00 in Denver: open.
  assert.equal(businessSecondsBetween(
    new Date('2026-09-09T16:00:00Z'), new Date('2026-09-09T17:00:00Z'), denver), 3600);
  // 13:00 UTC is 07:00 in Denver: still closed, so only the 08:00 onward counts.
  assert.equal(businessSecondsBetween(
    new Date('2026-09-09T13:00:00Z'), new Date('2026-09-09T15:00:00Z'), denver), 3600);
});

test('unknown hours produce null, and never a zero anybody could quote', async () => {
  const result = measureLatency({
    submittedAt: new Date('2026-09-08T22:03:00Z'),
    respondedAt: new Date('2026-09-09T14:07:00Z'), hours: null });
  assert.equal(result.businessHoursAdjustedSeconds, null);
  assert.equal(result.businessHoursSource, 'NONE');
  assert.equal(result.submittedOutsideBusinessHours, null);
});

// =============================================================================
// REGRESSION B: the checkbox label parser swept up surrounding page text
// =============================================================================

test('an optional preference checkbox is not classified from other fields’ labels', async () => {
  const fixture = fixtureForm('optional_checkbox');
  const form = parseFormHtml(fixture.html, 'https://x.example');
  const box = form.checkboxes.find((item) => item.name === 'newsletter')!;

  assert.match(box.label, /Subscribe to updates/,
    'the label must come from this checkbox’s own label element, not from the '
    + 'text of every field above it');
  assert.ok(!/Your name|Phone number|Email address/.test(box.label),
    'sweeping up preceding field labels made this UNKNOWN, and an UNKNOWN mandatory '
    + 'checkbox is treated as a consent gate');
  assert.equal(box.klass, 'OPTIONAL_PREFERENCE');
  assert.equal(box.required, false);
  assert.equal(analyzeForm({ form, verticalProfileId: 'hvac' }).eligible, true);
});

test('label association follows the DOM, both with for= and by wrapping', async () => {
  const both = `<form>
    <label for="a">Email address</label><input name="a" type="email" required>
    <label><input name="b" type="checkbox"> Send me seasonal tips and newsletter</label>
    <label>I agree to receive automated calls and texts <input name="c" type="checkbox" required></label>
  </form>`;
  const form = parseFormHtml(both, 'https://x.example');
  const byName = new Map(form.checkboxes.map((box) => [box.name, box]));
  assert.equal(byName.get('b')!.klass, 'OPTIONAL_PREFERENCE');
  // Text before the input, rather than after it, must work too.
  assert.equal(byName.get('c')!.klass, 'CONSENT_MARKETING');
  assert.equal(byName.get('c')!.required, true);
});

test('consent gating is not loosened by the parser fix', async () => {
  // The whole point of the fix was to stop *over*-blocking. Under-blocking must not
  // be the new failure, so every gate still gates.
  for (const [key, expected] of [
    ['mandatory_consent_gate', 'INELIGIBLE_CONSENT_GATE'],
    ['mandatory_terms_gate', 'INELIGIBLE_TERMS_GATE'],
  ] as const) {
    const verdict = analyzeForm({
      form: parseFormHtml(fixtureForm(key).html, 'https://x.example'),
      verticalProfileId: 'hvac' });
    assert.equal(verdict.eligible, false, key);
    assert.ok(verdict.blockers.some((blocker) => blocker.reason === expected), key);
  }
  // And an unrecognised mandatory checkbox still fails closed.
  assert.equal(classifyCheckbox('Please acknowledge the above'), 'UNKNOWN');
  const mystery = analyzeForm({
    form: parseFormHtml(`<form><label for="n">Name</label><input name="n" required>
      <label for="p">Phone</label><input name="p" type="tel" required>
      <label><input name="x" type="checkbox" required> Please acknowledge the above</label>
      </form>`, 'https://x.example'),
    verticalProfileId: 'hvac' });
  assert.equal(mystery.reason, 'INELIGIBLE_CONSENT_GATE');
});

// =============================================================================
// REGRESSION C: a probe in NO_RESPONSE_WINDOW_1 stayed attributable
// =============================================================================

test('a next-day callback after window 1 attaches to the original probe', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Late Co', '+19045550777');

  assert.ok(AWAITING_RESPONSE_STATUSES.includes('NO_RESPONSE_WINDOW_1'),
    'omitting this status made the probe invisible to the ladder, so a real callback '
    + 'was recorded against nothing');

  const afterFirst = await closeWindow({
    probeId, window: 1, now: new Date(NOW.getTime() + 4 * 3_600_000) });
  assert.equal(afterFirst, 'NO_RESPONSE_WINDOW_1');

  const callback = await ingestProbeInboundEvent({
    providerSid: 'CA-next-day', channel: 'CALL', fromNumber: '+19045550777',
    toNumber: poolE164, callDisposition: 'ANSWERED',
    identificationAnswer: 'Late Co', twoWay: true,
    occurredAt: new Date(NOW.getTime() + 16 * 3_600_000 + 4 * 60_000) });

  assert.equal(callback.attribution.probeId, probeId,
    'the callback must attach to the probe that earned it');
  assert.equal(callback.attribution.state, 'ATTRIBUTED');
  assert.equal(callback.probeStatus, 'RESPONDED');

  const final = await closeWindow({
    probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });
  assert.equal(final, 'ATTRIBUTED');

  // Exactly one probe for this Account: no second probe was invented.
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from lead_response_probes where account_id = $1`,
    [accountId]);
  assert.equal(rows[0]!.n, '1');

  // Latency is measured from the original submission, not from the window close.
  const probe = (await measuredProbesFor(accountId, { includeSimulated: true }))[0]!;
  assert.equal(probe.meaningfulElapsedSeconds, 16 * 3600 + 4 * 60);

  // Provenance survived: the state history still records the window-1 verdict.
  const { rows: history } = await pool.query<{ to_status: string }>(
    `select to_status from probe_state_events where probe_id = $1
      order by probe_state_event_id`, [probeId]);
  const path = history.map((row) => row.to_status);
  assert.ok(path.includes('NO_RESPONSE_WINDOW_1'),
    'the provisional verdict is history, not something to erase');
  assert.equal(path.at(-1), 'ATTRIBUTED');
});

// =============================================================================
// REGRESSION D: PROBE_AUDIT read as a contact suppression
// =============================================================================

test('probe-audit suppression stops probes and not ordinary outreach', async () => {
  await prepare();
  const accountId = await makeAccount('No Audits Ltd', '+19045550199');
  await pool.query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT',$1,'PROBE_AUDIT','PROSPECT_REQUEST','Do not audit us again.')`,
    [accountId]);

  const plan = await planProbe({
    accountId, eligibility: eligible(), targetFormUrl: 'https://x.example',
    identityId: null, now: NOW });
  assert.equal(plan.refusal, 'PROBE_SUPPRESSED', 'future audits are refused');

  const resolution = await resolveInboundMode({
    fromNumber: '+19045550199', toNumber: '+19046829345', now: NOW });
  assert.equal(resolution.suppression, 'NONE',
    'declining a test is not declining contact, and reporting it as a suppression '
    + 'would have quietly removed the company from ordinary outreach');
});

test('do-not-contact language still suppresses outreach, alongside the probe', async () => {
  await prepare();
  const accountId = await makeAccount('Stop Calling Ltd', '+19045550200');
  // The approved policy: contact language applies ordinary DNC *in addition to*
  // probe suppression.
  await pool.query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT',$1,'PROBE_AUDIT','PROSPECT_REQUEST','Do not audit us.'),
            ('ACCOUNT',$1,'DNC','PROSPECT_REQUEST','Do not contact us again.')`,
    [accountId]);

  const plan = await planProbe({
    accountId, eligibility: eligible(), targetFormUrl: 'https://x.example',
    identityId: null, now: NOW });
  assert.ok(plan.refusal === 'PROBE_SUPPRESSED' || plan.refusal === 'ACCOUNT_SUPPRESSED');

  const resolution = await resolveInboundMode({
    fromNumber: '+19045550200', toNumber: '+19046829345', now: NOW });
  assert.equal(resolution.suppression, 'ACCOUNT_DNC');
});

test('an ambiguous suppression fails closed for probing', async () => {
  await prepare();
  const accountId = await makeAccount('Ambiguous Ltd', '+19045550201');
  // Language that is not clearly probe-only is filed under an approved contact
  // suppression type, and a probe is refused rather than attempted.
  await pool.query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT',$1,'OTHER_APPROVED','PROSPECT_REQUEST',
             'Asked to be left alone; wording unclear about future contact.')`,
    [accountId]);

  // OTHER_APPROVED is not in the probe gate's refusal list, so this asserts the
  // conservative default explicitly rather than assuming it.
  const plan = await planProbe({
    accountId, eligibility: eligible(), targetFormUrl: 'https://x.example',
    identityId: null, now: NOW });
  assert.notEqual(plan.planned, true,
    'an unclear request must not result in a probe being submitted');
});

// =============================================================================
// REGRESSION: the pending-migration tolerance must stay narrow
// =============================================================================
//
// Migration 049 is intentionally unapplied on the live database (48 applied / 49 on
// disk), so the inbound resolver tolerates a missing probe pool table rather than
// taking the voice line down. That tolerance is one line away from swallowing every
// schema error, which would turn a broken database into a silent "not a probe call".

test('only a missing probe pool table is tolerated', async () => {
  const { isMissingProbeTable } = await import('../src/inbound/resolver.js');

  // The one case: relation probe_pool_numbers does not exist.
  assert.equal(isMissingProbeTable({
    code: '42P01', message: 'relation "probe_pool_numbers" does not exist' }), true);

  // A different missing table is a broken schema, not a pending migration.
  assert.equal(isMissingProbeTable({
    code: '42P01', message: 'relation "accounts" does not exist' }), false,
    'a missing accounts table must never read as "there are no probe numbers"');

  // Everything else fails visibly.
  for (const error of [
    { code: '42703', message: 'column "e164" does not exist' },
    { code: '42501', message: 'permission denied for table probe_pool_numbers' },
    { code: '57P01', message: 'terminating connection due to administrator command' },
    { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' },
    { code: undefined, message: 'probe_pool_numbers' },
    null,
    new Error('probe_pool_numbers'),
  ]) {
    assert.equal(isMissingProbeTable(error), false,
      `unexpected error must propagate: ${JSON.stringify(error)}`);
  }
});

// =============================================================================
// REGRESSION: an ambiguous event makes no probe terminal, and blocks a later
// false silence claim on every candidate
// =============================================================================
//
// The packet reports six ambiguous callbacks and zero probes terminal in AMBIGUOUS,
// which looks like a discrepancy and is not: those six are inbound *events* that
// attributed to no single probe. The dangerous shortcut is picking one candidate --
// and the dangerous omission is letting the candidates go on to claim silence, when
// one of them may well have been the caller.

test('an ambiguous event picks no probe and leaves no candidate able to claim silence', async () => {
  await prepare();
  const poolE164 = '+19045559000';
  await pool.query(
    `insert into probe_pool_numbers (e164, market_affinity) values ($1,'jacksonville')
     on conflict (e164) do nothing`, [poolE164]);
  // Only one number, so two non-colliding probes must share it. That is when a
  // name-only callback becomes ambiguous in the first place.
  const twins: { probeId: string; accountId: string }[] = [];
  for (const [offset, name] of ['Coastal Air Services', 'Coastal Air and Heating'].entries()) {
    const { rows } = await pool.query<{ account_id: string }>(
      `insert into accounts (canonical_name, normalized_name, canonical_domain,
                             primary_vertical_profile_id, account_type)
       values ($1,$2,$3,'hvac','independent_business') returning account_id`,
      [name, name.toLowerCase(), `twin-${offset}.example`]);
    const accountId = rows[0]!.account_id;
    await pool.query(
      `insert into contact_endpoints (account_id, endpoint_type, normalized_value,
         display_value, endpoint_role, quality_state, endpoint_source, freshness)
       values ($1,'PHONE',$2,$2,'MAIN_BUSINESS_LINE','PUBLIC_OBSERVED_UNVERIFIED',
               'COMPANY_WEBSITE','fresh')`, [accountId, `+1904555700${offset}`]);
    const plan = await planProbe({
      accountId, eligibility: eligible(), targetFormUrl: 'https://x.example',
      identityId: null, now: NOW });
    await dryRunSubmit({
      probeId: plan.probeId!, form: parseFormHtml(ORDINARY.html, 'https://x.example'),
      identityName: 'A. Fixture', emailAlias: `probe+t${offset}@probes.example`,
      verticalProfileId: 'hvac', now: NOW });
    twins.push({ probeId: plan.probeId!, accountId });
  }

  const event = await ingestProbeInboundEvent({
    providerSid: 'CA-ambiguous-provenance', channel: 'CALL', fromNumber: null,
    toNumber: poolE164, callDisposition: 'ANSWERED',
    identificationAnswer: 'Coastal Air',
    occurredAt: new Date(NOW.getTime() + 5 * 3_600_000) });

  // 1. The six-vs-zero explanation, asserted: it is an event, and it names nobody.
  assert.equal(event.attribution.state, 'AMBIGUOUS');
  assert.equal(event.attribution.probeId, null,
    'choosing one of two plausible companies is a coin toss with a name on it');
  assert.equal(event.attribution.candidateProbeIds.length, 2);

  // 2. The event is still stored, so the verdict is reviewable.
  const { rows: stored } = await pool.query<{ candidate_probe_ids: string[] }>(
    `select candidate_probe_ids from probe_inbound_events where provider_sid = $1`,
    ['CA-ambiguous-provenance']);
  assert.equal(stored[0]!.candidate_probe_ids.length, 2);

  // 3. No probe was made terminal by it.
  for (const twin of twins) {
    const { rows } = await pool.query<{ status: string }>(
      `select status from lead_response_probes where probe_id = $1`, [twin.probeId]);
    assert.notEqual(rows[0]!.status, 'AMBIGUOUS',
      'an event nobody can attribute must not terminate a probe');
  }

  // 4. And neither candidate may later claim silence.
  for (const twin of twins) {
    await closeWindow({ probeId: twin.probeId, window: 'FINAL',
      now: new Date(NOW.getTime() + 72 * 3_600_000) });

    const probe = (await measuredProbesFor(twin.accountId, { includeSimulated: true }))[0]!;
    assert.equal(probe.attributedResponses, 0);
    assert.ok(probe.inconclusiveEvents > 0,
      'the ambiguous event must be carried against every candidate, or the candidate '
      + 'goes on to assert an absence that one of them did not have');

    const signals = await probeSignalsFor(twin.accountId, { includeSimulated: true });
    const noHuman = signals.find((s) => s.signalId === 'no_human_followup_observed')!;
    assert.equal(noHuman.state, 'UNKNOWN',
      'YES here would be a false silence: that call may have been this company');
    assert.equal(noHuman.canStateAsFact, false);

    const rendered = renderProbeEvidence(probe);
    assert.equal(rendered.renderable, false);
    assert.match(rendered.refusal!, /Neither a response time nor an absence/);
  }
});

// =============================================================================
// REGRESSION: a missed sweep must not strand a probe, its Account or its number
// =============================================================================

test('the final window can terminate a probe whose first sweep never ran', async () => {
  await prepare();
  const { probeId, accountId, poolE164 } = await submittedProbe('Stranded Co', '+19045550888');

  const { rows: before } = await pool.query<{ status: string }>(
    `select status from lead_response_probes where probe_id = $1`, [probeId]);
  assert.equal(before[0]!.status, 'SUBMITTED');

  // The window-1 sweep never ran -- a worker outage. The final sweep must still be
  // able to close it, or the one-open-probe index locks the Account for ever and the
  // pool number is never released.
  const closed = await closeWindow({
    probeId, window: 'FINAL', now: new Date(NOW.getTime() + 72 * 3_600_000) });
  assert.equal(closed, 'NO_RESPONSE_FINAL');

  // The Account is free again: a later probe is refused by cooldown, not by a
  // permanently open predecessor.
  const again = await planProbe({
    accountId, eligibility: eligible(), targetFormUrl: 'https://x.example',
    identityId: null, now: new Date(NOW.getTime() + 200 * 24 * 3_600_000) });
  assert.notEqual(again.refusal, 'ALREADY_OPEN',
    'a stranded probe would lock this Account out of every future audit');
  assert.equal(again.planned, true);

  // And the number is no longer occupied.
  const { rows: occupancy } = await pool.query<{ n: string }>(
    `select count(*)::text as n from lead_response_probes p
       join probe_pool_numbers n on n.pool_number_id = p.assigned_pool_number_id
      where n.e164 = $1 and p.status = any($2::text[])`,
    [poolE164, AWAITING_RESPONSE_STATUSES as unknown as string[]]);
  assert.equal(occupancy[0]!.n, '0', 'the pool number must be released');

  // Closing the lifecycle must not have invented a response.
  const probe = (await measuredProbesFor(accountId, { includeSimulated: true }))[0]!;
  assert.equal(probe.attributedResponses, 0);
  assert.equal(probe.meaningfulElapsedSeconds, null);
});
