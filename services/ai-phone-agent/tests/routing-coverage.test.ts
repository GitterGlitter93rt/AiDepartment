// Coverage tests for the full 28-industry taxonomy.
//
// The point of this file is not to assert a specific specialty for
// every phrase — it is to prove three things that matter on a live
// call:
//
//   1. Every industry in the taxonomy is REACHABLE. A specialist that
//      exists but can never be routed to is dead code with a nice
//      prompt.
//   2. Every specialist's own sampleUtterances route to that
//      specialist's industry. The sample lines are the module author's
//      claim about what they handle; this holds them to it.
//   3. Realistic variants — slang, typos, hedging, run-on sentences —
//      still land in the right industry, because nobody calls a
//      plumber and says "I require plumbing services".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic } from '../src/core/router.ts';
import { RULES } from '../src/core/router-rules.ts';
import { INDUSTRY_IDS, type Industry } from '../src/core/taxonomy.ts';
import { REGISTRY, allSpecialists } from '../src/industries/index.ts';

describe('Taxonomy integrity', () => {
  test('every industry in the taxonomy has at least one specialist', () => {
    for (const id of INDUSTRY_IDS) {
      const specs = REGISTRY[id];
      assert.ok(specs && specs.length > 0, `industry "${id}" has no specialist module`);
    }
  });

  test('every industry in the taxonomy has at least one routing rule', () => {
    const covered = new Set(RULES.map((r) => r.industry));
    const missing = INDUSTRY_IDS.filter((id) => !covered.has(id));
    assert.deepEqual(missing, [], `industries with no routing rule: ${missing.join(', ')}`);
  });

  test('every routing rule points at an industry that exists', () => {
    const valid = new Set<string>(INDUSTRY_IDS);
    for (const r of RULES) {
      assert.ok(valid.has(r.industry), `rule for unknown industry "${r.industry}"`);
    }
  });

  test('specialist ids are unique', () => {
    const ids = allSpecialists().map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate specialist ids in ${ids.join(', ')}`);
  });

  test('every specialist declares sample utterances to be tested against', () => {
    for (const s of allSpecialists()) {
      assert.ok(s.sampleUtterances.length >= 3,
        `${s.id} needs at least 3 sample utterances (has ${s.sampleUtterances.length})`);
    }
  });
});

describe('Every specialist routes to its own industry', () => {
  for (const spec of allSpecialists()) {
    for (const utterance of spec.sampleUtterances) {
      test(`[${spec.id}] "${utterance.slice(0, 52)}"`, () => {
        const r = classifyHeuristic(utterance);
        assert.equal(r.industry, spec.industry,
          `expected ${spec.industry}, got ${r.industry} (score ${r.topScore}, runner-up ${r.runnerUp})`);
      });
    }
  }
});

// Real callers, transcribed by a speech engine that mishears things.
// Slang, typos, filler, and sentences that run on forever.
const NATURAL_VARIANTS: [string, Industry][] = [
  // --- plumbing ---
  ["uhh yeah so theres water like everywhere under my sink man", 'plumbing'],
  ['my toilets overflowing and i cant get it to stop', 'plumbing'],
  ['aint got no hot water since this morning', 'plumbing'],
  ['the drain in my shower is backed up again', 'plumbing'],
  ['pipe busted in the wall', 'plumbing'],

  // --- roofing ---
  ['storm last night tore a bunch of shingles off my roof', 'roofing'],
  ['theres a brown spot on my ceiling thats getting bigger', 'roofing'],
  ['need a quote on a new roof my house is 22 years old', 'roofing'],
  ['hail came through and messed up the roof, insurance wants an inspection', 'roofing'],

  // --- hvac ---
  ['my ac quit and its 96 degrees in the house', 'hvac'],
  ['furnace wont kick on and its freezing', 'hvac'],
  ['air conditioner is blowing warm air', 'hvac'],
  ['need a price on a new hvac system', 'hvac'],

  // --- electrical ---
  ['i smell something burning near the breaker panel', 'electrical'],
  ['the outlet sparked when i plugged in the vacuum', 'electrical'],
  ['breaker keeps tripping every time i run the microwave', 'electrical'],
  ['want to get an ev charger installed in my garage', 'electrical'],

  // --- pest control ---
  ['i think we got bedbugs, im covered in bites', 'pest_control'],
  ['theres something scratching in my attic at night', 'pest_control'],
  ['saw a couple roaches in the kitchen last night', 'pest_control'],
  ['big wasp nest right over my front door', 'pest_control'],

  // --- garage door ---
  ['garage door spring snapped and now it wont go up', 'garage_door'],
  ['my garage door is off track and stuck halfway', 'garage_door'],
  ['the opener just clicks and nothing happens', 'garage_door'],

  // --- pool ---
  ['my pool turned green over the weekend', 'pool'],
  ['pool pump stopped running', 'pool'],
  ['looking for weekly pool service', 'pool'],

  // --- screen enclosure ---
  ['a couple panels on my pool cage are torn', 'screen_enclosure'],
  ['need my lanai rescreened', 'screen_enclosure'],
  ['want a quote for a screen enclosure over the patio', 'screen_enclosure'],

  // --- landscaping ---
  ['need somebody to mow my lawn every two weeks', 'landscaping'],
  ['my sprinkler system isnt coming on', 'landscaping'],
  ['want to redo the landscaping in the front yard with pavers', 'landscaping'],
  ['got a tree that needs to come down', 'landscaping'],

  // --- restoration ---
  ['my basement flooded theres like a foot of water down there', 'restoration'],
  ['we had a fire in the kitchen and theres smoke damage everywhere', 'restoration'],
  ['found black mold behind the drywall', 'restoration'],

  // --- construction ---
  ['looking to gut and remodel our kitchen', 'construction'],
  ['we want to add a room onto the back of the house', 'construction'],
  ['need a general contractor for a bathroom renovation', 'construction'],

  // --- pressure washing ---
  ['my driveway is black, needs a good pressure washing', 'pressure_washing'],
  ['want the whole house soft washed, siding is green', 'pressure_washing'],
  ['black streaks all over my roof, can you clean that', 'pressure_washing'],

  // --- collision repair ---
  ['somebody backed into my bumper in a parking lot', 'collision_repair'],
  ['need an estimate for body work, insurance is involved', 'collision_repair'],
  ['hail beat up the hood of my truck pretty bad', 'collision_repair'],

  // --- automotive dealer ---
  ['do you still have that silver f150 on your website', 'automotive_dealer'],
  ['id like to set up a test drive for this weekend', 'automotive_dealer'],
  ['what can you give me for my trade in', 'automotive_dealer'],
  ['need to schedule an oil change', 'automotive_dealer'],

  // --- real estate ---
  ['were thinking about buying our first home', 'real_estate'],
  ['i want to list my house, whats it worth right now', 'real_estate'],
  ['can i see the place on maple street this saturday', 'real_estate'],
  ['moving to the area in june and need a realtor', 'real_estate'],

  // --- property management ---
  ['im a tenant and the ac in my unit stopped working', 'property_management'],
  ['do you have any two bedroom apartments available', 'property_management'],
  ['i own four rentals and im tired of managing them myself', 'property_management'],

  // --- healthcare ---
  ['i need to make an appointment with the doctor', 'healthcare'],
  ['im a new patient trying to get established', 'healthcare'],
  ['do you accept blue cross', 'healthcare'],

  // --- insurance ---
  ['looking for a quote on auto insurance', 'insurance'],
  ['i need to file a claim, tree fell on my car', 'insurance'],
  ['my premium went up and i want to talk to somebody', 'insurance'],

  // --- financial services ---
  ['need help rolling over my 401k', 'financial_services'],
  ['looking for a cpa to do my business taxes', 'financial_services'],
  ['we need bookkeeping help, were behind', 'financial_services'],

  // --- manufacturing ---
  ['sending over an rfq for 500 machined parts', 'manufacturing'],
  ['the parts you sent are out of spec and our line is down', 'manufacturing'],
  ['where are our parts, the po went in six weeks ago', 'manufacturing'],

  // --- logistics ---
  ['need a rate to ship four pallets ltl to atlanta', 'logistics'],
  ['where is my shipment, it never showed up', 'logistics'],
  ['need to schedule a pickup for tomorrow morning', 'logistics'],

  // --- energy ---
  ['i smell gas outside near the meter', 'energy'],
  ['theres a power line down across the road', 'energy'],
  ['we want to talk about an energy efficiency project for our facility', 'energy'],

  // --- defense & aerospace ---
  ['are you as9100 certified', 'defense_aerospace'],
  ['we need an itar compliant supplier for a defense program', 'defense_aerospace'],

  // --- solar ---
  ['thinking about going solar, my electric bill is insane', 'solar'],
  ['my solar stopped producing, i think the inverter is out', 'solar'],
  ['interested in adding battery backup', 'solar'],

  // --- fiber / broadband ---
  ['do you have fiber available at my address', 'fiber_broadband'],
  ['my internet is down again', 'fiber_broadband'],
  ['speeds are way slower than what im paying for', 'fiber_broadband'],

  // --- ecommerce ---
  ['wheres my order, it was supposed to be here tuesday', 'ecommerce'],
  ['i want to return an item', 'ecommerce'],
  ['it arrived damaged, the box was crushed', 'ecommerce'],

  // --- attorneys ---
  ['my wife served me with divorce papers yesterday', 'attorneys'],
  ['im trying to get custody of my kids', 'attorneys'],
  ['my ex is behind on child support', 'attorneys'],
  ['i need a restraining order, my husband threatened me', 'attorneys'],
  ['i got rear ended at a red light and my neck is killing me', 'attorneys'],
  ['slipped and fell in a grocery store and broke my wrist', 'attorneys'],
  ['my son got arrested last night for dui', 'attorneys'],
  ['my father passed away and we need to get the estate through probate', 'attorneys'],
  ['need to get a will drawn up', 'attorneys'],
];

describe('Natural, messy, real-caller phrasing still routes correctly', () => {
  for (const [utterance, expected] of NATURAL_VARIANTS) {
    test(`"${utterance.slice(0, 54)}" -> ${expected}`, () => {
      const r = classifyHeuristic(utterance);
      assert.equal(r.industry, expected,
        `got ${r.industry}/${r.intent} (score ${r.topScore}, runner-up ${r.runnerUp})`);
    });
  }
});

describe('Coverage accounting', () => {
  test('the natural-variant corpus exercises every industry', () => {
    const seen = new Set(NATURAL_VARIANTS.map(([, i]) => i));
    const missing = INDUSTRY_IDS.filter((id) => !seen.has(id));
    // professional_services is deliberately broad ("we need consulting
    // help") and is exercised in the ambiguity suite instead, where
    // what matters is that it does NOT capture calls belonging to a
    // named industry.
    assert.deepEqual(missing, ['professional_services'],
      `industries missing natural-variant coverage: ${missing.join(', ')}`);
  });
});

// Utterances that are genuinely ambiguous as an OPENING line. Each one
// is a real thing a caller says, and each one legitimately belongs to
// two or more businesses. The classifier must not pretend otherwise:
// getting these wrong confidently is worse than asking, because a
// confident misroute puts the caller in front of an agent role-playing
// the wrong business and there is no graceful recovery from that.
const GENUINELY_AMBIGUOUS: [string, string][] = [
  ['Someone rear-ended me in a parking lot.', 'injury claim vs. body shop'],
  ['My insurance adjuster is coming and I need my own inspection.', 'roofing vs. restoration vs. collision'],
  ['The lock on my front door is broken.', 'locksmith vs. property manager vs. handyman'],
  ['When can you come install?', 'no subject at all'],
  ['I need help with my house', 'every home-services trade at once'],
  ['I have a question about my bill.', 'every industry bills someone'],
  ['Where is my order?', 'consumer retail vs. B2B manufacturing'],
  // NOT listed as ambiguous: "A tree fell on my house." A tree on the
  // structure is a roofing emergency — the roofer tarps it and stops
  // the water. Routing it confidently to roofing is the right answer,
  // and the veto rules already peel off the insurance-claim and
  // tree-removal variants of the same sentence.
  ['Can you come out and take a look?', 'no subject at all'],
  ['I got your number from a friend.', 'no subject at all'],
];

describe('Genuine ambiguity is admitted, not guessed at', () => {
  for (const [utterance, why] of GENUINELY_AMBIGUOUS) {
    test(`"${utterance.slice(0, 46)}" — ${why}`, () => {
      const r = classifyHeuristic(utterance);
      assert.ok(r.confidence < 0.8,
        `claimed ${(r.confidence * 100).toFixed(0)}% certainty of ${r.industry} on an ambiguous line; ` +
        `it should defer to Claude or ask a clarifying question`);
    });
  }
});

describe('Safety contract — the classifier never confidently misroutes', () => {
  // The strongest property in this file. Every sample utterance across
  // every specialist is checked against every OTHER industry: if the
  // heuristic is going to claim high confidence, it has to be right.
  test('no specialist sample routes confidently into a different industry', () => {
    const violations: string[] = [];
    for (const spec of allSpecialists()) {
      for (const u of spec.sampleUtterances) {
        const r = classifyHeuristic(u);
        if (r.industry && r.industry !== spec.industry && r.confidence >= 0.8) {
          violations.push(`${spec.id}: "${u}" -> ${r.industry} @ ${r.confidence.toFixed(2)}`);
        }
      }
    }
    assert.deepEqual(violations, [], `confident misroutes:\n  ${violations.join('\n  ')}`);
  });

  test('no natural variant routes confidently into a different industry', () => {
    const violations: string[] = [];
    for (const [u, expected] of NATURAL_VARIANTS) {
      const r = classifyHeuristic(u);
      if (r.industry && r.industry !== expected && r.confidence >= 0.8) {
        violations.push(`"${u}" -> ${r.industry} @ ${r.confidence.toFixed(2)} (expected ${expected})`);
      }
    }
    assert.deepEqual(violations, [], `confident misroutes:\n  ${violations.join('\n  ')}`);
  });
});
