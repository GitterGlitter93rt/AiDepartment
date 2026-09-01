// Runtime configuration. Every value comes from the environment — no
// credential is ever hardcoded, and nothing here is logged.
//
// The service is designed to boot and run a full demo call with NO
// third-party credentials at all: calendar and SMS fall back to mock
// mode, and the router falls back to its deterministic classifier when
// no Anthropic key is present. That keeps local development and CI
// possible without secrets.

import { PATHS } from './http/paths.ts';

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (typeof v !== 'string' || v.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

export interface Config {
  nodeEnv: string;
  port: number;
  /** Bind address. Defaults to loopback: in production Nginx proxies
   * to it, so the Node port is never reachable from the internet. */
  host: string;
  trustProxy: boolean;
  validateTwilioSignature: boolean;
  publicBaseUrl: string;
  relayUrl: string;

  anthropicApiKey: string;
  claudeModel: string;
  /** Log a full end-of-call summary. Off in environments where the
   * summary would duplicate a CRM record. */
  callSummaryEnabled: boolean;
  routerConfidenceThreshold: number;

  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;

  googleCalendarEnabled: boolean;
  googleCalendarId: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;

  mockCalendarMode: boolean;
  mockSmsMode: boolean;

  humanTransferNumber: string;
  logTranscripts: boolean;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicBaseUrl = str('PUBLIC_BASE_URL');
  // Default the relay URL off the public base URL so a single hostname
  // is the only thing that has to be set.
  const derivedRelay = publicBaseUrl
    ? publicBaseUrl.replace(/^http/i, 'ws').replace(/\/+$/, '') + PATHS.relay
    : '';

  const hasAnthropic = str('ANTHROPIC_API_KEY').length > 0;
  const hasGoogle =
    bool('GOOGLE_CALENDAR_ENABLED', false) &&
    str('GOOGLE_CLIENT_ID') !== '' &&
    str('GOOGLE_CLIENT_SECRET') !== '' &&
    str('GOOGLE_REFRESH_TOKEN') !== '';
  const hasTwilioRest = str('TWILIO_ACCOUNT_SID') !== '' && str('TWILIO_AUTH_TOKEN') !== '';

  const nodeEnv = str('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';

  return {
    nodeEnv,
    port: num('PORT', 3001),
    host: str('HOST', '127.0.0.1'),
    // Behind Nginx in production, so X-Forwarded-For is trustworthy
    // there and must NOT be trusted when the port is exposed directly.
    trustProxy: bool('TRUST_PROXY', isProd),
    // On by default in production: without it, anyone who learns the
    // webhook URL can start calls. Requires TWILIO_AUTH_TOKEN.
    validateTwilioSignature: bool('VALIDATE_TWILIO_SIGNATURE', isProd) && str('TWILIO_AUTH_TOKEN') !== '',
    publicBaseUrl,
    relayUrl: str('TWILIO_CONVERSATION_RELAY_URL', derivedRelay),

    anthropicApiKey: str('ANTHROPIC_API_KEY'),
    claudeModel: str('CLAUDE_MODEL', 'claude-sonnet-5'),
    callSummaryEnabled: bool('CALL_SUMMARY_ENABLED', true),
    routerConfidenceThreshold: num('ROUTER_CONFIDENCE_THRESHOLD', 0.6),

    twilioAccountSid: str('TWILIO_ACCOUNT_SID'),
    twilioAuthToken: str('TWILIO_AUTH_TOKEN'),
    twilioPhoneNumber: str('TWILIO_PHONE_NUMBER'),

    googleCalendarEnabled: hasGoogle,
    googleCalendarId: str('GOOGLE_CALENDAR_ID', 'primary'),
    googleClientId: str('GOOGLE_CLIENT_ID'),
    googleClientSecret: str('GOOGLE_CLIENT_SECRET'),
    googleRefreshToken: str('GOOGLE_REFRESH_TOKEN'),

    // Mocks stay ON unless explicitly disabled AND the credentials to
    // do the real thing actually exist. Failing safe here means a
    // misconfigured deploy sends nothing rather than sending wrongly.
    mockCalendarMode: bool('MOCK_CALENDAR_MODE', true) || !hasGoogle,
    mockSmsMode: bool('MOCK_SMS_MODE', true) || !hasTwilioRest,

    humanTransferNumber: str('HUMAN_TRANSFER_NUMBER'),
    logTranscripts: bool('LOG_TRANSCRIPTS', false),
    logLevel: str('LOG_LEVEL', 'info'),
    // hasAnthropic is intentionally not exported as config — callers
    // check anthropicApiKey directly so there is one source of truth.
    ...(hasAnthropic ? {} : {}),
  };
}

/** Redacted snapshot safe to log at boot. Never includes a secret —
 * only whether one is present. */
export function describeConfig(cfg: Config): Record<string, unknown> {
  return {
    nodeEnv: cfg.nodeEnv,
    port: cfg.port,
    host: cfg.host,
    publicBaseUrl: cfg.publicBaseUrl || '(unset)',
    twilioSignatureValidation: cfg.validateTwilioSignature ? 'enforced' : 'DISABLED',
    relayUrl: cfg.relayUrl || '(unset)',
    claudeModel: cfg.claudeModel,
    anthropicKey: cfg.anthropicApiKey ? 'present' : 'MISSING (router falls back to heuristic only)',
    twilioRest: cfg.twilioAccountSid && cfg.twilioAuthToken ? 'present' : 'absent',
    twilioPhoneNumber: cfg.twilioPhoneNumber || '(unset)',
    calendar: cfg.mockCalendarMode ? 'MOCK' : 'google-live',
    sms: cfg.mockSmsMode ? 'MOCK' : 'twilio-live',
    humanTransfer: cfg.humanTransferNumber ? 'configured' : 'absent',
    logTranscripts: cfg.logTranscripts,
  };
}
