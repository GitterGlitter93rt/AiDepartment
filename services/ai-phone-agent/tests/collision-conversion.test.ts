import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic, detectScenarioChange } from '../src/core/router.ts';
import { selectSpecialist } from '../src/industries/index.ts';
import { SessionStore } from '../src/core/session.ts';
import { validateToolRequest, executeToolRequest, toolsFor, MAX_TOOL_RETRIES } from '../src/core/tool-protocol.ts';
import { renderToolBlocks, renderOfferMemory, renderGoal } from '../src/core/goals.ts';
import { createMockToolbox } from '../src/tools/index.ts';
import { createLogger } from '../src/logger.ts';
import { policiesFor } from '../src/business/policies.ts';
import { renderActionPolicies } from '../src/business/render-policies.ts';
import { CORE_AGENT_RULES } from '../src/prompts/core-agent.ts';

const MODES = { tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock' };

/** Mirrors the orchestrator's rule: asked for, or the car is on a truck. */
function wantsTimeline(session: { qualification: Record<string, unknown> }): boolean {
  const q = session.qualification;
  return Boolean(q.towStatus) || Boolean(q.dropOffScheduled);
}

const log = createLogger({}, () => {});

function shopCall(said: string) {
  const sessions = new SessionStore();
  const callSid = `CA${Math.random().toString(36).slice(2)}`;
  const session = sessions.ensure(callSid, '+19045551234', '+19046829345');
  const d = classifyHeuristic(said);
  if (d) session.route = d;
  sessions.addTurn(callSid, 'caller', said);
  return { sessions, session, callSid };
}

const ADVISOR_ARGS = {
  firstName: 'Mike', lastName: 'Chanata', email: 'mike@example.com',
  projectDescription: 'respray the whole car in the original colour',
  projectType: 'custom_work',
};

/** A caller who has given everything the handover needs. */
function readySession(said = 'Do you guys do custom work?') {
  const { sessions, session, callSid } = shopCall(said);
  // Contact routing lives on session.contact, not qualification — a
  // confirmed number is what lets an advisor actually ring back.
  sessions.mergeContact(callSid, {
    firstName: 'Mike', lastName: 'Chanata', email: 'mike@example.com',
    phone: '+19045551234', phoneConfirmed: true,
  });
  Object.assign(session.qualification, {
    vehicleYear: '1955', vehicleMake: 'Ford', vehicleModel: 'Mustang',
  });
  return { sessions, session, callSid };
}

describe('the advisor handover exists at all', () => {
  test('a custom-work call can actually reach an advisor', () => {
    // Before this, the guidance told the agent to "set a repair advisor
    // callback" and there was no tool and no state to do it with — so
    // the agent said it and nothing was recorded.
    const { session } = shopCall('Do you guys do custom work?');
    const names = toolsFor('collision_repair', undefined, session).map((t) => t.name);
    assert.ok(names.includes('request_advisor_callback'));
  });

  test('a crash call does not carry it', () => {
    const { session } = shopCall('I just got into a car accident on the Buckman Bridge');
    const names = toolsFor('collision_repair', undefined, session).map((t) => t.name);
    assert.ok(!names.includes('request_advisor_callback'), 'a crash ends in a tow, not a project quote');
  });

  test('a crash call DOES carry the tow from the first turn', () => {
    // Gating the truck behind the word "tow" meant an emergency on a
    // bridge could not dispatch one until somebody said it out loud,
    // while a routine "I wrecked my BMW" could. Exactly backwards.
    for (const said of ['I just got into a car accident on the Buckman Bridge', 'I need a tow', 'My car is totaled']) {
      const { session } = shopCall(said);
      if (session.route.industry !== 'collision_repair') continue;
      const names = toolsFor('collision_repair', undefined, session).map((t) => t.name);
      assert.ok(names.includes('dispatch_tow'), `no truck available for: ${said}`);
    }
  });

  test('a project photo purpose exists that is not damage photos', () => {
    // A man in his garage with a project car is not at a roadside
    // scene, and the damage-photo purpose carries a traffic-safety
    // precondition that would be nonsense to ask him.
    const allowed = policiesFor('collision_repair').upload!.allowedPurposes;
    assert.ok(allowed.includes('collision_project_photos'));
  });
});

describe('the handover will not complete without the lead', () => {
  const cases: [string, Partial<typeof ADVISOR_ARGS>, string][] = [
    ['no first name', { firstName: undefined }, 'caller_first_name'],
    ['no last name', { lastName: undefined }, 'caller_last_name'],
    ['no email', { email: undefined }, 'caller_email'],
    ['no description', { projectDescription: undefined }, 'project_description'],
  ];

  for (const [label, override, expected] of cases) {
    test(`${label} — refused, and the gap is named`, () => {
      const { session } = readySession();
      // Wipe the corresponding stored value too.
      if (override.firstName === undefined && 'firstName' in override) session.contact.firstName = undefined;
      if (override.lastName === undefined && 'lastName' in override) session.contact.lastName = undefined;
      if (override.email === undefined && 'email' in override) session.contact.email = undefined;

      const res = validateToolRequest(
        { id: 't', name: 'request_advisor_callback', input: { ...ADVISOR_ARGS, ...override } },
        session, new Date(),
      );
      assert.equal(res.ok, false, label);
      assert.ok(res.missing?.includes(expected), `expected ${expected}, got ${res.missing?.join(', ')}`);
    });
  }

  test('an unconfirmed number blocks it — an advisor cannot ring a number nobody agreed to', () => {
    const { session } = readySession();
    session.contact.phoneConfirmed = false;
    const res = validateToolRequest(
      { id: 't', name: 'request_advisor_callback', input: ADVISOR_ARGS }, session, new Date(),
    );
    assert.equal(res.ok, false);
    assert.ok(res.missing?.includes('callback_phone_confirmed'));
  });

  test('the vehicle is asked for as one question, not three', () => {
    const { session } = readySession();
    delete (session.qualification as Record<string, unknown>).vehicleMake;
    delete (session.qualification as Record<string, unknown>).vehicleModel;
    const res = validateToolRequest(
      { id: 't', name: 'request_advisor_callback', input: ADVISOR_ARGS }, session, new Date(),
    );
    assert.ok(res.missing?.includes('vehicle_year_make_model'));
    session.toolBlocks = [{ tool: 'request_advisor_callback', missing: res.missing!, attempts: 1 }];
    assert.match(renderToolBlocks(session)!, /as one question, not three/);
  });

  test('with everything present it goes through', () => {
    const { session } = readySession();
    const res = validateToolRequest(
      { id: 't', name: 'request_advisor_callback', input: ADVISOR_ARGS }, session, new Date(),
    );
    assert.equal(res.ok, true, res.reason ?? "rejected");
  });
});

describe('gathering information is not looping', () => {
  test('a multi-field handover is not closed for making progress', () => {
    // The retry cap exists to stop the tow flow asking four times for
    // the same thing. A six-field handover is legitimately refused
    // several times on the way to being complete, and closing it for
    // that would strand the caller one field short.
    const { session } = shopCall('Do you guys do custom work?');
    const attempt = (input: Record<string, unknown>) => executeToolRequest(
      { id: 't', name: 'request_advisor_callback', input },
      { tools: createMockToolbox(), log, session },
    );
    return (async () => {
      await attempt({ projectType: 'custom_work' });
      await attempt({ projectType: 'custom_work', firstName: 'Mike' });
      await attempt({ projectType: 'custom_work', firstName: 'Mike', lastName: 'Chanata' });
      const block = session.toolBlocks!.find((b) => b.tool === 'request_advisor_callback')!;
      assert.equal(block.attempts, 1, 'progress must not burn the retry budget');
    })();
  });

  test('asking for the identical thing twice does count', async () => {
    const { session } = shopCall('Do you guys do custom work?');
    const same = { projectType: 'custom_work' };
    for (let i = 0; i < 3; i += 1) {
      await executeToolRequest({ id: 't', name: 'request_advisor_callback', input: same },
        { tools: createMockToolbox(), log, session });
    }
    const block = session.toolBlocks!.find((b) => b.tool === 'request_advisor_callback')!;
    assert.equal(block.attempts, 3);
    assert.ok(block.attempts >= MAX_TOOL_RETRIES);
    assert.match(renderToolBlocks(session)!, /Do NOT call it again/);
  });
});

describe('once booked, it is not offered again', () => {
  test('the callback becomes standing state', async () => {
    const { session } = readySession();
    const out = await executeToolRequest(
      { id: 't', name: 'request_advisor_callback', input: ADVISOR_ARGS },
      { tools: createMockToolbox(), log, session },
    );
    assert.equal(out.ok, true, out.content);
    assert.equal((session.qualification as Record<string, unknown>).advisorCallbackStatus, 'requested');

    const memory = renderOfferMemory(session)!;
    assert.match(memory, /advisor callback is already booked/i);
    assert.match(memory, /do not offer it again/i);
  });

  test('the project details are recorded, not just spoken', async () => {
    const { session } = readySession();
    await executeToolRequest(
      { id: 't', name: 'request_advisor_callback', input: ADVISOR_ARGS },
      { tools: createMockToolbox(), log, session },
    );
    const q = session.qualification as Record<string, unknown>;
    assert.equal(q.projectType, 'custom_work');
    assert.match(String(q.projectDescription), /respray/);
    assert.equal(session.contact.email, 'mike@example.com');
  });

  test('the agent is told not to promise a call before it is booked', () => {
    const { session } = shopCall('Do you guys do custom work?');
    const goal = renderGoal(session, 'collision_repair')!;
    assert.match(goal, /request_advisor_callback/);
    assert.match(goal, /before request_advisor_callback has come back successful/i);
  });

  test('a successful call clears the block rather than leaving it standing', async () => {
    const { session } = readySession();
    await executeToolRequest({ id: 't', name: 'request_advisor_callback', input: { projectType: 'custom_work' } },
      { tools: createMockToolbox(), log, session });
    assert.ok(session.toolBlocks!.some((b) => b.tool === 'request_advisor_callback'));
    await executeToolRequest({ id: 't', name: 'request_advisor_callback', input: ADVISOR_ARGS },
      { tools: createMockToolbox(), log, session });
    assert.ok(!session.toolBlocks!.some((b) => b.tool === 'request_advisor_callback'));
  });
});

describe('each intent converts the way it should', () => {
  test('a labor-rate call does not force a project on them', () => {
    // They asked a question. If that is all they wanted, the call ends
    // there — the goal must not demand a handover.
    // They asked a question. If that is all they wanted, the call ends
    // there — the goal must not demand a handover.
    const { session } = shopCall('What are your labor rates?');
    const goal = renderGoal(session, 'collision_repair')!;
    assert.match(goal, /answer what they actually asked, first/i);
    assert.match(goal, /nobody crashed/i);
  });

  test('an insurance question that turns into a real accident stays with the shop', () => {
    // "Do you work with insurance?" is a yes. If they then describe an
    // actual crash, they are still ringing the body shop about their
    // car — the caller has not changed their mind about who they
    // called. Read on its own, "I got rear-ended" scores as a personal
    // injury call, and only the mid-call switch threshold stops that
    // yanking a body-shop caller into a law firm.
    const { session } = shopCall('Do you work with insurance?');
    assert.equal(session.route.intent, 'insurance_repair');

    const said = 'I just got rear-ended this morning and I have a claim open';
    const change = detectScenarioChange(said, 'collision_repair');
    assert.equal(change.changed, false,
      'a body-shop caller describing their crash must not be re-routed to attorneys');
    // And the accident detail is still capturable — the schema behind
    // the shop-business ordering is the full one.
    const goals = session.route.industry === 'collision_repair'
      ? selectSpecialist(session)!.qualificationGoalsFor!(session)
      : [];
    assert.ok(goals.some((g) => /insurance company/i.test(g)), 'claim fields remain reachable');
  });

  test('a PROJECT ends with an advisor ringing back', () => {
    for (const said of ['Do you guys do custom work?', 'Do you guys do full restorations?', 'How much would it cost to fix a dent?']) {
      const goal = renderGoal(shopCall(said).session, 'collision_repair')!;
      assert.match(goal, /photos, if it cannot be judged without seeing it/i, said);
      assert.match(goal, /their name and a good number/i, said);
      assert.match(goal, /request_advisor_callback/, said);
      assert.match(goal, /quoting a price/i, said);
    }
  });

  test('a QUESTION ends when it is answered', () => {
    // The defect this pins: told a handover "is what finishes this
    // call", the agent goes looking for a project that does not exist.
    // Someone who asked a rate and said "okay, thanks" is a call that
    // went well, not a lead that got away.
    for (const said of ['What are your labor rates?', 'Can you match my paint?', 'Do you work with insurance?']) {
      const goal = renderGoal(shopCall(said).session, 'collision_repair')!;
      assert.match(goal, /let them go warmly/i, said);
      assert.match(goal, /collecting their details when they only asked a question/i, said);
      assert.match(goal, /pushing a photo link or an advisor callback at someone who has not asked/i, said);
      assert.doesNotMatch(goal, /that is what finishes this call/i, said);
    }
  });

  test('a question that turns into a job gets the project goal', () => {
    const { session } = shopCall('Can you match my paint?');
    assert.match(renderGoal(session, 'collision_repair')!, /let them go warmly/i);
    // They describe work they want doing. Now the handover applies.
    (session.qualification as Record<string, unknown>).projectDescription = 'respray the bonnet and blend the wings';
    assert.match(renderGoal(session, 'collision_repair')!, /request_advisor_callback/);
  });
});

describe('REGRESSION — the accident path is untouched', () => {
  test('a tow still needs its own prerequisites', () => {
    const { session } = shopCall('I just got into a car accident on the Buckman Bridge');
    const res = validateToolRequest({ id: 't', name: 'dispatch_tow', input: {} }, session, new Date());
    assert.equal(res.ok, false);
    assert.ok(res.missing?.includes('caller_name'));
  });

  test('damage photos keep their roadside safety precondition', () => {
    const { sessions, session, callSid } = shopCall('I just got into a car accident on the Buckman Bridge');
    sessions.mergeContact(callSid, { phone: '+19045551234', phoneConfirmed: true });
    const res = validateToolRequest(
      { id: 't', name: 'create_upload_link', input: { purposeId: 'collision_damage_photos' } },
      session, new Date(),
    );
    assert.equal(res.ok, false);
    assert.match(res.reason!, /out of traffic|somewhere safe/i);
  });

  test('project photos do not, because nobody is in traffic', () => {
    const { session } = readySession();
    const res = validateToolRequest(
      { id: 't', name: 'create_upload_link', input: { purposeId: 'collision_project_photos' } },
      session, new Date(),
    );
    assert.equal(res.ok, true, res.reason ?? "rejected");
  });
});

describe('FINAL QA — tow path and dead air', () => {
  test('an explicit tow request is not answered with "is it drivable?"', () => {
    // They already said they need a truck. Asking costs a turn and the
    // answer changes nothing.
    const { session } = shopCall('I got into an accident and need a tow.');
    assert.equal(session.route.intent, 'towing_needed');
    const opening = selectSpecialist(session)!.openingLine(session);
    assert.doesNotMatch(opening, /still drivable|need a tow/i);
    assert.match(opening, /where/i, 'the useful next question is where the vehicle is');
  });

  test('the agent is told to speak before a slow action', () => {
    // Measured: with an acknowledgement first the caller hears audio at
    // ~440ms; without it, a 4-second tow dispatch is 4.7 seconds of
    // silence. Nothing used to say to speak first.
    assert.match(CORE_AGENT_RULES, /SAY SOMETHING BEFORE YOU DO SOMETHING/);
    assert.match(CORE_AGENT_RULES, /Speak FIRST, then act/);
    assert.match(CORE_AGENT_RULES, /Never announce a result before the tool has come back/i);
  });

  test('the repair process is available once the vehicle is on a truck', () => {
    // A caller whose car has just been collected is about to ask what
    // happens next; waiting for the words means it is missing exactly
    // when it is certain to be needed.
    const { session } = shopCall('I just got into an accident.');
    const before = renderActionPolicies('collision_repair', MODES, { repairTimeline: wantsTimeline(session) })!;
    assert.doesNotMatch(before, /teardown/i);

    (session.qualification as Record<string, unknown>).towStatus = 'mocked';
    const after = renderActionPolicies('collision_repair', MODES, { repairTimeline: wantsTimeline(session) })!;
    assert.match(after, /teardown/i);
    assert.match(after, /insurer review/i);
  });

  test('a crash still carries the tow tool from the first turn', () => {
    for (const said of ['I just got into an accident.', 'I got into an accident and need a tow.']) {
      const { session } = shopCall(said);
      assert.ok(toolsFor('collision_repair', undefined, session).map((t) => t.name).includes('dispatch_tow'), said);
    }
  });
});

describe('FINAL QA — a body shop call is not a lawsuit', () => {
  const cases: [string, string][] = [
    ['I got rear-ended yesterday and need the car fixed', 'collision_repair'],
    ['someone rear-ended me, can you fix my bumper', 'collision_repair'],
    ['I was rear-ended this morning and my neck hurts', 'attorneys'],
    ['I was rear-ended and I am injured but I also need my car fixed', 'attorneys'],
    ['I was T-boned and my back is killing me', 'attorneys'],
    ['I got rear-ended and I want to speak to a lawyer', 'attorneys'],
  ];

  for (const [said, expected] of cases) {
    test(`${JSON.stringify(said)} -> ${expected}`, () => {
      // The crash vocabulary is identical on both sides; only the
      // stated intent separates them. An injury mentioned anywhere
      // outranks a repair request and keeps the call with the firm.
      assert.equal(classifyHeuristic(said)?.industry, expected);
    });
  }
});
