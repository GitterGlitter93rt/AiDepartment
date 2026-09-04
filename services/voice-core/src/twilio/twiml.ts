// TwiML returned to Twilio on the call webhook.
//
// Ported verbatim from services/ai-phone-agent at 2ad6449, apart from the escapeXml
// import. The defaults here are what production actually runs.
//
// ConversationRelay is what makes this feel like a phone call rather
// than an IVR: Twilio handles speech-to-text, text-to-speech and
// barge-in, and streams transcripts to our WebSocket. We only ever
// deal in text.

import { escapeXml } from './xml.ts';

export interface RelayTwimlOptions {
  relayUrl: string;
  welcomeGreeting: string;
  voice?: string;
  language?: string;
  /** Lets the caller cut in mid-sentence, as on a real call. */
  interruptible?: boolean;
  /**
   * Stream interim transcripts as the caller talks.
   *
   * Diagnostic only. The handler timestamps them and returns; a turn
   * is still driven exclusively by the final transcript, because
   * answering a half-finished sentence is worse than any latency it
   * would save.
   */
  partialPrompts?: boolean;
  /**
   * What may cut the opening greeting short.
   *
   * `any` is the relay default; it is set explicitly because the split
   * intro depends on it. A caller who starts talking during the
   * positioning must be able to stop it — an intro that has to finish
   * before it will listen is exactly the demo nobody wants to sit
   * through.
   */
  welcomeGreetingInterruptible?: 'none' | 'dtmf' | 'speech' | 'any';
  /**
   * Where Twilio POSTs when the relay session ends. This is what makes
   * a warm transfer possible: the relay hands back control, and the
   * TwiML returned at this URL decides whether the call is dialled on
   * to a person or simply hung up.
   */
  actionUrl?: string;
}

export function conversationRelayTwiml(opts: RelayTwimlOptions): string {
  const {
    relayUrl, welcomeGreeting,
    voice = 'en-US-Journey-O', language = 'en-US', interruptible = true,
    actionUrl, partialPrompts = false, welcomeGreetingInterruptible = 'any',
  } = opts;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Connect${actionUrl ? ` action="${escapeXml(actionUrl)}"` : ''}>` +
    `<ConversationRelay ` +
    `url="${escapeXml(relayUrl)}" ` +
    `welcomeGreeting="${escapeXml(welcomeGreeting)}" ` +
    `voice="${escapeXml(voice)}" ` +
    `language="${escapeXml(language)}" ` +
    `transcriptionProvider="google" ` +
    `interruptible="${interruptible ? 'true' : 'false'}" ` +
    `welcomeGreetingInterruptible="${escapeXml(welcomeGreetingInterruptible)}" ` +
    (partialPrompts ? `partialPrompts="true" ` : '') +
    `/>` +
    `</Connect>` +
    `</Response>`
  );
}

/**
 * Dials a human after the relay session ends.
 *
 * `callerId` is omitted deliberately: Twilio uses the original caller's
 * number, so whoever answers sees who is actually on the line.
 */
export function transferTwiml(target: string, timeoutSeconds = 30): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Dial timeout="${timeoutSeconds}">${escapeXml(target)}</Dial></Response>`
  );
}

/** Nothing further to do — the relay ended normally. */
export function hangupTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
}

/** Spoken fallback when the service cannot start a relay session —
 * a caller should never hear a Twilio error tone. */
export function fallbackTwiml(message: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say>${escapeXml(message)}</Say><Hangup/></Response>`
  );
}
