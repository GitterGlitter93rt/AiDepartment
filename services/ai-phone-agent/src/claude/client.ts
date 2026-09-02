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
  /**
   * The leading part of `system` that is identical on every turn of a
   * call, marked for Anthropic's prompt cache.
   *
   * Worth doing because the static half is the big half: the core
   * rules, the specialist persona, the business profile and the action
   * policies are about 85% of the payload and none of them change
   * between turns. Cached, they are billed at a fraction and skip
   * re-processing, which shows up as time to first token.
   *
   * Must be a genuine prefix of `system` and byte-identical each turn,
   * or the cache simply misses and nothing is gained.
   */
  cachedSystemPrefix?: string;
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

/**
 * Clause release thresholds, in characters.
 *
 * These trade first-audio latency against how the speech sounds. A low
 * comma threshold gets "Absolutely," out fast but risks a one-word
 * fragment followed by a seam; a high one is smoother and slower. They
 * are named and exported so the tuning is one edit and one test, not a
 * hunt through a regex.
 */
export const FIRST_CLAUSE_MIN = 12;
export const LATER_CLAUSE_MIN = 30;
/** Lowest bar for the opening comma break. Raise if the live call
 * sounds fragmented — see QA-LIVE-CALLS.md. */
export const FIRST_COMMA_MIN = 10;

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
  /**
   * Timing hooks.
   *
   * The request and the first token are only observable from inside
   * this function, and they are the two numbers that separate "our
   * code is slow" from "the model is slow". Optional so tests and the
   * non-telemetry paths are unaffected.
   */
  onRequestStart?: () => void;
  onFirstStreamEvent?: () => void;
  /**
   * Stop speaking once this many characters have been emitted.
   *
   * A realtime receptionist that produces a 700-character paragraph
   * has already lost the caller, and max_tokens is a poor lever: it
   * cuts wherever the budget runs out, mid-word. This stops at the end
   * of a completed clause — so the turn is short AND finishes a
   * thought — and abandons the rest of the generation, which stops
   * paying for words nobody will hear.
   *
   * Never applied while a tool call is being assembled: a truncated
   * tool_use block is an invalid request, not a shorter answer.
   */
  maxSpeechChars?: number;
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
  // Later clauses need to be longer, or the speech comes out choppy.
  const sentenceMin = isFirst ? FIRST_CLAUSE_MIN : LATER_CLAUSE_MIN;

  // Walk the sentence boundaries and take the FIRST one long enough to
  // be worth speaking, merging short sentences into their neighbour.
  //
  // Matching only up to the first full stop looks equivalent and is
  // not: a reply made of short sentences then has a too-short clause
  // stuck at the head of the buffer forever, nothing is ever emitted,
  // and the entire turn arrives in one lump at the end — streaming
  // silently switching itself off exactly when the reply is chatty.
  const boundary = /[.!?](?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(buffer)) !== null) {
    const end = match.index + 1;
    const clause = buffer.slice(0, end).trim();
    if (clause.length >= sentenceMin) return { clause, rest: buffer.slice(end) };
  }

  // For the FIRST clause only, a comma will do — that is where the
  // latency is won. The bar is lower than for a sentence because
  // "Absolutely," is worth saying on its own while the rest is still
  // being generated, but high enough that "Yes," and "Sure," are held
  // back rather than shipped as a turn of their own.
  if (isFirst) {
    const comma = buffer.match(/^[\s\S]*?,(?=\s)/);
    if (comma && comma[0].trim().length >= FIRST_COMMA_MIN) {
      return { clause: comma[0].trim(), rest: buffer.slice(comma[0].length) };
    }
  }
  return null;
}

// Overridable for local end-to-end testing against a stub that speaks
// the same SSE protocol. Never set in production.
const ANTHROPIC_URL = process.env.ANTHROPIC_BASE_URL
  ? `${process.env.ANTHROPIC_BASE_URL.replace(/\/$/, '')}/v1/messages`
  : 'https://api.anthropic.com/v1/messages';

interface ApiResponse {
  content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
  stop_reason?: string | null;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
}

/**
 * The `system` field: a plain string, or two blocks with a cache
 * breakpoint between them.
 *
 * Anthropic caches the prefix up to and including the block carrying
 * cache_control, so the split point is the boundary between what is
 * fixed for the call and what changes with the turn.
 */
/**
 * Marks the tool schemas as cacheable.
 *
 * The breakpoint goes on the LAST tool because Anthropic caches
 * everything up to and including the marked block — one marker
 * therefore covers the whole array. Tool definitions sit ahead of the
 * system prompt in the cached prefix, so this has to hold for the
 * system cache to be worth anything either.
 *
 * The set is stable for a call: toolsFor() keys off industry and demo
 * phase, neither of which changes turn to turn on a normal call.
 */
export function withToolCache(tools: unknown[]): unknown[] {
  if (tools.length === 0) return tools;
  return tools.map((tool, i) =>
    i === tools.length - 1
      ? { ...(tool as Record<string, unknown>), cache_control: { type: 'ephemeral' } }
      : tool,
  );
}

export function buildSystemField(system: string, cachedPrefix?: string): unknown {
  if (!cachedPrefix || !system.startsWith(cachedPrefix) || cachedPrefix.length === system.length) {
    return system;
  }
  return [
    { type: 'text', text: cachedPrefix, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: system.slice(cachedPrefix.length) },
  ];
}

export function createClaudeClient(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): ClaudeClient {
  async function send(opts: CompleteOptions): Promise<CompleteResult> {
    const { system, messages, maxTokens = 300, temperature = 0.6, tools } = opts;
    const body: Record<string, unknown> = {
      model: opts.model ?? model,
      max_tokens: maxTokens,
      temperature,
      system: buildSystemField(system, opts.cachedSystemPrefix),
      messages,
    };
    if (tools && tools.length > 0) body.tools = withToolCache(tools);

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
    opts.onRequestStart?.();
    const body: Record<string, unknown> = {
      model: opts.model ?? model,
      max_tokens: maxTokens,
      temperature,
      system: buildSystemField(system, opts.cachedSystemPrefix),
      messages,
      stream: true,
    };
    if (tools && tools.length > 0) body.tools = withToolCache(tools);

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
    let sawFirstEvent = false;
    let spokenChars = 0;
    let overBudget = false;
    let stopReason: string | null = null;
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const toolUses: ToolUseBlock[] = [];
    const partialTools = new Map<number, { id: string; name: string; json: string }>();
    /**
     * The assistant's content blocks, rebuilt in the order the API sent
     * them.
     *
     * This is not bookkeeping. A tool_result must be answered by a
     * message whose tool_use block carries the same id; if the
     * assistant turn does not contain that block, the API rejects the
     * whole request with "unexpected tool_use_id found in tool_result
     * blocks" and the caller hears nothing. The non-streaming path gets
     * these blocks handed to it whole — streaming has to reassemble
     * them from the deltas.
     */
    const textByIndex = new Map<number, string>();

    for (;;) {
      if (overBudget) {
        // Enough has been said. Drop the rest rather than synthesising
        // and billing for words the caller does not need.
        pending = '';
        await reader.cancel().catch(() => { /* already closed */ });
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });

      // Server-sent events are separated by a blank line.
      let split: number;
      while ((split = raw.indexOf('\n\n')) !== -1) {
        // A single read can carry the entire response, so the budget
        // has to be honoured here and not merely between reads —
        // otherwise the whole reply is parsed and accumulated before
        // anything notices it went over.
        if (overBudget) break;
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

        // Time to first token. Fired on the first frame carrying model
        // output rather than on message_start, which arrives before the
        // model has produced anything.
        if (!sawFirstEvent && (event.type === 'content_block_delta' || event.type === 'content_block_start')) {
          sawFirstEvent = true;
          opts.onFirstStreamEvent?.();
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
              const idx = Number(event.index);
              textByIndex.set(idx, (textByIndex.get(idx) ?? '') + delta.text);
              text += delta.text;
              pending += delta.text;
              // Emit as soon as there is something worth saying.
              for (;;) {
                if (overBudget) break;
                const taken = takeSpeakable(pending, !spoken);
                if (!taken) break;
                pending = taken.rest;
                spoken = true;
                spokenChars += taken.clause.length;
                onClause(taken.clause);
                // Budget is checked AFTER emitting, so a turn always
                // finishes the clause it is in the middle of.
                if (opts.maxSpeechChars && spokenChars >= opts.maxSpeechChars && partialTools.size === 0) {
                  overBudget = true;
                  break;
                }
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

    // Rebuild the assistant turn exactly as the API produced it:
    // every block, at its own index, in order. Indices are the API's,
    // so sorting by them restores the original sequence even when text
    // and tool_use blocks interleave.
    const contentBlocks: unknown[] = [];
    const indices = [...new Set([...textByIndex.keys(), ...partialTools.keys()])].sort((a, b) => a - b);
    for (const idx of indices) {
      const t = partialTools.get(idx);
      if (t) {
        let parsed: Record<string, unknown> = {};
        try { parsed = t.json ? (JSON.parse(t.json) as Record<string, unknown>) : {}; } catch { parsed = {}; }
        toolUses.push({ id: t.id, name: t.name, input: parsed });
        contentBlocks.push({ type: 'tool_use', id: t.id, name: t.name, input: parsed });
        continue;
      }
      const chunk = textByIndex.get(idx);
      // An empty text block is not merely useless — the API rejects a
      // content block with an empty string, so it must not be emitted.
      if (chunk && chunk.trim()) contentBlocks.push({ type: 'text', text: chunk });
    }

    return { text: text.trim(), toolUses, stopReason, model: opts.model ?? model, usage, raw: contentBlocks };
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
