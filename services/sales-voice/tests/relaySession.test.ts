import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSalesRelaySession, type Socket, type TurnProducer } from '../src/relaySession.ts';
import { loadSalesVoiceConfig, describeSalesVoiceConfig } from '../src/config.ts';

/**
 * The Production Outbound Sales relay session.
 *
 * Exercised without Twilio, without a socket and without the sales brain — which is
 * the point of keeping the turn producer injected.
 */

function fakeSocket() {
  const sent: string[] = [];
  let closed = false;
  const socket: Socket = { send: (data) => sent.push(data), close: () => { closed = true; } };
  return { socket, sent, get closed() { return closed; } };
}

function producer(options: {
  reply?: (utterance: string) => { say: string; terminal: boolean };
  delayMs?: number;
} = {}): TurnProducer & { finished: string[]; calls: string[] } {
  const finished: string[] = [];
  const calls: string[] = [];
  return {
    finished, calls,
    opening: () => 'Hi, this is Alex with Your AI Department. This is a cold call.',
    async respond(utterance, signal) {
      calls.push(utterance);
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (signal.aborted) throw new Error('aborted');
      return options.reply?.(utterance) ?? { say: 'Understood.', terminal: false };
    },
    finish(reason) { finished.push(reason); },
  };
}

const SINK = { log: () => {} };

async function setup(p: TurnProducer) {
  const session = createSalesRelaySession({ producer: p, sink: SINK });
  const ref = { current: '' };
  const io = fakeSocket();
  await session.handle(io.socket, JSON.stringify({
    type: 'setup', callSid: 'CA-outbound-1', from: '+19046829345', to: '+19045550142' }), ref);
  return { session, ref, io };
}

test('the opener is recorded, not spoken twice', async () => {
  const p = producer();
  const { session, io } = await setup(p);
  assert.deepEqual(io.sent, [],
    'the welcome greeting is Twilio\'s job; sending it again is how a caller hears it twice');
  const stored = session.sessions.get('CA-outbound-1')!;
  assert.equal(stored.turns.length, 1);
  assert.equal(stored.turns[0]!.role, 'agent');
});

test('an interim transcript is never answered', async () => {
  const p = producer();
  const { session, ref, io } = await setup(p);
  await session.handle(io.socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'We miss calls when', last: false }), ref);

  assert.deepEqual(p.calls, [], 'answering half a sentence is worse than any latency it saves');
  assert.deepEqual(io.sent, []);
  assert.equal(session.sessions.get('CA-outbound-1')!.state.utteranceOpen, true);
});

test('a final transcript produces exactly one turn', async () => {
  const p = producer({ reply: () => ({ say: 'So it waits until morning.', terminal: false }) });
  const { session, ref, io } = await setup(p);
  await session.handle(io.socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'We miss calls', last: false }), ref);
  await session.handle(io.socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'We miss calls when the crews are out.', last: true }), ref);

  assert.deepEqual(p.calls, ['We miss calls when the crews are out.']);
  assert.equal(io.sent.length, 1);
  assert.equal(JSON.parse(io.sent[0]!).token, 'So it waits until morning.');
  assert.equal(JSON.parse(io.sent[0]!).last, true, 'the turn is closed so the relay listens again');
});

test('a caller talking over the agent stops the turn in flight', async () => {
  const p = producer({ delayMs: 40 });
  const { session, ref, io } = await setup(p);

  const pending = session.handle(io.socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'Tell me more.', last: true }), ref);
  await session.handle(io.socket, JSON.stringify({
    type: 'interrupt', utteranceUntilInterrupt: '' }), ref);
  await pending;

  assert.deepEqual(io.sent, [],
    'an abandoned generation must not arrive and get spoken over the caller');
});

test('an interrupt trims the transcript to what the caller actually heard', async () => {
  const p = producer({ reply: () => ({
    say: 'I can look at that for you, and I can also send a short summary.', terminal: false }) });
  const { session, ref, io } = await setup(p);
  await session.handle(io.socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'Go on.', last: true }), ref);
  await session.handle(io.socket, JSON.stringify({
    type: 'interrupt', utteranceUntilInterrupt: 'I can look at that for you,' }), ref);

  const turns = session.sessions.get('CA-outbound-1')!.turns;
  const lastAgent = [...turns].reverse().find((turn) => turn.role === 'agent')!;
  assert.equal(lastAgent.text, 'I can look at that for you,');
  assert.equal(lastAgent.interrupted, true);
});

test('a terminal turn ends the call once', async () => {
  const p = producer({ reply: () => ({ say: 'Thanks for your time.', terminal: true }) });
  const { session, ref, io } = await setup(p);
  await session.handle(io.socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'Not interested, thanks.', last: true }), ref);

  assert.deepEqual(p.finished, ['completed']);
  assert.equal(io.closed, true);
  assert.ok(session.sessions.get('CA-outbound-1')!.endedAt);
});

test('a malformed frame changes nothing', async () => {
  const p = producer();
  const { session, ref, io } = await setup(p);
  await session.handle(io.socket, 'not json at all', ref);
  await session.handle(io.socket, JSON.stringify({ noType: true }), ref);
  assert.deepEqual(p.calls, []);
  assert.deepEqual(io.sent, []);
});

test('two calls do not see each other', async () => {
  const p = producer();
  const session = createSalesRelaySession({ producer: p, sink: SINK });
  const io = fakeSocket();
  const one = { current: '' };
  const two = { current: '' };
  await session.handle(io.socket, JSON.stringify({ type: 'setup', callSid: 'CA-a' }), one);
  await session.handle(io.socket, JSON.stringify({ type: 'setup', callSid: 'CA-b' }), two);
  await session.handle(io.socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'Only on A.', last: true }), one);

  assert.equal(session.sessions.get('CA-a')!.turns.some((t) => t.text === 'Only on A.'), true);
  assert.equal(session.sessions.get('CA-b')!.turns.some((t) => t.text === 'Only on A.'), false);
});

// --- configuration and isolation ---------------------------------------------

test('outbound mounts on its own paths and its own port', () => {
  const config = loadSalesVoiceConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.paths.relay, '/outbound/twilio/conversation');
  assert.equal(config.paths.health, '/outbound/health');
  assert.equal(config.relayUrl,
    'wss://voice.youraidepartment.ai/outbound/twilio/conversation');
  assert.equal(config.port, 3002, 'the receptionist keeps 3001');
  assert.equal(config.agentProfileId, 'yad-sales-core-v1');
});

test('signature validation is on unless explicitly turned off', () => {
  assert.equal(loadSalesVoiceConfig({} as NodeJS.ProcessEnv).validateSignatures, true);
  assert.equal(
    loadSalesVoiceConfig({ TWILIO_VALIDATE_SIGNATURES: 'false' } as NodeJS.ProcessEnv)
      .validateSignatures, false);
});

test('the health payload reports presence of a credential, never its value', () => {
  const config = loadSalesVoiceConfig(
    { TWILIO_AUTH_TOKEN: 'super-secret-token-value' } as NodeJS.ProcessEnv);
  const described = JSON.stringify(describeSalesVoiceConfig(config));
  assert.equal(described.includes('super-secret-token-value'), false);
  assert.match(described, /"twilioAuthToken":"present"/);
});
