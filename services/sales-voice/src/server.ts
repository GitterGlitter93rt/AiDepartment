import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  conversationRelayTwiml, fallbackTwiml, hangupTwiml,
  validateTwilioSignature, formToRecord,
  RateLimiter, MAX_BODY_BYTES, readBodyLimited, clientIp, createLogger,
} from '../../voice-core/src/index.ts';
import { loadSalesVoiceConfig, describeSalesVoiceConfig } from './config.ts';
import { createSalesRelaySession, type Socket, type TurnProducer } from './relaySession.ts';

/**
 * Production Outbound Sales voice service.
 *
 * Routes:
 *   POST {prefix}/twilio/incoming      TwiML for a call this service placed
 *   POST {prefix}/twilio/status        Twilio status callbacks
 *   POST {prefix}/twilio/relay-action  where the relay hands control back
 *   WS   {prefix}/twilio/conversation  the ConversationRelay socket
 *   GET  {prefix}/health               its own health, separate from the receptionist's
 *
 * This process cannot start a call. Twilio calls it; the decision to dial is made in
 * the sales-brain dial controller behind the operator switches, and the call context
 * is looked up here by the id that arrives on the webhook.
 */

const config = loadSalesVoiceConfig();
const log = createLogger({ service: 'sales-voice' });
const limiter = new RateLimiter(120, 60_000);

/**
 * Where the conversation comes from.
 *
 * The turn producer is supplied by whoever starts the process, so this service holds
 * no dialogue of its own. Until a call context can be resolved — which needs the
 * sales brain and its database — the producer is absent, and the socket says so and
 * closes rather than improvising a conversation.
 */
let turnProducerFor: ((callContextId: string) => Promise<TurnProducer | null>) | null = null;

export function setTurnProducerFactory(
  factory: (callContextId: string) => Promise<TurnProducer | null>,
): void {
  turnProducerFor = factory;
}

/** Open relay sockets, for the health payload. */
let activeSockets = 0;

/** Rebuilds the URL Twilio signed — the public one, not what Node sees behind nginx. */
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
      service: 'sales-voice',
      activeSessions: activeSockets,
      conversationSource: turnProducerFor ? 'configured' : 'absent',
      config: describeSalesVoiceConfig(config),
    }, null, 2), 'application/json');
  }

  if (req.method === 'POST' && url.pathname === config.paths.incoming) {
    const { body, truncated } = await readBodyLimited(req, MAX_BODY_BYTES);
    if (truncated) return send(res, 413, fallbackTwiml('Sorry, something went wrong.'));
    if (!(await verified(req, body))) {
      log.log('error', { reason: 'invalid twilio signature', path: url.pathname });
      return send(res, 403, fallbackTwiml('Sorry, something went wrong.'));
    }

    // The greeting is the Call Pack opener, passed on the call's TwiML URL when the
    // dial controller created it. No opener means no researched basis for the call,
    // and the call ends rather than improvising one.
    const greeting = url.searchParams.get('greeting');
    if (!greeting) {
      log.log('error', { reason: 'no opener supplied', path: url.pathname });
      return send(res, 200, hangupTwiml());
    }

    return send(res, 200, conversationRelayTwiml({
      relayUrl: `${config.relayUrl}?callContextId=${
        encodeURIComponent(url.searchParams.get('callContextId') ?? '')}`,
      welcomeGreeting: greeting,
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
    // Warm transfer is off until there is a reachable human on the other end; until
    // then the relay ending means the call ends.
    return send(res, 200, hangupTwiml());
  }

  return send(res, 404, 'Not found', 'text/plain');
});

/**
 * Concurrent relay sockets this process will accept.
 *
 * The pilot runs one call at a time and the eligibility layer enforces that, but the
 * transport must not depend on an upstream limit it cannot see: an unbounded socket
 * count on a shared host is how outbound starves the inbound receptionist, which the
 * dual-service spec says must always win contention.
 */
const MAX_CONCURRENT_SOCKETS = Number(process.env['SALES_VOICE_MAX_SOCKETS'] ?? '4');

/**
 * The ConversationRelay socket.
 *
 * `ws` is imported lazily so every pure module here stays importable and testable
 * before `npm install` has ever run — the same reason the receptionist does it.
 */
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
      // 1013 Try Again Later: the honest answer, rather than accepting a call this
      // process cannot serve without hurting inbound.
      try { socket.close(1013, 'busy'); } catch { /* already gone */ }
      return;
    }
    activeSockets += 1;
    const url = new URL(request.url ?? '/', config.publicBaseUrl);
    const callContextId = url.searchParams.get('callContextId') ?? '';
    const callSid = { current: '' };

    const adapter: Socket = {
      send: (data) => socket.send(data),
      close: () => socket.close(),
    };

    let session: ReturnType<typeof createSalesRelaySession> | null = null;
    let refused = false;

    socket.on('message', async (raw: Buffer | string) => {
      try {
        await onMessage(raw);
      } catch (error) {
        // An async rejection here would otherwise be an unhandled rejection, which
        // Node treats as fatal by default.
        log.log('error', {
          reason: 'relay message handler failed',
          detail: String((error as Error).message).slice(0, 200),
        });
        if (session && callSid.current) await session.hangUp(callSid.current);
      }
    });

    async function onMessage(raw: Buffer | string): Promise<void> {
      if (refused) return;
      if (!session) {
        // No conversation source means no call. Improvising one here is exactly what
        // this service is built not to do.
        const producer = turnProducerFor ? await turnProducerFor(callContextId) : null;
        if (!producer) {
          refused = true;
          log.log('error', {
            reason: 'no conversation source for this call',
            callContextId: callContextId ? 'present' : 'absent',
          });
          socket.close();
          return;
        }
        session = createSalesRelaySession({
          producer,
          sink: { log: (event, data) => log.log(event, data) },
        });
      }
      await session.handle(adapter, raw.toString(), callSid);
    }

    // An oversized frame, a protocol violation or a network fault arrives here. Left
    // unhandled, `ws` raises it as an uncaught exception and takes the process down —
    // one hostile frame would end every call in progress.
    socket.on('error', async (error: Error) => {
      log.log('error', { reason: 'relay socket error', detail: String(error.message).slice(0, 200) });
      if (session && callSid.current) await session.hangUp(callSid.current);
      try { socket.close(); } catch { /* already gone */ }
    });

    socket.on('close', async () => {
      activeSockets = Math.max(0, activeSockets - 1);
      if (session && callSid.current) await session.hangUp(callSid.current);
    });
  });

  // A listener-level fault must not be unhandled either.
  wss.on('error', (error: Error) => {
    log.log('error', { reason: 'relay listener error', detail: String(error.message).slice(0, 200) });
  });

  log.log('call.summary', { msg: 'relay socket listening', path: config.paths.relay });
}

/**
 * Stops accepting work and lets calls in progress finish.
 *
 * systemd sends SIGTERM and waits `TimeoutStopSec`. Closing the listener immediately
 * while a call is live would drop a conversation mid-sentence, so the HTTP listener
 * stops first and the process exits once the sockets are gone or the grace period
 * expires — whichever comes first, so a wedged call cannot block a deploy for ever.
 */
export async function shutdown(graceMs = Number(process.env['SHUTDOWN_GRACE_MS'] ?? '25000')):
  Promise<void> {
  log.log('call.ending', { msg: 'shutting down', activeSessions: activeSockets });
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const deadline = Date.now() + graceMs;
  while (activeSockets > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (activeSockets > 0) {
    log.log('error', {
      reason: 'shutdown grace expired with calls still open', activeSessions: activeSockets,
    });
  }
  if (activeSocketServer) {
    await new Promise<void>((resolve) => activeSocketServer!.close(() => resolve()));
  }
  log.log('call.ending', { msg: 'shutdown complete' });
}

let activeSocketServer: import('ws').WebSocketServer | null = null;

/* c8 ignore start — only runs when started as a service */
if (process.argv[1]?.endsWith('server.ts')) {
  await attachRelaySocket();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => { void shutdown().then(() => process.exit(0)); });
  }
  server.listen(config.port, config.host, () => {
    log.log('call.summary', {
      msg: 'sales voice listening',
      url: `http://${config.host}:${config.port}`,
      paths: config.paths,
      conversationSource: turnProducerFor ? 'configured' : 'absent',
    });
  });
}
/* c8 ignore stop */
