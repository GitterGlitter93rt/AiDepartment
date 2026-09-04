import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { expectedSignature } from '../../voice-core/src/index.ts';

/**
 * The outbound service's HTTP surface.
 *
 * Signature validation is the whole security model of a public webhook, so it is
 * tested first and hardest: without it, anyone who learns the URL can start calls.
 */

process.env['TWILIO_AUTH_TOKEN'] = 'test-token-not-a-real-one';
process.env['PUBLIC_VOICE_BASE_URL'] = 'https://voice.youraidepartment.ai';

const { server } = await import('../src/server.ts');
const { loadSalesVoiceConfig } = await import('../src/config.ts');
const config = loadSalesVoiceConfig();

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
after(() => { server.close(); });

async function post(path: string, params: Record<string, string>, options: {
  sign?: boolean; token?: string;
} = {}) {
  const body = new URLSearchParams(params).toString();
  const publicUrl = new URL(path, 'https://voice.youraidepartment.ai').toString();
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (options.sign !== false) {
    headers['x-twilio-signature'] = expectedSignature(
      options.token ?? 'test-token-not-a-real-one', publicUrl, params);
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body });
  return { status: response.status, text: await response.text() };
}

test('health is answered on its own path, with no credential in it', async () => {
  const response = await fetch(`http://127.0.0.1:${port}${config.paths.health}`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes('test-token-not-a-real-one'), false);
  assert.match(body, /"twilioAuthToken": "present"/);
  assert.match(body, /"agentProfileId": "yad-sales-core-v1"/);
  assert.match(body, /\/outbound\/health/, 'separate from the receptionist health check');
});

test('the receptionist paths are not served by this process', async () => {
  for (const path of ['/health', '/twilio/incoming', '/twilio/conversation']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status, 404, `${path} belongs to the receptionist`);
  }
});

test('an unsigned webhook is refused', async () => {
  const result = await post(`${config.paths.incoming}?greeting=Hello`,
    { CallSid: 'CA1' }, { sign: false });
  assert.equal(result.status, 403);
  assert.equal(result.text.includes('ConversationRelay'), false,
    'a refused request must not hand out a relay URL');
});

test('a signature from the wrong token is refused', async () => {
  const result = await post(`${config.paths.incoming}?greeting=Hello`,
    { CallSid: 'CA1' }, { token: 'some-other-token' });
  assert.equal(result.status, 403);
});

test('a signed webhook gets relay TwiML pointing at this service', async () => {
  const result = await post(
    `${config.paths.incoming}?greeting=${encodeURIComponent('Hi, this is Alex.')}&callContextId=ctx-1`,
    { CallSid: 'CA1', From: '+19046829345', To: '+19045550142' });

  assert.equal(result.status, 200);
  assert.match(result.text, /<ConversationRelay /);
  assert.match(result.text, /wss:\/\/voice\.youraidepartment\.ai\/outbound\/twilio\/conversation/);
  assert.match(result.text, /welcomeGreeting="Hi, this is Alex\."/);
  assert.match(result.text, /interruptible="true"/);
});

test('a call with no opener hangs up rather than improvising one', async () => {
  const result = await post(config.paths.incoming,
    { CallSid: 'CA1', From: '+19046829345', To: '+19045550142' });
  assert.equal(result.status, 200);
  assert.match(result.text, /<Hangup\/>/);
  assert.equal(result.text.includes('ConversationRelay'), false,
    'no researched opener means no researched basis for the call');
});

test('the relay handing back control ends the call, not a transfer', async () => {
  const result = await post(config.paths.relayAction, { CallSid: 'CA1' });
  assert.equal(result.status, 200);
  assert.match(result.text, /<Hangup\/>/);
  assert.equal(result.text.includes('<Dial'), false,
    'warm transfer stays off until there is a reachable human');
});
