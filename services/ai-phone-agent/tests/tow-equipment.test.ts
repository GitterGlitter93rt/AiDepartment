import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recommendTowType, drivetrainFromSpeech, needsDrivetrain } from '../src/business/tow-equipment.ts';
import { parseKeyHandoff, saysLeaving, shopDeliveryReassurance } from '../src/business/key-handoff.ts';
import { preToolAcknowledgement, immediateResultSpeech, validateToolRequest, executeToolRequest } from '../src/core/tool-protocol.ts';
import { classifyHeuristic } from '../src/core/router.ts';
import { selectSpecialist } from '../src/industries/index.ts';
import { SessionStore } from '../src/core/session.ts';
import { createMockToolbox } from '../src/tools/index.ts';
import { createLogger } from '../src/logger.ts';
import { COLLISION_KNOWLEDGE } from '../src/knowledge/trades.ts';
import { renderOfferMemory } from '../src/core/goals.ts';
import { renderActionPolicies } from '../src/business/render-policies.ts';

const MODES = { tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock' };

/** Mirrors the orchestrator: a car on a truck counts as having asked. */
const towed = (s: { qualification: Record<string, unknown> }) => Boolean(s.qualification.towStatus);

const log = createLogger({}, () => {});

function towCall(said = 'I got into an accident and need a tow.') {
  const sessions = new SessionStore();
  const callSid = `CAtow${Math.random().toString(36).slice(2)}`;
  const session = sessions.ensure(callSid, '+19045551234', '+19046829345');
  const d = classifyHeuristic(said);
  if (d) sessions.setRoute(callSid, d);
  sessions.addTurn(callSid, 'caller', said);
  sessions.mergeContact(callSid, { firstName: 'Mike', phone: '+19045551234', phoneConfirmed: true });
  Object.assign(session.qualification, { vehicleDrivable: false, towNeeded: true });
  return { sessions, session, callSid };
}

const TOW_ARGS = {
  callerName: 'Mike', callbackPhone: '+19045551234',
  pickupLocation: 'Buckman Bridge northbound near the south exit',
  directionOfTravel: 'northbound',
  vehicleYear: '2019', vehicleMake: 'BMW', vehicleModel: '330i', vehicleColor: 'black',
  paymentPath: 'insurance', insuranceCarrier: 'GEICO', claimNumber: 'CLM-9',
  towCostDisclosed: true,
};

describe('A. an explicit tow request does not ask if it is drivable', () => {
  test('the opening moves to where the vehicle is', () => {
    const { session } = towCall();
    assert.equal(session.route.intent, 'towing_needed');
    const opening = selectSpecialist(session)!.openingLine(session);
    assert.doesNotMatch(opening, /drivable|do you need a tow/i);
    assert.match(opening, /where/i);
  });
});

describe('B–F. the right truck, decided from facts', () => {
  test('B. all-wheel drive is carried, never towed on its wheels', () => {
    for (const drivetrain of ['AWD', '4WD'] as const) {
      const r = recommendTowType({ rolls: true, steers: true, drivetrain });
      assert.equal(r.towType, 'flatbed', drivetrain);
      assert.match(r.reason, /all four wheels driven/i);
    }
  });

  test('C. an unknown drivetrain is never guessed at', () => {
    const r = recommendTowType({ rolls: true, steers: true });
    assert.equal(r.towType, 'dispatcher_review');
    assert.ok(r.missing.includes('drivetrain'));
    assert.ok(needsDrivetrain({ rolls: true, steers: true }));
    // And there is no year/make/model table pretending to know.
    assert.equal(drivetrainFromSpeech('2019 BMW 330i'), null);
    assert.equal(drivetrainFromSpeech("it's all wheel drive"), 'AWD');
    assert.equal(drivetrainFromSpeech("it's a 4x4"), '4WD');
  });

  test('D. rolls but does not steer goes on a bed', () => {
    const r = recommendTowType({ rolls: true, steers: false });
    assert.equal(r.towType, 'flatbed');
    assert.match(r.reason, /does not steer/i);
  });

  test('E. a locked wheel or damaged suspension goes on a bed', () => {
    assert.equal(recommendTowType({ wheelLocked: true }).towType, 'flatbed');
    assert.equal(recommendTowType({ rolls: true, steers: true, drivetrain: 'RWD', suspensionDamage: true }).towType, 'flatbed');
    assert.equal(recommendTowType({ rolls: false }).towType, 'flatbed');
  });

  test('F. restricted access is a dispatcher decision, not a guess', () => {
    // No rule of thumb survives a real parking garage.
    for (const accessType of ['parking_garage', 'tight_access'] as const) {
      assert.equal(recommendTowType({ rolls: true, steers: true, drivetrain: 'FWD', accessType }).towType, 'dispatcher_review');
    }
    for (const accessType of ['ditch', 'median'] as const) {
      assert.equal(recommendTowType({ accessType }).towType, 'recovery');
    }
    assert.equal(recommendTowType({ recoveryRequired: true }).towType, 'recovery');
  });

  test('a collision vehicle defaults to a bed even when it could be lifted', () => {
    const r = recommendTowType({ rolls: true, steers: true, drivetrain: 'FWD', accessType: 'road' });
    assert.equal(r.towType, 'flatbed');
    assert.deepEqual(r.missing, []);
  });
});

describe('G–H. the caller leaves, the keys do not', () => {
  test('G. key on the driver’s rear tyre', () => {
    const k = parseKeyHandoff("I'll put the key on top of the driver's rear tire");
    assert.equal(k?.method, 'hidden_at_vehicle');
    assert.equal(k?.location, 'driver_rear_tire');
    assert.match(k!.instructions, /driver's rear tire/i);
  });

  test('H. key inside, vehicle left unlocked', () => {
    const k = parseKeyHandoff("I'll leave it under the driver's seat and leave it unlocked");
    assert.equal(k?.method, 'inside_vehicle');
    assert.equal(k?.location, 'under_driver_seat');
    assert.equal(k?.unlocked, true);
    assert.match(k!.instructions, /unlocked/i);
  });

  test('waiting, and a third party, are both handled', () => {
    assert.equal(parseKeyHandoff("I'll wait here with the car")?.method, 'hand_to_driver');
    assert.equal(parseKeyHandoff('my wife is here waiting')?.method, 'third_party_handoff');
  });

  test('a vague answer is not turned into an instruction', () => {
    // Guessing produces a driver feeling around a stranger's wheel arch.
    assert.equal(parseKeyHandoff("I'll leave it somewhere"), null);
    assert.equal(parseKeyHandoff('I have to go, my ride is here'), null);
  });

  test('leaving is recognised from how people actually say it', () => {
    for (const s of ['I have to go', "I can't stay", 'my ride is here so I need to leave', "I'm getting a lift"]) {
      assert.ok(saysLeaving(s), s);
    }
    assert.ok(!saysLeaving("I'll wait here with the car"));
  });

  test('a tow will not dispatch for a departing caller with no key plan', () => {
    const { session } = towCall();
    Object.assign(session.qualification, { callerLeaving: true });
    const r = validateToolRequest({ id: 't', name: 'dispatch_tow', input: TOW_ARGS }, session, new Date());
    assert.equal(r.ok, false);
    assert.ok(r.missing?.includes('key_handoff_plan'));
    assert.match(r.reason!, /where they will put the key/i);
  });
});

describe('I. the driver is told everything the agent already knows', () => {
  test('the dispatch payload carries equipment, access and keys', async () => {
    const sent: Record<string, unknown>[] = [];
    const tools = createMockToolbox();
    const real = tools.tow.dispatch.bind(tools.tow);
    tools.tow.dispatch = async (req: never) => { sent.push(req); return real(req); };

    const { session } = towCall();
    const out = await executeToolRequest({
      id: 't', name: 'dispatch_tow',
      input: {
        ...TOW_ARGS,
        rolls: true, steers: false, wheelLocked: false, suspensionDamage: true,
        drivetrain: 'AWD', accessType: 'road', accessNotes: 'north side, past the crest',
        unattended: true, keyHandoffMethod: 'hidden_at_vehicle',
        keyInstructions: "Key on top of driver's rear tire.", vehicleUnlockedForTow: false,
        insuranceCarrier: 'State Farm', claimNumber: 'SF-1234',
      },
    }, { tools, log, session });

    assert.equal(out.ok, true, out.content);
    const payload = sent[0];
    assert.equal(payload.towType, 'flatbed');
    assert.match(String(payload.towTypeReason), /suspension|steer|driven/i);
    assert.equal(payload.drivetrain, 'AWD');
    assert.equal(payload.unattended, true);
    assert.equal(payload.keyInstructions, "Key on top of driver's rear tire.");
    assert.equal(payload.accessNotes, 'north side, past the crest');
    assert.equal(payload.insuranceCarrier, 'State Farm');
    assert.equal(payload.claimNumber, 'SF-1234');
    assert.equal(payload.vehicleMake, 'BMW');
    // And it is recorded, so nothing is asked twice.
    const q = session.qualification as Record<string, unknown>;
    assert.equal(q.towDriverKeyInstructions, "Key on top of driver's rear tire.");
    assert.equal(q.keyInstructionsConfirmed, true);
    assert.equal(q.towType, 'flatbed');
  });
});

describe('J. the shop end of the journey', () => {
  test('a closed shop means the secure key drop, said plainly', () => {
    const line = shopDeliveryReassurance('our repair facility');
    assert.match(line, /straight to our repair facility/i);
    assert.match(line, /secure key drop/i);
    assert.match(line, /closed/i);
  });

  test('it is durable knowledge, not one improvised sentence', () => {
    const entry = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.shop_key_drop')!;
    assert.match(entry.guidance, /secure key drop/i);
    assert.match(entry.guidance, /without being asked/i);
  });

  test('a dispatched tow records how the vehicle is handed over', async () => {
    const { session } = towCall();
    await executeToolRequest({ id: 't', name: 'dispatch_tow', input: TOW_ARGS }, { tools: createMockToolbox(), log, session });
    assert.equal((session.qualification as Record<string, unknown>).shopKeyDeliveryMethod, 'secure_key_drop');
  });
});

describe('K–N. the caller never waits in silence, and never hears a lie', () => {
  test('K. every slow action has something safe to say first', () => {
    for (const tool of ['dispatch_tow', 'create_location_link', 'send_esign_packet', 'book_appointment', 'request_advisor_callback']) {
      const ack = preToolAcknowledgement(tool);
      assert.ok(ack, `${tool} has no acknowledgement`);
      assert.ok(ack!.length < 100, 'an acknowledgement is one short line');
    }
    assert.equal(preToolAcknowledgement('capture_details'), null, 'instant tools need no cover');
  });

  test('N. the acknowledgement never claims the thing is done', () => {
    // It is said BEFORE the tool runs, and the tool may still fail.
    for (const tool of ['dispatch_tow', 'send_esign_packet', 'book_appointment']) {
      const ack = preToolAcknowledgement(tool)!;
      assert.doesNotMatch(ack, /confirmed|is booked|has been sent|on the way|all set|is arranged/i, tool);
      assert.match(ack, /\b(I'm|Let me|One moment)\b/, tool);
    }
  });

  test('M. a confirmed dispatch speaks its ETA without another model call', () => {
    const outcome = {
      id: 't', name: 'dispatch_tow', ok: true,
      content: JSON.stringify({ mode: 'dispatched', etaSpeech: "They're estimating about 30 to 45 minutes." }),
    };
    const speech = immediateResultSpeech('dispatch_tow', outcome)!;
    assert.match(speech, /confirmed/i);
    assert.match(speech, /30 to 45 minutes/);
  });

  test('a dispatch with no ETA yet says so rather than inventing one', () => {
    const outcome = { id: 't', name: 'dispatch_tow', ok: true, content: JSON.stringify({ mode: 'dispatched' }) };
    const speech = immediateResultSpeech('dispatch_tow', outcome)!;
    assert.match(speech, /as soon as a driver is assigned/i);
    assert.doesNotMatch(speech, /\d+ minutes/);
  });

  test('N. a failed dispatch never produces a success line', () => {
    const failed = { id: 't', name: 'dispatch_tow', ok: false, content: 'Get their name first.' };
    assert.equal(immediateResultSpeech('dispatch_tow', failed), null);
  });

  test('a mocked dispatch is never reported as a real one', () => {
    // The mock has its own careful wording; short-circuiting it would
    // have the demo claim a truck was actually sent.
    const mocked = { id: 't', name: 'dispatch_tow', ok: true, content: JSON.stringify({ mode: 'mocked' }) };
    assert.equal(immediateResultSpeech('dispatch_tow', mocked), null);
  });
});

describe('O–P. once only, and the story afterwards', () => {
  test('O. the location link is offered once and then remembered', async () => {
    const { session } = towCall();
    const tools = createMockToolbox();
    await executeToolRequest({ id: 't', name: 'create_location_link', input: {} }, { tools, log, session });
    const memory = renderOfferMemory(session)!;
    assert.match(memory, /location link has been dealt with/i);
    assert.match(memory, /Offering something a second time/i);
  });

  test('P. the repair process is in the prompt once the vehicle is on a truck', async () => {
    const { session } = towCall();
    const before = renderActionPolicies('collision_repair', MODES, { repairTimeline: towed(session) })!;
    assert.doesNotMatch(before, /teardown/i);
    await executeToolRequest({ id: 't', name: 'dispatch_tow', input: TOW_ARGS }, { tools: createMockToolbox(), log, session });
    const after = renderActionPolicies('collision_repair', MODES, { repairTimeline: towed(session) })!;
    for (const beat of ['teardown', 'insurer review', 'approv', 'parts']) {
      assert.match(after, new RegExp(beat, 'i'), beat);
    }
  });

  test('11. the insurance gate did not move', () => {
    // Equipment questions must not have become a way around the
    // prerequisites that were already there.
    const { session } = towCall();
    for (const [label, input] of [
      ['no name', { ...TOW_ARGS, callerName: undefined }],
      ['no location', { ...TOW_ARGS, pickupLocation: undefined }],
      ['bridge, no direction', { ...TOW_ARGS, directionOfTravel: undefined }],
      ['no vehicle', { ...TOW_ARGS, vehicleMake: undefined, vehicleModel: undefined }],
    ] as [string, Record<string, unknown>][]) {
      const r = validateToolRequest({ id: 't', name: 'dispatch_tow', input }, session, new Date());
      assert.equal(r.ok, false, `${label} should not dispatch`);
    }
  });
});
