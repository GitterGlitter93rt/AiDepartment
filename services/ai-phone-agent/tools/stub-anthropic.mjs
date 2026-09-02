// Stands in for the Anthropic Messages API, speaking real SSE with a
// configurable time-to-first-token and inter-token delay so the
// telemetry chain can be exercised end to end without a key.
import { createServer } from 'node:http';

const TTFT = Number(process.env.STUB_TTFT_MS ?? 420);
const GAP = Number(process.env.STUB_TOKEN_GAP_MS ?? 18);
const REPLY = process.env.STUB_REPLY
  ?? 'Absolutely, we can help you get that sorted. Is the car still drivable?';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);

  frame({ type: 'message_start', message: { usage: { input_tokens: 1530 } } });
  await sleep(TTFT);
  frame({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });
  for (const tok of REPLY.match(/\S+\s*/g) ?? []) {
    if (res.writableEnded) return;
    frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: tok } });
    await sleep(GAP);
  }
  frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 22 } });
  frame({ type: 'message_stop' });
  res.end();
}).listen(3099, '127.0.0.1', () => console.error('stub anthropic on 3099'));
