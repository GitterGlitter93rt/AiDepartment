import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeClient, buildSystemField, withToolCache } from '../src/claude/client.ts';
import { SessionStore } from '../src/core/session.ts';
import { HISTORY_WINDOW } from '../src/core/orchestrator.ts';
import { toolsFor } from '../src/core/tool-protocol.ts';

/**
 * Validates a request body the way the API does.
 *
 * Every tool_result must be answered by a tool_use with the same id in
 * the immediately preceding assistant message. Getting this wrong is
 * not a degraded reply — it is a 400 and a silent phone line, which is
 * exactly what production did.
 */
function validateToolPairing(body: { messages: { role: string; content: unknown }[] }): void {
  const offered = new Set<string>();
  for (const [i, msg] of body.messages.entries()) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content as Record<string, unknown>[]) {
      if (msg.role === 'assistant' && block.type === 'tool_use') {
        assert.ok(block.id, `assistant block ${i} has a tool_use with no id`);
        offered.add(String(block.id));
      }
      if (msg.role === 'user' && block.type === 'tool_result') {
        const id = String(block.tool_use_id);
        assert.ok(
          offered.has(id),
          `unexpected tool_use_id ${id} in tool_result — no assistant tool_use offered it`,
        );
      }
      if (block.type === 'text') {
        assert.notEqual(String(block.text ?? '').length, 0, 'empty text block is rejected by the API');
      }
    }
  }
}

/** An SSE stub that replays given content blocks, capturing requests. */
function sseClient(frameSets: unknown[][]) {
  const sent: Record<string, unknown>[] = [];
  let call = 0;
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    const frames = frameSets[Math.min(call, frameSets.length - 1)];
    call += 1;
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
  return { client: createClaudeClient('k', 'm', fetchImpl), sent };
}

const start = { type: 'message_start', message: { usage: { input_tokens: 10 } } };
const stop = { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } };

function textBlock(index: number, text: string) {
  return [
    { type: 'content_block_start', index, content_block: { type: 'text' } },
    { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
  ];
}
function toolBlock(index: number, id: string, name: string, json: string) {
  return [
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json } },
  ];
}

describe('streamed tool-use history', () => {
  test('a single tool comes back as a real assistant block, not an empty array', async () => {
    // The production bug: stream() returned raw: [], so the assistant
    // turn carried no tool_use and the API rejected the tool_result
    // with "unexpected tool_use_id".
    const { client } = sseClient([[start, ...toolBlock(0, 'toolu_1', 'capture_details', '{"firstName":"Mike"}'), stop]]);
    const res = await client.stream!({ system: 's', messages: [{ role: 'user', content: 'hi' }], onClause: () => {} });

    assert.equal(res.toolUses.length, 1);
    assert.notDeepEqual(res.raw, [], 'raw must not be empty — this was the bug');
    assert.deepEqual(res.raw, [{ type: 'tool_use', id: 'toolu_1', name: 'capture_details', input: { firstName: 'Mike' } }]);
  });

  test('the reconstructed turn pairs with its tool_result', async () => {
    const { client } = sseClient([[start, ...toolBlock(0, 'toolu_abc', 'dispatch_tow', '{"callerName":"Mike"}'), stop]]);
    const res = await client.stream!({ system: 's', messages: [{ role: 'user', content: 'hi' }], onClause: () => {} });

    validateToolPairing({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: res.raw },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: res.toolUses[0].id, content: 'ok' }] },
      ],
    });
  });

  test('multiple tools in one turn all survive, in order', async () => {
    const { client } = sseClient([[
      start,
      ...toolBlock(0, 'toolu_1', 'capture_details', '{"a":1}'),
      ...toolBlock(1, 'toolu_2', 'dispatch_tow', '{"b":2}'),
      stop,
    ]]);
    const res = await client.stream!({ system: 's', messages: [{ role: 'user', content: 'hi' }], onClause: () => {} });

    assert.deepEqual(res.toolUses.map((t) => t.id), ['toolu_1', 'toolu_2']);
    validateToolPairing({
      messages: [
        { role: 'assistant', content: res.raw },
        { role: 'user', content: res.toolUses.map((t) => ({ type: 'tool_result', tool_use_id: t.id, content: 'ok' })) },
      ],
    });
  });

  test('speech and a tool in the same turn keep their original order', async () => {
    const { client } = sseClient([[
      start,
      ...textBlock(0, 'Let me get that started.'),
      ...toolBlock(1, 'toolu_9', 'create_location_link', '{}'),
      stop,
    ]]);
    const res = await client.stream!({ system: 's', messages: [{ role: 'user', content: 'hi' }], onClause: () => {} });

    assert.deepEqual((res.raw as Record<string, unknown>[]).map((b) => b.type), ['text', 'tool_use']);
    validateToolPairing({
      messages: [
        { role: 'assistant', content: res.raw },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'ok' }] },
      ],
    });
  });

  test('a tool whose arguments never arrive still produces a pairable block', async () => {
    // A rejected or malformed call must not silently drop the block:
    // the tool_result still needs something to pair with.
    const { client } = sseClient([[start, ...toolBlock(0, 'toolu_bad', 'dispatch_tow', 'not json'), stop]]);
    const res = await client.stream!({ system: 's', messages: [{ role: 'user', content: 'hi' }], onClause: () => {} });

    assert.equal(res.toolUses.length, 1);
    assert.deepEqual(res.toolUses[0].input, {});
    validateToolPairing({
      messages: [
        { role: 'assistant', content: res.raw },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bad', content: 'rejected', is_error: true }] },
      ],
    });
  });

  test('a failed tool result is still valid history', async () => {
    const { client } = sseClient([[start, ...toolBlock(0, 'toolu_f', 'dispatch_tow', '{}'), stop]]);
    const res = await client.stream!({ system: 's', messages: [{ role: 'user', content: 'hi' }], onClause: () => {} });
    validateToolPairing({
      messages: [
        { role: 'assistant', content: res.raw },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_f', content: 'Get their name first.', is_error: true }] },
      ],
    });
  });

  test('two sequential tool turns each pair with their own result', async () => {
    const { client } = sseClient([
      [start, ...toolBlock(0, 'toolu_first', 'capture_details', '{}'), stop],
      [start, ...toolBlock(0, 'toolu_second', 'dispatch_tow', '{}'), stop],
    ]);
    const one = await client.stream!({ system: 's', messages: [{ role: 'user', content: 'hi' }], onClause: () => {} });
    const two = await client.stream!({ system: 's', messages: [{ role: 'user', content: 'next' }], onClause: () => {} });

    assert.notEqual(one.toolUses[0].id, two.toolUses[0].id);
    validateToolPairing({
      messages: [
        { role: 'assistant', content: one.raw },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_first', content: 'ok' }] },
        { role: 'assistant', content: two.raw },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_second', content: 'ok' }] },
      ],
    });
  });

  test('an empty text block is never emitted', async () => {
    // The API rejects a content block whose text is "". A stream that
    // opens a text block and sends only whitespace must not produce one.
    const { client } = sseClient([[start, ...textBlock(0, '   '), ...toolBlock(1, 'toolu_x', 'x', '{}'), stop]]);
    const res = await client.stream!({ system: 's', messages: [{ role: 'user', content: 'hi' }], onClause: () => {} });
    assert.deepEqual((res.raw as Record<string, unknown>[]).map((b) => b.type), ['tool_use']);
  });

  test('the serialized request itself is well formed', async () => {
    const { client, sent } = sseClient([[start, ...toolBlock(0, 'toolu_1', 't', '{}'), stop]]);
    const res = await client.stream!({
      system: 'SYS', messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 't', input_schema: {} }], onClause: () => {},
    });
    await client.stream!({
      system: 'SYS',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: res.raw },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      ],
      onClause: () => {},
    });
    // The second request is the one that used to 400.
    validateToolPairing(sent[1] as never);
    assert.equal(sent[1].stream, true);
  });
});

describe('prompt caching', () => {
  test('a prefix becomes two blocks with the breakpoint between them', () => {
    const field = buildSystemField('STATICDYNAMIC', 'STATIC') as Record<string, unknown>[];
    assert.equal(field.length, 2);
    assert.deepEqual(field[0].cache_control, { type: 'ephemeral' });
    assert.equal(field[0].text, 'STATIC');
    assert.equal(field[1].text, 'DYNAMIC');
    assert.equal(field[1].cache_control, undefined);
  });

  test('the two blocks rejoin to exactly the original prompt', () => {
    const system = 'STATIC PART\n\n---\n\nDYNAMIC PART';
    const field = buildSystemField(system, 'STATIC PART\n\n---\n\n') as Record<string, unknown>[];
    assert.equal(field.map((b) => b.text).join(''), system, 'caching must not change what the model reads');
  });

  test('a prefix that is not really a prefix is ignored rather than corrupting the prompt', () => {
    assert.equal(buildSystemField('HELLO', 'NOPE'), 'HELLO');
  });

  test('no prefix means a plain string, as before', () => {
    assert.equal(buildSystemField('HELLO'), 'HELLO');
  });

  test('a prefix equal to the whole prompt is not split', () => {
    // Nothing would follow the breakpoint, so there is no cache to win.
    assert.equal(buildSystemField('HELLO', 'HELLO'), 'HELLO');
  });

  test('only the last tool carries the breakpoint', () => {
    const tools = withToolCache([{ name: 'a' }, { name: 'b' }, { name: 'c' }]) as Record<string, unknown>[];
    assert.equal(tools[0].cache_control, undefined);
    assert.equal(tools[1].cache_control, undefined);
    assert.deepEqual(tools[2].cache_control, { type: 'ephemeral' });
  });

  test('caching leaves the tool definitions themselves untouched', () => {
    const original = { name: 'a', input_schema: { type: 'object' } };
    const [out] = withToolCache([original]) as Record<string, unknown>[];
    assert.equal(out.name, 'a');
    assert.deepEqual(out.input_schema, { type: 'object' });
    assert.equal((original as Record<string, unknown>).cache_control, undefined, 'must not mutate the caller’s array');
  });
});

describe('history trimming and summarisation cannot orphan a tool_result', () => {
  /**
   * The structural guarantee.
   *
   * Tool blocks never enter session.turns — that store holds plain
   * strings, and the per-turn `convo` array that carries tool_use and
   * tool_result is local to one runTurn call and discarded with it. So
   * the window slice and the rolling summary, which both read only
   * turn.text, have nothing to cut in half.
   *
   * These tests pin that invariant. If someone later persists raw
   * blocks into session.turns to "keep tool context", trimming becomes
   * able to drop an assistant tool_use while keeping its tool_result,
   * and the API rejects the call — the same 400 as the streaming bug,
   * from a different direction.
   */
  test('a tool exchange never lands in the transcript', async () => {
    const sessions = new SessionStore();
    const callSid = 'CAtrim';
    sessions.ensure(callSid, '+1', '+2');
    sessions.addTurn(callSid, 'caller', 'my car is wrecked');
    sessions.addTurn(callSid, 'agent', 'Is it drivable?');

    const session = sessions.get(callSid)!;
    for (const turn of session.turns) {
      assert.equal(typeof turn.text, 'string', 'turns hold strings, never content blocks');
    }
    assert.ok(
      !JSON.stringify(session.turns).includes('tool_use'),
      'a tool_use block in the transcript is what would make trimming unsafe',
    );
  });

  test('the rebuilt window is all plain strings, whatever happened during the call', () => {
    const sessions = new SessionStore();
    const callSid = 'CAwindow';
    sessions.ensure(callSid, '+1', '+2');
    // More turns than the window, so a slice definitely happens.
    for (let i = 0; i < HISTORY_WINDOW + 10; i += 1) {
      sessions.addTurn(callSid, i % 2 === 0 ? 'caller' : 'agent', `turn ${i}`);
    }
    const session = sessions.get(callSid)!;
    const messages = session.turns
      .slice(-HISTORY_WINDOW)
      .map((t) => ({ role: t.role === 'caller' ? 'user' : 'assistant', content: t.text }));

    assert.equal(messages.length, HISTORY_WINDOW);
    for (const m of messages) assert.equal(typeof m.content, 'string');
    // No orphan is possible when no block exists to orphan.
    validateToolPairing({ messages });
  });

  test('a trimmed window that starts mid-exchange is still valid', () => {
    const sessions = new SessionStore();
    const callSid = 'CAmid';
    sessions.ensure(callSid, '+1', '+2');
    for (let i = 0; i < 30; i += 1) sessions.addTurn(callSid, i % 2 === 0 ? 'caller' : 'agent', `t${i}`);
    const session = sessions.get(callSid)!;

    // Slice at every offset — none may produce an unpaired tool_result.
    for (let cut = 0; cut < 25; cut += 1) {
      const messages = session.turns.slice(cut, cut + HISTORY_WINDOW)
        .map((t) => ({ role: t.role === 'caller' ? 'user' : 'assistant', content: t.text }));
      validateToolPairing({ messages });
    }
  });

  test('the summary is built from text alone, so compaction cannot drop a tool block', () => {
    const sessions = new SessionStore();
    const callSid = 'CAsum';
    sessions.ensure(callSid, '+1', '+2');
    sessions.addTurn(callSid, 'caller', 'tow it please');
    sessions.addTurn(callSid, 'agent', 'A truck is on the way.');
    const session = sessions.get(callSid)!;

    // Exactly what summariseIfDue feeds the model.
    const transcript = session.turns
      .map((t) => `${t.role === 'caller' ? 'Caller' : 'Agent'}: ${t.text}`)
      .join('\n');
    assert.ok(!transcript.includes('tool_use'));
    assert.ok(!transcript.includes('tool_result'));

    session.summary = { text: 'Caller needs a tow.', throughTurn: 2 };
    assert.equal(typeof session.summary.text, 'string', 'a summary is prose, not blocks');
  });

  test('an interrupted turn is shortened, never turned into a block', () => {
    const sessions = new SessionStore();
    const callSid = 'CAint';
    sessions.ensure(callSid, '+1', '+2');
    sessions.addTurn(callSid, 'agent', 'Absolutely, we can help you get that sorted. Is the car still drivable?');
    const dropped = sessions.truncateLastAgentTurn(callSid, 'Absolutely, we can');
    const session = sessions.get(callSid)!;

    assert.equal(session.turns[0].text, 'Absolutely, we can');
    assert.equal(session.turns[0].interrupted, true);
    assert.ok(dropped && dropped.length > 0);
    assert.equal(typeof session.turns[0].text, 'string');
  });

  test('truncation refuses a value that is not a prefix rather than corrupting the record', () => {
    const sessions = new SessionStore();
    const callSid = 'CAbad';
    sessions.ensure(callSid, '+1', '+2');
    sessions.addTurn(callSid, 'agent', 'Is the car still drivable?');
    assert.equal(sessions.truncateLastAgentTurn(callSid, 'something else entirely'), null);
    assert.equal(sessions.get(callSid)!.turns[0].text, 'Is the car still drivable?');
  });
});

describe('dynamic tool loading', () => {
  function sessionFor(said: string[], qualification: Record<string, unknown> = {}) {
    const sessions = new SessionStore();
    const callSid = 'CAtools';
    const session = sessions.ensure(callSid, '+1', '+2');
    session.route = { ...session.route, industry: 'collision_repair' };
    Object.assign(session.qualification, qualification);
    for (const text of said) sessions.addTurn(callSid, 'caller', text);
    return session;
  }
  const names = (s: ReturnType<typeof sessionFor>) => toolsFor('collision_repair', undefined, s).map((t) => t.name);

  test('an ordinary opening turn does not carry every schema', () => {
    const before = toolsFor('collision_repair', undefined).length;
    const after = names(sessionFor(['I need an estimate on a scratched door'])).length;
    assert.ok(after < before, `expected fewer than ${before} schemas, got ${after}`);
  });

  test('an appointment cannot be changed before one exists', () => {
    assert.ok(!names(sessionFor(['I need an estimate'])).includes('change_appointment'));
    assert.ok(names(sessionFor(['I need an estimate'], { appointmentId: 'evt_1' })).includes('change_appointment'));
  });

  test('towing appears the moment the car cannot move', () => {
    assert.ok(!names(sessionFor(['I want an estimate on a dented bumper'])).includes('dispatch_tow'));
    assert.ok(names(sessionFor(['it wont drive'], { vehicleDrivable: false })).includes('dispatch_tow'));
    assert.ok(names(sessionFor(['can you tow it'])).includes('dispatch_tow'));
  });

  test('unlocking is one-way — a tool never vanishes mid-call', () => {
    const session = sessionFor(['can you tow it?']);
    assert.ok(names(session).includes('dispatch_tow'));
    // The subject moves on. The truck must not disappear from under a
    // model that is halfway through arranging it.
    session.turns.push({ role: 'caller', text: 'anyway, about the paint', at: new Date().toISOString() });
    assert.ok(names(session).includes('dispatch_tow'), 'a tool that flickers is worse than one always present');
  });

  test('what the agent said is not evidence of what the caller wants', () => {
    const sessions = new SessionStore();
    const session = sessions.ensure('CAagent', '+1', '+2');
    session.route = { ...session.route, industry: 'collision_repair' };
    // The agent mentioning towing must not unlock it.
    sessions.addTurn('CAagent', 'agent', 'We can arrange a tow if you need one.');
    sessions.addTurn('CAagent', 'caller', 'It drives fine, just cosmetic.');
    assert.ok(!toolsFor('collision_repair', undefined, session).map((t) => t.name).includes('dispatch_tow'));
  });

  test('tools with no certain precondition are always available', () => {
    // Getting this wrong removes a capability, which is far worse than
    // the tokens it saves.
    const always = names(sessionFor(['hello']));
    for (const t of ['capture_details', 'end_call', 'transfer_to_human', 'save_lead', 'check_availability', 'book_appointment']) {
      assert.ok(always.includes(t), `${t} must never be gated`);
    }
  });

  test('gating does not invent tools the industry never had', () => {
    const roofing = toolsFor('roofing', undefined, sessionFor(['can you tow it'])).map((t) => t.name);
    assert.ok(!roofing.includes('dispatch_tow'), 'a roofer does not tow');
  });
});
