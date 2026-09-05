import { createHmac, timingSafeEqual } from 'node:crypto';
import { ingestEvent, type InboundEvent, type IngestResult } from './inbound.js';

/**
 * The Smartlead webhook transport.
 * Authority: outbound-sales-brain-smartlead-sync-spec.md §5-§11, §17, §20.
 *
 * A reply is a relationship-changing fact: it pauses a cold sequence, hands the
 * Account to a human, and can suppress a contact outright. So the payload has to be
 * proven to come from the provider before any of that happens. Anyone who learns the
 * URL could otherwise post "not interested, remove me" for a company they compete
 * with, and the CRM would obey.
 *
 * Two things are checked here and nothing else is trusted:
 *   - an HMAC over the exact bytes received, not over a re-serialised object;
 *   - a timestamp inside the signed material, so a captured request cannot be
 *     replayed weeks later even though its signature is still valid.
 *
 * The idempotency the spec asks for lives one layer down, keyed on the provider's
 * own event id, so a provider retry of a legitimate delivery is applied once.
 */

export interface SmartleadWebhookConfig {
  /** Shared secret from the provider's webhook settings. */
  secret: string | null;
  /** How old a signed request may be. Longer windows make replay easier. */
  toleranceSeconds: number;
}

export function smartleadWebhookConfig(
  env: NodeJS.ProcessEnv = process.env,
): SmartleadWebhookConfig {
  return {
    secret: env['SMARTLEAD_WEBHOOK_SECRET'] ?? null,
    toleranceSeconds: Number(env['SMARTLEAD_WEBHOOK_TOLERANCE_SECONDS'] ?? '300'),
  };
}

export type VerifyOutcome =
  | 'OK'
  | 'NOT_CONFIGURED'
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_INVALID'
  | 'TIMESTAMP_MISSING'
  | 'TIMESTAMP_INVALID'
  | 'TIMESTAMP_OUTSIDE_TOLERANCE';

export interface VerifyResult {
  ok: boolean;
  outcome: VerifyOutcome;
}

/**
 * Verifies one webhook request.
 *
 * `rawBody` must be the bytes as received. Re-serialising the parsed object changes
 * key order and whitespace, and the signature then fails for entirely legitimate
 * requests -- which is worse than no check at all, because the first response is to
 * turn the check off.
 */
export function verifySmartleadSignature(input: {
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  config?: SmartleadWebhookConfig;
  now?: Date;
}): VerifyResult {
  const config = input.config ?? smartleadWebhookConfig();
  if (!config.secret) return { ok: false, outcome: 'NOT_CONFIGURED' };
  if (!input.signature) return { ok: false, outcome: 'SIGNATURE_MISSING' };
  if (!input.timestamp) return { ok: false, outcome: 'TIMESTAMP_MISSING' };

  // Seconds or milliseconds, both seen in the wild; an ISO string is accepted too.
  const numeric = Number(input.timestamp);
  const sentAt = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric : numeric * 1_000)
    : new Date(input.timestamp);
  if (Number.isNaN(sentAt.getTime())) return { ok: false, outcome: 'TIMESTAMP_INVALID' };

  const now = input.now ?? new Date();
  const skewSeconds = Math.abs((now.getTime() - sentAt.getTime()) / 1_000);
  // The signature is computed regardless, so an out-of-window request costs the same
  // work as an in-window one and the outcome cannot be read off the response time.
  const expected = createHmac('sha256', config.secret)
    .update(`${input.timestamp}.${input.rawBody}`).digest('hex');
  const provided = input.signature.trim().toLowerCase().replace(/^sha256=/, '');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(provided, 'hex');
  const signatureMatches = expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);

  if (!signatureMatches) return { ok: false, outcome: 'SIGNATURE_INVALID' };
  if (skewSeconds > config.toleranceSeconds) {
    return { ok: false, outcome: 'TIMESTAMP_OUTSIDE_TOLERANCE' };
  }
  return { ok: true, outcome: 'OK' };
}

/** For tests and for the provider's own settings page: sign a body the way we verify it. */
export function signSmartleadBody(
  rawBody: string, timestamp: string, secret: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** The provider's event vocabulary, mapped to ours. */
const EVENT_MAP: Record<string, InboundEvent['eventType']> = {
  EMAIL_SENT: 'SENT',
  EMAIL_DELIVERED: 'DELIVERED',
  EMAIL_OPEN: 'OPENED',
  EMAIL_OPENED: 'OPENED',
  EMAIL_BOUNCE: 'BOUNCED',
  EMAIL_BOUNCED: 'BOUNCED',
  EMAIL_REPLY: 'REPLIED',
  EMAIL_REPLIED: 'REPLIED',
  LEAD_UNSUBSCRIBED: 'UNSUBSCRIBED',
  EMAIL_UNSUBSCRIBED: 'UNSUBSCRIBED',
  LEAD_MARKED_SPAM: 'COMPLAINT',
  EMAIL_COMPLAINT: 'COMPLAINT',
  LEAD_CATEGORY_UPDATED: 'SEQUENCE_STOPPED',
  CAMPAIGN_COMPLETED: 'CAMPAIGN_COMPLETE',
  CAMPAIGN_STATUS_UPDATED: 'CAMPAIGN_COMPLETE',
};

export interface SmartleadEnvelope {
  event_type?: string;
  event_timestamp?: string;
  /** Our own correlation id, sent out on export and echoed back. */
  custom_fields?: { yad_enrollment_id?: string } | null;
  metadata?: { yad_enrollment_id?: string } | null;
  lead_id?: string | number;
  lead_email?: string;
  to_email?: string;
  reply_body?: string;
  reply_message?: { text?: string; html?: string } | null;
  bounce_type?: string;
  /** The provider's own id for this delivery, used for idempotency. */
  webhook_id?: string;
  event_id?: string;
  id?: string;
}

/**
 * Maps a provider envelope onto the canonical event.
 *
 * An event type we do not recognise is not guessed into one we do. Silently mapping
 * an unknown event onto REPLIED would fabricate a conversation.
 */
export function toInboundEvent(envelope: SmartleadEnvelope): InboundEvent | null {
  const eventType = EVENT_MAP[(envelope.event_type ?? '').toUpperCase()];
  if (!eventType) return null;

  const replyText = envelope.reply_body
    ?? envelope.reply_message?.text
    // HTML is stripped rather than stored as markup: the classifier reads words.
    ?? (envelope.reply_message?.html
      ? envelope.reply_message.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      : null);

  const occurredAt = envelope.event_timestamp ? new Date(envelope.event_timestamp) : new Date();

  return {
    provider: 'smartlead',
    providerEventId: envelope.webhook_id ?? envelope.event_id
      ?? (envelope.id !== undefined ? String(envelope.id) : null),
    eventType,
    enrollmentId: envelope.custom_fields?.yad_enrollment_id
      ?? envelope.metadata?.yad_enrollment_id ?? null,
    providerLeadId: envelope.lead_id !== undefined ? String(envelope.lead_id) : null,
    email: envelope.lead_email ?? envelope.to_email ?? null,
    replyText: replyText ?? null,
    bounceType: envelope.bounce_type === 'hard' ? 'hard'
      : envelope.bounce_type === 'soft' ? 'soft' : null,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
  };
}

export interface WebhookHandling {
  status: number;
  body: { ok: boolean; outcome: string; duplicate?: boolean; applied?: string[] };
}

/**
 * The whole request path: verify, map, ingest.
 *
 * A verification failure never reaches ingestion, and the response says only which
 * check failed -- never what the correct signature would have been, and never
 * whether the enrollment exists, which would turn the endpoint into a way to probe
 * our prospect list.
 */
export async function handleSmartleadWebhook(input: {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  config?: SmartleadWebhookConfig;
  now?: Date;
  ingest?: (event: InboundEvent) => Promise<IngestResult>;
}): Promise<WebhookHandling> {
  const header = (name: string): string | undefined => {
    const value = input.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };

  const verified = verifySmartleadSignature({
    rawBody: input.rawBody,
    signature: header('x-smartlead-signature') ?? header('x-sl-signature'),
    timestamp: header('x-smartlead-timestamp') ?? header('x-sl-timestamp'),
    config: input.config, now: input.now,
  });
  if (!verified.ok) {
    // Not configured is our fault, not the caller's, and a 401 would send the
    // provider into a retry loop against a check that will never pass.
    const status = verified.outcome === 'NOT_CONFIGURED' ? 503 : 401;
    return { status, body: { ok: false, outcome: verified.outcome } };
  }

  let envelope: SmartleadEnvelope;
  try {
    envelope = JSON.parse(input.rawBody) as SmartleadEnvelope;
  } catch {
    return { status: 400, body: { ok: false, outcome: 'BODY_NOT_JSON' } };
  }

  const event = toInboundEvent(envelope);
  if (!event) {
    // Accepted so the provider stops retrying, but nothing was applied and the
    // response says so rather than implying we understood it.
    return { status: 202, body: { ok: true, outcome: 'EVENT_TYPE_NOT_HANDLED' } };
  }

  const ingest = input.ingest ?? ingestEvent;
  const result = await ingest(event);
  if (!result.ok) {
    // An event we cannot correlate is a data problem, not a signature problem. It is
    // accepted rather than retried forever, and the reason is not echoed back.
    return { status: 202, body: { ok: false, outcome: 'NOT_CORRELATED' } };
  }
  return {
    status: 200,
    body: {
      ok: true, outcome: result.duplicate ? 'DUPLICATE' : 'APPLIED',
      duplicate: result.duplicate, applied: result.actions,
    },
  };
}
