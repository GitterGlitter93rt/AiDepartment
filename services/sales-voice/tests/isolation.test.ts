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

// --- deployment handoff: static checks on the tooling --------------------------

test('the deploy script records a baseline before it changes anything', () => {
  const script = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
  const baselineAt = script.indexOf('baseline: what is running before anything changes');
  const firstChange = Math.min(
    ...['useradd', 'install -m 0644', 'systemctl enable', 'systemctl reload nginx']
      .map((marker) => { const at = script.indexOf(marker); return at === -1 ? Infinity : at; }));
  assert.ok(baselineAt > 0, 'there is a baseline step');
  assert.ok(baselineAt < firstChange,
    'the baseline is captured before the first change, or it is not a baseline');
  for (const captured of ['systemctl list-units', 'nginx -T', 'ss -ltnp',
                          'rev-parse HEAD', 'cp -a /etc/nginx']) {
    assert.ok(script.includes(captured), `the baseline does not capture ${captured}`);
  }
});

test('the deploy script rolls nginx back if the configuration does not test', () => {
  const script = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
  assert.match(script, /if nginx -t; then/, 'the configuration is tested before a reload');
  assert.match(script, /restoring the site file/);
  // The restore happens from the backup taken in the same run.
  assert.match(script, /cp -a "\$BASELINE\/\$\(basename "\$SITE"\)\.before" "\$SITE"/);
  assert.match(script, /rm -f \/etc\/nginx\/snippets\/yad-outbound-locations\.conf/,
    'a failed reload removes the snippet it added');
});

test('the deploy script fails if the checkout is not the requested SHA', () => {
  const script = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
  assert.match(script, /if \[ "\$ACTUAL" != "\$SHA" \]/);
  assert.match(script, /Refusing to continue/);
  assert.match(script, /checkout --detach "\$SHA"/,
    'a detached checkout at an exact commit, not a branch that can move under it');
});

test('the deploy script fails loudly if inbound health breaks', () => {
  const script = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
  assert.match(script, /inbound \/health does not answer/);
  assert.match(script, /Investigate before going further/);
  // And it compares the before and after state of the receptionist rather than
  // assuming it was fine.
  assert.match(script, /INBOUND_WAS_ACTIVE=/);
  assert.match(script, /\[ "\$INBOUND_WAS_ACTIVE" = "active" \]/);
});

test('the deploy script is idempotent in every step that could duplicate', () => {
  const script = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
  for (const guard of [
    'if ! id -u "$SERVICE_USER"',            // the user is created once
    'if [ ! -d "$TARGET/.git" ]',            // the clone happens once
    'if [ ! -f "$ENV_FILE" ]',               // the env file is never overwritten
    'if grep -q \'yad-outbound-locations.conf\' "$SITE"',  // the include is added once
    'if [ ! -d "$TARGET/services/sales-voice/node_modules/ws" ]',
  ]) {
    assert.ok(script.includes(guard), `no guard for: ${guard}`);
  }
  assert.match(script, /set -euo pipefail/, 'it stops at the first failure');
});

test('the deploy script never overwrites the receptionist environment file', () => {
  const script = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
  // It may tighten permissions; it may not write content.
  const writes = [/>\s*\/etc\/yad-voice-agent\.env/, /install .*\/etc\/yad-voice-agent\.env/,
                  /sed -i .*\/etc\/yad-voice-agent\.env/, /tee .*yad-voice-agent\.env/];
  for (const pattern of writes) {
    assert.equal(pattern.test(script), false, `deploy.sh writes the inbound env file: ${pattern}`);
  }
});

test('the env file is created with permissions that exclude everyone else', () => {
  const script = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
  assert.match(script, /install -o root -g "\$SERVICE_USER" -m 0640/,
    'root owns it, the service user may read it, nobody else may');
});

test('the verify script checks isolation and prints no secret', () => {
  const script = readFileSync(new URL('../deploy/verify.sh', import.meta.url), 'utf8');
  for (const check of [
    'inbound /health status', 'agent profile', 'signature validation enforced',
    'outbound process rejects', 'inbound process rejects',
    'outbound cannot read the inbound env file',
    'outbound has a lower CPU weight than inbound',
  ]) {
    assert.ok(script.includes(check), `verify.sh does not check: ${check}`);
  }
  // It must never echo an environment value.
  assert.equal(/echo .*\$TWILIO_AUTH_TOKEN|echo .*\$\{TWILIO/.test(script), false);
  assert.match(script, /no secret-shaped value present/);
});

test('the unit gives inbound priority on a contended host', () => {
  const unit = readFileSync(new URL('../deploy/yad-sales-voice.service', import.meta.url), 'utf8');
  const weight = Number(/CPUWeight=(\d+)/.exec(unit)?.[1] ?? '100');
  assert.ok(weight < 100, `outbound CPUWeight is ${weight}; inbound must win contention`);
  assert.match(unit, /MemoryMax=/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /StartLimitBurst=/, 'a crash loop stops rather than flapping');
  assert.match(unit, /TimeoutStopSec=35/, 'long enough for a call in progress to finish');
});

test('the unit is hardened and cannot reach the rest of the filesystem', () => {
  const unit = readFileSync(new URL('../deploy/yad-sales-voice.service', import.meta.url), 'utf8');
  for (const directive of ['NoNewPrivileges=true', 'PrivateTmp=true', 'ProtectSystem=strict',
                           'ProtectHome=true', 'RestrictAddressFamilies=',
                           'ProtectKernelTunables=true']) {
    assert.ok(unit.includes(directive), `the unit is missing ${directive}`);
  }
  assert.match(unit, /ReadWritePaths=\/opt\/yad-sales-voice/,
    'writable only where the service lives');
});

test('the deploy tooling carries no credential of any kind', () => {
  for (const file of ['deploy.sh', 'verify.sh', 'yad-sales-voice.service',
                      'yad-sales-voice.env.example', 'nginx-outbound-locations.conf',
                      'nginx-outbound-upstream.conf']) {
    const text = readFileSync(new URL(`../deploy/${file}`, import.meta.url), 'utf8');
    assert.equal(/AC[0-9a-f]{32}|SK[0-9a-f]{32}|sk-ant-|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/
      .test(text), false, `${file} contains something credential-shaped`);
  }
});

// --- deployment handoff: the failure modes an operator will actually hit -------

const deployScript = () => readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
const rollbackScript = () => readFileSync(new URL('../deploy/rollback.sh', import.meta.url), 'utf8');
const operatorDoc = () => readFileSync(new URL('../deploy/OPERATOR.md', import.meta.url), 'utf8');

test('redeploying the same SHA changes nothing that holds state', () => {
  const script = deployScript();
  // The checkout is detached at an exact commit, so a second run of the same SHA is
  // the same tree. The env file, which is the only hand-entered state, is guarded.
  assert.match(script, /if \[ ! -f "\$ENV_FILE" \]/);
  assert.match(script, /already exists and was left alone/);
  // The include line is added at most once.
  assert.match(script, /include line already present/);
  // And the ws install is skipped when it is already there.
  assert.match(script, /if \[ ! -d "\$TARGET\/services\/sales-voice\/node_modules\/ws" \]/);
});

test('upgrading to a later SHA restarts the service and keeps the environment', () => {
  const script = deployScript();
  const envGuard = script.indexOf('if [ ! -f "$ENV_FILE" ]');
  const restart = script.indexOf('systemctl restart "$UNIT"');
  assert.ok(envGuard > 0 && restart > 0);
  // A fetch precedes the checkout, or a new SHA would not be present locally.
  assert.ok(script.indexOf('fetch --tags origin') < script.indexOf('checkout --detach'));
  // A restart drops calls in progress, and the operator doc says so.
  assert.match(operatorDoc(), /Restarting drops any call in progress/);
  assert.match(operatorDoc(), /activeSessions.*is `0`/);
});

test('a failed dependency install stops before anything is installed', () => {
  const script = deployScript();
  const npmAt = script.indexOf('npm install');
  const unitAt = script.indexOf('install -m 0644 "$TARGET/services/sales-voice/deploy/$UNIT"');
  const nginxAt = script.indexOf('/etc/nginx/snippets/yad-outbound-locations.conf');
  assert.ok(npmAt > 0 && unitAt > npmAt, 'the unit is installed after the dependency');
  assert.ok(nginxAt > npmAt, 'nginx is touched after the dependency');
  // set -e means the failure exits; nothing above it mutates the running system
  // except the service user and the checkout.
  assert.match(script, /set -euo pipefail/);
});

test('a service that will not start is caught in the same run', () => {
  const script = deployScript();
  const restart = script.indexOf('systemctl restart "$UNIT"');
  const isActive = script.indexOf('systemctl is-active "$UNIT"');
  assert.ok(isActive > restart, 'the state is checked after the restart');
  // Under set -e a non-zero is-active ends the run.
  assert.match(script, /sleep 3\nsystemctl is-active "\$UNIT"/);
  assert.match(operatorDoc(), /journalctl -u yad-sales-voice/,
    'the operator doc says where to look');
});

test('a missing nginx site block does not silently skip the routes', () => {
  const script = deployScript();
  assert.match(script, /Could not find the voice\.youraidepartment\.ai server block/);
  assert.match(script, /include \/etc\/nginx\/snippets\/yad-outbound-locations\.conf;/,
    'it prints the exact line to add by hand');
  // The message goes to stderr, so it is not lost in a log of successes.
  assert.match(script, /server block\. Add this line by hand" >&2/);
  assert.match(operatorDoc(), /the site file is named differently/);
});

test('broken inbound health is a deployment failure, not a warning', () => {
  const script = deployScript();
  const tail = script.slice(script.indexOf('6. the receptionist'));
  assert.match(tail, /exit 1/, 'it exits non-zero');
  assert.equal(/inbound \/health.*(?:warn|continuing|ignoring)/i.test(tail), false);
  // And the rollback script makes the same assertion, so undoing cannot quietly
  // leave production down either.
  assert.match(rollbackScript(), /inbound \/health does not answer\. Investigate immediately/);
});

test('rollback removes everything deploy added and nothing else', () => {
  const roll = rollbackScript();
  for (const removal of [
    'systemctl stop "$UNIT"', 'systemctl disable "$UNIT"',
    'rm -f "/etc/systemd/system/$UNIT"',
    'rm -f /etc/nginx/snippets/yad-outbound-locations.conf',
    'rm -f /etc/nginx/conf.d/yad-outbound-upstream.conf',
  ]) {
    assert.ok(roll.includes(removal), `rollback does not undo: ${removal}`);
  }
  // It must not touch the receptionist's unit or env file. Only executable lines
  // count: the script names the inbound unit in order to assert it survived.
  const commands = roll.split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .filter((line) => !/^\s*(?:echo|printf)\b/.test(line))
    .join('\n');
  assert.equal(/(?:stop|disable|restart|rm|shred)[^\n]*yad-voice-agent/.test(commands), false,
    'rollback touches the receptionist unit');
  assert.equal(/yad-voice-agent\.env/.test(commands), false);
  // Nor sshd, nor a firewall, nor a Twilio setting.
  assert.equal(/sshd|ufw|iptables|twilio/i.test(commands), false);
  // The only inbound reference left is a read: is-active, show, or a health curl.
  for (const line of commands.split('\n')) {
    if (line.includes('$INBOUND_UNIT')) {
      assert.match(line, /is-active|INBOUND_UNIT=/, `not a read of the inbound unit: ${line.trim()}`);
    }
  }
});

test('rollback keeps the hand-entered environment file unless told otherwise', () => {
  const roll = rollbackScript();
  assert.match(roll, /KEEP_ENV=1/);
  assert.match(roll, /holds a hand-entered token/);
  // Removal is opt-in and shreds rather than unlinks.
  assert.match(roll, /--purge-env/);
  assert.match(roll, /shred -u \/etc\/yad-sales-voice\.env/);
});

test('rollback restores nginx from the baseline and verifies before reloading', () => {
  const roll = rollbackScript();
  assert.match(roll, /restored \$site from the deployment baseline/);
  assert.match(roll, /cp -a "\$site" "\$site\.rollback-was"/,
    'the pre-rollback file is kept beside the site');
  const testAt = roll.indexOf('if nginx -t; then');
  const reloadAt = roll.indexOf('systemctl reload nginx');
  assert.ok(testAt > 0 && reloadAt > testAt, 'nginx -t precedes the reload');
  // With no baseline it deletes only its own include line.
  assert.match(roll, /sed -i '\/yad-outbound-locations\\\.conf\/d' "\$site"/);
});

test('rollback is safe when the service was never installed', () => {
  const roll = rollbackScript();
  // Every systemd call that can fail on an absent unit tolerates the failure.
  for (const line of roll.split('\n')) {
    if (/^\s*systemctl (stop|disable|reset-failed)/.test(line)) {
      assert.match(line, /\|\| true/, `not tolerant of an absent unit: ${line.trim()}`);
    }
  }
  assert.match(roll, /no baseline directory found/);
});

test('the key bootstrap never produces or prints a private key', () => {
  for (const file of ['edgexpert-keygen.sh', 'vultr-console-authorize-key.sh']) {
    const text = readFileSync(new URL(`../deploy/${file}`, import.meta.url), 'utf8');
    // No private-key material, and no command that would emit one.
    assert.equal(/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text), false,
      `${file} contains private key material`);
    // Nothing reads the private half's *contents*. A path may be mentioned -- the
    // script tells the operator where the key lives -- but never dereferenced.
    const body = text.replace(/^#.*$/gm, '');
    for (const emit of [/\b(?:cat|tee|base64|xxd|od|head|tail|less|more)\s+"?\$KEY"?(?!\.pub)/,
                        /\bssh-keygen[^\n]*-y[^\n]*\$KEY/,
                        /\$\(\s*cat\s+"?\$KEY"?(?!\.pub)/]) {
      assert.equal(emit.test(body), false, `${file} may emit the private key: ${emit}`);
    }
  }
  const keygen = readFileSync(new URL('../deploy/edgexpert-keygen.sh', import.meta.url), 'utf8');
  // It prints only the .pub half, and says so.
  assert.match(keygen, /cat "\$KEY\.pub"/);
  assert.equal(/cat "\$KEY"$/m.test(keygen), false);
  assert.match(keygen, /never leaves\s+#?\s*~\/\.ssh/,
    'the script does not state that the private half stays put');
});

test('the console script refuses a private key and a mangled key', () => {
  const script = readFileSync(
    new URL('../deploy/vultr-console-authorize-key.sh', import.meta.url), 'utf8');
  assert.match(script, /That is a PRIVATE key\. Stop/);
  assert.match(script, /if ! ssh-keygen -lf "\$TMP"/,
    'the key is validated before it is installed');
  assert.match(script, /Nothing was written/);
  assert.match(script, /grep -qxF "\$KEY_LINE" "\$AUTH"/, 'appending twice is a no-op');
});

test('the console script cannot lock the operator out', () => {
  const script = readFileSync(
    new URL('../deploy/vultr-console-authorize-key.sh', import.meta.url), 'utf8');
  const body = script.replace(/^#.*$/gm, '');
  for (const forbidden of [/sshd_config/, /PasswordAuthentication/, /PermitRootLogin/,
                           /systemctl (?:restart|reload) ssh/, /ufw/, /iptables/]) {
    assert.equal(forbidden.test(body), false, `the console script touches ${forbidden}`);
  }
  // It never truncates authorized_keys.
  assert.equal(/(?<!>)>\s*"\$AUTH"/.test(body), false, 'it overwrites authorized_keys');
  assert.match(body, />>\s*"\$AUTH"/, 'it appends');
  assert.match(script, /KEEP THIS CONSOLE OPEN/);
});

test('the operator doc carries a rollback section and no credential value', () => {
  const doc = operatorDoc();
  assert.match(doc, /^## 5\. ROLLBACK$/m);
  assert.match(doc, /rollback\.sh/);
  assert.match(doc, /Manual rollback/);
  // The credential section names the three values and the one place they go.
  assert.match(doc, /sudo -e \/etc\/yad-sales-voice\.env/);
  for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'OUTBOUND_APPROVED_CALLER_IDS']) {
    assert.ok(doc.includes(key), `the doc does not name ${key}`);
  }
  assert.match(doc, /Not into git, not into a\nGitHub secret/);
  // And no real value is present.
  assert.equal(/AC[0-9a-f]{32}|SK[0-9a-f]{32}|sk-ant-/.test(doc), false);
  // The token is only ever used on the host where it already lives.
  assert.match(doc, /Run that on the VPS where the values already live/);
});
