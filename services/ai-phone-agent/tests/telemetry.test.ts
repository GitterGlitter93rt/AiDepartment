import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, nullTimeline, TimelineStore, type TimelineMark } from '../src/core/telemetry.ts';
import { conversationRelayTwiml } from '../src/twilio/twiml.ts';
import { BUILD } from '../src/build-info.ts';

function harness(start = 1_000) {
  let clock = start;
  const lines: Record<string, unknown>[] = [];
  const sink = { log: (_e: 'timeline', d: Record<string, unknown>) => { lines.push(d); } };
  return {
    lines,
    sink,
    tick: (ms: number) => { clock += ms; },
    now: () => clock,
  };
}

describe('call timeline', () => {
  test('marks are elapsed from call start, not wall clock', () => {
    const h = harness();
    const t = createTimeline({ callSid: 'CA1', sink: h.sink, now: h.now });
    t.mark('CALL_CONNECTED');
    h.tick(120);
    t.mark('WELCOME_GREETING_SENT');
    h.tick(300);
    t.mark('WEBSOCKET_CONNECTED');

    assert.deepEqual(h.lines.map((l) => [l.mark, l.atMs]), [
      ['CALL_CONNECTED', 0],
      ['WELCOME_GREETING_SENT', 120],
      ['WEBSOCKET_CONNECTED', 420],
    ]);
  });

  test('deltaMs is the gap from the previous mark — the slow step is visible', () => {
    const h = harness();
    const t = createTimeline({ callSid: 'CA1', sink: h.sink, now: h.now });
    t.mark('CALLER_END_OF_TURN');
    h.tick(40);
    t.mark('CLAUDE_REQUEST_START');
    h.tick(700);
    t.mark('CLAUDE_FIRST_STREAM_EVENT');

    assert.equal(h.lines[1].deltaMs, 40);
    // The 700ms sits on exactly one row rather than being smeared.
    assert.equal(h.lines[2].deltaMs, 700);
  });

  test('a "first" mark cannot fire twice in a turn', () => {
    const h = harness();
    const t = createTimeline({ callSid: 'CA1', sink: h.sink, now: h.now });
    t.beginTurn();
    t.mark('FIRST_SPEAKABLE_CLAUSE');
    h.tick(200);
    t.mark('FIRST_SPEAKABLE_CLAUSE');
    t.mark('FIRST_SPEAKABLE_CLAUSE');

    const firsts = h.lines.filter((l) => l.mark === 'FIRST_SPEAKABLE_CLAUSE');
    assert.equal(firsts.length, 1, 'a second clause must not overwrite the first-clause timing');
    assert.equal(firsts[0].atMs, 0);
  });

  test('a new turn re-arms the per-turn marks', () => {
    const h = harness();
    const t = createTimeline({ callSid: 'CA1', sink: h.sink, now: h.now });
    t.beginTurn();
    t.mark('FIRST_SPEAKABLE_CLAUSE');
    h.tick(500);
    t.beginTurn();
    t.mark('FIRST_SPEAKABLE_CLAUSE');

    const firsts = h.lines.filter((l) => l.mark === 'FIRST_SPEAKABLE_CLAUSE');
    assert.equal(firsts.length, 2);
    assert.deepEqual(firsts.map((f) => f.turn), [1, 2]);
    assert.equal(firsts[1].atMs, 500);
  });

  test('call-level marks never repeat, even across turns', () => {
    const h = harness();
    const t = createTimeline({ callSid: 'CA1', sink: h.sink, now: h.now });
    t.mark('CALL_CONNECTED');
    t.beginTurn();
    t.mark('CALL_CONNECTED');
    t.beginTurn();
    t.mark('CALL_CONNECTED');
    assert.equal(h.lines.filter((l) => l.mark === 'CALL_CONNECTED').length, 1);
  });

  test('since() measures back to the most recent occurrence', () => {
    const h = harness();
    const t = createTimeline({ callSid: 'CA1', sink: h.sink, now: h.now });
    t.mark('INTERRUPT_RECEIVED');
    h.tick(35);
    assert.equal(t.since('INTERRUPT_RECEIVED'), 35);
    assert.equal(t.since('CLAUDE_ABORTED'), undefined, 'a mark that never fired has no elapsed time');
  });

  test('the store shares one clock between the webhook and the socket', () => {
    const h = harness();
    const store = new TimelineStore(h.sink, h.now);
    const fromWebhook = store.start('CA9');
    fromWebhook.mark('CALL_CONNECTED');
    h.tick(850);

    // The socket arrives later and on a different connection.
    const fromSocket = store.ensure('CA9');
    fromSocket.mark('WEBSOCKET_CONNECTED');

    assert.equal(h.lines[1].atMs, 850, 'measured from the call, not from the socket');
    assert.equal(fromSocket, fromWebhook);
  });

  test('a socket with no webhook still gets a timeline', () => {
    const h = harness();
    const store = new TimelineStore(h.sink, h.now);
    const t = store.ensure('CA-local');
    t.mark('WEBSOCKET_CONNECTED');
    assert.equal(h.lines.length, 1);
  });

  test('ending a call releases the timeline', () => {
    const store = new TimelineStore({ log: () => {} });
    store.start('CA1');
    store.start('CA2');
    assert.equal(store.size, 2);
    store.end('CA1');
    assert.equal(store.size, 1);
    store.end('CA2');
    assert.equal(store.size, 0, 'timelines must not accumulate for the life of the process');
  });

  test('the null timeline is inert', () => {
    const t = nullTimeline();
    t.mark('CALL_CONNECTED');
    assert.equal(t.marks.length, 0);
    assert.equal(t.since('CALL_CONNECTED'), undefined);
  });

  test('every mark the QA pass asks for is recordable', () => {
    // Named explicitly: a rename that silently drops one would make the
    // measurement table quietly incomplete.
    const required: TimelineMark[] = [
      'CALL_CONNECTED', 'WEBSOCKET_CONNECTED', 'WELCOME_GREETING_SENT',
      'FIRST_AGENT_AUDIO_PROXY', 'FIRST_CALLER_SPEECH', 'CALLER_END_OF_TURN',
      'TURN_HANDLER_START', 'CLAUDE_REQUEST_START', 'CLAUDE_FIRST_STREAM_EVENT',
      'FIRST_SPEAKABLE_CLAUSE', 'FIRST_TEXT_SENT_TO_CONVERSATION_RELAY',
      'TURN_COMPLETE', 'INTERRUPT_RECEIVED', 'CLAUDE_ABORTED',
    ];
    const h = harness();
    const t = createTimeline({ callSid: 'CA1', sink: h.sink, now: h.now });
    t.beginTurn();
    for (const m of required) t.mark(m);
    assert.deepEqual(h.lines.map((l) => l.mark), required);
  });
});

describe('build identification', () => {
  test('/health can name the commit it is running', () => {
    assert.match(BUILD.commit, /^[0-9a-f]{40}$|^unknown$/);
    assert.equal(BUILD.shortCommit, BUILD.commit.slice(0, 7));
    assert.ok(['git', 'env', 'unknown'].includes(BUILD.source));
  });

  test('startedAt is a real timestamp', () => {
    assert.ok(!Number.isNaN(Date.parse(BUILD.startedAt)));
  });
});

describe('partial prompts', () => {
  const base = { relayUrl: 'wss://x/relay', welcomeGreeting: 'Hello.' };

  test('off by default — nothing changes for a deployment that does not ask', () => {
    assert.ok(!conversationRelayTwiml(base).includes('partialPrompts'));
  });

  test('opted in, the attribute is present', () => {
    assert.match(conversationRelayTwiml({ ...base, partialPrompts: true }), /partialPrompts="true"/);
  });

  test('enabling it changes nothing else about the relay config', () => {
    const off = conversationRelayTwiml(base);
    const on = conversationRelayTwiml({ ...base, partialPrompts: true });
    assert.equal(on.replace(' partialPrompts="true"', ''), off);
  });
});
