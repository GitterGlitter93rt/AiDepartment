// Regressions from the first real production call.
//
// Every test here corresponds to something that actually went wrong or
// was actually missing on a live call to a real Twilio number.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { serviceLocalTime, addMinutesLocal, spokenRange, partOfDay, DEFAULT_SERVICE_AREA } from '../src/business/service-area.ts';
import { PLUMBING_DEMO_PRICING, PLUMBING_DEMO_ETA, currentRate, rateBandFor, etaWindow, renderPricing } from '../src/business/pricing.ts';
import { speakAddress, speakZip, speakPhone, speakServiceAddress, renderSpeechGuidance, spellDigits } from '../src/core/speech.ts';
import { route, detectAmbiguity, classifyHeuristic } from '../src/core/router.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { createRecordingClaudeClient, createScriptedClaudeClient } from '../src/claude/client.ts';
import { createLogger } from '../src/logger.ts';
import { validateToolRequest, executeToolRequest } from '../src/core/tool-protocol.ts';
import { conversationRelayTwiml } from '../src/twilio/twiml.ts';
import { loadConfig } from '../src/config.ts';
import { createMockCalendar } from '../src/tools/calendar.ts';
import { createMockSms } from '../src/tools/sms.ts';
import { createTransferTool } from '../src/tools/transfer.ts';
import { createPlaceholderCrm } from '../src/tools/crm.ts';
import { finaliseCall } from '../src/core/finalise.ts';
import type { Toolbox } from '../src/tools/index.ts';

const silent = createLogger({}, () => {});
const tools = (): Toolbox => ({
  calendar: createMockCalendar(), sms: createMockSms(),
  transfer: createTransferTool('+19045550100'), crm: createPlaceholderCrm(),
  modes: { calendar: 'mock', sms: 'mock' },
});

// 11:27 PM on Tuesday 1 September in Florida — the actual time of the
// first production call, expressed as the UTC instant the server sees.
const LATE_NIGHT_UTC = new Date('2026-09-02T03:27:00Z');
const AFTERNOON_UTC = new Date('2026-09-01T18:00:00Z');   // 2:00 PM Tue
const EVENING_UTC = new Date('2026-09-01T23:00:00Z');     // 7:00 PM Tue
const SATURDAY_UTC = new Date('2026-09-05T18:00:00Z');    // 2:00 PM Sat

describe('Service-area time, never the server clock', () => {
  test('the real call: 03:27 UTC is 11:27 PM the previous day in Florida', () => {
    const t = serviceLocalTime(DEFAULT_SERVICE_AREA, LATE_NIGHT_UTC);
    assert.equal(t.hour, 23);
    assert.equal(t.spoken, '11:27 PM');
    assert.equal(t.date, '2026-09-01', 'the local date is the day before the UTC date');
    assert.equal(t.dayName, 'Tuesday');
  });

  test('a different configured timezone gives a different local hour', () => {
    // A future client on the west coast must work without code changes.
    const pacific = serviceLocalTime({ timezone: 'America/Los_Angeles' }, LATE_NIGHT_UTC);
    assert.equal(pacific.hour, 20);
    assert.equal(pacific.date, '2026-09-01');
  });

  test('a state code is never used to derive a timezone', () => {
    // Florida itself spans two zones, so a state code cannot settle it.
    const central = serviceLocalTime({ state: 'FL', timezone: 'America/Chicago' }, LATE_NIGHT_UTC);
    assert.equal(central.hour, 22, 'the configured zone wins, not the state');
  });

  test('a bad timezone falls back to the default, not to UTC', () => {
    // Falling back to UTC would silently quote the daytime rate for a
    // late-night call, which is the bug this module exists to prevent.
    const t = serviceLocalTime({ timezone: 'Not/AZone' }, LATE_NIGHT_UTC);
    assert.equal(t.hour, 23);
  });

  test('daylight saving is handled by the tz database, not by us', () => {
    const summer = serviceLocalTime(DEFAULT_SERVICE_AREA, new Date('2026-07-01T16:00:00Z'));
    const winter = serviceLocalTime(DEFAULT_SERVICE_AREA, new Date('2026-01-01T16:00:00Z'));
    assert.equal(summer.hour, 12, 'EDT');
    assert.equal(winter.hour, 11, 'EST');
  });

  test('ETA arithmetic crosses midnight correctly', () => {
    const later = addMinutesLocal(DEFAULT_SERVICE_AREA, 120, LATE_NIGHT_UTC);
    assert.equal(later.hour, 1);
    assert.equal(later.date, '2026-09-02', 'the date rolls over');
    assert.equal(later.dayName, 'Wednesday');
  });

  test('a spoken range that crosses midnight states both meridiems', () => {
    // "11:50 to 12:10 AM" reads as an hour that does not exist, so both
    // sides have to be stated when the window straddles midnight.
    const crossing = spokenRange(DEFAULT_SERVICE_AREA, 10, 30, new Date('2026-09-02T03:40:00Z'));
    assert.match(crossing, /PM.*AM/, `got "${crossing}"`);

    // A window entirely inside one meridiem states it once.
    assert.equal(spokenRange(DEFAULT_SERVICE_AREA, 20, 50, new Date('2026-09-02T03:40:00Z')), '12:00 to 12:30 AM');
  });

  test('the 11:27 PM call yields the expected arrival window', () => {
    assert.equal(spokenRange(DEFAULT_SERVICE_AREA, 90, 120, LATE_NIGHT_UTC), '12:57 to 1:27 AM');
  });

  test('part of day is used for a natural sign-off', () => {
    assert.equal(partOfDay(serviceLocalTime(DEFAULT_SERVICE_AREA, LATE_NIGHT_UTC)), 'night');
    assert.equal(partOfDay(serviceLocalTime(DEFAULT_SERVICE_AREA, AFTERNOON_UTC)), 'afternoon');
  });
});

describe('Pricing bands follow service-area time', () => {
  const cases: [string, Date, string, string][] = [
    ['2 PM Tuesday', AFTERNOON_UTC, 'standard', '$89'],
    ['7 PM Tuesday', EVENING_UTC, 'after_hours', '$149'],
    ['11:27 PM Tuesday', LATE_NIGHT_UTC, 'late_night', '$249'],
    ['2 PM Saturday', SATURDAY_UTC, 'weekend', '$249'],
  ];
  for (const [label, at, band, fee] of cases) {
    test(`${label} is ${band} at ${fee}`, () => {
      const r = currentRate(PLUMBING_DEMO_PRICING, DEFAULT_SERVICE_AREA, at);
      assert.equal(r.band, band);
      assert.equal(r.rate.fee, fee);
    });
  }

  test('a 2 AM Sunday call is one emergency, not a weekend AND a late night', () => {
    const r = currentRate(PLUMBING_DEMO_PRICING, DEFAULT_SERVICE_AREA, new Date('2026-09-06T06:00:00Z'));
    assert.equal(r.band, 'late_night');
    assert.equal(r.rate.amount, 249);
  });

  test('a configured holiday bills at the emergency rate', () => {
    const withHoliday = { ...PLUMBING_DEMO_PRICING, holidays: ['2026-09-01'] };
    assert.equal(rateBandFor(withHoliday, serviceLocalTime(DEFAULT_SERVICE_AREA, AFTERNOON_UTC)), 'holiday');
  });

  test('late-night emergencies get the longer dispatch window', () => {
    assert.deepEqual(etaWindow(PLUMBING_DEMO_ETA, 'emergency', 'late_night'), { minMinutes: 90, maxMinutes: 120 });
    assert.deepEqual(etaWindow(PLUMBING_DEMO_ETA, 'emergency', 'standard'), { minMinutes: 60, maxMinutes: 90 });
  });

  test('the rendered prompt carries the resolved figures, not a calculation to do', () => {
    // Asking a model to work out which band 11:27 PM falls into is
    // asking for arithmetic on a live call.
    const block = renderPricing(PLUMBING_DEMO_PRICING, PLUMBING_DEMO_ETA, DEFAULT_SERVICE_AREA, 'emergency', LATE_NIGHT_UTC);
    assert.match(block, /11:27 PM/);
    assert.match(block, /\$249/);
    assert.match(block, /12:57 to 1:27 AM/);
    assert.match(block, /credited toward the repair/i);
    assert.match(block, /never estimate one/i);
    assert.match(block, /roughly|approximately/i);
  });

  test('the prompt never authorises a repair price', () => {
    const block = renderPricing(PLUMBING_DEMO_PRICING, PLUMBING_DEMO_ETA, DEFAULT_SERVICE_AREA, 'normal', AFTERNOON_UTC);
    assert.match(block, /You do NOT know repair prices/);
  });

  test('only plumbing has configured pricing; every other trade still refuses', () => {
    const sessions = new SessionStore();
    const claude = createRecordingClaudeClient('Understood.');
    const orch = new Orchestrator({ sessions, claude, log: silent });

    return (async () => {
      await orch.handleCallerUtterance('CA_roof', 'My roof started leaking after the storm.');
      await orch.handleCallerUtterance('CA_roof', 'How much to come out?');
      assert.doesNotMatch(claude.lastSystem(), /PRICING AND TIMING/,
        'roofing has no configured rates and must not be handed any');
    })();
  });
});

describe('Speech normalisation — stored value and spoken value are different', () => {
  test('street abbreviations expand', () => {
    assert.equal(speakAddress('123 Main St'), '123 Main Street');
    assert.equal(speakAddress('412 Oak Rd'), '412 Oak Road');
    assert.equal(speakAddress('9 Palm Ave'), '9 Palm Avenue');
    assert.equal(speakAddress('55 Bay Blvd'), '55 Bay Boulevard');
    assert.equal(speakAddress('7 King Dr'), '7 King Drive');
    assert.equal(speakAddress('2 Quiet Ct'), '2 Quiet Court');
    assert.equal(speakAddress('3 Shady Ln'), '3 Shady Lane');
    assert.equal(speakAddress('80 Palm Pkwy'), '80 Palm Parkway');
    assert.equal(speakAddress('1 Coastal Hwy'), '1 Coastal Highway');
  });

  test('"St" before a name is Saint, not Street', () => {
    assert.equal(speakAddress('88 St James Ct'), '88 Saint James Court');
  });

  test('a place name is left alone', () => {
    // "St Augustine" is where the caller lives, not a street type.
    assert.equal(speakAddress('St Augustine'), 'St Augustine');
  });

  test('unusual proper names are preserved exactly', () => {
    assert.equal(speakAddress('1200 Ponce de Leon Blvd'), '1200 Ponce de Leon Boulevard');
    assert.match(speakAddress('77 Matanzas Ave'), /Matanzas/);
  });

  test('units are spoken naturally', () => {
    assert.equal(speakAddress('4501 N Ocean Dr Apt 12B'), '4501 North Ocean Drive apartment 12B');
    assert.equal(speakAddress('990 Beach Blvd #4B'), '990 Beach Boulevard unit 4 B');
  });

  test('a ZIP is read as digits, not as a number', () => {
    assert.equal(speakZip('32084'), '3 2 0 8 4');
    assert.equal(speakZip('32084-1234'), '3 2 0 8 4, 1 2 3 4');
  });

  test('a phone number is read in American groupings', () => {
    assert.equal(speakPhone('+19045550142'), '9 0 4, 5 5 5, 0 1 4 2');
    assert.equal(speakPhone('904-555-0142'), '9 0 4, 5 5 5, 0 1 4 2');
  });

  test('the full read-back is short, not a postal address', () => {
    const spoken = speakServiceAddress({ address: '123 Main St', city: 'St Augustine', state: 'FL', zip: '32084' });
    assert.match(spoken, /123 Main Street/);
    assert.match(spoken, /3 2 0 8 4/);
    assert.doesNotMatch(spoken, /\bFL\b/, 'the state is not read aloud');
  });

  test('guidance is produced only for values that need it', () => {
    assert.equal(renderSpeechGuidance({}), null);
    const g = renderSpeechGuidance({ address: '123 Main St', zip: '32084', phone: '+19045550142' })!;
    assert.match(g, /123 Main Street/);
    assert.match(g, /3 2 0 8 4/);
    assert.match(g, /stored record is unchanged/i);
  });

  test('normalisation never mutates what is stored', () => {
    const sessions = new SessionStore();
    const s = sessions.ensure('CA_store');
    sessions.mergeContact('CA_store', { address: '123 Main St', zip: '32084' });
    speakAddress(s.contact.address!);
    assert.equal(s.contact.address, '123 Main St', 'the canonical value is untouched');
    assert.equal(s.contact.zip, '32084');
  });

  test('spellDigits ignores punctuation', () => {
    assert.equal(spellDigits('(904) 555-0142'), '9 0 4 5 5 5 0 1 4 2');
  });
});

describe('Ceiling leaks are ambiguous until something settles them', () => {
  test('a bare ceiling leak is not confidently roofing', async () => {
    // The production call routed this to roofing at high confidence and
    // had to reroute mid-conversation.
    for (const u of ['My ceiling is leaking', 'Water is coming through my ceiling', 'There is water dripping through my ceiling']) {
      const d = await route(u, { claude: null, threshold: 0.6 });
      assert.ok(d.confidence < 0.6, `"${u}" claimed ${d.confidence}`);
      assert.ok(d.clarifyingQuestion, 'must ask rather than guess');
      assert.match(d.clarifyingQuestion!, /rain|bathroom|above/i, 'the question must actually discriminate');
    }
  });

  test('rain or storm settles it as roofing', async () => {
    for (const u of ["My roof started leaking after last night's storm.", 'my ceiling is leaking, it started during the rain']) {
      const d = await route(u, { claude: null, threshold: 0.6 });
      assert.equal(d.industry, 'roofing', `"${u}"`);
      assert.ok(d.confidence >= 0.6);
    }
  });

  test('a fixture above settles it as plumbing', async () => {
    for (const u of [
      'The upstairs bathroom pipe is leaking through my downstairs ceiling.',
      'water through the ceiling when the upstairs shower runs',
      'the bathroom above is leaking through the ceiling',
    ]) {
      const d = await route(u, { claude: null, threshold: 0.6 });
      assert.equal(d.industry, 'plumbing', `"${u}"`);
    }
  });

  test('unmistakable cases are untouched', async () => {
    assert.equal((await route('Water is pouring from the pipe under my sink.', { claude: null })).industry, 'plumbing');
    assert.equal((await route("Last night's storm ripped shingles off my roof.", { claude: null })).industry, 'roofing');
  });

  test('the ambiguity detector reports which situation applies', () => {
    assert.equal(detectAmbiguity('my ceiling is leaking')?.id, 'ceiling_water');
    assert.equal(detectAmbiguity('my ceiling is leaking after the storm'), null, 'resolved by rain context');
    assert.equal(detectAmbiguity('my sink is leaking'), null);
  });

  test('an unrelated flooded basement is not swept up as ambiguous', () => {
    // A speculative second ambiguity regressed this; it was removed.
    assert.ok(classifyHeuristic('my basement is flooded').confidence >= 0.6);
  });
});

describe('Ending the call properly', () => {
  function harness(script: Parameters<typeof createScriptedClaudeClient>[0]) {
    const sessions = new SessionStore();
    const claude = createScriptedClaudeClient(script);
    const orch = new Orchestrator({ sessions, claude, log: silent, tools: tools() });
    return { sessions, claude, orch };
  }

  test('an ordinary turn says SPEAK_AND_CONTINUE', async () => {
    const { orch } = harness([{ text: 'Is the water shut off?' }]);
    const r = await orch.handleTurn('CA_c', 'Water is pouring out under my sink.');
    assert.equal(r.action, 'SPEAK_AND_CONTINUE');
  });

  test('end_call produces SPEAK_AND_END with the farewell as the text', async () => {
    // Turn one is answered by the specialist's own opening line, which
    // is returned instantly and costs no model call — so the script
    // starts at turn two.
    const { orch } = harness([
      { text: 'Got it. What is the address?' },
      { toolUses: [{ id: 'e1', name: 'end_call', input: { reason: 'intake complete' } }] },
      { text: "Perfect, you're all set. Thanks for calling, and have a good night." },
    ]);
    await orch.handleTurn('CA_e', 'Water is pouring out under my sink.');
    await orch.handleTurn('CA_e', 'I shut it off.');
    const r = await orch.handleTurn('CA_e', "No, that's everything. Thanks.");

    assert.equal(r.action, 'SPEAK_AND_END');
    assert.match(r.text, /all set|thanks for calling/i, 'the farewell is the spoken text');
    assert.equal(r.endReason, 'intake complete');
  });

  test('the decision is never made by searching the reply for "goodbye"', async () => {
    // "Goodbye for now, but first let me confirm the address" must not
    // hang up, and any keyword rule eventually does.
    const { orch } = harness([
      { text: 'Goodbye for now — but first, can I confirm the address?' },
    ]);
    await orch.handleTurn('CA_g', 'Water is pouring out under my sink.');
    const r = await orch.handleTurn('CA_g', 'Yes.');
    assert.equal(r.action, 'SPEAK_AND_CONTINUE');
  });

  test('a mid-call "thanks" does not end the call', async () => {
    const { orch, sessions } = harness([{ text: 'Good. What is the address?' }]);
    await orch.handleTurn('CA_t', 'Water is pouring out under my sink.');
    const r = await orch.handleTurn('CA_t', 'Thanks, that helps. I shut it off.');
    assert.equal(r.action, 'SPEAK_AND_CONTINUE');
    assert.equal(sessions.get('CA_t')!.pendingEnd, undefined);
  });

  test('end_call is refused on the opening turn', () => {
    const sessions = new SessionStore();
    const s = sessions.ensure('CA_early');
    const v = validateToolRequest({ id: '1', name: 'end_call', input: { reason: 'done' } }, s);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /barely started/i);
  });

  test('the tool records the intent rather than cutting the line itself', async () => {
    const sessions = new SessionStore();
    const s = sessions.ensure('CA_pend');
    for (let i = 0; i < 4; i += 1) sessions.addTurn('CA_pend', i % 2 ? 'agent' : 'caller', 'x');
    const out = await executeToolRequest(
      { id: '1', name: 'end_call', input: { reason: 'intake complete' } },
      { tools: tools(), log: silent, session: s },
    );
    assert.equal(out.ok, true);
    assert.equal(s.pendingEnd?.reason, 'intake complete');
    assert.match(out.content, /say your farewell now/i, 'the agent speaks before the line closes');
  });
});

describe('The caller phone number comes from Twilio', () => {
  test('the From number becomes the default callback number', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_from', '+19045550142', '+19045550100');
    const orch = new Orchestrator({ sessions, claude: null, log: silent });
    await orch.handleCallerUtterance('CA_from', 'Water is pouring out under my sink.');
    assert.equal(sessions.get('CA_from')!.contact.phone, '+19045550142');
  });

  test('a number the caller gives replaces the caller ID', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_diff', '+19045550142', '+19045550100');
    const orch = new Orchestrator({ sessions, claude: null, log: silent });
    await orch.handleCallerUtterance('CA_diff', 'Water is pouring out under my sink.');
    await orch.handleCallerUtterance('CA_diff', 'Actually call me on 904-555-5678 instead.');
    assert.equal(sessions.get('CA_diff')!.contact.phone, '+19045555678');
  });

  test('an unusable From value is not stored', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_anon', 'unknown', '+19045550100');
    const orch = new Orchestrator({ sessions, claude: null, log: silent });
    await orch.handleCallerUtterance('CA_anon', 'Water is pouring out under my sink.');
    assert.equal(sessions.get('CA_anon')!.contact.phone, undefined);
  });
});

describe('State survives and answers the caller', () => {
  test('address, ZIP and name persist and are put in front of the model', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_state', '+19045550142', '+19045550100');
    const claude = createRecordingClaudeClient('Understood.');
    const orch = new Orchestrator({ sessions, claude, log: silent });

    await orch.handleCallerUtterance('CA_state', 'Water is pouring out under my kitchen sink.');
    sessions.mergeContact('CA_state', { firstName: 'Michael', address: '412 Oak St', zip: '32084' });
    sessions.mergeQualification('CA_state', { waterShutOff: true, problemLocation: 'kitchen sink' });
    await orch.handleCallerUtterance('CA_state', 'Do you have my ZIP code?');

    const system = claude.lastSystem();
    assert.match(system, /Contact details on file:/);
    assert.match(system, /zip: 32084/);
    assert.match(system, /address: 412 Oak St/);
    assert.match(system, /waterShutOff: true/);
    assert.match(system, /do you have my ZIP/i, 'the model is told to answer from the record');
    // And it is told how to say it.
    assert.match(system, /3 2 0 8 4/);
    assert.match(system, /412 Oak Street/);
  });

  test('a corrected ZIP replaces the old one', () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_fix');
    sessions.mergeContact('CA_fix', { zip: '32084' });
    sessions.mergeContact('CA_fix', { zip: '32086' });
    assert.equal(sessions.get('CA_fix')!.contact.zip, '32086');
  });

  test('capture_details writes plumbing qualification answers', async () => {
    const s = new SessionStore().ensure('CA_q');
    await executeToolRequest(
      {
        id: '1', name: 'capture_details',
        input: {
          firstName: 'Michael', address: '412 Oak St', zip: '32084',
          notes: { waterShutOff: true, activeLeak: false, problemLocation: 'kitchen sink', propertyType: 'residential', timing: 'tonight' },
        },
      },
      { tools: tools(), log: silent, session: s },
    );
    assert.equal(s.contact.zip, '32084');
    assert.equal(s.qualification.waterShutOff, true);
    assert.equal(s.qualification.problemLocation, 'kitchen sink');
    assert.equal(s.qualification.timing, 'tonight');
  });

  test('a plumbing dispatch requires name, address, ZIP and phone', async () => {
    const { REGISTRY } = await import('../src/industries/index.ts');
    const plumbing = REGISTRY.plumbing[0];
    assert.deepEqual(plumbing.bookingRules.prerequisites, ['firstName', 'address', 'zip', 'phone']);
  });
});

describe('Production configuration is unchanged by this patch', () => {
  test('the Google TTS voice and language defaults are exactly what production runs', () => {
    const cfg = loadConfig({});
    assert.equal(cfg.ttsVoice, 'en-US-Journey-O');
    assert.equal(cfg.ttsLanguage, 'en-US');
  });

  test('the TwiML still names Google transcription and the same voice', () => {
    const xml = conversationRelayTwiml({
      relayUrl: 'wss://voice.youraidepartment.ai/twilio/conversation',
      welcomeGreeting: 'Thanks for calling.',
    });
    assert.match(xml, /voice="en-US-Journey-O"/);
    assert.match(xml, /language="en-US"/);
    assert.match(xml, /transcriptionProvider="google"/);
    assert.match(xml, /interruptible="true"/);
  });

  test('the voice is overridable without changing the default', () => {
    const cfg = loadConfig({ TWILIO_TTS_VOICE: 'en-US-Neural2-F', TWILIO_TTS_LANGUAGE: 'en-GB' });
    assert.equal(cfg.ttsVoice, 'en-US-Neural2-F');
    assert.equal(cfg.ttsLanguage, 'en-GB');
  });

  test('the service area defaults to the Florida demo and is overridable', () => {
    assert.equal(loadConfig({}).serviceAreaTimezone, 'America/New_York');
    assert.equal(loadConfig({ SERVICE_AREA_TIMEZONE: 'America/Denver' }).serviceAreaTimezone, 'America/Denver');
  });

  test('the three production endpoints are unchanged', async () => {
    const { PATHS } = await import('../src/http/paths.ts');
    assert.equal(PATHS.incoming, '/twilio/incoming');
    assert.equal(PATHS.status, '/twilio/status');
    assert.equal(PATHS.relay, '/twilio/conversation');
    assert.equal(PATHS.health, '/health');
  });
});

describe('A call is finalised exactly once', () => {
  // The first production call ended twice — socket-closed AND completed
  // — so the CRM ran twice for one conversation.
  function harness() {
    const sessions = new SessionStore();
    const pushes: string[] = [];
    const events: Record<string, unknown>[] = [];
    const log = createLogger({}, (l) => events.push(JSON.parse(l)));
    const crm = {
      async pushLead(s: { callSid: string }) {
        pushes.push(s.callSid);
        return { ok: true, id: `crm-${pushes.length}`, mocked: true };
      },
    };
    return { sessions, pushes, events, log, crm };
  }

  const ended = (events: Record<string, unknown>[]): Record<string, unknown>[] =>
    events.filter((e) => e.event === 'call.ended');

  test('socket close then completed webhook pushes the CRM once', async () => {
    const { sessions, pushes, events, log, crm } = harness();
    sessions.ensure('CA_1', '+19045550142', '+19045550100');

    await finaliseCall('CA_1', 'socket-closed', { sessions, crm, log });
    await finaliseCall('CA_1', 'completed', { sessions, crm, log });

    assert.deepEqual(pushes, ['CA_1'], 'exactly one CRM push');
    assert.equal(ended(events).length, 2, 'both arrivals are logged');
    assert.equal(ended(events).filter((e) => e.duplicate === true).length, 1, 'the second is marked a duplicate');
    // The analytics payload carries its own `event` name, so the two
    // records show up as call.summary and demo_call_completed.
    assert.equal(events.filter((e) => e.event === 'call.summary').length, 1, 'one human-readable summary');
    assert.equal(events.filter((e) => e.event === 'demo_call_completed').length, 1, 'one anonymous analytics record');
  });

  test('completed webhook then socket close is equally idempotent', async () => {
    const { sessions, pushes, log, crm } = harness();
    sessions.ensure('CA_2', '+19045550142', '+19045550100');

    await finaliseCall('CA_2', 'completed', { sessions, crm, log });
    await finaliseCall('CA_2', 'socket-closed', { sessions, crm, log });

    assert.deepEqual(pushes, ['CA_2']);
  });

  test('an agent-ended call is not finalised again by the webhook', async () => {
    const { sessions, pushes, log, crm } = harness();
    sessions.ensure('CA_3', '+19045550142', '+19045550100');

    await finaliseCall('CA_3', 'agent-ended', { sessions, crm, log });
    await finaliseCall('CA_3', 'socket-closed', { sessions, crm, log });
    await finaliseCall('CA_3', 'completed', { sessions, crm, log });

    assert.deepEqual(pushes, ['CA_3'], 'three arrivals, one push');
  });

  test('two callbacks arriving together still finalise once', async () => {
    // The flag is claimed before the first await, so concurrent
    // arrivals cannot both pass the check.
    const { sessions, pushes, log, crm } = harness();
    sessions.ensure('CA_4', '+19045550142', '+19045550100');

    await Promise.all([
      finaliseCall('CA_4', 'socket-closed', { sessions, crm, log }),
      finaliseCall('CA_4', 'completed', { sessions, crm, log }),
    ]);

    assert.deepEqual(pushes, ['CA_4']);
  });

  test('the first call reports whether it ran; the second reports why not', async () => {
    const { sessions, log, crm } = harness();
    sessions.ensure('CA_5', '+19045550142', '+19045550100');

    assert.deepEqual(await finaliseCall('CA_5', 'completed', { sessions, crm, log }), { ran: true, reason: 'completed' });
    assert.equal((await finaliseCall('CA_5', 'socket-closed', { sessions, crm, log })).ran, false);
  });

  test('a callback for a call we never saw does nothing at all', async () => {
    const { sessions, pushes, events, log, crm } = harness();
    const r = await finaliseCall('CA_unknown', 'completed', { sessions, crm, log });
    assert.equal(r.ran, false);
    assert.deepEqual(pushes, []);
    assert.deepEqual(events, []);
  });

  test('a CRM failure still produces the record, and still only once', async () => {
    const { sessions, events, log } = harness();
    sessions.ensure('CA_6', '+19045550142', '+19045550100');
    let attempts = 0;
    const brokenCrm = { async pushLead() { attempts += 1; throw new Error('crm 503'); } };

    await finaliseCall('CA_6', 'completed', { sessions, crm: brokenCrm, log });
    await finaliseCall('CA_6', 'socket-closed', { sessions, crm: brokenCrm, log });

    assert.equal(attempts, 1);
    assert.ok(ended(events).some((e) => typeof e.headline === 'string'), 'the summary survives a broken CRM');
  });

  test('separate calls are unaffected by each other', async () => {
    const { sessions, pushes, log, crm } = harness();
    sessions.ensure('CA_a', '+19045550142', '+19045550100');
    sessions.ensure('CA_b', '+19045550143', '+19045550100');

    await finaliseCall('CA_a', 'completed', { sessions, crm, log });
    await finaliseCall('CA_b', 'completed', { sessions, crm, log });
    await finaliseCall('CA_a', 'socket-closed', { sessions, crm, log });

    assert.deepEqual(pushes, ['CA_a', 'CA_b']);
  });
});
