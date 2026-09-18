import { createHash } from 'node:crypto';
import { query } from '../../db/pool.js';
import type { ApolloOperation, ApolloRequestMode } from './types.js';

/**
 * Every Apollo call, and the guard that stops one being made twice.
 *
 * The rule this table exists to keep: a worker restart must not spend the same credit
 * again. In-memory de-duping cannot do that -- two lanes are two callers and a redeploy
 * is a third -- so the claim is a row, and the database refuses the second one.
 */

export interface FingerprintInput {
  accountId: string;
  /** The resolved organisation, which is what a different answer would be about. */
  canonicalDomain: string | null;
  organizationIdentity?: string | null;
  /** Null for a company-level operation. */
  apolloPersonId?: string | null;
  personName?: string | null;
  operation: ApolloOperation;
  mode: ApolloRequestMode;
  /** What was asked for. Asking for more is a different question. */
  fields: readonly string[];
}

/**
 * The deterministic name of one piece of paid work.
 *
 * Only inputs that would change the answer are in it. The Account and its domain, because
 * a different company is a different question; the person; the operation and mode; and
 * the fields requested, because asking for a phone after asking for an email is genuinely
 * a new purchase rather than a repeat of the old one.
 *
 * Deliberately excludes the time, the job id and the worker: a question asked twice is
 * the same question, and that is the entire point.
 */
export function apolloFingerprint(input: FingerprintInput): string {
  const parts = [
    input.accountId,
    (input.canonicalDomain ?? '').toLowerCase(),
    (input.organizationIdentity ?? '').toLowerCase(),
    input.apolloPersonId ?? '',
    (input.personName ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
    input.operation,
    input.mode,
    [...input.fields].sort().join(','),
  ];
  return createHash('sha256').update(parts.join('|#|')).digest('hex').slice(0, 40);
}

export interface BeginResult {
  /** Null when an identical question is already in flight or already answered. */
  apolloRequestId: string | null;
  /** What the previous answer was, when this is a repeat. */
  existing?: { result: string; apolloPersonId: string | null; completedAt: Date | null };
}

/**
 * Claims the right to ask, before asking.
 *
 * The row goes in first and the provider is called second. A second worker asking the
 * same question in the same moment conflicts on the index and stands down, rather than
 * both discovering afterwards that they each paid for it.
 */
export async function beginApolloRequest(input: {
  accountId: string; contactId?: string | null;
  operation: ApolloOperation; mode: ApolloRequestMode;
  idempotencyKey: string; inputFingerprint: string;
  apolloPersonId?: string | null; apolloOrganizationId?: string | null;
}): Promise<BeginResult> {
  const { rows } = await query<{ apollo_request_id: string }>(
    `insert into apollo_requests
       (account_id, contact_id, operation, request_mode, idempotency_key,
        input_fingerprint, apollo_person_id, apollo_organization_id, result_classification)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'IN_FLIGHT')
     on conflict (idempotency_key)
       where result_classification in ('IN_FLIGHT','MATCHED','NO_MATCH')
       do nothing
     returning apollo_request_id`,
    [input.accountId, input.contactId ?? null, input.operation, input.mode,
     input.idempotencyKey, input.inputFingerprint,
     input.apolloPersonId ?? null, input.apolloOrganizationId ?? null]);

  if (rows[0]) return { apolloRequestId: rows[0].apollo_request_id };

  const prior = await query<{
    result_classification: string; apollo_person_id: string | null; completed_at: Date | null;
  }>(
    `select result_classification, apollo_person_id, completed_at from apollo_requests
      where idempotency_key = $1
        and result_classification in ('IN_FLIGHT','MATCHED','NO_MATCH')
      order by requested_at desc limit 1`, [input.idempotencyKey]);
  const row = prior.rows[0];
  return { apolloRequestId: null,
    existing: row ? { result: row.result_classification,
      apolloPersonId: row.apollo_person_id, completedAt: row.completed_at } : undefined };
}

export async function settleApolloRequest(input: {
  apolloRequestId: string;
  result: 'MATCHED' | 'NO_MATCH' | 'AMBIGUOUS' | 'ERROR' | 'SKIPPED';
  httpStatus?: number | null;
  providerRequestId?: string | null;
  providerStatus?: string | null;
  matchConfidence?: string | null;
  creditConsuming?: 'YES' | 'NO' | 'UNKNOWN';
  creditsCharged?: number | null;
  creditsEstimated?: number | null;
  fieldsGained?: readonly string[];
  errorClassification?: string | null;
  apolloPersonId?: string | null;
  apolloOrganizationId?: string | null;
  notes?: string | null;
}): Promise<void> {
  await query(
    `update apollo_requests
        set result_classification = $2, http_status = $3,
            -- An identity, not a result. Settling a request without repeating it used to
            -- overwrite it with null, which left a paid asynchronous delivery unable to
            -- find the request that bought it.
            provider_request_id = coalesce($4, provider_request_id),
            provider_status = $5, match_confidence = $6,
            credit_consuming = coalesce($7, credit_consuming),
            credits_charged = $8, credits_estimated = $9,
            fields_gained = $10, error_classification = $11,
            apollo_person_id = coalesce($12, apollo_person_id),
            apollo_organization_id = coalesce($13, apollo_organization_id),
            notes = $14, completed_at = now()
      where apollo_request_id = $1`,
    [input.apolloRequestId, input.result, input.httpStatus ?? null,
     input.providerRequestId ?? null, input.providerStatus ?? null,
     input.matchConfidence ?? null, input.creditConsuming ?? null,
     input.creditsCharged ?? null, input.creditsEstimated ?? null,
     [...(input.fieldsGained ?? [])], input.errorClassification ?? null,
     input.apolloPersonId ?? null, input.apolloOrganizationId ?? null,
     input.notes?.slice(0, 600) ?? null]);
}

/**
 * What Apollo has cost and bought.
 *
 * Actual and estimated are summed apart, for the reason the discovery ledger gives about
 * its own estimates: a figure that is mostly estimated is one nobody can hold the provider
 * to. Apollo does not return a per-call charge on these endpoints, so today every row is
 * an estimate and this report says so rather than quietly presenting it as a bill.
 */
export async function apolloSpendSummary(since?: Date): Promise<{
  calls: number; byOperation: { operation: string; calls: number; creditsEstimated: number }[];
  creditsCharged: number | null; creditsEstimated: number;
  creditCostKnown: boolean;
  matched: number; noMatch: number; ambiguous: number; errors: number;
  accountsImproved: number; decisionMakersFound: number; emailsFound: number; phonesFound: number;
}> {
  const from = since ?? new Date(0);
  const { rows } = await query<Record<string, string | null>>(
    `select count(*)::text                                                   as calls,
            sum(credits_charged)::text                                       as charged,
            coalesce(sum(credits_estimated),0)::text                         as estimated,
            count(*) filter (where credits_charged is not null)::text        as with_actual,
            count(*) filter (where result_classification='MATCHED')::text    as matched,
            count(*) filter (where result_classification='NO_MATCH')::text   as no_match,
            count(*) filter (where result_classification='AMBIGUOUS')::text  as ambiguous,
            count(*) filter (where result_classification='ERROR')::text      as errors,
            count(distinct account_id) filter (
              where array_length(fields_gained,1) > 0)::text                 as improved,
            count(distinct apollo_person_id) filter (
              where result_classification='MATCHED')::text                   as people,
            count(*) filter (where 'email' = any(fields_gained))::text       as emails,
            count(*) filter (where 'direct_phone' = any(fields_gained))::text as phones
       from apollo_requests where requested_at >= $1`, [from]);
  const r = rows[0] ?? {};

  const byOp = await query<{ operation: string; calls: string; est: string }>(
    `select operation, count(*)::text as calls, coalesce(sum(credits_estimated),0)::text as est
       from apollo_requests where requested_at >= $1 group by operation order by 2 desc`, [from]);

  return {
    calls: Number(r['calls'] ?? 0),
    byOperation: byOp.rows.map((x) => ({
      operation: x.operation, calls: Number(x.calls), creditsEstimated: Number(x.est) })),
    creditsCharged: Number(r['with_actual'] ?? 0) > 0 ? Number(r['charged'] ?? 0) : null,
    creditsEstimated: Number(r['estimated'] ?? 0),
    creditCostKnown: Number(r['with_actual'] ?? 0) > 0,
    matched: Number(r['matched'] ?? 0),
    noMatch: Number(r['no_match'] ?? 0),
    ambiguous: Number(r['ambiguous'] ?? 0),
    errors: Number(r['errors'] ?? 0),
    accountsImproved: Number(r['improved'] ?? 0),
    decisionMakersFound: Number(r['people'] ?? 0),
    emailsFound: Number(r['emails'] ?? 0),
    phonesFound: Number(r['phones'] ?? 0),
  };
}
