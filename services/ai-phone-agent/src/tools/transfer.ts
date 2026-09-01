// Warm transfer to a human.
//
// V1 signals the intent and hands a <Dial> instruction back to the
// transport, which is all ConversationRelay needs to hand the call off.
// The summary is carried so whoever picks up is not starting cold.

export interface TransferCallInput {
  targetNumber: string;
  reason: string;
  summary: string;
  callSid?: string;
}

export interface TransferResult {
  accepted: boolean;
  targetNumber: string;
  /** TwiML the transport can return to actually move the call. */
  twiml: string;
  mocked: boolean;
  reason?: string;
}

export interface TransferTool {
  transferCall(input: TransferCallInput): Promise<TransferResult>;
}

export function createTransferTool(configuredNumber: string): TransferTool {
  return {
    async transferCall({ targetNumber, reason, summary }) {
      const target = targetNumber || configuredNumber;
      if (!target) {
        return {
          accepted: false, targetNumber: '', twiml: '', mocked: true,
          reason: 'no transfer number configured (HUMAN_TRANSFER_NUMBER)',
        };
      }
      const twiml =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Response><Say>One moment while I connect you.</Say>` +
        `<Dial timeout="30">${escapeXml(target)}</Dial></Response>`;
      return { accepted: true, targetNumber: target, twiml, mocked: !configuredNumber, reason: `${reason}: ${summary}`.slice(0, 400) };
    },
  };
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
