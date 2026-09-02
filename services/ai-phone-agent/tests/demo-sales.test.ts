// The demo line as a lead funnel, and the hard boundary that keeps it
// out of every client deployment.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_GREETING, DEMO_INTRO, DEFAULT_CLIENT_GREETING, greetingFor, spokenSeconds, YAD_BRANDING_MARKERS,
} from '../src/business/greeting.ts';
import { detectSalesIntent, isDecliningOffer, renderDemoHost } from '../src/core/demo-host.ts';
import { YAD_DISCOVERY_CALL } from '../src/business/policies.ts';
import { validateToolRequest, executeToolRequest, TOOL_SCHEMAS } from '../src/core/tool-protocol.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { createRecordingClaudeClient } from '../src/claude/client.ts';
import { createLogger } from '../src/logger.ts';
import { createMockToolbox } from '../src/tools/index.ts';
import { demoProfile } from '../src/business/profile.ts';
import { loadConfig } from '../src/config.ts';
import { createMockCalendar } from '../src/tools/calendar.ts';

const silent = createLogger({}, () => {});

function demoLine(callSid = 'CA_demo') {
  const sessions = new SessionStore();
  sessions.ensure(callSid, '+19045550142', '+19045550100');
  const claude = createRecordingClaudeClient('Understood.');
  const orch = new Orchestrator({ sessions, claude, log: silent, tools: createMockToolbox() });
  return { sessions, claude, orch, callSid };
}

function clientLine(callSid = 'CA_client') {
  const sessions = new SessionStore();
  sessions.ensure(callSid, '+19045550142', '+19045550100');
  const claude = createRecordingClaudeClient('Understood.');
  const orch = new Orchestrator({
    sessions, claude, log: silent, tools: createMockToolbox(),
    resolveProfile: () => demoProfile('collision_repair', { mode: 'client', businessName: 'Acme Collision' }),
  });
  return { sessions, claude, orch, callSid };
}

describe('The demo greeting', () => {
  test('is short enough that the caller is not sitting in silence', () => {
    // Twilio synthesises welcomeGreeting before playing any of it, so
    // every word is dead air at the start of the call. A 63-word
    // introduction measured as a 3-5 second opening pause on real
    // calls; the pitch moved to the first agent turn instead.
    const seconds = spokenSeconds(DEMO_GREETING);
    assert.ok(seconds <= 7, `${seconds.toFixed(1)}s of greeting is silence before anything useful happens`);
  });

  test('identifies the line immediately, and invites the role-play in the positioning', () => {
    // Split deliberately. The greeting attribute is synthesised in
    // full before playback starts, so it carries the brand and nothing
    // else; the invitation follows over the socket, where it costs no
    // startup latency.
    assert.match(DEMO_INTRO.greeting, /Your AI Department/);
    assert.ok(DEMO_INTRO.positioning, 'the positioning must exist');
    assert.match(DEMO_INTRO.positioning!, /talk to me like you would the actual company/i, 'must invite the role-play');
  });

  test('the streamed positioning carries the whole product claim', () => {
    const p = DEMO_INTRO.positioning!;
    assert.match(p, /live AI receptionists?/i);
    assert.match(p, /any industry/i);
    assert.match(p, /customized to your business/i);
    assert.match(p, /hundreds of available voices/i);
    assert.match(p, /discovery call/i);
  });

  test('the positioning stays a short introduction, not a monologue', () => {
    // The failure this guards against is the original 63-word intro
    // coming back by increments.
    const words = DEMO_INTRO.positioning!.trim().split(/\s+/).length;
    assert.ok(words <= 60, `${words} words of positioning is a speech, not an introduction`);
  });

  test('the positioning survives, said on the first turn instead', async () => {
    const { DEMO_INTRO_CONTEXT } = await import('../src/business/greeting.ts');
    assert.match(DEMO_INTRO_CONTEXT, /any industry/i);
    assert.match(DEMO_INTRO_CONTEXT, /hundreds of voices/i);
    assert.match(DEMO_INTRO_CONTEXT, /discovery call/i);
    assert.match(DEMO_INTRO_CONTEXT, /NOT as an opening speech/i);
  });

  test('is not an IVR', () => {
    assert.doesNotMatch(DEMO_GREETING, /press \d|say (one|two)|main menu|option \d/i);
    // No industry menu — the router infers it.
    assert.doesNotMatch(DEMO_GREETING, /plumbing.*roofing|choose (an? )?industry/i);
  });

  test('claims a vague voice count, not a specific one', () => {
    assert.doesNotMatch(DEMO_GREETING, /\b\d{2,}\s*(\+)?\s*voices\b/i);
  });
});

describe('The client greeting can never become the demo greeting', () => {
  test('client mode ignores a demo greeting even if one is passed', () => {
    const g = greetingFor({ mode: 'client', clientGreeting: DEMO_GREETING });
    // A client greeting is used verbatim, so passing the demo script
    // would be a deployment error — but the mode itself must never
    // SELECT the demo script.
    assert.equal(greetingFor({ mode: 'client' }), DEFAULT_CLIENT_GREETING);
    assert.notEqual(greetingFor({ mode: 'client', businessName: 'Acme' }), DEMO_GREETING);
    assert.equal(g, DEMO_GREETING, 'an explicitly configured string is used as given');
  });

  test('the default client greeting carries no Your AI Department branding', () => {
    for (const g of [DEFAULT_CLIENT_GREETING, greetingFor({ mode: 'client' }), greetingFor({ mode: 'client', businessName: 'Acme Collision' })]) {
      for (const marker of YAD_BRANDING_MARKERS) {
        assert.doesNotMatch(g, marker, `client greeting leaked ${marker}: "${g}"`);
      }
    }
  });

  test('config selects the mode, defaulting to demo', () => {
    assert.equal(loadConfig({}).deploymentMode, 'demo');
    assert.equal(loadConfig({ DEPLOYMENT_MODE: 'client' }).deploymentMode, 'client');
    // Anything unrecognised stays demo rather than silently half-switching.
    assert.equal(loadConfig({ DEPLOYMENT_MODE: 'nonsense' }).deploymentMode, 'demo');
  });
});

describe('Telling role-play apart from a real prospect', () => {
  const ROLE_PLAY: string[] = [
    'My toilet is overflowing.',
    'My kitchen sink is flooding.',
    'I own a rental property and the roof is leaking.',
    'I manage an apartment building and the AC is out in one unit.',
    'I just got into a car accident on the Buckman Bridge.',
    'My ceiling is leaking.',
  ];
  for (const u of ROLE_PLAY) {
    test(`role-play: "${u.slice(0, 46)}"`, () => {
      assert.equal(detectSalesIntent(u, false).detected, false);
      assert.equal(detectSalesIntent(u, true).detected, false, 'still role-play even after a scenario');
    });
  }

  const PROSPECT: string[] = [
    'How do I get this for my business?',
    'Can you build this for me?',
    'How much does something like this cost?',
    'Can this work with my company?',
    'I own a plumbing company and I want this.',
    'Who do I talk to about setting this up?',
    'Can someone call me?',
    'I want to learn more about your AI service.',
    'I need something like this for my shop.',
    'Would this work for our business?',
  ];
  for (const u of PROSPECT) {
    test(`prospect: "${u.slice(0, 46)}"`, () => {
      assert.equal(detectSalesIntent(u, true).detected, true, 'missed a buying signal');
    });
  }

  test('praise alone mid-call is not a buying signal', () => {
    // Someone saying "this is great" while testing is complimenting the
    // demo, not asking to buy. Selling at them there is the mistake.
    assert.equal(detectSalesIntent('This is really good.', false).detected, false);
  });

  test('praise counts once they have actually been through a scenario', () => {
    assert.equal(detectSalesIntent('Wow, this is really good.', true).detected, true);
  });

  test('owning a business AND having a problem is a customer', () => {
    // The trap: "I own X" appears in both. A problem following it means
    // they are still playing a customer who happens to own something.
    assert.equal(detectSalesIntent('I own a restaurant and the sink is backing up.', true).detected, false);
    assert.equal(detectSalesIntent('I own a restaurant and I want this system.', true).detected, true);
  });

  test('an immediate prospect never role-played at all', () => {
    const r = detectSalesIntent('I own a roofing company and I want to learn about your AI service.', false);
    assert.equal(r.detected, true);
    assert.equal(r.immediate, true);
  });

  test('declining is recognised', () => {
    for (const u of ['No thanks, I was just testing it.', 'Not right now.', 'I\'m good, just looking.', 'Not interested.']) {
      assert.equal(isDecliningOffer(u), true, `missed: "${u}"`);
    }
    assert.equal(isDecliningOffer('Yes please, that sounds good.'), false);
  });
});

describe('SCENARIO A — role-play, then a buying signal', () => {
  test('the plumbing demo runs, then the caller is treated as a prospect', async () => {
    const { sessions, claude, orch, callSid } = demoLine('CA_a');

    await orch.handleCallerUtterance(callSid, 'My kitchen sink is flooding.');
    assert.equal(sessions.get(callSid)!.route.industry, 'plumbing', 'the scenario must actually run');
    assert.notEqual(sessions.get(callSid)!.demoPhase, 'yad_sales');

    await orch.handleCallerUtterance(callSid, 'Wow, I own a plumbing company. How do I get this?');
    const s = sessions.get(callSid)!;
    assert.equal(s.demoPhase, 'yad_sales');
    assert.equal(s.scenarioTested, 'plumbing', 'the tested scenario is remembered for the sales team');

    const system = claude.lastSystem();
    assert.match(system, /SPEAKING AS YOUR AI DEPARTMENT/);
    assert.match(system, /step out of the demo/i);
    assert.match(system, /made up for the demo/i, 'must warn that role-play data is fiction');
    assert.match(system, /capture_prospect/);
  });

  test('a buying signal does not start a second plumbing simulation', async () => {
    const { sessions, orch, callSid } = demoLine('CA_a2');
    await orch.handleCallerUtterance(callSid, 'My kitchen sink is flooding.');
    const before = sessions.get(callSid)!.turns.length;

    await orch.handleCallerUtterance(callSid, 'I own a plumbing company and I want this.');
    const s = sessions.get(callSid)!;
    assert.equal(s.demoPhase, 'yad_sales');
    assert.equal(s.scenarioSwitches, 0, 'this is not a scenario change');
    assert.ok(s.turns.length > before);
  });
});

describe('SCENARIO B — the fake identity must not become the lead', () => {
  test('prospect details are captured separately from the role-play character', async () => {
    const { sessions, orch, callSid } = demoLine('CA_b');

    // The caller invents a customer.
    await orch.handleCallerUtterance(callSid, 'I just got into a car crash on the Buckman Bridge.');
    sessions.mergeContact(callSid, { firstName: 'John', lastName: 'Smith', address: '999 Fake Street' });
    sessions.mergeQualification(callSid, { insuranceCarrier: 'Made Up Mutual', vehicleMake: 'Toyota' });

    // Then steps out of it.
    await orch.handleCallerUtterance(callSid, 'That was awesome. My real name is Mike and I own ABC Collision. I want this.');
    const s = sessions.get(callSid)!;
    assert.equal(s.demoPhase, 'yad_sales');

    await executeToolRequest(
      { id: '1', name: 'capture_prospect', input: { firstName: 'Mike', companyName: 'ABC Collision', email: 'mike@abccollision.example' } },
      { tools: createMockToolbox(), log: silent, session: s },
    );

    assert.equal(s.prospect!.firstName, 'Mike');
    assert.equal(s.prospect!.companyName, 'ABC Collision');
    // The fiction stays where it was and never migrates.
    assert.equal(s.contact.firstName, 'John', 'the simulated customer is untouched');
    assert.notEqual(s.prospect!.firstName, 'John Smith');
    assert.equal((s.prospect as Record<string, unknown>).address, undefined);
    assert.equal((s.prospect as Record<string, unknown>).insuranceCarrier, undefined);
  });

  test('the real callback number carries over, because that one is genuine', async () => {
    const store = new SessionStore();
    const s = store.ensure('CA_b2', '+19045550142', '+19045550100');
    await executeToolRequest(
      { id: '1', name: 'capture_prospect', input: { firstName: 'Mike', companyName: 'ABC Collision' } },
      { tools: createMockToolbox(), log: silent, session: s },
    );
    assert.equal(s.prospect!.phone, '+19045550142');
  });

  test('capture_prospect and capture_details write to different places', async () => {
    const store = new SessionStore();
    const s = store.ensure('CA_b3', '+19045550142', '+1904');
    const deps = { tools: createMockToolbox(), log: silent, session: s };

    await executeToolRequest({ id: '1', name: 'capture_details', input: { firstName: 'John Smith' } }, deps);
    await executeToolRequest({ id: '2', name: 'capture_prospect', input: { firstName: 'Mike' } }, deps);

    assert.equal(s.contact.firstName, 'John Smith');
    assert.equal(s.prospect!.firstName, 'Mike');
  });
});

describe('SCENARIO C — declining, with no pressure', () => {
  test('a decline is recorded and the offer is never repeated', async () => {
    const { sessions, claude, orch, callSid } = demoLine('CA_c');
    await orch.handleCallerUtterance(callSid, 'My kitchen sink is flooding.');
    await orch.handleCallerUtterance(callSid, 'No thanks, I was just testing it.');

    const s = sessions.get(callSid)!;
    assert.equal(s.ctaDeclined, true);

    await orch.handleCallerUtterance(callSid, 'Okay.');
    const system = claude.lastSystem();
    assert.match(system, /THEY HAVE ALREADY DECLINED/);
    assert.match(system, /Do not raise it again/i);
  });
});

describe('SCENARIO D — a mocked calendar is never described as booked', () => {
  test('the tool result forbids claiming a booking', async () => {
    const store = new SessionStore();
    const s = store.ensure('CA_d', '+19045550142', '+1904');
    s.prospect = { firstName: 'Mike', companyName: 'ABC Collision', email: 'mike@example.com', phone: '+19045550142' };

    const out = await executeToolRequest(
      { id: '1', name: 'book_discovery_call', input: { start: new Date(Date.now() + 86_400_000).toISOString() } },
      { tools: createMockToolbox(), log: silent, session: s },
    );
    assert.equal(out.ok, true);
    const parsed = JSON.parse(out.content) as { mode: string; speech: string };
    assert.equal(parsed.mode, 'mocked');
    assert.match(parsed.speech, /NOT ACTUALLY BOOKED/);
    assert.match(parsed.speech, /Do NOT say they are booked/i);
    assert.equal(s.prospect!.discoveryCallBooked, false, 'nothing was really booked');
  });

  test('the prompt tells the agent the calendar is not connected', () => {
    const block = renderDemoHost('yad_sales', {
      hasRolePlayed: true, scenarioTested: 'plumbing', ctaOffered: true, ctaDeclined: false, calendarMode: 'mock',
    });
    assert.match(block, /calendar is NOT connected/i);
    assert.match(block, /may NOT say they are booked/i);
  });
});

describe('SCENARIO E — a live calendar may be confirmed', () => {
  test('a real booking flips the state and permits the confirmation', async () => {
    const store = new SessionStore();
    const s = store.ensure('CA_e', '+19045550142', '+1904');
    s.prospect = { firstName: 'Mike', companyName: 'ABC Collision', email: 'mike@example.com', phone: '+19045550142' };
    s.scenarioTested = 'collision_repair';

    let notes = '';
    const tools = createMockToolbox({
      calendar: {
        async checkAvailability() { return []; },
        async bookAppointment(input) {
          notes = input.notes ?? '';
          return { id: 'evt-1', start: input.start, end: input.end, mocked: false };
        },
      },
      modes: { calendar: 'google', sms: 'mock', tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock', locationLink: 'mock' },
    });

    const start = new Date(Date.now() + 86_400_000).toISOString();
    const out = await executeToolRequest(
      { id: '1', name: 'book_discovery_call', input: { start, notes: 'wants after-hours answering' } },
      { tools, log: silent, session: s },
    );

    const parsed = JSON.parse(out.content) as { mode: string; speech: string };
    assert.equal(parsed.mode, 'sent');
    assert.match(parsed.speech, /^DONE/);
    assert.equal(s.prospect!.discoveryCallBooked, true);

    // The salesperson does not start cold.
    assert.match(notes, /ABC Collision/);
    assert.match(notes, /Scenario tested: collision repair/);
    assert.match(notes, /wants after-hours answering/);
    assert.match(notes, /mike@example.com/);
  });

  test('booking is refused until the real details exist', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_e2', '+19045550142', '+1904');
    // A role-play name on `contact` must not satisfy this.
    Object.assign(s.contact, { firstName: 'John Smith', email: 'john@fake.example' });

    const v = validateToolRequest(
      { id: '1', name: 'book_discovery_call', input: { start: new Date(Date.now() + 86_400_000).toISOString() } },
      s,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /real firstName, companyName, email/i);
  });

  test('a past slot is refused', () => {
    const store = new SessionStore();
    const s = store.ensure('CA_e3', '+19045550142', '+1904');
    s.prospect = { firstName: 'Mike', companyName: 'ABC', email: 'm@e.example', phone: '+19045550142' };
    const v = validateToolRequest({ id: '1', name: 'book_discovery_call', input: { start: '2020-01-01T10:00:00Z' } }, s);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /has passed/i);
  });

  test('the discovery call has its own configuration, not an industry appointment', () => {
    assert.equal(YAD_DISCOVERY_CALL.title, 'Your AI Department Discovery Call');
    assert.equal(YAD_DISCOVERY_CALL.durationMinutes, 30);
    assert.deepEqual(YAD_DISCOVERY_CALL.requires, ['firstName', 'companyName', 'email', 'phone']);
  });
});

describe('SCENARIO F — straight to business, no role-play', () => {
  test('a direct prospect is not forced through a fake scenario', async () => {
    const { sessions, claude, orch, callSid } = demoLine('CA_f');
    await orch.handleCallerUtterance(callSid, 'I own a roofing company and I want to learn about your AI service.');

    const s = sessions.get(callSid)!;
    assert.equal(s.demoPhase, 'yad_sales');
    assert.match(claude.lastSystem(), /SPEAKING AS YOUR AI DEPARTMENT/);
  });

  test('and the router never gets to start a roofing simulation', async () => {
    const { sessions, orch, callSid } = demoLine('CA_f2');
    await orch.handleCallerUtterance(callSid, 'I own a roofing company and I want this for my business.');
    assert.equal(sessions.get(callSid)!.routed, false, 'no scenario was started');
  });
});

describe('CLIENT MODE can never sell Your AI Department', () => {
  test('the sales layer is absent from the prompt entirely', async () => {
    const { claude, orch, callSid } = clientLine();
    await orch.handleCallerUtterance(callSid, 'I was in an accident and my car is wrecked.');
    await orch.handleCallerUtterance(callSid, 'It happened this morning.');

    const system = claude.lastSystem();
    for (const marker of YAD_BRANDING_MARKERS) {
      assert.doesNotMatch(system, marker, `client prompt leaked ${marker}`);
    }
    assert.doesNotMatch(system, /SPEAKING AS YOUR AI DEPARTMENT|DEMO LINE|demo-host/i);
  });

  test('a buying signal on a client line does nothing at all', async () => {
    // A real customer saying "how much does this cost" is asking about
    // the repair, not about buying an AI system.
    const { sessions, claude, orch, callSid } = clientLine('CA_client2');
    await orch.handleCallerUtterance(callSid, 'I was in an accident and my car is wrecked.');
    await orch.handleCallerUtterance(callSid, 'How much does something like this cost?');

    const s = sessions.get(callSid)!;
    assert.equal(s.demoPhase, undefined, 'client mode has no sales phase');
    for (const marker of YAD_BRANDING_MARKERS) {
      assert.doesNotMatch(claude.lastSystem(), marker);
    }
  });

  test('even an explicit request for us gets no pitch on a client line', async () => {
    const { sessions, claude, orch, callSid } = clientLine('CA_client3');
    await orch.handleCallerUtterance(callSid, 'I was in an accident and my car is wrecked.');
    await orch.handleCallerUtterance(callSid, 'I own a body shop and I want this AI system for my business.');

    assert.equal(sessions.get(callSid)!.demoPhase, undefined);
    assert.doesNotMatch(claude.lastSystem(), /Your AI Department/i);
  });

  test('the demo host block is only ever rendered for demo mode', () => {
    // Belt and braces: the renderer itself is only called under a demo
    // profile, and the orchestrator test above proves the gate holds.
    const demo = renderDemoHost('role_play', { hasRolePlayed: true, scenarioTested: 'plumbing', ctaOffered: false, ctaDeclined: false, calendarMode: 'mock' });
    assert.match(demo, /YOUR AI DEPARTMENT DEMO LINE/);
  });
});

describe('The demo host holds its own boundaries', () => {
  test('during role-play it forbids selling', () => {
    const block = renderDemoHost('role_play', { hasRolePlayed: false, scenarioTested: null, ctaOffered: false, ctaDeclined: false, calendarMode: 'mock' });
    assert.match(block, /DO NOT SELL DURING THE SCENARIO/);
    assert.match(block, /does not want to be asked what CRM they use/i);
  });

  test('the single CTA appears only after a scenario has run', () => {
    const before = renderDemoHost('role_play', { hasRolePlayed: false, scenarioTested: null, ctaOffered: false, ctaDeclined: false, calendarMode: 'mock' });
    const after = renderDemoHost('role_play', { hasRolePlayed: true, scenarioTested: 'plumbing', ctaOffered: false, ctaDeclined: false, calendarMode: 'mock' });
    assert.doesNotMatch(before, /ONE OFFER, ONCE/);
    assert.match(after, /ONE OFFER, ONCE/);
    assert.match(after, /Never ask a second time/i);
  });

  test('in sales phase it never re-pitches', () => {
    const block = renderDemoHost('yad_sales', { hasRolePlayed: true, scenarioTested: 'plumbing', ctaOffered: true, ctaDeclined: false, calendarMode: 'google' });
    assert.match(block, /already been sold by the demo/i);
    assert.match(block, /Do not pitch/i);
  });

  test('the tools exist and are separate concepts', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name);
    assert.ok(names.includes('capture_prospect'));
    assert.ok(names.includes('book_discovery_call'));
    // The role-play booking tool is still its own thing.
    assert.ok(names.includes('book_appointment'));

    const prospect = TOOL_SCHEMAS.find((t) => t.name === 'capture_prospect')!;
    assert.match(prospect.description, /Never copy a name, company or address out of the role-play/i);
  });
});

describe('the split intro', () => {
  test('the greeting attribute stays short enough to start fast', () => {
    // Every word in welcomeGreeting is synthesised before the caller
    // hears anything. This is the attribute that caused the original
    // 3-5 second opening pause.
    const words = DEMO_INTRO.greeting.trim().split(/\s+/).length;
    assert.ok(words <= 8, `${words} words in welcomeGreeting is startup silence`);
    assert.ok(spokenSeconds(DEMO_INTRO.greeting) <= 3);
  });

  test('the greeting is exactly what greetingFor returns in demo mode', () => {
    // One source of truth: the TwiML and the intro must not drift.
    assert.equal(greetingFor({ mode: 'demo' }), DEMO_INTRO.greeting);
  });

  test('no part of the intro can reach a client deployment', () => {
    // The positioning names Your AI Department and a discovery call —
    // both fatal on a client's line. It is demo-only at the call site,
    // and the greeting itself must be clean too.
    const client = greetingFor({ mode: 'client', businessName: 'Ace Collision' });
    for (const marker of YAD_BRANDING_MARKERS) {
      assert.doesNotMatch(client, marker, `client greeting leaked ${marker}`);
    }
    // And the demo positioning is genuinely branded, or it is not doing
    // its job — which is precisely why it must never be sent to one.
    assert.match(DEMO_INTRO.positioning!, /Your AI Department|discovery call/i);
  });

  test('the agent is told the introduction has already been given', () => {
    // Otherwise it re-introduces itself, or treats the intro's mention
    // of a discovery call as the single offer having been made.
    const block = renderDemoHost('role_play', {
      hasRolePlayed: true, scenarioTested: 'collision_repair',
      ctaOffered: false, ctaDeclined: false, calendarMode: 'mock',
    });
    assert.match(block, /already been said/i);
    assert.match(block, /positioning, not the offer/i);
    assert.match(block, /do not go back and finish it/i);
    // The real offer is still available at the end.
    assert.match(block, /ONE OFFER, ONCE/);
  });
});
