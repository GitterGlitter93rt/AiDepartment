// Session isolation, contact capture, and the mocked tool layer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/core/session.ts';
import { createMockCalendar } from '../src/tools/calendar.ts';
import { createMockSms, withOptOut } from '../src/tools/sms.ts';
import { createTransferTool } from '../src/tools/transfer.ts';
import { createPlaceholderCrm, toLead } from '../src/tools/crm.ts';
import { createLogger, _internal } from '../src/logger.ts';
import { chunkForSpeech, parseRelayMessage, textResponse } from '../src/twilio/relay.ts';
import { conversationRelayTwiml } from '../src/twilio/twiml.ts';
import { loadConfig } from '../src/config.ts';

describe('Session state', () => {
  test('captured information persists across turns', () => {
    const s = new SessionStore();
    s.create('CA1', '+15550001', '+15559999');
    s.addTurn('CA1', 'caller', "I'm going through a divorce");
    s.setRoute('CA1', { industry: 'attorneys', specialty: 'family_law', intent: 'divorce', urgency: 'normal', confidence: 0.95, source: 'heuristic' });
    s.mergeContact('CA1', { firstName: 'Tony', email: 'tony@example.com' });
    s.mergeQualification('CA1', { minorChildren: true, filingStatus: 'not_filed' });
    s.addTurn('CA1', 'agent', 'Thanks Tony.');

    const session = s.get('CA1')!;
    assert.equal(session.contact.firstName, 'Tony');
    assert.equal(session.contact.email, 'tony@example.com');
    assert.equal(session.qualification.minorChildren, true);
    assert.equal(session.route.industry, 'attorneys');
    assert.equal(session.routed, true);
    assert.equal(session.turns.length, 2);
  });

  test('concurrent calls are completely isolated', () => {
    const s = new SessionStore();
    s.create('CA_divorce', '+1555001', '+1555999');
    s.create('CA_plumb', '+1555002', '+1555999');

    s.setRoute('CA_divorce', { industry: 'attorneys', specialty: 'family_law', intent: 'divorce', urgency: 'normal', confidence: 0.95, source: 'heuristic' });
    s.setRoute('CA_plumb', { industry: 'plumbing', specialty: 'emergency', intent: 'active_water_leak', urgency: 'emergency', confidence: 0.95, source: 'heuristic' });
    s.mergeContact('CA_divorce', { firstName: 'Alice' });
    s.mergeContact('CA_plumb', { firstName: 'Bob' });

    assert.equal(s.get('CA_divorce')!.route.industry, 'attorneys');
    assert.equal(s.get('CA_plumb')!.route.industry, 'plumbing');
    assert.equal(s.get('CA_divorce')!.contact.firstName, 'Alice');
    assert.equal(s.get('CA_plumb')!.contact.firstName, 'Bob');
    // Nothing bled across.
    assert.equal(s.get('CA_divorce')!.turns.length, 0);
  });

  test('each new call starts fresh even from the same number', () => {
    const s = new SessionStore();
    s.create('CALL_1', '+15550001', '+1555999');
    s.mergeContact('CALL_1', { firstName: 'Tony' });
    s.end('CALL_1');
    const second = s.create('CALL_2', '+15550001', '+1555999');
    assert.deepEqual(second.contact, {}, 'a new call must not inherit the previous one');
    assert.equal(second.routed, false);
    assert.equal(second.turns.length, 0);
  });

  test('blank values never overwrite captured data', () => {
    const s = new SessionStore();
    s.create('CA2', 'x', 'y');
    s.mergeContact('CA2', { firstName: 'Tony' });
    s.mergeContact('CA2', { firstName: '   ', email: 'a@b.com' });
    assert.equal(s.get('CA2')!.contact.firstName, 'Tony');
    assert.equal(s.get('CA2')!.contact.email, 'a@b.com');
  });

  test('an unknown callSid is handled without throwing', () => {
    const s = new SessionStore();
    assert.doesNotThrow(() => s.addTurn('nope', 'caller', 'hi'));
    assert.equal(s.get('nope'), undefined);
    assert.equal(s.end('nope'), undefined);
  });
});

describe('Mock calendar', () => {
  const now = () => new Date('2026-09-07T08:00:00.000Z'); // a Monday

  test('offers weekday business-hours slots', async () => {
    const cal = createMockCalendar(now);
    const slots = await cal.checkAvailability({
      dateRange: { from: '2026-09-07T00:00:00.000Z', to: '2026-09-11T23:59:59.000Z' },
      durationMinutes: 30, timezone: 'America/New_York',
    });
    assert.ok(slots.length > 0, 'must offer something to book');
    for (const s of slots) {
      const d = new Date(s.start);
      assert.ok(d.getUTCDay() >= 1 && d.getUTCDay() <= 5, 'weekdays only');
      assert.ok(d.getTime() >= now().getTime(), 'never offers a past slot');
    }
  });

  test('books an appointment and returns an id', async () => {
    const cal = createMockCalendar(now);
    const booked = await cal.bookAppointment({
      title: 'Family law consultation',
      start: '2026-09-10T19:30:00.000Z',
      end: '2026-09-10T20:00:00.000Z',
      attendeeName: 'Tony', attendeeEmail: 'tony@example.com',
      notes: 'Divorce intake', createMeetLink: true,
    });
    assert.ok(booked.id);
    assert.equal(booked.mocked, true);
    assert.equal(booked.start, '2026-09-10T19:30:00.000Z');
    assert.ok(booked.meetLink, 'meet link requested');
  });

  test('a booked slot is no longer offered', async () => {
    const cal = createMockCalendar(now);
    const range = { from: '2026-09-07T00:00:00.000Z', to: '2026-09-11T23:59:59.000Z' };
    const before = await cal.checkAvailability({ dateRange: range, durationMinutes: 30, timezone: 'UTC' });
    await cal.bookAppointment({ title: 'x', start: before[0].start, end: before[0].end });
    const after = await cal.checkAvailability({ dateRange: range, durationMinutes: 30, timezone: 'UTC' });
    assert.equal(after.some((s) => s.start === before[0].start), false);
  });
});

describe('Mock SMS', () => {
  test('sends and always carries an opt-out', async () => {
    const sent: string[] = [];
    const sms = createMockSms((r) => sent.push(r.body));
    const res = await sms.send({ to: '+15550001', body: "You're booked for Thursday at 3:30 PM ET." });
    assert.equal(res.mocked, true);
    assert.match(res.body, /Reply STOP to opt out\.$/);
    assert.equal(sent.length, 1);
  });

  test('the opt-out is never duplicated', () => {
    const once = withOptOut('Hello.');
    assert.equal(withOptOut(once), once);
    assert.equal((once.match(/Reply STOP/g) ?? []).length, 1);
  });

  test('there is no bulk-send method on the interface', () => {
    const sms = createMockSms();
    assert.deepEqual(Object.keys(sms), ['send']);
  });
});

describe('Call transfer', () => {
  test('produces dialable TwiML when a number is configured', async () => {
    const t = createTransferTool('+15551234567');
    const r = await t.transferCall({ targetNumber: '', reason: 'caller asked for a human', summary: 'Divorce intake, wants to speak to an attorney' });
    assert.equal(r.accepted, true);
    assert.match(r.twiml, /<Dial timeout="30">\+15551234567<\/Dial>/);
  });

  test('declines cleanly when no number is configured', async () => {
    const t = createTransferTool('');
    const r = await t.transferCall({ targetNumber: '', reason: 'x', summary: 'y' });
    assert.equal(r.accepted, false);
    assert.match(r.reason!, /HUMAN_TRANSFER_NUMBER/);
  });

  test('escapes XML in the target', async () => {
    const t = createTransferTool('');
    const r = await t.transferCall({ targetNumber: '+1555"><script>', reason: 'x', summary: 'y' });
    assert.equal(r.twiml.includes('<script>'), false);
  });
});

describe('CRM placeholder', () => {
  test('produces a structured lead with no transcript', async () => {
    const s = new SessionStore();
    s.create('CA9', '+15550001', '+15559999');
    s.setRoute('CA9', { industry: 'plumbing', specialty: 'emergency', intent: 'active_water_leak', urgency: 'emergency', confidence: 0.95, source: 'heuristic' });
    s.mergeContact('CA9', { firstName: 'Bob', phone: '+15550001' });
    s.addTurn('CA9', 'caller', 'water everywhere');

    const lead = toLead(s.get('CA9')!);
    assert.equal(lead.industry, 'plumbing');
    assert.equal(lead.contact.firstName, 'Bob');
    assert.equal(lead.turnCount, 1);
    assert.equal('turns' in lead, false, 'the raw transcript must not ride along by default');

    const crm = createPlaceholderCrm();
    const res = await crm.pushLead(s.get('CA9')!);
    assert.equal(res.ok, true);
    assert.equal(res.mocked, true);
  });
});

describe('Logging', () => {
  test('redacts secrets at any depth', () => {
    const r = _internal.redact({
      apiKey: 'sk-ant-abc123456789', nested: { auth_token: 'supersecret', ok: 'visible' },
      note: 'my key is sk-ant-verylongkeyvalue123 here',
    }) as Record<string, unknown>;
    assert.equal(r.apiKey, '[redacted]');
    assert.equal((r.nested as Record<string, unknown>).auth_token, '[redacted]');
    assert.equal((r.nested as Record<string, unknown>).ok, 'visible');
    assert.match(String(r.note), /sk-ant-\[redacted\]/);
  });

  test('emits one parseable JSON line per event', () => {
    const lines: string[] = [];
    const log = createLogger({ svc: 'test' }, (l) => lines.push(l));
    log.log('call.started', { callSid: 'CA1' });
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.event, 'call.started');
    assert.equal(parsed.callSid, 'CA1');
    assert.ok(parsed.ts);
  });
});

describe('Twilio transport', () => {
  test('TwiML connects ConversationRelay with barge-in enabled', () => {
    const xml = conversationRelayTwiml({ relayUrl: 'wss://example.ngrok.app/relay', welcomeGreeting: 'Thanks for calling.' });
    assert.match(xml, /<Connect><ConversationRelay /);
    assert.match(xml, /url="wss:\/\/example\.ngrok\.app\/relay"/);
    assert.match(xml, /interruptible="true"/);
    assert.match(xml, /welcomeGreeting="Thanks for calling\."/);
  });

  test('TwiML escapes hostile input', () => {
    const xml = conversationRelayTwiml({ relayUrl: 'wss://x/relay', welcomeGreeting: 'Hi "there" & <friend>' });
    assert.equal(xml.includes('<friend>'), false);
    assert.match(xml, /&amp;/);
  });

  test('parses relay messages and rejects junk', () => {
    assert.equal(parseRelayMessage('{"type":"prompt","voicePrompt":"hello"}')?.type, 'prompt');
    assert.equal(parseRelayMessage('not json'), null);
    assert.equal(parseRelayMessage('{"no":"type"}'), null);
  });

  test('long replies are chunked so speech starts sooner', () => {
    const long = 'First sentence here. Second sentence follows on. Third one continues the thought. Fourth wraps it up nicely for the caller.';
    const chunks = chunkForSpeech(long, 60);
    assert.ok(chunks.length > 1, 'should split');
    assert.equal(chunks.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '), 'no words lost');
  });

  test('a short reply is a single chunk, and the last token closes the turn', () => {
    const chunks = chunkForSpeech('Sure, what is your name?');
    assert.equal(chunks.length, 1);
    const frame = JSON.parse(textResponse(chunks[0], true));
    assert.equal(frame.type, 'text');
    assert.equal(frame.last, true);
  });
});

describe('Config', () => {
  test('runs fully mocked with no credentials at all', () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    assert.equal(cfg.mockCalendarMode, true);
    assert.equal(cfg.mockSmsMode, true);
    assert.equal(cfg.anthropicApiKey, '');
    assert.equal(cfg.port, 3001);
  });

  test('mocks stay on when disabling them but the credentials are absent', () => {
    const prev = { ...process.env };
    process.env.MOCK_SMS_MODE = 'false';
    process.env.MOCK_CALENDAR_MODE = 'false';
    try {
      const cfg = loadConfig();
      assert.equal(cfg.mockSmsMode, true, 'no Twilio creds -> must stay mocked');
      assert.equal(cfg.mockCalendarMode, true, 'no Google creds -> must stay mocked');
    } finally {
      process.env = prev;
    }
  });

  test('derives the relay websocket URL from the public base URL', () => {
    const prev = { ...process.env };
    process.env.PUBLIC_BASE_URL = 'https://demo.ngrok.app';
    try {
      assert.equal(loadConfig().relayUrl, 'wss://demo.ngrok.app/twilio/conversation');
    } finally {
      process.env = prev;
    }
  });

  test('the redacted config snapshot contains no secret values', async () => {
    const { describeConfig } = await import('../src/config.ts');
    const prev = { ...process.env };
    process.env.ANTHROPIC_API_KEY = 'sk-ant-supersecretvalue';
    process.env.TWILIO_AUTH_TOKEN = 'twiliosecret';
    try {
      const snapshot = JSON.stringify(describeConfig(loadConfig()));
      assert.equal(snapshot.includes('supersecret'), false);
      assert.equal(snapshot.includes('twiliosecret'), false);
      assert.match(snapshot, /"anthropicKey":"present"/);
    } finally {
      process.env = prev;
    }
  });
});
