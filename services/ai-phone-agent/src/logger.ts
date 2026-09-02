// Structured JSON logging with secret redaction.
//
// One line per event, machine-parseable, and safe to ship to any log
// aggregator. Transcripts are opt-in (LOG_TRANSCRIPTS) because a call
// transcript contains everything the caller said about their divorce,
// their address, and their phone number.

export type LogEvent =
  | 'service.started'
  | 'service.stopping'
  | 'service.stopped'
  | 'call.started'
  | 'call.ended'
  | 'router.decision'
  | 'router.clarify'
  | 'specialist.selected'
  | 'field.captured'
  | 'field.updated'
  | 'tool.requested'
  | 'tool.completed'
  | 'tool.failed'
  | 'llm.request'
  | 'llm.failed'
  | 'transcript.caller'
  | 'transcript.agent'
  | 'guard.flagged'
  | 'guard.blocked'
  | 'guard.output_blocked'
  | 'knowledge.matched'
  | 'call.summary'
  | 'call.ending'
  | 'turn.latency'
  | 'turn.interrupted'
  /** One call-timeline mark. See core/telemetry.ts. */
  | 'timeline'
  | 'demo.sales_intent'
  | 'demo.cta_declined'
  | 'llm.usage'
  | 'error';

/** Keys whose values are never printed, at any depth. */
const SECRET_KEYS = [
  'apikey', 'api_key', 'anthropicapikey', 'authtoken', 'auth_token',
  'token', 'secret', 'password', 'refreshtoken', 'refresh_token',
  'clientsecret', 'client_secret', 'authorization', 'x-api-key',
];

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Belt and braces: strip anything that looks like a bearer token or
    // an Anthropic key even if it arrives under an innocuous key name.
    return value
      .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[redacted]')
      .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]');
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.includes(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  log(event: LogEvent, data?: Record<string, unknown>): void;
  child(base: Record<string, unknown>): Logger;
}

export function createLogger(base: Record<string, unknown> = {}, sink: (line: string) => void = console.log): Logger {
  return {
    log(event, data = {}) {
      sink(JSON.stringify({ ts: new Date().toISOString(), event, ...redact(base) as object, ...redact(data) as object }));
    },
    child(extra) {
      return createLogger({ ...base, ...extra }, sink);
    },
  };
}

export const _internal = { redact };
