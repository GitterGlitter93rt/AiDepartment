// ConversationRelay WebSocket protocol.
//
// Twilio sends us JSON messages; we send back text to speak. Keeping
// the protocol parsing in one pure module means the message handling
// is unit-testable without opening a socket.

export interface RelaySetupMessage {
  type: 'setup';
  callSid: string;
  from?: string;
  to?: string;
}

export interface RelayPromptMessage {
  type: 'prompt';
  voicePrompt: string;
  last?: boolean;
}

export interface RelayInterruptMessage {
  type: 'interrupt';
  utteranceUntilInterrupt?: string;
}

export interface RelayErrorMessage {
  type: 'error';
  description?: string;
}

export type RelayInbound =
  | RelaySetupMessage
  | RelayPromptMessage
  | RelayInterruptMessage
  | RelayErrorMessage
  | { type: string; [k: string]: unknown };

export function parseRelayMessage(raw: string): RelayInbound | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed as RelayInbound;
    }
    return null;
  } catch {
    return null;
  }
}

export interface TextOptions {
  /**
   * Lets a LATER text or play message stop this one's playback.
   *
   * Only safe on a message sent complete in one go. Streamed clauses
   * must not set it: each clause is a subsequent text message, so a
   * preemptible stream would cancel itself clause by clause.
   */
  preemptible?: boolean;
  /** Whether caller speech stops this playback. Relay default is on. */
  interruptible?: boolean;
}

/** Text for Twilio to speak. `last: true` closes the turn so the relay
 * starts listening again. */
export function textResponse(token: string, last = true, opts: TextOptions = {}): string {
  return JSON.stringify({
    type: 'text',
    token,
    last,
    ...(opts.preemptible !== undefined ? { preemptible: opts.preemptible } : {}),
    ...(opts.interruptible !== undefined ? { interruptible: opts.interruptible } : {}),
  });
}

/** Ends the call politely from our side. */
export function endResponse(handoffData?: Record<string, unknown>): string {
  return JSON.stringify({ type: 'end', handoffData: handoffData ? JSON.stringify(handoffData) : undefined });
}

/** Chunk long replies so speech starts sooner. ConversationRelay plays
 * tokens as they arrive, so the caller hears the first clause while the
 * rest is still being sent. */
export function chunkForSpeech(text: string, maxChars = 180): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?]+[.!?]*/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxChars && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
