import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic, detectScenarioChange } from '../src/core/router.ts';
import {
  decisiveServiceIntent, detectServiceIntents, isMixedServiceIntent,
  isBareAccidentMention, SERVICE_CLARIFIER, BARE_ACCIDENT_CLARIFIER,
} from '../src/core/service-intent.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { createMockToolbox } from '../src/tools/index.ts';
import { createLogger } from '../src/logger.ts';
import { demoProfile } from '../src/business/profile.ts';
import { renderDemoHost } from '../src/core/demo-host.ts';
import { UNIVERSAL_KNOWLEDGE } from '../src/knowledge/universal.ts';

const silent = createLogger({}, () => {});

function demoLine() {
  const sessions = new SessionStore();
  const orch = new Orchestrator({
    sessions, claude: null, log: silent, tools: createMockToolbox(),
    resolveProfile: (i) => demoProfile((i ?? 'professional_services') as never, { mode: 'demo' }),
  });
  return { sessions, orch };
}

describe('A–D. the service asked for decides the industry', () => {
  const cases: [string, string][] = [
    ['I got in an accident and need a tow.', 'collision_repair'],
    ['I was rear-ended and need my car fixed.', 'collision_repair'],
    ['I wrecked my BMW and need a body shop.', 'collision_repair'],
    ['I was in an accident, can you tow my car', 'collision_repair'],
    ['I was hit and need help with my insurance claim for the repair', 'collision_repair'],
    ['I was rear-ended and my neck hurts.', 'attorneys'],
    ['I need a lawyer after my accident.', 'attorneys'],
    ['I was in a crash and I went to the hospital', 'attorneys'],
  ];

  for (const [said, expected] of cases) {
    test(`${JSON.stringify(said)} -> ${expected}`, () => {
      // Accident vocabulary is shared. "Rear-ended" belongs to a body
      // shop and a law firm equally; the service request separates them.
      assert.equal(decisiveServiceIntent(said)?.industry, expected, 'service intent');
      // And the route the caller actually gets, which is what matters:
      // the service they named overrides the classifier when the two
      // disagree.
      const { sessions, orch } = demoLine();
      const sid = `CA${Math.random().toString(36).slice(2)}`;
      return orch.handleCallerUtterance(sid, said).then(() => {
        assert.equal(sessions.get(sid)!.route.industry, expected, 'routed industry');
      });
    });
  }

  test('accident words alone name no industry at all', () => {
    for (const said of ['I was rear-ended', 'I was in an accident', 'I got T-boned yesterday']) {
      assert.equal(decisiveServiceIntent(said), null, said);
      assert.ok(isBareAccidentMention(said), said);
    }
  });
});

describe('E. ROUTE CORRECTION — a bad route is not defended', () => {
  test('a stated service switches immediately, whatever it scores', () => {
    // The live failure: routed to a law firm, the caller said they
    // needed a tow, that scored 0.78 against a switch threshold of
    // 0.85, nothing moved, and the persona told them they had rung the
    // wrong number.
    for (const said of ['No, I need a tow for my car', 'I need a tow', 'I need my car fixed', 'I need a body shop', 'can you tow my car']) {
      const change = detectScenarioChange(said, 'attorneys');
      assert.equal(change.changed, true, said);
      assert.equal(change.reason, 'service-request', said);
      assert.equal(change.decision?.industry, 'collision_repair', said);
    }
  });

  test('and the other way round', () => {
    const change = detectScenarioChange('actually I need to speak to a lawyer about it', 'collision_repair');
    assert.equal(change.changed, true);
    assert.equal(change.decision?.industry, 'attorneys');
  });

  test('an unrelated sentence does not move the route', () => {
    for (const said of ['tell me about your fees', 'it is a black BMW', 'yes that is right']) {
      assert.equal(detectScenarioChange(said, 'attorneys').changed, false, said);
    }
  });

  test('the correction reaches the caller as the new business, mid-call', async () => {
    const { sessions, orch } = demoLine();
    await orch.handleCallerUtterance('CA_fix', 'I was rear-ended and my neck hurts');
    assert.equal(sessions.get('CA_fix')!.route.industry, 'attorneys');

    const reply = await orch.handleCallerUtterance('CA_fix', 'No, I need a tow for my car');
    assert.equal(sessions.get('CA_fix')!.route.industry, 'collision_repair', 'must follow the caller');
    // No arguing, no wrong number, no law firm.
    assert.doesNotMatch(reply, /wrong number|law firm|we do ?n.t (tow|repair|offer)/i, reply);
    assert.match(reply, /car|vehicle|tow|where/i, reply);
  });
});

describe('F. mixed intent is asked about, never guessed', () => {
  test('both services named is genuinely ambiguous', () => {
    const said = 'I was rear-ended, I am hurt, and I need my car fixed';
    assert.ok(isMixedServiceIntent(said));
    assert.equal(decisiveServiceIntent(said), null);
    assert.equal(detectServiceIntents(said).length, 2);
  });

  test('the caller is asked which comes first', async () => {
    const { orch } = demoLine();
    const reply = await orch.handleCallerUtterance('CA_mix', 'I was rear-ended, my neck hurts, and I also need my car fixed');
    assert.equal(reply, SERVICE_CLARIFIER);
    assert.match(reply, /vehicle first, or the injury side first/i);
  });

  test('and the answer locks it in', async () => {
    const { sessions, orch } = demoLine();
    await orch.handleCallerUtterance('CA_mix2', 'I was rear-ended, my neck hurts, and I need my car fixed');
    await orch.handleCallerUtterance('CA_mix2', 'the car first please, I need a tow');
    assert.equal(sessions.get('CA_mix2')!.route.industry, 'collision_repair');
  });

  test('the order they said it in is preserved', () => {
    const vehicleFirst = detectServiceIntents('I need my car fixed and my neck hurts');
    assert.equal(vehicleFirst[0].industry, 'collision_repair');
    const injuryFirst = detectServiceIntents('my neck hurts and I need my car fixed');
    assert.equal(injuryFirst[0].industry, 'attorneys');
  });
});

describe('bare accident vocabulary asks rather than assumes', () => {
  test('a vague mention with no confident route gets one short question', async () => {
    const { orch } = demoLine();
    const reply = await orch.handleCallerUtterance('CA_bare', 'I was rear-ended');
    assert.equal(reply, BARE_ACCIDENT_CLARIFIER);
    assert.match(reply, /vehicle taken care of, or is this about an injury/i);
  });

  test('a confident route is left alone — no menu for someone on a bridge', async () => {
    const { sessions, orch } = demoLine();
    const reply = await orch.handleCallerUtterance('CA_scene', 'I just got into a car accident on the Buckman Bridge in Jacksonville.');
    assert.equal(sessions.get('CA_scene')!.route.industry, 'collision_repair');
    assert.notEqual(reply, BARE_ACCIDENT_CLARIFIER);
  });
});

describe('10. the demo line never sends anyone away', () => {
  test('the agent is told this number is not one business', () => {
    const block = renderDemoHost('role_play', {
      hasRolePlayed: false, scenarioTested: 'attorneys',
      ctaOffered: false, ctaDeclined: false, calendarMode: 'mock',
    });
    assert.match(block, /THIS NUMBER IS NOT ONE BUSINESS/);
    assert.match(block, /wrong number/i);
    assert.match(block, /you become that business and help them/i);
    assert.match(block, /Do not defend the scenario you happen to be in/i);
  });

  test('the out-of-scope entry no longer licenses a wrong-number answer here', () => {
    const entry = UNIVERSAL_KNOWLEDGE.find((e) => e.id === 'universal.wrong_business')!;
    assert.match(entry.guidance, /NEVER tell anyone they have called the wrong number/);
    assert.match(entry.guidance, /never on the demo line at all/i);
  });
});

describe('12. the tow and payment work is untouched', () => {
  test('explicit collision phrases still route to collision', () => {
    for (const said of ['I am stranded', 'I got into an accident and need a tow.', 'What are your labor rates?']) {
      assert.equal(classifyHeuristic(said)?.industry, 'collision_repair', said);
    }
  });

  test('other industries are unaffected by the vehicle-service list', () => {
    assert.equal(classifyHeuristic('my kitchen sink is leaking everywhere')?.industry, 'plumbing');
    assert.equal(classifyHeuristic('I want to see one of your listings')?.industry, 'real_estate');
    assert.equal(classifyHeuristic('Do you do anodising in house?')?.industry, 'manufacturing');
  });
});

describe('a corrected route carries its own intent', () => {
  test('the switch does not leave the old industry’s intent behind', async () => {
    // A collision route wearing an attorneys intent is how "I need a
    // tow" got answered with "is the car still drivable?".
    const { sessions, orch } = demoLine();
    await orch.handleCallerUtterance('CA_int', 'I was rear-ended, my neck hurts, and I also need my car fixed');
    const reply = await orch.handleCallerUtterance('CA_int', 'the car first, I need a tow');

    const route = sessions.get('CA_int')!.route;
    assert.equal(route.industry, 'collision_repair');
    assert.equal(route.intent, 'towing_needed', `intent came out as ${route.intent}`);
    assert.doesNotMatch(reply, /still drivable/i, 'they just said they need a tow');
    assert.match(reply, /truck|where/i);
  });

  test('the same after a mid-call correction', async () => {
    const { sessions, orch } = demoLine();
    await orch.handleCallerUtterance('CA_int2', 'I was rear-ended and my neck hurts');
    const reply = await orch.handleCallerUtterance('CA_int2', 'No, I need a tow for my car');
    assert.equal(sessions.get('CA_int2')!.route.intent, 'towing_needed');
    assert.doesNotMatch(reply, /still drivable|wrong number|law firm/i);
  });
});
