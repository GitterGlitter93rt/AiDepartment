import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, nullTimeline, TimelineStore, type TimelineMark } from '../src/core/telemetry.ts';
import { conversationRelayTwiml } from '../src/twilio/twiml.ts';
import { BUILD } from '../src/build-info.ts';
import { speakPhone, formatPhone } from '../src/core/speech.ts';
import { MAX_SPEECH_CHARS } from '../src/core/orchestrator.ts';
import { createClaudeClient } from '../src/claude/client.ts';

/** A fetch that replays `text` as a real Anthropic SSE stream. */
function sseStub(text: string): typeof fetch {
  return (async () => {
    const frames = [
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      ...(text.match(/\S+\s*/g) ?? []).map((t) => ({
        type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t },
      })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    ];
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          for (const f of frames) controller.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
          controller.close();
        },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

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

  test('the caller can talk over the intro', () => {
    // The split intro is only acceptable if it can be cut short.
    assert.match(conversationRelayTwiml(base), /welcomeGreetingInterruptible="any"/);
  });
});

describe('spoken phone numbers', () => {
  // Every form the number reaches us in must speak identically. The
  // failure this guards against is a real one: TTS handed digits
  // regroups them however it likes, and "9046829345" came out in
  // four-digit chunks on a recorded call.
  const SPOKEN = 'nine oh four, six eight two, nine three four five';

  for (const input of ['9046829345', '+19046829345', '(904) 682-9345', '904.682.9345', '904-682-9345', '1-904-682-9345', ' 904 682 9345 ']) {
    test(`${JSON.stringify(input)} speaks as 3-3-4 words`, () => {
      assert.equal(speakPhone(input), SPOKEN);
    });
  }

  test('no digit survives into the spoken string', () => {
    // The whole point: leave a digit in and the TTS engine gets to
    // decide how to group it, which is what went wrong.
    assert.ok(!/\d/.test(speakPhone('+19046829345')));
  });

  test('zero is "oh", not "zero"', () => {
    assert.match(speakPhone('9046829345'), /nine oh four/);
    assert.ok(!speakPhone('9046829345').includes('zero'));
  });

  test('grouping is 3-3-4, not four-digit chunks', () => {
    const groups = speakPhone('9046829345').split(',').map((g) => g.trim().split(/\s+/).length);
    assert.deepEqual(groups, [3, 3, 4]);
  });

  test('printed form stays conventional', () => {
    assert.equal(formatPhone('+19046829345'), '(904) 682-9345');
  });

  test('a number that is not NANP is left alone rather than mangled', () => {
    assert.equal(speakPhone('+442071234567'), '+442071234567');
  });
});

describe('speech length guard', () => {
  test('the cap is a spoken-turn length, not a token budget', () => {
    // ~55 words. Long enough for a real answer, short enough that the
    // 704-character paragraph production produced cannot recur.
    assert.ok(MAX_SPEECH_CHARS >= 200 && MAX_SPEECH_CHARS <= 400);
  });

  test('a capped turn still ends on a finished clause', async () => {
    const long = 'This is the first sentence. This is the second sentence. This is the third sentence. This is the fourth sentence. This is the fifth sentence. This is the sixth sentence. This is the seventh sentence.';
    const clauses: string[] = [];
    const client = createClaudeClient('k', 'm', sseStub(long));
    const res = await client.stream!({
      system: 's', messages: [{ role: 'user', content: 'hi' }],
      onClause: (c) => clauses.push(c),
      maxSpeechChars: 120,
    });
    const spoken = clauses.join(' ');
    assert.ok(spoken.length < long.length, 'must actually cut something');
    assert.match(spoken.trim(), /\.$/, 'must not stop mid-sentence');
    assert.ok(!res.text.includes('seventh'), 'the tail is abandoned, not spoken');
  });

  test('an unbudgeted stream is untouched', async () => {
    const text = 'Short reply. Another sentence here.';
    const clauses: string[] = [];
    const client = createClaudeClient('k', 'm', sseStub(text));
    await client.stream!({
      system: 's', messages: [{ role: 'user', content: 'hi' }],
      onClause: (c) => clauses.push(c),
    });
    assert.equal(clauses.join(' ').replace(/\s+/g, ' ').trim(), text);
  });
});
