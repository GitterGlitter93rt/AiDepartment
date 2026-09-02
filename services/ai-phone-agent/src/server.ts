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
import { Orchestrator } from './core/orchestrator.ts';
import { greetingFor } from './business/greeting.ts';
import { demoProfile } from './business/profile.ts';
import { createClaudeClient } from './claude/client.ts';
import { createToolbox } from './tools/index.ts';
import { conversationRelayTwiml, fallbackTwiml, transferTwiml, hangupTwiml } from './twilio/twiml.ts';
import { parseRelayMessage, textResponse, endResponse, chunkForSpeech } from './twilio/relay.ts';
import { validateTwilioSignature, formToRecord } from './twilio/signature.ts';
import { RateLimiter, readBodyLimited, clientIp, MAX_BODY_BYTES } from './http/guards.ts';
import { PATHS } from './http/paths.ts';
import { finaliseCall } from './core/finalise.ts';
import { selectSpecialist } from './industries/index.ts';
import { TimelineStore } from './core/telemetry.ts';
import { BUILD } from './build-info.ts';

const cfg = loadConfig();
const log = createLogger({ svc: 'ai-phone-agent' });
const sessions = new SessionStore();
const claude = cfg.anthropicApiKey ? createClaudeClient(cfg.anthropicApiKey, cfg.claudeModel) : null;
const tools = createToolbox(cfg, log);
const orchestrator = new Orchestrator({
  sessions, claude, log, tools,
  confidenceThreshold: cfg.routerConfidenceThreshold,
  serviceArea: { state: cfg.serviceAreaState, timezone: cfg.serviceAreaTimezone },
  // One switch decides both the greeting and whether the Your AI
  // Department sales layer exists at all. A client deployment gets
  // neither, and cannot get either by partial misconfiguration.
  resolveProfile: (industry) => demoProfile(
    (industry ?? 'professional_services') as Parameters<typeof demoProfile>[0],
    { mode: cfg.deploymentMode, businessName: cfg.businessName || undefined },
  ),
});

/**
 * Per-call timing, shared between the webhook and the WebSocket.
 *
 * The clock starts when Twilio POSTs the inbound webhook, which is the
 * earliest moment this process knows the call exists. Everything in the
 * QA table is measured from there.
 */
const timelines = new TimelineStore(log);

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
        build: BUILD,
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
      const timeline = timelines.start(callSid);
      timeline.mark('CALL_CONNECTED');
      log.log('call.started', { callSid, from: maskPhone(from), to: maskPhone(to) });

      if (!cfg.relayUrl) {
        log.log('error', { callSid, reason: 'relay url not configured' });
        return send(res, 200, fallbackTwiml("Sorry, the demo line isn't available right now."), 'text/xml');
      }
      const welcomeGreeting = greetingFor({ mode: cfg.deploymentMode, clientGreeting: cfg.clientGreeting, businessName: cfg.businessName });
      const twiml = conversationRelayTwiml({
        relayUrl: cfg.relayUrl,
        welcomeGreeting,
        voice: cfg.ttsVoice,
        language: cfg.ttsLanguage,
        actionUrl: publicUrlFor(PATHS.relayAction, req),
        partialPrompts: cfg.partialPrompts,
      });
      // Greeting handed off. Twilio synthesises and plays it entirely
      // on its side, so this is the last moment we can see — the words
      // are a proxy for how long that takes, nothing more.
      timeline.mark('WELCOME_GREETING_SENT', { greetingWords: welcomeGreeting.split(/\s+/).length });
      return send(res, 200, twiml, 'text/xml');
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
  // Emitted before the timeline is discarded, so the last line of a
  // call's log says how long the whole thing took.
  const timeline = timelines.get(callSid);
  if (timeline) {
    timeline.mark('CALL_ENDED', { reason, turns: timeline.turn });
    timelines.end(callSid);
  }
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
    // The socket opens before the setup frame names the call, so the
    // instant is captured here and attributed once the CallSid arrives.
    const socketOpenedAt = Date.now();
    /**
     * True while an utterance is in progress — an interim transcript
     * has arrived and the final one has not.
     *
     * It decides which turn a mark belongs to. The caller starts
     * speaking before we know the turn exists, so the turn is opened
     * by the first interim rather than by the final transcript.
     * Without this the speech and the end-of-turn land in different
     * turns and the endpointing figure comes out negative.
     */
    let utteranceOpen = false;
    /**
     * The turn currently being generated, if any.
     *
     * Held per socket so an interrupt — or a new utterance arriving
     * before the last one finished — can abandon it. Without this the
     * abandoned generation still arrives and gets spoken, which is the
     * agent talking over the caller.
     */
    let inFlight: AbortController | null = null;

    socket.on('message', async (raw: Buffer | string) => {
      const msg = parseRelayMessage(raw.toString());
      if (!msg) return;

      try {
        if (msg.type === 'setup') {
          callSid = String((msg as { callSid?: string }).callSid ?? '');
          const from = String((msg as { from?: string }).from ?? 'unknown');
          const to = String((msg as { to?: string }).to ?? 'unknown');
          sessions.ensure(callSid, from, to);
          const timeline = timelines.ensure(callSid);
          timeline.mark('WEBSOCKET_CONNECTED', { setupFrameLagMs: Date.now() - socketOpenedAt });
          timeline.mark('RELAY_SETUP_RECEIVED');
          // NOT when the caller hears anything. Twilio owns synthesis
          // and playback and reports neither; the relay socket opening
          // is simply the earliest thing we can see that cannot happen
          // before Twilio has the greeting. Real audio latency needs a
          // stopwatch on a handset.
          timeline.mark('FIRST_AGENT_AUDIO_PROXY', { observable: false, proxy: 'relay socket open' });
          // The welcomeGreeting in the TwiML is already being spoken,
          // so nothing is sent here.
          return;
        }

        if (msg.type === 'prompt') {
          const utterance = String((msg as { voicePrompt?: string }).voicePrompt ?? '').trim();
          if (!utterance) return;
          const timeline = timelines.ensure(callSid);

          // An interim transcript. Twilio is still listening, so this
          // is NOT a turn — acting on it would answer half a sentence.
          // It is recorded because the gap from here to the final
          // transcript is Twilio's endpointing delay, which is the
          // single number that says whether a slow turn is our fault.
          if ((msg as { last?: boolean }).last === false) {
            if (!utteranceOpen) {
              timeline.beginTurn();
              utteranceOpen = true;
            }
            timeline.mark('FIRST_CALLER_SPEECH');
            return;
          }

          if (cfg.logTranscripts) log.log('transcript.caller', { callSid, text: utterance });

          const promptReceivedAt = Date.now();
          // Only open a turn here when no interim did — partial
          // prompts may be off, or the caller may be so brief that the
          // final transcript is the first frame we see.
          if (!utteranceOpen) timeline.beginTurn();
          utteranceOpen = false;
          timeline.mark('CALLER_END_OF_TURN', {
            words: utterance.split(/\s+/).length,
            // How long Twilio waited after the caller stopped before
            // deciding the turn was over. Ours to report, not to fix.
            endpointingMs: timeline.since('FIRST_CALLER_SPEECH'),
          });

          // A new utterance supersedes anything still in flight. This
          // is what makes barge-in real: the previous turn's generation
          // is abandoned rather than arriving late and talking over
          // whatever the caller has moved on to.
          inFlight?.abort();
          const controller = new AbortController();
          inFlight = controller;

          let firstClauseAt = 0;
          let clauses = 0;
          const turn = await orchestrator.handleTurn(callSid, utterance, {
            signal: controller.signal,
            mark: (m) => timeline.mark(m),
            onClause: (clause) => {
              if (controller.signal.aborted) return;
              if (!firstClauseAt) firstClauseAt = Date.now();
              clauses += 1;
              timeline.mark('FIRST_SPEAKABLE_CLAUSE', { chars: clause.length });
              // last:false — the turn is not over, more is coming.
              socket.send(textResponse(clause, false));
              timeline.mark('FIRST_TEXT_SENT_TO_CONVERSATION_RELAY');
            },
          });
          if (inFlight === controller) inFlight = null;

          if (turn.interrupted) {
            log.log('turn.interrupted', { callSid, stage: 'superseded' });
            return;
          }
          const reply = turn.text;
          if (cfg.logTranscripts) log.log('transcript.agent', { callSid, text: reply });

          if (clauses > 0) {
            // Streamed. Close the turn so the relay starts listening.
            socket.send(textResponse('', true));
          } else {
            // Non-streaming fallback — no key, or a client without
            // stream support. Chunk so speech still starts early.
            const chunks = chunkForSpeech(reply);
            chunks.forEach((chunk, i) => {
              socket.send(textResponse(chunk, i === chunks.length - 1));
            });
            firstClauseAt = Date.now();
            clauses = chunks.length;
            timeline.mark('FIRST_TEXT_SENT_TO_CONVERSATION_RELAY', { streamed: false });
          }

          // Timing only — never transcript content. The first number is
          // the one that matters: how long the caller sat in silence
          // after they stopped talking.
          log.log('turn.latency', {
            callSid,
            turnIndex: sessions.get(callSid)?.turns.length ?? 0,
            timeToFirstSpeechMs: firstClauseAt - promptReceivedAt,
            totalTurnMs: Date.now() - promptReceivedAt,
            replyChars: reply.length,
            clauses,
            streamed: turn.text.length > 0 && clauses > 0,
          });
          timeline.mark('TURN_COMPLETE', {
            replyChars: reply.length,
            clauses,
            // What the caller actually experienced: silence from the
            // moment Twilio handed us their words to the moment we
            // handed back something to say.
            perceivedSilenceMs: firstClauseAt ? firstClauseAt - promptReceivedAt : undefined,
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
          // The caller talked over us. ConversationRelay stops its own
          // playback, but the generation on our side would otherwise
          // keep going and send more text — which is exactly the
          // "kept talking over me" behaviour. Abort it.
          const timeline = timelines.ensure(callSid);
          timeline.mark('INTERRUPT_RECEIVED', { hadInFlight: Boolean(inFlight) });
          if (inFlight) {
            inFlight.abort();
            inFlight = null;
            // Our share of barge-in is the gap between these two marks.
            // Everything before INTERRUPT_RECEIVED — detecting the
            // caller's voice and stopping playback — is the relay's.
            timeline.mark('CLAUDE_ABORTED', { abortLatencyMs: timeline.since('INTERRUPT_RECEIVED') });
            log.log('turn.interrupted', { callSid, stage: 'barge_in' });
          }
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
      inFlight?.abort();
      inFlight = null;
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
