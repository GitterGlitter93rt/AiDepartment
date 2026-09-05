import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

/**
 * The ConversationRelay socket, over a real WebSocket.
 *
 * The deployed service must accept the upgrade Twilio performs, and — with no
 * conversation source configured — close the socket rather than improvise a
 * conversation. That is the state it ships in.
 */

process.env['TWILIO_AUTH_TOKEN'] = 'relay-socket-test-token';
process.env['PUBLIC_VOICE_BASE_URL'] = 'https://voice.youraidepartment.ai';
process.env['SALES_VOICE_PORT'] = '0';

const { server, attachRelaySocket, setTurnProducerFactory } = await import('../src/server.ts');
const { loadSalesVoiceConfig } = await import('../src/config.ts');
const config = loadSalesVoiceConfig();

await attachRelaySocket();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
after(() => { server.close(); });

const relayUrl = `ws://127.0.0.1:${port}${config.paths.relay}`;

test('the relay socket accepts the upgrade Twilio performs', async () => {
  const socket = new WebSocket(relayUrl);
  await new Promise<void>((resolve, reject) => {
    socket.on('open', resolve);
    socket.on('error', reject);
  });
  assert.equal(socket.readyState, WebSocket.OPEN);
  socket.close();
});

test('a socket on any other path is refused', async () => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/twilio/conversation`);
  await assert.rejects(
    () => new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    }),
    /Unexpected server response/,
    'the receptionist relay path is not served here');
});

test('with no conversation source, the call is closed rather than improvised', async () => {
  const socket = new WebSocket(relayUrl);
  await new Promise<void>((resolve) => socket.on('open', () => resolve()));

  const received: string[] = [];
  socket.on('message', (data) => received.push(data.toString()));
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));

  socket.send(JSON.stringify({ type: 'setup', callSid: 'CA-socket-1',
    from: '+19046829345', to: '+19045550199' }));
  await closed;

  assert.deepEqual(received, [],
    'nothing is spoken to a caller when there is no researched basis for the call');
});

test('with a conversation source, the setup frame starts a session', async () => {
  setTurnProducerFactory(async () => ({
    opening: () => 'Hi, this is Alex with Your AI Department. This is a cold call.',
    async respond() { return { say: 'Understood.', terminal: false }; },
    finish() {},
  }));

  const socket = new WebSocket(relayUrl);
  await new Promise<void>((resolve) => socket.on('open', () => resolve()));
  const received: string[] = [];
  socket.on('message', (data) => received.push(data.toString()));

  socket.send(JSON.stringify({ type: 'setup', callSid: 'CA-socket-2',
    from: '+19046829345', to: '+19045550199' }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(received, [],
    'the greeting is Twilio\'s job; sending it again is how a caller hears it twice');

  socket.send(JSON.stringify({ type: 'prompt', voicePrompt: 'Hello?', last: true }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(received.length, 1);
  assert.equal(JSON.parse(received[0]!).token, 'Understood.');
  socket.close();
});
