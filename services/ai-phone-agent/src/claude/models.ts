// One place that decides which model does what.
//
// The router and the specialist have genuinely different jobs. Routing
// is a short, structured classification on the critical path — the
// caller is listening to silence while it runs — so it wants the
// fastest model and a low token ceiling. The specialist is holding a
// conversation and benefits from a stronger model.
//
// Both are environment-overridable so a deployment can change them
// without a rebuild, and CLAUDE_MODEL still sets both at once for the
// simple case.

export interface ModelProfile {
  /** Model ID sent to the API. */
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface ModelConfig {
  router: ModelProfile;
  specialist: ModelProfile;
  summary: ModelProfile;
}

/**
 * Defaults chosen for a phone call.
 *
 * Router: low temperature because classification should be stable —
 * the same sentence must not route two ways on two calls — and a tight
 * token ceiling because the reply is a small JSON object.
 *
 * Specialist: warmer, because a receptionist who says the identical
 * sentence every time sounds like a robot, and capped at roughly three
 * spoken sentences. Anything longer is a monologue the caller will
 * interrupt anyway.
 */
export const DEFAULT_MODELS: ModelConfig = {
  // The router emits a short JSON classification, nothing more. 120 is
  // generous for that, and it keeps routing cheaper than speaking now
  // that a spoken turn is deliberately capped short.
  router: { model: 'claude-haiku-4-5-20251001', maxTokens: 120, temperature: 0 },
  // 160 tokens is roughly 120 spoken words — a backstop only. The real
  // limit is MAX_SPEECH_CHARS, which cuts at a clause boundary rather
  // than wherever the token budget happens to run out.
  specialist: { model: 'claude-sonnet-5', maxTokens: 160, temperature: 0.7 },
  summary: { model: 'claude-haiku-4-5-20251001', maxTokens: 400, temperature: 0.2 },
};

export interface ModelEnvOverrides {
  CLAUDE_MODEL?: string;
  CLAUDE_ROUTER_MODEL?: string;
  CLAUDE_SPECIALIST_MODEL?: string;
  CLAUDE_SUMMARY_MODEL?: string;
  CLAUDE_ROUTER_MAX_TOKENS?: string;
  CLAUDE_SPECIALIST_MAX_TOKENS?: string;
  CLAUDE_SPECIALIST_TEMPERATURE?: string;
}

function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveModels(env: ModelEnvOverrides = process.env as ModelEnvOverrides): ModelConfig {
  // CLAUDE_MODEL is the blunt instrument: set it and everything uses
  // that model. The per-role variables win over it.
  const blanket = env.CLAUDE_MODEL?.trim() || null;

  return {
    router: {
      model: env.CLAUDE_ROUTER_MODEL?.trim() || blanket || DEFAULT_MODELS.router.model,
      maxTokens: num(env.CLAUDE_ROUTER_MAX_TOKENS, DEFAULT_MODELS.router.maxTokens),
      temperature: DEFAULT_MODELS.router.temperature,
    },
    specialist: {
      model: env.CLAUDE_SPECIALIST_MODEL?.trim() || blanket || DEFAULT_MODELS.specialist.model,
      maxTokens: num(env.CLAUDE_SPECIALIST_MAX_TOKENS, DEFAULT_MODELS.specialist.maxTokens),
      temperature: num(env.CLAUDE_SPECIALIST_TEMPERATURE, DEFAULT_MODELS.specialist.temperature),
    },
    summary: {
      model: env.CLAUDE_SUMMARY_MODEL?.trim() || blanket || DEFAULT_MODELS.summary.model,
      maxTokens: DEFAULT_MODELS.summary.maxTokens,
      temperature: DEFAULT_MODELS.summary.temperature,
    },
  };
}
