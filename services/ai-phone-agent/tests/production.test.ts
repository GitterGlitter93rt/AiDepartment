// Production-hardening behaviour: signature validation, request
// guards, config defaults for the VPS, and scenario re-routing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { expectedSignature, validateTwilioSignature, formToRecord } from '../src/twilio/signature.ts';
import { RateLimiter, readBodyLimited, clientIp, MAX_BODY_BYTES } from '../src/http/guards.ts';
import { detectScenarioChange } from '../src/core/router.ts';
import { loadConfig } from '../src/config.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { createStubClaudeClient, createRecordingClaudeClient } from '../src/claude/client.ts';
import { createLogger } from '../src/logger.ts';
import { PATHS } from '../src/http/paths.ts';
import { conversationRelayTwiml, transferTwiml, hangupTwiml } from '../src/twilio/twiml.ts';
import { executeToolRequest } from '../src/core/tool-protocol.ts';
import { createMockCalendar } from '../src/tools/calendar.ts';
import { createMockSms } from '../src/tools/sms.ts';
import { createTransferTool } from '../src/tools/transfer.ts';
import { createPlaceholderCrm } from '../src/tools/crm.ts';

describe('Twilio signature validation', () => {
  const token = 'test_auth_token_value';
  const url = 'https://voice.youraidepartment.ai/twilio/incoming';
  const params = { CallSid: 'CA123', From: '+15551234567', To: '+15559998888' };

  test('accepts a correctly signed request', () => {
    const sig = expectedSignature(token, url, params);
    assert.equal(validateTwilioSignature(token, sig, url, params), true);
  });

  test('rejects a tampered parameter', () => {
    const sig = expectedSignature(token, url, params);
    assert.equal(validateTwilioSignature(token, sig, url, { ...params, From: '+19995550000' }), false);
  });

  test('rejects a different URL — a signature cannot be replayed elsewhere', () => {
    const sig = expectedSignature(token, url, params);
    assert.equal(validateTwilioSignature(token, sig, 'https://evil.example/twilio/incoming', params), false);
  });

  test('rejects a missing or empty signature', () => {
    assert.equal(validateTwilioSignature(token, undefined, url, params), false);
    assert.equal(validateTwilioSignature(token, '', url, params), false);
  });

  test('rejects when no auth token is configured (fails closed)', () => {
    const sig = expectedSignature(token, url, params);
    assert.equal(validateTwilioSignature('', sig, url, params), false);
  });

  test('parameter order does not affect the signature', () => {
    const a = expectedSignature(token, url, { B: '2', A: '1' });
    const b = expectedSignature(token, url, { A: '1', B: '2' });
    assert.equal(a, b);
  });

  test('form bodies parse into the signed record shape', () => {
    assert.deepEqual(formToRecord('CallSid=CA1&From=%2B15551234567'), { CallSid: 'CA1', From: '+15551234567' });
  });
});

describe('Request guards', () => {
  test('rate limiter allows up to the limit then blocks', () => {
    const rl = new RateLimiter(3, 1000);
    const t = 1_000_000;
    assert.equal(rl.check('1.2.3.4', t), true);
    assert.equal(rl.check('1.2.3.4', t), true);
    assert.equal(rl.check('1.2.3.4', t), true);
    assert.equal(rl.check('1.2.3.4', t), false, 'fourth request in the window is blocked');
  });

  test('the window resets and other clients are unaffected', () => {
    const rl = new RateLimiter(1, 1000);
    const t = 2_000_000;
    assert.equal(rl.check('a', t), true);
    assert.equal(rl.check('a', t), false);
    assert.equal(rl.check('b', t), true, 'per-key, not global');
    assert.equal(rl.check('a', t + 1001), true, 'window resets');
  });

  test('sweeping keeps the map from growing without bound', () => {
    const rl = new RateLimiter(5, 1000);
    for (let i = 0; i < 50; i++) rl.check(`ip-${i}`, 3_000_000);
    assert.equal(rl.size, 50);
    rl.sweep(3_001_001);
    assert.equal(rl.size, 0);
  });

  test('oversized bodies are refused instead of buffered', async () => {
    async function* huge() { yield Buffer.alloc(MAX_BODY_BYTES + 1); }
    const r = await readBodyLimited(huge(), MAX_BODY_BYTES);
    assert.equal(r.truncated, true);
    assert.equal(r.body, '');
  });

  test('normal bodies read through intact', async () => {
    async function* small() { yield Buffer.from('CallSid=CA1'); }
    const r = await readBodyLimited(small());
    assert.equal(r.truncated, false);
    assert.equal(r.body, 'CallSid=CA1');
  });

  test('X-Forwarded-For is trusted only behind a proxy', () => {
    const headers = { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' };
    assert.equal(clientIp(headers, '10.0.0.1', true), '9.9.9.9', 'behind Nginx');
    assert.equal(clientIp(headers, '10.0.0.1', false), '10.0.0.1', 'direct: header must not be trusted');
  });
});

describe('VPS config defaults', () => {
  test('defaults to port 3001 on loopback', () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    assert.equal(cfg.port, 3001);
    assert.equal(cfg.host, '127.0.0.1', 'must not bind publicly by default');
  });

  test('production enables signature validation and proxy trust', () => {
    const prev = { ...process.env };
    process.env.NODE_ENV = 'production';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    try {
      const cfg = loadConfig();
      assert.equal(cfg.validateTwilioSignature, true);
      assert.equal(cfg.trustProxy, true);
    } finally { process.env = prev; }
  });

  test('signature validation cannot be enabled without an auth token', () => {
    const prev = { ...process.env };
    process.env.NODE_ENV = 'production';
    delete process.env.TWILIO_AUTH_TOKEN;
    try {
      assert.equal(loadConfig().validateTwilioSignature, false, 'no token -> cannot validate');
    } finally { process.env = prev; }
  });

  test('the health snapshot flags disabled signature validation', async () => {
    const { describeConfig } = await import('../src/config.ts');
    const snap = describeConfig(loadConfig({} as NodeJS.ProcessEnv));
    assert.equal(snap.twilioSignatureValidation, 'DISABLED');
  });
});

describe('Scenario re-routing on a demo call', () => {
  test('an explicit request to try another industry switches', () => {
    const c = detectScenarioChange('What about plumbing? Water is pouring under my sink.', 'attorneys');
    assert.equal(c.changed, true);
    assert.equal(c.reason, 'explicit');
    assert.equal(c.decision?.industry, 'plumbing');
  });

  test('a clear new scenario switches even without an explicit ask', () => {
    const c = detectScenarioChange('My roof started leaking after the storm.', 'attorneys');
    assert.equal(c.changed, true);
    assert.equal(c.reason, 'new-scenario');
    assert.equal(c.decision?.industry, 'roofing');
  });

  test('a passing mention during a divorce call does NOT hijack the persona', () => {
    for (const utterance of [
      'The roof of the marital home needs work but that is not why I called.',
      'We still own the house together.',
      'He wants to sell the property eventually.',
    ]) {
      const c = detectScenarioChange(utterance, 'attorneys');
      assert.equal(c.changed, false, `should have stayed in family law: "${utterance}"`);
    }
  });

  test('staying on topic never re-routes', () => {
    assert.equal(detectScenarioChange('We have two kids, aged 6 and 9.', 'attorneys').changed, false);
    assert.equal(detectScenarioChange('The water is off now.', 'plumbing').changed, false);
  });

  test('an explicit ask with no industry re-opens routing for the next turn', () => {
    const c = detectScenarioChange('Can I try another one?', 'attorneys');
    assert.equal(c.changed, true);
    assert.equal(c.decision, null, 'nothing to route to yet');
  });

  test('end to end: divorce call switches to plumbing and back to a fresh slate', async () => {
    const sessions = new SessionStore();
    const claude = createRecordingClaudeClient('Got it — let me take a couple of details.');
    const orch = new Orchestrator({
      sessions,
      claude,
      log: createLogger({}, () => {}),
    });

    await orch.handleCallerUtterance('CA_demo', "I'm going through a nasty divorce.");
    sessions.mergeQualification('CA_demo', { minorChildren: true });
    assert.equal(sessions.get('CA_demo')!.route.industry, 'attorneys');

    const switched = await orch.handleCallerUtterance('CA_demo', 'What about plumbing? Water is pouring under my sink.');
    assert.equal(sessions.get('CA_demo')!.route.industry, 'plumbing');
    assert.match(switched, /shut off|valve/i, 'opens as the plumbing agent');
    assert.deepEqual(sessions.get('CA_demo')!.qualification, {}, 'previous scenario answers do not carry over');

    await orch.handleCallerUtterance('CA_demo', 'Yes, I shut it off.');
    assert.match(claude.lastSystem(), /dispatcher for a plumbing company/i, 'plumbing brain is now in charge');
    assert.doesNotMatch(claude.lastSystem(), /family law/i, 'the divorce persona is fully gone');
  });
});

describe('Public path contract', () => {
  test('the derived relay URL matches the path the socket listens on', async () => {
    // These were duplicated and drifted: the derived URL said /relay
    // while the socket listened on /twilio/conversation. Twilio would
    // have dialled a non-existent path and every call would drop on
    // connect — invisible in tests until asserted, and only obvious on
    // a live call. Both now come from src/http/paths.ts.
    const { PATHS } = await import('../src/http/paths.ts');
    const prev = { ...process.env };
    process.env.PUBLIC_BASE_URL = 'https://voice.youraidepartment.ai';
    try {
      assert.equal(loadConfig().relayUrl, `wss://voice.youraidepartment.ai${PATHS.relay}`);
    } finally { process.env = prev; }

    assert.equal(PATHS.relay, '/twilio/conversation');
    assert.equal(PATHS.incoming, '/twilio/incoming');
    assert.equal(PATHS.status, '/twilio/status');
    assert.equal(PATHS.health, '/health');
  });

  test('ws:// is derived for a plain-http base URL', () => {
    const prev = { ...process.env };
    process.env.PUBLIC_BASE_URL = 'http://localhost:3001';
    try {
      assert.equal(loadConfig().relayUrl, 'ws://localhost:3001/twilio/conversation');
    } finally { process.env = prev; }
  });
});

describe('Warm transfer actually moves the call', () => {
  // ConversationRelay owns the media while it is running, so a transfer
  // cannot be a tool side effect. It has to be an <Dial> returned after
  // the relay lets go, which is what the action URL is for.
  test('the TwiML gives Twilio somewhere to come back to', () => {
    const xml = conversationRelayTwiml({
      relayUrl: 'wss://voice.example.com/twilio/conversation',
      welcomeGreeting: 'Thanks for calling.',
      actionUrl: 'https://voice.example.com/twilio/relay-action',
    });
    assert.match(xml, /<Connect action="https:\/\/voice\.example\.com\/twilio\/relay-action">/);
  });

  test('without an action URL the Connect element stays valid', () => {
    const xml = conversationRelayTwiml({
      relayUrl: 'wss://voice.example.com/twilio/conversation',
      welcomeGreeting: 'Thanks for calling.',
    });
    assert.match(xml, /<Connect>/);
    assert.doesNotMatch(xml, /action=/);
  });

  test('the dial does not override caller ID, so the human sees who is calling', () => {
    const xml = transferTwiml('+19045550100');
    assert.match(xml, /<Dial timeout="30">\+19045550100<\/Dial>/);
    assert.doesNotMatch(xml, /callerId/);
  });

  test('a transfer target is escaped, not interpolated raw', () => {
    assert.doesNotMatch(transferTwiml('+1904555<script>'), /<script>/);
  });

  test('requesting a transfer records the intent rather than cutting the media', async () => {
    // Ending the relay mid-turn would clip the last thing the agent
    // said to the caller.
    const sessions = new SessionStore();
    const s = sessions.ensure('CA_x');
    const out = await executeToolRequest(
      { id: 't', name: 'transfer_to_human', input: { reason: 'caller asked for a person' } },
      {
        tools: {
          calendar: createMockCalendar(), sms: createMockSms(),
          transfer: createTransferTool('+19045550100'), crm: createPlaceholderCrm(),
          modes: { calendar: 'mock', sms: 'mock' },
        },
        log: createLogger({}, () => {}),
        session: s,
      },
    );
    assert.equal(out.ok, true);
    assert.equal(s.pendingTransfer?.target, '+19045550100');
    assert.match(s.pendingTransfer!.summary, /caller|CA_x|unknown/i, 'carries context for whoever picks up');
  });

  test('the relay action path is one shared constant, not two strings', () => {
    // The relay path was a real bug once: config derived one path while
    // the socket listened on another, and every call dropped at connect.
    assert.equal(PATHS.relayAction, '/twilio/relay-action');
  });
});
