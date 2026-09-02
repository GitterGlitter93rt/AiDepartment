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
import { demoProfile, renderBusinessProfile } from '../src/business/profile.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { createLogger } from '../src/logger.ts';
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

describe('Website and agent industry lists cannot drift apart', () => {
  // The website and the service are separate build graphs, so nothing
  // else catches a 29th website industry being added with no
  // specialist behind it — a prospect in that trade would reach the
  // wrong business.
  test('coverage is complete in both directions', async () => {
    const { buildCoverage } = await import('../src/sim/coverage.ts');
    const r = buildCoverage();

    assert.deepEqual(r.missingSpecialist, [],
      `website industries with no specialist: ${r.missingSpecialist.map((m) => m.name).join(', ')}`);
    assert.deepEqual(r.unmappedSlugs, [],
      `website industries not mapped to an agent id — probably newly added: ${r.unmappedSlugs.join(', ')}`);
    assert.deepEqual(r.undeclaredExtra, [],
      `agent industries with no website page and no declared reason: ${r.undeclaredExtra.join(', ')}`);
    assert.deepEqual(r.noRoutingRule, []);
    assert.deepEqual(r.noKnowledgeBank, []);
    assert.deepEqual(r.noScenario, []);
    assert.deepEqual(r.missingFromInventory, [],
      `agent industries missing from the inventory doc: ${r.missingFromInventory.join(', ')}`);
  });

  test('Pressure Washing is preserved as a deliberate extra', async () => {
    // It is an active sales target with no website page. Recording it
    // explicitly means removing it has to be a decision, not a tidy-up
    // by a session that assumed it was a mistake.
    const { buildCoverage } = await import('../src/sim/coverage.ts');
    const r = buildCoverage();
    const pw = r.intentionalExtras.find((e) => e.id === 'pressure_washing');
    assert.ok(pw, 'pressure_washing must remain a declared intentional extra');
    assert.match(pw!.reason, /website content gap/i);
  });
});

describe('Demo mode and client mode behave differently', () => {
  // The same engine has to serve a demo line that switches industries
  // on request, and a real client whose receptionist must never do
  // that. The difference is configuration, not a fork of the code.
  const silent = createLogger({}, () => {});

  test('a demo caller can switch industries mid-call and gets a clean slate', async () => {
    const sessions = new SessionStore();
    const orch = new Orchestrator({ sessions, claude: null, log: silent });

    await orch.handleCallerUtterance('CA_demo', "I'm going through a nasty divorce and my wife wants the house.");
    sessions.mergeQualification('CA_demo', { minorChildren: true });
    assert.equal(sessions.get('CA_demo')!.route.industry, 'attorneys');

    await orch.handleCallerUtterance('CA_demo', 'What about plumbing? Water is pouring out from under my sink.');
    const s = sessions.get('CA_demo')!;
    assert.equal(s.route.industry, 'plumbing');
    assert.equal(s.scenarioSwitches, 1);
    assert.deepEqual(s.qualification, {}, "the divorce answers must not follow the caller into a plumbing call");
  });

  test('a client line never switches industry, however the caller wanders', async () => {
    // A plumbing company's receptionist does not become a divorce
    // intake because a caller mentioned their ex-wife. On a real
    // business line that would be an alarming bug.
    const sessions = new SessionStore();
    const orch = new Orchestrator({
      sessions, claude: null, log: silent,
      resolveProfile: () => demoProfile('plumbing', { mode: 'client', businessName: 'Acme Plumbing' }),
    });

    await orch.handleCallerUtterance('CA_client', "Water is pouring out from under my sink.");
    assert.equal(sessions.get('CA_client')!.route.industry, 'plumbing');

    await orch.handleCallerUtterance('CA_client', "Actually, I'm also going through a nasty divorce and my wife wants the house.");
    assert.equal(sessions.get('CA_client')!.route.industry, 'plumbing',
      'a client line must stay on the business it answers for');
    assert.equal(sessions.get('CA_client')!.scenarioSwitches, 0);
  });

  test('a configured client profile puts its real facts in the prompt', async () => {
    const rendered = renderBusinessProfile(demoProfile('plumbing', {
      mode: 'client',
      businessName: 'Acme Plumbing',
      hours: { description: 'Monday to Friday, 7 to 5', emergencyAfterHours: true },
      serviceArea: { description: 'St Johns and Duval counties' },
      pricing: { serviceCallFee: '$89, credited against the repair' },
      licensing: 'Florida CFC1428900, licensed and insured',
    }));

    assert.match(rendered, /Acme Plumbing/);
    assert.match(rendered, /\$89/);
    assert.match(rendered, /St Johns and Duval/);
    assert.match(rendered, /CFC1428900/);
    // What it knows is now genuinely known, so it must not be listed
    // as unknown.
    assert.doesNotMatch(rendered.split('WHAT YOU DO NOT KNOW')[1] ?? '', /pricing|opening hours|service area|licence details/);
  });

  test('an unconfigured demo profile states its ignorance explicitly', async () => {
    const rendered = renderBusinessProfile(demoProfile('plumbing'));

    assert.match(rendered, /WHAT YOU DO NOT KNOW — THIS IS BINDING/);
    for (const field of ['business name', 'service area', 'opening hours', 'pricing', 'warranty terms', 'licence details']) {
      assert.ok(rendered.includes(field), `the unknown list must name "${field}"`);
    }
    assert.match(rendered, /Do NOT estimate, guess, give a typical figure/);
  });
});
