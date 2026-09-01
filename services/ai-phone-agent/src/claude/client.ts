// Minimal Anthropic Messages API client built on fetch.
//
// Deliberately not the SDK: this service has exactly one hard
// dependency (ws), and a thin fetch wrapper is trivially mockable in
// tests without a network or an API key. The interface is what the
// rest of the system depends on, so swapping in the official SDK later
// is a one-file change.

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ClaudeClient {
  complete(opts: CompleteOptions): Promise<string>;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export function createClaudeClient(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): ClaudeClient {
  return {
    async complete({ system, messages, maxTokens = 300, temperature = 0.6 }) {
      const res = await fetchImpl(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`anthropic ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim();
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
