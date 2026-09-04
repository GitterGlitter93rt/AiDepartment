import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, voicePaths, expectedSignature } from '../../voice-core/src/index.ts';
import { loadSalesVoiceConfig } from '../src/config.ts';
import { createSalesRelaySession, type Socket, type TurnProducer } from '../src/relaySession.ts';

/**
 * The isolation boundary between Production Outbound Sales, the inbound receptionist
 * and the demo line.
 * Authority: outbound-sales-brain-shared-twilio-number-dual-service-spec.md §4, §5, §7;
 * outbound-sales-brain-voice-runtime-reuse-audit.md §3.
 *
 * These are the assertions that must not quietly stop holding when someone later
 * adds a route, a greeting or a shortcut. Each one names the failure it prevents.
 */

const config = loadSalesVoiceConfig({} as NodeJS.ProcessEnv);

test('no outbound route exists on the receptionist surface', () => {
  // The reverse of the 404 test in server.test.ts: the receptionist's own path table
  // must contain nothing of ours, or a Twilio webhook pointed at the receptionist
  // could reach the sales agent.
  const receptionist = Object.values(PATHS) as string[];
  const outbound = Object.values(config.paths) as string[];

  for (const path of outbound) {
    assert.equal(receptionist.includes(path), false,
      `${path} appears on the receptionist surface`);
    assert.match(path, /^\/outbound\//,
      'every outbound route is namespaced, so neither service can shadow the other');
  }
  for (const path of receptionist) {
    assert.equal(outbound.includes(path), false,
      `${path} is a receptionist route and must not be served by outbound`);
  }
});

test('the two services cannot collide on a port, a health check or an env file', () => {
  assert.equal(config.port, 3002, 'the receptionist keeps 3001');
  assert.equal(config.paths.health, '/outbound/health');
  assert.notEqual(config.paths.health, PATHS.health);

  const unit = readFileSync(new URL('../deploy/yad-sales-voice.service', import.meta.url), 'utf8');
  assert.match(unit, /EnvironmentFile=\/etc\/yad-sales-voice\.env/,
    'its own secrets file, so an outbound compromise cannot read inbound credentials');
  assert.equal(unit.includes('/etc/yad-voice-agent.env'), false);
  assert.match(unit, /SyslogIdentifier=yad-sales-voice/);
  assert.match(unit, /User=yadsalesvoice/);
  // Inbound wins a contended host: a customer already on the phone matters more than
  // an outbound attempt.
  assert.match(unit, /CPUWeight=50/);
});

test('the nginx locations add outbound routes and change none of the receptionist ones', () => {
  const conf = readFileSync(
    new URL('../deploy/nginx-outbound-locations.conf', import.meta.url), 'utf8');
  // Only real directives: a `location` at the start of a line, not the word in prose.
  const locations = [...conf.matchAll(/^\s*location\s+([^\s{]+)/gm)].map((match) => match[1]!);
  assert.ok(locations.length > 0);
  for (const location of locations) {
    assert.match(location, /^\/outbound/,
      `${location} would take a route away from the receptionist`);
  }
  assert.match(conf, /proxy_read_timeout\s+3600s/, 'the call socket gets the long timeout');
  // A location block cannot contain an upstream, so the two live in separate files.
  assert.equal(/^\s*upstream/m.test(conf), false,
    'an upstream inside a server block is a configuration error');
});

test('the nginx upstream is a separate http-level file', () => {
  const conf = readFileSync(
    new URL('../deploy/nginx-outbound-upstream.conf', import.meta.url), 'utf8');
  assert.match(conf, /upstream yad_sales_voice/);
  assert.match(conf, /server\s+127\.0\.0\.1:3002/);
  assert.equal(/^\s*location/m.test(conf), false,
    'a location at http level is a configuration error');
  // The upgrade map is named uniquely so it cannot collide with one the receptionist
  // already defines.
  assert.match(conf, /yad_outbound_connection_upgrade/);
});

test('the deploy script refuses a moving branch tip and never touches inbound', () => {
  const script = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
  assert.match(script, /--sha is required/,
    'deploying a branch tip is how a reviewed SHA stops meaning anything');
  assert.match(script, /INBOUND_UNIT="yad-voice-agent\.service"/);
  assert.match(script, /is no longer active\. That is a deployment failure/);
  // It must not restart, stop, disable or rewrite the receptionist.
  for (const forbidden of [/systemctl (?:restart|stop|disable) "?\$INBOUND_UNIT/,
                           /> ?\/etc\/yad-voice-agent\.env/,
                           /rm .*yad-voice-agent/]) {
    assert.equal(forbidden.test(script), false, `deploy.sh matches ${forbidden}`);
  }
});

test('the env template carries no value, and forbids arming from a file', () => {
  const template = readFileSync(
    new URL('../deploy/yad-sales-voice.env.example', import.meta.url), 'utf8');
  assert.match(template, /^TWILIO_ACCOUNT_SID=$/m, 'the template is blank');
  assert.match(template, /^TWILIO_AUTH_TOKEN=$/m);
  assert.match(template, /^OUTBOUND_APPROVED_CALLER_IDS=$/m);
  assert.match(template, /TWILIO_VALIDATE_SIGNATURES=true/);
  assert.match(template, /Do not add OUTBOUND_DIAL_ENABLED/,
    'the pilot mode lives in the database so a restart cannot arm it');
  // Nothing that looks like a real credential.
  assert.equal(/AC[0-9a-f]{32}|[0-9a-f]{32}/.test(template), false);
});

test('the outbound service decides no sales dialogue of its own', () => {
  // Everything spoken has to arrive from the canonical sales brain. A greeting or a
  // reply written into this package would be a second, untested salesperson.
  // Only the files that can put words on a call. The benchmark's scenario data is
  // full of sentences, but they are things a *prospect* says in a fixture — the rule
  // is about lines the agent speaks.
  const speechCapable = ['server.ts', 'relaySession.ts', 'config.ts'];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (speechCapable.some((name) => full.endsWith(name))) files.push(full);
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  assert.equal(files.length, speechCapable.length,
    'every speech-capable file is covered; add a new one to the list deliberately');

  const sentenceLike = /['"`][A-Z][a-z]+(?:[ ,][a-z']+){4,}[.?!]['"`]/;
  const offenders: string[] = [];
  for (const file of files) {
    const code = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
      })
      .join('\n');
    // Log messages and business messages are allowed to be sentences; anything sent
    // to a caller is not written here.
    for (const match of code.matchAll(new RegExp(sentenceLike, 'g'))) {
      if (/log\.log|msg:|reason:|Error\(|fallbackTwiml/.test(
        code.slice(Math.max(0, match.index! - 80), match.index! + 40))) continue;
      offenders.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [],
    'a line spoken to a prospect belongs in the sales brain, where it is graded');
});

// --- the required regressions, one place -------------------------------------

function fakeSocket() {
  const sent: string[] = [];
  let closed = 0;
  const socket: Socket = { send: (data) => sent.push(data), close: () => { closed += 1; } };
  return { socket, sent, get closes() { return closed; } };
}

function producer(reply: (utterance: string) => { say: string; terminal: boolean }): TurnProducer
  & { finished: string[] } {
  const finished: string[] = [];
  return {
    finished,
    opening: () => 'Hi, this is Alex with Your AI Department. This is a cold call.',
    async respond(utterance, signal) {
      if (signal.aborted) throw new Error('aborted');
      return reply(utterance);
    },
    finish(reason) { finished.push(reason); },
  };
}

const SINK = { log: () => {} };

async function session(p: TurnProducer) {
  const relay = createSalesRelaySession({ producer: p, sink: SINK });
  const ref = { current: '' };
  const io = fakeSocket();
  await relay.handle(io.socket, JSON.stringify({
    type: 'setup', callSid: 'CA-iso-1', from: '+19046829345', to: '+19045550142' }), ref);
  return { relay, ref, io };
}

test('a repeated end-of-call event closes the call exactly once', async () => {
  const p = producer(() => ({ say: 'Thanks for your time.', terminal: true }));
  const { relay, ref, io } = await session(p);

  await relay.handle(io.socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'Not interested, thanks.', last: true }), ref);
  // Twilio can deliver an error or a hang-up after a call has already ended.
  await relay.handle(io.socket, JSON.stringify({ type: 'error', description: 'stream closed' }), ref);
  await relay.hangUp('CA-iso-1');

  assert.deepEqual(p.finished, ['completed'],
    'a late event must not overwrite how the call actually ended');
  assert.equal(io.closes, 1, 'and must not close the socket twice');
});

test('a stale generated turn is discarded rather than spoken', async () => {
  let release: (() => void) | undefined;
  const slow: TurnProducer = {
    opening: () => 'Opening line.',
    async respond(_utterance, signal) {
      await new Promise<void>((resolve) => { release = resolve; });
      if (signal.aborted) throw new Error('aborted');
      return { say: 'This should never be spoken.', terminal: false };
    },
    finish() {},
  };
  const { relay, ref, io } = await session(slow);

  const pending = relay.handle(io.socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'Tell me more.', last: true }), ref);
  await relay.handle(io.socket, JSON.stringify({
    type: 'interrupt', utteranceUntilInterrupt: '' }), ref);
  release?.();
  await pending;

  assert.deepEqual(io.sent, [],
    'the caller moved on; sending this would be the agent talking over them');
});

test('an unsigned webhook is rejected before any relay URL is handed out', async () => {
  // Held here as well as in server.test.ts because this is the property that keeps a
  // public endpoint from being used to start calls by anyone who learns the URL.
  const token = 'isolation-token-not-a-real-one';
  const url = 'https://voice.youraidepartment.ai/outbound/twilio/incoming';
  const params = { CallSid: 'CA1' };
  const good = expectedSignature(token, url, params);
  const { validateTwilioSignature } = await import('../../voice-core/src/index.ts');

  assert.equal(validateTwilioSignature(token, good, url, params), true);
  assert.equal(validateTwilioSignature(token, undefined, url, params), false);
  assert.equal(validateTwilioSignature(token, 'not-a-signature', url, params), false);
  assert.equal(validateTwilioSignature(token, good, url, { CallSid: 'CA2' }), false);
});

test('an outbound service mounted with no prefix would still not answer inbound', () => {
  // Somebody may one day set SALES_VOICE_PATH_PREFIX to empty. That collapses the
  // namespacing, so the test states plainly what that costs.
  const collapsed = voicePaths('');
  assert.equal(collapsed.incoming, PATHS.incoming);
  const configured = loadSalesVoiceConfig({} as NodeJS.ProcessEnv);
  assert.match(configured.paths.incoming, /^\/outbound\//,
    'the default must stay namespaced; an empty prefix is an explicit operator choice');
});
