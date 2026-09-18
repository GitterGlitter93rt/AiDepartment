import { timingSafeEqual } from 'node:crypto';
import { query } from '../../db/pool.js';
import { apolloConfig } from './client.js';
import { settleApolloRequest } from './ledger.js';

/**
 * Apollo's asynchronous phone delivery.
 *
 * `reveal_phone_number` returns immediately with demographics and sends the number later,
 * to a webhook. That is Apollo's documented design, so a phone capability that does not
 * handle it is a phone capability that silently loses what it paid eight credits for.
 *
 * Staged, not enabled. `APOLLO_PHONE_ENRICHMENT_ENABLED` is off, so nothing currently
 * asks for a phone and nothing will arrive here. It is written now because the
 * alternative -- turning phone enrichment on later and discovering the delivery path does
 * not exist -- is how paid results get lost.
 *
 * Three properties matter more than the parsing. A delivery must be authenticated, a
 * replay must not create a second endpoint, and an arrival for a request we never made
 * must be refused rather than believed.
 */

export interface ApolloWebhookResult {
  ok: boolean;
  /** True when this delivery has already been processed. Not an error. */
  duplicate: boolean;
  reason: string;
  apolloRequestId?: string;
}

/**
 * Constant-time comparison of a shared secret.
 *
 * Apollo's webhook does not sign its body, so the secret travels in a header and the
 * comparison must not leak its length or its prefix through timing. Where Apollo later
 * offers a signature, this is the function that should be replaced by one.
 */
export function verifyApolloWebhookSecret(provided: string | undefined,
                                          expected: string | null): boolean {
  if (!expected) return false;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Takes one delivery.
 *
 * Correlated by Apollo's `request_id`, which we persisted before the request was sent --
 * so a delivery that names a request we never made has nothing to attach to and is
 * refused. That is the replay and forgery guard in one: an attacker would have to know a
 * request id we generated and a secret we hold.
 */
export async function ingestApolloPhoneWebhook(payload: unknown): Promise<ApolloWebhookResult> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const providerRequestId = typeof body['request_id'] === 'string' ? body['request_id'] : null;
  if (!providerRequestId) {
    return { ok: false, duplicate: false, reason: 'the delivery carried no request_id' };
  }

  const { rows } = await query<{
    apollo_request_id: string; result_classification: string; fields_gained: string[];
  }>(
    `select apollo_request_id, result_classification, fields_gained
       from apollo_requests where provider_request_id = $1
      order by requested_at desc limit 1`, [providerRequestId]);
  const request = rows[0];

  if (!request) {
    // We never asked for this. Believing it would let anyone who guesses a request id
    // write an endpoint onto an Account.
    return { ok: false, duplicate: false,
      reason: 'no Apollo request of ours carries that request_id' };
  }

  // Apollo retries deliveries. The second one must change nothing.
  if (request.fields_gained.includes('direct_phone')) {
    return { ok: true, duplicate: true, apolloRequestId: request.apollo_request_id,
      reason: 'this phone has already been recorded' };
  }

  const people = Array.isArray(body['people']) ? body['people'] as Record<string, unknown>[] : [];
  const numbers = people.flatMap((p) =>
    (Array.isArray(p['phone_numbers']) ? p['phone_numbers'] as Record<string, unknown>[] : [])
      .filter((n) => /mobile|direct/i.test(String(n['type'] ?? ''))));

  if (numbers.length === 0) {
    await settleApolloRequest({
      apolloRequestId: request.apollo_request_id, result: 'NO_MATCH',
      // Documented: nothing is charged when nothing is found.
      creditConsuming: 'NO', creditsEstimated: 0,
      notes: 'the asynchronous delivery carried no direct number' });
    return { ok: true, duplicate: false, apolloRequestId: request.apollo_request_id,
      reason: 'no direct number was delivered' };
  }

  await settleApolloRequest({
    apolloRequestId: request.apollo_request_id, result: 'MATCHED',
    creditConsuming: 'YES',
    // "plus 8 credits if a mobile phone is returned"
    creditsEstimated: 8, creditsCharged: null,
    fieldsGained: [...request.fields_gained, 'direct_phone'],
    notes: 'a direct number arrived asynchronously' });

  return { ok: true, duplicate: false, apolloRequestId: request.apollo_request_id,
    reason: 'a direct number was recorded' };
}

/** Whether the route should accept deliveries at all. */
export function apolloWebhookConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const settings = apolloConfig(env);
  return settings.enabled && settings.phoneEnrichmentEnabled
    && Boolean((env['APOLLO_WEBHOOK_SECRET'] ?? '').trim());
}
