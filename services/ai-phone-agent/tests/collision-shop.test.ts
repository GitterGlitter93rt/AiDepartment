import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic } from '../src/core/router.ts';
import { selectSpecialist } from '../src/industries/index.ts';
import { SessionStore } from '../src/core/session.ts';
import { COLLISION_DEMO_SHOP, speakDollars, speakLaborRates } from '../src/business/collision-shop.ts';
import { COLLISION_KNOWLEDGE } from '../src/knowledge/trades.ts';
import { matchKnowledge } from '../src/knowledge/types.ts';
import { knowledgeFor } from '../src/knowledge/index.ts';
import { demoProfile } from '../src/business/profile.ts';
import { renderGoal } from '../src/core/goals.ts';

/** Route an utterance and get the shop's actual first words. */
function callShop(said: string) {
  const sessions = new SessionStore();
  const callSid = `CA${Math.random().toString(36).slice(2)}`;
  const session = sessions.ensure(callSid, '+19045551234', '+19046829345');
  const decision = classifyHeuristic(said);
  if (decision) session.route = decision;
  sessions.addTurn(callSid, 'caller', said);
  const spec = selectSpecialist(session);
  return { session, decision, opening: spec ? spec.openingLine(session) : null, spec };
}

/** The knowledge the agent is actually given for this utterance —
 * through the same lookup production uses, not a hand-built list. */
function matchedFor(said: string) {
  return matchKnowledge(
    said,
    knowledgeFor('collision_repair.general', 'collision_repair'),
    demoProfile('collision_repair', { mode: 'demo' }),
    10,
  ).map((m) => m.entry.id);
}

describe('TEST A — labor rates are answered, not deflected', () => {
  for (const said of ['What are your labor rates?', 'What do you charge per hour?', "What's your hourly rate for body work?"]) {
    test(JSON.stringify(said), () => {
      const { decision, opening } = callShop(said);
      assert.equal(decision?.industry, 'collision_repair');
      assert.equal(decision?.intent, 'labor_rate_question');
      // The three published numbers, spoken as words.
      assert.match(opening!, /one hundred twenty-five dollars an hour/);
      assert.match(opening!, /one hundred sixty-five dollars an hour/);
      // And none of the accident intake.
      assert.doesNotMatch(opening!, /is everyone okay|anyone hurt|still drivable|accident/i);
      // No digits: a TTS engine regroups those however it likes.
      assert.doesNotMatch(opening!, /\d/);
    });
  }

  test('the rates come from config, not from prose', () => {
    assert.deepEqual(COLLISION_DEMO_SHOP.laborRates, { body: 125, paint: 125, mechanical: 165 });
    assert.match(speakLaborRates({ body: 100, paint: 100, mechanical: 200 }), /one hundred dollars an hour.*two hundred dollars an hour/);
  });

  test('a rate is not a repair quote', () => {
    const entry = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.labor_rates')!;
    assert.match(entry.guidance, /not a repair quote/i);
  });

  test('the rate question reaches the rate knowledge', () => {
    assert.ok(matchedFor('what are your labor rates').includes('collision.labor_rates'));
  });
});

describe('TEST B — insurance, confidently', () => {
  test('yes, and no hedging about carriers', () => {
    const { decision, opening } = callShop('Do you work with insurance?');
    assert.equal(decision?.intent, 'insurance_repair');
    assert.match(opening!, /^Yes, we work with insurance companies/);
    assert.match(opening!, /directly with them on the estimate/i);
    assert.doesNotMatch(opening!, /depends on the carrier|preferred shop/i);
  });

  test('coverage promises stay off the table', () => {
    const entry = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.insurance_or_out_of_pocket')!;
    assert.match(entry.guidance, /YES/);
    assert.match(entry.guidance, /do not advise whether to file a claim/i);
    assert.match(entry.guidance, /do not predict what it does to their premium/i);
    // The phrase appears, as a prohibition. Checking for its absence
    // would flag the instruction that forbids it — the same trap the
    // towing-billing test documents.
    assert.match(entry.guidance, /Do NOT say "it depends on the carrier"/);
    assert.doesNotMatch(entry.guidance, /^[^"]*\bit depends on the carrier\b(?![^"]*")/im);
  });
});

describe('TEST C — colour match: confident, not absolute', () => {
  test('strong positioning without a guarantee', () => {
    const { decision, opening } = callShop('Can you match my paint?');
    assert.equal(decision?.intent, 'paint_color_match');
    assert.match(opening!, /strongest paint and color-matching shops/i);
    assert.match(opening!, /extremely closely/i);
    // The one thing that must never be said.
    assert.doesNotMatch(opening!, /guarantee|perfect match|100%|every time/i);
  });

  test('the guidance forbids promising perfection', () => {
    const entry = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.paint_match')!;
    assert.match(entry.guidance, /never promise perfection/i);
    assert.match(entry.guidance, /paint code/i);
    assert.match(entry.guidance, /blend/i);
    // Short answer by default — the whole process only if asked.
    assert.match(entry.guidance, /do not recite the whole process/i);
  });
});

describe('TEST D — custom work', () => {
  test('yes, then what do you want done', () => {
    const { decision, opening } = callShop('Do you guys do custom work?');
    assert.equal(decision?.intent, 'custom_work');
    assert.match(opening!, /^Yes, we do custom work/);
    assert.match(opening!, /what are you looking to have done/i);
    assert.doesNotMatch(opening!, /drivable|everyone okay|insurance/i);
  });

  test('no price is invented, and the route is photos then an advisor', () => {
    const entry = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.custom_work')!;
    assert.match(entry.guidance, /never quote a custom job/i);
    assert.match(entry.guidance, /photo-upload link/i);
    assert.match(entry.guidance, /repair advisor callback|advisor callback|call you back/i);
    assert.match(entry.guidance, /ONE photo-upload link/);
  });
});

describe('TEST E — restoration', () => {
  test('a 1955 Mustang gets a yes and a conversation about the car', () => {
    const { decision, opening } = callShop('I have got a 1955 Mustang. Do you guys do full restorations?');
    assert.equal(decision?.industry, 'collision_repair');
    assert.equal(decision?.intent, 'restoration');
    assert.match(opening!, /^Yes, we do full restoration work/);
    assert.doesNotMatch(opening!, /is everyone okay|drivable|accident|claim/i);
  });

  test('no restoration price is ever invented', () => {
    const entry = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.restoration')!;
    assert.match(entry.guidance, /priced individually/i);
    assert.match(entry.guidance, /do not estimate a range/i);
    // Plain language, not jargon at a caller who did not ask for it.
    assert.match(entry.guidance, /use plain words for those, not the labels/i);
  });

  test('the restoration question reaches the restoration knowledge', () => {
    assert.ok(matchedFor('do you do full restorations on classic cars').includes('collision.restoration'));
  });
});

describe('TEST F — a price question is never guessed at', () => {
  for (const said of ['How much to repaint my entire car?', 'How much would it cost to fix a dent?']) {
    test(JSON.stringify(said), () => {
      const { decision, opening } = callShop(said);
      assert.equal(decision?.industry, 'collision_repair');
      assert.equal(decision?.intent, 'general_estimate');
      assert.doesNotMatch(opening!, /\$|\d+ dollars/);
      assert.match(opening!, /depends on/i);
      assert.match(opening!, /what's the vehicle/i);
    });
  }

  test('the guidance sends them to photos or an inspection', () => {
    const entry = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.quote_on_the_phone')!;
    assert.match(entry.guidance, /do not invent a price/i);
    assert.match(entry.guidance, /photos|bringing it in/i);
    // But a labor rate IS answerable, and must not be swept up here.
    assert.match(entry.guidance, /that is a published number — answer it/i);
  });
});

describe('mechanical work is scoped honestly', () => {
  test('collision mechanical yes, general mechanical not promised', () => {
    assert.equal(COLLISION_DEMO_SHOP.capabilities.collisionMechanical, true);
    assert.equal(COLLISION_DEMO_SHOP.capabilities.generalMechanical, false);
    const entry = COLLISION_KNOWLEDGE.find((e) => e.id === 'collision.mechanical_work')!;
    assert.match(entry.guidance, /suspension, steering, alignment/i);
    assert.match(entry.guidance, /is NOT something to promise/);
  });
});

describe('shop-business calls do not run the accident intake', () => {
  const SHOP = ['Do you guys do custom work?', 'What are your labor rates?', 'Can you match my paint?'];

  test('the goal is answering them, not dispatching a truck', () => {
    for (const said of SHOP) {
      const { session } = callShop(said);
      const goal = renderGoal(session, 'collision_repair')!;
      assert.match(goal, /their question is answered/i, said);
      assert.match(goal, /nobody crashed/i, said);
    }
  });

  test('the outstanding fields are shop fields, not scene fields', () => {
    const { session, spec } = callShop('Do you guys do custom work?');
    const goals = spec!.qualificationGoalsFor!(session).slice(0, 6);
    assert.ok(!goals.some((g) => /hurt|scene|shoulder|blocking|mile marker/i.test(g)),
      `a custom-work caller must not be asked scene questions: ${goals.join(', ')}`);
    assert.ok(goals.some((g) => /make|model|year/i.test(g)));
  });
});

describe('REGRESSION — accident and tow work is untouched', () => {
  test('a fresh crash opens on the vehicle — no safety triage', () => {
    const { decision, opening } = callShop('I just got into a car accident on the Buckman Bridge');
    assert.equal(decision?.urgency, 'emergency');
    // Urgency changes the pace and the order. It does not turn an
    // intake line into a triage line.
    assert.doesNotMatch(opening!, /everyone okay|anyone hurt|somewhere safe|out of traffic|medical/i);
    assert.match(opening!, /where/i);
  });

  test('a repair call still opens on the car', () => {
    const { decision, opening } = callShop('I wrecked my BMW and I need to get it fixed');
    assert.equal(decision?.intent, 'estimate_request');
    assert.equal(decision?.urgency, 'normal');
    assert.match(opening!, /Is the car still drivable/i);
  });

  test('a tow request still routes to towing', () => {
    assert.equal(classifyHeuristic("my car wont drive I need a tow")?.intent, 'towing_needed');
  });

  test('an accident call is never shown a safety question as the next thing to ask', () => {
    // The scene fields sat at the top of the schema, so "whether
    // anyone is hurt" was presented as the first outstanding item on
    // every crash call — and the agent duly asked it. Still captured
    // if volunteered; never led on.
    const { session, spec } = callShop('I just got into a car accident on the Buckman Bridge');
    const goals = spec!.qualificationGoalsFor!(session);
    for (const g of goals) {
      assert.doesNotMatch(g, /hurt|safely off the travel lanes|blocking a lane|still at the scene/i,
        `safety goal still shown: ${g}`);
    }
    assert.match(goals[0], /where the vehicle is|year|make|model/i);
  });

  test('shop rules do not steal other industries', () => {
    assert.equal(classifyHeuristic('Do you do anodising in house?')?.industry, 'manufacturing');
    assert.equal(classifyHeuristic('my kitchen sink is leaking everywhere')?.industry, 'plumbing');
  });
});

describe('common shop questions stay on the deterministic path', () => {
  // Answering "do you work with insurance" is a published yes. Routing
  // it through the model to find that out is ~600ms of silence for a
  // fact that does not vary.
  const FAST = [
    'What are your labor rates?', 'Do you work with insurance?', 'Can you match my paint?',
    'Do you guys do custom work?', 'Do you guys do full restorations?',
    'How much would it cost to fix a dent?',
  ];
  for (const said of FAST) {
    test(JSON.stringify(said), () => {
      const d = classifyHeuristic(said);
      assert.ok((d?.confidence ?? 0) >= 0.8, `${said} routed at ${d?.confidence} — below the fast-path threshold`);
    });
  }
});

describe('spoken dollars', () => {
  for (const [n, expected] of [[125, 'one hundred twenty-five dollars'], [165, 'one hundred sixty-five dollars'], [95, 'ninety-five dollars'], [1500, 'one thousand five hundred dollars'], [0, 'zero dollars']] as [number, string][]) {
    test(`${n} speaks as ${expected}`, () => assert.equal(speakDollars(n), expected));
  }

  test('out of range, it says nothing rather than something wrong', () => {
    // A mangled price is worse than a digit.
    assert.equal(speakDollars(1_000_000), '1000000');
  });
});
