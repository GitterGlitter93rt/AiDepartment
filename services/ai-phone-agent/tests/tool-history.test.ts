import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeClient, buildSystemField, withToolCache } from '../src/claude/client.ts';

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
