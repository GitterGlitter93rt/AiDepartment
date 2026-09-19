import type { OperatingMode } from './types.js';

export interface AppConfig {
  port: number;
  publicVoiceBaseUrl: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  anthropicApiKey: string;
  anthropicModel: string;
  adminToken: string;
  mode: OperatingMode;
  dialEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8787),
    publicVoiceBaseUrl: required(env.PUBLIC_VOICE_BASE_URL, 'PUBLIC_VOICE_BASE_URL'),
    twilioAccountSid: env.TWILIO_ACCOUNT_SID ?? '',
    twilioAuthToken: env.TWILIO_AUTH_TOKEN ?? '',
    twilioFromNumber: env.TWILIO_FROM_NUMBER ?? '',
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    adminToken: required(env.PHONE_AGENT_ADMIN_TOKEN, 'PHONE_AGENT_ADMIN_TOKEN'),
    mode: parseMode(env.PHONE_AGENT_MODE),
    dialEnabled: String(env.PHONE_AGENT_DIAL_ENABLED ?? 'false').toLowerCase() === 'true',
  };
}

function parseMode(value?: string): OperatingMode {
  const allowed: OperatingMode[] = ['research_only', 'human_assist', 'autonomous_outbound', 'inbound_receptionist'];
  return allowed.includes(value as OperatingMode) ? value as OperatingMode : 'human_assist';
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
