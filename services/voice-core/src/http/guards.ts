// Lightweight request protections. No dependencies — a fixed-window
//
// Ported verbatim from services/ai-phone-agent at 2ad6449.
// counter and a byte cap are enough for a webhook endpoint that only
// Twilio should be hitting.

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = 60, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** True when the request is allowed. */
  check(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  /** Drop expired windows so the map cannot grow without bound. */
  sweep(now = Date.now()): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }

  get size(): number {
    return this.hits.size;
  }
}

export const MAX_BODY_BYTES = 64 * 1024;

/** Reads a request body, aborting if it exceeds the cap. Prevents a
 * malicious or misconfigured client from exhausting memory. */
export async function readBodyLimited(
  req: AsyncIterable<Buffer | string>,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ body: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > maxBytes) return { body: '', truncated: true };
    chunks.push(buf);
  }
  return { body: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

/** Client IP, trusting X-Forwarded-For only when explicitly behind a
 * proxy — otherwise a caller could spoof the header to evade limits. */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddr: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const xff = headers['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : xff;
    if (first) return first.split(',')[0]!.trim();
  }
  return socketAddr ?? 'unknown';
}
