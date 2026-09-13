import Anthropic from '@anthropic-ai/sdk';
import type { Evidence, Lead } from './types.js';
import type { ResearchAdapter } from './research.js';

interface ResearchPayload {
  facts?: Array<{
    value: string;
    confidence: 'confirmed' | 'likely' | 'unknown';
    source: string;
  }>;
}

export class ClaudeWebResearchAdapter implements ResearchAdapter {
  readonly name = 'claude-web-research';
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async research(lead: Lead): Promise<Evidence[]> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1400,
      temperature: 0,
      tools: [{
        type: 'web_search_20260318',
        name: 'web_search',
        max_uses: 8,
        allowed_callers: ['direct'],
      }] as any,
      messages: [{
        role: 'user',
        content: buildPrompt(lead),
      }],
    } as any);

    const text = (response.content as any[])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');

    const parsed = parseJson(text);
    const observedAt = new Date().toISOString();
    return (parsed.facts ?? []).slice(0, 30).map((fact) => ({
      value: fact.value,
      confidence: fact.confidence,
      source: fact.source || 'claude-web-research',
      observedAt,
    }));
  }
}

function buildPrompt(lead: Lead): string {
  return `Research this business before an outbound B2B sales call for Your AI Department.

Business: ${lead.companyName}
Website: ${lead.website ?? 'unknown'}
City/state: ${[lead.city, lead.state].filter(Boolean).join(', ') || 'unknown'}
Industry: ${lead.industry ?? 'unknown'}

Research ONLY public business information. Focus on:
1. Evidence the business is actively running Google ads. Prefer Google Ads Transparency Center or visible sponsored-search evidence. Do not infer active ads merely from Google tracking tags.
2. Evidence the business is actively running Meta/Facebook/Instagram ads. Prefer Meta Ad Library. Do not infer active ads merely from a Meta Pixel.
3. Publicly visible CRM/marketing platform signals.
4. Website lead capture, booking, chat, SMS, click-to-call, emergency/after-hours positioning.
5. Any clear operational observation useful for a discovery question.

Truth rules:
- CONFIRMED means a current public source directly supports the statement.
- LIKELY means there is a meaningful signal but not direct proof.
- UNKNOWN means you could not verify it.
- Never invent ad spend, lead volume, CRM usage, revenue, response time, or backend integrations.
- Tracking pixels prove tracking technology, not active advertising.
- A form on a website does not prove where the submission goes.

Return ONLY valid JSON with this shape:
{"facts":[{"value":"short factual observation","confidence":"confirmed|likely|unknown","source":"public source name or URL"}]}

Include explicit entries for Google active ads and Meta active ads, even when unknown.`;
}

function parseJson(text: string): ResearchPayload {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return { facts: [] };
  try {
    return JSON.parse(text.slice(first, last + 1)) as ResearchPayload;
  } catch {
    return { facts: [{ value: 'Web research returned an unparseable result', confidence: 'unknown', source: 'claude-web-research' }] };
  }
}
