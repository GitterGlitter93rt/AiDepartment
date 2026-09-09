import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, assertTransition, isOpen, MEASURED_STATUSES } from '../src/probe/states.js';
import { collisionKeys, collides, allocatePoolNumber, type PoolNumberState } from '../src/probe/collision.js';
import { analyzeForm } from '../src/probe/forms.js';
import { FIXTURE_FORMS, parseFormHtml } from '../src/probe/fixtures.js';
import { classifyActor, bodyFingerprint, isMeaningfulContact } from '../src/probe/actor.js';
import { measureLatency, weekdayHours, businessSecondsBetween, formatDuration } from '../src/probe/latency.js';
import { attributeInboundEvent, type OpenProbeCandidate } from '../src/probe/attribution.js';
import { planAlias, tokenFromAddress, newProbeToken } from '../src/probe/identity.js';
import { buildPayload, digestPayload } from '../src/probe/submitter.js';

/**
 * The pure logic of the probe subsystem, tested without a database.
 *
 * These are the assertions that stop a measurement becoming a claim it cannot
 * support. Where a test looks like it is checking something trivially obvious --
 * that a null stays null, that one probe does not become an average -- it is there
 * because the obvious alternative is a number a rep would say out loud.
 */

// --- state machine -------------------------------------------------------------

test('the state machine refuses the shortcuts somebody would take', () => {
  // Straight from submitted to attributed, with no response ever recorded.
  assert.equal(canTransition('SUBMITTED', 'ATTRIBUTED'), false);
  assert.throws(() => assertTransition('SUBMITTED', 'ATTRIBUTED'), /cannot go from SUBMITTED/);

  // A late webhook must not revive a probe that failed before it ever submitted.
  assert.equal(canTransition('FAILED', 'RESPONDED'), false);
  assert.throws(() => assertTransition('FAILED', 'RESPONDED'), /terminal/);

  // No route back from SUBMITTING to AUTHORIZED: that is a resubmission.
  assert.equal(canTransition('SUBMITTING', 'AUTHORIZED'), false);
});

test('window 1 is provisional, so a late human callback can still be measured', () => {
  assert.ok(canTransition('NO_RESPONSE_WINDOW_1', 'RESPONDED'));
  assert.ok(canTransition('RESPONDED', 'ATTRIBUTED'));
});

test('an automated-only probe closes as ATTRIBUTED, not as no response', () => {
  // The acknowledgement was real and measured. Closing it as NO_RESPONSE_FINAL would
  // throw away the only thing we learned.
  assert.ok(canTransition('AUTO_ACKNOWLEDGED', 'ATTRIBUTED'));
});

test('PLANNED counts as open, which is what makes the duplicate guard work', () => {
  assert.ok(isOpen('PLANNED'));
  assert.ok(isOpen('SUBMITTED'));
  assert.equal(isOpen('FAILED'), false);
});

test('only measured statuses may produce a signal', () => {
  assert.deepEqual([...MEASURED_STATUSES], ['ATTRIBUTED', 'NO_RESPONSE_FINAL']);
  assert.equal(MEASURED_STATUSES.includes('AMBIGUOUS'), false,
    'ambiguous attribution is our failure and must never reach the signal layer');
  assert.equal(MEASURED_STATUSES.includes('FAILED'), false,
    'a failed probe is a fact about the form, not about the company');
});

// --- collision-aware allocation ------------------------------------------------

const poolNumber = (
  id: string, open: { probeId: string; collisionKeys: string[] }[] = [], max = 25,
): PoolNumberState => ({
  poolNumberId: id, e164: `+1904555${id}`, status: 'ACTIVE',
  marketAffinity: 'jacksonville', maxConcurrentOpenProbes: max,
  quarantinedUntil: null, openProbes: open,
});

test('two locations of one franchise share a collision key', () => {
  const a = collisionKeys({ phones: ['+19045550101'], alternatePhones: ['+18005551000'],
    domain: 'jax.example.com' });
  const b = collisionKeys({ phones: ['+19045550202'], alternatePhones: ['+18005551000'],
    domain: 'staug.example.com' });
  assert.ok(collides(a, b), 'a shared toll-free line is one phone system to a caller');

  const unrelated = collisionKeys({ phones: ['+19045559999'], domain: 'other.example' });
  assert.equal(collides(a, unrelated), false);
});

test('subdomains of one company collide through the registrable domain', () => {
  const a = collisionKeys({ phones: ['+19045550101'], domain: 'jax.example.com' });
  const b = collisionKeys({ phones: ['+19045550202'], domain: 'staug.example.com' });
  assert.ok(collides(a, b));
});

test('a colliding probe is deferred rather than forced onto a number', () => {
  const shared = ['phone:+18005551000'];
  const outcome = allocatePoolNumber({
    candidateKeys: shared,
    pool: [poolNumber('01', [{ probeId: 'p1', collisionKeys: shared }])],
    now: new Date(),
  });
  assert.equal(outcome.allocated, false);
  assert.equal(outcome.allocated === false && outcome.reason, 'DEFERRED_COLLISION');
  assert.deepEqual(outcome.allocated === false && outcome.collidingWith, ['p1']);
});

test('a non-colliding probe shares a number happily — multiplexing is the design', () => {
  const outcome = allocatePoolNumber({
    candidateKeys: ['phone:+19045557777'],
    pool: [poolNumber('01', [{ probeId: 'p1', collisionKeys: ['phone:+18005551000'] }])],
    now: new Date(),
  });
  assert.equal(outcome.allocated, true);
});

test('capacity and collision are different refusals, because they mean different things', () => {
  const full = poolNumber('01',
    Array.from({ length: 3 }, (_, i) => ({ probeId: `p${i}`, collisionKeys: [] })), 3);
  const outcome = allocatePoolNumber({
    candidateKeys: ['phone:+19045557777'], pool: [full], now: new Date(),
  });
  assert.equal(outcome.allocated === false && outcome.reason, 'DEFERRED_CAPACITY');
});

test('a quarantined number is not reused while a late response could still arrive', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const quarantined: PoolNumberState = {
    ...poolNumber('01'), quarantinedUntil: new Date('2026-09-10T12:00:00Z'),
  };
  const outcome = allocatePoolNumber({
    candidateKeys: ['phone:+19045557777'], pool: [quarantined], now,
  });
  assert.equal(outcome.allocated === false && outcome.reason, 'NO_POOL_NUMBER');
});

// --- form eligibility ----------------------------------------------------------

test('every fixture form analyzes to its expected verdict', () => {
  for (const fixture of FIXTURE_FORMS) {
    const form = parseFormHtml(fixture.html, 'https://fixture.example/contact');
    const verdict = analyzeForm({ form, verticalProfileId: 'hvac' });
    assert.equal(verdict.eligible, fixture.expectEligible,
      `${fixture.key}: expected eligible=${fixture.expectEligible}, got `
      + `${verdict.eligible} (${verdict.reason ?? 'no reason'})`);
  }
});

test('a mandatory consent checkbox makes the form ineligible and is never ticked', () => {
  const fixture = FIXTURE_FORMS.find((form) => form.key === 'mandatory_consent_gate')!;
  const verdict = analyzeForm({
    form: parseFormHtml(fixture.html, 'https://x.example'), verticalProfileId: 'hvac' });
  assert.equal(verdict.reason, 'INELIGIBLE_CONSENT_GATE');
  // Presented, recorded verbatim, and unchecked.
  assert.ok(verdict.checkboxesPresented.some((box) => box.required));
});

test('an unrecognised mandatory checkbox fails closed rather than being assumed harmless', () => {
  const html = `<form><label for="n">Name</label><input name="n" required>
    <label for="p">Phone</label><input name="p" type="tel" required>
    <label><input name="mystery" type="checkbox" required> Please acknowledge the above</label>
    </form>`;
  const verdict = analyzeForm({
    form: parseFormHtml(html, 'https://x.example'), verticalProfileId: 'hvac' });
  assert.equal(verdict.reason, 'INELIGIBLE_CONSENT_GATE');
});

test('an optional checkbox is not a gate', () => {
  const fixture = FIXTURE_FORMS.find((form) => form.key === 'optional_checkbox')!;
  const verdict = analyzeForm({
    form: parseFormHtml(fixture.html, 'https://x.example'), verticalProfileId: 'hvac' });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.checkboxesPresented[0]!.klass, 'OPTIONAL_PREFERENCE');
});

test('a real but unapproved vertical is refused as not-in-V1, not as excluded', () => {
  const ordinary = FIXTURE_FORMS.find((form) => form.key === 'ordinary')!;
  const verdict = analyzeForm({
    form: parseFormHtml(ordinary.html, 'https://x.example'),
    verticalProfileId: 'garage-door' });
  assert.equal(verdict.reason, 'INELIGIBLE_VERTICAL');
  assert.match(verdict.detail, /not in the V1 eligible set/);
});

test('excluded verticals are refused whatever the form looks like', () => {
  const ordinary = FIXTURE_FORMS.find((form) => form.key === 'ordinary')!;
  for (const vertical of ['law-firms', 'dental', 'restoration', 'med-spas']) {
    const verdict = analyzeForm({
      form: parseFormHtml(ordinary.html, 'https://x.example'),
      verticalProfileId: vertical });
    assert.equal(verdict.reason, 'INELIGIBLE_VERTICAL', `${vertical} must be refused`);
  }
});

test('a form needing a VIN or a claim number would require inventing a fact', () => {
  const fixture = FIXTURE_FORMS.find((form) => form.key === 'requires_fabricated_fact')!;
  const verdict = analyzeForm({
    form: parseFormHtml(fixture.html, 'https://x.example'),
    verticalProfileId: 'collision-repair' });
  assert.equal(verdict.reason, 'INELIGIBLE_REQUIRES_FABRICATED_FACT');
});

test('a plus-rejecting email field switches the alias to a catch-all subdomain', () => {
  const fixture = FIXTURE_FORMS.find((form) => form.key === 'plus_address_rejected')!;
  const verdict = analyzeForm({
    form: parseFormHtml(fixture.html, 'https://x.example'), verticalProfileId: 'hvac' });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.plusAddressingAllowed, false);

  const token = newProbeToken();
  const alias = planAlias({ token, aliasDomain: 'probes.example.ai', plusAddressingAllowed: false });
  assert.equal(alias.style, 'CATCH_ALL_SUBDOMAIN');
  assert.ok(!alias.address.includes('+'));
  assert.equal(tokenFromAddress(alias.address), token);
});

// --- alias tokens --------------------------------------------------------------

test('an alias token round-trips in both shapes and refuses anything else', () => {
  const token = newProbeToken();
  const plus = planAlias({ token, aliasDomain: 'probes.example.ai', plusAddressingAllowed: true });
  assert.equal(plus.style, 'SUB_ADDRESSING');
  assert.equal(tokenFromAddress(plus.address), token);
  assert.equal(tokenFromAddress('someone@example.com'), null);
  assert.equal(tokenFromAddress('probe+not-a-token@example.ai'), null);
});

// --- actor classification ------------------------------------------------------

test('a four-second reply is automated, however friendly it reads', () => {
  const result = classifyActor({
    channel: 'SMS', secondsSinceSubmission: 4,
    body: 'Thanks for contacting us! Someone will be in touch shortly.',
    from: '+19045550101',
  });
  assert.equal(result.actorType, 'AUTOMATED');
  assert.ok(result.evidence.some((item) => item.code === 'MACHINE_FAST'));
  assert.ok(result.evidence.some((item) => item.code === 'AUTORESPONDER_PHRASING'));
});

test('the same body on another probe is a template, which is the cross-probe signal', () => {
  const result = classifyActor({
    channel: 'SMS', secondsSinceSubmission: 4000,
    body: 'We have received your request and will respond during business hours.',
    from: '+19045550101', fingerprintSeenOnOtherProbes: 2,
  });
  assert.equal(result.actorType, 'AUTOMATED');
  assert.ok(result.evidence.some((item) => item.code === 'CROSS_PROBE_TEMPLATE'));
});

test('a fingerprint ignores interpolated names and numbers', () => {
  const a = bodyFingerprint('Hi Alex, your request #4471 was received by Marsh Point.');
  const b = bodyFingerprint('Hi Jordan, your request #9982 was received by Marsh Point.');
  assert.equal(a, b, 'one template with two interpolations is still one template');
});

test('absence of automation evidence is never a human', () => {
  const result = classifyActor({
    channel: 'SMS', secondsSinceSubmission: 40_000, body: 'ok', from: '+19045550101',
  });
  assert.equal(result.actorType, 'UNKNOWN');
  assert.ok(result.evidence.some((item) => item.code === 'NO_CLASSIFYING_EVIDENCE'));
});

test('meaningful contact needs a human, a confident attribution and engagement', () => {
  assert.equal(isMeaningfulContact({
    actorType: 'HUMAN', attributionConfidence: 'HIGH', engagesInquiry: true }), true);
  assert.equal(isMeaningfulContact({
    actorType: 'AUTOMATED', attributionConfidence: 'HIGH', engagesInquiry: true }), false,
    'an autoresponder is never human follow-up');
  assert.equal(isMeaningfulContact({
    actorType: 'HUMAN', attributionConfidence: 'LOW', engagesInquiry: true }), false,
    'a person who rang somebody is not a person who rang us');
  assert.equal(isMeaningfulContact({
    actorType: 'UNKNOWN', attributionConfidence: 'HIGH', engagesInquiry: true }), false);
});

// --- latency -------------------------------------------------------------------

test('unknown business hours produce null, not zero and not the raw elapsed time', () => {
  const submittedAt = new Date('2026-09-08T22:03:00Z');
  const respondedAt = new Date('2026-09-09T14:07:00Z');
  const result = measureLatency({ submittedAt, respondedAt, hours: null });

  assert.equal(result.elapsedSeconds, 16 * 3600 + 4 * 60);
  assert.equal(result.businessHoursAdjustedSeconds, null,
    'null is the honest answer; zero would read as an instant reply');
  assert.equal(result.businessHoursSource, 'NONE');
  assert.equal(result.submittedOutsideBusinessHours, null,
    'without their hours, whether 10pm was after hours is not a fact we hold');
  assert.equal(formatDuration(null), 'not available');
});

test('an overnight wait shrinks against known business hours', () => {
  const hours = weekdayHours({
    timeZone: 'America/New_York', open: '08:00', close: '17:00',
    source: 'OPERATOR_CONFIRMED' });
  // 6:03pm Tuesday local to 10:07am Wednesday local.
  const submittedAt = new Date('2026-09-08T22:03:00Z');
  const respondedAt = new Date('2026-09-09T14:07:00Z');
  const result = measureLatency({ submittedAt, respondedAt, hours });

  assert.equal(result.elapsedSeconds, 16 * 3600 + 4 * 60);
  assert.ok(result.businessHoursAdjustedSeconds !== null);
  assert.ok(result.businessHoursAdjustedSeconds! < result.elapsedSeconds);
  // Wednesday 08:00 to 10:07 is two hours and seven minutes of open time.
  assert.equal(result.businessHoursAdjustedSeconds, 2 * 3600 + 7 * 60);
  assert.equal(result.submittedOutsideBusinessHours, true);
});

test('a weekend spans no open minutes at all', () => {
  const hours = weekdayHours({
    timeZone: 'America/New_York', open: '08:00', close: '17:00',
    source: 'OPERATOR_CONFIRMED' });
  // Saturday to Sunday.
  const seconds = businessSecondsBetween(
    new Date('2026-09-12T14:00:00Z'), new Date('2026-09-13T14:00:00Z'), hours);
  assert.equal(seconds, 0);
});

test('durations read the way a rep would say them', () => {
  assert.equal(formatDuration(16 * 3600 + 4 * 60), '16h 04m');
  assert.equal(formatDuration(90), '1m');
});

// --- the attribution ladder ----------------------------------------------------

const candidate = (over: Partial<OpenProbeCandidate> = {}): OpenProbeCandidate => ({
  probeId: 'p1', accountId: 'a1', probeToken: 'abcdef0123456789',
  accountName: 'Marsh Point Air', accountDomain: 'marshpointair.example',
  phones: ['+19045550177'], alternatePhones: [], alternatesAreExclusive: true,
  ...over,
});

test('T1: a known published number attributes at HIGH', () => {
  const result = attributeInboundEvent({
    channel: 'CALL', fromNumber: '+19045550177', candidates: [candidate()] });
  assert.equal(result.state, 'ATTRIBUTED');
  assert.equal(result.tier, 'T1_KNOWN_ACCOUNT_NUMBER');
  assert.equal(result.confidence, 'HIGH');
});

test('T1: the same number on two open probes is AMBIGUOUS, never the older one', () => {
  const result = attributeInboundEvent({
    channel: 'CALL', fromNumber: '+18005551000',
    candidates: [
      candidate({ probeId: 'p1', phones: ['+18005551000'] }),
      candidate({ probeId: 'p2', phones: ['+18005551000'] }),
    ] });
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.probeId, null);
  assert.deepEqual(result.candidateProbeIds.sort(), ['p1', 'p2']);
});

test('T2: a shared call-centre alternate caps at MEDIUM', () => {
  const exclusive = attributeInboundEvent({
    channel: 'CALL', fromNumber: '+18005559999',
    candidates: [candidate({ alternatePhones: ['+18005559999'], alternatesAreExclusive: true })] });
  assert.equal(exclusive.confidence, 'HIGH');

  const shared = attributeInboundEvent({
    channel: 'CALL', fromNumber: '+18005559999',
    candidates: [candidate({ alternatePhones: ['+18005559999'], alternatesAreExclusive: false })] });
  assert.equal(shared.tier, 'T2_KNOWN_ALTERNATE_NUMBER');
  assert.equal(shared.confidence, 'MEDIUM',
    'a number that could serve siblings does not promote itself for being the only match');
});

test('T3: a self-identifying SMS attributes, a generic one does not', () => {
  const named = attributeInboundEvent({
    channel: 'SMS', fromNumber: '+19999999999',
    body: 'Hi, this is Marsh Point Air returning your enquiry.',
    candidates: [candidate()] });
  assert.equal(named.tier, 'T3_SELF_IDENTIFYING_SMS');
  assert.equal(named.confidence, 'MEDIUM');

  const generic = attributeInboundEvent({
    channel: 'SMS', fromNumber: '+19999999999',
    body: 'Thanks for contacting us! We will be in touch.',
    candidates: [candidate()] });
  assert.equal(generic.state, 'UNATTRIBUTED');
  assert.ok(generic.evidence.some((item) => item.code === 'BODY_IDENTIFIES_NOTHING'));
});

test('T4: an answered identification question resolves an unknown ANI', () => {
  const result = attributeInboundEvent({
    channel: 'CALL', fromNumber: null, identificationAnswer: 'Marsh Point Air',
    candidates: [candidate(), candidate({ probeId: 'p2', accountName: 'Other Co',
      accountDomain: 'other.example', phones: ['+19045550999'] })] });
  assert.equal(result.tier, 'T4_IDENTIFICATION_ANSWER');
  assert.equal(result.confidence, 'HIGH');
  assert.equal(result.probeId, 'p1');
});

test('T4: two similarly named companies stay AMBIGUOUS', () => {
  const result = attributeInboundEvent({
    channel: 'CALL', fromNumber: null, identificationAnswer: 'Coastal Air',
    candidates: [
      candidate({ probeId: 'p1', accountName: 'Coastal Air Services',
        accountDomain: 'coastalairservices.example', phones: ['+19045550111'] }),
      candidate({ probeId: 'p2', accountName: 'Coastal Air and Heating',
        accountDomain: 'coastalairheating.example', phones: ['+19045550222'] }),
    ] });
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.probeId, null);
  assert.equal(result.candidateProbeIds.length, 2);
});

test('sole occupancy is not attribution', () => {
  // One probe open, an inbound number we do not know, nothing identifying. The
  // tempting answer is "it must be them". The answer is no.
  const result = attributeInboundEvent({
    channel: 'CALL', fromNumber: '+15550001111', candidates: [candidate()] });
  assert.equal(result.state, 'UNATTRIBUTED');
  assert.equal(result.probeId, null);
  assert.ok(result.evidence.some((item) => item.code === 'SOLE_OCCUPANCY_NOT_ATTRIBUTION'));
});

test('T0: an alias token beats everything, because only one company had it', () => {
  const result = attributeInboundEvent({
    channel: 'EMAIL', toEmail: 'probe+abcdef0123456789@example.ai',
    fromEmail: 'someone@marshpointair.example', candidates: [candidate()] });
  assert.equal(result.tier, 'T0_EMAIL_TOKEN');
  assert.equal(result.confidence, 'HIGH');
});

test('an event on a number with no open probes attributes nothing and blames nobody', () => {
  const result = attributeInboundEvent({
    channel: 'CALL', fromNumber: '+19045550177', candidates: [] });
  assert.equal(result.state, 'UNATTRIBUTED');
  assert.ok(result.evidence.some((item) => item.code === 'NO_OPEN_PROBES'));
});

// --- the payload ---------------------------------------------------------------

test('the payload is built only from things we control', () => {
  const fixture = FIXTURE_FORMS.find((form) => form.key === 'ordinary')!;
  const form = parseFormHtml(fixture.html, 'https://fixture.example/contact');
  const payload = buildPayload({
    form, identityName: 'A. Fixture', poolNumberE164: '+19045559000',
    emailAlias: 'probe+abcdef0123456789@probes.example', verticalProfileId: 'hvac',
    zipOrCity: '32256',
  });

  assert.equal(payload.fields['name'], 'A. Fixture');
  assert.equal(payload.fields['phone'], '+19045559000');
  assert.equal(payload.fields['email'], 'probe+abcdef0123456789@probes.example');
  assert.match(payload.fields['message']!, /information about replacing my AC/);
  assert.deepEqual(payload.checkboxesChecked, [],
    'V1 ticks no third-party checkbox, ever');

  // No emergency, no address, no appointment anywhere in the body.
  const body = JSON.stringify(payload.fields).toLowerCase();
  for (const forbidden of ['emergency', 'urgent', 'asap', 'appointment', 'address']) {
    assert.ok(!body.includes(forbidden), `payload must not contain "${forbidden}"`);
  }
});

test('the digest is stable across runs and changes when the payload does', () => {
  const base = { url: 'https://x.example', fields: { a: '1', b: '2' },
    checkboxesChecked: [], omitted: [] };
  assert.equal(digestPayload(base), digestPayload({ ...base, fields: { b: '2', a: '1' } }),
    'key order must not change the digest');
  assert.notEqual(digestPayload(base), digestPayload({ ...base, fields: { a: '9', b: '2' } }));
});
