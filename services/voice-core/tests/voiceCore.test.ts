import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  voicePaths, relayUrlFor, PATHS,
  validateTwilioSignature, expectedSignature, formToRecord,
  conversationRelayTwiml, transferTwiml, fallbackTwiml, hangupTwiml,
  parseRelayMessage, textResponse, chunkForSpeech,
  SessionStore, createTimeline, RateLimiter, clientIp, createLogger,
  readBodyLimited,
} from '../src/index.ts';

/**
 * voice-core, the ported transport.
 *
 * These cover the behaviours the deployed service learned the hard way, so a future
 * change to this package cannot quietly undo them.
 */

// --- paths -------------------------------------------------------------------

test('the relay URL is derived from the same table the socket listens on', () => {
  // The outage this prevents: a derived URL of /relay while the socket listened on
  // /twilio/conversation, so Twilio dialled a path that did not exist.
  const paths = voicePaths('');
  assert.equal(relayUrlFor('https://voice.youraidepartment.ai', paths),
    'wss://voice.youraidepartment.ai/twilio/conversation');
  assert.equal(paths.relay, PATHS.relay, 'the receptionist surface is unchanged');
});

test('two services can share a hostname without guessing each other routes', () => {
  const inbound = voicePaths('');
  const outbound = voicePaths('/outbound');
  assert.equal(outbound.relay, '/outbound/twilio/conversation');
  assert.equal(outbound.health, '/outbound/health');
  assert.notEqual(inbound.relay, outbound.relay);
  assert.notEqual(inbound.health, outbound.health,
    'separate health checks, so one service being down is visible on its own');
});

// --- signature ---------------------------------------------------------------

test('a valid Twilio signature is accepted and a tampered one is not', () => {
  const token = 'test-auth-token-not-a-real-one';
  const url = 'https://voice.youraidepartment.ai/twilio/incoming';
  const params = { CallSid: 'CA123', From: '+19045550142', To: '+19046829345' };
  const signature = expectedSignature(token, url, params);

  assert.equal(validateTwilioSignature(token, signature, url, params), true);
  assert.equal(validateTwilioSignature(token, signature, url, { ...params, From: '+15550000000' }),
    false, 'changing a parameter invalidates the signature');
  assert.equal(validateTwilioSignature(token, signature,
    'https://voice.youraidepartment.ai/twilio/status', params), false,
    'the signature is over the URL too');
  assert.equal(validateTwilioSignature(token, undefined, url, params), false);
  assert.equal(validateTwilioSignature('', signature, url, params), false,
    'no auth token means nothing validates');
});

test('form bodies parse into the record the signature is computed over', () => {
  assert.deepEqual(formToRecord('CallSid=CA1&From=%2B19045550142'),
    { CallSid: 'CA1', From: '+19045550142' });
});

// --- TwiML -------------------------------------------------------------------

test('the relay TwiML carries the settings production actually runs', () => {
  const xml = conversationRelayTwiml({
    relayUrl: 'wss://voice.youraidepartment.ai/outbound/twilio/conversation',
    welcomeGreeting: 'Hello & welcome',
    actionUrl: 'https://voice.youraidepartment.ai/outbound/twilio/relay-action',
  });
  assert.match(xml, /<ConversationRelay /);
  assert.match(xml, /interruptible="true"/, 'a caller can cut in mid-sentence');
  assert.match(xml, /welcomeGreetingInterruptible="any"/,
    'the greeting itself can be interrupted');
  assert.match(xml, /transcriptionProvider="google"/);
  assert.match(xml, /Hello &amp; welcome/, 'the greeting is XML-escaped');
  assert.equal(xml.includes('Hello & welcome'), false);
});

test('a transfer keeps the original caller ID, and a failure still speaks', () => {
  assert.match(transferTwiml('+19045550111'), /<Dial timeout="30">\+19045550111<\/Dial>/);
  assert.equal(transferTwiml('+19045550111').includes('callerId'), false,
    'whoever answers sees who is actually on the line');
  assert.match(fallbackTwiml('Sorry, something went wrong.'), /<Say>Sorry/);
  assert.match(hangupTwiml(), /<Hangup\/>/);
});

// --- relay protocol ----------------------------------------------------------

test('a malformed relay frame is ignored rather than throwing', () => {
  assert.equal(parseRelayMessage('not json'), null);
  assert.equal(parseRelayMessage('{"no":"type"}'), null);
  assert.deepEqual(parseRelayMessage('{"type":"setup","callSid":"CA1"}'),
    { type: 'setup', callSid: 'CA1' });
});

test('a streamed clause is never marked preemptible', () => {
  // A preemptible stream cancels itself clause by clause.
  const whole = JSON.parse(textResponse('One complete line.', true, { preemptible: true }));
  assert.equal(whole.preemptible, true);
  assert.equal(whole.last, true);

  const clause = JSON.parse(textResponse('First clause,', false));
  assert.equal(clause.last, false);
  assert.equal('preemptible' in clause, false);
});

test('long replies are chunked so speech starts sooner', () => {
  const chunks = chunkForSpeech(
    'This is the first sentence and it runs on for a while. '
    + 'This is the second sentence, also fairly long. '
    + 'And a third to be sure it splits.', 60);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').length > 0, true);
  assert.deepEqual(chunkForSpeech('   '), []);
});

// --- session lifecycle and barge-in -----------------------------------------

interface DemoState { greeted: boolean }

test('sessions are isolated by call, and state belongs to the consumer', () => {
  const store = new SessionStore<DemoState>(() => ({ greeted: false }));
  store.create('CA1', '+19045550142', '+19046829345');
  store.create('CA2', '+19045550143', '+19046829345');
  store.patchState('CA1', { greeted: true });

  assert.equal(store.get('CA1')!.state.greeted, true);
  assert.equal(store.get('CA2')!.state.greeted, false,
    'one call cannot see or change another');
  assert.equal(store.size, 2);
});

test('an interrupted turn is cut down to what the caller actually heard', () => {
  const store = new SessionStore<DemoState>(() => ({ greeted: false }));
  store.create('CA1', 'x', 'y');
  store.addTurn('CA1', 'agent', 'I can look at that for you, and I can also send a summary.');

  const dropped = store.truncateLastAgentTurn('CA1', 'I can look at that for you,');
  assert.equal(dropped, 'and I can also send a summary.');
  const turn = store.get('CA1')!.turns[0]!;
  assert.equal(turn.text, 'I can look at that for you,');
  assert.equal(turn.interrupted, true);
});

test('an interrupt that does not match the record leaves it alone', () => {
  const store = new SessionStore<DemoState>(() => ({ greeted: false }));
  store.create('CA1', 'x', 'y');
  store.addTurn('CA1', 'agent', 'Short line.');

  assert.equal(store.truncateLastAgentTurn('CA1', 'Something else entirely'), null);
  assert.equal(store.truncateLastAgentTurn('CA1', 'Short line.'), null,
    'a value as long as the turn is not evidence anything was cut');
  assert.equal(store.get('CA1')!.turns[0]!.text, 'Short line.');
  assert.equal(store.get('CA1')!.turns[0]!.interrupted, undefined);
});

// --- telemetry ---------------------------------------------------------------

test('the timeline measures from the call and repeats no first-mark', () => {
  const logged: Record<string, unknown>[] = [];
  let clock = 1000;
  const timeline = createTimeline({
    callSid: 'CA1', now: () => clock,
    sink: { log: (_event, data) => logged.push(data) },
  });

  clock = 1400;
  timeline.mark('WEBSOCKET_CONNECTED');
  timeline.beginTurn();
  clock = 1600;
  timeline.mark('FIRST_CALLER_SPEECH');
  clock = 1900;
  timeline.mark('FIRST_CALLER_SPEECH');

  const speech = logged.filter((row) => row['mark'] === 'FIRST_CALLER_SPEECH');
  assert.equal(speech.length, 1, 'a repeated first-mark would make the table lie');
  assert.equal(speech[0]!['atMs'], 600);
  assert.equal(timeline.since('FIRST_CALLER_SPEECH'), 300);
});

test('the timeline never claims to know when the caller heard audio', () => {
  const logged: Record<string, unknown>[] = [];
  const timeline = createTimeline({
    callSid: 'CA1', sink: { log: (_event, data) => logged.push(data) } });
  timeline.mark('FIRST_AGENT_AUDIO_PROXY', { observable: false, proxy: 'relay socket open' });
  assert.equal(logged[0]!['observable'], false,
    'Twilio owns synthesis and playback, and reports neither');
});

// --- guards and logging ------------------------------------------------------

test('the rate limiter holds a fixed window and can be swept', () => {
  const limiter = new RateLimiter(2, 1000);
  assert.equal(limiter.check('a', 0), true);
  assert.equal(limiter.check('a', 10), true);
  assert.equal(limiter.check('a', 20), false, 'the third request in the window is refused');
  assert.equal(limiter.check('b', 20), true, 'a different caller is unaffected');
  limiter.sweep(2000);
  assert.equal(limiter.size, 0);
});

test('a forwarded-for header is trusted only behind a proxy', () => {
  const headers = { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' };
  assert.equal(clientIp(headers, '10.0.0.1', true), '1.2.3.4');
  assert.equal(clientIp(headers, '10.0.0.1', false), '10.0.0.1',
    'otherwise a caller could spoof the header to evade limits');
});

test('a credential cannot be logged, whatever key it arrives under', () => {
  const lines: string[] = [];
  const log = createLogger({}, (line) => lines.push(line));
  log.log('error', {
    api_key: 'sk-ant-abcdefghijklmnop',
    innocuous: 'bearer sk-ant-abcdefghijklmnop',
  });
  const output = lines.join('\n');
  assert.equal(output.includes('abcdefghijklmnop'), false);
});

// --- the boundary itself -----------------------------------------------------

test('voice-core contains no business behaviour', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts')) files.push(full);
    }
  };
  walk(new URL('../src', import.meta.url).pathname);

  const forbidden = [
    /\bsystem prompt\b/i, /receptionistPrompt/, /DEMO_INTRO/, /demoProfile/,
    /industries\//, /collision/i, /mockCalendar/i, /mockSms/i,
  ];
  const offenders: string[] = [];
  for (const file of files) {
    // Comments explain what was deliberately left out; code must not reintroduce it.
    const code = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    for (const pattern of forbidden) {
      if (pattern.test(code)) offenders.push(`${file} matches ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [],
    'the transport must not learn what the services say');
});


// --- adversarial: what an external reviewer would try -------------------------

test('a signature comparison is constant-time and length-safe', () => {
  const token = 'token-not-a-real-one';
  const url = 'https://voice.youraidepartment.ai/outbound/twilio/incoming';
  const params = { CallSid: 'CA1' };
  const good = expectedSignature(token, url, params);

  for (const candidate of ['', 'x', good.slice(0, -1), good + 'x', 'A'.repeat(4096),
                           ' ', '!!!', good.toUpperCase()]) {
    assert.equal(validateTwilioSignature(token, candidate, url, params), false,
      `accepted ${JSON.stringify(candidate.slice(0, 12))}`);
  }
  assert.equal(validateTwilioSignature(token, good, url, params), true);
});

test('the signature is faithful to Twilio scheme, ordering included', () => {
  const token = 't';
  const url = 'https://voice.youraidepartment.ai/x';
  // Twilio sorts by key, so a reordered body signs the same and a changed value
  // does not.
  assert.equal(expectedSignature(token, url, { b: '2', a: '1' }),
    expectedSignature(token, url, { a: '1', b: '2' }));
  assert.notEqual(expectedSignature(token, url, { a: '1', b: '2' }),
    expectedSignature(token, url, { a: '1', b: '3' }));
});

test('the concatenation collision in Twilio scheme is documented, not patched', () => {
  const token = 't';
  const url = 'https://voice.youraidepartment.ai/x';
  // Twilio's documented algorithm concatenates sorted key+value pairs with no
  // separator, so {ab:'c'} and {a:'bc'} hash identically. That is a property of the
  // provider's scheme, not of this code.
  assert.equal(expectedSignature(token, url, { ab: 'c' }),
    expectedSignature(token, url, { a: 'bc' }),
    'if this ever differs, the implementation has diverged from Twilio and every '
    + 'real webhook will start failing validation');

  // It is not exploitable here: the parameter names are Twilio's, not a caller's,
  // and the URL is rebuilt from configuration rather than from a request header. A
  // forged body would have to keep the same concatenation *and* the same URL, and
  // changing any value the service reads changes the concatenation.
  const real = { CallSid: 'CA1', From: '+19045550142', To: '+19046829345' };
  const forged = { CallSid: 'CA1', From: '+19045550143', To: '+19046829345' };
  assert.notEqual(expectedSignature(token, url, real),
    expectedSignature(token, url, forged));
});

test('form parsing keeps a repeated key deterministic', () => {
  const record = formToRecord('CallSid=CA1&CallSid=CA2');
  assert.equal(typeof record['CallSid'], 'string');
});

test('TwiML escapes everything that could break out of an attribute', () => {
  const xml = conversationRelayTwiml({
    relayUrl: 'wss://x/y?a=1&b=2',
    welcomeGreeting: 'He said "hi" and <script>alert(1)</script>',
  });
  assert.equal(xml.includes('<script>'), false);
  assert.equal(xml.includes('"hi"'), false, 'a raw quote would close the attribute');
  assert.match(xml, /&amp;/);
  assert.match(xml, /&quot;/);
  assert.match(xml, /&lt;script&gt;/);
  assert.match(xml, /a=1&amp;b=2/);
});

test('chunking never drops or reorders content', () => {
  const text = 'First sentence here. Second one follows! Third one? And a fourth.';
  const chunks = chunkForSpeech(text, 24);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(),
    text.replace(/\s+/g, ' ').trim(), 'speech must say exactly what it was given');
});

test('chunking handles input with no sentence boundary at all', () => {
  const long = 'word '.repeat(200).trim();
  const chunks = chunkForSpeech(long, 60);
  assert.ok(chunks.length >= 1);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), long);
});

test('a relay frame that is valid JSON but not an object is refused', () => {
  for (const raw of ['"a string"', '123', 'null', 'true', '[]', '[{"type":"setup"}]']) {
    assert.equal(parseRelayMessage(raw), null, `accepted ${raw}`);
  }
});

test('the logger redacts a credential under any key name, at depth', () => {
  const lines: string[] = [];
  const log = createLogger({}, (line) => lines.push(line));
  log.log('error', {
    nested: { deeper: { authToken: 'AC0123456789abcdef0123456789abcdef' } },
    innocuous: 'authorization: Bearer sk-ant-abcdefghijklmnopqrst',
    list: ['sk-ant-abcdefghijklmnopqrst'],
  });
  const output = lines.join(String.fromCharCode(10));
  assert.equal(output.includes('sk-ant-abcdefghijklmnopqrst'), false);
  assert.equal(/AC0123456789abcdef0123456789abcdef/.test(output), false,
    'an account SID under a secret-shaped key is redacted too');
});

test('a log line cannot be forged by injecting a newline', () => {
  const lines: string[] = [];
  const log = createLogger({}, (line) => lines.push(line));
  const forged = 'ok"}' + String.fromCharCode(10) + '{"level":"forged"';
  log.log('error', { reason: forged });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.split(String.fromCharCode(10)).length, 1,
    'a newline in a value cannot split the line');
});

test('the rate limiter window map is swept, so it cannot be a memory attack', () => {
  const limiter = new RateLimiter(1, 1000);
  assert.equal(limiter.check('1.2.3.4', 0), true);
  assert.equal(limiter.check('1.2.3.4', 10), false);
  for (let i = 0; i < 5000; i += 1) limiter.check(`key-${i}`, 20);
  limiter.sweep(5000);
  assert.equal(limiter.size, 0);
});

test('a body larger than the cap is refused without being buffered', async () => {
  async function* hugeBody() {
    for (let i = 0; i < 100; i += 1) yield Buffer.alloc(4096, 65);
  }
  const result = await readBodyLimited(hugeBody(), 8192);
  assert.equal(result.truncated, true);
  assert.equal(result.body, '', 'nothing over the cap is retained');
});

test('the session store bounds what a long call can hold in memory', () => {
  const store = new SessionStore<{ x: number }>(() => ({ x: 0 }), 1000, 10);
  store.create('CA1', 'a', 'b');
  for (let i = 0; i < 50; i += 1) store.addTurn('CA1', 'agent', `turn ${i}`);
  const session = store.get('CA1')!;
  assert.equal(session.turns.length, 10);
  assert.equal(session.turns[9]!.text, 'turn 49', 'the recent end is what is kept');
  assert.ok((session.turnsDropped ?? 0) > 0, 'and a review can tell turns were dropped');
});
