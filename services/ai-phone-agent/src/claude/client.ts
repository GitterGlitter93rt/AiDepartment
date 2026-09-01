// Minimal Anthropic Messages API client built on fetch.
//
// Deliberately not the SDK: this service has exactly one hard
// dependency (ws), and a thin fetch wrapper is trivially mockable in
// tests without a network or an API key. The interface is what the
// rest of the system depends on, so swapping in the official SDK later
// is a one-file change.

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  /** Plain text, or raw content blocks when tool results are in play. */
  content: string | unknown[];
}

export interface CompleteOptions {
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Overrides the client's default model for this request. */
  model?: string;
  /** Tool schemas the model may request. Omit for a plain completion. */
  tools?: unknown[];
}

/** What the API actually charged us for. Never spoken, only logged. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Cache reads are billed at a fraction of input tokens. */
  cacheReadTokens?: number;
}

/** A tool the model asked us to run. */
export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompleteResult {
  text: string;
  toolUses: ToolUseBlock[];
  stopReason: string | null;
  usage: Usage;
  model: string;
  /** Raw assistant content blocks, needed to continue a tool exchange. */
  raw: unknown[];
}

export interface ClaudeClient {
  complete(opts: CompleteOptions): Promise<string>;
  /** Full-fidelity call: tool requests, stop reason and token usage. */
  send?(opts: CompleteOptions): Promise<CompleteResult>;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

interface ApiResponse {
  content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
  stop_reason?: string | null;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
}

export function createClaudeClient(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): ClaudeClient {
  async function send(opts: CompleteOptions): Promise<CompleteResult> {
    const { system, messages, maxTokens = 300, temperature = 0.6, tools } = opts;
    const body: Record<string, unknown> = {
      model: opts.model ?? model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages,
    };
    if (tools && tools.length > 0) body.tools = tools;

    const res = await fetchImpl(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as ApiResponse;
    const blocks = data.content ?? [];

    return {
      text: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim(),
      toolUses: blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id ?? '', name: b.name ?? '', input: b.input ?? {} })),
      stopReason: data.stop_reason ?? null,
      model: data.model ?? (opts.model ?? model),
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        cacheReadTokens: data.usage?.cache_read_input_tokens,
      },
      raw: blocks,
    };
  }

  return {
    send,
    async complete(opts) {
      return (await send(opts)).text;
    },
  };
}

/** Deterministic stand-in used by tests and by local runs without a key. */
export function createStubClaudeClient(reply: string | ((o: CompleteOptions) => string)): ClaudeClient {
  return {
    async complete(opts) {
      return typeof reply === 'function' ? reply(opts) : reply;
    },
  };
}

/**
 * Stub that records every request it receives.
 *
 * Tests that need to assert on the assembled system prompt must use
 * this rather than echoing the prompt back as the reply: the output
 * guardrail correctly blocks a reply that recites the agent's own
 * instructions, so a prompt returned through the speech path never
 * survives to be asserted on. Inspecting `calls` reads the prompt
 * out-of-band, which is also closer to what the test actually means.
 */
export interface RecordingClaudeClient extends ClaudeClient {
  calls: CompleteOptions[];
  /** The system prompt of the most recent request. */
  lastSystem(): string;
}

export function createRecordingClaudeClient(
  reply: string | ((o: CompleteOptions) => string) = 'Understood.',
): RecordingClaudeClient {
  const calls: CompleteOptions[] = [];
  return {
    calls,
    lastSystem() {
      const last = calls[calls.length - 1];
      if (!last) throw new Error('no requests recorded');
      return last.system;
    },
    async complete(opts) {
      calls.push(opts);
      return typeof reply === 'function' ? reply(opts) : reply;
    },
  };
}

/**
 * Stub that plays a scripted sequence of full responses, so a tool
 * exchange can be exercised end to end with no network: first response
 * asks for a tool, second response speaks the result.
 */
export function createScriptedClaudeClient(
  script: Partial<CompleteResult>[],
): ClaudeClient & { calls: CompleteOptions[] } {
  const calls: CompleteOptions[] = [];
  let i = 0;
  function next(): CompleteResult {
    const step = script[Math.min(i, script.length - 1)] ?? {};
    i += 1;
    return {
      text: step.text ?? '',
      toolUses: step.toolUses ?? [],
      stopReason: step.stopReason ?? (step.toolUses?.length ? 'tool_use' : 'end_turn'),
      usage: step.usage ?? { inputTokens: 100, outputTokens: 30 },
      model: step.model ?? 'stub',
      raw: step.raw ?? [],
    };
  }
  return {
    calls,
    async send(opts) { calls.push(opts); return next(); },
    async complete(opts) { calls.push(opts); return next().text; },
  };
}
