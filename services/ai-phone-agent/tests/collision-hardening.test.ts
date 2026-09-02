// Pre-demo hardening: location, towing, insurance, fault and paperwork.
//
// The recurring theme is the difference between what the caller SAID
// and what the system may CONCLUDE. A caller reporting that the other
// driver rear-ended them is a fact about the call; "the other driver is
// liable" is a legal determination nobody here is qualified to make.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateToolRequest, executeToolRequest, TOOL_SCHEMAS } from '../src/core/tool-protocol.ts';
import { SessionStore } from '../src/core/session.ts';
import { createLogger } from '../src/logger.ts';
import { createMockToolbox } from '../src/tools/index.ts';
import { createMockLocationLink } from '../src/tools/actions.ts';
import { buildCollisionRecord } from '../src/core/collision-summary.ts';
import { buildCallSummary } from '../src/core/call-summary.ts';
import { packetById, purposeById, policiesFor, ESIGN_PACKETS } from '../src/business/policies.ts';
import type { Session } from '../src/core/types.ts';
import type { Toolbox } from '../src/tools/index.ts';

const silent = createLogger({}, () => {});
const deps = (tools: Toolbox, session: Session) => ({ tools, log: silent, session });

function crash(qual: Record<string, unknown> = {}): Session {
  const store = new SessionStore();
  const s = store.ensure('CA_h', '+19045550142', '+19045550100');
  store.setRoute('CA_h', {
    industry: 'collision_repair', specialty: 'general', intent: 'accident_repair',
    urgency: 'emergency', confidence: 0.9, source: 'heuristic',
  });
  Object.assign(s.contact, { firstName: 'Michael', phone: '+19045550142' });
  Object.assign(s.qualification, qual);
  return s;
}

/** A vehicle that plainly cannot be driven, with a findable location. */
const TOWABLE = {
  towNeeded: true, vehicleMake: 'BMW', vehicleModel: 'X5', vehicleColor: 'black',
};
const TOW_INPUT = {
  callerName: 'Michael', callbackPhone: '+19045550142',
  pickupLocation: 'Buckman Bridge, on the shoulder', directionOfTravel: 'northbound',
  vehicleMake: 'BMW', vehicleModel: 'X5',
};

describe('Secure location link', () => {
  test('the tool exists and takes no URL, coordinates or recipient', () => {
    const schema = TOOL_SCHEMAS.find((t) => t.name === 'create_location_link');
    assert.ok(schema, 'create_location_link must exist');
    const props = Object.keys(schema!.input_schema.properties);
    assert.deepEqual(props, ['reason'], 'only a reason — everything else is the backend\'s');
    for (const p of props) {
      assert.doesNotMatch(p, /url|link|token|lat|lon|coord|phone|to\b|recipient/i);
    }
  });

  test('it texts the number they called from, with no recipient parameter', () => {
    const v = validateToolRequest({ id: '1', name: 'create_location_link', input: {} }, crash());
    assert.equal(v.ok, true);
    assert.equal(v.value!.phone, '+19045550142');
  });

  test('a mocked link is never described as sent', async () => {
    const s = crash();
    const out = await executeToolRequest({ id: '1', name: 'create_location_link', input: {} }, deps(createMockToolbox(), s));
    assert.equal(out.ok, true);
    const parsed = JSON.parse(out.content) as { mode: string; speech: string; note: string };
    assert.equal(parsed.mode, 'mocked');
    assert.match(parsed.speech, /NOT ACTUALLY SENT/);
    assert.match(parsed.note, /Never read a link, a token or any coordinates aloud/i);
  });

  test('neither the URL nor a token reaches the model', async () => {
    const out = await executeToolRequest({ id: '1', name: 'create_location_link', input: {} }, deps(createMockToolbox(), crash()));
    assert.doesNotMatch(out.content, /https?:\/\//);
  });

  test('no coordinates or token appear in the logs', async () => {
    const lines: string[] = [];
    const log = createLogger({}, (l) => lines.push(l));
    const s = crash();
    s.roadsideLocation = { source: 'current_location', latitude: 30.1588, longitude: -81.6821, confirmed: true, capturedAt: new Date().toISOString() };

    await executeToolRequest({ id: '1', name: 'create_location_link', input: { reason: 'on a bridge' } }, { tools: createMockToolbox(), log, session: s });

    const all = lines.join('\n');
    assert.match(all, /create_location_link/, 'the action itself is logged');
    assert.doesNotMatch(all, /30\.15|81\.68/, 'coordinates must never be logged');
    assert.doesNotMatch(all, /https?:\/\//, 'no URL in logs');
  });

  test('the mock link carries an opaque token, not the CallSid', async () => {
    const tool = createMockLocationLink();
    const a = await tool.create({ callSid: 'CA_secret', purpose: 'roadside_dispatch', expiryMinutes: 120 });
    const b = await tool.create({ callSid: 'CA_secret', purpose: 'roadside_dispatch', expiryMinutes: 120 });
    assert.doesNotMatch(a.url!, /CA_secret/, 'a CallSid is an identifier, not a secret');
    assert.notEqual(a.url, b.url, 'tokens are random per link');
    assert.ok(a.expiresAt, 'links expire');
  });

  test('the mock reports nothing submitted, because nothing was', async () => {
    assert.equal(await createMockLocationLink().submitted('CA_x'), null);
  });
});

describe('Tow dispatch prerequisites', () => {
  test('the vehicle make and model are required — a driver has to find the car', () => {
    const s = crash({ towNeeded: true });
    const v = validateToolRequest({ id: '1', name: 'dispatch_tow', input: { ...TOW_INPUT, vehicleMake: undefined, vehicleModel: undefined } }, s);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /make and model/i);
  });

  test('something must actually indicate a tow is wanted', () => {
    // "Do you do towing?" is a question, not a request.
    const s = crash({});
    const v = validateToolRequest({ id: '1', name: 'dispatch_tow', input: TOW_INPUT }, s);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /cannot be driven|want it towed/i);
  });

  test('an undrivable vehicle satisfies it', () => {
    assert.equal(validateToolRequest({ id: '1', name: 'dispatch_tow', input: TOW_INPUT }, crash({ vehicleDrivable: false })).ok, true);
  });

  test('a described condition satisfies it', () => {
    const v = validateToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW_INPUT, vehicleCondition: "front end is crushed and it won't start" } },
      crash({}),
    );
    assert.equal(v.ok, true);
  });

  test('a bridge still needs a direction when there is no secure location', () => {
    const v = validateToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW_INPUT, directionOfTravel: undefined, pickupLocation: 'the Buckman Bridge' } },
      crash(TOWABLE),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /direction of travel|secure location link/i);
  });

  test('a submitted secure location removes the need to keep asking', () => {
    // The caller has already answered — through the link. Continuing to
    // demand a mile marker would be interrogating them.
    const s = crash(TOWABLE);
    s.roadsideLocation = { source: 'current_location', latitude: 30.1588, longitude: -81.6821, confirmed: true };
    const v = validateToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW_INPUT, directionOfTravel: undefined, pickupLocation: 'the bridge' } },
      s,
    );
    assert.equal(v.ok, true, 'precise coordinates satisfy the precision requirement');
  });

  test('a dropped pin does the same', () => {
    const s = crash(TOWABLE);
    s.roadsideLocation = { source: 'pin', latitude: 30.1588, longitude: -81.6821, confirmed: true, label: 'by the light pole' };
    assert.equal(validateToolRequest({ id: '1', name: 'dispatch_tow', input: { ...TOW_INPUT, directionOfTravel: undefined, pickupLocation: 'the bridge' } }, s).ok, true);
  });

  test('an unconfirmed location does NOT count', () => {
    const s = crash(TOWABLE);
    s.roadsideLocation = { source: 'current_location', confirmed: false };
    assert.equal(validateToolRequest({ id: '1', name: 'dispatch_tow', input: { ...TOW_INPUT, directionOfTravel: undefined, pickupLocation: 'the bridge' } }, s).ok, false);
  });

  test('no claim number or carrier is needed to send a truck', () => {
    // Somebody on a bridge has not opened a claim. Making them would be
    // absurd.
    const v = validateToolRequest({ id: '1', name: 'dispatch_tow', input: TOW_INPUT }, crash(TOWABLE));
    assert.equal(v.ok, true);
  });

  test('the destination is still config-only', () => {
    const v = validateToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW_INPUT, destinationName: "Bob's Yard", destinationId: 'bobs' } },
      crash(TOWABLE),
    );
    assert.equal(v.value!.destinationName, 'our repair facility');
  });
});

describe('Insurance: two separate records', () => {
  test('the caller and the other driver keep their own carriers', () => {
    const r = buildCollisionRecord(crash({
      insuranceCarrier: 'State Farm', policyNumber: 'SF-111',
      otherPartyInsuranceCarrier: 'GEICO', otherPartyPolicyNumber: 'G-222',
    }));
    assert.equal(r.customerInsurance.carrier, 'State Farm');
    assert.equal(r.customerInsurance.policyNumber, 'SF-111');
    assert.equal(r.otherPartyInsurance.carrier, 'GEICO');
    assert.equal(r.otherPartyInsurance.policyNumber, 'G-222');
  });

  test('a policy number is never treated as a claim number', () => {
    const r = buildCollisionRecord(crash({ otherPartyInsuranceCarrier: 'GEICO', otherPartyPolicyNumber: '12345' }));
    assert.equal(r.otherPartyInsurance.policyNumber, '12345');
    assert.equal(r.otherPartyInsurance.claimNumber, undefined);
    assert.equal(r.otherPartyInsurance.claimStatus, 'unknown');
  });

  test('a pending claim reads as pending', () => {
    const r = buildCollisionRecord(crash({ otherPartyClaimNumberStatus: 'not_filed' }));
    assert.equal(r.otherPartyInsurance.claimStatus, 'not_filed');
  });

  test('a claim number arriving later flips pending to known on the same record', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_upd', '+19045550142', '+1904');
    store.setRoute('CA_upd', { industry: 'collision_repair', specialty: 'general', intent: 'accident_repair', urgency: 'high', confidence: 0.9, source: 'heuristic' });

    store.mergeQualification('CA_upd', { otherPartyInsuranceCarrier: 'GEICO', otherPartyClaimNumberStatus: 'pending' });
    assert.equal(buildCollisionRecord(s).otherPartyInsurance.claimStatus, 'pending');

    // Later in the same call.
    store.mergeQualification('CA_upd', { otherPartyClaimNumber: '123456789', otherPartyClaimNumberStatus: 'known' });
    const after = buildCollisionRecord(s);
    assert.equal(after.otherPartyInsurance.claimStatus, 'known');
    assert.equal(after.otherPartyInsurance.claimNumber, '123456789');
    assert.equal(after.otherPartyInsurance.carrier, 'GEICO', 'the same record, not a new lead');
  });

  test('a stale "known" with no number does not fake a claim', () => {
    const r = buildCollisionRecord(crash({ claimNumberStatus: 'known' }));
    assert.equal(r.customerInsurance.claimStatus, 'unknown');
  });

  test('the other driver\'s claim number never lands on the caller\'s record', () => {
    const r = buildCollisionRecord(crash({ claimNumber: 'MINE-1', otherPartyClaimNumber: 'THEIRS-2' }));
    assert.equal(r.customerInsurance.claimNumber, 'MINE-1');
    assert.equal(r.otherPartyInsurance.claimNumber, 'THEIRS-2');
  });

  test('payment path is recorded, and defaults to undetermined', () => {
    assert.equal(buildCollisionRecord(crash({})).repair.paymentPath, 'undetermined');
    assert.equal(buildCollisionRecord(crash({ repairPaymentPath: 'first_party' })).repair.paymentPath, 'first_party');
    assert.equal(buildCollisionRecord(crash({ repairPaymentPath: 'third_party' })).repair.paymentPath, 'third_party');
    assert.equal(buildCollisionRecord(crash({ repairPaymentPath: 'nonsense' })).repair.paymentPath, 'undetermined');
  });
});

describe('Fault is recorded as an account, never as a finding', () => {
  const cases: [string, string][] = [
    ['caller_reports_other_party', 'Caller reports the other driver was responsible'],
    ['caller_reports_self', 'Caller reports they were responsible'],
    ['disputed', 'Caller reports responsibility is disputed'],
    ['unclear', 'Caller is unsure who was responsible'],
    ['unknown', 'Not established on the call'],
  ];
  for (const [value, label] of cases) {
    test(`${value} reads as "${label}"`, () => {
      assert.equal(buildCollisionRecord(crash({ faultPosition: value })).accident.faultPositionLabel, label);
    });
  }

  test('an unrecognised value falls back to not established', () => {
    assert.equal(buildCollisionRecord(crash({ faultPosition: 'other_driver_is_liable' })).accident.faultPositionLabel, 'Not established on the call');
  });

  test('no label anywhere states legal fault', () => {
    for (const [value] of cases) {
      const label = buildCollisionRecord(crash({ faultPosition: value })).accident.faultPositionLabel;
      assert.doesNotMatch(label, /\b(liable|liability|at fault|negligent|guilty)\b/i, `"${label}" reads as a determination`);
    }
  });

  test('a citation is stored separately and does not become a fault finding', () => {
    const r = buildCollisionRecord(crash({ faultPosition: 'caller_reports_other_party', citationIssued: true, citedParty: 'other driver' }));
    assert.equal(r.accident.citationIssued, true);
    assert.equal(r.accident.citedParty, 'other driver');
    // The citation does not change the label.
    assert.equal(r.accident.faultPositionLabel, 'Caller reports the other driver was responsible');
  });

  test('the prompt forbids deciding fault', async () => {
    const { REGISTRY } = await import('../src/industries/index.ts');
    const c = REGISTRY.collision_repair[0];
    assert.match(c.systemPrompt, /Record what the CALLER SAYS/i);
    assert.match(c.systemPrompt, /A citation is not a liability determination/i);
    assert.match(c.systemPrompt, /Never say who is at fault/i);
    assert.match(c.systemPrompt, /A POLICY NUMBER is not a CLAIM NUMBER/i);
  });
});

describe('Other-party details are captured', () => {
  test('name, phone and vehicle', () => {
    const r = buildCollisionRecord(crash({
      otherPartyFirstName: 'Dave', otherPartyLastName: 'Jones', otherPartyPhone: '+19045559999',
      otherPartyVehicleYear: '2019', otherPartyVehicleMake: 'Ford', otherPartyVehicleModel: 'F-150',
      otherPartyVehicleColor: 'white', otherPartyLicensePlate: 'ABC123',
    }));
    assert.equal(r.otherParty.firstName, 'Dave');
    assert.equal(r.otherParty.phone, '+19045559999');
    assert.equal(r.otherParty.vehicleMake, 'Ford');
    assert.equal(r.otherParty.licensePlate, 'ABC123');
  });
});

describe('E-signature consent and prerequisites', () => {
  function ready(extra: Record<string, unknown> = {}) {
    return crash({ vehicleMake: 'BMW', vehicleModel: 'X5', repairIntentConfirmed: true, ...extra });
  }

  test('consent missing is rejected', () => {
    const v = validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'sms' } }, ready());
    assert.equal(v.ok, false);
    assert.match(v.reason!, /only send it if they say yes/i);
  });

  test('consent false is rejected', () => {
    const v = validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'sms', consentConfirmed: false } }, ready());
    assert.equal(v.ok, false);
  });

  test('an email address is not consent', () => {
    const s = ready();
    s.contact.email = 'michael@example.com';
    assert.equal(validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'email' } }, s).ok, false);
  });

  test('repair intent is required — a crash is not agreement to use this shop', () => {
    const v = validateToolRequest(
      { id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'sms', consentConfirmed: true } },
      crash({ vehicleMake: 'BMW', vehicleModel: 'X5' }),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /repairIntentConfirmed/);
  });

  test('vehicle make and model are required', () => {
    const v = validateToolRequest(
      { id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'sms', consentConfirmed: true } },
      crash({ repairIntentConfirmed: true }),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /vehicleMake/);
  });

  test('no claim number is required under the demo policy', () => {
    assert.equal(packetById('collision_repair_intake')!.requiresClaimNumber, false);
    assert.equal(validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'sms', consentConfirmed: true } }, ready()).ok, true);
  });

  test('the packet contains a Direction to Pay, described conservatively', () => {
    const packet = packetById('collision_repair_intake')!;
    const dtp = packet.components!.find((c) => c.id === 'direction_to_pay')!;
    assert.match(dtp.plainExplanation, /eligible insurance claim payments to go directly/i);
    assert.match(dtp.plainExplanation, /Do NOT say insurance has to pay the shop/i);
    assert.match(dtp.plainExplanation, /guarantees payment/i);
    // It is not described as assigning the claim.
    assert.doesNotMatch(dtp.plainExplanation.split('Do NOT')[0], /assign/i);
  });

  test('the template still comes from configuration only', () => {
    const v = validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'tpl_whatever_i_like', deliveryChannel: 'sms', consentConfirmed: true } }, ready());
    assert.equal(v.ok, false);
  });

  test('the component explanations reach the tool result', async () => {
    const out = await executeToolRequest(
      { id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'sms', consentConfirmed: true } },
      deps(createMockToolbox(), ready()),
    );
    const parsed = JSON.parse(out.content) as { contains: string[] };
    assert.ok(parsed.contains.some((c) => /Direction to Pay/i.test(c)));
    assert.ok(parsed.contains.some((c) => /teardown/i.test(c)));
  });

  test('no configured explanation promises payment', () => {
    for (const p of ESIGN_PACKETS) {
      for (const c of p.components ?? []) {
        const affirmative = c.plainExplanation.split(/\bDo NOT\b/i)[0];
        assert.doesNotMatch(affirmative, /guarantee|has to pay|must pay|will pay/i, `${p.id}/${c.id}`);
      }
    }
  });
});

describe('Personal injury packet requires an explicit "no lawyer"', () => {
  function piSession(qual: Record<string, unknown> = {}): Session {
    const store = new SessionStore();
    const s = store.ensure('CA_pi', '+19045550142', '+1904');
    store.setRoute('CA_pi', { industry: 'attorneys', specialty: 'personal_injury', intent: 'car_accident', urgency: 'high', confidence: 0.9, source: 'heuristic' });
    Object.assign(s.contact, { firstName: 'Michael', phone: '+19045550142' });
    Object.assign(s.qualification, { incidentType: 'rear-ended', incidentDate: '2026-09-01', ...qual });
    return s;
  }
  const send = (s: Session) => validateToolRequest(
    { id: '1', name: 'send_esign_packet', input: { packetId: 'pi_engagement_packet', deliveryChannel: 'sms', consentConfirmed: true } }, s);

  test('an unanswered representation question blocks it', () => {
    // Undefined is not false. "We never asked" is not "they said no".
    const v = send(piSession());
    assert.equal(v.ok, false);
    assert.match(v.reason!, /have not established existingRepresentation/i);
  });

  test('an existing attorney blocks it', () => {
    const v = send(piSession({ existingRepresentation: true }));
    assert.equal(v.ok, false);
    assert.match(v.reason!, /is true/i);
  });

  test('an explicit no allows it', () => {
    assert.equal(send(piSession({ existingRepresentation: false })).ok, true);
  });

  test('the incident date is required', () => {
    const s = piSession({ existingRepresentation: false });
    delete s.qualification.incidentDate;
    assert.equal(send(s).ok, false);
  });

  test('signing still does not create representation', () => {
    assert.equal(packetById('pi_engagement_packet')!.createsRelationshipOnSignature, false);
  });
});

describe('Insurance document uploads', () => {
  test('the purpose exists for collision and is safety-gated', () => {
    const purpose = purposeById('collision_insurance_documents')!;
    assert.ok(purpose);
    assert.match(purpose.safetyPrecondition!, /out of traffic/i);
    assert.ok(policiesFor('collision_repair').upload!.allowedPurposes.includes('collision_insurance_documents'));
  });

  test('it is refused while the caller is unsafe', () => {
    const v = validateToolRequest({ id: '1', name: 'create_upload_link', input: { purposeId: 'collision_insurance_documents', callerIsSafe: false } }, crash());
    assert.equal(v.ok, false);
  });

  test('another industry cannot use it', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_r');
    store.setRoute('CA_r', { industry: 'roofing', specialty: 'general', intent: 'active_leak', urgency: 'high', confidence: 0.9, source: 'heuristic' });
    assert.equal(validateToolRequest({ id: '1', name: 'create_upload_link', input: { purposeId: 'collision_insurance_documents', callerIsSafe: true } }, s).ok, false);
  });
});

describe('The collision summary reads like a service writer needs it', () => {
  test('every section is populated and kept apart', () => {
    const s = crash({
      vehicleYear: '2023', vehicleMake: 'BMW', vehicleModel: 'X5', vehicleColor: 'black',
      vehicleDrivable: false, accidentLocation: 'Buckman Bridge northbound',
      insuranceCarrier: 'State Farm', claimNumberStatus: 'not_filed',
      otherPartyInsuranceCarrier: 'GEICO', otherPartyPolicyNumber: '12345', otherPartyClaimNumberStatus: 'pending',
      faultPosition: 'caller_reports_other_party', citationIssued: true, citedParty: 'other driver',
      repairPaymentPath: 'third_party', repairIntentConfirmed: true,
      towStatus: 'mocked', towDestination: 'our repair facility',
      esignPacketId: 'collision_repair_intake', esignStatus: 'mocked',
      uploadLinkPurpose: 'collision_damage_photos', uploadLinkStatus: 'mocked',
      locationLinkStatus: 'mocked', rentalNeeded: true,
      referralOffered: true, referralConsent: true, referralPartner: 'pi_partner_demo', referralStatus: 'mocked',
    });
    s.roadsideLocation = { source: 'current_location', latitude: 30.1, longitude: -81.6, confirmed: true };

    const r = buildCollisionRecord(s);
    assert.equal(r.vehicle.make, 'BMW');
    assert.equal(r.customerInsurance.carrier, 'State Farm');
    assert.equal(r.customerInsurance.claimStatus, 'not_filed');
    assert.equal(r.otherPartyInsurance.carrier, 'GEICO');
    assert.equal(r.otherPartyInsurance.claimStatus, 'pending');
    assert.equal(r.repair.paymentPath, 'third_party');
    assert.equal(r.repair.directionToPayIncluded, true);
    assert.equal(r.repair.photoUploadStatus, 'mocked');
    assert.equal(r.referral.consent, true);
    assert.equal(r.accident.preciseLocationCaptured, true);
  });

  test('coordinates never appear in the record, only the flag', () => {
    const s = crash({});
    s.roadsideLocation = { source: 'pin', latitude: 30.1588, longitude: -81.6821, confirmed: true };
    const json = JSON.stringify(buildCollisionRecord(s));
    assert.doesNotMatch(json, /30\.15|81\.68/);
    assert.match(json, /"preciseLocationCaptured":true/);
  });

  test('it attaches to the call summary for collision calls only', () => {
    assert.ok(buildCallSummary(crash({}), []).collision);
    const store = new SessionStore();
    const other = store.ensure('CA_other');
    store.setRoute('CA_other', { industry: 'plumbing', specialty: 'emergency', intent: 'active_water_leak', urgency: 'high', confidence: 0.9, source: 'heuristic' });
    assert.equal(buildCallSummary(other, []).collision, undefined);
  });
});
