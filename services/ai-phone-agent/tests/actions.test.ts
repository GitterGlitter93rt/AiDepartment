// Accident dispatch, e-sign packets, secure uploads and partner
// referrals.
//
// The security model these all share: Claude picks from a list, the
// backend owns the list. Most of what follows is proving that a model
// cannot step outside it — no invented tow yard, template, upload
// bucket, partner or URL.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateToolRequest, executeToolRequest, TOOL_SCHEMAS } from '../src/core/tool-protocol.ts';
import { SessionStore } from '../src/core/session.ts';
import { createLogger } from '../src/logger.ts';
import { createMockToolbox } from '../src/tools/index.ts';
import { createMockTow, createMockEsign, createMockUploadLink, createMockReferral, speechFor } from '../src/tools/actions.ts';
import {
  policiesFor, packetById, purposeById, partnerById,
  COLLISION_DEMO_TOW, COLLISION_DEMO_REPAIR, ESIGN_PACKETS, UPLOAD_PURPOSES, REFERRAL_PARTNERS,
} from '../src/business/policies.ts';
import { renderActionPolicies } from '../src/business/render-policies.ts';
import { buildCallSummary, buildDemoAnalytics } from '../src/core/call-summary.ts';
import type { Session } from '../src/core/types.ts';
import type { Toolbox } from '../src/tools/index.ts';

const silent = createLogger({}, () => {});

/**
 * Sentences that ASSERT something, with prohibitions filtered out.
 *
 * Policy text says "never say insurance will cover it", which contains
 * the exact phrase a promise would. Scanning the raw string flags the
 * safeguard as the danger, so the negated clauses are dropped first.
 */
function affirmativeSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\\n|\n/)
    .filter((s) => s.trim() !== '')
    .filter((s) => !/\b(never|do not|don'?t|must not|cannot|can'?t|no\b.*\b(promise|guarantee))\b/i.test(s));
}

/** A session with everything the collision packet now requires. */
function packetReady(qual: Record<string, unknown> = {}): Session {
  return collisionSession({}, {
    vehicleMake: 'BMW', vehicleModel: 'X5', repairIntentConfirmed: true, ...qual,
  });
}

function collisionSession(over: Partial<Session['contact']> = {}, qual: Record<string, unknown> = {}): Session {
  const store = new SessionStore();
  const s = store.ensure('CA_act', '+19045550142', '+19045550100');
  store.setRoute('CA_act', {
    industry: 'collision_repair', specialty: 'general', intent: 'accident_repair',
    urgency: 'emergency', confidence: 0.9, source: 'heuristic',
  });
  // Confirmed by default: these fixtures represent a call where the
  // caller has already agreed the number we have is the right one.
  Object.assign(s.contact, { firstName: 'Michael', phone: '+19045550142', phoneSource: 'caller_id', phoneConfirmed: true }, over);
  Object.assign(s.qualification, qual);
  return s;
}

const deps = (tools: Toolbox, session: Session) => ({ tools, log: silent, session });

/**
 * A tow request with everything the hardened validator needs: the
 * vehicle a driver has to spot, and a number to reach them on.
 */
const TOW = {
  callerName: 'Michael', callbackPhone: '+19045550142',
  vehicleMake: 'BMW', vehicleModel: 'X5',
};
/** Session state proving the vehicle genuinely cannot be driven. */
const UNDRIVABLE = { towNeeded: true };

describe('Tow dispatch', () => {
  test('a bridge without a direction is refused — a driver cannot find them', () => {
    const v = validateToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW, pickupLocation: 'the Buckman Bridge in Jacksonville' } },
      collisionSession({}, UNDRIVABLE),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /direction of travel/i);
  });

  test('with a direction it goes through', () => {
    const v = validateToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW, pickupLocation: 'Buckman Bridge, on the shoulder', directionOfTravel: 'northbound' } },
      collisionSession({}, UNDRIVABLE),
    );
    assert.equal(v.ok, true);
    assert.equal(v.value!.directionOfTravel, 'northbound');
  });

  test('a vague location is refused', () => {
    for (const pickup of ['I-95', 'here', 'the bridge']) {
      const v = validateToolRequest(
        { id: '1', name: 'dispatch_tow', input: { ...TOW, pickupLocation: pickup } },
        collisionSession({}, UNDRIVABLE),
      );
      assert.equal(v.ok, false, `accepted "${pickup}"`);
    }
  });

  test('no name or no callback number is refused', () => {
    const s = collisionSession({}, UNDRIVABLE);
    assert.equal(validateToolRequest({ id: '1', name: 'dispatch_tow', input: { ...TOW, callerName: undefined, pickupLocation: 'Oak Street near the school' } }, s).ok, false);
    assert.equal(validateToolRequest({ id: '1', name: 'dispatch_tow', input: { ...TOW, callbackPhone: '555', pickupLocation: 'Oak Street near the school' } }, s).ok, false);
  });

  test('the destination comes from configuration, not the model', () => {
    const v = validateToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW, pickupLocation: 'Oak Street by the school', destinationId: 'some_other_yard', destinationName: 'Bobs Towing' } },
      collisionSession({}, UNDRIVABLE),
    );
    assert.equal(v.ok, true);
    assert.equal(v.value!.destinationId, COLLISION_DEMO_TOW.defaultDestinationId, 'the model cannot pick a destination');
    assert.equal(v.value!.destinationName, 'our repair facility');
  });

  test('an industry with no tow policy cannot dispatch one', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_no_tow');
    store.setRoute('CA_no_tow', { industry: 'roofing', specialty: 'general', intent: 'active_leak', urgency: 'high', confidence: 0.9, source: 'heuristic' });
    const v = validateToolRequest({ id: '1', name: 'dispatch_tow', input: { ...TOW, pickupLocation: 'Oak Street by the school' } }, s);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /does not arrange towing/i);
  });

  test('executing records state and never invents an ETA or a company', async () => {
    const s = collisionSession({}, UNDRIVABLE);
    const out = await executeToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW, pickupLocation: 'Buckman Bridge shoulder', directionOfTravel: 'northbound' } },
      deps(createMockToolbox(), s),
    );
    assert.equal(out.ok, true);
    const parsed = JSON.parse(out.content) as { mode: string; speech: string; eta: string; billing: string };
    assert.equal(parsed.mode, 'mocked');
    assert.equal(s.qualification.towRequested, true);
    assert.equal(s.qualification.towStatus, 'mocked');

    // Mock mode must not be described as done.
    assert.match(parsed.speech, /NOT ACTUALLY SENT/);
    assert.doesNotMatch(parsed.speech, /I've sent|I have sent/i);
    // Only the configured range, flagged as approximate.
    assert.match(parsed.eta, /45 to 90/);
    assert.match(parsed.eta, /approximation|never a promise/i);
    // Billing language never promises coverage.
    assert.match(parsed.billing, /depends on the claim/i);
    assert.match(parsed.billing, /Never say the tow is free/i);
  });

  test('a live provider ETA is used when one is returned', async () => {
    const s = collisionSession({}, UNDRIVABLE);
    const tools = createMockToolbox({
      tow: { mode: 'live', async dispatch(r) { return { mode: 'sent', destinationName: r.destinationName, driverEtaMinutes: 38 }; } },
    });
    const out = await executeToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW, pickupLocation: 'Oak Street by the school' } },
      deps(tools, s),
    );
    const parsed = JSON.parse(out.content) as { eta: string; speech: string };
    assert.match(parsed.eta, /38 minutes/);
    assert.match(parsed.speech, /^DONE/);
  });
});

describe('Repair process explanation', () => {
  test('the policy carries the teardown window and the weekly range', () => {
    assert.equal(COLLISION_DEMO_REPAIR.teardownMinDays, 1);
    assert.equal(COLLISION_DEMO_REPAIR.teardownMaxDays, 2);
    assert.equal(COLLISION_DEMO_REPAIR.repairMinWeeks, 1);
    assert.equal(COLLISION_DEMO_REPAIR.repairMaxWeeks, 4);
  });

  test('the insurer review step does not claim an adjuster always attends', () => {
    const step = COLLISION_DEMO_REPAIR.steps.find((x) => /insurer review/i.test(x.title))!;
    assert.match(step.detail, /photos|electronically|varies/i);
    assert.doesNotMatch(step.detail, /will (come|send an adjuster)/i);
  });

  test('the rendered block gives the process AND refuses a date', () => {
    const block = renderActionPolicies('collision_repair', { tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock' }, { repairTimeline: true })!;
    assert.match(block, /1 to 2 business days/);
    assert.match(block, /1 to 4 weeks/);
    assert.match(block, /date comes after teardown/i);
    assert.match(block, /hidden damage/i);
    // Rental is never promised as covered.
    assert.match(block, /Do not say rental is covered/i);
  });

  test('the timeline is not carried until someone asks for it', () => {
    // It is a page of explanation whose own heading says "use this
    // when they ask how long it will take". Carrying it on every turn
    // pays for an answer to a question nobody asked.
    const block = renderActionPolicies('collision_repair', { tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock' })!;
    assert.doesNotMatch(block, /1 to 2 business days/);
    assert.doesNotMatch(block, /HOW THE REPAIR ACTUALLY GOES/);
    // Everything else the agent needs on an ordinary turn is still there.
    assert.match(block, /TOWING/);
  });

  test('towing billing never guarantees payment anywhere it is rendered', () => {
    const block = renderActionPolicies('collision_repair', { tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock' })!;
    // Checked on affirmative sentences only. The policy deliberately
    // contains "never say insurance will cover it", and a naive scan
    // flags the prohibition as though it were the promise.
    for (const sentence of affirmativeSentences(block)) {
      assert.doesNotMatch(sentence, /insurance (will|does) (cover|pay)/i, `promised coverage: "${sentence}"`);
      assert.doesNotMatch(sentence, /the tow is free/i, `promised a free tow: "${sentence}"`);
    }
    // And the prohibitions themselves must be present.
    assert.match(block, /[Nn]ever say the tow is free/);
    assert.match(block, /depends on the claim/i);
  });
});

describe('E-signature packets', () => {
  test('only a configured packet id is accepted', () => {
    const s = collisionSession();
    const v = validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'tpl_anything_i_want', deliveryChannel: 'sms', consentConfirmed: true } }, s);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /not a packet this business sends/i);
  });

  test('a packet belonging to another industry is rejected', () => {
    const s = collisionSession();
    const v = validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'pi_engagement_packet', deliveryChannel: 'sms', consentConfirmed: true } }, s);
    assert.equal(v.ok, false);
  });

  test('required fields must exist before anything is sent', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_bare', '+19045550142', '+1904');
    store.setRoute('CA_bare', { industry: 'collision_repair', specialty: 'general', intent: 'accident_repair', urgency: 'normal', confidence: 0.9, source: 'heuristic' });
    const v = validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'sms', consentConfirmed: true } }, s);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /missing firstName/i);
  });

  test('email delivery without an email address is refused', () => {
    const v = validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'email', consentConfirmed: true } }, packetReady());
    assert.equal(v.ok, false);
    assert.match(v.reason!, /email address is needed/i);
  });

  test('a valid send resolves the template from config and records state', async () => {
    const s = packetReady();
    const out = await executeToolRequest(
      { id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'sms', consentConfirmed: true } },
      deps(createMockToolbox(), s),
    );
    assert.equal(out.ok, true);
    const parsed = JSON.parse(out.content) as { mode: string; speech: string; relationship: string; afterSend: string };
    assert.equal(s.qualification.esignPacketId, 'collision_repair_intake');
    assert.equal(s.qualification.esignStatus, 'mocked');
    assert.match(parsed.speech, /NOT ACTUALLY SENT/);
    assert.match(parsed.afterSend, /Do not describe what the forms say/i);
  });

  test('the PI packet does NOT create representation by default', () => {
    const packet = packetById('pi_engagement_packet')!;
    assert.equal(packet.createsRelationshipOnSignature, false);
    assert.match(packet.afterSendLanguage, /confirm representation/i);
    assert.match(packet.afterSendLanguage, /Do NOT say they are represented/i);
  });

  test('every configured packet defaults to not creating a relationship', () => {
    for (const p of ESIGN_PACKETS) {
      assert.equal(p.createsRelationshipOnSignature, false, `${p.id} would imply a relationship on signature`);
    }
  });

  test('the tool result spells out that signing is not acceptance', async () => {
    const store = new SessionStore();
    const s = store.ensure('CA_pi', '+19045550142', '+1904');
    store.setRoute('CA_pi', { industry: 'attorneys', specialty: 'personal_injury', intent: 'car_accident', urgency: 'high', confidence: 0.9, source: 'heuristic' });
    Object.assign(s.contact, { firstName: 'Michael', phone: '+19045550142', phoneConfirmed: true });
    Object.assign(s.qualification, {
      incidentType: 'rear-ended', incidentDate: '2026-09-01', existingRepresentation: false,
      accidentLocation: 'Buckman Bridge northbound',
    });

    const out = await executeToolRequest(
      { id: '1', name: 'send_esign_packet', input: { packetId: 'pi_engagement_packet', deliveryChannel: 'sms', consentConfirmed: true } },
      deps(createMockToolbox(), s),
    );
    const parsed = JSON.parse(out.content) as { relationship: string };
    assert.match(parsed.relationship, /does NOT by itself/i);
    assert.match(parsed.relationship, /reviewed and confirmed/i);
  });
});

describe('Secure upload links', () => {
  test('only a purpose this business allows is accepted', () => {
    const v = validateToolRequest({ id: '1', name: 'create_upload_link', input: { purposeId: 'medical_records', callerIsSafe: true } }, collisionSession());
    assert.equal(v.ok, false);
    assert.match(v.reason!, /not an upload type this business accepts/i);
  });

  test("another industry's purpose is rejected", () => {
    const v = validateToolRequest({ id: '1', name: 'create_upload_link', input: { purposeId: 'construction_bid_documents', callerIsSafe: true } }, collisionSession());
    assert.equal(v.ok, false);
  });

  test('photos are refused while the caller is not yet safe', () => {
    const v = validateToolRequest({ id: '1', name: 'create_upload_link', input: { purposeId: 'collision_damage_photos', callerIsSafe: false } }, collisionSession());
    assert.equal(v.ok, false);
    assert.match(v.reason!, /out of traffic|somewhere safe/i);
  });

  test('the model cannot supply a URL — there is no parameter for one', () => {
    const schema = TOOL_SCHEMAS.find((t) => t.name === 'create_upload_link')!;
    const props = Object.keys(schema.input_schema.properties);
    assert.deepEqual(props.sort(), ['callerIsSafe', 'purposeId']);
    for (const p of props) assert.doesNotMatch(p, /url|link|href|endpoint/i);
  });

  test('the backend builds the link and it is never returned to the model', async () => {
    const s = collisionSession();
    const out = await executeToolRequest(
      { id: '1', name: 'create_upload_link', input: { purposeId: 'collision_damage_photos', callerIsSafe: true } },
      deps(createMockToolbox(), s),
    );
    assert.equal(out.ok, true);
    // A tokenised URL in a tool result is a URL the model can read out.
    assert.doesNotMatch(out.content, /https?:\/\//);
    assert.equal(s.qualification.uploadLinkPurpose, 'collision_damage_photos');
  });

  test('electrical photo guidance never asks anyone to open a panel', () => {
    const purpose = purposeById('electrical_panel_photos')!;
    assert.match(purpose.guidance, /cover CLOSED/i);
    assert.match(purpose.safetyPrecondition!, /Never ask anyone to remove a panel cover/i);
    assert.match(purpose.safetyPrecondition!, /sparking|smoking/i);
  });

  test('plumbing photos come after the water is off', () => {
    assert.match(purposeById('plumbing_leak_photos')!.safetyPrecondition!, /AFTER the water is shut off/i);
  });

  test('roofing photos are from the ground', () => {
    assert.match(purposeById('roof_damage_photos')!.safetyPrecondition!, /Never suggest anyone climb/i);
  });

  test('construction offers plans and bid documents as separate purposes', () => {
    const allowed = policiesFor('construction').upload!.allowedPurposes;
    assert.ok(allowed.includes('construction_plans'));
    assert.ok(allowed.includes('construction_bid_documents'));
  });

  test('a bid package upload goes through for construction', async () => {
    const store = new SessionStore();
    const s = store.ensure('CA_con', '+19045550142', '+1904');
    store.setRoute('CA_con', { industry: 'construction', specialty: 'general', intent: 'general_inquiry', urgency: 'normal', confidence: 0.9, source: 'heuristic' });
    Object.assign(s.contact, { firstName: 'Michael', phone: '+19045550142', phoneConfirmed: true });

    const out = await executeToolRequest(
      { id: '1', name: 'create_upload_link', input: { purposeId: 'construction_bid_documents', callerIsSafe: true } },
      deps(createMockToolbox(), s),
    );
    assert.equal(out.ok, true);
    assert.equal(s.qualification.uploadLinkPurpose, 'construction_bid_documents');
  });
});

describe('Partner referrals are consent-gated', () => {
  test('no consent, no referral — even with everything else present', () => {
    const v = validateToolRequest(
      { id: '1', name: 'create_partner_referral', input: { partnerId: 'pi_partner_demo', consentConfirmed: false } },
      collisionSession({}, { injuryReported: true }),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /agreeing to this/i);
  });

  test('mentioning an injury is not consent', async () => {
    // The failure mode this whole tool exists to prevent.
    const s = collisionSession({}, { injuryReported: true, everyoneOkay: false });
    const v = validateToolRequest({ id: '1', name: 'create_partner_referral', input: { partnerId: 'pi_partner_demo' } }, s);
    assert.equal(v.ok, false);
    assert.equal(s.qualification.referralConsent, undefined, 'nothing recorded without a yes');
  });

  test('an arbitrary partner is rejected', () => {
    const v = validateToolRequest(
      { id: '1', name: 'create_partner_referral', input: { partnerId: 'some-other-law-firm.example.com', consentConfirmed: true } },
      collisionSession(),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /not a partner this business refers to/i);
  });

  test('an industry with no referral policy cannot refer', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_nr');
    store.setRoute('CA_nr', { industry: 'roofing', specialty: 'general', intent: 'active_leak', urgency: 'high', confidence: 0.9, source: 'heuristic' });
    Object.assign(s.contact, { firstName: 'A', phone: '+19045550142' });
    const v = validateToolRequest({ id: '1', name: 'create_partner_referral', input: { partnerId: 'pi_partner_demo', consentConfirmed: true } }, s);
    assert.equal(v.ok, false);
  });

  test('with consent it sends a MINIMAL payload and records the consent', async () => {
    const s = collisionSession(
      { email: 'michael@example.com' },
      { injuryReported: true, incidentType: 'rear-ended', accidentLocation: 'Buckman Bridge northbound', accidentDate: '2026-09-01', injuries: 'neck pain, seen at the ER, taking medication' },
    );
    let captured: Record<string, string> = {};
    const tools = createMockToolbox({
      referral: { mode: 'mock', async refer(r) { captured = r.payload; return { mode: 'mocked', partnerId: r.partnerId, reference: 'ref-1' }; } },
    });

    const out = await executeToolRequest(
      { id: '1', name: 'create_partner_referral', input: { partnerId: 'pi_partner_demo', consentConfirmed: true } },
      deps(tools, s),
    );
    assert.equal(out.ok, true);

    // Only the configured fields. Medical narrative is not one of them.
    assert.ok(!('injuries' in captured), 'medical detail must not be sent');
    assert.deepEqual(Object.keys(captured).sort(), ['accidentLocation', 'email', 'firstName', 'incidentType', 'injuryReported', 'phone'].sort());

    assert.equal(s.qualification.referralConsent, true);
    assert.equal(s.qualification.referralPartner, 'pi_partner_demo');
    assert.ok(typeof s.qualification.referralConsentAt === 'string');

    const parsed = JSON.parse(out.content) as { limits: string };
    assert.match(parsed.limits, /Do not say they have a case/i);
  });

  test('the configured offer wording forbids overclaiming', () => {
    const partner = partnerById('pi_partner_demo')!;
    assert.match(partner.offerLanguage, /free case review/i);
    assert.match(partner.offerLanguage, /Do NOT say they have a case/i);
    assert.match(partner.offerLanguage, /Declining changes nothing/i);
  });

  test('the payload configuration carries no medical fields at all', () => {
    for (const p of REFERRAL_PARTNERS) {
      for (const f of p.payloadFields) {
        assert.doesNotMatch(f, /injur(y|ies)$|medical|treatment|diagnos|symptom/i, `${p.id} would send ${f}`);
      }
    }
  });
});

describe('Mock and live speech are distinguished', () => {
  test('mocked is never described as done', () => {
    const s = speechFor('mocked', 'I have sent it.', 'this demo can send it.');
    assert.match(s, /NOT ACTUALLY SENT/);
    assert.match(s, /Do NOT say you sent it/);
  });

  test('sent may be described as done', () => {
    assert.match(speechFor('sent', 'I have sent it.', 'x'), /^DONE/);
  });

  test('failed produces recovery, not a success claim', () => {
    const s = speechFor('failed', 'I have sent it.', 'x');
    assert.match(s, /FAILED/);
    assert.match(s, /do not mention a system problem/i);
    assert.doesNotMatch(s, /I have sent/);
  });

  test('the prompt warns about every mocked provider', () => {
    const block = renderActionPolicies('collision_repair', { tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock' })!;
    assert.match(block, /DEMONSTRATION MODE/);
    assert.match(block, /tow, esign, uploadLink, referral/);
  });

  test('no demonstration warning when everything is live', () => {
    const block = renderActionPolicies('collision_repair', { tow: 'live', esign: 'docusign', uploadLink: 'live', referral: 'live' })!;
    assert.doesNotMatch(block, /DEMONSTRATION MODE/);
  });
});

describe('Tools fail safely', () => {
  test('a failing provider never produces success speech', async () => {
    const s = collisionSession({}, UNDRIVABLE);
    const tools = createMockToolbox({
      tow: { mode: 'live', async dispatch() { throw new Error('provider 503'); } },
    });
    const out = await executeToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW, pickupLocation: 'Oak Street by the school' } },
      deps(tools, s),
    );
    assert.equal(out.ok, false);
    assert.doesNotMatch(out.content, /503|provider|error/i);
    assert.match(out.content, /do not mention a system problem/i);
  });

  test('every new tool refuses empty input rather than crashing', async () => {
    for (const name of ['dispatch_tow', 'create_upload_link', 'send_esign_packet', 'create_partner_referral']) {
      const out = await executeToolRequest({ id: '1', name, input: {} }, deps(createMockToolbox(), collisionSession()));
      assert.equal(out.ok, false, `${name} accepted empty input`);
    }
  });
});

describe('Summaries carry the actions without the medical detail', () => {
  test('a collision summary shows tow, paperwork, photos and referral', () => {
    const s = collisionSession({}, {
      towRequested: true, towStatus: 'mocked', towDestination: 'our repair facility',
      esignPacketId: 'collision_repair_intake', esignStatus: 'mocked',
      uploadLinkPurpose: 'collision_damage_photos', uploadLinkStatus: 'mocked',
      referralOffered: true, referralConsent: true, referralPartner: 'pi_partner_demo', referralStatus: 'mocked',
      injuries: 'neck pain and headaches',
    });
    const summary = buildCallSummary(s, []);
    assert.equal(summary.actions.towRequested, true);
    assert.equal(summary.actions.towDestination, 'our repair facility');
    assert.equal(summary.actions.esignPacketId, 'collision_repair_intake');
    assert.equal(summary.actions.referralConsent, true);
    // The actions block is a record of what was done, not a medical file.
    assert.ok(!('injuries' in summary.actions));
  });

  test('analytics count actions without naming destinations or partners', () => {
    const s = collisionSession({}, { towRequested: true, referralOffered: true, referralConsent: true, referralPartner: 'pi_partner_demo' });
    const ev = buildDemoAnalytics(s);
    assert.equal(ev.towRequested, true);
    assert.equal(ev.referralConsented, true);
    const json = JSON.stringify(ev);
    assert.doesNotMatch(json, /pi_partner_demo/, 'the partner id is not a counting field');
    assert.doesNotMatch(json, /Michael|9045550142/);
  });
});

describe('Policy configuration integrity', () => {
  test('every packet, purpose and partner id is unique', () => {
    for (const list of [ESIGN_PACKETS.map((x) => x.id), UPLOAD_PURPOSES.map((x) => x.id), REFERRAL_PARTNERS.map((x) => x.id)]) {
      assert.equal(new Set(list).size, list.length);
    }
  });

  test('every id a policy allows actually exists', () => {
    for (const industry of ['collision_repair', 'attorneys', 'construction', 'plumbing', 'roofing'] as const) {
      const p = policiesFor(industry);
      for (const id of p.esignPacketIds) assert.ok(packetById(id), `${industry}: unknown packet ${id}`);
      for (const id of p.upload?.allowedPurposes ?? []) assert.ok(purposeById(id), `${industry}: unknown purpose ${id}`);
      for (const id of p.referral?.allowedPartnerIds ?? []) assert.ok(partnerById(id), `${industry}: unknown partner ${id}`);
      if (p.tow) assert.ok(p.tow.destinations.some((d) => d.id === p.tow!.defaultDestinationId));
    }
  });

  test('referral requires consent by configuration, not by convention', () => {
    const policy = policiesFor('collision_repair').referral!;
    assert.equal(policy.requiresExplicitConsent, true);
  });

  test('no policy text promises insurance payment', () => {
    const all = JSON.stringify([COLLISION_DEMO_TOW, COLLISION_DEMO_REPAIR, ESIGN_PACKETS, REFERRAL_PARTNERS]);
    for (const sentence of affirmativeSentences(all)) {
      assert.doesNotMatch(sentence, /insurance will (cover|pay)/i, `promise found: "${sentence}"`);
      assert.doesNotMatch(sentence, /\bguarantee[sd]?\b/i, `guarantee found: "${sentence}"`);
      assert.doesNotMatch(sentence, /free tow/i);
    }
  });
});

describe('END TO END — the Buckman Bridge video demo', () => {
  // The call we intend to record. Driven through the real orchestrator
  // with a scripted model so the routing, state and tool wiring are
  // exercised without an API key.
  test('a fresh crash routes to collision and opens on people, not the car', async () => {
    const { Orchestrator } = await import('../src/core/orchestrator.ts');
    const sessions = new SessionStore();
    const orch = new Orchestrator({ sessions, claude: null, log: silent, tools: createMockToolbox() });

    const first = await orch.handleCallerUtterance('CA_bb', 'I just got into a car accident on the Buckman Bridge in Jacksonville.');
    const session = sessions.get('CA_bb')!;

    assert.equal(session.route.industry, 'collision_repair');
    assert.match(first, /okay|alright|hurt|injur/i, `opened with: "${first}"`);
    assert.doesNotMatch(first, /\bestimate\b|\bbumper\b|\bclaim number\b/i, 'the car must not come first');
  });

  test('the scene sequence keeps state and never claims to locate them', async () => {
    const { Orchestrator } = await import('../src/core/orchestrator.ts');
    const { createRecordingClaudeClient } = await import('../src/claude/client.ts');
    const sessions = new SessionStore();
    // The transport creates the session from Twilio's setup frame before
    // any speech arrives, which is how the caller's number is on file.
    sessions.ensure('CA_bb2', '+19045550142', '+19045550100');
    const claude = createRecordingClaudeClient('Understood.');
    const orch = new Orchestrator({ sessions, claude, log: silent, tools: createMockToolbox() });

    await orch.handleCallerUtterance('CA_bb2', 'I just got into a car crash on the Buckman Bridge in Jacksonville.');
    await orch.handleCallerUtterance('CA_bb2', "I'm okay but my neck hurts a little. The car won't drive.");
    await orch.handleCallerUtterance('CA_bb2', "I'm on the shoulder on the bridge, heading northbound.");

    const system = claude.lastSystem();
    // The agent is told what it can do and how to talk about it.
    assert.match(system, /TOWING/);
    assert.match(system, /direction of travel/i);
    assert.match(system, /DEMONSTRATION MODE/, 'mock providers must be declared');
    // The caller's number is on file without them reading it out.
    assert.equal(sessions.get('CA_bb2')!.contact.phone, '+19045550142');
  });

  test('the tow question is answerable without promising coverage', () => {
    const block = renderActionPolicies('collision_repair', { tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock' })!;
    // "Do I have to pay the tow truck?"
    assert.match(block, /coordinate the towing charge through the insurance claim/i);
    assert.match(block, /depends on the claim, the policy and liability/i);
  });

  test('an injury does not by itself put anything in front of a partner', async () => {
    const s = collisionSession({}, { injuryReported: true });
    const v = validateToolRequest({ id: '1', name: 'create_partner_referral', input: { partnerId: 'pi_partner_demo', consentConfirmed: true } }, s);
    // Consent flag alone is not enough — contact details are needed too,
    // and the agent has to have actually asked.
    assert.equal(v.ok, true, 'with a name and number and consent, it proceeds');

    const bare = new SessionStore().ensure('CA_bare2', '+19045550142', '+1904');
    bare.route = { ...s.route };
    const v2 = validateToolRequest({ id: '1', name: 'create_partner_referral', input: { partnerId: 'pi_partner_demo', consentConfirmed: true } }, bare);
    assert.equal(v2.ok, false, 'no name means no useful referral');
  });

  test('declining the referral leaves no trace and blocks nothing', async () => {
    const s = collisionSession({}, { referralOffered: true, ...UNDRIVABLE, vehicleMake: 'BMW', vehicleModel: 'X5' });
    // The caller said no, so the tool is simply never called.
    assert.equal(s.qualification.referralConsent, undefined);
    // And the collision work carries on — the tow is unaffected.
    const v = validateToolRequest(
      { id: '1', name: 'dispatch_tow', input: { ...TOW, pickupLocation: 'Buckman Bridge shoulder', directionOfTravel: 'northbound' } },
      s,
    );
    assert.equal(v.ok, true);
  });
});

describe('END TO END — the midnight personal injury call', () => {
  test('the packet needs real intake before it can be offered', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_night', '+19045550142', '+1904');
    store.setRoute('CA_night', { industry: 'attorneys', specialty: 'personal_injury', intent: 'car_accident', urgency: 'high', confidence: 0.9, source: 'heuristic' });

    // Nothing captured yet.
    assert.equal(validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'pi_engagement_packet', deliveryChannel: 'sms', consentConfirmed: true } }, s).ok, false);

    // Everything the packet needs — including an explicit "no, I don't
    // already have a lawyer" — and then it is allowed.
    Object.assign(s.contact, { firstName: 'Michael', phone: '+19045550142', phoneConfirmed: true });
    Object.assign(s.qualification, {
      incidentType: 'rear-ended', incidentDate: '2026-09-01', existingRepresentation: false,
      accidentLocation: 'Buckman Bridge northbound',
    });
    assert.equal(validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'pi_engagement_packet', deliveryChannel: 'sms', consentConfirmed: true } }, s).ok, true);
  });

  test('"am I represented now?" is answered by configuration, not by the model', () => {
    // The default is false everywhere, and the tool result says so in
    // words the agent can use.
    assert.equal(packetById('pi_engagement_packet')!.createsRelationshipOnSignature, false);
  });

  test('the PI brain carries the late-night intake and the boundary', async () => {
    const { REGISTRY } = await import('../src/industries/index.ts');
    const pi = REGISTRY.attorneys.find((x) => x.specialty === 'personal_injury')!;
    assert.match(pi.systemPrompt, /CALLING LATE/i);
    assert.match(pi.systemPrompt, /does NOT mean the firm has taken the case/i);
    assert.match(pi.systemPrompt, /no way to run a conflict check/i);
    // The existing legal safety rules survive.
    assert.match(pi.systemPrompt, /recorded statement/i);
  });
});

describe('END TO END — the construction bid package', () => {
  test('the construction brain offers the upload proactively', async () => {
    const { REGISTRY } = await import('../src/industries/index.ts');
    const c = REGISTRY.construction[0];
    assert.match(c.systemPrompt, /secure link so you can send the plans/i);
    assert.match(c.systemPrompt, /create_upload_link/);
    assert.match(c.systemPrompt, /bid package and the plans are separate purposes/i);
    assert.ok(c.qualificationSchema.some((f) => f.key === 'bidDueDate'));
  });

  test('a bid caller routes to construction and reaches the upload policy', async () => {
    const { Orchestrator } = await import('../src/core/orchestrator.ts');
    const { createRecordingClaudeClient } = await import('../src/claude/client.ts');
    const sessions = new SessionStore();
    const claude = createRecordingClaudeClient('Understood.');
    const orch = new Orchestrator({ sessions, claude, log: silent, tools: createMockToolbox() });

    await orch.handleCallerUtterance('CA_bid', "I'm getting bids on a commercial buildout for a new office.");
    await orch.handleCallerUtterance('CA_bid', "I've already got the plans and a full PDF bid package.");

    assert.equal(sessions.get('CA_bid')!.route.industry, 'construction');
    const system = claude.lastSystem();
    assert.match(system, /SECURE UPLOADS/);
    assert.match(system, /construction_bid_documents/);
    assert.match(system, /cannot supply a web address/i);
  });
});
