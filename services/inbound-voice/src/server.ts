import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  conversationRelayTwiml, fallbackTwiml, hangupTwiml,
  validateTwilioSignature, formToRecord,
  RateLimiter, MAX_BODY_BYTES, readBodyLimited, clientIp, createLogger,
} from '../../voice-core/src/index.ts';
import { loadInboundVoiceConfig, describeInboundVoiceConfig } from './config.ts';
import { createInboundRelaySession, type Socket, type TurnProducer } from './relaySession.ts';
import { GENERAL_GREETING, type InboundCallPlan } from './plan.ts';

/**
 * Inbound / callback voice service.
 * Authority: YAD-VOICE-INBOUND-OUTBOUND-ROUTING-AUTHORITY.md SS2, SS4, SS5.
 *
 * Routes, all under its own prefix:
 *   POST {prefix}/twilio/incoming      TwiML for a call Twilio is delivering to us
 *   POST {prefix}/twilio/status        Twilio status callbacks
 *   POST {prefix}/twilio/relay-action  where the relay hands control back
 *   WS   {prefix}/twilio/conversation  the ConversationRelay socket
 *   GET  {prefix}/health               its own health, separate from every other service
 *
 * This process answers calls. It cannot place one: there is no dialling code here,
 * no Twilio REST client, and no path from a request to an outbound call. Bringing it
 * up arms nothing.
 *
 * The mode -- callback or general -- is decided by the sales brain before a prompt
 * exists. This service asks for a plan and uses it; if no planner is wired, or the
 * planner is slow or fails, the call is answered as an ordinary inbound call rather
 * than left silent.
 */

const config = loadInboundVoiceConfig();
const log = createLogger({ service: 'inbound-voice' });
const limiter = new RateLimiter(120, 60_000);

/**
 * Where the call plan comes from.
 *
 * Supplied by whoever starts the process, so this service holds no CRM access and no
 * dialogue of its own. Absent means every call is answered generally, which is the
 * safe answer rather than a broken one.
 */
let planFor: ((input: {
  fromNumber: string; toNumber: string; callSid: string;
}) => Promise<InboundCallPlan>) | null = null;

export function setInboundPlanner(
  planner: (input: {
    fromNumber: string; toNumber: string; callSid: string;
  }) => Promise<InboundCallPlan>,
): void {
  planFor = planner;
}

let turnProducerFor: ((callSid: string) => Promise<TurnProducer | null>) | null = null;

export function setTurnProducerFactory(
  factory: (callSid: string) => Promise<TurnProducer | null>,
): void {
  turnProducerFor = factory;
}

/** Open relay sockets, for the health payload. */
let activeSockets = 0;

function signedUrl(req: IncomingMessage): string {
  return new URL(req.url ?? '/', config.publicBaseUrl).toString();
}

async function verified(req: IncomingMessage, body: string): Promise<boolean> {
  if (!config.validateSignatures) return true;
  if (!config.twilioAuthToken) return false;
  return validateTwilioSignature(
    config.twilioAuthToken,
    req.headers['x-twilio-signature'] as string | undefined,
    signedUrl(req),
    formToRecord(body),
  );
}

function send(res: ServerResponse, status: number, body: string, type = 'text/xml'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * The plan, or the safe default.
 *
 * A resolver that is slow, throwing or absent must not produce dead air on a call
 * somebody is waiting on. The timeout is short and the fallback is a real greeting,
 * not a hang-up: the general inbound opening is always safe to say to anybody.
 */
export async function planOrGeneral(input: {
  fromNumber: string; toNumber: string; callSid: string;
}): Promise<InboundCallPlan> {
  const fallback: InboundCallPlan = {
    mode: 'INBOUND_GENERAL',
    greeting: GENERAL_GREETING,
    reason: planFor ? 'resolver_unavailable' : 'no_planner_configured',
    degraded: true,
  };
  if (!planFor) return fallback;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<InboundCallPlan>((resolve) => {
      timer = setTimeout(() => resolve({ ...fallback, reason: 'resolver_timeout' }),
        config.resolverTimeoutMs);
    });
    return await Promise.race([planFor(input), timeout]);
  } catch (error) {
    log.log('error', { reason: 'planner threw', message: (error as Error).message });
    return { ...fallback, reason: 'resolver_error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', config.publicBaseUrl);
  const ip = clientIp(req.headers, req.socket.remoteAddress, config.trustProxy);

  if (!limiter.check(ip)) {
    log.log('error', { reason: 'rate limited', path: url.pathname });
    return send(res, 429, 'Too many requests', 'text/plain');
  }

  if (req.method === 'GET' && url.pathname === config.paths.health) {
    return send(res, 200, JSON.stringify({
      status: 'ok',
      service: 'inbound-voice',
      mode: 'INBOUND',
      activeSessions: activeSockets,
      planSource: planFor ? 'configured' : 'absent',
      conversationSource: turnProducerFor ? 'configured' : 'absent',
      config: describeInboundVoiceConfig(config),
    }, null, 2), 'application/json');
  }

  if (req.method === 'POST' && url.pathname === config.paths.incoming) {
    const { body, truncated } = await readBodyLimited(req, MAX_BODY_BYTES);
    if (truncated) return send(res, 413, fallbackTwiml(GENERAL_GREETING));
    if (!(await verified(req, body))) {
      log.log('error', { reason: 'invalid twilio signature', path: url.pathname });
      return send(res, 403, fallbackTwiml('Sorry, something went wrong.'));
    }

    const form = formToRecord(body);
    const plan = await planOrGeneral({
      fromNumber: form['From'] ?? '',
      toNumber: form['To'] ?? '',
      callSid: form['CallSid'] ?? '',
    });
    log.log('call.started', {
      mode: plan.mode, reason: plan.reason, degraded: plan.degraded === true,
    });

    return send(res, 200, conversationRelayTwiml({
      relayUrl: `${config.relayUrl}?callSid=${encodeURIComponent(form['CallSid'] ?? '')}`,
      welcomeGreeting: plan.greeting,
      voice: config.ttsVoice,
      language: config.ttsLanguage,
      partialPrompts: config.partialPrompts,
      actionUrl: new URL(config.paths.relayAction, config.publicBaseUrl).toString(),
    }));
  }

  if (req.method === 'POST'
      && (url.pathname === config.paths.status || url.pathname === config.paths.relayAction)) {
    const { body } = await readBodyLimited(req, MAX_BODY_BYTES);
    if (!(await verified(req, body))) return send(res, 403, hangupTwiml());
    return send(res, 200, hangupTwiml());
  }

  return send(res, 404, 'Not found', 'text/plain');
});

/**
 * Concurrent relay sockets this process will accept.
 *
 * Inbound is the side a stranger can reach without us doing anything, so the ceiling
 * matters more here than on outbound: an unbounded socket count is a way for anybody
 * with the number to exhaust the host.
 */
const MAX_CONCURRENT_SOCKETS = Number(process.env['INBOUND_VOICE_MAX_SOCKETS'] ?? '8');

let activeSocketServer: import('ws').WebSocketServer | null = null;

export async function attachRelaySocket(): Promise<void> {
  let WebSocketServer: typeof import('ws').WebSocketServer;
  try {
    ({ WebSocketServer } = await import('ws'));
  } catch {
    log.log('error', { reason: 'ws is not installed; the relay socket is not listening' });
    return;
  }

  const wss = new WebSocketServer({
    server, path: config.paths.relay, maxPayload: MAX_BODY_BYTES,
  });
  activeSocketServer = wss;

  wss.on('connection', (socket, request) => {
    if (activeSockets >= MAX_CONCURRENT_SOCKETS) {
      log.log('error', {
        reason: 'relay socket refused: concurrency ceiling',
        active: activeSockets, ceiling: MAX_CONCURRENT_SOCKETS,
      });
      try { socket.close(1013, 'busy'); } catch { /* already gone */ }
      return;
    }
    activeSockets += 1;
    const url = new URL(request.url ?? '/', config.publicBaseUrl);
    const callSid = url.searchParams.get('callSid') ?? '';

    const adapter: Socket = {
      send: (data) => socket.send(data),
      close: () => socket.close(),
    };

    let session: ReturnType<typeof createInboundRelaySession> | null = null;
    const callSidRef = { current: callSid };

    socket.on('message', async (raw: unknown) => {
      try {
        if (!session) {
          const producer = turnProducerFor ? await turnProducerFor(callSid) : null;
          if (!producer) {
            // No conversation source means no conversation. Improvising one would be
            // the model deciding what this call is.
            log.log('error', { reason: 'no turn producer for inbound call' });
            try { socket.close(1011, 'no conversation source'); } catch { /* gone */ }
            return;
          }
          session = createInboundRelaySession({ producer, sink: log });
        }
        await session.handle(adapter, String(raw), callSidRef);
      } catch (error) {
        log.log('error', { reason: 'relay message failed', message: (error as Error).message });
      }
    });

    socket.on('error', (error: Error) => {
      log.log('error', { reason: 'relay socket error', message: error.message });
      activeSockets = Math.max(0, activeSockets - 1);
    });

    socket.on('close', () => {
      activeSockets = Math.max(0, activeSockets - 1);
      void session?.hangUp(callSidRef.current);
    });
  });

  wss.on('error', (error: Error) => {
    log.log('error', { reason: 'relay server error', message: error.message });
  });
}

export async function shutdown(graceMs = 30_000): Promise<void> {
  log.log('service.stopping', { activeSessions: activeSockets });
  activeSocketServer?.close();
  const started = Date.now();
  while (activeSockets > 0 && Date.now() - started < graceMs) {
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
  server.close();
}

export { config };
