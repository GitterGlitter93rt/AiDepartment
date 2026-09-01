// Twilio webhook signature validation.
//
// Twilio signs every webhook with HMAC-SHA1 over the full request URL
// concatenated with the POST parameters sorted by key. Without this,
// anyone who learns the URL can start fake calls and burn Anthropic
// credit — the endpoint is public by necessity.
//
// The URL Twilio signed is the PUBLIC one (https://voice.…), not what
// Node sees behind Nginx, which is why PUBLIC_BASE_URL is used to
// rebuild it rather than the inbound Host header.

import { createHmac, timingSafeEqual } from 'node:crypto';

export function expectedSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const key of sorted) data += key + params[key];
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

/** Constant-time compare so a signature cannot be discovered by timing. */
export function validateTwilioSignature(
  authToken: string,
  signatureHeader: string | undefined,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!authToken || !signatureHeader) return false;
  const expected = expectedSignature(authToken, url, params);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function formToRecord(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}
