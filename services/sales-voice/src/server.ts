import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  conversationRelayTwiml, fallbackTwiml, hangupTwiml,
  validateTwilioSignature, formToRecord,
  RateLimiter, MAX_BODY_BYTES, readBodyLimited, clientIp, createLogger,
} from '../../voice-core/src/index.ts';
import { loadSalesVoiceConfig, describeSalesVoiceConfig } from './config.ts';

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
      activeSessions: 0,
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

/* c8 ignore start — only runs when started as a service */
if (process.argv[1]?.endsWith('server.ts')) {
  server.listen(config.port, config.host, () => {
    log.log('call.summary', {
      msg: 'sales voice listening',
      url: `http://${config.host}:${config.port}`,
      paths: config.paths,
    });
  });
}
/* c8 ignore stop */
