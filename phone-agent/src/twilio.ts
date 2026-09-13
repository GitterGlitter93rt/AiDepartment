import type { CallContext } from './types.js';

export interface TwilioDialConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  publicVoiceBaseUrl: string;
}

export interface DialResult {
  sid: string;
  status?: string;
}

export async function placeOutboundCall(
  context: CallContext,
  config: TwilioDialConfig,
): Promise<DialResult> {
  if (context.compliance.decision !== 'allow') {
    throw new Error(`Dial blocked by compliance gate: ${context.compliance.decision}`);
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Calls.json`;
  const voiceUrl = new URL('/voice/outbound', config.publicVoiceBaseUrl);
  voiceUrl.searchParams.set('leadId', context.lead.id);

  const body = new URLSearchParams({
    To: context.lead.phone,
    From: config.fromNumber,
    Url: voiceUrl.toString(),
    Method: 'POST',
    MachineDetection: 'Enable',
    AsyncAmd: 'true',
    AsyncAmdStatusCallback: new URL('/voice/amd', config.publicVoiceBaseUrl).toString(),
    AsyncAmdStatusCallbackMethod: 'POST',
    StatusCallback: new URL('/voice/status', config.publicVoiceBaseUrl).toString(),
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: 'initiated ringing answered completed',
  });

  const authorization = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Twilio call creation failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json() as { sid: string; status?: string };
  return { sid: payload.sid, status: payload.status };
}

export function buildConversationRelayTwiML(params: {
  websocketUrl: string;
  leadId: string;
  welcomeGreeting?: string;
  voice?: string;
}): string {
  const greeting = escapeXml(params.welcomeGreeting ?? 'Hi, this is Your AI Department.');
  const voice = escapeXml(params.voice ?? 'default');
  const url = escapeXml(params.websocketUrl);
  const leadId = escapeXml(params.leadId);

  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Connect>\n    <ConversationRelay url="${url}" welcomeGreeting="${greeting}" voice="${voice}">\n      <Parameter name="leadId" value="${leadId}" />\n    </ConversationRelay>\n  </Connect>\n</Response>`;
}

function escapeXml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
