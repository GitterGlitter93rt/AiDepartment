// XML escaping for TwiML.
//
// Ported from services/ai-phone-agent/src/tools/transfer.ts at 2ad6449. Only the
// escaping came across: the transfer tool itself is business plumbing and belongs to
// the service that transfers, not to the transport.

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
