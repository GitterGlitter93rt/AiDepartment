/**
 * voice-core — the Twilio ConversationRelay transport, and nothing else.
 *
 * Ported selectively from the deployed receptionist at
 * feature/twilio-ai-phone-agent 2ad6449, per
 * docs/09-software/outbound-sales-brain-voice-runtime-reuse-audit.md §3 and
 * outbound-sales-brain-shared-twilio-number-dual-service-spec.md §4.
 *
 * What this package is for: two services — the inbound receptionist and Production
 * Outbound Sales — share one Twilio number and one set of hard-won transport
 * lessons, while sharing no conversational state, no prompt and no process.
 *
 * What it deliberately does not contain, because those are the service's business
 * rather than the transport's:
 *
 *   - any system prompt, receptionist or sales;
 *   - industry routing, personas or demo positioning;
 *   - the mock calendar and mock SMS tools the demo runs on;
 *   - lead-intake questions or qualification rules;
 *   - anything that decides what to say.
 *
 * A consumer supplies a turn producer. voice-core carries its words to a caller and
 * tells it what the caller said back.
 */

export { voicePaths, relayUrlFor, PATHS, type VoicePaths } from './http/paths.ts';
export { validateTwilioSignature, expectedSignature, formToRecord } from './twilio/signature.ts';
export { escapeXml } from './twilio/xml.ts';
export {
  conversationRelayTwiml, transferTwiml, hangupTwiml, fallbackTwiml,
  type RelayTwimlOptions,
} from './twilio/twiml.ts';
export {
  parseRelayMessage, textResponse, endResponse, chunkForSpeech,
  type RelayInbound, type RelaySetupMessage, type RelayPromptMessage,
  type RelayInterruptMessage, type RelayErrorMessage, type TextOptions,
} from './twilio/relay.ts';
export {
  SessionStore, MAX_RETAINED_TURNS,
  type VoiceSession, type Turn, type ToolCallRecord,
} from './core/session.ts';
export {
  createTimeline, nullTimeline, TimelineStore,
  type Timeline, type TimelineMark, type MarkRecord,
  type TimelineOptions, type TimelineSink,
} from './core/telemetry.ts';
export {
  createRelaySession, HOLDING_LINE_AFTER_MS,
  type RelaySessionState, type Socket, type TurnProducer,
} from './core/relaySession.ts';
export { RateLimiter, MAX_BODY_BYTES, readBodyLimited, clientIp } from './http/guards.ts';
export { createLogger, type Logger, type LogEvent } from './logger.ts';
