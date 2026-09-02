// HTTP + WebSocket entry point.
//
// Routes:
//   GET  /health          liveness + redacted config snapshot
//   POST /voice           Twilio inbound-call webhook -> ConversationRelay TwiML
//   POST /status          Twilio status callback (call completed etc.)
//   WS   /relay           ConversationRelay socket: transcripts in, speech out
//
// `ws` is imported lazily so the pure modules (router, tools, session)
// stay testable and importable before `npm install` has ever run.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig, describeConfig } from './config.ts';
import { createLogger } from './logger.ts';
import { SessionStore } from './core/session.ts';
import { Orchestrator, GREETING } from './core/orchestrator.ts';
import { createClaudeClient } from './claude/client.ts';
import { createToolbox } from './tools/index.ts';
import { conversationRelayTwiml, fallbackTwiml, transferTwiml, hangupTwiml } from './twilio/twiml.ts';
import { parseRelayMessage, textResponse, endResponse, chunkForSpeech } from './twilio/relay.ts';
import { validateTwilioSignature, formToRecord } from './twilio/signature.ts';
import { RateLimiter, readBodyLimited, clientIp, MAX_BODY_BYTES } from './http/guards.ts';
import { PATHS } from './http/paths.ts';
import { finaliseCall } from './core/finalise.ts';
import { selectSpecialist } from './industries/index.ts';

const cfg = loadConfig();
const log = createLogger({ svc: 'ai-phone-agent' });
const sessions = new SessionStore();
const claude = cfg.anthropicApiKey ? createClaudeClient(cfg.anthropicApiKey, cfg.claudeModel) : null;
const tools = createToolbox(cfg, log);
const orchestrator = new Orchestrator({
  sessions, claude, log, tools,
  confidenceThreshold: cfg.routerConfidenceThreshold,
  serviceArea: { state: cfg.serviceAreaState, timezone: cfg.serviceAreaTimezone },
});

const limiter = new RateLimiter(120, 60_000);
setInterval(() => limiter.sweep(), 60_000).unref?.();

/** Rebuild the exact public URL Twilio signed. Behind Nginx the local
 * Host header is not what Twilio saw, so PUBLIC_BASE_URL wins. */
function publicUrlFor(path: string, req: IncomingMessage): string {
  if (cfg.publicBaseUrl) return cfg.publicBaseUrl.replace(/\/+$/, '') + path;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${req.headers.host ?? 'localhost'}${path}`;
}

function send(res: ServerResponse, status: number, body: string, contentType = 'text/plain') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  try {
    const ip = clientIp(req.headers, req.socket.remoteAddress, cfg.trustProxy);
    if (!limiter.check(ip)) {
      log.log('error', { reason: 'rate limited', path: url.pathname });
      return send(res, 429, 'too many requests');
    }

    if (req.method === 'GET' && url.pathname === PATHS.health) {
      return send(res, 200, JSON.stringify({
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        activeSessions: sessions.size,
        config: describeConfig(cfg),
      }, null, 2), 'application/json');
    }

    // Twilio posts form-encoded call metadata here when a call arrives.
    if (req.method === 'POST' && url.pathname === PATHS.incoming) {
      const { body: raw, truncated } = await readBodyLimited(req, MAX_BODY_BYTES);
      if (truncated) return send(res, 413, 'payload too large');

      if (cfg.validateTwilioSignature) {
        const ok = validateTwilioSignature(
          cfg.twilioAuthToken,
          req.headers['x-twilio-signature'] as string | undefined,
          publicUrlFor(PATHS.incoming, req),
          formToRecord(raw),
        );
        if (!ok) {
          log.log('error', { reason: 'invalid twilio signature', path: url.pathname });
          return send(res, 403, 'forbidden');
        }
      }

      const body = new URLSearchParams(raw);
      const callSid = body.get('CallSid') ?? `local-${Date.now()}`;
      const from = body.get('From') ?? 'unknown';
      const to = body.get('To') ?? 'unknown';

      sessions.create(callSid, from, to);
      log.log('call.started', { callSid, from: maskPhone(from), to: maskPhone(to) });

      if (!cfg.relayUrl) {
        log.log('error', { callSid, reason: 'relay url not configured' });
        return send(res, 200, fallbackTwiml("Sorry, the demo line isn't available right now."), 'text/xml');
      }
      return send(res, 200, conversationRelayTwiml({
        relayUrl: cfg.relayUrl,
        welcomeGreeting: GREETING,
        voice: cfg.ttsVoice,
        language: cfg.ttsLanguage,
        actionUrl: publicUrlFor(PATHS.relayAction, req),
      }), 'text/xml');
    }

    // The relay session has ended. If the agent asked to hand the call
    // to a person, this is where that actually happens — the relay owns
    // the media while it is running, so a transfer can only be a <Dial>
    // returned after it lets go.
    if (req.method === 'POST' && url.pathname === PATHS.relayAction) {
      const { body: raw, truncated } = await readBodyLimited(req, MAX_BODY_BYTES);
      if (truncated) return send(res, 413, 'payload too large');
      if (cfg.validateTwilioSignature) {
        const ok = validateTwilioSignature(
          cfg.twilioAuthToken,
          req.headers['x-twilio-signature'] as string | undefined,
          publicUrlFor(PATHS.relayAction, req),
          formToRecord(raw),
        );
        if (!ok) return send(res, 403, 'forbidden');
      }
      const body = new URLSearchParams(raw);
      const callSid = body.get('CallSid') ?? '';
      const session = sessions.get(callSid);
      const target = session?.pendingTransfer?.target;

      if (target) {
        log.log('tool.completed', {
          callSid, tool: 'transfer_to_human',
          reason: session?.pendingTransfer?.reason,
          to: maskPhone(target),
        });
        return send(res, 200, transferTwiml(target), 'text/xml');
      }
      return send(res, 200, hangupTwiml(), 'text/xml');
    }

    if (req.method === 'POST' && url.pathname === PATHS.status) {
      const { body: raw, truncated } = await readBodyLimited(req, MAX_BODY_BYTES);
      if (truncated) return send(res, 413, 'payload too large');
      if (cfg.validateTwilioSignature) {
        const ok = validateTwilioSignature(
          cfg.twilioAuthToken,
          req.headers['x-twilio-signature'] as string | undefined,
          publicUrlFor(PATHS.status, req),
          formToRecord(raw),
        );
        if (!ok) return send(res, 403, 'forbidden');
      }
      const body = new URLSearchParams(raw);
      const callSid = body.get('CallSid') ?? '';
      const status = body.get('CallStatus') ?? '';
      if (status === 'completed' || status === 'failed' || status === 'busy' || status === 'no-answer') {
        await endCall(callSid, status);
      }
      return send(res, 204, '');
    }

    return send(res, 404, 'not found');
  } catch (err) {
    log.log('error', { path: url.pathname, error: String(err).slice(0, 300) });
    return send(res, 500, 'internal error');
  }
});

async function endCall(callSid: string, reason: string) {
  await finaliseCall(callSid, reason, {
    sessions, crm: tools.crm, log,
    expectedFields: (session) => selectSpecialist(session)?.qualificationSchema.map((f) => f.key) ?? [],
    callSummaryEnabled: cfg.callSummaryEnabled,
  });
}

/** Phone numbers are personal data; logs keep only enough to correlate. */
function maskPhone(n: string): string {
  return n.length > 4 ? `***${n.slice(-4)}` : '***';
}

async function startWebSocket() {
  let WebSocketServer: typeof import('ws').WebSocketServer;
  try {
    ({ WebSocketServer } = await import('ws'));
  } catch {
    log.log('error', { reason: "'ws' not installed — run npm install in services/ai-phone-agent. HTTP endpoints still work." });
    return;
  }

  const wss = new WebSocketServer({ server, path: PATHS.relay, maxPayload: MAX_BODY_BYTES });
  activeSockets = wss;

  wss.on('connection', (socket) => {
    // One socket per call. All state hangs off callSid, so concurrent
    // calls never see each other.
    let callSid = '';

    socket.on('message', async (raw: Buffer | string) => {
      const msg = parseRelayMessage(raw.toString());
      if (!msg) return;

      try {
        if (msg.type === 'setup') {
          callSid = String((msg as { callSid?: string }).callSid ?? '');
          const from = String((msg as { from?: string }).from ?? 'unknown');
          const to = String((msg as { to?: string }).to ?? 'unknown');
          sessions.ensure(callSid, from, to);
          // The welcomeGreeting in the TwiML is already being spoken,
          // so nothing is sent here.
          return;
        }

        if (msg.type === 'prompt') {
          const utterance = String((msg as { voicePrompt?: string }).voicePrompt ?? '').trim();
          if (!utterance) return;
          if (cfg.logTranscripts) log.log('transcript.caller', { callSid, text: utterance });

          const promptReceivedAt = Date.now();
          const turn = await orchestrator.handleTurn(callSid, utterance);
          const reply = turn.text;
          if (cfg.logTranscripts) log.log('transcript.agent', { callSid, text: reply });

          // Stream in clauses so speech begins before the full reply
          // has been generated.
          const chunks = chunkForSpeech(reply);
          chunks.forEach((chunk, i) => {
            socket.send(textResponse(chunk, i === chunks.length - 1));
          });

          // Timing only — never transcript content. This is what tells
          // us whether the caller is waiting on the model or on us.
          const firstTtsTokenSentAt = Date.now();
          log.log('turn.latency', {
            callSid,
            turnIndex: sessions.get(callSid)?.turns.length ?? 0,
            totalTurnToFirstSpeechMs: firstTtsTokenSentAt - promptReceivedAt,
            replyChars: reply.length,
            chunks: chunks.length,
          });

          // A transfer or a hang-up requested during this turn happens
          // only now, after the closing sentence has been sent. Ending
          // the relay any earlier clips the last thing the caller was
          // told, which is the whole reason this is not done inside the
          // tool.
          const session = sessions.get(callSid);
          if (session?.pendingTransfer) {
            socket.send(endResponse({
              reason: 'transfer',
              target: session.pendingTransfer.target,
              summary: session.pendingTransfer.summary,
            }));
            return;
          }
          if (turn.action === 'SPEAK_AND_END') {
            socket.send(endResponse({ reason: 'completed', detail: turn.endReason ?? 'call complete' }));
            await endCall(callSid, 'agent-ended');
          }
          return;
        }

        if (msg.type === 'interrupt') {
          // The caller spoke over us. ConversationRelay already stopped
          // playback; nothing to undo, and the next prompt carries on.
          return;
        }

        if (msg.type === 'error') {
          log.log('error', { callSid, source: 'relay', description: String((msg as { description?: string }).description ?? '') });
        }
      } catch (err) {
        log.log('error', { callSid, error: String(err).slice(0, 300) });
        try {
          socket.send(textResponse("Sorry — I lost you for a second there. What were you saying?", true));
        } catch { /* socket already gone */ }
      }
    });

    socket.on('close', () => {
      if (callSid) void endCall(callSid, 'socket-closed');
    });
  });

  log.log('service.started', { transport: 'websocket', path: PATHS.relay });
}

// Held so shutdown can close live call sockets cleanly.
let activeSockets: import('ws').WebSocketServer | null = null;

server.listen(cfg.port, cfg.host, () => {
  log.log('service.started', { ...describeConfig(cfg), toolModes: tools.modes });
  void startWebSocket();
});

// ---------------------------------------------------------------
// Graceful shutdown.
//
// systemd sends SIGTERM on `restart` and `stop`. A phone call in
// progress should be allowed to finish rather than being cut mid
// sentence, so we stop accepting new connections, give live calls a
// grace period, then exit. Exceeding the grace period exits anyway so
// a wedged socket cannot block a deploy.
// ---------------------------------------------------------------
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 25_000);
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.log('service.stopping', { signal, activeSessions: sessions.size });

  server.close(() => log.log('service.stopped', { signal }));

  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  const wait = async () => {
    while (sessions.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  await wait();

  if (activeSockets) {
    for (const client of activeSockets.clients) {
      try { client.close(1001, 'server restarting'); } catch { /* already gone */ }
    }
  }
  log.log('service.stopped', { signal, remainingSessions: sessions.size });
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A crash must be logged in the same structured stream as everything
// else, then exit so the supervisor restarts a clean process.
process.on('uncaughtException', (err) => {
  log.log('error', { fatal: true, error: String(err).slice(0, 500) });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.log('error', { fatal: true, unhandledRejection: String(reason).slice(0, 500) });
});

export { server };
