import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateToolRequest, TOOL_SCHEMAS } from '../src/core/tool-protocol.ts';
import { classifyHeuristic } from '../src/core/router.ts';
import { selectSpecialist } from '../src/industries/index.ts';
import { SessionStore } from '../src/core/session.ts';
import { renderGoal } from '../src/core/goals.ts';
import { COLLISION_KNOWLEDGE } from '../src/knowledge/trades.ts';
import { matchKnowledge } from '../src/knowledge/types.ts';
import { knowledgeFor } from '../src/knowledge/index.ts';
import { demoProfile } from '../src/business/profile.ts';
import { collisionRepair } from '../src/industries/automotive/collision-repair.ts';

function towCall(said = 'I got into an accident and need a tow.') {
  const sessions = new SessionStore();
  const callSid = `CApay${Math.random().toString(36).slice(2)}`;
  const session = sessions.ensure(callSid, '+19045551234', '+19046829345');
  const d = classifyHeuristic(said);
  if (d) sessions.setRoute(callSid, d);
  sessions.addTurn(callSid, 'caller', said);
  sessions.mergeContact(callSid, { firstName: 'Mike', phone: '+19045551234', phoneConfirmed: true });
  Object.assign(session.qualification, { vehicleDrivable: false, towNeeded: true });
  return { sessions, session, callSid, opening: selectSpecialist(session)?.openingLine(session) ?? '' };
}

const BASE = {
  callerName: 'Mike', callbackPhone: '+19045551234',
  pickupLocation: 'Buckman Bridge northbound near the south exit',
  directionOfTravel: 'northbound',
  vehicleYear: '2019', vehicleMake: 'BMW', vehicleModel: '330i',
};
const dispatch = (session: never, input: Record<string, unknown>) =>
  validateToolRequest({ id: 't', name: 'dispatch_tow', input }, session, new Date());

const matched = (said: string) => matchKnowledge(
  said, knowledgeFor('collision_repair.general', 'collision_repair'),
  demoProfile('collision_repair', { mode: 'demo' }), 10,
).map((m) => m.entry.id);

describe('16. THE LIVE FAILURE — "no insurance? no claim number? no forms?"', () => {
  test('the question reaches knowledge that answers it straight', () => {
    const ids = matched("You don't need insurance? You don't need a claim number? No forms, no nothing?");
    assert.ok(ids.includes('collision.tow_payment_path'), ids.join(', '));
    assert.ok(ids.includes('collision.repair_authorization'), ids.join(', '));
  });

  test('the answer is the payment path, not a speech about safety', () => {
    const pay = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.tow_payment_path')!;
    assert.match(pay.guidance, /payment path is needed before a truck is sent/i);
    assert.match(pay.guidance, /either the claim number or the policy number/i);
    assert.match(pay.guidance, /self-pay/i);
    // The exact words the live call got wrong.
    assert.match(pay.guidance, /NEVER say the insurance, the claim number or the paperwork can be sorted out later/);
    assert.match(pay.guidance, /never waive any of it because they are stranded/i);
  });

  test('the paperwork question has a real answer', () => {
    const forms = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.repair_authorization')!;
    assert.match(forms.guidance, /DocuSign/);
    assert.match(forms.guidance, /tear the vehicle down|inspect/i);
    assert.match(forms.guidance, /email/i);
  });
});

describe('6–8, 15. the payment gate is deterministic', () => {
  test('no payment path, no truck', () => {
    const { session } = towCall();
    const v = dispatch(session as never, { ...BASE, towCostDisclosed: true });
    assert.equal(v.ok, false);
    assert.ok(v.missing?.includes('payment_path'));
  });

  test('insurance needs a carrier AND one identifier', () => {
    const { session } = towCall();
    const noCarrier = dispatch(session as never, { ...BASE, paymentPath: 'insurance', claimNumber: 'C1', towCostDisclosed: true });
    assert.equal(noCarrier.ok, false);
    assert.ok(noCarrier.missing?.includes('insurance_carrier'));

    const noNumber = dispatch(session as never, { ...BASE, paymentPath: 'insurance', insuranceCarrier: 'GEICO', towCostDisclosed: true });
    assert.equal(noNumber.ok, false);
    assert.ok(noNumber.missing?.includes('claim_or_policy_number'));
  });

  test('a claim number OR a policy number — either is enough', () => {
    const { session } = towCall();
    for (const id of [{ claimNumber: 'CLM-1' }, { policyNumber: 'POL-1' }]) {
      const v = dispatch(session as never, { ...BASE, paymentPath: 'insurance', insuranceCarrier: 'GEICO', ...id, towCostDisclosed: true });
      assert.equal(v.ok, true, `${JSON.stringify(id)}: ${v.reason}`);
    }
  });

  test('self-pay needs them to have agreed they are paying', () => {
    const { session } = towCall();
    const noAck = dispatch(session as never, { ...BASE, paymentPath: 'self_pay', towCostDisclosed: true });
    assert.equal(noAck.ok, false);
    assert.ok(noAck.missing?.includes('payment_responsibility_acknowledged'));
    assert.match(noAck.reason!, /responsible for the towing charge/i);

    const ok = dispatch(session as never, { ...BASE, paymentPath: 'self_pay', paymentResponsibilityAcknowledged: true, towCostDisclosed: true });
    assert.equal(ok.ok, true, ok.reason ?? "refused");
  });

  test('the cost is disclosed before the truck, not after', () => {
    const { session } = towCall();
    const v = dispatch(session as never, { ...BASE, paymentPath: 'insurance', insuranceCarrier: 'GEICO', claimNumber: 'C1' });
    assert.equal(v.ok, false);
    assert.ok(v.missing?.includes('tow_cost_disclosed'));
    assert.match(v.reason!, /Never promise the carrier will pay/i);
  });

  test('paymentPath is a required argument of the tool itself', () => {
    const schema = TOOL_SCHEMAS.find((t) => t.name === 'dispatch_tow')!;
    assert.ok((schema.input_schema as { required: string[] }).required.includes('paymentPath'));
  });
});

describe('14. urgency prioritises; it never waives', () => {
  test('an emergency still cannot dispatch without a payment path', () => {
    const { session } = towCall('I just got into an accident');
    session.route = { ...session.route, urgency: 'emergency' };
    const v = dispatch(session as never, { ...BASE, towCostDisclosed: true });
    assert.equal(v.ok, false, 'urgency must not open a hole in the payment gate');
    assert.ok(v.missing?.includes('payment_path'));
  });

  test('no urgency rule tells the agent that paperwork waits', () => {
    for (const rule of collisionRepair.urgencyRules) {
      assert.doesNotMatch(rule.action, /paperwork waits|the car does not matter|call them back/i, rule.when);
    }
    for (const rule of collisionRepair.escalationRules) {
      assert.doesNotMatch(rule.action, /call them back once they are safe/i, rule.when);
    }
  });
});

describe('17–19. no proactive safety triage', () => {
  test('17. a wrecked BMW gets tow intake, not a safety questionnaire', () => {
    const { opening } = towCall('I wrecked my BMW and need a tow.');
    assert.doesNotMatch(opening, /somewhere safe|everyone okay|anyone hurt|medical attention|out of traffic/i);
  });

  test('18. "I am stranded" is a tow signal, not a distress signal', () => {
    const goal = renderGoal(towCall('I am stranded, I need a tow').session, 'collision_repair')!;
    assert.match(goal, /treating "I am stranded" as a distress signal/i);
    assert.match(goal, /a truck does not go out without a way of paying for it/i);
    assert.doesNotMatch(goal, /is everyone okay/i);
  });

  test('19. explicit danger gets ONE line, then the intake continues', () => {
    const emergency = collisionRepair.urgencyRules.find((r) => /on fire|live lane|unconscious/i.test(r.when))!;
    assert.match(emergency.action, /one short line/i);
    assert.match(emergency.action, /call 911/i);
    assert.match(emergency.action, /then carry on with the tow/i);
    assert.match(emergency.action, /do not skip the payment path/i);
  });

  test('the specialist is told plainly not to triage', () => {
    assert.match(collisionRepair.systemPrompt, /DO NOT RUN SAFETY TRIAGE/);
    assert.match(collisionRepair.systemPrompt, /are you somewhere safe/i);
    assert.match(collisionRepair.systemPrompt, /business signals, not distress signals/i);
    // And the old order-of-play is gone.
    assert.doesNotMatch(collisionRepair.systemPrompt, /People\. Is everyone okay\?/);
    assert.doesNotMatch(collisionRepair.systemPrompt, /Do not run intake on someone in danger/);
  });

  test('injury is noted if raised and never chased', () => {
    assert.match(collisionRepair.systemPrompt, /INJURY — ONLY IF THEY RAISE IT/);
    assert.match(collisionRepair.systemPrompt, /Never ask/);
    assert.doesNotMatch(collisionRepair.systemPrompt, /deal with the medical side first/i);
  });
});

describe('the caller who most needs a truck now gets one', () => {
  const route = (s: string) => classifyHeuristic(s);

  test('"I am stranded" routes to towing rather than nowhere at all', () => {
    // It used to match no rule, so the call that most wants a truck
    // got no specialist and no tow tool.
    for (const said of ['I am stranded', 'I am stranded on the side of the road', "I'm stranded on I-95"]) {
      const r = route(said);
      assert.equal(r?.industry, 'collision_repair', said);
      assert.equal(r?.intent, 'towing_needed', said);
    }
  });

  test('an explicit tow request outranks a generic repair request', () => {
    assert.equal(route('I wrecked my BMW and need a tow.')?.intent, 'towing_needed');
    // And the plain repair call is unchanged.
    assert.equal(route('I wrecked my BMW and I need to get it fixed')?.intent, 'estimate_request');
  });

  test('none of these open with a safety question', () => {
    for (const said of ['I am stranded', 'I wrecked my BMW and need a tow.', 'I just got into an accident.']) {
      const { opening } = towCall(said);
      assert.doesNotMatch(opening, /somewhere safe|everyone okay|anyone hurt|out of traffic|medical/i, said);
    }
  });
});
