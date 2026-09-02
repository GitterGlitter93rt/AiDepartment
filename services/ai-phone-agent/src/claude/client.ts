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

/** A clause ready to speak, emitted before the reply is finished. */
export type StreamSink = (text: string) => void;

export interface StreamOptions extends CompleteOptions {
  /**
   * Called with each speakable clause as it arrives.
   *
   * The whole point of streaming here: the caller hears the first
   * sentence while the rest is still being generated. Waiting for a
   * complete reply and then chunking it — which is what this used to do
   * — spends the entire generation time as silence.
   */
  onClause: StreamSink;
  /** Aborts generation when the caller interrupts. */
  signal?: AbortSignal;
}

export interface ClaudeClient {
  complete(opts: CompleteOptions): Promise<string>;
  /** Full-fidelity call: tool requests, stop reason and token usage. */
  send?(opts: CompleteOptions): Promise<CompleteResult>;
  /** Streams text, emitting clauses as they become speakable. */
  stream?(opts: StreamOptions): Promise<CompleteResult>;
}

/**
 * Splits a growing buffer at the first point it is safe to speak.
 *
 * Sentence ends are the natural boundary. A comma is accepted once the
 * clause is long enough to be worth saying on its own, because the
 * first clause is the one that removes the silence and a caller would
 * rather hear "Absolutely, we can help with that" than wait for the
 * full stop.
 */
export function takeSpeakable(buffer: string, isFirst: boolean): { clause: string; rest: string } | null {
  // A sentence is always a good place to stop. Later clauses need to be
  // longer, or the speech comes out choppy.
  const sentenceMin = isFirst ? 12 : 30;
  const sentence = buffer.match(/^[\s\S]*?[.!?](?=\s|$)/);
  if (sentence && sentence[0].trim().length >= sentenceMin) {
    return { clause: sentence[0].trim(), rest: buffer.slice(sentence[0].length) };
  }

  // For the FIRST clause only, a comma will do — that is where the
  // latency is won. The bar is lower than for a sentence because
  // "Absolutely," is worth saying on its own while the rest is still
  // being generated, but high enough that "Yes," and "Sure," are held
  // back rather than shipped as a turn of their own.
  if (isFirst) {
    const comma = buffer.match(/^[\s\S]*?,(?=\s)/);
    if (comma && comma[0].trim().length >= 10) {
      return { clause: comma[0].trim(), rest: buffer.slice(comma[0].length) };
    }
  }
  return null;
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

  /**
   * Streaming completion.
   *
   * Text is emitted clause by clause as the model produces it, so the
   * caller starts hearing the answer roughly a TTFT after they stop
   * talking rather than after the whole reply exists. Tool use is not
   * streamed — a tool call has nothing speakable in it, and the round
   * trip is handled by the caller.
   */
  async function stream(opts: StreamOptions): Promise<CompleteResult> {
    const { system, messages, maxTokens = 300, temperature = 0.6, tools, onClause, signal } = opts;
    const body: Record<string, unknown> = {
      model: opts.model ?? model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages,
      stream: true,
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
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    let text = '';
    let pending = '';
    let spoken = false;
    let stopReason: string | null = null;
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const toolUses: ToolUseBlock[] = [];
    const partialTools = new Map<number, { id: string; name: string; json: string }>();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });

      // Server-sent events are separated by a blank line.
      let split: number;
      while ((split = raw.indexOf('\n\n')) !== -1) {
        const frame = raw.slice(0, split);
        raw = raw.slice(split + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
        } catch {
          continue;
        }

        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block as { type?: string; id?: string; name?: string } | undefined;
            if (block?.type === 'tool_use') {
              partialTools.set(Number(event.index), { id: block.id ?? '', name: block.name ?? '', json: '' });
            }
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta as { type?: string; text?: string; partial_json?: string };
            if (delta?.type === 'text_delta' && delta.text) {
              text += delta.text;
              pending += delta.text;
              // Emit as soon as there is something worth saying.
              for (;;) {
                const taken = takeSpeakable(pending, !spoken);
                if (!taken) break;
                pending = taken.rest;
                spoken = true;
                onClause(taken.clause);
              }
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              const t = partialTools.get(Number(event.index));
              if (t) t.json += delta.partial_json;
            }
            break;
          }
          case 'message_delta': {
            const d = event.delta as { stop_reason?: string } | undefined;
            if (d?.stop_reason) stopReason = d.stop_reason;
            const u = event.usage as { output_tokens?: number } | undefined;
            if (u?.output_tokens) usage.outputTokens = u.output_tokens;
            break;
          }
          case 'message_start': {
            const m = event.message as { usage?: { input_tokens?: number } } | undefined;
            usage.inputTokens = m?.usage?.input_tokens ?? 0;
            break;
          }
          default:
            break;
        }
      }
    }

    // Whatever is left is the tail of the reply.
    if (pending.trim()) onClause(pending.trim());

    for (const t of partialTools.values()) {
      let parsed: Record<string, unknown> = {};
      try { parsed = t.json ? (JSON.parse(t.json) as Record<string, unknown>) : {}; } catch { parsed = {}; }
      toolUses.push({ id: t.id, name: t.name, input: parsed });
    }

    return { text: text.trim(), toolUses, stopReason, model: opts.model ?? model, usage, raw: [] };
  }

  return {
    send,
    stream,
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
