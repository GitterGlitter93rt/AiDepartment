// The three live test calls, and the latency work behind them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { takeSpeakable } from '../src/claude/client.ts';
import { speakPhone, splitNanp, formatPhone } from '../src/core/speech.ts';
import { renderGoal, renderOfferMemory } from '../src/core/goals.ts';
import { toolsFor, TOOL_SCHEMAS } from '../src/core/tool-protocol.ts';
import { classifyHeuristic } from '../src/core/router.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { createLogger } from '../src/logger.ts';
import { createMockToolbox } from '../src/tools/index.ts';
import { CORE_AGENT_RULES } from '../src/prompts/core-agent.ts';
import { REGISTRY } from '../src/industries/index.ts';
import type { Session } from '../src/core/types.ts';

const silent = createLogger({}, () => {});

describe('Phone numbers are spoken 3-3-4, in words', () => {
  test('the exact case from testing', () => {
    assert.equal(speakPhone('9046829345'), 'nine oh four, six eight two, nine three four five');
  });

  test('every input format normalises to the same thing', () => {
    for (const n of ['+1 (904) 682-9345', '904.682.9345', '9046829345', '1-904-682-9345', '(904) 682 9345']) {
      assert.equal(speakPhone(n), 'nine oh four, six eight two, nine three four five', n);
    }
  });

  test('zero is "oh", the way people say it', () => {
    assert.match(speakPhone('9040001234'), /oh oh oh/);
    assert.doesNotMatch(speakPhone('9046829345'), /zero/);
  });

  test('the grouping is 3-3-4, never 4-digit blocks', () => {
    const groups = speakPhone('9046829345').split(', ');
    assert.equal(groups.length, 3);
    assert.equal(groups[0].split(' ').length, 3);
    assert.equal(groups[1].split(' ').length, 3);
    assert.equal(groups[2].split(' ').length, 4);
  });

  test('nothing is left for TTS to guess at', () => {
    // No digits survive into the spoken string, so the engine cannot
    // read "904" as "nine hundred and four" or run it together.
    assert.doesNotMatch(speakPhone('9046829345'), /\d/);
  });

  test('the parts are exposed for any other formatting', () => {
    const p = splitNanp('+19046829345')!;
    assert.deepEqual(p.area, ['9', '0', '4']);
    assert.deepEqual(p.exchange, ['6', '8', '2']);
    assert.deepEqual(p.subscriber, ['9', '3', '4', '5']);
    assert.equal(formatPhone('9046829345'), '(904) 682-9345');
  });

  test('a non-NANP number is not forced into the pattern', () => {
    assert.equal(speakPhone('+442071234567'), '+442071234567');
    assert.equal(splitNanp('+442071234567'), null);
  });
});

describe('Streaming: speech starts before the reply is finished', () => {
  test('a complete first sentence is released as soon as it exists', () => {
    // Waiting for the whole reply spends the rest of the generation as
    // silence. The first sentence is enough to start speaking.
    const r = takeSpeakable('Absolutely, we can help with that. Is the car still drivable?', true)!;
    assert.equal(r.clause, 'Absolutely, we can help with that.');
    assert.match(r.rest, /Is the car/);
  });

  test('the comma path releases earlier when no sentence has landed yet', () => {
    // A long opening clause with the full stop still being generated —
    // this is where the comma buys real time.
    const r = takeSpeakable('Absolutely, we can get a truck out to you and take care of', true)!;
    assert.equal(r.clause, 'Absolutely,');
    assert.match(r.rest, /we can get a truck/);
  });

  test('later clauses wait for a sentence, so speech is not choppy', () => {
    assert.equal(takeSpeakable('and then we, um', false), null);
    const r = takeSpeakable('We can get a truck out to you. What kind of car is it?', false)!;
    assert.equal(r.clause, 'We can get a truck out to you.');
  });

  test('a fragment too short to be worth speaking is held', () => {
    // Shipping "Yes," as a turn of its own sounds broken.
    assert.equal(takeSpeakable('Yes, ', true), null);
    assert.equal(takeSpeakable('Sure, ', true), null);
    assert.equal(takeSpeakable('Ok.', true), null);
  });

  test('nothing is emitted until there is a boundary', () => {
    assert.equal(takeSpeakable('Absolutely we can help with', true), null);
  });
});

describe('Barge-in abandons the turn', () => {
  test('an aborted turn returns nothing and is not spoken', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_int', '+19045551234', '+1904');
    const controller = new AbortController();

    // A client that aborts partway, as a caller talking over us would.
    const claude = {
      async complete() { return 'unused'; },
      async send() { return { text: 'x', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 }, model: 'x', raw: [] }; },
      async stream(o: { onClause: (t: string) => void }) {
        o.onClause('We can definitely help with that.');
        controller.abort();
        return { text: 'We can definitely help with that. And then a lot more.', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 }, model: 'x', raw: [] };
      },
    };
    const orch = new Orchestrator({ sessions, claude, log: silent, tools: createMockToolbox() });

    await orch.handleTurn('CA_int', 'I just wrecked my BMW and need it fixed.');
    const spoken: string[] = [];
    const turn = await orch.handleTurn('CA_int', 'It will not drive.', {
      signal: controller.signal,
      onClause: (c) => spoken.push(c),
    });

    assert.equal(turn.interrupted, true);
    assert.equal(turn.text, '', 'an abandoned turn says nothing');

    // And it does not enter the transcript — the caller never heard it,
    // so replying to it next turn would be replying to a ghost.
    const transcript = sessions.get('CA_int')!.turns.map((t) => t.text).join(' ');
    assert.doesNotMatch(transcript, /And then a lot more/);
  });
});

describe('Tool payload is scoped to the call', () => {
  test('a roofing call is not told how to dispatch a tow', () => {
    const names = toolsFor('roofing').map((t) => t.name);
    assert.ok(!names.includes('dispatch_tow'));
    assert.ok(!names.includes('create_partner_referral'));
    assert.ok(names.includes('create_upload_link'));
  });

  test('a collision call gets the collision tools', () => {
    const names = toolsFor('collision_repair').map((t) => t.name);
    for (const n of ['dispatch_tow', 'create_location_link', 'send_esign_packet', 'create_partner_referral']) {
      assert.ok(names.includes(n), n);
    }
  });

  test('sales tools appear only once the caller is buying', () => {
    assert.ok(!toolsFor('plumbing').map((t) => t.name).includes('book_discovery_call'));
    assert.ok(toolsFor('plumbing', 'yad_sales').map((t) => t.name).includes('book_discovery_call'));
  });

  test('every call keeps the tools it always needs', () => {
    for (const industry of ['roofing', 'plumbing', 'real_estate', null]) {
      const names = toolsFor(industry).map((t) => t.name);
      for (const n of ['capture_details', 'end_call', 'transfer_to_human', 'check_availability']) {
        assert.ok(names.includes(n), `${industry}: ${n}`);
      }
    }
  });

  test('pruning materially cuts the payload', () => {
    const all = JSON.stringify(TOOL_SCHEMAS).length;
    const roofing = JSON.stringify(toolsFor('roofing')).length;
    assert.ok(roofing < all * 0.7, `${roofing} vs ${all} — pruning is not doing much`);
  });
});

describe('The agent is told the goal, not a questionnaire', () => {
  function s(industry: string, qual: Record<string, unknown> = {}): Session {
    const store = new SessionStore();
    const sess = store.ensure('CA_g', '+19045551234', '+1904');
    store.setRoute('CA_g', { industry: industry as never, specialty: 'general', intent: 'x', urgency: 'normal', confidence: 0.9, source: 'heuristic' });
    Object.assign(sess.qualification, qual);
    return sess;
  }

  test('the core rules lead with intent, not with a script', () => {
    assert.match(CORE_AGENT_RULES, /WHY THEY CALLED IS THE ONLY THING THAT MATTERS/);
    assert.match(CORE_AGENT_RULES, /Do not ask whether they want to buy, sell or rent/i);
    assert.match(CORE_AGENT_RULES, /THEY CALLED BECAUSE THEY WANT IT DEALT WITH NOW/);
    assert.match(CORE_AGENT_RULES, /never instead of it/i, 'a link supplements help, it does not replace it');
  });

  test('each industry gets an outcome and things to avoid', () => {
    const collision = renderGoal(s('collision_repair'), 'collision_repair')!;
    assert.match(collision, /on its way to the shop, or booked in/);
    assert.match(collision, /sending them to a website/i);
    assert.match(collision, /offering the same link twice/i);

    const pi = renderGoal(s('attorneys'), 'attorneys')!;
    assert.match(pi, /on THIS call/);
    assert.match(pi, /not a reason to end the call/i);

    const re = renderGoal(s('real_estate'), 'real_estate')!;
    assert.match(re, /buy, sell or rent when they have already told you/i);
    assert.match(re, /before helping them/i);
  });

  test('what is already known is struck off', () => {
    const goal = renderGoal(s('collision_repair', { vehicleMake: 'BMW', vehicleDrivable: false }), 'collision_repair')!;
    assert.match(goal, /You already have:.*vehicleMake/);
    assert.match(goal, /Do not ask for any of it again/i);
  });

  test('an unknown industry gets no goal rather than a wrong one', () => {
    assert.equal(renderGoal(s('manufacturing'), 'manufacturing'), null);
  });
});

describe('Offers are made once', () => {
  function withQual(q: Record<string, unknown>): Session {
    const store = new SessionStore();
    const s = store.ensure('CA_o', '+19045551234', '+1904');
    Object.assign(s.qualification, q);
    return s;
  }

  test('nothing offered yet means no memory block', () => {
    assert.equal(renderOfferMemory(withQual({})), null);
  });

  test('a sent link is recorded so it is not offered again', () => {
    const block = renderOfferMemory(withQual({ uploadLinkStatus: 'mocked', locationLinkStatus: 'mocked' }))!;
    assert.match(block, /do not raise any of these again/i);
    assert.match(block, /location link/i);
    assert.match(block, /upload link/i);
  });

  test('a dispatched tow and sent paperwork are remembered', () => {
    const block = renderOfferMemory(withQual({ towRequested: true, esignStatus: 'mocked' }))!;
    assert.match(block, /tow has been arranged/i);
    assert.match(block, /paperwork has been sent/i);
  });
});

describe('THE THREE TEST CALLS', () => {
  const call = async (utterance: string) => {
    const sessions = new SessionStore();
    sessions.ensure('CA_t', '+19045551234', '+19045550100');
    const orch = new Orchestrator({ sessions, claude: null, log: silent, tools: createMockToolbox() });
    const first = await orch.handleCallerUtterance('CA_t', utterance);
    return { first, session: sessions.get('CA_t')! };
  };

  test('BODY SHOP — "I just wrecked my BMW and need to get it fixed"', async () => {
    const { first, session } = await call('I just wrecked my BMW and need to get it fixed.');
    assert.equal(session.route.industry, 'collision_repair');
    // The failures from the live call.
    assert.doesNotMatch(first, /medical|doctor|hospital|injur/i, 'they asked about a car');
    assert.doesNotMatch(first, /website|call (us )?back|link/i, 'do not push them off');
  });

  test('BODY SHOP — the brain is told to help, not to defer', () => {
    const p = REGISTRY.collision_repair[0].systemPrompt;
    assert.match(p, /THEY RANG TO GET THE CAR FIXED/);
    assert.match(p, /Do not send them to a website/i);
    assert.match(p, /offer it ONCE/i);
    assert.match(p, /did not call for health advice/i);
  });

  test('PERSONAL INJURY — "rear-ended this morning and my neck hurts"', async () => {
    const { first, session } = await call('I was rear-ended this morning and my neck hurts.');
    assert.equal(session.route.industry, 'attorneys');
    assert.doesNotMatch(first, /call (us )?back|call back later/i, 'never send them away');
  });

  test('PERSONAL INJURY — untreated is a fact, not an exit', () => {
    const pi = REGISTRY.attorneys.find((x) => x.specialty === 'personal_injury')!;
    assert.match(pi.systemPrompt, /DO NOT SEND THEM AWAY/);
    assert.match(pi.systemPrompt, /Never say "get some treatment and call us back"/i);
    // The old rule said to stop the intake. It now only stops for a
    // real emergency.
    const stopRule = pi.urgencyRules.find((r) => r.level === 'emergency')!;
    assert.match(stopRule.when, /chest pain|bleeding|breathing/i);
    const hurtRule = pi.urgencyRules.find((r) => /has not seen a doctor/i.test(r.when))!;
    assert.match(hurtRule.action, /CARRY ON with the intake/i);
  });

  test('REAL ESTATE — a named listing never gets "buy, sell or rent"', async () => {
    const { first, session } = await call('I want to see your listing at 123 Main Street.');
    assert.equal(session.route.industry, 'real_estate');
    assert.equal(session.route.intent, 'showing_request');
    assert.doesNotMatch(first, /buy.*sell.*rent|looking to buy/i, 'they already said what they want');
    assert.match(first, /when|see it/i, 'ask when they want to go');
  });

  test('REAL ESTATE — "one of your listings" now routes at all', () => {
    const r = classifyHeuristic('I want to see one of your listings.');
    assert.equal(r.industry, 'real_estate');
    assert.equal(r.intent, 'showing_request');
  });

  test('REAL ESTATE — the agent question comes after the showing', () => {
    const p = REGISTRY.real_estate[0].systemPrompt;
    assert.match(p, /SOMEONE ASKING ABOUT A PROPERTY WANTS TO SEE IT/);
    assert.match(p, /AFTER the showing is requested, not before/i);
    assert.match(p, /Never open with "are you looking to buy, sell, or rent"/i);
  });
});
