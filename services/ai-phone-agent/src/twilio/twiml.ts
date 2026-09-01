// TwiML returned to Twilio on the inbound-call webhook.
//
// ConversationRelay is what makes this feel like a phone call rather
// than an IVR: Twilio handles speech-to-text, text-to-speech and
// barge-in, and streams transcripts to our WebSocket. We only ever
// deal in text.

import { escapeXml } from '../tools/transfer.ts';

export interface RelayTwimlOptions {
  relayUrl: string;
  welcomeGreeting: string;
  voice?: string;
  language?: string;
  /** Lets the caller cut in mid-sentence, as on a real call. */
  interruptible?: boolean;
}

export function conversationRelayTwiml(opts: RelayTwimlOptions): string {
  const {
    relayUrl, welcomeGreeting,
    voice = 'en-US-Journey-O', language = 'en-US', interruptible = true,
  } = opts;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Connect>` +
    `<ConversationRelay ` +
    `url="${escapeXml(relayUrl)}" ` +
    `welcomeGreeting="${escapeXml(welcomeGreeting)}" ` +
    `voice="${escapeXml(voice)}" ` +
    `language="${escapeXml(language)}" ` +
    `transcriptionProvider="google" ` +
    `interruptible="${interruptible ? 'true' : 'false'}" ` +
    `/>` +
    `</Connect>` +
    `</Response>`
  );
}

/** Spoken fallback when the service cannot start a relay session —
 * a caller should never hear a Twilio error tone. */
export function fallbackTwiml(message: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say>${escapeXml(message)}</Say><Hangup/></Response>`
  );
}
