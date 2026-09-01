// Router tests. These are the product's core promise: the caller says
// one sentence and lands in the right specialist without a menu.
//
// Everything here runs with no API key and no network — the
// deterministic classifier is exercised directly, and Claude is stubbed
// where the two-stage path is under test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic, route, parseRouterJson, clarifyingQuestionFor } from '../src/core/router.ts';
import { createStubClaudeClient } from '../src/claude/client.ts';

describe('Router — the required acceptance cases', () => {
  const cases: [string, string, string, string][] = [
    ["I'm going through a nasty divorce and my wife is trying to take the house.", 'attorneys', 'family_law', 'divorce'],
    ["I've got water pouring out from under my kitchen sink.", 'plumbing', 'emergency', 'active_water_leak'],
    ['My roof started leaking after last night’s storm.', 'roofing', 'storm', 'storm_damage'],
    ["I'm looking to buy a house in St Augustine.", 'real_estate', 'buyer', 'buyer_inquiry'],
    ['I need my driveway pressure washed.', 'pressure_washing', 'general', 'driveway'],
  ];

  for (const [utterance, industry, specialty, intent] of cases) {
    test(`"${utterance.slice(0, 42)}..." -> ${industry}/${intent}`, () => {
      const r = classifyHeuristic(utterance);
      assert.equal(r.industry, industry, `industry (got ${r.industry})`);
      assert.equal(r.specialty, specialty, `specialty (got ${r.specialty})`);
      assert.equal(r.intent, intent, `intent (got ${r.intent})`);
      assert.ok(r.confidence >= 0.8, `confidence ${r.confidence} should be high enough to route without asking`);
    });
  }

  test('ambiguous "I need help with my house" does NOT route and asks for clarification', async () => {
    const h = classifyHeuristic('I need help with my house');
    assert.ok(h.confidence < 0.6, `should be unsure, got ${h.confidence}`);

    const decision = await route('I need help with my house', { claude: null, threshold: 0.6 });
    assert.ok(decision.confidence < 0.6);
    assert.ok(decision.clarifyingQuestion, 'must supply a clarifying question');
    // The question must sound like a receptionist, not a menu.
    const q = decision.clarifyingQuestion!;
    assert.match(q, /repair|legal|buying|selling/i);
    for (const leak of ['industry', 'classif', 'JSON', 'route', 'specialist', 'option 1', 'press ']) {
      assert.equal(q.toLowerCase().includes(leak.toLowerCase()), false, `question leaks internals: "${leak}"`);
    }
  });
});

describe('Router — disambiguation between overlapping industries', () => {
  test('a leaking ROOF is roofing, not plumbing, even though both mention leaks', () => {
    const r = classifyHeuristic('my roof is leaking into the bedroom');
    assert.equal(r.industry, 'roofing');
  });

  test('a leaking SINK is plumbing, not roofing', () => {
    const r = classifyHeuristic('there is water leaking under the bathroom sink');
    assert.equal(r.industry, 'plumbing');
  });

  test('cleaning a roof is pressure washing, not roofing repair', () => {
    const r = classifyHeuristic('I want my roof cleaned, it has black streaks');
    assert.equal(r.industry, 'pressure_washing');
    assert.equal(r.intent, 'roof_cleaning');
  });

  test('selling a house is real estate, not a repair trade', () => {
    const r = classifyHeuristic('I want to sell my home this spring');
    assert.equal(r.industry, 'real_estate');
    assert.equal(r.intent, 'seller_inquiry');
  });

  test('custody without the word divorce still lands in family law', () => {
    const r = classifyHeuristic('my ex is not following the custody agreement');
    assert.equal(r.industry, 'attorneys');
    assert.equal(r.specialty, 'family_law');
  });
});

describe('Router — urgency', () => {
  test('actively flowing water is an emergency', () => {
    const r = classifyHeuristic('water is gushing out of a burst pipe in my basement');
    assert.equal(r.industry, 'plumbing');
    assert.equal(r.urgency, 'emergency');
  });

  test('a routine quote is not urgent', () => {
    const r = classifyHeuristic('I need my driveway pressure washed');
    assert.equal(r.urgency, 'normal');
  });

  test('an active roof leak is at least high urgency', () => {
    const r = classifyHeuristic('my roof is leaking right now');
    assert.ok(['high', 'emergency'].includes(r.urgency), `got ${r.urgency}`);
  });
});

describe('Router — two-stage behaviour', () => {
  test('a corroborated heuristic match never consults Claude', async () => {
    let called = false;
    const claude = createStubClaudeClient(() => { called = true; return '{}'; });
    // Anchor ("divorce") plus corroboration ("wife") clears the fast
    // path, so the caller hears the specialist with no model latency.
    const d = await route("I'm going through a nasty divorce and my wife is trying to take the house.", { claude });
    assert.equal(called, false, 'no LLM round-trip needed for a corroborated case');
    assert.equal(d.industry, 'attorneys');
    assert.equal(d.source, 'heuristic');
  });

  test('a single uncontested anchor is verified with Claude rather than assumed', async () => {
    // Deliberate: one keyword with nothing corroborating it is a
    // plausible guess (0.78), not a certainty. Confirming it costs a
    // round-trip but avoids committing the whole call to a persona on
    // the strength of one word.
    let called = false;
    const claude = createStubClaudeClient(() => {
      called = true;
      return JSON.stringify({ industry: 'attorneys', specialty: 'family_law', intent: 'divorce', urgency: 'normal', confidence: 0.96 });
    });
    const d = await route('I need to talk to someone about a divorce', { claude });
    assert.equal(called, true, 'a lone anchor should be checked, not trusted outright');
    assert.equal(d.industry, 'attorneys');
  });

  test('an ambiguous utterance falls through to Claude', async () => {
    let called = false;
    const claude = createStubClaudeClient(() => {
      called = true;
      return JSON.stringify({ industry: 'real_estate', specialty: 'buyer', intent: 'buyer_inquiry', urgency: 'normal', confidence: 0.9 });
    });
    const d = await route('my situation is a bit complicated, it is about a property', { claude });
    assert.equal(called, true, 'LLM should be consulted when the heuristic is unsure');
    assert.equal(d.industry, 'real_estate');
    assert.equal(d.source, 'llm');
  });

  test('an LLM failure degrades gracefully instead of dropping the call', async () => {
    const claude = { async complete() { throw new Error('network down'); } };
    const d = await route('I need help with my house', { claude });
    assert.ok(d.clarifyingQuestion, 'still asks something useful');
    assert.equal(d.industry, null);
  });

  test('a low-confidence LLM answer does not override a decent heuristic', async () => {
    const claude = createStubClaudeClient(JSON.stringify({ industry: 'plumbing', confidence: 0.2 }));
    const d = await route('I think I need a lawyer', { claude, threshold: 0.6 });
    assert.equal(d.industry, 'attorneys');
  });
});

describe('Router — JSON parsing is strict about values, tolerant of formatting', () => {
  test('accepts a clean object', () => {
    const d = parseRouterJson('{"industry":"plumbing","specialty":"emergency","intent":"active_water_leak","urgency":"emergency","confidence":0.95}');
    assert.equal(d?.industry, 'plumbing');
    assert.equal(d?.urgency, 'emergency');
  });

  test('tolerates code fences and surrounding prose', () => {
    const d = parseRouterJson('Here you go:\n```json\n{"industry":"roofing","confidence":0.8}\n```');
    assert.equal(d?.industry, 'roofing');
  });

  test('rejects an unknown industry rather than trusting it', () => {
    assert.equal(parseRouterJson('{"industry":"dentistry","confidence":0.99}'), null);
  });

  test('rejects malformed output', () => {
    assert.equal(parseRouterJson('not json at all'), null);
    assert.equal(parseRouterJson(''), null);
    assert.equal(parseRouterJson('{"broken":'), null);
  });

  test('clamps a nonsense confidence into range', () => {
    assert.equal(parseRouterJson('{"industry":"plumbing","confidence":7}')?.confidence, 1);
    assert.equal(parseRouterJson('{"industry":"plumbing","confidence":-3}')?.confidence, 0);
  });
});

describe('Router — never leaks internals to the caller', () => {
  test('clarifying questions read as a receptionist', () => {
    for (const u of ['I need help with my house', 'it is complicated', 'I have a problem']) {
      const q = clarifyingQuestionFor(u);
      assert.ok(q.length > 10 && q.length < 200, 'phone-length question');
      assert.equal(/\bJSON\b|\bindustry\b|\bclassif|\brouter\b|\bagent\b|\bprompt\b/i.test(q), false, `leaked internals: ${q}`);
      assert.match(q, /\?$/, 'should be a question');
    }
  });
});
