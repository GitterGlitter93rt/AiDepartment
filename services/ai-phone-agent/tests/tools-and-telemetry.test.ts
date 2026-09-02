// Tool-call contract, end-of-call reporting, and model configuration.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateToolRequest, executeToolRequest, TOOL_SCHEMAS } from '../src/core/tool-protocol.ts';
import { buildCallSummary, buildDemoAnalytics, ANALYTICS_FORBIDDEN_KEYS } from '../src/core/call-summary.ts';
import { resolveModels, DEFAULT_MODELS } from '../src/claude/models.ts';
import { resolveWhen, speakSlot } from '../src/core/when.ts';
import { SessionStore } from '../src/core/session.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { createScriptedClaudeClient } from '../src/claude/client.ts';
import { createLogger, type LogEvent } from '../src/logger.ts';
import { createMockCalendar } from '../src/tools/calendar.ts';
import { createMockSms } from '../src/tools/sms.ts';
import { createTransferTool } from '../src/tools/transfer.ts';
import { createPlaceholderCrm } from '../src/tools/crm.ts';
import type { Toolbox } from '../src/tools/index.ts';
import type { Session } from '../src/core/types.ts';
import { createMockTow, createMockEsign, createMockUploadLink, createMockReferral, createMockLocationLink } from '../src/tools/actions.ts';

const NOW = new Date('2026-09-01T14:00:00.000Z');

function mockTools(): Toolbox {
  return {
    calendar: createMockCalendar(() => NOW),
    sms: createMockSms(),
    transfer: createTransferTool('+19045550100'),
    crm: createPlaceholderCrm(),
    tow: createMockTow(), esign: createMockEsign(),
    uploadLink: createMockUploadLink(), referral: createMockReferral(),
    locationLink: createMockLocationLink(),
    modes: { calendar: 'mock', sms: 'mock', tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock', locationLink: 'mock' },
  };
}

function session(over: Partial<Session> = {}): Session {
  const s = new SessionStore().ensure('CA_t');
  s.from = '+19045550142';
  Object.assign(s, over);
  return s;
}

const silent = createLogger({}, () => {});

describe('Tool schemas are well formed', () => {
  test('every schema declares its required fields as real properties', () => {
    for (const t of TOOL_SCHEMAS) {
      assert.ok(t.name && t.description, `${t.name} needs a description`);
      for (const req of t.input_schema.required) {
        assert.ok(req in t.input_schema.properties,
          `${t.name} requires "${req}" but does not define it`);
      }
    }
  });

  test('the description tells the model when NOT to call it', () => {
    const availability = TOOL_SCHEMAS.find((t) => t.name === 'check_availability')!;
    assert.match(availability.description, /never invent availability/i);
    const booking = TOOL_SCHEMAS.find((t) => t.name === 'book_appointment')!;
    assert.match(booking.description, /only.*after.*confirmed/i);
  });
});

describe('Arguments from the model are untrusted input', () => {
  test('a booking in the past is rejected with something the agent can act on', () => {
    const v = validateToolRequest(
      { id: '1', name: 'book_appointment', input: { start: '2020-01-01T10:00:00Z', durationMinutes: 60, title: 'Consult' } },
      session(), NOW,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /in the past/i);
    assert.match(v.reason!, /offer a time in the future/i, 'must tell the agent what to do next');
  });

  test('an absurd lead time is rejected', () => {
    const v = validateToolRequest(
      { id: '1', name: 'book_appointment', input: { start: '2031-01-01T10:00:00Z', durationMinutes: 60, title: 'X' } },
      session(), NOW,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /more than \d+ days/i);
  });

  test('a hallucinated email address is caught before it reaches a calendar invite', () => {
    const v = validateToolRequest(
      { id: '1', name: 'book_appointment', input: { start: '2026-09-03T14:00:00Z', durationMinutes: 60, title: 'X', attendeeEmail: 'tony at gmail' } },
      session(), NOW,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /email/i);
  });

  test('an absurd appointment length is rejected', () => {
    const v = validateToolRequest(
      { id: '1', name: 'book_appointment', input: { start: '2026-09-03T14:00:00Z', durationMinutes: 100000, title: 'X' } },
      session(), NOW,
    );
    assert.equal(v.ok, false);
  });

  test('a valid booking is normalised, with end derived rather than trusted', () => {
    const v = validateToolRequest(
      { id: '1', name: 'book_appointment', input: { start: '2026-09-03T14:00:00Z', durationMinutes: 45, title: 'Estimate' } },
      session(), NOW,
    );
    assert.equal(v.ok, true);
    assert.equal(v.value!.end, '2026-09-03T14:45:00.000Z');
  });

  test('an availability window in the past is clamped, not rejected', () => {
    // The caller asked a perfectly reasonable question; a wrong year in
    // the model's arguments is not their problem.
    const v = validateToolRequest(
      { id: '1', name: 'check_availability', input: { from: '2019-01-01T00:00:00Z', to: '2026-09-10T00:00:00Z', durationMinutes: 60 } },
      session(), NOW,
    );
    assert.equal(v.ok, true);
    assert.equal(v.value!.from, NOW.toISOString());
  });

  test('the agent cannot be talked into texting an arbitrary number', () => {
    // Otherwise the public demo line is a free SMS relay.
    const v = validateToolRequest(
      { id: '1', name: 'send_sms', input: { to: '+15558675309', body: 'hello' } },
      session({ from: '+19045550142' }), NOW,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /only text the number/i);
  });

  test('texting the caller back is allowed', () => {
    const v = validateToolRequest(
      { id: '1', name: 'send_sms', input: { to: '+19045550142', body: 'Confirmed for Thursday at 2.' } },
      session({ from: '+19045550142' }), NOW,
    );
    assert.equal(v.ok, true);
  });

  test('an unknown tool name is refused', () => {
    const v = validateToolRequest({ id: '1', name: 'delete_everything', input: {} }, session(), NOW);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /unknown tool/i);
  });
});

describe('Execution never throws into the turn loop', () => {
  test('a rejected request comes back as a readable tool result', async () => {
    const s = session();
    const out = await executeToolRequest(
      { id: 'x', name: 'book_appointment', input: { start: 'not-a-date', durationMinutes: 30, title: 'X' } },
      { tools: mockTools(), log: silent, session: s, now: () => NOW },
    );
    assert.equal(out.ok, false);
    assert.ok(out.rejected, 'marked as a validation rejection, not an execution failure');
    assert.equal(s.toolCalls.length, 0, 'a rejected request never counts as a tool call');
  });

  test('an adapter that throws is turned into guidance, not an exception', async () => {
    const broken = mockTools();
    broken.calendar = {
      async checkAvailability() { throw new Error('google is down'); },
      async bookAppointment() { throw new Error('google is down'); },
    };
    const s = session();
    const out = await executeToolRequest(
      { id: 'x', name: 'check_availability', input: { from: NOW.toISOString(), to: '2026-09-08T00:00:00Z', durationMinutes: 60 } },
      { tools: broken, log: silent, session: s, now: () => NOW },
    );
    assert.equal(out.ok, false);
    // The caller must never learn that a system failed.
    assert.doesNotMatch(out.content, /google|error|exception|500/i);
    assert.match(out.content, /do not mention a system problem/i);
    assert.equal(s.toolCalls[0].ok, false, 'the failure is still recorded');
  });

  test('availability returns at most three slots', async () => {
    // More than three is unusable on a phone call.
    const out = await executeToolRequest(
      { id: 'x', name: 'check_availability', input: { from: NOW.toISOString(), to: '2026-09-30T00:00:00Z', durationMinutes: 60 } },
      { tools: mockTools(), log: silent, session: session(), now: () => NOW },
    );
    assert.equal(out.ok, true);
    const parsed = JSON.parse(out.content) as { available: unknown[] };
    assert.ok(parsed.available.length <= 3, `offered ${parsed.available.length} slots`);
  });

  test('a transfer with no number configured degrades to a call-back promise', async () => {
    const noNumber = mockTools();
    noNumber.transfer = createTransferTool('');
    const out = await executeToolRequest(
      { id: 'x', name: 'transfer_to_human', input: { reason: 'caller asked for a person' } },
      { tools: noNumber, log: silent, session: session(), now: () => NOW },
    );
    assert.equal(out.ok, true, 'a deployment gap is not a call failure');
    assert.match(out.content, /call back/i);
  });
});

describe('The turn loop runs tools and then speaks', () => {
  test('Claude requests, the application executes, Claude speaks the result', async () => {
    const sessions = new SessionStore();
    const claude = createScriptedClaudeClient([
      {
        toolUses: [{
          id: 'tu_1', name: 'check_availability',
          input: { from: NOW.toISOString(), to: '2026-09-08T00:00:00Z', durationMinutes: 60 },
        }],
      },
      { text: 'I can do Wednesday at nine or Thursday at one. Which works?' },
    ]);
    const events: { event: LogEvent; data: Record<string, unknown> }[] = [];
    const log = createLogger({}, (line) => {
      const p = JSON.parse(line);
      events.push({ event: p.event, data: p });
    });

    const orch = new Orchestrator({ sessions, claude, log, tools: mockTools() });
    await orch.handleCallerUtterance('CA_tool', 'My roof is leaking after the storm.');
    const reply = await orch.handleCallerUtterance('CA_tool', 'Can someone come out this week?');

    assert.match(reply, /Wednesday at nine|Thursday at one/);
    const s = sessions.get('CA_tool')!;
    assert.ok(s.toolCalls.some((t) => t.name === 'check_availability' && t.ok));
    assert.ok(events.some((e) => e.event === 'tool.requested'));
    assert.ok(events.some((e) => e.event === 'tool.completed'));
  });

  test('token usage is recorded per request and accumulated', async () => {
    const sessions = new SessionStore();
    const claude = createScriptedClaudeClient([
      { text: 'Understood.', usage: { inputTokens: 1200, outputTokens: 40 } },
    ]);
    const seen: Record<string, unknown>[] = [];
    const log = createLogger({}, (line) => seen.push(JSON.parse(line)));

    const orch = new Orchestrator({ sessions, claude, log, tools: mockTools() });
    await orch.handleCallerUtterance('CA_use', 'My roof is leaking after the storm.');
    await orch.handleCallerUtterance('CA_use', 'Yes please.');

    const usageEvents = seen.filter((e) => e.event === 'llm.usage');
    assert.ok(usageEvents.length > 0, 'usage must be logged');
    assert.equal(usageEvents[0].inputTokens, 1200);
    assert.ok(orch.usage.inputTokens >= 1200, 'totals accumulate across the process');
    assert.ok(orch.usage.requests >= 1);
  });

  test('a model that only ever asks for tools cannot loop forever', async () => {
    // Every round is another second of silence on a live call.
    const sessions = new SessionStore();
    const claude = createScriptedClaudeClient([
      { toolUses: [{ id: 'a', name: 'check_availability', input: { from: NOW.toISOString(), to: '2026-09-08T00:00:00Z', durationMinutes: 60 } }] },
      { toolUses: [{ id: 'b', name: 'check_availability', input: { from: NOW.toISOString(), to: '2026-09-08T00:00:00Z', durationMinutes: 60 } }] },
      { toolUses: [{ id: 'c', name: 'check_availability', input: { from: NOW.toISOString(), to: '2026-09-08T00:00:00Z', durationMinutes: 60 } }] },
      { toolUses: [{ id: 'd', name: 'check_availability', input: { from: NOW.toISOString(), to: '2026-09-08T00:00:00Z', durationMinutes: 60 } }] },
    ]);
    const orch = new Orchestrator({ sessions, claude, log: silent, tools: mockTools(), maxToolRounds: 2 });
    await orch.handleCallerUtterance('CA_loop', 'My roof is leaking after the storm.');
    const reply = await orch.handleCallerUtterance('CA_loop', 'This week?');

    assert.ok(reply.length > 0, 'the caller still hears something');
    assert.ok(claude.calls.length <= 6, `made ${claude.calls.length} model calls; the budget must bound it`);
  });
});

describe('End-of-call summary', () => {
  function completed(): Session {
    const store = new SessionStore();
    const s = store.ensure('CA_sum');
    s.from = '+19045550142';
    s.startedAt = NOW.toISOString();
    store.setRoute('CA_sum', {
      industry: 'roofing', specialty: 'storm', intent: 'storm_damage',
      urgency: 'high', confidence: 0.93, source: 'heuristic',
    });
    store.addTurn('CA_sum', 'caller', 'My roof is leaking after the storm.');
    store.addTurn('CA_sum', 'agent', 'Where is the leak coming through?');
    Object.assign(s.contact, { firstName: 'Tony', phone: '+19045550142' });
    s.qualification.roofAge = '22 years';
    s.toolCalls.push({ name: 'book_appointment', ok: true, at: NOW.toISOString() });
    s.endedAt = new Date(NOW.getTime() + 185_000).toISOString();
    return s;
  }

  test('reads like something a human would want to see', () => {
    const sum = buildCallSummary(completed(), ['firstName', 'phone', 'email', 'roofAge'], NOW);
    assert.equal(sum.industry, 'roofing');
    assert.equal(sum.appointmentBooked, true);
    assert.equal(sum.durationSeconds, 185);
    assert.deepEqual(sum.missingFields, ['email'], 'says what was NOT captured');
    assert.match(sum.headline, /Tony/);
    assert.match(sum.headline, /appointment booked/);
  });

  test('flags an emergency in the headline', () => {
    const s = completed();
    s.route.urgency = 'emergency';
    assert.match(buildCallSummary(s, [], NOW).headline, /\[EMERGENCY\]/);
  });

  test('is produced even when nothing was captured', () => {
    // This is exactly the call you most want a record of.
    const s = new SessionStore().ensure('CA_empty');
    const sum = buildCallSummary(s, [], NOW);
    assert.match(sum.headline, /Unidentified caller/);
    assert.match(sum.headline, /no contact details captured/);
  });
});

describe('Analytics carry no personal data', () => {
  test('a completed call produces a counting record with nothing identifying in it', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_an');
    s.from = '+19045550142';
    store.setRoute('CA_an', {
      industry: 'attorneys', specialty: 'family_law', intent: 'divorce',
      urgency: 'normal', confidence: 0.86, source: 'heuristic',
    });
    Object.assign(s.contact, { firstName: 'Alice', email: 'alice@example.com', phone: '+19045550142' });
    store.addTurn('CA_an', 'caller', "I'm going through a divorce and my wife is taking the house.");

    const ev = buildDemoAnalytics(s, NOW);
    assert.equal(ev.industry, 'attorneys');
    assert.equal(ev.contactCaptured, true, 'records THAT details were captured');

    const serialised = JSON.stringify(ev);
    for (const key of ANALYTICS_FORBIDDEN_KEYS) {
      assert.doesNotMatch(serialised, new RegExp(`"${key}"`), `analytics leaked "${key}"`);
    }
    // And no values either.
    for (const value of ['Alice', 'alice@example.com', '9045550142', 'divorce and my wife']) {
      assert.ok(!serialised.includes(value), `analytics leaked the value "${value}"`);
    }
  });

  test('records whether routing avoided a model call', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_fp');
    store.setRoute('CA_fp', {
      industry: 'plumbing', specialty: 'emergency', intent: 'active_water_leak',
      urgency: 'emergency', confidence: 0.95, source: 'heuristic',
    });
    assert.equal(buildDemoAnalytics(s, NOW).routedOnFastPath, true);

    store.setRoute('CA_fp', { ...s.route, source: 'llm' });
    assert.equal(buildDemoAnalytics(s, NOW).routedOnFastPath, false);
  });
});

describe('Model configuration is centralised', () => {
  test('routing defaults to a faster, colder model than the specialist', () => {
    // The caller hears silence while routing runs, and the same
    // sentence must not route two different ways on two calls.
    assert.equal(DEFAULT_MODELS.router.temperature, 0);
    assert.ok(DEFAULT_MODELS.router.maxTokens < DEFAULT_MODELS.specialist.maxTokens);
    assert.ok(DEFAULT_MODELS.specialist.temperature > 0, 'a receptionist should not be robotic');
  });

  test('CLAUDE_MODEL sets everything at once', () => {
    const m = resolveModels({ CLAUDE_MODEL: 'claude-opus-5' });
    assert.equal(m.router.model, 'claude-opus-5');
    assert.equal(m.specialist.model, 'claude-opus-5');
    assert.equal(m.summary.model, 'claude-opus-5');
  });

  test('a per-role override beats the blanket setting', () => {
    const m = resolveModels({ CLAUDE_MODEL: 'claude-opus-5', CLAUDE_ROUTER_MODEL: 'claude-haiku-4-5-20251001' });
    assert.equal(m.router.model, 'claude-haiku-4-5-20251001');
    assert.equal(m.specialist.model, 'claude-opus-5');
  });

  test('nonsense in an env var falls back rather than crashing the service', () => {
    const m = resolveModels({ CLAUDE_SPECIALIST_MAX_TOKENS: 'lots' });
    assert.equal(m.specialist.maxTokens, DEFAULT_MODELS.specialist.maxTokens);
  });

  test('an empty env var does not blank out the model name', () => {
    const m = resolveModels({ CLAUDE_MODEL: '   ' });
    assert.equal(m.specialist.model, DEFAULT_MODELS.specialist.model);
  });
});

describe('What the caller said about time beats what the model computed', () => {
  // Tuesday 1 September 2026, 14:00 local.
  const TUE = new Date('2026-09-01T14:00:00');

  test('a named weekday means the next one, never one that has passed', () => {
    const w = resolveWhen('Thursday morning', TUE)!;
    assert.equal(w.interpreted, 'thursday');
    assert.equal(w.from.getDay(), 4);
    assert.ok(w.from > TUE);
    assert.equal(w.to.getHours(), 12, 'morning ends at noon');
  });

  test('the same weekday as today means next week, not four minutes ago', () => {
    const w = resolveWhen('Tuesday', TUE)!;
    assert.equal(w.from.getDate(), 8, 'the following Tuesday');
  });

  test('"next Thursday" skips a week past the coming one', () => {
    const soon = resolveWhen('Thursday', TUE)!;
    const later = resolveWhen('next Thursday', TUE)!;
    assert.ok(later.from > soon.from);
  });

  test('afternoon and evening shift the start of the window', () => {
    assert.equal(resolveWhen('Friday afternoon', TUE)!.from.getHours(), 12);
    assert.equal(resolveWhen('Friday evening', TUE)!.from.getHours(), 16);
  });

  test('a window never starts in the past', () => {
    const w = resolveWhen('today', TUE)!;
    assert.ok(w.from >= TUE);
  });

  test('phrases with no time information return null so the agent asks', () => {
    assert.equal(resolveWhen('I need someone to come out'), null);
    assert.equal(resolveWhen('my roof is leaking'), null);
  });

  test('the spoken phrase overrides a window the model got wrong', () => {
    const v = validateToolRequest(
      {
        id: '1', name: 'check_availability',
        input: {
          // A plausible-looking window with the wrong year.
          from: '2019-09-03T08:00:00Z', to: '2019-09-03T18:00:00Z',
          durationMinutes: 60, spokenWhen: 'Thursday morning',
        },
      },
      session(), TUE,
    );
    assert.equal(v.ok, true);
    assert.equal(new Date(v.value!.from as string).getFullYear(), 2026);
    assert.equal(v.value!.interpreted, 'thursday');
  });

  test('no phrase and no usable window searches the next fortnight rather than failing', () => {
    // Making the caller repeat themselves because the model omitted an
    // argument is the worst available outcome.
    const v = validateToolRequest(
      { id: '1', name: 'check_availability', input: { durationMinutes: 60 } },
      session(), TUE,
    );
    assert.equal(v.ok, true);
    assert.equal(new Date(v.value!.from as string).getTime(), TUE.getTime());
  });

  test('slots come back with wording a person would actually say', async () => {
    const out = await executeToolRequest(
      { id: 'x', name: 'check_availability', input: { durationMinutes: 60, spokenWhen: 'this week' } },
      { tools: mockTools(), log: silent, session: session(), now: () => NOW },
    );
    const parsed = JSON.parse(out.content) as { available: { say: string }[]; note: string };
    for (const slot of parsed.available) {
      assert.match(slot.say, /at \d/, `unspeakable slot: ${slot.say}`);
      assert.doesNotMatch(slot.say, /\d{4}-\d{2}-\d{2}|T\d{2}:|Z$/, 'never read an ISO timestamp aloud');
    }
    assert.match(parsed.note, /do not read ISO timestamps aloud/i);
  });

  test('speakSlot says today and tomorrow rather than a date', () => {
    const t = new Date('2026-09-01T09:00:00');
    assert.match(speakSlot(new Date('2026-09-01T15:00:00').toISOString(), t), /^today at 3 in the afternoon$/);
    assert.match(speakSlot(new Date('2026-09-02T09:00:00').toISOString(), t), /^tomorrow at 9 in the morning$/);
    assert.match(speakSlot(new Date('2026-09-04T13:30:00').toISOString(), t), /^Friday at 1:30 in the afternoon$/);
  });
});
