import { voicePaths, relayUrlFor, type VoicePaths } from '../../voice-core/src/index.ts';

/**
 * Production Outbound Sales voice service — configuration.
 *
 * A separate process from the inbound receptionist and from the demo line, with its
 * own port, its own health check and its own session namespace
 * (shared-twilio-number-dual-service-spec.md §5). It shares the approved Twilio
 * number as caller ID and nothing else.
 *
 * Nothing here can start a call. Dialling is decided by the dial controller in the
 * sales-brain service, behind the operator switches.
 */

export interface SalesVoiceConfig {
  port: number;
  host: string;
  publicBaseUrl: string;
  paths: VoicePaths;
  relayUrl: string;
  twilioAuthToken: string | null;
  /** Enforced unless explicitly disabled for a local test. */
  validateSignatures: boolean;
  trustProxy: boolean;
  ttsVoice: string;
  ttsLanguage: string;
  /** Interim transcripts are diagnostic only; a turn is driven by the final one. */
  partialPrompts: boolean;
  agentProfileId: string;
}

export function loadSalesVoiceConfig(env: NodeJS.ProcessEnv = process.env): SalesVoiceConfig {
  const publicBaseUrl = env['PUBLIC_VOICE_BASE_URL'] ?? 'https://voice.youraidepartment.ai';
  // Mounted under /outbound so inbound and outbound can share one hostname without
  // either one owning the other's routes.
  const paths = voicePaths(env['SALES_VOICE_PATH_PREFIX'] ?? '/outbound');

  return {
    port: Number(env['SALES_VOICE_PORT'] ?? '3002'),
    host: env['SALES_VOICE_BIND'] ?? '127.0.0.1',
    publicBaseUrl,
    paths,
    relayUrl: env['SALES_VOICE_RELAY_URL'] ?? relayUrlFor(publicBaseUrl, paths),
    twilioAuthToken: env['TWILIO_AUTH_TOKEN'] ?? null,
    validateSignatures: env['TWILIO_VALIDATE_SIGNATURES'] !== 'false',
    trustProxy: env['SALES_VOICE_TRUST_PROXY'] !== 'false',
    ttsVoice: env['TWILIO_TTS_VOICE'] ?? 'en-US-Journey-O',
    ttsLanguage: env['TWILIO_TTS_LANGUAGE'] ?? 'en-US',
    partialPrompts: env['TWILIO_PARTIAL_PROMPTS'] !== 'false',
    agentProfileId: 'yad-sales-core-v1',
  };
}

/** What /health may say. No secret, no provider internals. */
export function describeSalesVoiceConfig(config: SalesVoiceConfig) {
  return {
    port: config.port,
    host: config.host,
    publicBaseUrl: config.publicBaseUrl,
    relayUrl: config.relayUrl,
    paths: config.paths,
    agentProfileId: config.agentProfileId,
    twilioSignatureValidation: config.validateSignatures ? 'enforced' : 'disabled',
    twilioAuthToken: config.twilioAuthToken ? 'present' : 'absent',
    ttsVoice: config.ttsVoice,
    partialPrompts: config.partialPrompts,
  };
}
