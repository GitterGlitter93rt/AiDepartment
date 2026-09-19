import Anthropic from '@anthropic-ai/sdk';

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

export class ClaudeConversationModel {
  private client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async *respond(system: string, history: ChatTurn[], userText: string): AsyncGenerator<string> {
    const messages = [...history, { role: 'user' as const, content: userText }];
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 260,
      temperature: 0.6,
      system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}
