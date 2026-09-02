#!/usr/bin/env node
// Drives a full ConversationRelay call against a locally running
// service: webhook -> socket -> interim transcript -> final transcript
// -> streamed reply -> barge-in. The same shape as a real QA call, so
// the telemetry chain can be proved before anyone picks up a phone.
//
//   node tools/stub-anthropic.mjs &
//   ANTHROPIC_BASE_URL=http://127.0.0.1:3099 ANTHROPIC_API_KEY=stub \
//     PORT=3078 VALIDATE_TWILIO_SIGNATURE=false \
//     node --experimental-strip-types src/server.ts > /tmp/svc.log &
//   node tools/rehearse-call.mjs bargein
//   cat /tmp/svc.log | node tools/call-timeline.mjs
//
// This exercises our half of the call only. It cannot measure speech
// recognition, synthesis or playback, because none of those run here.

import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:3078';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call({ callSid, said, interruptAfterMs }) {
  const form = new URLSearchParams({ CallSid: callSid, From: '+19045551234', To: '+19046829345' });
  const twiml = await (await fetch(`${BASE}/twilio/incoming`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })).text();
  if (!twiml.includes('partialPrompts')) console.error('!! partialPrompts missing from TwiML');

  const ws = new WebSocket('ws://127.0.0.1:3078/twilio/conversation');
  await new Promise((r) => ws.on('open', r));
  const heard = [];
  ws.on('message', (m) => {
    const j = JSON.parse(m.toString());
    if (j.type === 'text' && j.token) heard.push(j.token);
  });

  ws.send(JSON.stringify({ type: 'setup', callSid, from: '+19045551234', to: '+19046829345' }));
  await sleep(60);

  for (const [i, utterance] of said.entries()) {
    // Interim transcripts as the caller talks, then the final one.
    ws.send(JSON.stringify({ type: 'prompt', voicePrompt: utterance.slice(0, 12), last: false }));
    await sleep(300);
    ws.send(JSON.stringify({ type: 'prompt', voicePrompt: utterance.slice(0, 30), last: false }));
    await sleep(400);
    ws.send(JSON.stringify({ type: 'prompt', voicePrompt: utterance, last: true }));

    if (interruptAfterMs && i === (Number(process.env.INTERRUPT_TURN ?? 0))) {
      await sleep(interruptAfterMs);
      ws.send(JSON.stringify({ type: 'interrupt', utteranceUntilInterrupt: 'Absolutely, we can' }));
    }
    await sleep(2500);
  }
  ws.close();
  await sleep(200);
  return heard;
}

const which = process.argv[2];
if (which === 'bargein') {
  const heard = await call({ callSid: 'CAtest-bargein', said: ['I wrecked my BMW and I need to get it fixed', "No, it won't drive"], interruptAfterMs: 500 });
  console.error('HEARD:', JSON.stringify(heard));
} else {
  const heard = await call({ callSid: 'CAtest-clean', said: ['I wrecked my BMW and I need to get it fixed'] });
  console.error('HEARD:', JSON.stringify(heard));
}
process.exit(0);
