import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import twilio from 'twilio';
import { loadConfig } from './config.js';
import { InMemoryCallContextStore } from './store.js';
import { ResearchOrchestrator } from './research.js';
import { WebsiteResearchAdapter } from './website-research.js';
import { ClaudeWebResearchAdapter } from './web-research.js';
import { FileManualRetriever } from './manual-retriever.js';
import { buildSalesStrategy } from './strategy.js';
import { evaluateCompliance } from './compliance.js';
import { ClaudeConversationModel } from './claude.js';
import { ConversationRelaySession } from './relay.js';
import { buildConversationRelayTwiML, placeOutboundCall } from './twilio.js';
import type { CallContext, Lead } from './types.js';

const config = loadConfig();
const store = new InMemoryCallContextStore();
const research = new ResearchOrchestrator([
  new WebsiteResearchAdapter(),
  new ClaudeWebResearchAdapter(config.anthropicApiKey, config.anthropicModel),
]);
const here = dirname(fileURLToPath(import.meta.url));
const manualRoot = resolve(here, '../../docs/07-sales/training-manual');
const manual = new FileManualRetriever(manualRoot);
const model = new ClaudeConversationModel(config.anthropicApiKey, config.anthropicModel);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', config.publicVoiceBaseUrl);

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, mode: config.mode, dialEnabled: config.dialEnabled });
    }

    if (req.method === 'POST' && url.pathname === '/api/prepare') {
      if (!isAdmin(req)) return json(res, 401, { error: 'Unauthorized' });
      const lead = await readJson<Lead>(req);
      const context = await prepareContext(lead);
      await store.putContext(context);
      return json(res, 200, context);
    }

    if (req.method === 'POST' && url.pathname === '/api/dial') {
      if (!isAdmin(req)) return json(res, 401, { error: 'Unauthorized' });
      if (!config.dialEnabled) return json(res, 403, { error: 'Dialing is disabled by PHONE_AGENT_DIAL_ENABLED.' });
      const body = await readJson<{ leadId: string }>(req);
      const context = await store.getContext(body.leadId);
      if (!context) return json(res, 404, { error: 'Lead must be prepared before dialing.' });
      const result = await placeOutboundCall(context, {
        accountSid: config.twilioAccountSid,
        authToken: config.twilioAuthToken,
        fromNumber: config.twilioFromNumber,
        publicVoiceBaseUrl: config.publicVoiceBaseUrl,
      });
      return json(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/voice/outbound') {
      const form = await readForm(req);
      if (!validateTwilio(req, form)) return text(res, 403, 'Invalid Twilio signature');
      const leadId = url.searchParams.get('leadId');
      if (!leadId || !(await store.getContext(leadId))) return text(res, 404, 'Unknown lead');
      const websocketUrl = new URL('/relay', config.publicVoiceBaseUrl);
      websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      return xml(res, 200, buildConversationRelayTwiML({ websocketUrl: websocketUrl.toString(), leadId }));
    }

    if (req.method === 'POST' && (url.pathname === '/voice/amd' || url.pathname === '/voice/status')) {
      const form = await readForm(req);
      if (!validateTwilio(req, form)) return text(res, 403, 'Invalid Twilio signature');
      console.log(JSON.stringify({ event: url.pathname, ...form }));
      return text(res, 204, '');
    }

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', config.publicVoiceBaseUrl);
  if (url.pathname !== '/relay') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const session = new ConversationRelaySession(ws, store, model);
  ws.on('message', async (data) => {
    try { await session.onMessage(data.toString()); }
    catch (error) {
      console.error(error);
      ws.close(1011, 'Conversation error');
    }
  });
});

server.listen(config.port, () => {
  console.log(`Your AI Department phone brain listening on :${config.port}`);
});

async function prepareContext(lead: Lead): Promise<CallContext> {
  if (!lead.id || !lead.companyName || !lead.phone) throw new Error('Lead id, companyName, and phone are required.');
  const dossier = await research.buildDossier(lead);
  const strategy = await buildSalesStrategy(dossier, manual);
  const doNotCall = await store.isSuppressed(lead.phone);
  const compliance = evaluateCompliance(lead, { attemptsLast30Days: 0, doNotCall }, {
    internalSuppressionNumbers: new Set(),
    maxAttemptsPer30Days: 3,
    allowUnknownLineType: false,
    autonomousMobileTelemarketingEnabled: false,
    callingWindowLocal: { startHour: 9, endHour: 20 },
  }, new Date().getHours());
  return { lead, dossier, strategy, compliance };
}

function isAdmin(req: IncomingMessage): boolean {
  const auth = String(req.headers.authorization ?? '');
  return auth === `Bearer ${config.adminToken}`;
}

function validateTwilio(req: IncomingMessage, params: Record<string, string>): boolean {
  if (!config.twilioAuthToken) return false;
  const signature = String(req.headers['x-twilio-signature'] ?? '');
  const absolute = new URL(req.url ?? '/', config.publicVoiceBaseUrl).toString();
  return twilio.validateRequest(config.twilioAuthToken, signature, absolute, params);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  return JSON.parse(raw || '{}') as T;
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(await readBody(req)).entries());
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}
function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}
function xml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/xml; charset=utf-8' });
  res.end(body);
}
