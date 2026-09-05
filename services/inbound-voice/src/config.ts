import { voicePaths, relayUrlFor, type VoicePaths } from '../../voice-core/src/index.ts';

/**
 * Inbound / callback voice service — configuration.
 * Authority: YAD-VOICE-INBOUND-OUTBOUND-ROUTING-AUTHORITY.md §2.
 *
 * Its own process, port, route namespace, health check and log identity. An operator
 * looking at a service name or a request path must be able to say which mode handled
 * a call, which is why nothing here is shared with the outbound service beyond the
 * transport primitives in voice-core.
 *
 * This process cannot dial. It answers calls Twilio sends it and nothing else; there
 * is no code path from here to an outbound call, and a test asserts it.
 */

export interface InboundVoiceConfig {
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
  partialPrompts: boolean;
  /**
   * The inbound persona. Deliberately not the sales profile: an inbound caller must
   * never inherit the cold-call agent, whatever the CRM says about them.
   */
  agentProfileId: string;
  /**
   * How long the deterministic resolver may take before the call is answered as an
   * ordinary inbound call. A caller hearing nothing is worse than a caller being
   * treated as new.
   */
  resolverTimeoutMs: number;
}

export const INBOUND_AGENT_PROFILE = 'yad-inbound-v1';

export function loadInboundVoiceConfig(
  env: NodeJS.ProcessEnv = process.env,
): InboundVoiceConfig {
  const publicBaseUrl = env['PUBLIC_VOICE_BASE_URL'] ?? 'https://voice.youraidepartment.ai';
  // Mounted under /inbound. The outbound service owns /outbound and nothing here may
  // answer on it; nginx routes by prefix and each process serves only its own.
  const paths = voicePaths(env['INBOUND_VOICE_PATH_PREFIX'] ?? '/inbound');

  return {
    port: Number(env['INBOUND_VOICE_PORT'] ?? '3003'),
    host: env['INBOUND_VOICE_BIND'] ?? '127.0.0.1',
    publicBaseUrl,
    paths,
    relayUrl: env['INBOUND_VOICE_RELAY_URL'] ?? relayUrlFor(publicBaseUrl, paths),
    twilioAuthToken: env['TWILIO_AUTH_TOKEN'] ?? null,
    validateSignatures: env['TWILIO_VALIDATE_SIGNATURES'] !== 'false',
    trustProxy: env['INBOUND_VOICE_TRUST_PROXY'] !== 'false',
    ttsVoice: env['TWILIO_TTS_VOICE'] ?? 'en-US-Journey-O',
    ttsLanguage: env['TWILIO_TTS_LANGUAGE'] ?? 'en-US',
    partialPrompts: env['TWILIO_PARTIAL_PROMPTS'] !== 'false',
    agentProfileId: INBOUND_AGENT_PROFILE,
    resolverTimeoutMs: Number(env['INBOUND_RESOLVER_TIMEOUT_MS'] ?? '1200'),
  };
}

/** What /inbound/health may say. No secret, no provider internals, no caller data. */
export function describeInboundVoiceConfig(config: InboundVoiceConfig) {
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
    resolverTimeoutMs: config.resolverTimeoutMs,
    /**
     * Stated on the health check because it is the question an operator has when
     * they are looking at it: does bringing inbound up arm anything outbound? No.
     */
    canPlaceOutboundCalls: false,
  };
}
