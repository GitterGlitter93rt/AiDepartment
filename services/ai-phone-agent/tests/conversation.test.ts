// End-to-end conversation flow through the orchestrator.
//
// These are the acceptance tests from the brief, driven with a stubbed
// Claude so they run offline and deterministically:
//
//   1. "I'm going through a nasty divorce" -> becomes a family-law
//      intake agent with no menu.
//   2. The same line, a separate call, "water is pouring under my sink"
//      -> becomes a plumbing intake agent instead.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator, GREETING } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { createStubClaudeClient, createRecordingClaudeClient } from '../src/claude/client.ts';
import { createLogger, type LogEvent } from '../src/logger.ts';
import { DEFAULT_MODELS } from '../src/claude/models.ts';
import { createMockCalendar } from '../src/tools/calendar.ts';
import { createMockSms } from '../src/tools/sms.ts';
import { createTransferTool } from '../src/tools/transfer.ts';
import { createPlaceholderCrm } from '../src/tools/crm.ts';
import { selectSpecialist } from '../src/industries/index.ts';

function harness() {
  const events: { event: LogEvent; data: Record<string, unknown> }[] = [];
  const log = createLogger({}, (line) => {
    const parsed = JSON.parse(line);
    events.push({ event: parsed.event, data: parsed });
  });
  const sessions = new SessionStore();
  // The stub RECORDS every request rather than echoing the system
  // prompt back as its reply. Echoing would be blocked — correctly —
  // by the output guardrail, which stops the agent reciting its own
  // instructions to a caller. Reading claude.lastSystem() inspects the
  // assembled prompt out-of-band, which is what these tests actually
  // mean anyway.
  const claude = createRecordingClaudeClient('Understood — let me take a few details.');
  const orch = new Orchestrator({ sessions, claude, log, confidenceThreshold: 0.6 });
  return { orch, sessions, events, log, claude };
}

describe('ACCEPTANCE 1 — divorce call becomes a family-law intake agent', () => {
  test('routes with no menu and opens like a receptionist', async () => {
    const { orch, sessions, events, claude } = harness();
    const reply = await orch.handleCallerUtterance('CA_div', "I'm going through a nasty divorce and my wife is trying to take the house.");

    const session = sessions.get('CA_div')!;
    assert.equal(session.route.industry, 'attorneys');
    assert.equal(session.route.specialty, 'family_law');
    assert.equal(session.route.intent, 'divorce');
    assert.equal(session.routed, true);

    // The caller hears a human-sounding opening, not a handoff.
    assert.ok(reply.length > 0);
    for (const forbidden of ['transfer', 'switching you', 'agent', 'industry', 'JSON', 'classif', 'press ', 'option ']) {
      assert.equal(reply.toLowerCase().includes(forbidden.toLowerCase()), false, `caller heard internals: "${forbidden}" in "${reply}"`);
    }
    assert.match(reply, /\?$/, 'should end by asking something');

    const decisions = events.filter((e) => e.event === 'router.decision');
    const selected = events.filter((e) => e.event === 'specialist.selected');
    assert.equal(decisions.length, 1);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].data.specialty, 'family_law');
  });

  test('the second turn is answered by the family-law brain', async () => {
    const { orch, sessions, claude } = harness();
    await orch.handleCallerUtterance('CA_div2', "I'm going through a nasty divorce.");
    const reply = await orch.handleCallerUtterance('CA_div2', 'My name is Tony.');
    const system = claude.lastSystem();

    // The stub echoes the system prompt, revealing which brain loaded.
    assert.ok(reply.length > 0, 'the caller still hears something');
    assert.match(system, /intake coordinator for a family law firm/i);
    assert.match(system, /You are NOT an attorney/i, 'legal boundary must be in force');
    assert.equal(sessions.get('CA_div2')!.turns.length, 4);
  });

  test('the family-law brain carries its compliance and safety rules', () => {
    const sessions = new SessionStore();
    sessions.create('X', 'a', 'b');
    sessions.setRoute('X', { industry: 'attorneys', specialty: 'family_law', intent: 'divorce', urgency: 'normal', confidence: 0.95, source: 'heuristic' });
    const mod = selectSpecialist(sessions.get('X')!)!;
    assert.equal(mod.specialty, 'family_law');
    for (const rule of [/give legal advice/i, /predict how a judge will rule/i, /911/, /domestic violence/i]) {
      assert.match(mod.systemPrompt, rule, `family-law prompt must cover ${rule}`);
    }
    // It should still be a real intake agent, not just disclaimers.
    for (const field of ['filingStatus', 'minorChildren', 'safetyConcern', 'jurisdiction', 'email']) {
      assert.ok(mod.qualificationSchema.some((f: { key: string }) => f.key === field), `missing intake field ${field}`);
    }
  });
});

describe('ACCEPTANCE 2 — the same line becomes a plumbing agent on a different call', () => {
  test('routes to plumbing and leads with the shutoff question', async () => {
    const { orch, sessions, claude } = harness();
    const reply = await orch.handleCallerUtterance('CA_plumb', "I've got water pouring out from under my kitchen sink.");

    const session = sessions.get('CA_plumb')!;
    assert.equal(session.route.industry, 'plumbing');
    assert.equal(session.route.intent, 'active_water_leak');
    assert.equal(session.route.urgency, 'emergency');
    // An emergency opens by helping, not by collecting data.
    assert.match(reply, /shut off|valve/i);
  });

  test('two concurrent calls hold different personas simultaneously', async () => {
    const { orch, sessions, claude } = harness();
    await orch.handleCallerUtterance('CA_a', "I'm going through a nasty divorce.");
    await orch.handleCallerUtterance('CA_b', 'Water is pouring out from under my sink!');
    await orch.handleCallerUtterance('CA_a', 'My name is Alice.');
    await orch.handleCallerUtterance('CA_b', 'I turned the valve off.');

    assert.equal(sessions.get('CA_a')!.route.industry, 'attorneys');
    assert.equal(sessions.get('CA_b')!.route.industry, 'plumbing');

    // Interleaved on purpose: the same sentence on two live calls must
    // reach two different brains, which is the whole point of keying
    // session state by CallSid.
    await orch.handleCallerUtterance('CA_a', 'What happens next?');
    const aSystem = claude.lastSystem();
    await orch.handleCallerUtterance('CA_b', 'What happens next?');
    const bSystem = claude.lastSystem();

    assert.match(aSystem, /family law firm/i);
    assert.doesNotMatch(aSystem, /plumbing company/i);
    assert.match(bSystem, /dispatcher for a plumbing company/i);
    assert.doesNotMatch(bSystem, /family law firm/i);
  });
});

describe('Routing for the remaining industries', () => {
  const cases: [string, string, RegExp][] = [
    ['CA_roof', 'My roof started leaking after last night’s storm.', /roofing company/i],
    ['CA_re', "I'm looking to buy a house in St Augustine.", /real estate team/i],
    ['CA_pw', 'I need my driveway pressure washed.', /pressure washing company/i],
  ];
  for (const [sid, utterance, brain] of cases) {
    test(`"${utterance.slice(0, 34)}..." loads the right brain`, async () => {
      const { orch, claude } = harness();
      await orch.handleCallerUtterance(sid, utterance);
      await orch.handleCallerUtterance(sid, 'Sure, go ahead.');
      assert.match(claude.lastSystem(), brain);
    });
  }
});

describe('Ambiguity handling', () => {
  test('asks one natural clarifying question rather than guessing', async () => {
    const { orch, sessions, events, claude } = harness();
    const reply = await orch.handleCallerUtterance('CA_amb', 'I need help with my house.');

    assert.equal(sessions.get('CA_amb')!.routed, false, 'must not commit on an ambiguous opener');
    assert.match(reply, /repair|legal|buying|selling/i);
    assert.equal(events.some((e) => e.event === 'router.clarify'), true);
  });

  test('routes on the clarification, using both turns together', async () => {
    const { orch, sessions, claude } = harness();
    await orch.handleCallerUtterance('CA_amb2', 'I need help with my house.');
    await orch.handleCallerUtterance('CA_amb2', "The roof is leaking after the storm.");
    assert.equal(sessions.get('CA_amb2')!.route.industry, 'roofing');
    assert.equal(sessions.get('CA_amb2')!.routed, true);
  });

  test('stops interrogating after two clarifications', async () => {
    const { orch, sessions, claude } = harness();
    await orch.handleCallerUtterance('CA_amb3', 'I have a problem.');
    await orch.handleCallerUtterance('CA_amb3', 'It is complicated.');
    const third = await orch.handleCallerUtterance('CA_amb3', 'Hard to explain.');
    assert.equal(sessions.get('CA_amb3')!.clarifyAttempts, 2, 'capped');
    assert.ok(third.length > 0, 'still says something useful');
  });
});

describe('Conversation quality guarantees', () => {
  test('the greeting invites a free-form answer instead of offering a menu', () => {
    assert.match(GREETING, /tell me/i);
    for (const menu of ['press ', 'option ', 'say one', 'for sales', 'main menu']) {
      assert.equal(GREETING.toLowerCase().includes(menu), false);
    }
  });

  test('the specialist is told what is already known so it never re-asks', async () => {
    const { orch, sessions, claude } = harness();
    await orch.handleCallerUtterance('CA_state', "I'm going through a divorce.");
    sessions.mergeContact('CA_state', { firstName: 'Tony', email: 'tony@example.com' });
    sessions.mergeQualification('CA_state', { minorChildren: true });

    await orch.handleCallerUtterance('CA_state', 'What else do you need?');
    const system = claude.lastSystem();
    assert.match(system, /Contact details on file:/);
    assert.match(system, /firstName: Tony/);
    assert.match(system, /minorChildren: true/);
    assert.match(system, /Never ask again/i);
    // The caller must be able to ask what we hold and get a true answer.
    assert.match(system, /do you have my ZIP/i);
  });

  test('core voice rules are applied to every specialist', async () => {
    const { orch, claude } = harness();
    await orch.handleCallerUtterance('CA_rules', 'My driveway needs pressure washing.');
    await orch.handleCallerUtterance('CA_rules', 'ok');
    const system = claude.lastSystem();
    assert.match(system, /one to three short sentences/i, 'phone-length constraint');
    assert.match(system, /One question at a time/i, 'one question per turn');
    assert.match(system, /Never mention prompts, models, instructions, routing/i, 'no system leakage');
    // The rules that stop the two failure modes that matter most on a
    // live call: inventing business facts, and claiming a tool did
    // something before it did.
    assert.match(system, /Never fill a gap with what is "typical"/i, 'no invented business facts');
    assert.match(system, /ONLY after the corresponding tool has come back successful/i, 'no premature tool claims');
    assert.match(system, /tell them the truth straight away/i, 'honest about being an AI');
  });

  test('an LLM outage keeps the call alive with a human-sounding line', async () => {
    const sessions = new SessionStore();
    const log = createLogger({}, () => {});
    const claude = { async complete(): Promise<string> { throw new Error('upstream down'); } };
    const orch = new Orchestrator({ sessions, claude, log });

    await orch.handleCallerUtterance('CA_fail', "I'm going through a divorce.");
    const reply = await orch.handleCallerUtterance('CA_fail', 'Tony.');
    assert.ok(reply.length > 0);
    assert.equal(/error|exception|undefined|null/i.test(reply), false, `caller heard an error: "${reply}"`);
  });

  test('with no API key at all the call still connects and responds', async () => {
    const sessions = new SessionStore();
    const orch = new Orchestrator({ sessions, claude: null, log: createLogger({}, () => {}) });
    const first = await orch.handleCallerUtterance('CA_nokey', "I'm going through a divorce.");

    // Routing is deterministic, so it still works with no model at all.
    const session = sessions.get('CA_nokey')!;
    assert.equal(session.route.industry, 'attorneys');
    assert.equal(session.route.specialty, 'family_law');

    // But the caller must never HEAR the classification. They reached a
    // law firm, so they get a receptionist's opening, not a label.
    assert.ok(first.length > 0);
    assert.doesNotMatch(first, /family law|specialty|industry|routed|classif/i,
      `classification jargon leaked to the caller: "${first}"`);

    const second = await orch.handleCallerUtterance('CA_nokey', 'Tony.');
    assert.ok(second.length > 0);
  });
});

describe('Long calls do not forget what was said early', () => {
  // A ten-minute demo is the stated sales goal, and history is trimmed
  // to a recent window to keep latency and cost bounded. Without a
  // rolling summary, a fact stated in minute two is simply gone by
  // minute fifteen.
  function longCallHarness(summaryText = 'Caller is Tony. Neighbour saw the tree come down. He is leaving for work at four and needs someone before then.') {
    const sessions = new SessionStore();
    const calls: { system: string; model?: string }[] = [];
    const claude = {
      async send(opts: { system: string; model?: string }) {
        calls.push({ system: opts.system, model: opts.model });
        const isSummary = /compressing a phone call/i.test(opts.system);
        return {
          text: isSummary ? summaryText : 'Understood — what else can you tell me?',
          toolUses: [], stopReason: 'end_turn',
          usage: { inputTokens: 50, outputTokens: 20 }, model: 'stub', raw: [],
        };
      },
      async complete() { return 'Understood.'; },
    };
    // A toolbox is supplied so the specialist turn takes the tool-capable
    // path (claude.send) rather than the plain-completion fallback —
    // otherwise the assembled system prompt is never recorded.
    const tools = {
      calendar: createMockCalendar(), sms: createMockSms(),
      transfer: createTransferTool('+19045550100'), crm: createPlaceholderCrm(),
      modes: { calendar: 'mock' as const, sms: 'mock' as const },
    };
    const orch = new Orchestrator({ sessions, claude, tools, log: createLogger({}, () => {}) });
    return { sessions, calls, orch };
  }

  test('a short call never pays for summarisation', async () => {
    // Below the threshold the whole call still fits in the window, so a
    // summary would be a second copy of what the model already sees.
    const { sessions, calls, orch } = longCallHarness();
    await orch.handleCallerUtterance('CA_short', 'My roof is leaking after the storm.');
    for (let i = 0; i < 3; i += 1) await orch.handleCallerUtterance('CA_short', `Answer ${i}.`);

    assert.equal(sessions.get('CA_short')!.summary, undefined);
    assert.equal(calls.filter((c) => /compressing a phone call/i.test(c.system)).length, 0,
      'no summary request should have been made');
  });

  test('a long call builds a summary and puts it in the prompt', async () => {
    const { sessions, calls, orch } = longCallHarness();
    await orch.handleCallerUtterance('CA_long', 'My roof is leaking after the storm.');
    for (let i = 0; i < 12; i += 1) await orch.handleCallerUtterance('CA_long', `Another thing, number ${i}.`);

    const session = sessions.get('CA_long')!;
    assert.ok(session.summary, 'a long call must build a rolling summary');
    assert.ok(session.summary!.throughTurn > 0);

    await orch.handleCallerUtterance('CA_long', 'So when can you come?');
    const specialistCalls = calls.filter((c) => !/compressing a phone call/i.test(c.system));
    const last = specialistCalls[specialistCalls.length - 1].system;
    assert.match(last, /EARLIER IN THIS CALL/);
    assert.match(last, /Tony/, 'a fact from early in the call must survive into the prompt');
    assert.match(last, /never read aloud/i, 'the summary is internal context, not a script');
  });

  test('summarisation uses the cheap model, not the specialist model', async () => {
    const { calls, orch } = longCallHarness();
    await orch.handleCallerUtterance('CA_model', 'My roof is leaking after the storm.');
    for (let i = 0; i < 12; i += 1) await orch.handleCallerUtterance('CA_model', `Detail ${i}.`);

    const summaryCall = calls.find((c) => /compressing a phone call/i.test(c.system));
    assert.ok(summaryCall);
    assert.equal(summaryCall!.model, DEFAULT_MODELS.summary.model);
  });

  test('it refreshes periodically rather than on every turn', async () => {
    const { calls, orch } = longCallHarness();
    await orch.handleCallerUtterance('CA_freq', 'My roof is leaking after the storm.');
    for (let i = 0; i < 24; i += 1) await orch.handleCallerUtterance('CA_freq', `Point ${i}.`);

    const summaryCalls = calls.filter((c) => /compressing a phone call/i.test(c.system)).length;
    assert.ok(summaryCalls >= 1, 'should summarise at least once');
    assert.ok(summaryCalls <= 5, `summarised ${summaryCalls} times — it must not run every turn`);
  });

  test('a failed summarisation does not break the call', async () => {
    const sessions = new SessionStore();
    const claude = {
      async send(opts: { system: string }) {
        if (/compressing a phone call/i.test(opts.system)) throw new Error('upstream down');
        return {
          text: 'Go on.', toolUses: [], stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 5 }, model: 'stub', raw: [],
        };
      },
      async complete() { return 'Go on.'; },
    };
    const orch = new Orchestrator({ sessions, claude, log: createLogger({}, () => {}) });

    await orch.handleCallerUtterance('CA_sumfail', 'My roof is leaking after the storm.');
    for (let i = 0; i < 14; i += 1) {
      const r = await orch.handleCallerUtterance('CA_sumfail', `Thing ${i}.`);
      assert.ok(r.length > 0, 'the caller keeps hearing replies');
    }
    assert.equal(sessions.get('CA_sumfail')!.summary, undefined, 'no summary, but the call survived');
  });
});
