import type { WebSocket } from 'ws';
import type { CallContextStore } from './store.js';
import { buildRealtimeSystemPrompt } from './prompt.js';
import type { ClaudeConversationModel, ChatTurn } from './claude.js';

interface RelayMessage {
  type?: string;
  sessionId?: string;
  callSid?: string;
  customParameters?: Record<string, string>;
  voicePrompt?: string;
  lang?: string;
  utteranceUntilInterrupt?: string;
}

interface SessionState {
  leadId?: string;
  systemPrompt?: string;
  history: ChatTurn[];
  generation: number;
}

export class ConversationRelaySession {
  private state: SessionState = { history: [], generation: 0 };

  constructor(
    private readonly socket: WebSocket,
    private readonly store: CallContextStore,
    private readonly model: ClaudeConversationModel,
  ) {}

  async onMessage(raw: string): Promise<void> {
    const msg = JSON.parse(raw) as RelayMessage;
    switch (msg.type) {
      case 'setup':
        await this.onSetup(msg);
        return;
      case 'prompt':
        if (msg.voicePrompt?.trim()) await this.onPrompt(msg.voicePrompt.trim());
        return;
      case 'interrupt':
        this.state.generation += 1;
        return;
      default:
        return;
    }
  }

  private async onSetup(msg: RelayMessage): Promise<void> {
    const leadId = msg.customParameters?.leadId;
    if (!leadId) throw new Error('ConversationRelay setup missing leadId custom parameter');
    const context = await this.store.getContext(leadId);
    if (!context) throw new Error(`No prepared call context for lead ${leadId}`);
    this.state.leadId = leadId;
    this.state.systemPrompt = buildRealtimeSystemPrompt(context);
  }

  private async onPrompt(userText: string): Promise<void> {
    if (!this.state.systemPrompt) throw new Error('ConversationRelay prompt arrived before setup');
    const generation = ++this.state.generation;
    let assistantText = '';

    for await (const token of this.model.respond(this.state.systemPrompt, this.state.history, userText)) {
      if (generation !== this.state.generation) return;
      assistantText += token;
      this.sendText(token, false);
    }

    if (generation !== this.state.generation) return;
    this.sendText('', true);
    this.state.history.push({ role: 'user', content: userText });
    this.state.history.push({ role: 'assistant', content: assistantText });
    if (this.state.history.length > 20) this.state.history = this.state.history.slice(-20);
  }

  private sendText(token: string, last: boolean): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'text', token, last }));
  }
}
