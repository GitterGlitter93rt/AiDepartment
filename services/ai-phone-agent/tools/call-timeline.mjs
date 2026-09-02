#!/usr/bin/env node
// Turns a service log into the live-call QA table.
//
//   sudo journalctl -u yad-voice-agent --since "10 min ago" -o cat \
//     | node tools/call-timeline.mjs
//
// Reads JSON log lines on stdin, groups timeline marks by CallSid, and
// prints per-turn latency for each call. Anything that is not a JSON
// line is ignored, so piping raw journalctl output works.
//
// Every number here is a measurement. Where a number cannot be
// measured — the moment the caller physically hears audio — the table
// says so rather than estimating it.

const MARKS = [
  'CALL_CONNECTED',
  'WELCOME_GREETING_SENT',
  'WEBSOCKET_CONNECTED',
  'RELAY_SETUP_RECEIVED',
  'FIRST_AGENT_AUDIO_PROXY',
  'FIRST_CALLER_SPEECH',
  'CALLER_END_OF_TURN',
  'TURN_HANDLER_START',
  'CLAUDE_REQUEST_START',
  'CLAUDE_FIRST_STREAM_EVENT',
  'FIRST_SPEAKABLE_CLAUSE',
  'FIRST_TEXT_SENT_TO_CONVERSATION_RELAY',
  'TURN_COMPLETE',
  'INTERRUPT_RECEIVED',
  'CLAUDE_ABORTED',
  'CALL_ENDED',
];

function read(stream) {
  return new Promise((res) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => { buf += d; });
    stream.on('end', () => res(buf));
  });
}

const raw = await read(process.stdin);
const calls = new Map();

for (const line of raw.split('\n')) {
  const start = line.indexOf('{');
  if (start === -1) continue;
  let rec;
  try { rec = JSON.parse(line.slice(start)); } catch { continue; }
  if (!rec || !rec.callSid) continue;
  if (!calls.has(rec.callSid)) calls.set(rec.callSid, { marks: [], meta: {} });
  const call = calls.get(rec.callSid);
  if (rec.event === 'timeline') call.marks.push(rec);
  if (rec.event === 'router.decision') call.meta.route = `${rec.industry}/${rec.specialty}/${rec.intent} (${rec.confidence})`;
  if (rec.event === 'turn.latency') call.meta.lastReplyChars = rec.replyChars;
  if (rec.event === 'transcript.caller') (call.meta.said ??= []).push(rec.text);
  if (rec.event === 'transcript.agent') (call.meta.replied ??= []).push(rec.text);
}

if (calls.size === 0) {
  console.error('No timeline marks found. Is the service on a build with telemetry, and did a call actually connect?');
  process.exit(1);
}

const ms = (v) => (v === undefined || v === null || Number.isNaN(v) ? '—' : `${Math.round(v)}ms`);
const pad = (s, n) => String(s).padEnd(n);

for (const [callSid, call] of calls) {
  const at = (mark, turn) => call.marks.find((m) => m.mark === mark && (turn === undefined || m.turn === turn))?.atMs;
  const rec = (mark, turn) => call.marks.find((m) => m.mark === mark && (turn === undefined || m.turn === turn));

  console.log('');
  console.log('='.repeat(78));
  console.log(`CALL ${callSid}`);
  if (call.meta.route) console.log(`route: ${call.meta.route}`);
  console.log('='.repeat(78));

  // ---- Call start ----
  const greetingSent = at('WELCOME_GREETING_SENT');
  const wsUp = at('WEBSOCKET_CONNECTED');
  console.log('\nCALL START');
  console.log(`  webhook -> TwiML written            ${pad(ms(greetingSent), 10)}  our code`);
  console.log(`  webhook -> relay socket open        ${pad(ms(wsUp), 10)}  Twilio round trip`);
  const gw = rec('WELCOME_GREETING_SENT')?.greetingWords;
  if (gw !== undefined) {
    // ~2.75 words/second is a normal TTS delivery rate. Labelled an
    // estimate because it is one: nothing in this process observes
    // playback, and the caller can talk over the greeting anyway.
    console.log(`  greeting length                     ${pad(`${gw} words`, 10)}  ~${(gw / 2.75).toFixed(1)}s to speak (ESTIMATE, not measured)`);
  }
  console.log(`  caller hears first audio            ${pad('NOT MEASURABLE', 10)}  Twilio owns synthesis + playback`);
  console.log('    proxy: relay socket open, above. True figure needs a stopwatch on a handset.');

  // ---- Turns ----
  const turns = [...new Set(call.marks.map((m) => m.turn))].filter((t) => t > 0).sort((a, b) => a - b);
  for (const turn of turns) {
    const speech = at('FIRST_CALLER_SPEECH', turn);
    const eot = at('CALLER_END_OF_TURN', turn);
    const handler = at('TURN_HANDLER_START', turn);
    const reqStart = at('CLAUDE_REQUEST_START', turn);
    const ttft = at('CLAUDE_FIRST_STREAM_EVENT', turn);
    const clause = at('FIRST_SPEAKABLE_CLAUSE', turn);
    const sent = at('FIRST_TEXT_SENT_TO_CONVERSATION_RELAY', turn);
    const done = at('TURN_COMPLETE', turn);
    const interrupt = at('INTERRUPT_RECEIVED', turn);
    const aborted = at('CLAUDE_ABORTED', turn);

    console.log(`\nTURN ${turn}`);
    const row = (label, value, owner) => console.log(`  ${pad(label, 36)}${pad(ms(value), 10)}  ${owner}`);
    const endpointing = speech !== undefined && eot !== undefined ? eot - speech : undefined;
    // A negative figure means the marks were attributed to the wrong
    // turn. Report it as broken rather than printing a nonsense number.
    row('caller speech -> end of turn', endpointing !== undefined && endpointing < 0 ? undefined : endpointing, endpointing !== undefined && endpointing < 0 ? 'BAD DATA — marks crossed turns' : 'ConversationRelay (endpointing)');
    row('end of turn -> handler start', eot !== undefined && handler !== undefined ? handler - eot : undefined, 'our code');
    row('handler start -> Claude request', handler !== undefined && reqStart !== undefined ? reqStart - handler : undefined, 'our code (prompt assembly)');
    if (reqStart === undefined && sent !== undefined) {
      // Not a gap in the data: some turns are answered from a
      // deterministic opening line and never reach the model at all.
      console.log(`  ${pad('(no model call this turn', 36)}${pad('', 10)}  deterministic opening line)`);
    }
    row('Claude request -> first token', reqStart !== undefined && ttft !== undefined ? ttft - reqStart : undefined, 'Anthropic (TTFT)');
    row('first token -> speakable clause', ttft !== undefined && clause !== undefined ? clause - ttft : undefined, 'our code (clause threshold)');
    row('clause -> sent to relay', clause !== undefined && sent !== undefined ? sent - clause : undefined, 'our code');
    console.log('  ' + '-'.repeat(74));
    row('END OF TURN -> FIRST TEXT SENT', eot !== undefined && sent !== undefined ? sent - eot : undefined, 'PERCEIVED SILENCE (best proxy)');
    row('end of turn -> turn complete', eot !== undefined && done !== undefined ? done - eot : undefined, 'full generation');
    const tc = rec('TURN_COMPLETE', turn);
    if (tc) {
      console.log(`  ${pad('reply', 36)}${pad(`${tc.replyChars ?? '?'} chars`, 10)}  ${tc.clauses ?? '?'} clause(s)`);
      if (tc.maxClauseGapMs !== undefined) {
        // The fragmentation check. A tiny opening clause followed by a
        // long gap is the audible seam, and it is the only reason to
        // raise the first-clause threshold.
        const risky = tc.firstClauseChars < 15 && tc.maxClauseGapMs > 400;
        console.log(`  ${pad('cadence', 36)}${pad(`${tc.firstClauseChars}ch 1st`, 10)}  max gap ${ms(tc.maxClauseGapMs)}${risky ? '   <-- LIKELY AUDIBLE SEAM' : ''}`);
      }
    }

    if (interrupt !== undefined) {
      console.log(`  ${pad('INTERRUPT_RECEIVED', 36)}${pad(ms(interrupt), 10)}  from call start`);
      row('interrupt -> generation aborted', aborted !== undefined ? aborted - interrupt : undefined, 'our code (barge-in share)');
      console.log(`  ${pad('interrupt -> playback stopped', 36)}${pad('NOT MEASURABLE', 10)}  ConversationRelay`);
    }
  }

  const ended = at('CALL_ENDED');
  if (ended !== undefined) console.log(`\n  call duration                       ${ms(ended)}`);
}

// ---- Aggregate ----
console.log('\n' + '='.repeat(78));
console.log('SUMMARY — perceived silence (end of turn -> first text sent)');
console.log('='.repeat(78));
const all = [];
for (const [callSid, call] of calls) {
  for (const turn of [...new Set(call.marks.map((m) => m.turn))].filter((t) => t > 0)) {
    const eot = call.marks.find((m) => m.mark === 'CALLER_END_OF_TURN' && m.turn === turn)?.atMs;
    const sent = call.marks.find((m) => m.mark === 'FIRST_TEXT_SENT_TO_CONVERSATION_RELAY' && m.turn === turn)?.atMs;
    if (eot !== undefined && sent !== undefined) all.push({ callSid, turn, v: sent - eot });
  }
}
if (all.length === 0) {
  console.log('  no completed turns');
} else {
  const sorted = all.map((a) => a.v).sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  console.log(`  turns measured  ${sorted.length}`);
  console.log(`  min / p50 / max ${ms(sorted[0])} / ${ms(p(0.5))} / ${ms(sorted[sorted.length - 1])}`);
  const slow = all.filter((a) => a.v > 1250);
  if (slow.length) {
    console.log(`  over 1250ms     ${slow.length}: ${slow.map((a) => `${a.callSid.slice(-6)}#${a.turn}=${ms(a.v)}`).join(', ')}`);
  } else {
    console.log('  over 1250ms     none');
  }
}
