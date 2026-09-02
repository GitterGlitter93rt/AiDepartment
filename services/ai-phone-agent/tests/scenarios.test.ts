// The demo scenario library as a regression gate.
//
// These run without an API key, so they assert what can be asserted
// deterministically: routing, knowledge matching, and the structural
// promises of the library. The content assertions (what the agent
// actually says) need a live model and are checked by
// `npm run voice:simulate`, which the CI-less parts of this file
// deliberately do not try to fake.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, NEVER_SAY, scenariosByIndustry } from '../src/sim/scenarios.ts';
import { classifyHeuristic, route } from '../src/core/router.ts';
import { INDUSTRY_IDS } from '../src/core/taxonomy.ts';
import { knowledgeFor } from '../src/knowledge/index.ts';
import { matchKnowledge } from '../src/knowledge/types.ts';
import { demoProfile } from '../src/business/profile.ts';
import { allSpecialists, REGISTRY } from '../src/industries/index.ts';

describe('Scenario library integrity', () => {
  test('scenario ids are unique', () => {
    const ids = SCENARIOS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every scenario names an industry that exists', () => {
    const valid = new Set<string>(INDUSTRY_IDS);
    for (const s of SCENARIOS) {
      assert.ok(valid.has(s.industry), `${s.id} names unknown industry "${s.industry}"`);
    }
  });

  test('every industry has at least one scenario', () => {
    const covered = scenariosByIndustry();
    const missing = INDUSTRY_IDS.filter((id) => !covered[id]);
    assert.deepEqual(missing, [], `industries with no demo scenario: ${missing.join(', ')}`);
  });

  test('the five priority industries have several scenarios each', () => {
    // These are the immediate demo and sales targets, so shallow
    // coverage there is a business problem, not just a test gap.
    const by = scenariosByIndustry();
    for (const id of ['attorneys', 'plumbing', 'roofing', 'real_estate', 'pressure_washing']) {
      assert.ok((by[id]?.length ?? 0) >= 4,
        `${id} has only ${by[id]?.length ?? 0} scenarios; priority industries need at least 4`);
    }
  });

  test('a scenario testing a mid-call question supplies establishing context', () => {
    // A question like "do you charge to come out?" is not how anyone
    // opens a call. Without context it measures the router on an input
    // it will never see.
    for (const s of SCENARIOS) {
      if (s.context) continue;
      const r = classifyHeuristic(s.opening);
      assert.ok(r.industry !== null,
        `${s.id} opens with "${s.opening}" which routes nowhere — it needs a context turn`);
    }
  });
});

describe('Every scenario routes where it should', () => {
  for (const s of SCENARIOS) {
    test(`${s.id} → ${s.industry}`, async () => {
      // Route on the same text the simulator would: context first.
      const text = s.context ? `${s.context} ${s.opening}` : s.opening;
      const r = classifyHeuristic(text);
      assert.equal(r.industry, s.industry,
        `got ${r.industry}/${r.intent} @ ${r.confidence.toFixed(2)} for "${text}"`);

      // Specialty is asserted only where the opening stands alone. A
      // context turn legitimately shifts which rule dominates — "storm
      // took shingles off my roof" followed by an insurance question is
      // a storm call in which insurance came up, and pinning the
      // specialty would be testing the fixture rather than the router.
      if (s.specialty && !s.context) assert.equal(r.specialty, s.specialty);
    });
  }
});

describe('Scenarios reach the knowledge that makes them answerable', () => {
  // A scenario whose whole point is a pricing deflection is worthless
  // if the pricing entry never matches what the caller said.
  const PROBES: [string, string][] = [
    ['DIVORCE_PRICING', 'consultation'],
    ['PLUMBING_PRICING', 'charge'],
    ['ROOF_INSURANCE', 'insurance'],
    ['REAL_ESTATE_SELLER', 'worth'],
    ['PRESSURE_WASH_HOUSE', 'green'],
    ['HEALTHCARE_INSURANCE', 'blue cross'],
    ['SOLAR_SAVINGS', 'save'],
    ['AUTO_DEALER_AVAILABLE', 'still have'],
  ];

  for (const [id, hint] of PROBES) {
    test(`${id} matches knowledge about "${hint}"`, () => {
      const s = SCENARIOS.find((x) => x.id === id)!;
      const specialistId = s.specialty ? `${s.industry}.${s.specialty}` : null;
      const bank = knowledgeFor(specialistId, s.industry);
      const matches = matchKnowledge(s.opening, bank, demoProfile(s.industry as never));
      assert.ok(matches.length > 0, `no knowledge entry matched "${s.opening}"`);
    });
  }

  test('a pricing question on a demo profile is marked unanswerable', () => {
    // The demo business has no configured pricing, so the agent must be
    // told it does not know rather than left to invent a figure.
    const bank = knowledgeFor('attorneys.family_law', 'attorneys');
    const matches = matchKnowledge('How much does a consultation cost?', bank, demoProfile('attorneys'));
    assert.ok(matches.length > 0);
    assert.ok(matches.some((m) => !m.answerable),
      'a pricing question against an unconfigured profile must be flagged unanswerable');
  });

  test('the same question becomes answerable once the business configures it', () => {
    const configured = demoProfile('attorneys', {
      pricing: { description: 'The first consultation is $150, credited against the retainer.' },
    });
    const bank = knowledgeFor('attorneys.family_law', 'attorneys');
    const matches = matchKnowledge('How much does a consultation cost?', bank, configured);
    assert.ok(matches.some((m) => m.answerable),
      'configured pricing must unlock the answer — that is the whole point of the profile');
  });
});

describe('The never-say list is enforceable', () => {
  test('it catches the fabrications that actually happen', () => {
    const bad = [
      'Our service call is $89.',
      "We've been in business 27 years.",
      'We offer a lifetime warranty.',
      'We definitely accept State Farm.',
      'Someone can be there within 30 minutes.',
      "I'm a real person.",
      'Your case is worth about that much.',
      "You'll probably get custody.",
    ];
    for (const line of bad) {
      assert.ok(NEVER_SAY.some((re) => re.test(line)), `not caught: "${line}"`);
    }
  });

  test('it does not fire on ordinary, correct replies', () => {
    // False positives here would make the whole gate unusable.
    const good = [
      "I don't have the pricing in front of me, but I can get someone to confirm.",
      "Let's get someone out to look at it — what's the best number for you?",
      "I'm an AI assistant helping with the first part of the call.",
      'Is the water shut off? There should be a valve under the sink.',
      "I can't predict how a judge would rule, but I can get you in front of an attorney.",
      'We have Wednesday at nine or Thursday at one — which works better?',
    ];
    for (const line of good) {
      const hit = NEVER_SAY.find((re) => re.test(line));
      assert.equal(hit, undefined, `false positive on "${line}" from ${hit}`);
    }
  });
});

describe('Registry and documentation cannot silently drift apart', () => {
  test('every registered industry has a specialist with supported intents', () => {
    for (const id of INDUSTRY_IDS) {
      const specs = REGISTRY[id];
      assert.ok(specs?.length, `${id} has no specialist`);
      for (const s of specs) {
        assert.ok(s.supportedIntents.length > 0, `${s.id} declares no supported intents`);
      }
    }
  });

  test('every specialist is exercised by at least one scenario', () => {
    const covered = new Set(SCENARIOS.map((s) => (s.specialty ? `${s.industry}.${s.specialty}` : s.industry)));
    const uncovered = allSpecialists()
      .filter((s) => !covered.has(s.id) && !covered.has(s.industry))
      .map((s) => s.id);
    assert.deepEqual(uncovered, [], `specialists with no scenario: ${uncovered.join(', ')}`);
  });
});
